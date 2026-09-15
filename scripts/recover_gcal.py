import os, sys, json

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe

DD = "/home/frappe/frappe-bench/apps/crm_core/crm_core/mbcrm/doctype"
site = "crm-test"
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

for name in ["gcal_connection", "gcal_sync_state"]:
    jp = f"{DD}/{name}/{name}.json"
    spec = json.load(open(jp))
    reserved = {"owner", "name", "modified", "creation", "docstatus"}
    for fld in spec.get("fields", []):
        if fld.get("fieldname") in reserved and fld.get("fieldtype") in ("Data", "Select"):
            fld["fieldname"] = "owner_user" if fld["fieldname"] == "owner" else "doc_" + fld["fieldname"]

    if frappe.db.exists("DocType", spec["name"]):
        d = frappe.get_doc("DocType", spec["name"])
        d.set("fields", [])
        for f in spec.get("fields", []):
            d.append("fields", f)
        for k in ("module", "custom", "is_virtual", "istable", "editable_grid", "allow_rename", "sort_field", "sort_order"):
            if k in spec:
                setattr(d, k, spec[k])
        d.save(ignore_permissions=True)
        print(f"UPD {spec['name']}")
    else:
        d = frappe.new_doc("DocType")
        d.update(spec)
        d.insert(ignore_permissions=True)
        print(f"INS {spec['name']}")

frappe.db.commit()
frappe.clear_cache()

dts = frappe.db.get_all("DocType", filters={"module": "MbCRM"}, pluck="name")
print(f"Module MbCRM now has {len(dts)} doctypes: {sorted(dts)}")
