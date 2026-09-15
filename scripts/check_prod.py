import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

print("installed_apps:", frappe.get_installed_apps())
print("MbCRM doctypes on prod:", frappe.db.sql("SELECT name FROM tabDocType WHERE module='MbCRM'"))
