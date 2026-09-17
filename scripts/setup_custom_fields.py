"""Campos personalizados que este proyecto necesita en DocTypes de otros apps.

`CRM Lead` y `Event` viven en apps que este proyecto no owns, así que sus campos
se agregan como Custom Fields — el mismo mecanismo con el que ya viven
`custom_meeting_datetime`, `custom_event_id` y `custom_descripcion` en el sitio.

Hoy agrega:
- `Event.custom_crm_lead` (Link -> CRM Lead): el vínculo entre la reunión
  (`Event`) y el contacto (`CRM Lead`). Es lo que hace que una reunión sirva al
  CRM sin que la reunión *sea* el lead.

**NO** se re-declara el DocType `Event` (vive en `frappe`): sólo se le agrega el
Custom Field. Un intento previo de declarar un `Event` propio borró el de Frappe
(ver `docs/runbook-crm-core.md`).

`custom_meeting_end` (e5f6dd1) quedó **obsoleto**: `Event.ends_on` es la única
fuente de verdad de la duración. Se quita de acá para no crear un segundo camino
muerto; la columna que ya exista no se borra (Frappe nunca borra columnas).

Idempotente: `create_custom_fields` actualiza el campo si ya existe, así que se
puede correr dos veces o sobre un sitio que ya lo tenga sin duplicar ni romper.

Uso (VPS, contra crm-test; NUNCA producción sin backup y decisión explícita):

    ./env/bin/python /opt/crm-marcosbarbosagroup/scripts/setup_custom_fields.py crm-test

El sitio se pasa como argumento (default `crm-test`) para no apuntar a producción
por accidente. **El camino canónico es el patch** (`crm_core.patches`, registrado
en `patches.txt`): corre solo con `bench migrate` y hace lo mismo más el backfill.
Este script queda como respaldo manual; correrlo standalone en un contenedor falla
por el logging (`FileNotFoundError`), por eso el patch lo reemplaza.
"""
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# Debe coincidir con `CAMPOS_PERSONALIZADOS` en `crm_core/patches.py`.
CUSTOM_FIELDS = {
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

SITE_DEFAULT = "crm-test"
SITES_PATH = "/home/frappe/frappe-bench/sites"


def main(site):
    frappe.init(site, sites_path=SITES_PATH)
    frappe.connect()
    frappe.flags.in_install_db = False
    create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)
    frappe.db.commit()
    frappe.clear_cache()
    for dt, campos in CUSTOM_FIELDS.items():
        for campo in campos:
            nombre = frappe.db.get_value(
                "Custom Field", {"dt": dt, "fieldname": campo["fieldname"]}, "name"
            )
            print(f"{dt}.{campo['fieldname']} -> {nombre} ({campo['fieldtype']})")
    frappe.destroy()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else SITE_DEFAULT)
