import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

print("installed_apps:", frappe.get_installed_apps())
try:
    print("import crm:", __import__("crm").__file__)
except Exception as e:
    print("import crm FAIL:", e)
try:
    p = frappe.get_app_path("crm")
    print("crm app path:", p)
    print("www/crm.html exists:", os.path.exists(os.path.join(p, "www", "crm.html")))
except Exception as e:
    print("get_app_path FAIL:", e)

j = frappe.get_jloader()
sp = getattr(j, "searchpath", None) or getattr(j, "paths", None)
print("jloader searchpath:", sp)
