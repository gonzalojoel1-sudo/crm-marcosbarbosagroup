import os, sys, inspect
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

print("installed_apps:", frappe.get_installed_apps())

j = frappe.get_jloader()
print("jloader type:", type(j))
try:
    print("jloader file:", inspect.getsourcefile(type(j)))
    print("---- source ----")
    print(inspect.getsource(type(j))[:2000])
except Exception as e:
    print("ERR source:", e)

# Try resolving the template
try:
    src = j.get_source(frappe.get_jenv(), "www/crm.html")[0]
    print("RESOLVED OK, len:", len(src))
except Exception as e:
    print("RESOLVE FAIL:", type(e).__name__, e)
