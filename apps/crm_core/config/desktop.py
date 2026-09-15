"""Frappe Desk integration (administrativo, NO se usa como cara de usuario)."""
from frappe import _

def get_data():
    return [
        {
            "module_name": "crm_core",
            "color": "indigo",
            "icon": "octicon octicon-briefcase",
            "type": "module",
            "label": _("MB CRM Core"),
        }
    ]
