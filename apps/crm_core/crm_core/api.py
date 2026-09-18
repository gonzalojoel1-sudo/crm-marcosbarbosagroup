"""API de "Hoy" y "Agenda" — sobre los datos REALES del app `crm`.

Desde F1 la reunión es un `Event` de Frappe linkeado a su contacto por el Custom
Field `Event.custom_crm_lead`. Desde F2 la agenda lee y escribe `Event`: la
duración es `Event.ends_on` (no se fabrica) y el título es `Event.subject` (no se
parsea de `notes`). `CRM Lead.custom_meeting_datetime` queda congelado. La
categoría de la reunión viaja en el DTO como `categoria` (Custom Field
`Event.custom_crm_categoria`, cinco valores fijos, default "Trabajo").
Las tareas siguen en `CRM Task` (title, status, priority, due_date).
Todos los métodos requieren login.
"""

import re

import frappe
from frappe.utils import add_days, add_to_date, cint, get_datetime, getdate, nowdate

from crm_core import billing

TASK_FIELDS = ["name", "title", "status", "priority", "due_date"]
# La reunión vive en `Event`; `custom_crm_lead` es el vínculo con el contacto y
# `custom_crm_categoria` la categoría con la que la agenda la nombra y la pinta.
EVENT_FIELDS = [
    "name",
    "subject",
    "starts_on",
    "ends_on",
    "all_day",
    "custom_crm_lead",
    "custom_crm_categoria",
    # Campo NATIVO de `Event` (Google Calendar sync): 1 si el evento se importó de
    # Google. Es la señal real del origen "Google" y de "de solo lectura".
    "pulled_from_google_calendar",
]
# Las cinco categorías de la agenda. Son una decisión de producto (la paleta y los
# filtros del prototipo), no datos del usuario: por eso el Custom Field es un
# `Select` fijo y no un Link a un DocType. Debe coincidir con las opciones del
# campo en `crm_core/patches.py` y `scripts/setup_custom_fields.py`.
CATEGORIAS = ("Trabajo", "Ministerial", "Personal", "Consultora", "Software")
# Default para `Event` sin categoría (F1/F2 y los importados de Google): la reunión
# de trabajo genérica es la más probable, así la UI nunca recibe "undefined".
CATEGORIA_DEFAULT = "Trabajo"
LEAD_FIELDS = ["name", "first_name", "last_name", "email"]

# La línea "Fin: <datetime>" que el sync legacy escribía en `CRM Lead.notes` ya no
# es fuente de duración (esa es `Event.ends_on`); sólo se oculta al mostrar el
# detalle de un lead sin `Event`.
FIN_RE = re.compile(r"(?:^|\n)Fin:[^\n]*")


def _day_bounds(day=None):
    day = getdate(day or nowdate())
    return f"{day} 00:00:00", f"{add_days(day, 1)} 00:00:00"


def _who_de(lead):
    if not lead:
        return ""
    return f"{lead.get('first_name') or ''} {lead.get('last_name') or ''}".strip().strip("-").strip()


def _lead_de(doc):
    """El `CRM Lead` linkeado a un `Event` (o None si no tiene contacto)."""
    lead = doc.get("custom_crm_lead")
    if not lead:
        return None
    return frappe.db.get_value("CRM Lead", lead, LEAD_FIELDS, as_dict=True)


def _leads_por_nombre(rows):
    """Trae en una sola consulta los leads linkeados a los `Event` de la ventana."""
    nombres = {r.get("custom_crm_lead") for r in rows if r.get("custom_crm_lead")}
    if not nombres:
        return {}
    return {
        l["name"]: l
        for l in frappe.get_all(
            "CRM Lead",
            filters={"name": ["in", list(nombres)]},
            fields=LEAD_FIELDS,
            limit_page_length=0,
        )
    }


def _categoria(valor):
    """Normaliza la categoría de una ESCRITURA: vacío -> default; inválida -> error.

    Una categoría fuera de la lista es un error del llamador, no un dato a corregir
    en silencio. (Frappe ya la rechazaría al guardar el `Select`; el chequeo acá
    da el error en español y antes de tocar el `Event`.)
    """
    cat = (valor or "").strip()
    if not cat:
        return CATEGORIA_DEFAULT
    if cat not in CATEGORIAS:
        frappe.throw(f"Categoría inválida: {cat}")
    return cat


def _categoria_del_dto(valor):
    """Normaliza la categoría de una LECTURA: vacío o desconocida -> default.

    Una lectura nunca puede tumbar la agenda entera por un valor raro en la base
    (una opción del `Select` que se sacó después): cae al default y sigue.
    """
    cat = (valor or "").strip()
    return cat if cat in CATEGORIAS else CATEGORIA_DEFAULT


