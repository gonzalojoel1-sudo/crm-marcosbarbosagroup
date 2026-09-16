"""Tests de la matemática de presupuestos. Puros: sin Frappe, sin base, sin red."""
from decimal import Decimal

from crm_core.billing import (
    interval_months,
    items_fingerprint,
    line_amounts,
    money,
    quote_totals,
)


def item(qty, rate, discount=0, billing_type="Único"):
    return {
        "qty": qty,
        "rate": rate,
        "discount_percentage": discount,
        "billing_type": billing_type,
    }


def test_interval_months_mapea_los_tipos():
    assert interval_months("Único") == 0
    assert interval_months("Mensual") == 1
    assert interval_months("Trimestral") == 3
    assert interval_months("Anual") == 12
    assert interval_months("Lo que sea") == 0


def test_money_redondea_a_dos_decimales():
    assert money("1000.005") == Decimal("1000.01")
    assert money(Decimal("0")) == Decimal("0.00")


def test_line_amounts_aplica_descuento_sobre_el_bruto():
    gross, net = line_amounts(3, "145000", 10)
    assert gross == Decimal("435000.00")
    assert net == Decimal("391500.00")


def test_line_amounts_sin_descuento():
    gross, net = line_amounts(2, "1000", 0)
    assert gross == net == Decimal("2000.00")


def test_solo_unicos_no_genera_abono():
    t = quote_totals([item(1, "850000"), item(2, "50000", 50)])
    assert t["total_one_time"] == Decimal("900000.00")
    assert t["total_recurring_monthly"] == Decimal("0.00")
    assert t["has_recurring"] is False
    assert t["has_one_time"] is True


def test_abono_se_normaliza_a_mensual():
    # 210.000 mensual + 1.200.000 anual => 210.000 + 100.000 = 310.000/mes
    t = quote_totals([item(1, "210000", 0, "Mensual"), item(1, "1200000", 0, "Anual")])
    assert t["total_recurring_monthly"] == Decimal("310000.00")
    assert t["total_one_time"] == Decimal("0.00")


def test_no_suma_intervalos_distintos_en_el_resumen():
    t = quote_totals([item(1, "210000", 0, "Mensual"), item(1, "1200000", 0, "Anual")])
    # Se agrupan por intervalo; nunca se suman entre sí.
    assert "Mensual" in t["recurring_summary"]
    assert "Anual" in t["recurring_summary"]
    assert "1.410.000" not in t["recurring_summary"]


def test_trimestral_se_normaliza_a_un_tercio():
    t = quote_totals([item(1, "300000", 0, "Trimestral")])
    assert t["total_recurring_monthly"] == Decimal("100000.00")


def test_iva_sumar_agrega_21_por_ciento():
    t = quote_totals([item(1, "100000")], iva_mode="sumar")
    assert t["total_one_time"] == Decimal("100000.00")
    assert t["total_one_time_iva"] == Decimal("21000.00")
    assert t["total_one_time_gross"] == Decimal("121000.00")


def test_iva_incluido_no_cambia_el_total_y_expone_el_contenido():
    t = quote_totals([item(1, "121000")], iva_mode="incluido")
    assert t["total_one_time_gross"] == Decimal("121000.00")
    assert t["total_one_time_iva"] == Decimal("21000.00")


def test_iva_exento_no_agrega_nada():
    t = quote_totals([item(1, "100000")], iva_mode="exento")
    assert t["total_one_time_iva"] == Decimal("0.00")
    assert t["total_one_time_gross"] == Decimal("100000.00")


def test_descuento_total_suma_las_diferencias():
    t = quote_totals([item(2, "100000", 10), item(1, "50000", 0, "Mensual")])
    assert t["discount_total"] == Decimal("20000.00")


def test_items_fingerprint_ignora_la_identidad_de_los_objetos():
    """Dos listas con los mismos valores deben dar la misma huella.

    Es la razon de existir de la funcion: comparar los objetos Document con `!=`
    compara identidad y siempre da distinto, lo que bloqueaba todo guardado de un
    presupuesto congelado.
    """
    assert items_fingerprint([item(1, "1000")]) == items_fingerprint([item(1, "1000")])


def test_items_fingerprint_detecta_un_cambio():
    assert items_fingerprint([item(1, "1000")]) != items_fingerprint([item(1, "1001")])
    assert items_fingerprint([item(1, "1000")]) != items_fingerprint([item(2, "1000")])


def test_items_fingerprint_normaliza_los_numeros():
    a = [{"description": "x", "billing_type": "Único", "qty": 1, "rate": 1000, "discount_percentage": 0}]
    b = [{"description": "x", "billing_type": "Único", "qty": "1", "rate": "1000.00", "discount_percentage": ""}]
    assert items_fingerprint(a) == items_fingerprint(b)


def test_items_fingerprint_no_redondea_las_cantidades():
    """`qty` es Float: si la huella redondeara a 2 decimales, un cambio real de
    cantidad pasaria invisible y se podria editar un presupuesto congelado."""
    assert items_fingerprint([item("2.250", "100")]) != items_fingerprint(
        [item("2.253", "100")]
    )


def test_presupuesto_mixto_separa_las_dos_bases_de_tiempo():
    t = quote_totals([item(1, "850000"), item(1, "210000", 0, "Mensual")])
    assert t["total_one_time"] == Decimal("850000.00")
    assert t["total_recurring_monthly"] == Decimal("210000.00")
    assert t["has_one_time"] and t["has_recurring"]
