"""Load ALL crm_core DocTypes in one self-contained script.

Idempotent by design: deletes existing crm_core DocTypes, recreates them all.

Usage: docker exec -e FRAPPE_SITE=crm-test backend bash -lc "..."
"""
import os, sys, json

DD = "/home/frappe/frappe-bench/apps/crm_core/crm_core/doctype"

# Order matters: child tables first, then standalone, then cross-refs.
ORDER = [
    "event_attendee",
    "contact_email",
    "contact_phone",
    "task",
    "event",
    "account",
    "gcal_connection",
    "gcal_sync_state",
    "sync_conflict",
    "contact",
    "lead",
    "deal",
    "activity",
]

sys.path.insert(0, "/home/frappe/frappe-bench/apps")
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core")

import frappe

sites = "/home/frappe/frappe-bench/sites"
site = os.environ.get("FRAPPE_SITE", "crm-test")
frappe.init(site, sites_path=sites)
frappe.connect()
frappe.flags.in_install_db = False

print(f"=== STARTING load_crm_core for {site} ===")

# 1. Module Def
if not frappe.db.exists("Module Def", "crm_core"):
    m = frappe.new_doc("Module Def")
    m.module_name = "crm_core"
    m.app_name = "crm_core"
    m.insert(ignore_permissions=True)
    print("+ Module Def crm_core")

# Clean caches
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")

# 2. Bulk delete existing crm_core DocTypes (in reverse dep order)
print("--- cleanup ---")
deleted_count = 0
for name in reversed(ORDER):
    if not frappe.db.exists("DocType", name):
        print(f"  (skip clean {name}: not exists)")
        continue
    try:
        # Mark bypassing on_update, on_trash, etc
        frappe.flags.in_install_db = False
        frappe.db.delete("DocType", name)
        deleted_count += 1
        print(f"  -raw-del {name}")
    except Exception as e:
        print(f"  WARN: raw-del {name}: {e}")
print(f"raw-deleted {deleted_count} DocTypes")

# Also delete Module Def to reset
if frappe.db.exists("Module Def", "crm_core"):
    frappe.db.delete("Module Def", "crm_core")
    print("- Module Def crm_core")

frappe.db.commit()

# 3. Build module_app manually
from frappe.modules.utils import scrub
md_list = frappe.db.get_all("Module Def", fields=["module_name", "app_name"])
frappe.local.module_app = frappe.local.module_app or {}
for row in md_list:
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]
frappe.local.module_app["crm_core"] = "crm_core"

# 4. Load each DocType in order
print("--- load ---")
loaded, failed = 0, []
for name in ORDER:
    jp = f"{DD}/{name}/{name}.json"
    if not os.path.exists(jp):
        print(f"SKIP {name}")
        continue
    spec = json.load(open(jp))
    # Sanitize reserved fieldnames
    reserved = {"owner", "name", "modified", "creation", "docstatus"}
    for fld in spec.get("fields", []):
        if fld.get("fieldname") in reserved and fld.get("fieldtype") in ("Data", "Select"):
            fld["fieldname"] = "owner_user" if fld["fieldname"] == "owner" else "doc_" + fld["fieldname"]
    try:
        d = frappe.new_doc("DocType")
        d.update(spec)
        d.insert(ignore_permissions=True)
        loaded += 1
        print(f"  +ins {name}")
    except Exception as e:
        failed.append((name, str(e)[:150]))
        print(f"  FAIL {name}: {type(e).__name__}: {str(e)[:120]}")

frappe.db.commit()
frappe.clear_cache()

# 5. Final verification
print("=== RESULT ===")
dts = []
for name in ORDER:
    if frappe.db.exists("DocType", name):
        d = frappe.get_doc("DocType", name)
        dts.append(f"{name}({len(d.fields)})")
print(f"loaded={loaded} failed={len(failed)} | DB: {','.join(dts)}")