def _event_dto(r, lead=None):
    """DTO de una reunión sobre `Event`.

    La duración sale de `ends_on`; sólo si un `Event` legacy lo tiene vacío se cae
    a inicio + 1 h (el fallback que el modelo viejo fabricaba siempre). `all_day`
    viaja en el DTO para que un evento de todo el día (los importa Google) no se
    dibuje como una reunión de 00:00.
    """
    starts = get_datetime(r.get("starts_on"))
    ends = get_datetime(r.get("ends_on")) if r.get("ends_on") else add_to_date(starts, hours=1)
    who = _who_de(lead)
    subject = (r.get("subject") or "").strip() or who or (lead or {}).get("email") or "Reunión"
    # El origen sale de un dato real, no se inventa: `pulled_from_google_calendar`
    # es el campo nativo de `Event` que marca lo importado de Google. Todo lo demás
    # nació en el CRM (el canal "Reserva web" no tiene campo que lo distinga hoy;
    # ver la divergencia declarada en la spec, §2/D5). Lo importado además es de
    # SOLO LECTURA: `busy` viaja para que la UI no ofrezca editar/mover.
    busy = bool(cint(r.get("pulled_from_google_calendar")))
    return {
        "name": r.get("name"),
        "subject": subject,
        "who": who,
        "email": (lead or {}).get("email") or "",
        "all_day": bool(cint(r.get("all_day"))),
        "categoria": _categoria_del_dto(r.get("custom_crm_categoria")),
        "origin": "Google" if busy else "CRM",
        "busy": busy,
        "starts_on": str(starts),
        "ends_on": str(ends),
    }


def _eventos_en_ventana(filters):
    """Lee los `Event` de la ventana y los convierte a DTO con su lead linkeado."""
    # Defensivo: si el Custom Field todavía no existe (deploy antes del `migrate`),
    # la agenda igual responde; sin el link no puede haber `who`/`email` y sin la
    # categoría el DTO cae al default.
    fields = list(EVENT_FIELDS)
    if not frappe.get_meta("Event").get_field("custom_crm_lead"):
        fields.remove("custom_crm_lead")
    if not frappe.get_meta("Event").get_field("custom_crm_categoria"):
        fields.remove("custom_crm_categoria")
    rows = frappe.get_all(
        "Event",
        filters=filters,
        fields=fields,
        order_by="starts_on asc",
        limit_page_length=0,
    )
    leads = _leads_por_nombre(rows)
    return [_event_dto(r, leads.get(r.get("custom_crm_lead"))) for r in rows]


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
    events_today = _eventos_en_ventana([["starts_on", ">=", start], ["starts_on", "<", end]])

    return {
        "today": str(getdate()),
        "overdue": [_task_dto(r) for r in overdue],
        "tasks_today": [_task_dto(r) for r in tasks_today],
        "events_today": events_today,
        "count": len(overdue) + len(tasks_today) + len(events_today),
    }


@frappe.whitelist()
def get_agenda(start=None, end=None):
    d0 = getdate(start) if start else getdate()
    d1 = getdate(end) if end else add_days(d0, 7)
    s = f"{d0} 00:00:00"
    e = f"{d1} 00:00:00"

    events = _eventos_en_ventana([["starts_on", ">=", s], ["starts_on", "<", e]])
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
        "events": events,
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
    meetings = _eventos_en_ventana([["starts_on", ">=", now], ["starts_on", "<=", horizon]])
    overdue = frappe.get_all(
        "CRM Task",
        filters=[["status", "!=", "Done"], ["due_date", "is", "set"], ["due_date", "<", now]],
        pluck="name",
        limit_page_length=0,
    )
    return {
        "meetings": meetings,
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
        ],
        order_by="modified desc",
        limit_page_length=0,
    )
    con_presupuesto = {
        d for d in frappe.get_all("CRM Presupuesto", filters={"is_current": 1}, pluck="deal") if d
    }
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
                "has_quote": r["name"] in con_presupuesto,
            }
        )
    return {"deals": deals, "stages": DEAL_STAGES, "leads": _unlinked_leads(), "verticals": _verticals()}


def _verticals():
    """Verticales activas, en el orden del sitio. Las usa el selector del presupuesto."""
    return frappe.get_all(
        "CRM Vertical",
        filters={"activo": 1},
        pluck="nombre",
        order_by="orden asc",
        limit_page_length=0,
    )


