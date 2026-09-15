import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

user = frappe.get_doc("User", "Administrator")
secret = frappe.generate_hash(length=15)
user.api_key = frappe.generate_hash(length=15)
user.api_secret = secret
user.save(ignore_permissions=True)
frappe.db.commit()
print("KEY=" + user.api_key)
print("SECRET=" + secret)
