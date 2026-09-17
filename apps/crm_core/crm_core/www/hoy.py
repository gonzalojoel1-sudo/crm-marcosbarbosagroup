import frappe
from frappe.sessions import get_csrf_token

no_cache = 1


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login"
        raise frappe.Redirect

    # El bundle inline del shell contiene ".__" y Frappe rechaza esos templates
    # por defecto ("Illegal template", frappe/utils/jinja.py:94). El guard se
    # apaga sólo por esta clave del context: es el único lugar que Frappe lee
    # (page_renderers/template_page.py:231), no el nivel módulo del .py.
    context.safe_render = False
    context.title = "Hoy"
    context.csrf = get_csrf_token()
