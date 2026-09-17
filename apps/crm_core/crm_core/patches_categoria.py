"""La reunión gana categoría para que la agenda la muestre (gap de modelo).

El diseño de interacción pide que el nombre accesible de cada bloque sea
día + hora + título + categoría, y el prototipo pinta por categoría (las cinco
`CATS`: Trabajo, Ministerial, Personal, Consultora, Software). El `Event` de
Frappe no tiene ese concepto (`event_category` es un Link al "Event Category" de
Frappe, otra cosa), así que se agrega como Custom Field de `Event`
(`custom_crm_categoria`), el mismo mecanismo de F1/F2.

Entrada propia de patch, no `crm_core.patches`: ese patch ya quedó en `Patch Log`
en los sitios migrados y no se re-ejecuta, así que agregar el campo a su lista no
lo crearía en `crm-test`. `ensure_custom_fields()` es idempotente; correrlo de
nuevo actualiza el campo, no lo duplica.

Backfill: los `Event` que ya existen (F1/F2, importados de Google o creados antes
de esta fase) no tienen categoría. Se les pone `CATEGORIA_DEFAULT` ("Trabajo", la
reunión de trabajo genérica) para que la UI nunca reciba null. Se usa
`frappe.db.set_value` y no `doc.save()`: no corre hooks y por eso no puede
disparar el sync nativo de Google (la misma invariante que F2).

Idempotente: sólo toca los `Event` sin categoría; una segunda corrida no cambia
nada.
"""

import frappe


def backfill_categorias():
    """Pone la categoría por defecto a los `Event` sin categoría. Devuelve cuántos tocó."""
    if not frappe.get_meta("Event").get_field("custom_crm_categoria"):
        return 0
    from crm_core.api import CATEGORIA_DEFAULT

    nombres = frappe.get_all(
        "Event",
        # Sin categoría: NULL (columna nueva) o cadena vacía (Select limpiado).
        or_filters=[
            ["custom_crm_categoria", "is", "not set"],
            ["custom_crm_categoria", "=", ""],
        ],
        pluck="name",
        limit_page_length=0,
    )
    for nombre in nombres:
        frappe.db.set_value(
            "Event",
            nombre,
            "custom_crm_categoria",
            CATEGORIA_DEFAULT,
            update_modified=False,
        )
    return len(nombres)


def execute():
    """Entrada del patch (`patches.txt`): primero el campo, después el backfill."""
    from crm_core.patches import ensure_custom_fields

    ensure_custom_fields()
    n = backfill_categorias()
    print(f"[crm_core.patches_categoria] reuniones con categoría por defecto: {n}")
