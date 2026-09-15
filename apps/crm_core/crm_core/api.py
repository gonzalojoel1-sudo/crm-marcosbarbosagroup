"""API de la página "Hoy" (Nivel 1).

Tres métodos, todos requieren sesión (login):

- get_hoy()         -> datos del día (tareas vencidas, de hoy, eventos)
- quick_add_task()  -> crea una tarea rápida para el usuario actual
- complete_task()   -> marca una tarea como hecha

DocTypes: `Task` (custom, limpio) y `Event` (el de Frappe).
"""

import frappe
from frappe.utils import getdate, add_days, nowdate

TASK_FIELDS = ["name", "subject", "due_datetime", "priority"]


def _day_bounds(day=None):
    """Devuelve [hoy 00:00, mañana 00:00) como strings, en la tz del sitio."""
    day = getdate(day or nowdate())
    return f"{day} 00:00:00", f"{add_days(day, 1)} 00:00:00"


@frappe.whitelist()
def get_hoy():
    start, end = _day_bounds()

    overdue = frappe.get_all(
        "Task",
        filters={"status": "Open", "due_datetime": ["<", start]},
        fields=TASK_FIELDS,
        order_by="due_datetime asc",
        limit_page_length=0,
    )
    tasks_today = frappe.get_all(
        "Task",
        filters={"status": "Open", "due_datetime": ["between", [start, end]]},
        fields=TASK_FIELDS,
        order_by="due_datetime asc",
        limit_page_length=0,
    )
    events_today = frappe.get_all(
        "Event",
        filters={"starts_on": ["between", [start, end]], "status": ["!=", "Cancelled"]},
        fields=["name", "subject", "starts_on", "ends_on"],
        order_by="starts_on asc",
        limit_page_length=0,
    )

    return {
        "today": str(getdate()),
        "overdue": overdue,
        "tasks_today": tasks_today,
        "events_today": events_today,
        "count": len(overdue) + len(tasks_today),
    }


@frappe.whitelist()
def quick_add_task(subject):
    subject = (subject or "").strip()
    if not subject:
        frappe.throw("La tarea no puede estar vacía")
    doc = frappe.get_doc(
        {
            "doctype": "Task",
            "subject": subject,
            "status": "Open",
            "owner": frappe.session.user,
        }
    )
    doc.insert()
    return {"name": doc.name, "subject": doc.subject}


@frappe.whitelist()
def complete_task(name):
    if not frappe.has_permission("Task", "write", doc=name):
        frappe.throw("Sin permiso para modificar esta tarea", frappe.PermissionError)
    frappe.db.set_value("Task", name, "status", "Done")
    return {"ok": True}
