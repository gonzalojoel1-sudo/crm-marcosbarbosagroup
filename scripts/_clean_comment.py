import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
for n in frappe.get_all("Comment", filters={"content": ["like", "__test comment %"]}, pluck="name"):
    frappe.delete_doc("Comment", n, force=True, ignore_permissions=True)
frappe.db.commit()
print("comentarios de prueba restantes:", frappe.db.count("Comment", {"content": ["like", "__test comment %"]}))