@frappe.whitelist()
def get_deal(name):
    d = frappe.get_doc("CRM Deal", name)
    owner = frappe.db.get_value("User", d.deal_owner, "full_name") if d.get("deal_owner") else None
    vigente = frappe.get_all(
        "CRM Presupuesto", filters={"deal": name, "is_current": 1}, fields=["name"], limit=1
    )
    quote = None
    if vigente:
        p = frappe.get_doc("CRM Presupuesto", vigente[0].name)
        quote = {
            "name": p.name,
            "version": p.version,
            "status": p.status,
            "currency": p.currency or "",
            "iva_mode": p.iva_mode or "sumar",
            "vertical": p.get("vertical") or "",
            "valid_until": str(p.valid_until) if p.valid_until else "",
            "conditions": p.conditions or "",
            "notes": p.notes or "",
            "recurring_summary": p.recurring_summary or "",
            "is_editable": p.status == "Borrador",
            "totals": {
                "one_time_net": p.total_one_time or 0,
                "one_time_iva": p.total_one_time_iva or 0,
                "one_time_gross": p.total_one_time_gross or 0,
                "recurring_net": p.total_recurring_monthly or 0,
                "recurring_iva": p.total_recurring_monthly_iva or 0,
                "recurring_gross": p.total_recurring_monthly_gross or 0,
                "discount": p.discount_total or 0,
            },
            "items": [
                {
                    "description": it.description,
                    "billing_type": it.billing_type,
                    "qty": it.qty,
                    "rate": it.rate,
                    "discount_percentage": it.discount_percentage,
                    "net_amount": it.net_amount,
                }
                for it in (p.items or [])
            ],
        }
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
        "quote": quote,
    }


@frappe.whitelist()
def save_quote(
    deal, items, iva_mode="sumar", valid_until=None, conditions=None, currency=None, vertical=None
):
    """Crea o actualiza el presupuesto EN BORRADOR del negocio.

    Si el vigente ya salió del borrador, NO se edita: se crea la versión siguiente.
    """
    rows = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    rows = [r for r in rows if str(r.get("description") or "").strip()]
    if not rows:
        frappe.throw("Agregá al menos un ítem al presupuesto.")

    d = frappe.get_doc("CRM Deal", deal)
    vigente = frappe.get_all(
        "CRM Presupuesto",
        filters={"deal": deal, "is_current": 1},
        fields=["name", "status"],
        limit=1,
    )

    if vigente and vigente[0].status != "Borrador":
        from crm_core.mbcrm.doctype.crm_presupuesto.crm_presupuesto import new_version

        doc = new_version(deal)
    elif vigente:
        doc = frappe.get_doc("CRM Presupuesto", vigente[0].name)
    else:
        doc = frappe.new_doc("CRM Presupuesto")
        doc.deal = deal
        doc.version = 1
        doc.is_current = 1

    doc.organization = _ensure_organization(d)
    if d.get("organization"):
        doc.currency = (
            currency
            or d.currency
            or frappe.db.get_value("CRM Organization", d.organization, "currency")
            or "ARS"
        )
    else:
        doc.currency = currency or d.currency or "ARS"
    doc.iva_mode = iva_mode or "sumar"
    # La validez que el usuario ya puso se conserva; sólo se completa si falta.
    doc.valid_until = (
        valid_until or doc.get("valid_until") or add_days(nowdate(), billing.DEFAULT_VALIDITY_DAYS)
    )
    if conditions is not None:
        doc.conditions = conditions
    # None = no cambiar; "" = limpiar (elegir "Sin asignar").
    if vertical is not None:
        doc.vertical = vertical or None

    doc.set("items", [])
    for r in rows:
        doc.append(
            "items",
            {
                "description": str(r.get("description")).strip(),
                "billing_type": r.get("billing_type") or "Único",
                "qty": r.get("qty") if r.get("qty") is not None else 1,
                "rate": r.get("rate") if r.get("rate") is not None else 0,
                "discount_percentage": r.get("discount_percentage")
                if r.get("discount_percentage") is not None
                else 0,
            },
        )
    doc.save(ignore_permissions=True)

    # El valor del negocio espeja la inversión inicial (o el abono si es sólo recurrente).
    d.reload()
    d.deal_value = doc.total_one_time_gross or doc.total_recurring_monthly_gross or None
    d.save(ignore_permissions=True)

    return {
        "name": doc.name,
        "version": doc.version,
        "status": doc.status,
        "totals": {
            "one_time_gross": doc.total_one_time_gross,
            "recurring_gross": doc.total_recurring_monthly_gross,
        },
    }


