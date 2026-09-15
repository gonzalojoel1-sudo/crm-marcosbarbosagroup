import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

site = "crm.test.local"
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

t = frappe.new_doc("Task")
t.subject = "smoke-via-orm"
t.status = "Open"
t.priority = "Medium"
t.insert(ignore_permissions=True)
print(f"INSERTED: {t.name}")
frappe.db.commit()

results = frappe.db.get_all(
    "Task", filters={"subject": ["like", "smoke%"]},
    fields=["name", "subject", "status", "priority"]
)
print(f"READ: {results}")

print(f"DOCTYPES MbCRM in DB: {len(frappe.db.get_all('DocType', filters={'module':'MbCRM'}, pluck='name'))}")
print(f"MODULE DEFS: {frappe.db.get_all('Module Def', fields=['name', 'app_name'])}")
