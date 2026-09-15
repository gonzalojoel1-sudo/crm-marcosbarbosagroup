"""Seed de datos de demo: eventos y tareas con hora para la semana actual."""
import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
from frappe.utils import getdate, add_days

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
frappe.set_user("Administrator")

today = getdate()
monday = add_days(today, -today.weekday())

EVENTS = [
    ("Reunión con cliente Acme", 0, "09:30", "10:30"),
    ("Standup equipo", 0, "08:30", "09:00"),
    ("Demo producto", 1, "15:00", "16:00"),
    ("Llamada Barbosa Group", 1, "11:00", "11:45"),
    ("Revisión semanal", 2, "11:00", "12:00"),
    ("Almuerzo con cliente", 2, "13:00", "14:30"),
    ("Onboarding nuevo cliente", 3, "10:00", "11:30"),
    ("Cierre de mes", 4, "16:00", "17:00"),
    ("Planificación próxima semana", 4, "09:00", "10:00"),
]

for subj, d, s, e in EVENTS:
    day = add_days(monday, d)
    doc = frappe.get_doc({
        "doctype": "Event",
        "subject": subj,
        "starts_on": f"{day} {s}:00",
        "ends_on": f"{day} {e}:00",
        "event_type": "Private",
    })
    doc.insert(ignore_permissions=True)

TASKS = [
    ("Enviar contrato firmado", 0, "12:00"),
    ("Preparar propuesta", 1, "17:00"),
    ("Responder mails pendientes", 2, "09:30"),
    ("Revisar métricas", 3, "15:30"),
    ("Cerrar pendientes del mes", 4, "18:00"),
]
for subj, d, t in TASKS:
    day = add_days(monday, d)
    doc = frappe.get_doc({
        "doctype": "Task",
        "subject": subj,
        "status": "Open",
        "due_datetime": f"{day} {t}:00",
    })
    doc.insert(ignore_permissions=True)

frappe.db.commit()
print("events:", frappe.db.count("Event"), "| tasks:", frappe.db.count("Task"))
