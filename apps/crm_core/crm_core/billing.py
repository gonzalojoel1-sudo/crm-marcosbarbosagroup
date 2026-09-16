"""Matemática de presupuestos, facturación y cobranza. Puro Python: sin Frappe, sin base, sin red.

Todo el dinero viaja en Decimal. Los importes se redondean a 2 decimales al
cerrarse cada uno (nunca en pasos intermedios), que es lo que evita el centavo
perdido cuando se suman muchos ítems con descuento.
"""

import datetime

from decimal import ROUND_HALF_UP, Decimal

IVA_RATE = Decimal("0.21")
CENT = Decimal("0.01")
DEFAULT_VALIDITY_DAYS = 15

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


# ── Facturación ────────────────────────────────────────────────────────

def invoice_totals(items, iva_mode: str = "sumar", iva_rate: Decimal = IVA_RATE) -> dict:
    """Totales de una factura a partir de sus ítems.

    A diferencia del presupuesto, acá NO se separan bases de tiempo: una factura es un
    cargo puntual. Un ítem 'Mensual' facturado ES el cargo de ese período, no un abono a
    normalizar. Sumar todos los netos es correcto.
    """
    subtotal = Decimal("0")
    discount_total = Decimal("0")

    for it in items:
        gross, net = line_amounts(
            it.get("qty"), it.get("rate"), it.get("discount_percentage")
        )
        discount_total += gross - net
        subtotal += net

    subtotal = money(subtotal)
    iva, total = _apply_iva(subtotal, iva_mode, iva_rate)

    return {
        "subtotal": subtotal,
        "discount_total": money(discount_total),
        "iva_amount": iva,
        "total": total,
    }


def outstanding_of(total, paid_amount, credit_total) -> Decimal:
    """Saldo pendiente. Nunca negativo: un saldo negativo es un dato corrupto.

    El tope real del crédito se aplica al emitir la nota de crédito (§5.2 del spec);
    acá se garantiza que el número que se muestra nunca mienta.
    """
    saldo = dec(total) - dec(paid_amount) - dec(credit_total)
    return money(saldo) if saldo > 0 else Decimal("0.00")


def invoice_status(
    total,
    paid_amount,
    credit_total,
    due_date,
    today=None,
    is_return: bool = False,
    is_voided: bool = False,
    is_uncollectible: bool = False,
) -> str:
    """Estado DERIVADO de la factura. La única fuente de verdad del estado.

    Reglas, en orden:
      1. Anulada gana sobre todo: un documento anulado no existe para el cobro.
      2. Una nota de crédito emitida no tiene ciclo de cobro: es un comprobante.
      3. Pagada exige saldo 0 **y** que haya entrado plata: una factura acreditada al
         100% y nunca cobrada NO está pagada (hallazgo de la auditoría).
      4. `Incobrable` es una marca sobre una deuda VIVA: si el saldo llegó a 0 con un pago,
         la factura se cobró y deja de ser incobrable (spec §5.1, corrección #3).
      5. Parcial gana sobre Vencida: si ya entró plata, lo útil es cuánto falta.
      6. Sin pagos: Vencida si el vencimiento pasó, Emitida si no.

    Semántica de `is_uncollectible`:
      - con saldo > 0 → "Incobrable";
      - cobrada al 100% → "Pagada";
      - con pago parcial → "Incobrable" (sigue habiendo deuda viva; la marca no se limpia
        sola mientras quede saldo).
    """
    if is_voided:
        return "Anulada"
    if is_return:
        return "Emitida"

    paid = dec(paid_amount)
    saldo = outstanding_of(total, paid_amount, credit_total)
    hoy = today or datetime.date.today()

    if saldo == 0:
        return "Pagada" if paid > 0 else "Emitida"
    if is_uncollectible:
        return "Incobrable"
    if paid > 0:
        return "Parcial"
    if due_date and str(due_date) < str(hoy):
        return "Vencida"
    return "Emitida"


