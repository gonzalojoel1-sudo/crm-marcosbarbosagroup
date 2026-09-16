import hashlib
import json

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, now, nowdate

from crm_core import billing

# Estados en los que una factura NO se edita (excepción: `due_date`, que el usuario
# pidió poder ajustar a mano).
FROZEN_STATUSES = ("Emitida", "Parcial", "Pagada", "Vencida", "Incobrable")

DEFAULT_DUE_DAYS = 15


class CRMFactura(Document):
    def validate(self):
        self.calculate_totals()
        self.guard_frozen()
        self.refresh_status()

    # ── Contenido ──────────────────────────────────────────────────────
    # (No hay `set_interval_months` como en el presupuesto: acá `billing_type` es
    # informativo —qué tipo de cargo es— y NO se normaliza a mensual, porque todos los
    # ítems de una factura están en la misma base de tiempo. Ver Task 1.)

    def calculate_totals(self):
        """Los totales SIEMPRE se recalculan: nunca se aceptan de afuera."""
        totals = billing.invoice_totals(
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
        for key, value in totals.items():
            setattr(self, key, value)
        for it in self.items or []:
            gross, net = billing.line_amounts(it.qty, it.rate, it.discount_percentage)
            it.amount = gross
            it.net_amount = net

    def guard_frozen(self):
        """Una factura emitida no se edita: se corrige con una nota de crédito.

        Se comparan HUELLAS (valores), no los objetos: comparar listas de Document con
        `!=` compara identidad y da siempre distinto (aprendido en F2).
        """
        if self.is_new():
            return
        before = self.get_doc_before_save()
        if not before or before.status not in FROZEN_STATUSES:
            return
        if self.status == "Borrador":
            frappe.throw("Una factura emitida no vuelve a borrador.")
        antes = (
            billing.items_fingerprint(before.items),
            before.iva_mode,
            before.currency,
            str(before.issue_date or ""),
        )
        ahora = (
            billing.items_fingerprint(self.items),
            self.iva_mode,
            self.currency,
            str(self.issue_date or ""),
        )
        if ahora != antes:
            frappe.throw(
                "Esta factura ya fue emitida y no se puede editar. "
                "Emití una nota de crédito para corregirla."
            )

    # ── Estado derivado ────────────────────────────────────────────────
    def refresh_status(self):
        """El ESTADO lo calcula `billing.invoice_status`. Nunca se setea a mano.

        Se llama en cada save: así, cobrar, acreditar o anular un pago deja el estado
        correcto sin que ningún handler tenga que acordarse de actualizarlo.

        `Borrador` y `Anulada` NO se derivan: son decisiones explícitas.
        - `Borrador` es el punto de partida y `invoice_status` no tiene esa rama (derivaría
          `Emitida`, que es mentir sobre una factura que todavía no se emitió).
        - `Anulada` no se revive sola.
        `issue()` deja el estado en `Emitida` antes de guardar, así que a partir de ahí la
        derivación funciona; y el recálculo de cobros (Task 7) también pasa por acá.
        """
        if self.status in ("Borrador", "Anulada"):
            return
        self.status = billing.invoice_status(
            self.total,
            self.paid_amount,
            self.credit_total,
            self.due_date,
            today=None,
            is_return=bool(self.is_return),
            is_uncollectible=self.status == "Incobrable",
        )
        if self.status == "Pagada" and not self.paid_on:
            self.paid_on = now()

    # ── Transiciones (la única vía de cambio de estado) ────────────────
    def _assert_status(self, *allowed):
        if self.status not in allowed:
            frappe.throw(f"No se puede hacer esa acción desde el estado «{self.status}».")

    def issue(self):
        self._assert_status("Borrador")
        if not (self.items or []):
            frappe.throw("La factura no tiene ítems.")
        self.issue_date = self.issue_date or nowdate()
        self.due_date = self.due_date or add_days(self.issue_date, DEFAULT_DUE_DAYS)
        self.status = "Emitida"
        self.snapshot_hash = self._snapshot()
        self.save()

    def mark_sent(self):
        self._assert_status("Emitida")
        self.sent_on = now()
        self.save()

    def void(self):
        self._assert_status("Borrador", "Emitida", "Parcial", "Vencida", "Incobrable")
        if billing.dec(self.paid_amount) > 0 or billing.dec(self.credit_total) > 0:
            frappe.throw(
                "No se puede anular una factura con cobros o créditos aplicados: "
                "liberá los pagos primero."
            )
        self.status = "Anulada"
        self.voided_on = now()
        self.save()

    def mark_uncollectible(self):
        self._assert_status("Emitida", "Parcial", "Vencida")
        self.status = "Incobrable"
        self.marked_uncollectible_on = now()
        self.save()

    def _snapshot(self):
        payload = json.dumps(
            {
                "organization": self.organization,
                "iva_mode": self.iva_mode,
                "currency": self.currency,
                "items": [
                    [it.description, it.billing_type, it.qty, it.rate, it.discount_percentage]
                    for it in (self.items or [])
                ],
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
