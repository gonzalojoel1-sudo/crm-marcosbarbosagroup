import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

for d in frappe.get_all("CRM Deal", pluck="name"):
    frappe.delete_doc("CRM Deal", d, force=True, ignore_permissions=True)
for o in frappe.get_all("CRM Organization", pluck="name"):
    frappe.delete_doc("CRM Organization", o, force=True, ignore_permissions=True)
frappe.db.commit()
print("deals:", frappe.db.count("CRM Deal"), "| orgs:", frappe.db.count("CRM Organization"))
