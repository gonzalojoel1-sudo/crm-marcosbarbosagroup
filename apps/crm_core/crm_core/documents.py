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


def invoice_context(factura_name):
    """Contexto del PDF de una factura.

    Sin CAE, una factura NO es un comprobante fiscal: el PDF se rotula como documento
    INTERNO. La leyenda "X" + "DOCUMENTO NO VÁLIDO COMO FACTURA" es para presupuestos,
    remitos y recibos (RG 3803/94 art. 9); no se le pone "X" a una factura.
    """
    f = frappe.get_doc("CRM Factura", factura_name)
    items = [it for it in (f.items or []) if (it.description or "").strip()]
    if not items:
        frappe.throw("La factura no tiene ítems cargados.")

    currency = f.currency or "ARS"
    symbol = "US$" if currency == "USD" else "$"

    org_name, direccion = "", ""
    if f.organization:
        org = frappe.db.get_value(
            "CRM Organization", f.organization, ["organization_name", "address"], as_dict=True
        ) or {}
        org_name = org.get("organization_name") or f.organization
        if org.get("address"):
            a = frappe.db.get_value(
                "Address", org["address"], ["address_line1", "city", "pincode"], as_dict=True
            ) or {}
            direccion = ", ".join(
                p for p in (a.get("address_line1"), a.get("city"), a.get("pincode")) if p
            )

    # El CUIT y la condición frente al IVA del cliente NO se imprimen a propósito:
    # `CRM Organization` no tiene esos campos y la factura todavía no es un comprobante
    # fiscal (ver `sin_cae`). Agregarlos requiere Custom Fields en `CRM Organization`
    # —misma decisión de esquema que la `vertical`— y que el usuario provea los datos.
    # No se imprime un "CUIT: —" vacío: un dato vacío parece un error del documento.

    sin_cae = (f.fiscal_status or "No aplica") != "Emitida"

    return {
        "font_b64": _font_b64(),
        "company": EMPRESA,
        "emisor": {
            "razon_social": "Marcos Barbosa Group",
            "cuit": frappe.db.get_single_value("CRM Emisor", "cuit") or "",
            "address": frappe.db.get_single_value("CRM Emisor", "address") or "",
            "cbu_alias": frappe.db.get_single_value("CRM Emisor", "cbu_alias") or "",
        },
        "invoice_no": f.name,
        "issue_date": getdate(f.issue_date).strftime("%d/%m/%Y") if f.issue_date else "",
        "due_date": getdate(f.due_date).strftime("%d/%m/%Y") if f.due_date else "",
        "period": _period_label(f),
        "currency": currency,
        "client": {"company": org_name or "Cliente", "address": direccion},
        "items": [
            {
                "description": it.description,
                "qty_fmt": f"{flt(it.qty):g}",
                "rate_fmt": billing.fmt_money(it.rate, ""),
                "discount_fmt": f"{flt(it.discount_percentage):g}%" if it.discount_percentage else "—",
                "net_fmt": billing.fmt_money(it.net_amount, ""),
                "billing_label": it.billing_type if it.billing_type != "Único" else "",
            }
            for it in items
        ],
        "tot": {
            "subtotal": billing.fmt_money(f.subtotal, symbol),
            "discount": billing.fmt_money(f.discount_total, symbol),
            "has_discount": flt(f.discount_total) > 0.005,
            "iva": billing.fmt_money(f.iva_amount, symbol),
            "iva_included": f.iva_mode == "incluido",
            "show_iva": (f.iva_mode or "sumar") != "exento",
            "total": billing.fmt_money(f.total, symbol),
            "paid": billing.fmt_money(f.paid_amount, symbol),
            "credit": billing.fmt_money(f.credit_total, symbol),
            "outstanding": billing.fmt_money(f.outstanding, symbol),
            "show_balance": flt(f.outstanding) > 0.005 and flt(f.paid_amount) > 0,
        },
        "sin_cae": sin_cae,
        "conditions": f.conditions or "",
        "notes": f.notes or "",
        "status": f.status,
    }


def _period_label(f):
    if f.period_start and f.period_end:
        return f"{getdate(f.period_start).strftime('%d/%m/%Y')} al {getdate(f.period_end).strftime('%d/%m/%Y')}"
    return ""


def render_invoice_pdf(factura_name):
    ctx = invoice_context(factura_name)
    with open(os.path.join(TEMPLATES, "invoice.html"), encoding="utf-8") as fh:
        html = frappe.render_template(fh.read(), ctx)
    return _html_to_pdf(html)
