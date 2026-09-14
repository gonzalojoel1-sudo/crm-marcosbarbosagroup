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

# 1. Module Def (commit immediately so subsequent inserts see it)
print(f"=== STARTING load_crm_core for {site} ===")

if not frappe.db.exists("Module Def", "crm_core"):
    m = frappe.new_doc("Module Def")
    m.module_name = "crm_core"
    m.app_name = "crm_core"
    m.insert(ignore_permissions=True)
    frappe.db.commit()
    print("+ Module Def crm_core created & committed")
else:
    print("Module Def crm_core already exists")

# Clean caches
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")
frappe.clear_cache()

# Rebuild local.module_app including crm_core explicitly
from frappe.modules.utils import scrub
md_list = frappe.db.get_all("Module Def", fields=["module_name", "app_name"])
frappe.local.module_app = frappe.local.module_app or {}
for row in md_list:
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]
if "crm_core" not in frappe.local.module_app:
    frappe.local.module_app["crm_core"] = "crm_core"
print(f"local.module_app has 'crm_core': {('crm_core' in frappe.local.module_app)}")

# 2. Bulk delete existing crm_core DocTypes (in reverse dep order)
# NOTE: Module Def is NOT deleted — it's preserved (we'll re-create if missing).
print("--- cleanup ---")
frappe.db.sql("DELETE FROM `tabDocField` WHERE parent IN "
              "(SELECT name FROM `tabDocType` WHERE module='crm_core')")
frappe.db.sql("DELETE FROM `tabDocPerm` WHERE parent IN "
              "(SELECT name FROM `tabDocType` WHERE module='crm_core')")
frappe.db.sql("DELETE FROM `tabDocType` WHERE module = 'crm_core'")
frappe.db.commit()
print("cleared all tabDocType rows with module=crm_core (Module Def preserved)")

# Re-ensure Module Def exists (in case deletion cascaded)
if not frappe.db.exists("Module Def", "crm_core"):
    m = frappe.new_doc("Module Def")
    m.module_name = "crm_core"
    m.app_name = "crm_core"
    m.insert(ignore_permissions=True)
    frappe.db.commit()
    print("+ Module Def crm_core re-created")

# Force local.module_app crm_core presence after deletion
frappe.local.module_app["crm_core"] = "crm_core"

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
    # Force existence check (bypass local.cache)
    rows = frappe.db.sql("SELECT name FROM tabDocType WHERE name=%s", (name,))
    print(f"  [DEBUG {name}] rows={rows} type={type(rows).__name__}", flush=True)
    exists_in_db = bool(rows) and len(rows) > 0
    print(f"  [DEBUG {name}] exists_in_db={exists_in_db}", flush=True)

    if exists_in_db:
        print(f"  +skip {name} (already in DB)")
        loaded += 1
        continue
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
