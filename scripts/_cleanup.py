import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# Borrar datos de demo (el CRM estaba vacío antes del seed)
for dt in ("Event", "Task"):
    for n in frappe.get_all(dt, pluck="name"):
        frappe.delete_doc(dt, n, force=True, ignore_permissions=True)
frappe.db.commit()
print("events:", frappe.db.count("Event"), "| tasks:", frappe.db.count("Task"))

u = frappe.get_doc("User", "Administrator")
u.api_key = ""
u.api_secret = ""
u.save(ignore_permissions=True)
frappe.db.commit()
print("key:", repr(u.api_key))