# ── Cobranza ───────────────────────────────────────────────────────────

def validar_aplicaciones(pago_amount, aplicaciones) -> None:
    """Valida que las aplicaciones entren en el monto del pago.

    `aplicaciones` es un iterable de pares `(nombre_factura, monto)`.

    Dos reglas, ambas sobre el SIGNO (esta función no sabe de tipos de movimiento):
      - Un monto NEGATIVO (una devolución: plata que sale) no puede llevar aplicaciones.
      - Con monto >= 0, la suma de las aplicaciones no puede superarlo. Dejar saldo sin
        aplicar es correcto (queda a cuenta); sobreaplicar es corrupción: el mismo peso
        cobraría dos deudas.
    """
    if dec(pago_amount) < 0:
        if any(dec(m) for _, m in aplicaciones):
            raise ValueError("Un movimiento negativo (devolución) no puede tener aplicaciones.")
        return
    total = sum((dec(m) for _, m in aplicaciones), Decimal("0"))
    if money(total) > money(pago_amount):
        raise ValueError(
            f"Las aplicaciones ({money(total)}) no pueden superar el monto del pago ({money(pago_amount)})."
        )


def reparto_fifo(amount, facturas) -> list:
    """Reparte un monto entre facturas, de la más vieja a la más nueva.

    FIFO por vencimiento es la práctica contable estándar: evita que la deuda vieja
    quede abierta para siempre mientras se cobra la nueva.

    `facturas` debe venir YA filtrada por organización y moneda (la guarda vive en la
    capa que llama: esta función es pura y no sabe de clientes).
    Devuelve [(nombre_factura, monto_a_aplicar)].

    Casos borde decididos:
      - `amount` en 0 o negativo: no hay nada que repartir; devuelve [].
      - Una factura sin `due_date` ordena primero (clave vacía), como si fuera la más
        vieja. Es una decisión determinista: sin vencimiento no hay forma de ubicarla
        en el tiempo, y dejarla al final postergaría deuda por tiempo indefinido.
      - Una factura con saldo 0 o negativo se ignora (nunca se le aplica nada).
    """
    restante = money(amount)
    aplicaciones = []
    for f in sorted(facturas, key=lambda x: (str(x.get("due_date") or ""), str(x.get("name")))):
        if restante <= 0:
            break
        cupo = outstanding_of(f.get("outstanding"), 0, 0)
        if cupo <= 0:
            continue
        monto = money(min(cupo, restante))
        aplicaciones.append((f["name"], monto))
        restante = money(restante - monto)
    return aplicaciones


AGING_TRAMOS = ("corriente", "0-30", "31-60", "61-90", "+90")


def aging_buckets(facturas, today=None) -> dict:
    """Antigüedad de la deuda, por tramos de días desde el vencimiento.

    Lo que todavía no venció va a `corriente` (no es deuda vencida y sumarlo al tramo
    0-30 infla la mora). Base: NetSuite / QuickBooks.

    `today` es inyectable para poder testear sin depender del día real.

    Casos borde decididos:
      - Vencimiento hoy o en el futuro (días <= 0) → `corriente`.
      - Factura sin `due_date` → `corriente`: no hay vencimiento del que calcular mora.
      - Saldo 0 o negativo → se ignora (no suma a ningún tramo).
    """
    hoy = today or datetime.date.today()
    out = {t: Decimal("0") for t in AGING_TRAMOS}
    for f in facturas:
        saldo = outstanding_of(f.get("outstanding"), 0, 0)
        if saldo <= 0:
            continue
        if not f.get("due_date"):
            out["corriente"] += saldo
            continue
        dias = (hoy - f["due_date"]).days
        if dias <= 0:
            tramo = "corriente"
        elif dias <= 30:
            tramo = "0-30"
        elif dias <= 60:
            tramo = "31-60"
        elif dias <= 90:
            tramo = "61-90"
        else:
            tramo = "+90"
        out[tramo] += saldo
    return {k: money(v) for k, v in out.items()}
