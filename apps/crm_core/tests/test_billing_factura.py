"""Matemática pura de facturación. Sin Frappe, sin base, sin red."""
from datetime import date
from decimal import Decimal

from crm_core.billing import (
    invoice_status,
    invoice_totals,
    outstanding_of,
)


def item(qty, rate, discount=0, billing_type="Único"):
    return {
        "qty": qty,
        "rate": rate,
        "discount_percentage": discount,
        "billing_type": billing_type,
    }


# ── Totales ────────────────────────────────────────────────────────────
def test_totales_de_una_factura_simple():
    t = invoice_totals([item(1, "850000")], iva_mode="sumar")
    assert t["subtotal"] == Decimal("850000.00")
    assert t["iva_amount"] == Decimal("178500.00")
    assert t["total"] == Decimal("1028500.00")


def test_la_factura_no_separa_bases_de_tiempo_como_el_presupuesto():
    """En una factura, TODOS los ítems están en la misma base: es un cargo puntual.

    Un ítem 'Mensual' facturado ES el cargo de ese período; no hay que normalizarlo
    a mensual como en el presupuesto (donde el abono se compara contra la inversión).
    """
    t = invoice_totals([item(1, "210000", 0, "Mensual")], iva_mode="sumar")
    assert t["subtotal"] == Decimal("210000.00")
    assert t["total"] == Decimal("254100.00")


def test_descuento_por_linea():
    t = invoice_totals([item(3, "145000", 10)], iva_mode="sumar")
    assert t["subtotal"] == Decimal("391500.00")
    assert t["discount_total"] == Decimal("43500.00")


def test_iva_incluido_y_exento():
    incl = invoice_totals([item(1, "121000")], iva_mode="incluido")
    assert incl["total"] == Decimal("121000.00")
    assert incl["iva_amount"] == Decimal("21000.00")
    exento = invoice_totals([item(1, "100000")], iva_mode="exento")
    assert exento["iva_amount"] == Decimal("0.00")
    assert exento["total"] == Decimal("100000.00")


# ── Saldo ──────────────────────────────────────────────────────────────
def test_outstanding_descuenta_pagos_y_creditos():
    assert outstanding_of("1000", "300", "100") == Decimal("600.00")


def test_outstanding_nunca_es_negativo():
    """El tope se aplica en la NC (§5.2 del spec), pero la funcion no puede mentir:
    un saldo negativo es un dato corrupto, no un saldo a favor."""
    assert outstanding_of("1000", "1200", "0") == Decimal("0.00")
    assert outstanding_of("1000", "1000", "500") == Decimal("0.00")


# ── Estado derivado ────────────────────────────────────────────────────
HOY = date(2026, 9, 16)


def test_sin_pagos_y_sin_vencer_es_emitida():
    assert invoice_status("1000", "0", "0", date(2026, 10, 1), HOY) == "Emitida"


def test_sin_pagos_con_vencimiento_pasado_es_vencida():
    assert invoice_status("1000", "0", "0", date(2026, 9, 1), HOY) == "Vencida"


def test_pago_parcial_es_parcial_aunque_este_vencida():
    """Parcial gana sobre Vencida: si ya entro plata, el estado util es cuanto falta."""
    assert invoice_status("1000", "400", "0", date(2026, 9, 1), HOY) == "Parcial"


def test_pago_total_es_pagada():
    assert invoice_status("1000", "1000", "0", date(2026, 9, 1), HOY) == "Pagada"


def test_acreditada_al_ciento_por_ciento_y_sin_cobrar_NO_es_pagada():
    """Hallazgo de la auditoria: sin esta regla, una factura emitida por error,
    acreditada 100% y nunca cobrada quedaba 'Pagada', que es mentir."""
    assert invoice_status("1000", "0", "1000", date(2026, 10, 1), HOY) == "Emitida"


def test_acreditada_parcialmente_sigue_emitida():
    assert invoice_status("1000", "0", "300", date(2026, 10, 1), HOY) == "Emitida"


def test_pago_mas_credito_que_cubre_el_total_es_pagada_si_hubo_pago():
    assert invoice_status("1000", "400", "600", date(2026, 10, 1), HOY) == "Pagada"


def test_las_marcas_explicitas_ganan_sobre_lo_derivado():
    assert invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_voided=True) == "Anulada"
    assert (
        invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_uncollectible=True)
        == "Incobrable"
    )


def test_una_nota_de_credito_emitida_se_reporta_como_emitida():
    """`is_return` no tiene estados de cobro: es un comprobante que corrige."""
    assert (
        invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_return=True) == "Emitida"
    )
