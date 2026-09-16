import frappe
from frappe.model.document import Document

from crm_core import billing


def recalcular_factura(factura_name):
    """ÚNICO lugar que escribe paid_amount / credit_total / outstanding de una factura.

    LEE las aplicaciones de los pagos registrados (no recibe montos): así ningún handler
    puede pasarle un número equivocado, y la única fuente de verdad son las aplicaciones.

    Lo llaman los hooks de CRM Pago, CRM Pago Aplicacion y (en F3.3) la nota de crédito.
    NUNCA se escribe `outstanding` a mano en un endpoint.
    """
    if not factura_name or not frappe.db.exists("CRM Factura", factura_name):
        return
    f = frappe.get_doc("CRM Factura", factura_name)

    pagado = frappe.db.sql(
        """
        select coalesce(sum(a.applied_amount), 0)
        from `tabCRM Pago Aplicacion` a
        join `tabCRM Pago` p on p.name = a.parent
        where a.factura = %s and p.status = 'Registrado' and p.kind = 'Cobro'
        """,
        factura_name,
    )[0][0]

    credito = frappe.db.sql(
        """
        select coalesce(sum(a.applied_amount), 0)
        from `tabCRM Pago Aplicacion` a
        join `tabCRM Pago` p on p.name = a.parent
        where a.factura = %s and p.status = 'Registrado' and p.kind = 'Crédito'
        """,
        factura_name,
    )[0][0]

    f.db_set("paid_amount", billing.money(pagado), update_modified=False)
    f.db_set("credit_total", billing.money(credito), update_modified=False)
    f.db_set(
        "outstanding",
        billing.outstanding_of(f.total, pagado, credito),
        update_modified=False,
    )
    f.reload()
    f.refresh_status()
    f.db_set("status", f.status, update_modified=False)
    f.db_set("paid_on", f.paid_on, update_modified=False)


def recalcular_desde_hijo(doc, method=None):
    """El hijo no sabe de qué pago cuelga: se recalcula la factura afectada."""
    if doc.factura:
        recalcular_factura(doc.factura)


class CRMPago(Document):
    def validate(self):
        self.validate_aplicaciones()
        self.calculate_derived()

    def validate_aplicaciones(self):
        """Guardas del spec §6: mismas organización y moneda, y no sobreaplicar."""
        facturas = []
        for ap in self.applications or []:
            if not ap.factura:
                continue
            f = frappe.db.get_value(
                "CRM Factura",
                ap.factura,
                ["organization", "currency", "status", "outstanding"],
                as_dict=True,
            )
            if not f:
                frappe.throw(f"La factura {ap.factura} no existe.")
            if f.organization != self.organization:
                frappe.throw("Sólo se puede aplicar un pago a facturas del mismo cliente.")
            if f.currency and self.currency and f.currency != self.currency:
                frappe.throw("Sólo se puede aplicar un pago a facturas de la misma moneda.")
            if f.status == "Anulada":
                frappe.throw(f"La factura {ap.factura} está anulada.")
            if f.status == "Borrador":
                # Una factura en borrador no se cobra: el estado `Borrador` no se deriva
                # (es una decisión explícita del documento), así que cobrarla la dejaría en
                # borrador CON saldo — un estado que miente. Hay que emitirla primero.
                frappe.throw(f"La factura {ap.factura} está en borrador: emitila antes de cobrarla.")
            facturas.append(ap.factura)

        try:
            billing.validar_aplicaciones(
                self.amount, [(a.factura, a.applied_amount) for a in (self.applications or [])]
            )
        except ValueError as e:
            frappe.throw(str(e))

    def calculate_derived(self):
        aplicado = billing.money(
            sum((billing.dec(a.applied_amount) for a in (self.applications or [])), billing.dec(0))
        )
        self.applied_amount = aplicado
        self.unapplied_amount = billing.money(billing.dec(self.amount) - aplicado)

    def on_update(self):
        self.recalcular_todas()

    def after_insert(self):
        self.recalcular_todas()

    def on_trash(self):
        """Captura las facturas afectadas ANTES de que Frappe borre las filas hijas.

        `after_delete` corre después del borrado, cuando `self.applications` ya no tiene las
        filas, así que los nombres hay que dejarlos guardados acá.
        """
        self.flags.facturas_a_recalcular = [
            ap.factura for ap in (self.applications or []) if ap.factura
        ]

    def after_delete(self):
        """El recálculo va DESPUÉS del borrado: `on_trash` corre ANTES de que Frappe borre
        las filas hijas, así que la consulta de aplicaciones todavía las encuentra y
        reescribe el mismo valor (la factura se quedaba cobrada)."""
        for factura in self.flags.get("facturas_a_recalcular") or []:
            recalcular_factura(factura)

    def recalcular_todas(self):
        for ap in self.applications or []:
            recalcular_factura(ap.factura)

    def aplicar_a(self, facturas):
        """Reparte el saldo A CUENTA del pago entre facturas candidatas, FIFO por vencimiento.

        Reusa `billing.reparto_fifo`, así que el reparto es por `due_date` de la más vieja a
        la más nueva (las facturas sin vencimiento ordenan primero). El pool es el
        remanente del pago (`amount − applied_amount`), no el monto total: aplicar sobre lo
        ya aplicado duplicaría el mismo peso.

        `facturas` son dicts con `name`, `outstanding` y `due_date` —lo que consume
        `reparto_fifo`— YA filtrados por organización y moneda: esa guarda vive en la capa
        que llama, porque `reparto_fifo` es pura y no conoce clientes. `reparto_fifo` sólo
        asigna hasta el saldo de cada factura, y `validate_aplicaciones` (que corre al
        guardar) rechaza sobreaplicar el pago: las dos guardas cubren el sobrepago.

        Agrega las aplicaciones al pago y guarda; el recálculo de saldos lo disparan los
        hooks, no acá.
        """
        aplicado = billing.money(
            sum((billing.dec(a.applied_amount) for a in (self.applications or [])), billing.dec(0))
        )
        disponible = billing.money(billing.dec(self.amount) - aplicado)
        for nombre, monto in billing.reparto_fifo(disponible, facturas):
            self.append("applications", {"factura": nombre, "applied_amount": monto})
        self.save(ignore_permissions=True)

    def void(self):
        """Anular un pago deshace sus aplicaciones y las facturas vuelven a su estado."""
        if self.status == "Anulado":
            frappe.throw("Este pago ya está anulado.")
        facturas = [a.factura for a in (self.applications or [])]
        self.status = "Anulado"
        self.set("applications", [])
        self.applied_amount = 0
        self.unapplied_amount = billing.money(self.amount)
        self.save(ignore_permissions=True)
        for f in facturas:
            recalcular_factura(f)