@frappe.whitelist()
def convert_lead_to_deal(lead, status=None, deal_value=None):
    """Mete un lead al embudo creando un negocio con sus datos."""
    # La agenda abre el panel con el nombre del `Event`; el negocio se crea desde
    # el contacto, así que se resuelve el lead linkeado.
    if frappe.db.exists("Event", lead):
        lead = frappe.db.get_value("Event", lead, "custom_crm_lead")
        if not lead:
            frappe.throw("La reunión no está vinculada a un contacto")
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


# ── Presupuesto: transiciones y PDF ───────────────────────────────────
def _ensure_organization(deal_doc):
    """La organización del presupuesto es REQD, pero el negocio puede no tener una.

    Se reusa la del negocio; si no tiene, se crea (o reusa) una con el mismo nombre que usa
    `create_deal`, así el presupuesto nunca queda sin organización.
    """
    if deal_doc.get("organization"):
        return deal_doc.organization
    nombre = (
        deal_doc.get("organization_name")
        or deal_doc.get("lead_name")
        or deal_doc.name
    ).strip()
    existente = frappe.db.get_value("CRM Organization", {"organization_name": nombre}, "name")
    if existente:
        return existente
    org = frappe.get_doc({"doctype": "CRM Organization", "organization_name": nombre})
    org.insert(ignore_permissions=True)
    return org.name


def _quote_or_throw(name):
    if not frappe.db.exists("CRM Presupuesto", name):
        frappe.throw("El presupuesto no existe.")
    return frappe.get_doc("CRM Presupuesto", name)


@frappe.whitelist()
def send_quote(name):
    doc = _quote_or_throw(name)
    doc.send()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def accept_quote(name):
    doc = _quote_or_throw(name)
    doc.accept()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def reject_quote(name, reason):
    doc = _quote_or_throw(name)
    doc.reject(reason)
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def new_quote_version(deal):
    from crm_core.mbcrm.doctype.crm_presupuesto.crm_presupuesto import new_version

    doc = new_version(deal)
    return {"name": doc.name, "version": doc.version}


@frappe.whitelist()
def quote_pdf(name):
    """PDF del presupuesto. `name` es el nombre del PRESUPUESTO."""
    from crm_core.documents import quote_context, render_quote_pdf

    if not frappe.db.exists("CRM Presupuesto", name):
        # Compatibilidad: si llega el negocio, resolver al presupuesto vigente.
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
def create_event(subject, starts_on, ends_on=None, lead=None, all_day=0, categoria=None):
    """Crea la reunión como `Event` (ya no como `CRM Lead`).

    Si se pasa `lead`, el `Event` queda linkeado por `custom_crm_lead`; el contacto
    no se toca. `all_day` viaja al `Event` (F4 lo necesita para crear todo-el-día);
    sin fin explícito un todo-el-día dura el día entero, no una hora. `categoria`
    es la vertical de la agenda; sin ella se usa el default (nunca queda vacía)."""
    subject = (subject or "").strip()
    if not subject:
        frappe.throw("El título no puede estar vacío")
    starts_on = get_datetime(starts_on)
    all_day = cint(all_day)
    # Sin fin explícito: 1 h (reunión) o el día entero (todo-el-día, fin exclusivo).
    if ends_on:
        ends_on = get_datetime(ends_on)
    elif all_day:
        ends_on = add_days(starts_on, 1)
    else:
        ends_on = add_to_date(starts_on, hours=1)
    if ends_on <= starts_on:
        frappe.throw("La hora de fin tiene que ser posterior a la de inicio")
    campos = {
        "subject": subject,
        "starts_on": starts_on,
        "ends_on": ends_on,
        "all_day": all_day,
        "event_type": "Private",
        "event_category": "Meeting",
        "status": "Open",
    }
    if lead and frappe.db.exists("CRM Lead", lead):
        campos["custom_crm_lead"] = lead
    # Defensivo pre-migrate: sin el campo, el DTO igual devuelve el default.
    if frappe.get_meta("Event").get_field("custom_crm_categoria"):
        campos["custom_crm_categoria"] = _categoria(categoria)
    ev = insertar_evento_sin_sync(campos)
    return {"name": ev.name, "subject": ev.subject}


