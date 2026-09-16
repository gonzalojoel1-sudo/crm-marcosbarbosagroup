"""Matemática de presupuestos. Puro Python: sin Frappe, sin base, sin red.

Todo el dinero viaja en Decimal. Los importes se redondean a 2 decimales al
cerrarse cada uno (nunca en pasos intermedios), que es lo que evita el centavo
perdido cuando se suman muchos ítems con descuento.
"""

from decimal import ROUND_HALF_UP, Decimal

IVA_RATE = Decimal("0.21")
CENT = Decimal("0.01")

BILLING_TYPES = ("Único", "Mensual", "Trimestral", "Anual")

# Meses que representa cada tipo de cobro. Único = 0: no es recurrente.
INTERVAL_MONTHS = {
    "Único": 0,
    "Mensual": 1,
    "Trimestral": 3,
    "Anual": 12,
}

INTERVAL_LABELS = {1: "Mensual", 3: "Trimestral", 12: "Anual"}


def dec(value) -> Decimal:
    """Decimal seguro. Acepta None y ''; nunca pasa por float."""
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value) -> Decimal:
    """Redondea a 2 decimales. Se usa al cerrar cada importe."""
    return dec(value).quantize(CENT, rounding=ROUND_HALF_UP)


def interval_months(billing_type) -> int:
    """Meses del intervalo. Un tipo desconocido se trata como no recurrente."""
    return INTERVAL_MONTHS.get((billing_type or "").strip(), 0)


def line_amounts(qty, rate, discount_percentage) -> tuple:
    """(importe bruto, importe neto) de una línea."""
    gross = money(dec(qty) * dec(rate))
    discount = dec(discount_percentage) / Decimal("100")
    net = money(gross * (Decimal("1") - discount))
    return gross, net


def _row(item, key):
    """Lee una clave tanto de un dict como de un objeto (Document de Frappe)."""
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def items_fingerprint(items) -> tuple:
    """Huella comparable de los ítems de un presupuesto.

    Comparar las listas de `Document` con `!=` no sirve: Frappe no define `__eq__`,
    así que compara identidad y dos listas equivalentes dan distintas. Esta huella
    compara los VALORES que importan. Los números van como `Decimal`, sin `str()`:
    `Decimal` compara por valor (`Decimal("1000") == Decimal("1000.00")`), así que
    normaliza solo. Envolverlos en `str()` los volvería distintos, y pasarlos por
    `money()` los redondearía a 2 decimales — lo que escondería un cambio real de una
    cantidad (`qty` es Float, sin límite de decimales).
    """
    rows = []
    for it in items or []:
        rows.append(
            (
                str(_row(it, "description") or "").strip(),
                str(_row(it, "billing_type") or "").strip(),
                dec(_row(it, "qty")),
                dec(_row(it, "rate")),
                dec(_row(it, "discount_percentage")),
            )
        )
    return tuple(rows)


def fmt_money(value, symbol="$") -> str:
    """Formato es-AR: miles con '.', decimales con ','."""
    raw = f"{money(value):,.2f}"
    raw = raw.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{symbol} {raw}" if symbol else raw


def _apply_iva(net: Decimal, iva_mode: str, iva_rate: Decimal) -> tuple:
    """(iva, bruto) para un neto, según el modo."""
    if iva_mode == "exento":
        return Decimal("0.00"), money(net)
    if iva_mode == "incluido":
        # El neto ya trae el IVA adentro: se expone la porción contenida.
        contained = net - (net / (Decimal("1") + iva_rate))
        return money(contained), money(net)
    iva = money(net * iva_rate)
    return iva, money(net + iva)


def _summary(by_interval: dict, iva_mode: str, iva_rate: Decimal) -> str:
    """Agrupa el abono por intervalo para mostrar. Nunca suma intervalos distintos."""
    parts = []
    for months in (1, 3, 12):
        total = by_interval.get(months)
        if not total:
            continue
        parts.append(f"{INTERVAL_LABELS[months]} {fmt_money(total)}")
    return " · ".join(parts)


def quote_totals(items, iva_mode: str = "sumar", iva_rate: Decimal = IVA_RATE) -> dict:
    """Totales de un presupuesto a partir de sus ítems.

    items: iterable de dicts con qty, rate, discount_percentage, billing_type.

    Devuelve dos bases de tiempo separadas a propósito: una inversión inicial y un
    abono. Sumarlas no significa nada, así que no se suman en ningún lado.
    """
    one_time = Decimal("0")
    discount_total = Decimal("0")
    by_interval = {}

    for it in items:
        gross, net = line_amounts(
            it.get("qty"), it.get("rate"), it.get("discount_percentage")
        )
        discount_total += gross - net
        months = interval_months(it.get("billing_type"))
        if months == 0:
            one_time += net
        else:
            by_interval[months] = by_interval.get(months, Decimal("0")) + net

    one_time = money(one_time)
    recurring = money(sum(by_interval.values(), Decimal("0")))
    recurring_monthly = money(
        sum((t / months for months, t in by_interval.items()), Decimal("0"))
    )

    one_time_iva, one_time_gross = _apply_iva(one_time, iva_mode, iva_rate)
    _, recurring_gross = _apply_iva(recurring, iva_mode, iva_rate)
    monthly_iva, monthly_gross = _apply_iva(recurring_monthly, iva_mode, iva_rate)

    return {
        "total_one_time": one_time,
        "total_one_time_iva": one_time_iva,
        "total_one_time_gross": one_time_gross,
        "total_recurring": recurring,
        "total_recurring_monthly": recurring_monthly,
        "total_recurring_monthly_iva": monthly_iva,
        "total_recurring_monthly_gross": monthly_gross,
        "total_recurring_gross": recurring_gross,
        "discount_total": money(discount_total),
        "recurring_summary": _summary(by_interval, iva_mode, iva_rate),
        "has_one_time": one_time > 0,
        "has_recurring": recurring > 0,
    }
