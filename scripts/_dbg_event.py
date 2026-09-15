import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

m = frappe.db.get_value("DocType", "Event", ["module", "custom"], as_dict=True)
print("Event doctype:", m)
fields = frappe.db.get_all("DocField", filters={"parent": "Event"}, pluck="fieldname", order_by="idx")
print(f"fields ({len(fields)}):", fields)
