import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect(); frappe.flags.in_install_db = False
o = frappe.db.get_value("CRM Organization", {"organization_name": "ZZ Negocio Prueba"}, "name")
if o:
    d = frappe.db.get_value("CRM Deal", {"organization": o}, "name")
    if d: frappe.delete_doc("CRM Deal", d, force=True, ignore_permissions=True)
    frappe.delete_doc("CRM Organization", o, force=True, ignore_permissions=True)
frappe.db.commit()
print("quedan:", [r["organization"] for r in frappe.get_all("CRM Deal", fields=["organization"])])
