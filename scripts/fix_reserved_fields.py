"""Pre-process crm_core DocType JSONs in-container to rename reserved fieldnames.

Run once. Idempotent (skips files already processed).
"""
import os, json, re

DD = "/home/frappe/frappe-bench/apps/crm_core/crm_core/doctype"
# Only 'owner' is reserved in DocType-context; 'name', 'creation', 'modified',
# 'docstatus' etc are doc data fields managed by Frappe core.
# We rename ONLY 'owner' because that one triggers LinkValidationError.
RESERVED = {"owner"}

for fname in sorted(os.listdir(DD)):
    sub = os.path.join(DD, fname)
    if not os.path.isdir(sub):
        continue
    json_files = [f for f in os.listdir(sub) if f.endswith(".json")]
    for jf in json_files:
        p = os.path.join(sub, jf)
        with open(p) as f:
            content = f.read()
        data = json.loads(content)
        changed = False
        for fld in data.get("fields", []):
            fn = fld.get("fieldname")
            if fn in RESERVED and fld.get("fieldtype") not in ("Read Only Field",):
                new_fn = "owner_user" if fn == "owner" else f"app_{fn}"
                print(f"  {fname}.{fn} -> {new_fn}")
                fld["fieldname"] = new_fn
                changed = True
        if changed:
            with open(p, "w") as f:
                json.dump(data, f, indent=2)

print("\n=== done ===")
