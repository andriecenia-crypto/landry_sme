"""Shared helpers for route modules: JSON errors and auth decorators."""
from functools import wraps

from flask import g, jsonify, request

from backend.config import get_supabase

STAFF_ROLES = ("admin", "staff")


def error(message, status=400):
    return jsonify({"error": message}), status


def _bearer_token():
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def _load_profile(auth_user):
    """Fetch the public.users row, creating it if the signup trigger has not run."""
    sb = get_supabase()
    found = sb.table("users").select("*").eq("id", auth_user.id).limit(1).execute()
    if found.data:
        return found.data[0]
    meta = auth_user.user_metadata or {}
    row = {
        "id": auth_user.id,
        "email": auth_user.email,
        "full_name": meta.get("full_name", ""),
        "phone": meta.get("phone"),
        "role": "customer",
    }
    return sb.table("users").insert(row).execute().data[0]


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _bearer_token()
        if not token:
            return error("Sign in to continue.", 401)
        try:
            response = get_supabase().auth.get_user(token)
            auth_user = response.user if response else None
        except Exception:  # invalid or expired JWT
            auth_user = None
        if not auth_user:
            return error("Your session has expired. Sign in again.", 401)
        g.auth_user = auth_user
        g.profile = _load_profile(auth_user)
        return fn(*args, **kwargs)

    return wrapper


def roles_required(*roles):
    def decorator(fn):
        @login_required
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if g.profile["role"] not in roles:
                return error("You do not have permission to do that.", 403)
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def staff_required(fn):
    return roles_required(*STAFF_ROLES)(fn)


def admin_required(fn):
    return roles_required("admin")(fn)


def is_staff():
    return g.profile["role"] in STAFF_ROLES
