"""Shop supplies with low-stock detection."""
from flask import Blueprint, jsonify, request

from backend.config import get_supabase
from backend.routes import error, staff_required
from backend.services import notification_service as notify

bp = Blueprint("inventory", __name__, url_prefix="/api/inventory")


def _number(value, field, allow_negative=False):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Enter a valid number for {field}.")
    if number < 0 and not allow_negative:
        raise ValueError(f"{field} cannot be negative.")
    return number


def _is_low(item):
    return float(item["stock_quantity"]) <= float(item["reorder_level"])


def _check_low_stock(before, after):
    """Notify staff only when stock crosses below the reorder level."""
    if _is_low(after) and (before is None or not _is_low(before)):
        notify.notify_low_stock(after)


@bp.get("")
@staff_required
def list_items():
    query = get_supabase().table("inventory").select("*, branches(name)").order("item_name")
    if request.args.get("branch_id"):
        query = query.eq("branch_id", request.args["branch_id"])
    items = query.execute().data
    for item in items:
        item["is_low"] = _is_low(item)
    return jsonify({"items": items})


@bp.get("/low-stock")
@staff_required
def low_stock():
    items = get_supabase().table("inventory").select("*, branches(name)").order("item_name").execute().data
    return jsonify({"items": [i for i in items if _is_low(i)]})


@bp.post("")
@staff_required
def create_item():
    data = request.get_json(silent=True) or {}
    name = str(data.get("item_name", "")).strip()
    if not name or not data.get("branch_id"):
        return error("Enter an item name and choose a branch.")
    try:
        row = {
            "branch_id": data["branch_id"],
            "item_name": name[:120],
            "stock_quantity": _number(data.get("stock_quantity", 0), "stock"),
            "unit": str(data.get("unit", "pcs")).strip()[:20] or "pcs",
            "reorder_level": _number(data.get("reorder_level", 0), "reorder level"),
        }
    except ValueError as exc:
        return error(str(exc))
    item = get_supabase().table("inventory").insert(row).execute().data[0]
    _check_low_stock(None, item)
    return jsonify({"item": item}), 201


@bp.patch("/<item_id>")
@staff_required
def update_item(item_id):
    data = request.get_json(silent=True) or {}
    sb = get_supabase()
    found = sb.table("inventory").select("*").eq("id", item_id).limit(1).execute().data
    if not found:
        return error("Inventory item not found.", 404)
    before = found[0]
    updates = {}
    try:
        if "item_name" in data and str(data["item_name"]).strip():
            updates["item_name"] = str(data["item_name"]).strip()[:120]
        if "unit" in data and str(data["unit"]).strip():
            updates["unit"] = str(data["unit"]).strip()[:20]
        if "stock_quantity" in data:
            updates["stock_quantity"] = _number(data["stock_quantity"], "stock")
        if "reorder_level" in data:
            updates["reorder_level"] = _number(data["reorder_level"], "reorder level")
        if data.get("branch_id"):
            updates["branch_id"] = data["branch_id"]
    except ValueError as exc:
        return error(str(exc))
    if not updates:
        return error("Nothing to update.")
    item = sb.table("inventory").update(updates).eq("id", item_id).execute().data[0]
    _check_low_stock(before, item)
    return jsonify({"item": item})


@bp.post("/<item_id>/adjust")
@staff_required
def adjust_stock(item_id):
    """Add or remove stock, e.g. {"delta": -2} after using detergent."""
    data = request.get_json(silent=True) or {}
    try:
        delta = _number(data.get("delta"), "adjustment", allow_negative=True)
    except ValueError as exc:
        return error(str(exc))
    sb = get_supabase()
    found = sb.table("inventory").select("*").eq("id", item_id).limit(1).execute().data
    if not found:
        return error("Inventory item not found.", 404)
    before = found[0]
    new_qty = max(0.0, float(before["stock_quantity"]) + delta)
    item = sb.table("inventory").update({"stock_quantity": new_qty}).eq("id", item_id).execute().data[0]
    _check_low_stock(before, item)
    return jsonify({"item": item})


@bp.delete("/<item_id>")
@staff_required
def delete_item(item_id):
    get_supabase().table("inventory").delete().eq("id", item_id).execute()
    return jsonify({"ok": True})
