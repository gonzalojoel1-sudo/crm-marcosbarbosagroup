"""F2 — reconcilia el id de Google legacy con el `Event` de la reunión.

El backfill de F1 creó un `Event` por cada reunión-lead, pero NO copió
`CRM Lead.custom_event_id` (el id del evento en Google que guardó el cron
`sync-gcal-crm.py`) a `Event.google_calendar_event_id`. Sin ese id, un push propio
futuro insertaría un evento NUEVO en Google en vez de actualizar el que ya existe:
el calendario del usuario terminaría duplicado. Esta reconciliación, idempotente,
cierra ese agujero. Sólo escribe el id del evento; no setea `google_calendar` (el
link que dispara los hooks nativos del sync).

Se corre con `bench migrate` (registrado en `patches.txt` como entrada propia: el
patch de F1 ya quedó en `Patch Log` y no se re-ejecuta, así que la reconciliación
necesita su propio registro para llegar a los sitios ya migrados).
"""

import frappe
from frappe.utils import get_datetime


def _evento_objetivo(lead, eventos):
    """Elige el `Event` que corresponde al id de Google legacy del lead.

    D1 permite N reuniones por contacto, así que el heurístico de "una sola
    reunión" no alcanza:

    1. Se busca el `Event` cuyo `starts_on` coincide con `custom_meeting_datetime`
       (el datetime congelado que el cron guardó al crear el lead): ésa es la
       reunión que el id de Google identifica.
    2. Si no hay coincidencia exacta, se cae al heurístico de una sola reunión (el
       `Event` se movió después del backfill y no hay con qué desambiguar).
    3. Con varias reuniones y sin coincidencia, devuelve `None`: no se adivina.

    Si VARIOS `Event` comparten el mismo `starts_on`, devuelve el de nombre menor:
    el id legacy es uno solo y la elección tiene que ser estable (idempotente).
    """
    inicio = lead.get("custom_meeting_datetime")
    if inicio:
        objetivo = get_datetime(inicio)
        coinciden = [
            e for e in eventos if e.get("starts_on") and get_datetime(e["starts_on"]) == objetivo
        ]
        if coinciden:
            return sorted(coinciden, key=lambda e: e.get("name") or "")[0]
    if len(eventos) == 1:
        return eventos[0]
    return None


def reconcile_google_event_ids():
    """Copia `custom_event_id` al `Event` de su lead. Devuelve cuántos tocó.

    Idempotente: saltea los `Event` que ya tienen id. Elige el `Event` por el
    inicio congelado del lead (`_evento_objetivo`), así funciona también cuando el
    contacto tiene varias reuniones.
    """
    meta = frappe.get_meta("CRM Lead")
    # `custom_event_id` es un campo legacy que puede no existir en un sitio nuevo
    # (p. ej. crm-test): sin la columna, no hay nada que reconciliar.
    if not meta.get_field("custom_event_id"):
        return 0

    campos = ["name", "custom_event_id"]
    if meta.get_field("custom_meeting_datetime"):
        campos.append("custom_meeting_datetime")

    leads = frappe.get_all(
        "CRM Lead",
        filters=[["custom_event_id", "is", "set"]],
        fields=campos,
        limit_page_length=0,
    )

    reconciliados = 0
    for lead in leads:
        eventos = frappe.get_all(
            "Event",
            filters={"custom_crm_lead": lead["name"]},
            fields=["name", "starts_on", "google_calendar_event_id"],
            limit_page_length=0,
        )
        evento = _evento_objetivo(lead, eventos)
        if not evento:
            continue
        if (evento.get("google_calendar_event_id") or "").strip():
            continue
        frappe.db.set_value(
            "Event",
            evento["name"],
            "google_calendar_event_id",
            lead["custom_event_id"],
            update_modified=False,
        )
        reconciliados += 1
    return reconciliados


def execute():
    """Entrada del patch (`patches.txt`)."""
    n = reconcile_google_event_ids()
    print(f"[crm_core.patches_f2] ids de Google reconciliados: {n}")
