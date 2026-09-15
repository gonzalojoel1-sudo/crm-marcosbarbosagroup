import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
site = os.environ.get("FRAPPE_SITE", "crm.test.local")
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
# Rename module_def from crm_core → Core
frappe.db.sql("UPDATE tabModule_Def SET module_name='Core' WHERE name='crm_core'")
frappe.db.commit()
print("Renamed OK")
print("Modules:")
for r in frappe.db.sql("SELECT name, module_name, app_name FROM tabModule_Def", as_dict=True):
    print(r)
print("module_app (current):", dict(frappe.local.module_app))
