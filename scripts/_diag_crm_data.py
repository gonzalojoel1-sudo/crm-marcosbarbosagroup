import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

for dt in ("CRM Task", "CRM Lead"):
    print(f"=== {dt} : columnas ===")
    cols = [c[0] for c in frappe.db.sql(f"SHOW COLUMNS FROM `tab{dt}`")]
    print(" ", cols)

print("\n=== CRM Task (data) ===")
for r in frappe.db.sql("SELECT * FROM `tabCRM Task` LIMIT 10", as_dict=True):
    keep = {k: v for k, v in r.items() if k in ("name", "title", "description", "status", "priority", "due_date", "start_date", "task_owner", "reference_doctype", "reference_docname")}
    print("  ", keep)

print("\n=== CRM Lead (data relevante) ===")
for r in frappe.db.sql("SELECT name, first_name, last_name, email, mobile_no, status, source, custom_meeting_datetime FROM `tabCRM Lead`", as_dict=True):
    print("  ", r)
