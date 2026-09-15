"""API de "Hoy" y "Agenda" — sobre los datos REALES del app `crm`.

El CRM ya en uso guarda:
- Reuniones/reservas en `CRM Lead.custom_meeting_datetime` (las carga el cron
  `sync-gcal-crm.py` que lee Google Calendar cada minuto).
- Tareas en `CRM Task` (title, status, priority, due_date).

Estos métodos leen/escriben esas DocTypes para que la agenda muestre el día real.
Todos requieren login.
"""

import frappe
from frappe.utils import add_days, add_to_date, getdate, nowdate

TASK_FIELDS = ["name", "title", "status", "priority", "due_date"]
MEETING_FIELDS = ["name", "first_name", "last_name", "email", "notes", "custom_meeting_datetime"]


def _day_bounds(day=None):
    day = getdate(day or nowdate())
    return f"{day} 00:00:00", f"{add_days(day, 1)} 00:00:00"


def _meeting_dto(r):
    when = r["custom_meeting_datetime"]
    # El sync guarda el título real del evento en notes:
    #   "Reunión agendada: <summary>\nCuando: ...\nEventId: ..."
    subject = ""
    notes = (r.get("notes") or "").strip()
    if notes.startswith("Reunión agendada:"):
        subject = notes.split("\n", 1)[0].replace("Reunión agendada:", "").strip()
    who = f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip().strip("-").strip()
    subject = subject or who or r.get("email") or "Reunión"
    end = add_to_date(when, hours=1)
    return {
        "name": r["name"],
        "subject": subject,
        "who": who,
        "email": r.get("email") or "",
        "starts_on": str(when),
        "ends_on": str(end),
    }


def _task_dto(r):
    return {
        "name": r["name"],
        "subject": r["title"],
        "due_datetime": str(r["due_date"]) if r.get("due_date") else None,
        "priority": r.get("priority") or "Medium",
        "status": r.get("status") or "Todo",
    }


@frappe.whitelist()
def get_hoy():
    start, end = _day_bounds()

    overdue = frappe.get_all(
        "CRM Task",
        filters=[
            ["status", "!=", "Done"],
            ["due_date", "is", "set"],
            ["due_date", "<", start],
        ],
        fields=TASK_FIELDS,
        order_by="due_date asc",
        limit_page_length=0,
    )
    tasks_today = frappe.get_all(
        "CRM Task",
        filters=[["status", "!=", "Done"]],
        or_filters=[
            ["due_date", "between", [start, end]],
            ["due_date", "is", "not set"],
        ],
        fields=TASK_FIELDS,
        order_by="due_date asc",
        limit_page_length=0,
    )
    meetings = frappe.get_all(
        "CRM Lead",
        filters=[["custom_meeting_datetime", "between", [start, end]]],
        fields=MEETING_FIELDS,
        order_by="custom_meeting_datetime asc",
        limit_page_length=0,
    )

    return {
        "today": str(getdate()),
        "overdue": [_task_dto(r) for r in overdue],
        "tasks_today": [_task_dto(r) for r in tasks_today],
        "events_today": [_meeting_dto(r) for r in meetings],
        "count": len(overdue) + len(tasks_today) + len(meetings),
    }


@frappe.whitelist()
def get_agenda(start=None, end=None):
    d0 = getdate(start) if start else getdate()
    d1 = getdate(end) if end else add_days(d0, 7)
    s = f"{d0} 00:00:00"
    e = f"{d1} 00:00:00"

    meetings = frappe.get_all(
        "CRM Lead",
        filters=[["custom_meeting_datetime", ">=", s], ["custom_meeting_datetime", "<", e]],
        fields=MEETING_FIELDS,
        order_by="custom_meeting_datetime asc",
        limit_page_length=0,
    )
    tasks = frappe.get_all(
        "CRM Task",
        filters=[
            ["status", "!=", "Done"],
            ["due_date", "is", "set"],
            ["due_date", ">=", s],
            ["due_date", "<", e],
        ],
        fields=TASK_FIELDS,
        order_by="due_date asc",
        limit_page_length=0,
    )
    return {
        "start": str(d0),
        "end": str(d1),
        "events": [_meeting_dto(r) for r in meetings],
        "tasks": [_task_dto(r) for r in tasks],
    }


