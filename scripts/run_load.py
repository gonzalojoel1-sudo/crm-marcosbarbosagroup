"""Load crm_core DocTypes.

Uso: cd /home/frappe/frappe-bench && FRAPPE_SITE=crm-test ./env/bin/python3 ./run_load.py
"""
import json, sys, os

sys.path.insert(0, "/home/frappe/frappe-bench/apps")
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core")

import frappe

sites_path = "/home/frappe/frappe-bench/sites"
site = os.environ.get("FRAPPE_SITE", "crm-test")

site_config = os.path.join(sites_path, site, "site_config.json")
if not os.path.exists(site_config):
    print(f"FATAL: {site_config} not found")
    raise SystemExit(1)

frappe.init(site, sites_path=sites_path)
frappe.connect()
frappe.flags.in_install_db = False

# 1. Create Module Def for crm_core
print("=== creating Module Def ===")
if not frappe.db.exists("Module Def", "crm_core"):
    m = frappe.new_doc("Module Def")
    m.module_name = "crm_core"
    m.app_name = "crm_core"
    m.insert(ignore_permissions=True)
    print("+ Module Def crm_core created")
else:
    print("Module Def crm_core already exists")
frappe.db.commit()

# 2. Clear caches that may be stale
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")
frappe.clear_cache()

# 3. Now rebuild local.module_app
from frappe.modules.utils import scrub
md_list = frappe.db.get_all("Module Def", fields=["module_name", "app_name"])
frappe.local.module_app = frappe.local.module_app or {}
for row in md_list:
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]
frappe.local.module_app["crm_core"] = "crm_core"
print(f"local.module_app has 'crm_core':", "crm_core" in frappe.local.module_app)

# 4. Load each DocType
DD = "/home/frappe/frappe-bench/apps/crm_core/crm_core/doctype"
ORDER = ["task", "event", "contact", "account", "lead", "deal", "activity",
         "gcal_connection", "gcal_sync_state", "sync_conflict"]

loaded, failed = 0, []
for name in ORDER:
    jp = f"{DD}/{name}/{name}.json"
    if not os.path.exists(jp):
        print(f"SKIP {name}")
        continue
    spec = json.load(open(jp))
    try:
        if frappe.db.exists("DocType", spec["name"]):
            d = frappe.get_doc("DocType", spec["name"])
            d.set("fields", [])
            for f in spec.get("fields", []):
                d.append("fields", f)
            d.set("permissions", [])
            for p in spec.get("permissions", []):
                d.append("permissions", p)
            for k in ("module", "title", "custom", "is_virtual", "istable",
                     "editable_grid", "track_changes", "allow_rename",
                     "sort_field", "sort_order", "image_field"):
                if k in spec:
                    setattr(d, k, spec[k])
            d.save(ignore_permissions=True)
        else:
            d = frappe.new_doc("DocType")
            d.update(spec)
            d.insert(ignore_permissions=True)
        loaded += 1
        print(f"OK {spec['name']}")
    except Exception as e:
        failed.append((name, str(e)[:150]))
        print(f"FAIL {name}: {type(e).__name__}: {str(e)[:120]}")

frappe.db.commit()

dts = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print()
print(f"=== RESULT: loaded={loaded}, failed={len(failed)}, DB Doctypes count={len(dts)} ===")
for d in dts:
    print(f"  {d}")
