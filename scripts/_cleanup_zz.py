import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# contacto de prueba
for n in frappe.get_all("CRM Lead", filters={"email": "zztest@example.com"}, pluck="name"):
    frappe.delete_doc("CRM Lead", n, force=True, ignore_permissions=True)
# tareas de prueba
for n in frappe.get_all("CRM Task", filters={"title": ["like", "ZZ%"]}, pluck="name"):
    frappe.delete_doc("CRM Task", n, force=True, ignore_permissions=True)
frappe.db.commit()
print("leads:", frappe.db.count("CRM Lead"), "| tasks:", frappe.db.count("CRM Task"))

u = frappe.get_doc("User", "Administrator")
u.api_key = ""
u.api_secret = ""
u.save(ignore_permissions=True)
frappe.db.commit()
print("api_key:", repr(u.api_key))
