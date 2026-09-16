"""API de "Hoy" y "Agenda" — sobre los datos REALES del app `crm`.

El CRM ya en uso guarda:
- Reuniones/reservas en `CRM Lead.custom_meeting_datetime` (las carga el cron
  `sync-gcal-crm.py` que lee Google Calendar cada minuto).
- Tareas en `CRM Task` (title, status, priority, due_date).

Estos métodos leen/escriben esas DocTypes para que la agenda muestre el día real.
Todos requieren login.
"""

import re

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
def get_leads(query=None):
    """Lista de contactos/leads (CRM Lead) con búsqueda por nombre/email/tel."""
    q = (query or "").strip()
    or_filters = None
    if q:
        like = f"%{q}%"
        or_filters = [
            ["first_name", "like", like],
            ["last_name", "like", like],
            ["email", "like", like],
            ["mobile_no", "like", like],
            ["organization", "like", like],
        ]
    rows = frappe.get_all(
        "CRM Lead",
        filters=[["status", "!=", ""]],
        or_filters=or_filters,
        fields=[
            "name",
            "first_name",
            "last_name",
            "email",
            "mobile_no",
            "organization",
            "source",
            "status",
            "custom_meeting_datetime",
        ],
        order_by="modified desc",
        limit_page_length=200,
    )
    return {"leads": [_lead_dto(r) for r in rows]}


def _lead_dto(r):
    who = f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip().strip("-").strip()
    return {
        "name": r["name"],
        "who": who or r.get("email") or r.get("mobile_no") or "(sin nombre)",
        "email": r.get("email") or "",
        "mobile_no": r.get("mobile_no") or "",
        "organization": r.get("organization") or "",
        "source": r.get("source") or "",
        "status": r.get("status") or "",
        "meeting": str(r["custom_meeting_datetime"]) if r.get("custom_meeting_datetime") else None,
    }


@frappe.whitelist()
def create_lead(first_name=None, last_name=None, email=None, mobile_no=None, organization=None, source=None, notes=None):
    """Crea un CRM Lead. Dedupe por email (si existe, devuelve el existente)."""
    first_name = (first_name or "").strip()
    last_name = (last_name or "").strip()
    email = (email or "").strip()
    if not first_name and not email:
        frappe.throw("Poné al menos un nombre o un email")

    if email:
        existing = frappe.db.get_value("CRM Lead", {"email": email}, "name")
        if existing:
            return {"name": existing, "existing": True}

    if not (source and frappe.db.exists("CRM Lead Source", source)):
        source = "Reference"

    doc = frappe.get_doc(
        {
            "doctype": "CRM Lead",
            "first_name": first_name or email.split("@")[0],
            "last_name": last_name or "-",
            "email": email or None,
            "mobile_no": (mobile_no or "").strip() or None,
            "organization": (organization or "").strip() or None,
            "source": source,
            "status": "New",
            "notes": (notes or "").strip() or None,
        }
    )
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "existing": False}


@frappe.whitelist()
def add_task(title, reference_name=None, due_date=None):
    """Crea un CRM Task. Si reference_name (un CRM Lead) se vincula a ese contacto."""
    title = (title or "").strip()
    if not title:
        frappe.throw("La tarea no puede estar vacía")
    doc = frappe.get_doc(
        {
            "doctype": "CRM Task",
            "title": title,
            "status": "Todo",
            "priority": "Medium",
            "reference_doctype": "CRM Lead" if reference_name else None,
            "reference_docname": reference_name or None,
            "due_date": due_date or None,
        }
    )
    doc.insert()
    return {"name": doc.name, "title": doc.title, "status": doc.status}


DEAL_STAGES = [
    "Qualification",
    "Diagnóstico",
    "Análisis",
    "Estrategia",
    "Implementación",
    "Seguimiento",
    "Escalamiento",
    "Won",
    "Lost",
]


@frappe.whitelist()
def get_reminders():
    """Reuniones próximas (ventana de 3 h) + pendientes vencidos. Para avisos in-app."""
    from frappe.utils import add_to_date, now_datetime

    now = now_datetime()
    horizon = add_to_date(now, minutes=180)
    rows = frappe.get_all(
        "CRM Lead",
        filters=[["custom_meeting_datetime", ">=", now], ["custom_meeting_datetime", "<=", horizon]],
        fields=MEETING_FIELDS,
        order_by="custom_meeting_datetime asc",
        limit_page_length=0,
    )
    overdue = frappe.get_all(
        "CRM Task",
        filters=[["status", "!=", "Done"], ["due_date", "is", "set"], ["due_date", "<", now]],
        pluck="name",
        limit_page_length=0,
    )
    return {
        "meetings": [_meeting_dto(r) for r in rows],
        "overdue": len(overdue),
        "now": str(now),
    }


