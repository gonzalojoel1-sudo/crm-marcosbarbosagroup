import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect(); frappe.flags.in_install_db = False
for n in frappe.get_all("CRM Lead", filters={"email": "zzreunion@example.com"}, pluck="name"):
    frappe.delete_doc("CRM Lead", n, force=True, ignore_permissions=True)
frappe.db.commit()
print("leads:", frappe.db.count("CRM Lead"))
