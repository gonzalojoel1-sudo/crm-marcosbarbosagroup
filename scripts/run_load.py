import json, sys, os

sys.path.insert(0, "/home/frappe/frappe-bench/apps")
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core")

import frappe

site = os.environ.get("FRAPPE_SITE", "crm-test")
frappe.init(site)
frappe.connect()
frappe.flags.in_install_db = False

DD = "/home/frappe/frappe-bench/apps/crm_core/crm_core/doctype"
ORDER = ["task", "event", "contact", "account", "lead", "deal", "activity",
         "gcal_connection", "gcal_sync_state", "sync_conflict"]

loaded = 0
for name in ORDER:
    jp = f"{DD}/{name}/{name}.json"
    if not os.path.exists(jp):
        print(f"SKIP {name}"); continue
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
        print(f"FAIL {name}: {type(e).__name__}: {e}")

frappe.db.commit()
dts = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print(f"=== RESULT: loaded={loaded} / DB Doctypes count={len(dts)} ===")
for d in dts:
    print(f"  {d}")