def _lead_dto(r):
    who = f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip().strip("-").strip()
    return {
        "name": r["name"],
        "who": who or r.get("email") or "Contacto",
        "email": r.get("email") or "",
        "mobile_no": r.get("mobile_no") or "",
        "organization": r.get("organization") or "",
        "source": r.get("source") or "",
        "status": r.get("status") or "",
        "meeting": str(r["custom_meeting_datetime"]) if r.get("custom_meeting_datetime") else None,
    }


def _unlinked_leads():
    """Leads que todavía no están en el embudo (no tienen negocio asociado)."""
    linked = {
        r[0]
        for r in frappe.get_all("CRM Deal", filters={"lead": ["is", "set"]}, fields=["lead"], as_list=True)
        if r[0]
    }
    rows = frappe.get_all(
        "CRM Lead",
        fields=[
            "name",
            "first_name",
            "last_name",
            "email",
            "mobile_no",
            "organization",
            "source",
            "status",
            "custom_meeting_datetime",
        ],
        order_by="modified desc",
        limit_page_length=0,
    )
    return [_lead_dto(r) for r in rows if r["name"] not in linked]


@frappe.whitelist()
def get_deals():
    rows = frappe.get_all(
        "CRM Deal",
        fields=[
            "name",
            "organization",
            "organization_name",
            "lead",
            "lead_name",
            "first_name",
            "last_name",
            "status",
            "deal_owner",
            "deal_value",
            "expected_deal_value",
            "currency",
            "expected_closure_date",
            "next_step",
            "probability",
            "contact",
            "total",
        ],
        order_by="modified desc",
        limit_page_length=0,
    )
    deals = []
    for r in rows:
        title = (
            r.get("organization")
            or r.get("lead_name")
            or f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip()
            or r["name"]
        )
        contact = r.get("contact") or ""
        if not contact and r.get("lead_name"):
            contact = r.get("lead_name")
        owner = frappe.db.get_value("User", r["deal_owner"], "full_name") if r.get("deal_owner") else None
        value = r.get("deal_value") or r.get("expected_deal_value")
        deals.append(
            {
                "name": r["name"],
                "title": title,
                "status": r.get("status") or "Qualification",
                "org": r.get("organization_name") or "",
                "contact": contact,
                "owner": owner or "",
                "value": float(value) if value else None,
                "currency": r.get("currency") or "",
                "date": str(r["expected_closure_date"]) if r.get("expected_closure_date") else None,
                "next_step": r.get("next_step") or "",
                "probability": r.get("probability"),
                "lead": r.get("lead") or "",
                "has_quote": bool(r.get("total")),
            }
        )
    return {"deals": deals, "stages": DEAL_STAGES, "leads": _unlinked_leads()}


@frappe.whitelist()
def get_deal(name):
    d = frappe.get_doc("CRM Deal", name)
    owner = frappe.db.get_value("User", d.deal_owner, "full_name") if d.get("deal_owner") else None
    items = [
        {
            "description": p.product_name or "",
            "qty": p.qty or 0,
            "rate": p.rate or 0,
            "discount_percentage": p.discount_percentage or 0,
            "amount": p.amount or 0,
            "net_amount": p.net_amount or 0,
        }
        for p in (d.get("products") or [])
    ]
    return {
        "name": d.name,
        "title": d.organization or d.lead_name or d.name,
        "org": d.organization or "",
        "contact": d.get("lead_name") or "",
        "value": float(d.deal_value) if d.get("deal_value") else None,
        "currency": d.currency or "",
        "date": str(d.expected_closure_date) if d.get("expected_closure_date") else "",
        "next_step": d.get("next_step") or "",
        "probability": d.probability,
        "status": d.get("status") or "",
        "owner": owner or "",
        "lead": d.get("lead") or "",
        "items": items,
        "total": float(d.total) if d.get("total") else 0,
        "quote_no": _quote_number(d.name),
    }


@frappe.whitelist()
def save_quote(name, items):
    """Guarda el presupuesto del negocio: ítems + total (deal_value/total/net_total)."""
    rows = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    d = frappe.get_doc("CRM Deal", name)
    d.set("products", [])
    total = 0.0
    for it in rows:
        desc = str(it.get("description") or it.get("product_name") or "").strip()
        if not desc:
            continue
        qty = float(it.get("qty") or 0)
        rate = float(it.get("rate") or 0)
        disc = float(it.get("discount_percentage") or 0)
        amount = qty * rate
        net = amount * (1 - (disc / 100.0))
        d.append(
            "products",
            {
                "product_name": desc,
                "qty": qty,
                "rate": rate,
                "discount_percentage": disc,
                "amount": amount,
                "net_amount": net,
            },
        )
        total += net
    d.deal_value = total or None
    d.total = total
    d.net_total = total
    d.save(ignore_permissions=True)
    return {"ok": True, "total": total, "count": len(d.get("products") or [])}


