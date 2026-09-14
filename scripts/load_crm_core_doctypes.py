"""Load crm_core DocTypes.

Uso: bench --site crm-test execute scripts/load_crm_core_doctypes.py
       (bench execute puede ejecutar .py externos)
"""
import json, sys
from pathlib import Path

DD = Path("/home/frappe/frappe-bench/apps/crm_core/crm_core/doctype")
ORDER = ["task", "event", "contact", "account", "lead", "deal", "activity",
         "gcal_connection", "gcal_sync_state", "sync_conflict"]

import frappe
frappe.flags.in_install_db = False

loaded, failed = 0, []
for name in ORDER:
    jp = DD / name / f"{name}.json"
    if not jp.exists():
        continue
    spec = json.loads(jp.read_text())
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
        print(f"FAIL {name}: {e}")

frappe.db.commit()

dts = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print()
print(f"=== RESULT: {loaded} loaded, {len(failed)} failed; DB has {len(dts)} DocTypes with module=crm_core ===")
for d in dts:
    print(f"  - {d}")
