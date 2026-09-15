import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

orgs = [
    "Constructora Del Sur",
    "Estudio Contable Pérez",
    "Logística Norte",
    "Clínica San Lucas",
    "AgroTech SA",
]
for d in frappe.get_all("CRM Deal", pluck="name"):
    frappe.delete_doc("CRM Deal", d, force=True, ignore_permissions=True)
for o in orgs:
    n = frappe.db.get_value("CRM Organization", {"organization_name": o}, "name")
    if n:
        frappe.delete_doc("CRM Organization", n, force=True, ignore_permissions=True)
frappe.db.commit()
print("deals:", frappe.db.count("CRM Deal"), "| orgs test restantes:", frappe.db.count("CRM Organization", {"organization_name": ["in", orgs]}))
