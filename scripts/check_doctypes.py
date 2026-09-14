import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core")
import frappe

sites = "/home/frappe/frappe-bench/sites"
site = os.environ.get("FRAPPE_SITE", "crm-test")
frappe.init(site, sites_path=sites)
frappe.connect()
frappe.flags.in_install_db = False

result = []
for name in frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name"):
    if frappe.db.exists("DocType", name):
        d = frappe.get_doc("DocType", name)
        result.append(name + ":" + str(len(d.fields)))
print("MODULE crm_core:", ",".join(result) if result else "(none)")
