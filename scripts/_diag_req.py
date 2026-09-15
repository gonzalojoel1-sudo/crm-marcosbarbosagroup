import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

for dt in ("CRM Task", "CRM Lead"):
    print(f"=== {dt} campos requeridos ===")
    for r in frappe.db.sql(
        "SELECT fieldname, fieldtype, options, reqd FROM `tabDocField` WHERE parent=%s AND reqd=1",
        dt, as_dict=True,
    ):
        print("  ", r)
    print("  status options:", frappe.get_meta(dt).get_field("status").options if frappe.get_meta(dt).get_field("status") else "-")
    print("  priority options:", frappe.get_meta(dt).get_field("priority").options if frappe.get_meta(dt).get_field("priority") else "-")
