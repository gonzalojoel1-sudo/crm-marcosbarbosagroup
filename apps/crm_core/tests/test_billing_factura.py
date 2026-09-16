"""Matemática pura de facturación. Sin Frappe, sin base, sin red."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from crm_core.billing import (
    aging_buckets,
    invoice_status,
    invoice_totals,
    outstanding_of,
    reparto_fifo,
    validar_aplicaciones,
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


def test_anulada_gana_y_una_incobrable_sin_pagos_es_incobrable():
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


def test_una_incobrable_que_se_cobra_deja_de_ser_incobrable():
    """Spec §5.1: si el saldo llega a 0 con un pago, la factura esta cobrada."""
    assert (
        invoice_status("1000", "1000", "0", date(2026, 9, 1), HOY, is_uncollectible=True)
        == "Pagada"
    )


def test_una_incobrable_con_saldo_sigue_incobrable():
    assert (
        invoice_status("1000", "300", "0", date(2026, 9, 1), HOY, is_uncollectible=True)
        == "Incobrable"
    )


def test_anulada_gana_sobre_incobrable():
    assert (
        invoice_status(
            "1000", "0", "0", date(2026, 9, 1), HOY, is_voided=True, is_uncollectible=True
        )
        == "Anulada"
    )


def test_total_cero_es_emitida():
    assert invoice_status("0", "0", "0", date(2026, 10, 1), HOY) == "Emitida"


def test_sin_vencimiento_no_vence():
    assert invoice_status("1000", "0", "0", None, HOY) == "Emitida"


def test_pago_mayor_al_total_es_pagada():
    assert invoice_status("1000", "1200", "0", date(2026, 9, 1), HOY) == "Pagada"


def test_nota_de_credito_anulada_es_anulada():
    assert (
        invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_return=True, is_voided=True)
        == "Anulada"
    )


# ── Cobranza ───────────────────────────────────────────────────────────
def factura(name, outstanding, due, org="ORG-1", currency="ARS"):
    return {
        "name": name,
        "outstanding": outstanding,
        "due_date": due,
        "organization": org,
        "currency": currency,
    }


def test_reparto_fifo_aplica_a_lo_mas_viejo_primero():
    fs = [factura("F3", "100", date(2026, 10, 1)), factura("F1", "100", date(2026, 8, 1)),
          factura("F2", "100", date(2026, 9, 1))]
    assert reparto_fifo("250", fs) == [("F1", Decimal("100.00")), ("F2", Decimal("100.00")),
                                       ("F3", Decimal("50.00"))]


def test_reparto_fifo_no_aplica_mas_que_el_saldo_de_cada_factura():
    fs = [factura("F1", "50", date(2026, 8, 1))]
    assert reparto_fifo("200", fs) == [("F1", Decimal("50.00"))]


def test_reparto_fifo_sin_monto_no_aplica_nada():
    assert reparto_fifo("0", [factura("F1", "100", date(2026, 8, 1))]) == []


def test_reparto_fifo_ignora_facturas_sin_saldo():
    fs = [factura("F1", "0", date(2026, 8, 1)), factura("F2", "100", date(2026, 9, 1))]
    assert reparto_fifo("100", fs) == [("F2", Decimal("100.00"))]


def test_aplicaciones_no_pueden_superar_el_pago():
    with pytest.raises(ValueError):
        validar_aplicaciones("100", [("F1", "150")])


def test_aplicaciones_pueden_dejar_saldo_a_cuenta():
    aplicaciones = [("F1", "60")]
    validar_aplicaciones("100", aplicaciones)   # no levanta: 40 queda a cuenta
    aplicado = sum((Decimal(m) for _, m in aplicaciones), Decimal("0"))
    assert aplicado == Decimal("60")
    assert Decimal("100") - aplicado == Decimal("40")


def test_aging_por_tramos():
    hoy = date(2026, 9, 16)
    fs = [
        factura("F1", "100", date(2026, 9, 10)),   # 6 dias -> 0-30
        factura("F2", "200", date(2026, 8, 10)),   # 37 dias -> 31-60
        factura("F3", "300", date(2026, 7, 1)),    # 77 dias -> 61-90
        factura("F4", "400", date(2026, 5, 1)),    # +90
    ]
    b = aging_buckets(fs, hoy)
    assert b["0-30"] == Decimal("100.00")
    assert b["31-60"] == Decimal("200.00")
    assert b["61-90"] == Decimal("300.00")
    assert b["+90"] == Decimal("400.00")


def test_aging_ignora_lo_que_no_vencio():
    hoy = date(2026, 9, 16)
    b = aging_buckets([factura("F1", "100", date(2026, 10, 1))], hoy)
    assert b["0-30"] == Decimal("0.00")
    assert b["corriente"] == Decimal("100.00")


# ── Cobranza: bordes (fix round 1) ─────────────────────────────────────
def test_reparto_fifo_pone_primero_la_factura_sin_vencimiento():
    """Sin vencimiento no hay forma de ubicarla en el tiempo: se cobra primero.

    Si la clave de orden pasara de `str(x.get("due_date") or "")` a `str(x.get("due_date"))`,
    el None se volveria "None", que ordena DESPUES de cualquier fecha ISO: la deuda sin
    vencimiento quedaria postergada para siempre.
    """
    fs = [factura("F1", "100", date(2026, 9, 1)), factura("SIN", "100", None)]
    assert reparto_fifo("150", fs) == [("SIN", Decimal("100.00")), ("F1", Decimal("50.00"))]


def test_reparto_fifo_con_monto_negativo_no_aplica_nada():
    assert reparto_fifo("-50", [factura("F1", "100", date(2026, 8, 1))]) == []


def test_aging_en_la_frontera_de_cada_tramo():
    """Las fronteras 30/31/60/61/90/91: un `<=` que se vuelva `<` mueve el dia 30 de tramo."""
    hoy = date(2026, 9, 30)
    casos = [
        (0, "corriente"), (1, "0-30"), (30, "0-30"),
        (31, "31-60"), (60, "31-60"),
        (61, "61-90"), (90, "61-90"),
        (91, "+90"),
    ]
    for dias, tramo in casos:
        venc = hoy - timedelta(days=dias)
        b = aging_buckets([factura("F", "100", venc)], hoy)
        assert b[tramo] == Decimal("100.00"), f"dias={dias} deberia ir a {tramo}"


def test_aging_sin_vencimiento_es_corriente():
    b = aging_buckets([factura("F", "100", None)], date(2026, 9, 16))
    assert b["corriente"] == Decimal("100.00")
    assert b["0-30"] == Decimal("0.00")


def test_aging_ignora_las_facturas_sin_saldo():
    b = aging_buckets([factura("F", "0", date(2026, 5, 1))], date(2026, 9, 16))
    assert all(v == Decimal("0.00") for v in b.values())


def test_validar_aplicaciones_en_el_limite_exacto_no_levanta():
    """La comparacion es estricta (`>`): sumar EXACTAMENTE el monto es valido."""
    validar_aplicaciones("100", [("F1", "60"), ("F2", "40")])


def test_validar_aplicaciones_rechaza_el_monto_negativo_con_aplicaciones():
    with pytest.raises(ValueError):
        validar_aplicaciones("-100", [("F1", "10")])
    # y sin aplicaciones (una devolucion legitima) NO levanta
    validar_aplicaciones("-100", [])


def test_validar_aplicaciones_con_aplicacion_de_cero_no_cuenta():
    """Una aplicacion de monto 0 no es una aplicacion: no debe bloquear una devolucion."""
    validar_aplicaciones("-100", [("F1", "0")])


def test_reparto_fifo_desempata_por_nombre():
    """Mismo vencimiento: el orden tiene que ser determinista, no el del diccionario."""
    fs = [factura("B", "100", date(2026, 9, 1)), factura("A", "100", date(2026, 9, 1))]
    assert reparto_fifo("150", fs) == [("A", Decimal("100.00")), ("B", Decimal("50.00"))]
