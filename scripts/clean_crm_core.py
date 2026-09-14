"""Clean stale crm_core DocTypes (RUN ONCE before run_load)."""
import json, os
import frappe

sites_path = "/home/frappe/frappe-bench/sites"
site = os.environ.get("FRAPPE_SITE", "crm-test")
frappe.init(site, sites_path=sites_path)
frappe.connect()
frappe.flags.in_install_db = False

dts = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print("Found:", dts)
for dt in dts:
    print(f"Deleting {dt}...")
    frappe.delete_doc("DocType", dt, force=True)
frappe.db.commit()

# Also clean Module Def
if frappe.db.exists("Module Def", "crm_core"):
    frappe.delete_doc("Module Def", "crm_core", force=True)
    print("+ Deleted Module Def crm_core")
frappe.db.commit()

# Clean cache
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")
frappe.clear_cache()
print("\n--- All crm_core DocTypes cleaned. Ready for run_load.py ---")
