"""Shop administration: stats, services, branches, and people."""
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from backend.config import get_supabase
from backend.routes import admin_required, error, staff_required

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

PRICING_TYPES = ("per_kg", "per_piece")
ROLES = ("admin", "staff", "customer")


# ---------- overview ----------

@bp.get("/stats")
@staff_required
def stats():
    sb = get_supabase()
    orders = sb.table("orders").select("id,total_amount,payment_status,order_status,created_at").execute().data
    inventory = sb.table("inventory").select("stock_quantity,reorder_level").execute().data
    today = datetime.now(timezone.utc).date().isoformat()

    by_status = {s: 0 for s in ("received", "washing", "drying", "ready", "completed")}
    revenue_total = revenue_today = 0.0
    unpaid = 0
    for order in orders:
        by_status[order["order_status"]] = by_status.get(order["order_status"], 0) + 1
        if order["payment_status"] == "paid":
            revenue_total += float(order["total_amount"])
            if str(order["created_at"]).startswith(today):
                revenue_today += float(order["total_amount"])
        else:
            unpaid += 1

    low = sum(1 for i in inventory if float(i["stock_quantity"]) <= float(i["reorder_level"]))
    return jsonify(
        {
            "total_orders": len(orders),
            "active_orders": len(orders) - by_status["completed"],
            "by_status": by_status,
            "unpaid_orders": unpaid,
            "revenue_total": round(revenue_total, 2),
            "revenue_today": round(revenue_today, 2),
            "low_stock_count": low,
        }
    )


# ---------- services (staff can add and reprice; only admins delete) ----------

def _service_fields(data, partial=False):
    out = {}
    if not partial or "name" in data:
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("Enter a service name.")
        out["name"] = name[:120]
    if not partial or "unit_price" in data:
        try:
            price = round(float(data.get("unit_price")), 2)
        except (TypeError, ValueError):
            raise ValueError("Enter a valid price.")
        if price < 0:
            raise ValueError("Price cannot be negative.")
        out["unit_price"] = price
    if not partial or "pricing_type" in data:
        if data.get("pricing_type") not in PRICING_TYPES:
            raise ValueError("Choose per kg or per piece pricing.")
        out["pricing_type"] = data["pricing_type"]
    if "description" in data:
        out["description"] = str(data.get("description") or "").strip()[:500] or None
    if "image_url" in data:
        out["image_url"] = str(data.get("image_url") or "").strip()[:500] or None
    return out


@bp.post("/services")
@staff_required
def create_service():
    try:
        row = _service_fields(request.get_json(silent=True) or {})
    except ValueError as exc:
        return error(str(exc))
    return jsonify({"service": get_supabase().table("services").insert(row).execute().data[0]}), 201


@bp.patch("/services/<service_id>")
@staff_required
def update_service(service_id):
    try:
        updates = _service_fields(request.get_json(silent=True) or {}, partial=True)
    except ValueError as exc:
        return error(str(exc))
    if not updates:
        return error("Nothing to update.")
    result = get_supabase().table("services").update(updates).eq("id", service_id).execute()
    if not result.data:
        return error("Service not found.", 404)
    return jsonify({"service": result.data[0]})


@bp.delete("/services/<service_id>")
@admin_required
def delete_service(service_id):
    used = get_supabase().table("order_items").select("id").eq("service_id", service_id).limit(1).execute().data
    if used:
        return error("This service appears on existing orders, so it cannot be deleted. Edit it instead.", 409)
    get_supabase().table("services").delete().eq("id", service_id).execute()
    return jsonify({"ok": True})


# ---------- branches ----------

def _branch_fields(data):
    name = str(data.get("name", "")).strip()
    if not name:
        raise ValueError("Enter a branch name.")
    return {
        "name": name[:120],
        "address": str(data.get("address") or "").strip()[:300] or None,
        "contact_number": str(data.get("contact_number") or "").strip()[:30] or None,
    }


@bp.post("/branches")
@admin_required
def create_branch():
    try:
        row = _branch_fields(request.get_json(silent=True) or {})
    except ValueError as exc:
        return error(str(exc))
    return jsonify({"branch": get_supabase().table("branches").insert(row).execute().data[0]}), 201


@bp.patch("/branches/<branch_id>")
@admin_required
def update_branch(branch_id):
    try:
        row = _branch_fields(request.get_json(silent=True) or {})
    except ValueError as exc:
        return error(str(exc))
    result = get_supabase().table("branches").update(row).eq("id", branch_id).execute()
    if not result.data:
        return error("Branch not found.", 404)
    return jsonify({"branch": result.data[0]})


@bp.delete("/branches/<branch_id>")
@admin_required
def delete_branch(branch_id):
    used = get_supabase().table("orders").select("id").eq("branch_id", branch_id).limit(1).execute().data
    if used:
        return error("This branch has orders on record, so it cannot be deleted.", 409)
    get_supabase().table("branches").delete().eq("id", branch_id).execute()
    return jsonify({"ok": True})


# ---------- people ----------

@bp.get("/users")
@staff_required
def list_users():
    query = get_supabase().table("users").select("*").order("created_at", desc=True).limit(500)
    if request.args.get("role") in ROLES:
        query = query.eq("role", request.args["role"])
    return jsonify({"users": query.execute().data})


@bp.patch("/users/<user_id>/role")
@admin_required
def set_role(user_id):
    role = (request.get_json(silent=True) or {}).get("role")
    if role not in ROLES:
        return error("Choose admin, staff, or customer.")
    if user_id == g.profile["id"] and role != "admin":
        return error("You cannot remove your own admin access.", 409)
    result = get_supabase().table("users").update({"role": role}).eq("id", user_id).execute()
    if not result.data:
        return error("User not found.", 404)
    return jsonify({"user": result.data[0]})
