import hashlib
import json

import frappe
from frappe.model.document import Document

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

        No bloquea el cambio de estado (eso lo hacen las transiciones), sólo la
        edición de los ítems.
        """
        if self.is_new():
            return
        before = self.get_doc_before_save()
        if not before:
            return
        if before.status in FROZEN_STATUSES and self.status == before.status:
            if self.get("items") != before.get("items"):
                frappe.throw(
                    "Este presupuesto ya fue enviado y no se puede editar. "
                    "Creá una versión nueva para cambiarlo."
                )
