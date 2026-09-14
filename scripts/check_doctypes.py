import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core")
import frappe
sites = "/home/frappe/frappe-bench/sites"
site = os.environ.get("FRAPPE_SITE", "crm-test")
frappe.init(site, sites_path=sites)
frappe.connect()
frappe.flags.in_install_db = False
print("All DocTypes with module=crm_core:")
for dt in frappe.db.get_all("DocType", filters={"module": "crm_core"}, fields=["name", "fields"]):
    print(f"  {dt['name']} ({len(dt['fields'])} fields)")
