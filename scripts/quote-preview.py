"""Preview local del presupuesto: renderiza la plantilla con datos de ejemplo.

Reproduce el contexto de `crm_core.documents.quote_context` (dos totales: inversión
inicial y abono mensual) sin Frappe ni base. Uso:
  python3 scripts/quote-preview.py  ->  /tmp/quote-preview.html
"""
import base64
import os

import jinja2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "apps", "crm_core", "crm_core", "templates", "quote.html")
FONT = os.path.join(ROOT, "apps", "crm_core", "crm_core", "templates", "fonts", "outfit-latin.woff2")


def money(v, symbol="", dec=2):
    n = f"{v:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{symbol} {n}" if symbol else n


# (descripción, tipo de cobro, qty, rate, descuento %): un único, un mensual y un anual.
items_raw = [
    ("Diagnóstico 360° del negocio y plan de acción trimestral", "Único", 1, 850000, 0),
    ("Tablero de control mensual (hasta 12 indicadores)", "Mensual", 1, 145000, 10),
    ("Acompañamiento anual y capacitación al equipo", "Anual", 1, 1740000, 5),
]
INTERVAL_MONTHS = {"Único": 0, "Mensual": 1, "Trimestral": 3, "Anual": 12}

rows, one_time, discount, by_interval = [], 0.0, 0.0, {}
for desc, billing_type, qty, rate, disc in items_raw:
    gross = qty * rate
    net = gross * (1 - disc / 100)
    discount += gross - net
    months = INTERVAL_MONTHS[billing_type]
    if months == 0:
        one_time += net
    else:
        by_interval[months] = by_interval.get(months, 0) + net
    rows.append(
        {
            "description": desc,
            "qty_fmt": f"{qty:g}",
            "rate_fmt": money(rate),
            "discount_fmt": f"{disc:g}%" if disc else "—",
            "net_fmt": money(net),
            "billing_label": billing_type if billing_type != "Único" else "",
        }
    )

recurring_monthly = sum(total / months for months, total in by_interval.items())
one_time_iva = one_time * 0.21
recurring_iva = recurring_monthly * 0.21
labels = {1: "Mensual", 3: "Trimestral", 12: "Anual"}
summary = " · ".join(f"{labels[m]} {money(by_interval[m])}" for m in (1, 3, 12) if by_interval.get(m))

ctx = {
    "font_b64": base64.b64encode(open(FONT, "rb").read()).decode(),
    "company": {
        "city": "Córdoba, Argentina",
        "phone": "+54 9 351 733 4040",
        "email": "consultora.marcosbarbosa@gmail.com",
        "web": "marcosbarbosagroup.com",
    },
    "quote_no": "P-2026-0021",
    "date": "15/09/2026",
    "validity": "30/09/2026",
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
    "has_recurring": recurring_monthly > 0,
    "recurring_summary": summary,
    "tot": {
        "one_time_net": money(one_time, "$"),
        "one_time_iva": money(one_time_iva, "$"),
        "one_time_gross": money(one_time + one_time_iva, "$"),
        "recurring_net": money(recurring_monthly, "$"),
        "recurring_iva": money(recurring_iva, "$"),
        "recurring_gross": money(recurring_monthly + recurring_iva, "$"),
        "discount": money(discount, "$"),
        "has_discount": discount > 0.005,
        "show_iva": True,
        "iva_included": False,
    },
    "conditions": [
        {"k": "Validez", "v": "30/09/2026"},
        {"k": "Forma de pago", "v": "A convenir con el cliente"},
        {"k": "Moneda", "v": "Pesos argentinos (ARS)"},
    ],
    "notes": "",
}

html = jinja2.Template(open(TPL, encoding="utf-8").read()).render(**ctx)
assert ".__" not in html, "la plantilla no puede contener .__"
out = "/tmp/quote-preview.html"
open(out, "w", encoding="utf-8").write(html)
print(f"OK {out} ({len(html)} chars)")
