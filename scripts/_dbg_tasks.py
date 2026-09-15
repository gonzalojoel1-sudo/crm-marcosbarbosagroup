import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

rows = frappe.db.sql("SELECT name, subject, due_datetime, status FROM tabTask ORDER BY creation DESC LIMIT 15", as_dict=True)
for r in rows:
    print(f"{r['name']} | due={r['due_datetime']!r} | {r['status']} | {r['subject'][:40]}")
print("total:", frappe.db.count("Task"))
print("open:", frappe.db.count("Task", {"status": "Open"}))
