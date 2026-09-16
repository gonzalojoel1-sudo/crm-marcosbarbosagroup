import hashlib
import json

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, nowdate

from crm_core import billing

FROZEN_STATUSES = ("Enviado", "Aceptado", "Rechazado", "Vencido")

TOTAL_FIELDS = (
    "total_one_time",
    "total_one_time_iva",
    "total_one_time_gross",
    "total_recurring_monthly",
    "total_recurring_monthly_iva",
    "total_recurring_monthly_gross",
    "discount_total",
    "recurring_summary",
)


class CRMPresupuesto(Document):
    def validate(self):
        self.set_interval_months()
        self.calculate_totals()
        self.guard_frozen()

    def set_interval_months(self):
        for it in self.items or []:
            it.interval_months = billing.interval_months(it.billing_type)

    def calculate_totals(self):
        """Los totales SIEMPRE se recalculan: nunca se aceptan de afuera."""
        totals = billing.quote_totals(
            [
                {
                    "qty": it.qty,
                    "rate": it.rate,
                    "discount_percentage": it.discount_percentage,
                    "billing_type": it.billing_type,
                }
                for it in (self.items or [])
            ],
            iva_mode=self.iva_mode or "sumar",
        )
        for key in TOTAL_FIELDS:
            setattr(self, key, totals[key])

        # Los importes de línea se persisten para que el PDF y los informes no
        # dependan de recalcular la fórmula en dos lugares distintos.
        for it in self.items or []:
            gross, net = billing.line_amounts(it.qty, it.rate, it.discount_percentage)
            it.amount = gross
            it.net_amount = net

    def guard_frozen(self):
        """Congelado: si ya salió del borrador, el contenido comercial no se toca.

        No bloquea las transiciones de estado legítimas (eso lo hacen las
        transiciones), sólo la edición del contenido comercial.
        """
        if self.is_new():
            return
        before = self.get_doc_before_save()
        if not before:
            return
        if before.status in FROZEN_STATUSES:
            # Sin mirar el estado nuevo a propósito: así también se cubre el guardado
            # que cambia el contenido Y el estado en la misma operación.
            # Se comparan HUELLAS, no los objetos: comparar listas de Document con
            # `!=` compara identidad (Frappe no define __eq__) y da siempre distinto,
            # lo que bloquearía hasta el guardado que baja is_current al versionar.
            if self.status == "Borrador":
                frappe.throw(
                    "Un presupuesto enviado no vuelve a borrador: creá una versión nueva."
                )
            comercial_antes = (
                billing.items_fingerprint(before.items),
                before.iva_mode,
                before.currency,
                (before.conditions or "").strip(),
            )
            comercial_ahora = (
                billing.items_fingerprint(self.items),
                self.iva_mode,
                self.currency,
                (self.conditions or "").strip(),
            )
            if comercial_ahora != comercial_antes:
                frappe.throw(
                    "Este presupuesto ya fue enviado y no se puede editar. "
                    "Creá una versión nueva para cambiarlo."
                )

    # ── Transiciones: la única vía de cambio de estado ──────────────────
    # No se edita `status` a mano: cada transición valida su origen y deja traza.

    def _assert_status(self, *allowed):
        if self.status not in allowed:
            frappe.throw(f"No se puede hacer esa acción desde el estado «{self.status}».")

    def send(self):
        self._assert_status("Borrador")
        if not (self.items or []):
            frappe.throw("El presupuesto no tiene ítems.")
        if self.valid_until and str(self.valid_until) < str(frappe.utils.nowdate()):
            frappe.throw("La fecha de validez ya pasó.")
        self.status = "Enviado"
        self.sent_on = frappe.utils.now()
        self.snapshot_hash = self._snapshot()
        self.save()

    def accept(self):
        self._assert_status("Enviado")
        self.status = "Aceptado"
        self.accepted_on = frappe.utils.now()
        self.save()
        # F4 crea acá las suscripciones de los ítems recurrentes.

    def reject(self, reason):
        self._assert_status("Enviado")
        if not (reason or "").strip():
            frappe.throw("Indicá el motivo del rechazo.")
        self.status = "Rechazado"
        self.rejected_on = frappe.utils.now()
        self.rejected_reason = reason.strip()
        self.save()

    def void(self):
        self._assert_status("Borrador", "Enviado", "Rechazado", "Vencido")
        self.status = "Anulado"
        self.save()

    def _snapshot(self):
        """Huella del contenido comercial al enviar (integridad documental)."""
        payload = json.dumps(
            {
                "deal": self.deal,
                "iva_mode": self.iva_mode,
                "currency": self.currency,
                "conditions": (self.conditions or "").strip(),
                "items": [
                    [it.description, it.billing_type, it.qty, it.rate, it.discount_percentage]
                    for it in (self.items or [])
                ],
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def new_version(deal):
    """Clona el presupuesto vigente del negocio como la versión siguiente, en borrador.

    Es el único camino para cambiar un presupuesto ya enviado.
    """
    actual = frappe.get_all(
        "CRM Presupuesto", filters={"deal": deal, "is_current": 1}, fields=["name"], limit=1
    )
    if not actual:
        frappe.throw("El negocio no tiene un presupuesto vigente.")
    origen = frappe.get_doc("CRM Presupuesto", actual[0].name)

    if origen.status == "Borrador":
        frappe.throw("El presupuesto vigente ya es un borrador: editalo en vez de versionar.")
    if origen.status not in ("Enviado", "Aceptado", "Rechazado"):
        frappe.throw(f"No se puede versionar un presupuesto en estado «{origen.status}».")

    for otro in frappe.get_all("CRM Presupuesto", filters={"deal": deal, "is_current": 1}, pluck="name"):
        frappe.db.set_value("CRM Presupuesto", otro, "is_current", 0)

    nuevo = frappe.copy_doc(origen)
    nuevo.status = "Borrador"
    nuevo.version = (origen.version or 1) + 1
    nuevo.is_current = 1
    nuevo.valid_until = add_days(nowdate(), billing.DEFAULT_VALIDITY_DAYS)
    nuevo.sent_on = None
    nuevo.accepted_on = None
    nuevo.rejected_on = None
    nuevo.rejected_reason = None
    nuevo.snapshot_hash = None
    nuevo.insert(ignore_permissions=True)
    return nuevo
