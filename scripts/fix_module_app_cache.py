import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
site = os.environ.get("FRAPPE_SITE", "crm.test.local")
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# Reset cache and local.module_app to the Frappe defaults
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")

# Use the real Module Def from DB (now that crm_core says "Core")
from frappe.modules.utils import scrub
frappe.local.module_app = frappe.local.module_app or {}
md_list = frappe.db.get_all("Module Def", fields=["module_name", "app_name"])
for row in md_list:
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]

# Explicit: remove any leftover 'crm_core' or 'core'→crm_core mapping
frappe.local.module_app.pop("crm_core", None)
frappe.local.module_app["core"] = "frappe"

frappe.cache.set_value("app_modules", frappe.local.module_app)
print("module_app (forced):", dict(frappe.local.module_app))
