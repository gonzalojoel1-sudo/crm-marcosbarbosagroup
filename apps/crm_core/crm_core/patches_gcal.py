"""S1 — modelo de estado de sync con Google Calendar (Custom Fields de `Event`).

Agrega los campos de la spec §4 (`custom_gcal_*`, `custom_sync_origin`,
`custom_last_synced_*`, `custom_dirty`, `custom_content_hash`, `custom_tombstone`)
y los de estado visible (`custom_sync_estado`/`custom_sync_error`/
`custom_sync_intentos`, por si el sitio no los tenía). Nunca re-declara el DocType
`Event` (vive en `frappe`; un intento previo de declararlo lo borró, ver
`docs/runbook-crm-core.md`).

Entrada propia de patch (`patches.txt`), no `crm_core.patches`: ese patch ya quedó
en `Patch Log` en los sitios migrados y no se re-ejecuta, así que agregar los
campos a su lista no los crearía. `ensure_custom_fields()` es idempotente.

Backfill: a los `Event` que ya existían se les pone estado (los que tienen id de
Google quedan "Sincronizada"; el resto "No aplica") para que la UI no reciba
vacío. No se marca `custom_dirty`: los eventos históricos NO entran a la cola de
push (evita empujar reuniones viejas de golpe). `frappe.db.set_value` no corre
hooks, así que no dispara el sync nativo.
"""

import frappe

from crm_core.google_sync import ESTADO_NO_APLICA, ESTADO_SINCRONIZADA


def backfill_estados_sync():
    """Estado inicial para los `Event` sin `custom_sync_estado`. Devuelve cuántos tocó."""
    if not frappe.get_meta("Event").get_field("custom_sync_estado"):
        return 0
    filas = frappe.get_all(
        "Event",
        or_filters=[
            ["custom_sync_estado", "is", "not set"],
            ["custom_sync_estado", "=", ""],
        ],
        fields=["name", "google_calendar_event_id"],
        limit_page_length=0,
    )
    for fila in filas:
        estado = (
            ESTADO_SINCRONIZADA
            if (fila.get("google_calendar_event_id") or "").strip()
            else ESTADO_NO_APLICA
        )
        frappe.db.set_value(
            "Event", fila["name"], "custom_sync_estado", estado, update_modified=False
        )
    return len(filas)


def execute():
    """Entrada del patch (`patches.txt`): primero los campos, después el backfill."""
    from crm_core.patches import ensure_custom_fields

    ensure_custom_fields()
    n = backfill_estados_sync()
    print(f"[crm_core.patches_gcal] eventos con estado de sync inicial: {n}")
