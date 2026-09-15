import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect(); frappe.flags.in_install_db = False
DEALS = [
    ("Constructora Del Sur","Diagnóstico",1200000,"2026-10-15","Enviar propuesta técnica","Jorge Ramírez"),
    ("Estudio Contable Pérez","Qualification",450000,"2026-11-02","Llamar para agendar","Ana Pérez"),
    ("Logística Norte","Estrategia",2800000,"2026-10-08","Reunión con socios","Diego Sosa"),
    ("Clínica San Lucas","Análisis",950000,"2026-10-22","Relevar procesos","Dra. Molina"),
    ("AgroTech SA","Implementación",3600000,"2026-09-30","Kickoff de implementación","Luis Fernández"),
    ("Hotel Costa","Won",1800000,"2026-09-20","Cerrar onboarding","María González"),
    ("Distribuidora Oeste","Lost",700000,"2026-09-18","—","Pablo Ruiz"),
]
for org,status,value,date,step,lead in DEALS:
    o = frappe.db.get_value("CRM Organization", {"organization_name": org}, "name")
    if not o:
        od=frappe.get_doc({"doctype":"CRM Organization","organization_name":org}); od.insert(ignore_permissions=True); o=od.name
    d=frappe.get_doc({"doctype":"CRM Deal","organization":o,"status":status,"deal_value":value,"currency":"USD","expected_closure_date":date,"next_step":step,"deal_owner":"Administrator","lead_name":lead})
    if status=="Lost": d.lost_reason="Competition"
    d.insert(ignore_permissions=True)
frappe.db.commit()
print("deals:", frappe.db.count("CRM Deal"))