@frappe.whitelist()
def quick_add_task(subject):
    subject = (subject or "").strip()
    if not subject:
        frappe.throw("La tarea no puede estar vacía")
    doc = frappe.get_doc({"doctype": "CRM Task", "title": subject, "status": "Todo", "priority": "Medium"})
    doc.insert()
    return {"name": doc.name, "subject": doc.title}


@frappe.whitelist()
def complete_task(name):
    if not frappe.has_permission("CRM Task", "write", doc=name):
        frappe.throw("Sin permiso para modificar esta tarea", frappe.PermissionError)
    frappe.db.set_value("CRM Task", name, "status", "Done")
    return {"ok": True}


@frappe.whitelist()
def create_event(subject, starts_on, ends_on=None):
    subject = (subject or "").strip()
    if not subject:
        frappe.throw("El título no puede estar vacío")
    # Una reunión en este CRM es un CRM Lead con custom_meeting_datetime.
    parts = subject.split(" ", 1)
    doc = frappe.get_doc(
        {
            "doctype": "CRM Lead",
            "first_name": parts[0],
            "last_name": parts[1] if len(parts) > 1 else "-",
            "status": "New",
            "source": "Agenda Reunión",
            "custom_meeting_datetime": starts_on,
        }
    )
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "subject": subject}


def _summary_from_notes(notes):
    notes = (notes or "").strip()
    if notes.startswith("Reunión agendada:"):
        return notes.split("\n", 1)[0].replace("Reunión agendada:", "").strip()
    return notes.split("\n", 1)[0].strip() if notes else ""


@frappe.whitelist()
def get_meeting(name):
    lead = frappe.get_doc("CRM Lead", name)
    comments = frappe.get_all(
        "Comment",
        filters={"reference_doctype": "CRM Lead", "reference_name": name, "comment_type": "Comment"},
        fields=["name", "content", "creation", "owner", "comment_by"],
        order_by="creation desc",
        limit_page_length=0,
    )
    tasks = frappe.get_all(
        "CRM Task",
        filters={"reference_doctype": "CRM Lead", "reference_docname": name},
        fields=["name", "title", "status", "priority", "due_date"],
        order_by="creation asc",
        limit_page_length=0,
    )
    who = f"{lead.first_name or ''} {lead.last_name or ''}".strip().strip("-").strip()
    return {
        "name": lead.name,
        "subject": _summary_from_notes(lead.get("notes")) or who or lead.email or "Reunión",
        "who": who,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "email": lead.get("email") or "",
        "mobile_no": lead.get("mobile_no") or "",
        "status": lead.get("status") or "",
        "source": lead.get("source") or "",
        "meeting": str(lead.custom_meeting_datetime) if lead.get("custom_meeting_datetime") else None,
        "notes": lead.get("notes") or "",
        "description": lead.get("descripcion") or "",
        "comments": [
            {"name": c.name, "content": c.content, "when": str(c.creation), "by": c.comment_by or c.owner}
            for c in comments
        ],
        "tasks": [
            {
                "name": t.name,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "due_date": str(t.due_date) if t.due_date else None,
            }
            for t in tasks
        ],
    }


@frappe.whitelist()
def add_note(name, text):
    text = (text or "").strip()
    if not text:
        frappe.throw("El comentario no puede estar vacío")
    if not frappe.has_permission("CRM Lead", "read", doc=name):
        frappe.throw("Sin permiso", frappe.PermissionError)
    c = frappe.get_doc(
        {
            "doctype": "Comment",
            "comment_type": "Comment",
            "reference_doctype": "CRM Lead",
            "reference_name": name,
            "content": text,
        }
    )
    c.insert(ignore_permissions=True)
    return {"name": c.name, "content": text, "when": str(c.creation), "by": frappe.session.user}


@frappe.whitelist()
def toggle_task(name):
    current = frappe.db.get_value("CRM Task", name, "status")
    new = "Todo" if current == "Done" else "Done"
    frappe.db.set_value("CRM Task", name, "status", new)
    return {"status": new}
