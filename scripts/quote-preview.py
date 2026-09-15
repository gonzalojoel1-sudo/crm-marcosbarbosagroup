"""Preview local del presupuesto: renderiza la plantilla con datos de ejemplo.
Uso: python3 scripts/quote-preview.py  ->  /tmp/quote-preview.html
"""
import base64
import os
import re

import jinja2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "apps", "crm_core", "crm_core", "templates", "quote.html")
FONT = os.path.join(ROOT, "apps", "crm_core", "crm_core", "templates", "fonts", "outfit-latin.woff2")


def money(v, symbol="", dec=2):
    n = f"{v:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{symbol} {n}" if symbol else n


items_raw = [
    ("Diagnóstico 360° del negocio y plan de acción trimestral", 1, 850000, 0),
    ("Tablero de control mensual (hasta 12 indicadores)", 3, 145000, 10),
    ("Acompañamiento y ejecución semanal", 4, 210000, 15),
    ("Capacitación al equipo comercial (jornada completa)", 2, 320000, 5),
]

rows, subtotal, discount = [], 0.0, 0.0
for desc, qty, rate, disc in items_raw:
    gross = qty * rate
    net = gross * (1 - disc / 100)
    subtotal += net
    discount += gross - net
    rows.append(
        {
            "description": desc,
            "qty_fmt": f"{qty:g}",
            "rate_fmt": money(rate),
            "discount_fmt": f"{disc:g}%" if disc else "—",
            "net_fmt": money(net),
        }
    )

iva = subtotal * 0.21
ctx = {
    "font_b64": base64.b64encode(open(FONT, "rb").read()).decode(),
    "company": {
        "city": "Córdoba, Argentina",
        "phone": "+54 9 351 733 4040",
        "email": "consultora.marcosbarbosa@gmail.com",
        "web": "marcosbarbosagroup.com",
        "cuit": "—",
        "address": "—",
    },
    "quote_no": "P-00021",
    "date": "15/09/2026",
    "validity": "15 días",
    "currency": "ARS",
    "client": {
        "company": "Constructora Del Sur S.A.",
        "contact": "Martín Aguirre",
        "email": "martin@constructoradelsur.com.ar",
        "phone": "+54 9 351 555 1234",
    },
    "deal_name": "CRM-DEAL-2026-00021",
    "deal_title": "Constructora Del Sur S.A.",
    "owner": "Marcos Barbosa",
    "items": rows,
    "tot": {
        "subtotal_fmt": money(subtotal, "$"),
        "has_discount": discount > 0.005,
        "discount_fmt": money(discount, "$"),
        "show_iva": True,
        "iva_included": False,
        "iva_fmt": money(iva, "$"),
        "total_fmt": money(subtotal + iva, "$"),
    },
    "conditions": [
        {"k": "Validez", "v": "15 días desde la fecha de emisión"},
        {"k": "Forma de pago", "v": "A convenir con el cliente"},
        {"k": "Plazo de entrega", "v": "A definir según alcance"},
        {"k": "Moneda", "v": "Pesos argentinos (ARS)"},
    ],
    "notes": "",
}

html = jinja2.Template(open(TPL, encoding="utf-8").read()).render(**ctx)
assert ".__" not in html, "la plantilla no puede contener .__"
out = "/tmp/quote-preview.html"
open(out, "w", encoding="utf-8").write(html)
print(f"OK {out} ({len(html)} chars)")
