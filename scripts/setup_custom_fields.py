"""Campos personalizados que este proyecto necesita en DocTypes de otros apps.

`CRM Lead` vive en el app `crm` (que este proyecto no owns), así que sus campos
se agregan como Custom Fields — el mismo mecanismo con el que ya viven
`custom_meeting_datetime`, `custom_event_id` y `custom_descripcion` en el sitio.

Hoy agrega:
- `custom_meeting_end` (Datetime) en `CRM Lead`: el fin REAL de la reunión. Antes
  la agenda fabricaba inicio + 1 h (`api.py`) y un parche guardaba "Fin:" en
  `notes`. Este campo es la fuente única del fin.

Idempotente: `create_custom_fields` actualiza el campo si ya existe, así que se
puede correr dos veces o sobre un sitio que ya lo tenga sin duplicar ni romper.

Uso (VPS, contra crm-test; NUNCA producción sin backup y decisión explícita):

    ./env/bin/python /opt/crm-marcosbarbosagroup/scripts/setup_custom_fields.py crm-test

El sitio se pasa como argumento (default `crm-test`) para no apuntar a producción
por accidente. Después de correrlo en el sitio real, `bench migrate` no es
necesario: el Custom Field es un registro del sitio, no un DocType de la app.
"""
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

CUSTOM_FIELDS = {
    "CRM Lead": [
        {
            "fieldname": "custom_meeting_end",
            "label": "Fin de la reunión",
            "fieldtype": "Datetime",
            "insert_after": "custom_meeting_datetime",
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
