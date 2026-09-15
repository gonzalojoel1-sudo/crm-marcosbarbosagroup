import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

moves = {
    "Constructora Del Sur": "Estrategia",
    "Estudio Contable Pérez": "Diagnóstico",
    "Logística Norte": "Won",
    "Clínica San Lucas": "Análisis",
}
for org, status in moves.items():
    name = frappe.db.get_value("CRM Deal", {"organization": org}, "name")
    # organization es el name del CRM Organization; el deal linkea ahí
    if not name:
        continue
    frappe.db.set_value("CRM Deal", name, "status", status)
frappe.db.commit()

for d in frappe.get_all("CRM Deal", fields=["name", "organization", "status"]):
    print(d["organization"], "->", d["status"])
