import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# Borrar tareas de prueba (creadas para el screenshot)
sample = [
    "Llamar a Acme por el contrato",
    "Preparar propuesta para Barbosa Group",
    "Responder mails pendientes",
    "Revisar agenda de la semana",
    "Enviar presupuesto a cliente nuevo",
]
for s in sample:
    for n in frappe.get_all("Task", filters={"subject": s}, pluck="name"):
        frappe.delete_doc("Task", n, force=True, ignore_permissions=True)
frappe.db.commit()
print("tareas restantes:", frappe.db.count("Task"))

# Quitar API key temporal
u = frappe.get_doc("User", "Administrator")
u.api_key = ""
u.api_secret = ""
u.save(ignore_permissions=True)
frappe.db.commit()
print("api key removida:", repr(u.api_key))