@frappe.whitelist()
def convert_lead_to_deal(lead, status=None, deal_value=None):
    """Mete un lead al embudo creando un negocio con sus datos."""
    l = frappe.get_doc("CRM Lead", lead)
    who = f"{l.first_name or ''} {l.last_name or ''}".strip().strip("-").strip()
    who = who or l.get("email") or "Contacto"
    org_name = (l.get("organization") or who).strip()
    org = frappe.db.get_value("CRM Organization", {"organization_name": org_name}, "name")
    if not org:
        o = frappe.get_doc({"doctype": "CRM Organization", "organization_name": org_name})
        o.insert(ignore_permissions=True)
        org = o.name
    status = status if (status and frappe.db.exists("CRM Deal Status", status)) else "Qualification"
    src = l.get("source") if (l.get("source") and frappe.db.exists("CRM Lead Source", l.get("source"))) else None
    doc = frappe.get_doc(
        {
            "doctype": "CRM Deal",
            "organization": org,
            "status": status,
            "lead": l.name,
            "lead_name": who,
            "source": src,
            "deal_value": float(deal_value) if (deal_value not in (None, "")) else None,
        }
    )
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "title": org_name, "status": status}


# ── Presupuesto en PDF ────────────────────────────────────────────────
def _quote_number(name):
    m = re.search(r"(\d+)$", name or "")
    return f"P-{m.group(1)}" if m else (name or "S/N")


@frappe.whitelist()
def quote_pdf(name):
    """Puente: resuelve negocio -> presupuesto vigente y delega el render a documents."""
    from crm_core.documents import quote_context, render_quote_pdf

    if not frappe.db.exists("CRM Presupuesto", name):
        name = frappe.db.get_value("CRM Presupuesto", {"deal": name, "is_current": 1}, "name")
    if not name:
        frappe.throw("El negocio no tiene un presupuesto cargado.")
    ctx = quote_context(name)
    pdf = render_quote_pdf(name)
    fname = f"Presupuesto {ctx['quote_no']} - {ctx['client']['company']}.pdf"
    frappe.local.response.filename = re.sub(r'[\\/:*?"<>|]', "-", fname)
    frappe.local.response.filecontent = pdf
    frappe.local.response.type = "download"


@frappe.whitelist()
def update_deal(
    name,
    contact=None,
    deal_value=None,
    expected_closure_date=None,
    next_step=None,
    probability=None,
    status=None,
):
    d = frappe.get_doc("CRM Deal", name)
    if contact is not None:
        d.lead_name = contact.strip() or None
    if deal_value is not None:
        d.deal_value = float(deal_value) if str(deal_value).strip() != "" else None
    if expected_closure_date is not None:
        d.expected_closure_date = expected_closure_date or None
    if next_step is not None:
        d.next_step = next_step.strip() or None
    if probability is not None:
        d.probability = float(probability) if str(probability).strip() != "" else None
    if status and frappe.db.exists("CRM Deal Status", status):
        d.status = status
    d.save(ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def delete_deal(name):
    frappe.delete_doc("CRM Deal", name, force=True, ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def move_deal(name, status):
    if not frappe.db.exists("CRM Deal Status", status):
        frappe.throw("Etapa inválida")
    frappe.db.set_value("CRM Deal", name, "status", status)
    return {"ok": True}


@frappe.whitelist()
def create_deal(
    title,
    status=None,
    contact=None,
    deal_value=None,
    expected_closure_date=None,
    next_step=None,
    lead=None,
):
    title = (title or "").strip()
    if not title:
        frappe.throw("Poné un nombre")
    org = frappe.db.get_value("CRM Organization", {"organization_name": title}, "name")
    if not org:
        o = frappe.get_doc({"doctype": "CRM Organization", "organization_name": title})
        o.insert(ignore_permissions=True)
        org = o.name
    status = status if (status and frappe.db.exists("CRM Deal Status", status)) else "Qualification"
    doc = frappe.get_doc(
        {
            "doctype": "CRM Deal",
            "organization": org,
            "status": status,
            "lead": lead if (lead and frappe.db.exists("CRM Lead", lead)) else None,
            "lead_name": (contact or "").strip() or None,
            "deal_value": float(deal_value) if (deal_value not in (None, "")) else None,
            "expected_closure_date": expected_closure_date or None,
            "next_step": (next_step or "").strip() or None,
        }
    )
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "title": title, "status": status}


@frappe.whitelist()
def update_lead(name, email=None, mobile_no=None, organization=None, status=None, first_name=None, last_name=None):
    """Actualiza campos de un CRM Lead. Solo escribe los que vienen (no None)."""
    doc = frappe.get_doc("CRM Lead", name)
    if first_name is not None:
        doc.first_name = first_name.strip() or doc.first_name
    if last_name is not None:
        doc.last_name = last_name.strip() or "-"
    if email is not None:
        doc.email = email.strip() or None
    if mobile_no is not None:
        doc.mobile_no = mobile_no.strip() or None
    if organization is not None:
        doc.organization = organization.strip() or None
    if status and frappe.db.exists("CRM Lead Status", status):
        doc.status = status
    doc.save(ignore_permissions=True)
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
        "organization": lead.get("organization") or "",
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
