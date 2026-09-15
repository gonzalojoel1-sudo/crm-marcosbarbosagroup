"""Restaura el DocType `Event` a la definición canónica de Frappe (module Core).

Fue sobrescrito por el DocType custom `Event` de crm_core. Ahora crm_core ya no
define Event; este script lo devuelve a como viene en frappe/core.
"""
import os, sys, json
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

path = "/home/frappe/frappe-bench/apps/frappe/frappe/core/doctype/event/event.json"
spec = json.load(open(path))

frappe.db.sql("UPDATE `tabDocType` SET module='Core' WHERE name='Event'")
frappe.db.sql("DELETE FROM `tabDocField` WHERE parent='Event'")
frappe.db.sql("DELETE FROM `tabDocPerm` WHERE parent='Event'")
frappe.db.commit()

for i, f in enumerate(spec["fields"]):
    row = {"doctype": "DocField", "parent": "Event", "parenttype": "DocType", "parentfield": "fields", "idx": i}
    row.update(f)
    frappe.get_doc(row).insert(ignore_permissions=True)

for i, p in enumerate(spec.get("permissions", [])):
    row = {"doctype": "DocPerm", "parent": "Event", "parenttype": "DocType", "parentfield": "permissions", "idx": i}
    row.update(p)
    frappe.get_doc(row).insert(ignore_permissions=True)

frappe.db.commit()
frappe.clear_cache()
print("Event module:", frappe.db.get_value("DocType", "Event", "module"))
print("fields:", frappe.db.get_all("DocField", {"parent": "Event"}, pluck="fieldname"))
