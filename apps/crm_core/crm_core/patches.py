"""F1 — las reuniones dejan de ser `CRM Lead` y pasan a ser `Event` de Frappe.

Cada `CRM Lead` con `custom_meeting_datetime` se migra a UN `Event` linkeado por
el Custom Field `Event.custom_crm_lead`. `custom_meeting_datetime` NO se borra ni
se modifica: queda congelado y el código viejo sigue leyendo de ahí.

Se corre con `bench migrate` (registrado en `patches.txt`). Es idempotente:
`create_custom_fields` actualiza el campo si ya existe y el backfill saltea los
leads que ya tienen un `Event` linkeado con el mismo inicio, así que re-ejecutarlo
(por ejemplo en `crm-test` después de un `bench migrate` fallido) no duplica nada.
"""

import re

import frappe
from frappe.utils import add_to_date, get_datetime

# El campo que hace que la reunión sirva al CRM. `Event` vive en el app `frappe`
# (Desk): NUNCA se re-declara el DocType, sólo se le agrega este Custom Field.
CAMPOS_PERSONALIZADOS = {
    "Event": [
        {
            "fieldname": "custom_crm_lead",
            "label": "CRM Lead",
            "fieldtype": "Link",
            "options": "CRM Lead",
            "insert_after": "event_category",
        },
    ],
}

# El fin histórico vivía como una línea "Fin: <datetime>" en `CRM Lead.notes`.
# `custom_meeting_end` (e5f6dd1) también guardaba el fin, pero queda obsoleto:
# `Event.ends_on` es la única fuente de verdad. El backfill honra la línea legacy
# para no perder duraciones reales; si no está, cae a inicio + 1 h (la duración
# que el DTO fabricaba), para no dejar reuniones de duración cero.
FIN_RE = re.compile(r"(?:^|\n)Fin:\s*([^\n]+)")


def ensure_custom_fields():
    """Crea/actualiza `Event.custom_crm_lead` de forma idempotente."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(CAMPOS_PERSONALIZADOS, ignore_validate=True)


def _fin_desde_notes(starts_on, notes):
    m = FIN_RE.search(notes or "")
    if m:
        try:
            fin = get_datetime(m.group(1).strip())
            if fin > starts_on:
                return fin
        except Exception:
            pass
    return add_to_date(starts_on, hours=1)


def _subject_del_lead(lead):
    # Reusa el mismo parseo que la API: el título real está en notes, no se
    # re-implementa. Sin título se cae al nombre del contacto, como `_meeting_dto`.
    from crm_core.api import _summary_from_notes

    who = f"{lead.get('first_name') or ''} {lead.get('last_name') or ''}".strip().strip("-").strip()
    return _summary_from_notes(lead.get("notes")) or who or lead.get("email") or "Reunión"


def backfill_events_from_meetings():
    """Crea un `Event` por cada lead con reunión. Devuelve cuántos creó.

    No commitea: el `execute()` del patch es quien cierra la transacción (y los
    tests necesitan poder hacer rollback).
    """
    from crm_core.api import insertar_evento_sin_sync

    leads = frappe.get_all(
        "CRM Lead",
        filters=[["custom_meeting_datetime", "is", "set"]],
        fields=[
            "name",
            "first_name",
            "last_name",
            "email",
            "notes",
            "custom_meeting_datetime",
        ],
        limit_page_length=0,
    )

    creados = 0
    for lead in leads:
        starts_on = get_datetime(lead["custom_meeting_datetime"])
        if frappe.db.exists("Event", {"custom_crm_lead": lead["name"], "starts_on": starts_on}):
            continue
        ends_on = _fin_desde_notes(starts_on, lead.get("notes"))
        insertar_evento_sin_sync(
            {
                "subject": _subject_del_lead(lead),
                "starts_on": starts_on,
                "ends_on": ends_on,
                "all_day": 0,
                "event_type": "Private",
                "event_category": "Meeting",
                "status": "Open",
                "custom_crm_lead": lead["name"],
            }
        )
        creados += 1

    return creados


def execute():
    """Entrada del patch (`patches.txt`): primero el campo, después el backfill."""
    ensure_custom_fields()
    creados = backfill_events_from_meetings()
    frappe.db.commit()
    print(f"[crm_core.patches] reuniones migradas a Event: {creados}")
