"""Render de documentos (PDF) del CRM."""

import base64
import os
import re
import subprocess
import tempfile

import frappe
from frappe.utils import flt, getdate

from crm_core import billing

TEMPLATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
_font_cache = {}

EMPRESA = {
    "city": "Córdoba, Argentina",
    "phone": "+54 9 351 733 4040",
    "email": "consultora.marcosbarbosa@gmail.com",
    "web": "marcosbarbosagroup.com",
}


def _font_b64():
    if "outfit" not in _font_cache:
        with open(os.path.join(TEMPLATES, "fonts", "outfit-latin.woff2"), "rb") as f:
            _font_cache["outfit"] = base64.b64encode(f.read()).decode()
    return _font_cache["outfit"]


def quote_number(name):
    """Número a mostrar: se respeta la serie (`P-YYYY-NNNN`) tal cual viene.

    Sólo se arma `P-NNNN` como fallback para nombres que no son de la serie.
    """
    name = name or ""
    if re.fullmatch(r"P-\d{4}-\d+", name):
        return name
    m = re.search(r"(\d+)$", name)
    return f"P-{m.group(1)}" if m else (name or "S/N")


def quote_context(presupuesto_name):
    p = frappe.get_doc("CRM Presupuesto", presupuesto_name)
    items = [it for it in (p.items or []) if (it.description or "").strip()]
    if not items:
        frappe.throw("El presupuesto no tiene ítems cargados.")

    currency = p.currency or "ARS"
    symbol = "US$" if currency == "USD" else "$"

    rows = []
    for it in items:
        rows.append(
            {
                "description": it.description,
                "qty_fmt": f"{flt(it.qty):g}",
                "rate_fmt": billing.fmt_money(it.rate, ""),
                "discount_fmt": f"{flt(it.discount_percentage):g}%" if it.discount_percentage else "—",
                "net_fmt": billing.fmt_money(it.net_amount, ""),
                "billing_label": it.billing_type if it.billing_type != "Único" else "",
            }
        )

    org_name = ""
    if p.organization:
        org_name = (
            frappe.db.get_value("CRM Organization", p.organization, "organization_name")
            or p.organization
        )
    email = phone = ""
    owner = ""
    if p.deal:
        deal_owner = frappe.db.get_value("CRM Deal", p.deal, "deal_owner")
        if deal_owner:
            owner = frappe.db.get_value("User", deal_owner, "full_name") or ""
        lead = frappe.db.get_value("CRM Deal", p.deal, "lead")
        if lead:
            r = frappe.db.get_value("CRM Lead", lead, ["email", "mobile_no"], as_dict=True) or {}
            email, phone = r.get("email") or "", r.get("mobile_no") or ""

    show_iva = (p.iva_mode or "sumar") != "exento"
    iva_included = p.iva_mode == "incluido"

    return {
        "font_b64": _font_b64(),
        "company": EMPRESA,
        "quote_no": quote_number(p.name),
        "date": getdate(p.creation).strftime("%d/%m/%Y"),
        "validity": getdate(p.valid_until).strftime("%d/%m/%Y")
        if p.valid_until
        else f"{billing.DEFAULT_VALIDITY_DAYS} días",
        "currency": currency,
        "client": {
            "company": org_name or "Cliente",
            "contact": frappe.db.get_value("CRM Deal", p.deal, "lead_name") or "",
            "email": email,
            "phone": phone,
        },
        "deal_name": p.deal,
        "deal_title": org_name or p.deal,
        "owner": owner,
        "items": rows,
        "has_recurring": flt(p.total_recurring_monthly) > 0,
        "recurring_summary": p.recurring_summary or "",
        "tot": {
            "one_time_net": billing.fmt_money(p.total_one_time, symbol),
            "one_time_iva": billing.fmt_money(p.total_one_time_iva, symbol),
            "one_time_gross": billing.fmt_money(p.total_one_time_gross, symbol),
            "recurring_net": billing.fmt_money(p.total_recurring_monthly, symbol),
            "recurring_iva": billing.fmt_money(p.total_recurring_monthly_iva, symbol),
            "recurring_gross": billing.fmt_money(p.total_recurring_monthly_gross, symbol),
            "discount": billing.fmt_money(p.discount_total, symbol),
            "has_discount": flt(p.discount_total) > 0.005,
            "show_iva": show_iva,
            "iva_included": iva_included,
        },
        "conditions": [
            {
                "k": "Validez",
                "v": getdate(p.valid_until).strftime("%d/%m/%Y")
                if p.valid_until
                else f"{billing.DEFAULT_VALIDITY_DAYS} días desde la emisión",
            },
            {"k": "Forma de pago", "v": "A convenir con el cliente"},
            {
                "k": "Moneda",
                "v": "Dólares estadounidenses (USD)" if currency == "USD" else "Pesos argentinos (ARS)",
            },
        ],
        "notes": p.notes or "",
    }


def _html_to_pdf(html):
    """Chromium headless: misma fidelidad que el navegador (wkhtmltopdf no da)."""
    with tempfile.TemporaryDirectory() as d:
        hp, pp = os.path.join(d, "q.html"), os.path.join(d, "q.pdf")
        with open(hp, "w", encoding="utf-8") as f:
            f.write(html)
        proc = subprocess.run(
            [
                "chromium-headless-shell", "--headless", "--no-sandbox", "--disable-gpu",
                "--disable-dev-shm-usage", f"--user-data-dir={os.path.join(d, 'profile')}",
                "--no-pdf-header-footer", f"--print-to-pdf={pp}", f"file://{hp}",
            ],
            capture_output=True,
            timeout=120,
        )
        if not os.path.exists(pp) or os.path.getsize(pp) == 0:
            frappe.log_error(
                (proc.stderr.decode(errors="ignore") or "chromium sin salida")[-3000:], "quote_pdf"
            )
            frappe.throw("No se pudo generar el PDF. Probá de nuevo en un momento.")
        with open(pp, "rb") as f:
            return f.read()


def render_quote_pdf(presupuesto_name):
    ctx = quote_context(presupuesto_name)
    with open(os.path.join(TEMPLATES, "quote.html"), encoding="utf-8") as f:
        html = frappe.render_template(f.read(), ctx)
    return _html_to_pdf(html)
