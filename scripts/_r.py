import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
u = frappe.get_doc("User", "Administrator")
u.api_key = ""
u.api_secret = ""
u.save(ignore_permissions=True)
frappe.db.commit()
print("REMOVED")
