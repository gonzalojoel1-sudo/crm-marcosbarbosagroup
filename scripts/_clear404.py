import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

print("cached 404 for /hoy:", frappe.cache.hget("website_404", "/hoy"))
frappe.cache.hdel("website_404", "/hoy")
print("after delete:", frappe.cache.hget("website_404", "/hoy"))

# Also clear the whole website_404 hash to be safe
try:
    frappe.cache.delete_value("website_404")
    print("website_404 hash deleted")
except Exception as e:
    print("delete_value:", e)
