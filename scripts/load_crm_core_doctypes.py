"""Load crm_core DocTypes via Frappe controller layer.

Run via:  docker exec ... bench --site crm-test execute "$(cat /home/frappe/load.py)"
        OR docker exec ... python3 -m this_file.py
"""
import os
import json

apps = "/home/frappe/frappe-bench/apps"
dd = f"{apps}/crm_core/crm_core/doctype"

import frappe
frappe.connect()
frappe.flags.in_install_db = False

# Module Def
if not frappe.db.exists("Module Def", "crm_core"):
    m = frappe.new_doc("Module Def")
    m.module_name = "crm_core"
    m.app_name = "crm_core"
    m.insert(ignore_permissions=True)
    print("+ Module Def crm_core")

# DocTypes — load each one
order = ["task", "event", "contact", "account", "lead", "deal", "activity",
         "gcal_connection", "gcal_sync_state", "sync_conflict"]
results = {}
for name in order:
    json_path = f"{dd}/{name}/{name}.json"
    if not os.path.exists(json_path):
        print(f"  skip {name}: file not found at {json_path}")
        continue
    spec = json.load(open(json_path))
    try:
        if frappe.db.exists("DocType", spec["name"]):
            d = frappe.get_doc("DocType", spec["name"])
            for k in ("module", "title", "custom", "is_virtual", "istable",
                     "editable_grid", "track_changes", "allow_rename",
                     "sort_field", "sort_order", "image_field"):
                if k in spec:
                    setattr(d, k, spec[k])
            d.set("fields", [])
            for f in spec.get("fields", []):
                d.append("fields", f)
            d.set("permissions", [])
            for p in spec.get("permissions", []):
                d.append("permissions", p)
            d.save(ignore_permissions=True)
            print(f"  UPDATE {spec['name']}")
        else:
            d = frappe.new_doc("DocType")
            d.update(spec)
            d.insert(ignore_permissions=True)
            print(f"  INSERT {spec['name']}")
        results[spec["name"]] = "ok"
    except Exception as e:
        print(f"  FAIL {name}: {type(e).__name__}: {e}")
        results[spec["name"]] = str(e)

frappe.db.commit()

print()
print("=== SUMMARY ===")
doctypes = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print(f"DocTypes in DB with module=crm_core: {len(doctypes)}")
for dt in doctypes:
    print(f"  - {dt}")

# Make site_cache reload for next requests
frappe.clear_cache()
print("Cache cleared")
