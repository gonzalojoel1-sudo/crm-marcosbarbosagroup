import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

site = "crm-test"
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# Force local.module_app from DB
from frappe.modules.utils import scrub
frappe.local.module_app = frappe.local.module_app or {}
for row in frappe.db.get_all("Module Def", fields=["module_name", "app_name"]):
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]

t = frappe.new_doc("Task")
t.subject = "smoke-test-crm-core"
t.status = "Open"
t.priority = "Medium"
t.insert(ignore_permissions=True)
print(f"INSERTED: {t.name}")
frappe.db.commit()

results = frappe.db.get_all("Task", filters={"subject": "smoke-test-crm-core"}, fields=["name", "subject"])
print(f"READ: {results}")

frappe.db.delete("Task", t.name)
frappe.db.commit()
print("cleanup OK")
