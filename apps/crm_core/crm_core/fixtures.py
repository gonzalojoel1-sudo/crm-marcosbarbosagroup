"""Datos base de crm_core. Idempotente: se puede correr muchas veces."""

import frappe

# Las 7 verticales de marcosbarbosagroup.com, en el orden del sitio.
VERTICALES = [
    ("Consultora Estratégica", "#fe4100", 1),
    ("Cuerpo de Cristo", "#8b5cf6", 2),
    ("Servicios", "#06b6d4", 3),
    ("Software y Aplicaciones", "#3b82f6", 4),
    ("Legendarios", "#f59e0b", 5),
    ("Los 1000 Socios", "#22c55e", 6),
    ("Formate con Nosotros", "#ec4899", 7),
]


def seed_verticales():
    for nombre, color, orden in VERTICALES:
        if frappe.db.exists("CRM Vertical", nombre):
            continue
        frappe.get_doc(
            {
                "doctype": "CRM Vertical",
                "nombre": nombre,
                "color": color,
                "orden": orden,
                "activo": 1,
            }
        ).insert(ignore_permissions=True)
    frappe.db.commit()
