import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
names = frappe.get_all("Task", filters={"subject": ["like", "__%"]}, pluck="name")
for n in names:
    frappe.delete_doc("Task", n, force=True, ignore_permissions=True)
frappe.db.commit()
print("cleaned:", names)
