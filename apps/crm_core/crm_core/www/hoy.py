import frappe

from crm_core.api import get_hoy

no_cache = 1


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login"
        raise frappe.Redirect

    data = get_hoy()
    context.title = "Hoy"
    context.data = data
    context.count = data["count"]
    context.csrf = frappe.sessions.get_csrf_token()
