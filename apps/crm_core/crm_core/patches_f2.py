"""F2 — reconcilia el id de Google legacy con el `Event` de la reunión.

El backfill de F1 creó un `Event` por cada reunión-lead, pero NO copió
`CRM Lead.custom_event_id` (el id del evento en Google que guardó el cron
`sync-gcal-crm.py`) a `Event.google_calendar_event_id`. Sin ese id, un push propio
futuro insertaría un evento NUEVO en Google en vez de actualizar el que ya existe:
el calendario del usuario terminaría duplicado. Esta reconciliación, idempotente y
por lead, cierra ese agujero. Sólo escribe el id del evento; no setea
`google_calendar` (el link que dispara los hooks nativos del sync).

Se corre con `bench migrate` (registrado en `patches.txt` como entrada propia: el
patch de F1 ya quedó en `Patch Log` y no se re-ejecuta, así que la reconciliación
necesita su propio registro para llegar a los sitios ya migrados).
"""

import frappe


def reconcile_google_event_ids():
    """Copia `custom_event_id` al `Event` de su lead. Devuelve cuántos tocó.

    Sólo actúa cuando el lead tiene exactamente UNA reunión: con varias no se sabe
    a cuál pertenece el id legacy y copiarlo sería adivinar. Es idempotente: saltea
    los `Event` que ya tienen id.
    """
    # `custom_event_id` es un campo legacy que puede no existir en un sitio nuevo
    # (p. ej. crm-test): sin la columna, no hay nada que reconciliar.
    if not frappe.get_meta("CRM Lead").get_field("custom_event_id"):
        return 0

    leads = frappe.get_all(
        "CRM Lead",
        filters=[["custom_event_id", "is", "set"]],
        fields=["name", "custom_event_id"],
        limit_page_length=0,
    )

    reconciliados = 0
    for lead in leads:
        eventos = frappe.get_all(
            "Event",
            filters={"custom_crm_lead": lead["name"]},
            fields=["name", "google_calendar_event_id"],
            limit_page_length=0,
        )
        if len(eventos) != 1:
            continue
        evento = eventos[0]
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
