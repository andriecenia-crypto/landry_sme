"""Create in-app notifications for customers and shop staff."""
from backend.config import get_supabase

STATUS_LABELS = {
    "received": "received",
    "washing": "being washed",
    "drying": "drying",
    "ready": "ready for pickup",
    "completed": "completed",
}


def _short(order_id):
    return str(order_id)[:8].upper()


def notify_user(user_id, message):
    get_supabase().table("notifications").insert(
        {"user_id": user_id, "message": message}
    ).execute()


def notify_staff(message):
    """Send one notification to every admin and staff member."""
    sb = get_supabase()
    staff = sb.table("users").select("id").in_("role", ["admin", "staff"]).execute().data
    if staff:
        sb.table("notifications").insert(
            [{"user_id": s["id"], "message": message} for s in staff]
        ).execute()


def notify_order_created(order):
    notify_user(
        order["customer_id"],
        f"Order #{_short(order['id'])} is in. We will let you know as it moves along.",
    )
    notify_staff(f"New order #{_short(order['id'])} was placed.")


def notify_order_status(order, new_status):
    label = STATUS_LABELS.get(new_status, new_status)
    if new_status == "ready":
        text = f"Good news! Order #{_short(order['id'])} is ready for pickup."
    elif new_status == "completed":
        text = f"Order #{_short(order['id'])} is completed. Thanks for choosing us!"
    else:
        text = f"Order #{_short(order['id'])} is now {label}."
    notify_user(order["customer_id"], text)


def notify_payment(order, new_status):
    if new_status == "paid":
        notify_user(order["customer_id"], f"Payment received for order #{_short(order['id'])}. Thank you!")


def notify_low_stock(item):
    notify_staff(
        f"Low stock: {item['item_name']} is down to {item['stock_quantity']} {item['unit']} "
        f"(reorder level {item['reorder_level']})."
    )