def insertar_evento_sin_sync(campos):
    """Inserta un `Event` con el sync nativo de Google APAGADO.

    Los tres defectos documentados del sync nativo (research 2026-09-17,
    §4.3) sólo se disparan con `sync_with_google_calendar=1`:

    - el push de alta (`insert_event_in_google_calendar`) hace `frappe.throw`
      dentro de `Event.insert()`: si Google falla, la reunión NO se guarda;
    - el push de baja (`delete_event_from_google_calendar`) atrapa el `HttpError`
      con un `msgprint`: el CRM borra y Google se queda con el evento;
    - el guard del update no mira `pulled_from_google_calendar` y usa
      `doc.get_doc_before_save()` (puede venir `None` y romper).

    Nuestros eventos se guardan con `sync_with_google_calendar=0` y sin
    `google_calendar`: los tres hooks nativos salen por su guard, así guardar no
    puede tirar ni la reunión se pierde en silencio. El push propio (con
    reintentos y estado visible) es otra fase. El update y el delete pasan por
    `_neutralizar_sync_evento` / `_sacar_del_sync_antes_de_borrar`.
    """
    campos = dict(campos)
    campos["sync_with_google_calendar"] = 0
    campos["pulled_from_google_calendar"] = 0
    campos.pop("google_calendar", None)
    campos.pop("google_calendar_event_id", None)
    return frappe.get_doc({"doctype": "Event", **campos}).insert(ignore_permissions=True)


def _neutralizar_sync_evento(doc):
    """Deja un `Event` fuera del alcance de los hooks nativos de Google al guardar.

    Leído de `frappe/integrations/doctype/google_calendar/google_calendar.py` (v15),
    que engancha `Event` por `doc_events`:

    - `insert_event_in_google_calendar` sale si `not doc.sync_with_google_calendar`
      o `doc.pulled_from_google_calendar` o no existe el `Google Calendar` del doc;
    - `update_event_in_google_calendar` sale por el mismo `sync_with_google_calendar`,
      pero más adentro usa `doc.get_doc_before_save()` (puede venir `None`) y hace
      `frappe.throw` si Google falla: si el guard no lo frena, la edición no se guarda;
    - `delete_event_from_google_calendar` NO mira `sync_with_google_calendar`: sólo
      `exists("Google Calendar", {"name": doc.google_calendar, "push_to_google_calendar": 1})`,
      y ante un `HttpError` sólo hace `msgprint` (borra el CRM y Google conserva el evento).

    Por eso la invariante es que en NUESTRAS escrituras `google_calendar` nunca
    quede seteado: se apaga `sync_with_google_calendar` y se limpia el link al
    calendario. No se toca `pulled_from_google_calendar` (mentiría sobre el origen
    del evento) ni `google_calendar_event_id` (es el id que reconcilia el sync).
    """
    doc.sync_with_google_calendar = 0
    doc.google_calendar = None


def _sacar_del_sync_antes_de_borrar(name):
    """Garantiza que el `on_trash` nativo no dispare el delete de Google.

    `delete_event_from_google_calendar` mira `doc.google_calendar` (el Link), no
    `sync_with_google_calendar`. `frappe.delete_doc` recarga el documento, así que
    la limpieza tiene que estar en la base ANTES de borrar. `frappe.db.set_value`
    no corre hooks, así que no dispara el update nativo.
    """
    frappe.db.set_value(
        "Event",
        name,
        {"sync_with_google_calendar": 0, "google_calendar": None},
        update_modified=False,
    )


def _summary_from_notes(notes):
    notes = (notes or "").strip()
    if not notes:
        return ""
    first = notes.split("\n", 1)[0].strip()
    if first.startswith("Reunión agendada:"):
        return first.replace("Reunión agendada:", "").strip()
    return first


