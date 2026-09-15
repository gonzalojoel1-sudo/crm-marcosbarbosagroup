"""API de "Hoy" y "Agenda" (Nivel 1).

Métodos (todos requieren login):

- get_hoy()                    -> datos del día (vencidas, hoy, eventos)
- get_agenda(start, end)       -> eventos + tareas en un rango (para la agenda)
- quick_add_task(subject)      -> crea una tarea rápida
- complete_task(name)          -> marca una tarea como hecha
- create_event(subject, s, e)  -> crea un evento (para la agenda)

DocTypes: `Task` (custom) y `Event` (el de Frappe).
"""

import frappe
from frappe.utils import add_days, getdate, nowdate

TASK_FIELDS = ["name", "subject", "due_datetime", "priority"]
EVENT_FIELDS = ["name", "subject", "starts_on", "ends_on"]


def _day_bounds(day=None):
    day = getdate(day or nowdate())
    return f"{day} 00:00:00", f"{add_days(day, 1)} 00:00:00"


@frappe.whitelist()
def get_hoy():
    start, end = _day_bounds()

    overdue = frappe.get_all(
        "Task",
        filters=[
            ["status", "=", "Open"],
            ["due_datetime", "is", "set"],
            ["due_datetime", "<", start],
        ],
        fields=TASK_FIELDS,
        order_by="due_datetime asc",
        limit_page_length=0,
    )
    tasks_today = frappe.get_all(
        "Task",
        filters={"status": "Open"},
        or_filters=[
            ["due_datetime", "between", [start, end]],
            ["due_datetime", "is", "not set"],
        ],
        fields=TASK_FIELDS,
        order_by="due_datetime asc",
        limit_page_length=0,
    )
    events_today = frappe.get_all(
        "Event",
        filters={"starts_on": ["between", [start, end]], "status": ["!=", "Cancelled"]},
        fields=EVENT_FIELDS,
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
def get_agenda(start=None, end=None):
    """Eventos y tareas (con hora) en [start, end). Fechas ISO 'YYYY-MM-DD'."""
    d0 = getdate(start) if start else getdate()
    d1 = getdate(end) if end else add_days(d0, 7)
    s = f"{d0} 00:00:00"
    e = f"{d1} 00:00:00"

    events = frappe.get_all(
        "Event",
        filters=[
            ["starts_on", ">=", s],
            ["starts_on", "<", e],
            ["status", "!=", "Cancelled"],
        ],
        fields=EVENT_FIELDS,
        order_by="starts_on asc",
        limit_page_length=0,
    )
    tasks = frappe.get_all(
        "Task",
        filters=[
            ["status", "=", "Open"],
            ["due_datetime", "is", "set"],
            ["due_datetime", ">=", s],
            ["due_datetime", "<", e],
        ],
        fields=TASK_FIELDS,
        order_by="due_datetime asc",
        limit_page_length=0,
    )
    return {"start": str(d0), "end": str(d1), "events": events, "tasks": tasks}


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


@frappe.whitelist()
def create_event(subject, starts_on, ends_on=None, description=None):
    subject = (subject or "").strip()
    if not subject:
        frappe.throw("El título no puede estar vacío")
    doc = frappe.get_doc(
        {
            "doctype": "Event",
            "subject": subject,
            "title": subject,
            "starts_on": starts_on,
            "ends_on": ends_on or starts_on,
            "event_type": "Private",
        }
    )
    doc.insert()
    return {"name": doc.name, "subject": doc.subject}
