"""Session info, profile updates, public config, and notifications."""
from flask import Blueprint, g, jsonify, request

from backend.config import Config, get_supabase
from backend.routes import error, login_required

bp = Blueprint("auth", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    return jsonify({"status": "ok", "configured": not Config.missing()})


@bp.get("/config")
def public_config():
    """Only the public (anon) key is ever sent to the browser."""
    if Config.missing():
        return error("Server is missing Supabase settings. Check your environment variables.", 500)
    return jsonify(
        {"supabase_url": Config.SUPABASE_URL, "supabase_anon_key": Config.SUPABASE_ANON_KEY}
    )


@bp.get("/auth/me")
@login_required
def me():
    return jsonify({"user": g.profile})


@bp.patch("/auth/profile")
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    updates = {}
    if "full_name" in data:
        name = str(data["full_name"]).strip()
        if not name:
            return error("Enter your full name.")
        updates["full_name"] = name[:120]
    if "phone" in data:
        updates["phone"] = (str(data["phone"]).strip()[:30] or None)
    if not updates:
        return error("Nothing to update.")
    result = get_supabase().table("users").update(updates).eq("id", g.profile["id"]).execute()
    return jsonify({"user": result.data[0]})


@bp.get("/notifications")
@login_required
def list_notifications():
    result = (
        get_supabase()
        .table("notifications")
        .select("*")
        .eq("user_id", g.profile["id"])
        .order("created_at", desc=True)
        .limit(30)
        .execute()
    )
    return jsonify({"notifications": result.data})


@bp.post("/notifications/read")
@login_required
def mark_notifications_read():
    data = request.get_json(silent=True) or {}
    query = get_supabase().table("notifications").update({"is_read": True}).eq("user_id", g.profile["id"])
    if data.get("id"):
        query = query.eq("id", data["id"])
    query.execute()
    return jsonify({"ok": True})
