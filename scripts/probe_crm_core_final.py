import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

site = "crm-test"
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# List all installed doctypes for crm_core
dts = frappe.db.get_all("DocType", filters={"module": "MbCRM"}, pluck="name")
print(f"Module MbCRM ({len(dts)}):", sorted(dts))

# Count total Task
tasks = frappe.db.count("Task")
print(f"Task count in DB: {tasks}")

# Insert a test Task
t = frappe.new_doc("Task")
t.subject = "smoke-test-crm-core"
t.status = "Open"
t.priority = "Medium"
t.insert(ignore_permissions=True)
print(f"INSERTED: {t.name}")

frappe.db.commit()

results = frappe.db.get_all("Task", filters={"subject": "smoke-test-crm-core"}, fields=["name", "subject", "status"])
print(f"READ: {results}")

# Cleanup
frappe.db.delete("Task", t.name)
frappe.db.commit()
print("cleanup OK")
