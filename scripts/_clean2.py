"""Limpieza temporal del E2E del PDF: borra los negocios/organizaciones de prueba."""
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

DEALS = ["CRM-DEAL-2026-00021", "CRM-DEAL-2026-00022"]

for d in DEALS:
    if frappe.db.exists("CRM Deal", d):
        frappe.delete_doc("CRM Deal", d, force=True, ignore_permissions=True)

for name in frappe.get_all("CRM Organization", filters={"organization_name": "Constructora Del Sur S.A."}, pluck="name"):
    if not frappe.db.exists("CRM Deal", {"organization": name}):
        frappe.delete_doc("CRM Organization", name, force=True, ignore_permissions=True)

frappe.db.commit()
print("deals:", [r["name"] for r in frappe.get_all("CRM Deal", fields=["name"])])
print("orgs:", [r["organization_name"] for r in frappe.get_all("CRM Organization", fields=["organization_name"])])
print("leads:", frappe.db.count("CRM Lead"))