@frappe.whitelist()
def get_meeting(name):
    """Detalle de la reunión para el panel.

    Desde F2 `name` es el `Event` (así lo devuelve la agenda); si llega el nombre
    de un `CRM Lead` (vista Contactos) se resuelve a su `Event`. Los campos de
    contacto siguen saliendo del lead porque el panel actual opera sobre él.
    """
    evento = frappe.get_doc("Event", name) if frappe.db.exists("Event", name) else None
    lead_name = (evento.get("custom_crm_lead") if evento else None) or (name if not evento else None)
    lead = (
        frappe.get_doc("CRM Lead", lead_name)
        if lead_name and frappe.db.exists("CRM Lead", lead_name)
        else None
    )
    comments = (
        frappe.get_all(
            "Comment",
            filters={"reference_doctype": "CRM Lead", "reference_name": lead.name, "comment_type": "Comment"},
            fields=["name", "content", "creation", "owner", "comment_by"],
            order_by="creation desc",
            limit_page_length=0,
        )
        if lead
        else []
    )
    tasks = (
        frappe.get_all(
            "CRM Task",
            filters={"reference_doctype": "CRM Lead", "reference_docname": lead.name},
            fields=["name", "title", "status", "priority", "due_date"],
            order_by="creation asc",
            limit_page_length=0,
        )
        if lead
        else []
    )
    who = _who_de(lead)
    if evento:
        meeting = str(evento.starts_on)
        ends_on = str(evento.ends_on) if evento.ends_on else None
        all_day = bool(cint(evento.all_day))
        categoria = _categoria_del_dto(evento.get("custom_crm_categoria"))
        subject = (evento.subject or "").strip() or who or (lead.get("email") if lead else "") or "Reunión"
    else:
        meeting = str(lead.custom_meeting_datetime) if (lead and lead.get("custom_meeting_datetime")) else None
        ends_on = None
        all_day = False
        categoria = CATEGORIA_DEFAULT
        subject = _summary_from_notes(lead.get("notes") if lead else "") or who or "Reunión"
    return {
        "name": lead.name if lead else (evento.name if evento else name),
        "event": evento.name if evento else None,
        "subject": subject,
        "who": who,
        "first_name": lead.get("first_name") if lead else None,
        "last_name": lead.get("last_name") if lead else None,
        "email": lead.get("email") if lead else "",
        "mobile_no": lead.get("mobile_no") if lead else "",
        "organization": lead.get("organization") if lead else "",
        "status": lead.get("status") if lead else "",
        "source": lead.get("source") if lead else "",
        "meeting": meeting,
        "ends_on": ends_on,
        "all_day": all_day,
        "categoria": categoria,
        "notes": FIN_RE.sub("", lead.get("notes") or "").strip() if lead else "",
        "description": (lead.get("descripcion") if lead else "") or (evento.get("description") if evento else "") or "",
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
def update_meeting(name, starts_on, ends_on=None, categoria=None):
    """Mueve la reunión y/o le cambia la duración y la categoría. `name` es el `Event`.

    Sin fin explícito se **conserva la duración real** (`Event.ends_on`); si el
    `Event` no tiene fin (legacy), se cae a una hora. `categoria` es opcional:
    `None` = no tocarla; vacío = volver al default (nunca queda vacía)."""
    if not frappe.has_permission("Event", "write", doc=name):
        frappe.throw("Sin permiso para modificar esta reunión", frappe.PermissionError)

    starts_on = get_datetime(starts_on)
    if ends_on:
        ends_on = get_datetime(ends_on)
        if ends_on <= starts_on:
            frappe.throw("La hora de fin tiene que ser posterior a la de inicio")

    doc = frappe.get_doc("Event", name)
    if not ends_on:
        actual_ini = get_datetime(doc.starts_on)
        actual_fin = get_datetime(doc.ends_on) if doc.ends_on else add_to_date(actual_ini, hours=1)
        ends_on = add_to_date(starts_on, seconds=(actual_fin - actual_ini).total_seconds())

    doc.starts_on = starts_on
    doc.ends_on = ends_on
    if categoria is not None and frappe.get_meta("Event").get_field("custom_crm_categoria"):
        doc.custom_crm_categoria = _categoria(categoria)
    _neutralizar_sync_evento(doc)
    doc.save(ignore_permissions=True)
    return _event_dto(doc, _lead_de(doc))


@frappe.whitelist()
def delete_meeting(name):
    """Borra la reunión (`Event`). El lead (contacto/historial) NO se toca.

    Un `CRM Lead` es un contacto: borrarlo se lleva su historial y sus negocios.
    La reunión es un `Event` separado, así que borrarla no lo roza."""
    if not frappe.has_permission("Event", "delete", doc=name):
        frappe.throw("Sin permiso para eliminar esta reunión", frappe.PermissionError)

    _sacar_del_sync_antes_de_borrar(name)
    frappe.delete_doc("Event", name, ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def duplicate_meeting(name, starts_on=None):
    """Copia la reunión (`Event`) con el título "(copia)" y la misma duración.

    No crea ni toca el `CRM Lead`: las N reuniones de un contacto son N `Event`
    linkeados. La copia no comparte el id de Google (sería otro evento)."""
    if not frappe.has_permission("Event", "read", doc=name):
        frappe.throw("Sin permiso para duplicar esta reunión", frappe.PermissionError)
    if not frappe.has_permission("Event", "create"):
        frappe.throw("Sin permiso para crear reuniones", frappe.PermissionError)

    src = frappe.get_doc("Event", name)
    ini = get_datetime(src.starts_on)
    fin = get_datetime(src.ends_on) if src.ends_on else add_to_date(ini, hours=1)
    nuevo_ini = get_datetime(starts_on) if starts_on else ini
    titulo = (src.subject or "").strip() or "Reunión"

    campos = {
        "subject": f"{titulo} (copia)",
        "starts_on": nuevo_ini,
        "ends_on": add_to_date(nuevo_ini, seconds=(fin - ini).total_seconds()),
        "all_day": cint(src.all_day),
        "event_type": src.event_type or "Private",
        "event_category": src.event_category or "Meeting",
        "status": src.status or "Open",
    }
    if src.get("custom_crm_lead"):
        campos["custom_crm_lead"] = src.custom_crm_lead
    # La copia conserva la categoría (el prototipo lo exige: misma vertical).
    if frappe.get_meta("Event").get_field("custom_crm_categoria"):
        campos["custom_crm_categoria"] = _categoria(src.get("custom_crm_categoria"))
    copia = insertar_evento_sin_sync(campos)
    return _event_dto(copia, _lead_de(copia))


@frappe.whitelist()
def add_note(name, text):
    text = (text or "").strip()
    if not text:
        frappe.throw("El comentario no puede estar vacío")
    # La agenda abre el panel con el nombre del `Event`; el comentario vive en el
    # contacto, así que se resuelve el lead linkeado.
    if frappe.db.exists("Event", name):
        name = frappe.db.get_value("Event", name, "custom_crm_lead")
        if not name:
            frappe.throw("La reunión no está vinculada a un contacto")
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


# ── Facturación: facturas, transiciones y PDF ─────────────────────────
def _invoice_or_throw(name):
    if not frappe.db.exists("CRM Factura", name):
        frappe.throw("La factura no existe.")
    return frappe.get_doc("CRM Factura", name)


def _invoice_dto(f):
    return {
        "name": f.name,
        "status": f.derived_status(),
        "is_return": bool(f.is_return),
        "return_against": f.return_against or "",
        "organization": f.organization or "",
        "org": frappe.db.get_value("CRM Organization", f.organization, "organization_name") or "",
        "deal": f.deal or "",
        "vertical": f.vertical or "",
        "presupuesto": f.presupuesto or "",
        "issue_date": str(f.issue_date) if f.issue_date else "",
        "due_date": str(f.due_date) if f.due_date else "",
        "period_start": str(f.period_start) if f.period_start else "",
        "period_end": str(f.period_end) if f.period_end else "",
        "currency": f.currency or "",
        "iva_mode": f.iva_mode or "sumar",
        "subtotal": float(f.subtotal or 0),
        "discount_total": float(f.discount_total or 0),
        "iva_amount": float(f.iva_amount or 0),
        "total": float(f.total or 0),
        "credit_total": float(f.credit_total or 0),
        "paid_amount": float(f.paid_amount or 0),
        # `outstanding` derivado: el guardado es una caché (la usa SQL para filtrar).
        # Misma función pura que el recálculo, así la lectura nunca miente por una caché vieja.
        "outstanding": float(billing.outstanding_of(f.total, f.paid_amount, f.credit_total)),
        "fiscal_status": f.fiscal_status or "No aplica",
        "sin_cae": (f.fiscal_status or "No aplica") != "Emitida",
        "conditions": f.conditions or "",
        "items": [
            {
                "description": it.description,
                "billing_type": it.billing_type,
                "qty": it.qty,
                "rate": it.rate,
                "discount_percentage": it.discount_percentage,
                "net_amount": it.net_amount,
                "period_start": str(it.period_start) if it.period_start else "",
                "period_end": str(it.period_end) if it.period_end else "",
            }
            for it in (f.items or [])
        ],
        # Derivado, para que la UI no lo invente (mismo criterio que `is_editable` en F2)
        "dias_para_vencer": _dias_para_vencer(f),
        "is_editable": f.status == "Borrador",
    }


def _dias_para_vencer(f):
    """Días al vencimiento (negativo si ya venció). La UI no calcula fechas."""
    from frappe.utils import date_diff, nowdate

    if not f.due_date or f.status in ("Pagada", "Anulada"):
        return None
    return date_diff(f.due_date, nowdate())


@frappe.whitelist()
def create_invoice_from_quote(presupuesto, issue_date=None, due_date=None):
    """Emite una factura desde un presupuesto ACEPTADO. Los ítems se copian tal cual."""
    p = frappe.get_doc("CRM Presupuesto", presupuesto)
    if p.status != "Aceptado":
        frappe.throw("Sólo se puede facturar un presupuesto aceptado.")
    if frappe.db.exists("CRM Factura", {"presupuesto": presupuesto, "is_return": 0, "status": ["!=", "Anulada"]}):
        frappe.throw("Ese presupuesto ya tiene una factura vigente.")

    doc = frappe.new_doc("CRM Factura")
    doc.organization = p.organization
    doc.vertical = p.get("vertical")
    doc.deal = p.deal
    doc.presupuesto = presupuesto
    doc.currency = p.currency
    doc.iva_mode = p.iva_mode
    doc.issue_date = issue_date or None
    doc.due_date = due_date or None
    doc.conditions = p.conditions
    for it in p.items or []:
        doc.append(
            "items",
            {
                "description": it.description,
                "billing_type": it.billing_type,
                "qty": it.qty,
                "rate": it.rate,
                "discount_percentage": it.discount_percentage,
                "presupuesto_item": it.name,
            },
        )
    doc.insert(ignore_permissions=True)  # queda en Borrador
    return _invoice_dto(doc)


@frappe.whitelist()
def create_invoice(organization, items, iva_mode="sumar", currency=None, issue_date=None, due_date=None, deal=None):
    """Factura suelta, sin presupuesto (el spec lo permite y la API no lo tenía)."""
    rows = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    rows = [r for r in rows if str(r.get("description") or "").strip()]
    if not rows:
        frappe.throw("Agregá al menos un ítem a la factura.")

    doc = frappe.new_doc("CRM Factura")
    doc.organization = organization
    doc.deal = deal or None
    doc.currency = currency or frappe.db.get_value("CRM Organization", organization, "currency") or "ARS"
    doc.iva_mode = iva_mode or "sumar"
    doc.issue_date = issue_date or None
    doc.due_date = due_date or None
    for r in rows:
        doc.append(
            "items",
            {
                "description": str(r.get("description")).strip(),
                "billing_type": r.get("billing_type") or "Único",
                "qty": r.get("qty") if r.get("qty") is not None else 1,
                "rate": r.get("rate") if r.get("rate") is not None else 0,
                "discount_percentage": r.get("discount_percentage") if r.get("discount_percentage") is not None else 0,
            },
        )
    doc.insert(ignore_permissions=True)
    return _invoice_dto(doc)


@frappe.whitelist()
def issue_invoice(name):
    doc = _invoice_or_throw(name)
    doc.issue()
    return {"ok": True, "status": doc.status, "name": doc.name}


@frappe.whitelist()
def void_invoice(name):
    doc = _invoice_or_throw(name)
    doc.void()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def mark_invoice_uncollectible(name):
    doc = _invoice_or_throw(name)
    doc.mark_uncollectible()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def get_invoices(status=None, organization=None, solo_impagas=False, limit=100):
    """Lista de facturas.

    El estado se **computa en lectura** y el filtro por estado se aplica sobre el derivado,
    no sobre la columna: el estado guardado es una cache que el job diario actualiza, y
    filtrar por la cache devolveria una lista que no coincide con lo que muestra cada fila.

    `solo_impagas` también deriva el saldo en lectura y sólo cuenta **comprobantes emitidos**:
    un `Borrador` no es deuda (todavía no se emitió) y uno `Anulada` tampoco.
    """
    filtros = {"is_return": 0}
    if organization:
        filtros["organization"] = organization
    rows = frappe.get_all("CRM Factura", filters=filtros, fields=["name"],
                          order_by="issue_date desc, name desc",
                          limit_page_length=0 if status else int(limit))
    out = []
    for r in rows:
        dto = _invoice_dto(frappe.get_doc("CRM Factura", r.name))
        if status and dto["status"] != status:
            continue
        if solo_impagas and (
            dto["status"] in ("Borrador", "Anulada") or dto["outstanding"] <= 0
        ):
            continue
        out.append(dto)
        # El corte por `limit` es para el camino que filtra por estado (donde hay que traer
        # todas las filas y recortar después). Sin filtro, `limit_page_length` ya lo hizo:
        # cortar acá rompería `limit=0`, que en Frappe significa "sin límite".
        if status and len(out) >= int(limit):
            break
    return {"facturas": out}


@frappe.whitelist()
def get_invoice(name):
    return _invoice_dto(_invoice_or_throw(name))


@frappe.whitelist()
def invoice_pdf(name):
    from crm_core.documents import invoice_context, render_invoice_pdf

    doc = _invoice_or_throw(name)
    ctx = invoice_context(name)
    pdf = render_invoice_pdf(name)
    fname = f"{'Nota de credito' if doc.is_return else 'Factura'} {doc.name} - {ctx['client']['company']}.pdf"
    frappe.local.response.filename = re.sub(r'[\\/:*?"<>|]', "-", fname)
    frappe.local.response.filecontent = pdf
    frappe.local.response.type = "download"
