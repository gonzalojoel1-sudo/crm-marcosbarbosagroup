import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

site = "crm.marcosbarbosagroup.com"
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# Force module map from DB (same pattern as the successful crm-test run)
from frappe.modules.utils import scrub
frappe.local.module_app = frappe.local.module_app or {}
for row in frappe.db.get_all("Module Def", fields=["module_name", "app_name"]):
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]

print("=== CRUD test on PROD (creates + deletes, no residue) ===")
t = frappe.new_doc("Task")
t.subject = "crm_core smoke test (auto-deletes)"
t.status = "Open"
t.priority = "Medium"
t.insert(ignore_permissions=True)
print(f"INSERTED: {t.name}")

read = frappe.db.get_value("Task", t.name, ["subject", "status"], as_dict=True)
print(f"READ:     {read}")

frappe.db.delete("Task", t.name)
frappe.db.commit()
print(f"DELETED:  {t.name}")

remaining = frappe.db.count("Task")
print(f"Task rows remaining: {remaining}")
print("=== CRUD OK ===")
