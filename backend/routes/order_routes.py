"""Orders: booking, listing, status updates, deletion, plus branch/service lookups."""
import secrets

from flask import Blueprint, g, jsonify, request

from backend.config import get_supabase
from backend.routes import error, is_staff, login_required, staff_required
from backend.services import notification_service as notify

bp = Blueprint("orders", __name__, url_prefix="/api")

ORDER_STATUSES = ["received", "washing", "drying", "ready", "completed"]
PAYMENT_STATUSES = ["unpaid", "paid"]
ORDER_SELECT = (
    "*, customer:users(full_name,email,phone), branches(name), "
    "order_items(id,service_id,quantity_or_weight,subtotal,services(name,pricing_type,unit_price))"
)


# ---------- lookups ----------

@bp.get("/public/services")
def public_services():
    """Price list for the landing page (no sign-in needed)."""
    rows = get_supabase().table("services").select("*").order("name").execute().data
    return jsonify({"services": rows})


@bp.get("/services")
@login_required
def list_services():
    rows = get_supabase().table("services").select("*").order("name").execute().data
    return jsonify({"services": rows})


@bp.get("/branches")
@login_required
def list_branches():
    rows = get_supabase().table("branches").select("*").order("name").execute().data
    return jsonify({"branches": rows})


# ---------- helpers ----------

def _fetch_order(order_id):
    result = get_supabase().table("orders").select(ORDER_SELECT).eq("id", order_id).limit(1).execute()
    return result.data[0] if result.data else None


def _build_items(raw_items):
    """Validate items and price them from the database, never from the client."""
    if not isinstance(raw_items, list) or not raw_items:
        return None, None, "Add at least one item to the order."
    ids = list({str(i.get("service_id")) for i in raw_items if isinstance(i, dict)})
    services = get_supabase().table("services").select("*").in_("id", ids).execute().data
    by_id = {s["id"]: s for s in services}
    rows, total = [], 0.0
    for item in raw_items:
        service = by_id.get(str(item.get("service_id")))
        if not service:
            return None, None, "One of the selected services no longer exists."
        try:
            qty = float(item.get("quantity"))
        except (TypeError, ValueError):
            return None, None, "Enter a valid quantity for each item."
        if qty <= 0 or qty > 1000:
            return None, None, "Quantity must be greater than zero."
        if service["pricing_type"] == "per_piece":
            if qty != int(qty):
                return None, None, f"{service['name']} is priced per piece. Use a whole number."
            qty = int(qty)
        else:
            qty = round(qty, 2)
        subtotal = round(float(service["unit_price"]) * qty, 2)
        total += subtotal
        rows.append({"service_id": service["id"], "quantity_or_weight": qty, "subtotal": subtotal})
    return rows, round(total, 2), None


def _resolve_customer(data):
    """Staff booking: find the customer by email, or create a walk-in account."""
    email = str(data.get("customer_email", "")).strip().lower()
    if not email or "@" not in email:
        return None, "Enter the customer's email address."
    sb = get_supabase()
    found = sb.table("users").select("id").eq("email", email).limit(1).execute().data
    if found:
        return found[0]["id"], None
    name = str(data.get("customer_name", "")).strip()
    if not name:
        return None, "This customer is new. Enter their name to create an account."
    created = sb.auth.admin.create_user(
        {
            "email": email,
            "password": secrets.token_urlsafe(18),
            "email_confirm": True,
            "user_metadata": {"full_name": name, "phone": str(data.get("customer_phone", "")).strip() or None},
        }
    )
    user_id = created.user.id
    exists = sb.table("users").select("id").eq("id", user_id).limit(1).execute().data
    if not exists:
        sb.table("users").insert(
            {"id": user_id, "email": email, "full_name": name,
             "phone": str(data.get("customer_phone", "")).strip() or None, "role": "customer"}
        ).execute()
    return user_id, None


def _valid_pickup(value):
    return value if value else None


# ---------- orders ----------

@bp.get("/orders")
@login_required
def list_orders():
    query = get_supabase().table("orders").select(ORDER_SELECT).order("created_at", desc=True)
    if is_staff():
        for key in ("order_status", "payment_status", "branch_id"):
            if request.args.get(key):
                query = query.eq(key, request.args[key])
        query = query.limit(300)
    else:
        query = query.eq("customer_id", g.profile["id"]).limit(100)
    return jsonify({"orders": query.execute().data})


@bp.get("/orders/<order_id>")
@login_required
def get_order(order_id):
    order = _fetch_order(order_id)
    if not order or (not is_staff() and order["customer_id"] != g.profile["id"]):
        return error("Order not found.", 404)
    return jsonify({"order": order})


@bp.post("/orders")
@login_required
def create_order():
    data = request.get_json(silent=True) or {}
    if not data.get("branch_id"):
        return error("Choose a branch for drop-off.")
    rows, total, problem = _build_items(data.get("items"))
    if problem:
        return error(problem)

    if is_staff():
        customer_id, problem = _resolve_customer(data)
        if problem:
            return error(problem)
        payment_status = data.get("payment_status") if data.get("payment_status") in PAYMENT_STATUSES else "unpaid"
    else:
        customer_id, payment_status = g.profile["id"], "unpaid"

    sb = get_supabase()
    order = sb.table("orders").insert(
        {
            "customer_id": customer_id,
            "branch_id": data["branch_id"],
            "total_amount": total,
            "payment_status": payment_status,
            "order_status": "received",
            "pickup_date": _valid_pickup(data.get("pickup_date")),
        }
    ).execute().data[0]
    try:
        sb.table("order_items").insert([{**r, "order_id": order["id"]} for r in rows]).execute()
    except Exception:
        sb.table("orders").delete().eq("id", order["id"]).execute()
        raise
    notify.notify_order_created(order)
    return jsonify({"order": _fetch_order(order["id"])}), 201


@bp.patch("/orders/<order_id>")
@staff_required
def update_order(order_id):
    data = request.get_json(silent=True) or {}
    current = _fetch_order(order_id)
    if not current:
        return error("Order not found.", 404)

    updates = {}
    if "order_status" in data:
        if data["order_status"] not in ORDER_STATUSES:
            return error("Unknown order status.")
        updates["order_status"] = data["order_status"]
    if "payment_status" in data:
        if data["payment_status"] not in PAYMENT_STATUSES:
            return error("Unknown payment status.")
        updates["payment_status"] = data["payment_status"]
    if "pickup_date" in data:
        updates["pickup_date"] = _valid_pickup(data["pickup_date"])
    if data.get("branch_id"):
        updates["branch_id"] = data["branch_id"]

    sb = get_supabase()
    if "items" in data:
        rows, total, problem = _build_items(data["items"])
        if problem:
            return error(problem)
        sb.table("order_items").delete().eq("order_id", order_id).execute()
        sb.table("order_items").insert([{**r, "order_id": order_id} for r in rows]).execute()
        updates["total_amount"] = total

    if updates:
        sb.table("orders").update(updates).eq("id", order_id).execute()

    if updates.get("order_status") and updates["order_status"] != current["order_status"]:
        notify.notify_order_status(current, updates["order_status"])
    if updates.get("payment_status") and updates["payment_status"] != current["payment_status"]:
        notify.notify_payment(current, updates["payment_status"])
    return jsonify({"order": _fetch_order(order_id)})


@bp.delete("/orders/<order_id>")
@staff_required
def delete_order(order_id):
    if not _fetch_order(order_id):
        return error("Order not found.", 404)
    get_supabase().table("orders").delete().eq("id", order_id).execute()
    return jsonify({"ok": True})
