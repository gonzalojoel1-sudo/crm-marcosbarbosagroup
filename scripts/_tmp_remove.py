import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

user = frappe.get_doc("User", "Administrator")
user.api_key = ""
user.api_secret = ""
user.save(ignore_permissions=True)
frappe.db.commit()
print("KEY REMOVED")
