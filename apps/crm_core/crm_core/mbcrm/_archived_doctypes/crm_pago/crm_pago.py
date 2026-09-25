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
        self.validate_kind()
        self.validate_aplicaciones()
        self.guard_aplicaciones()
        self.calculate_derived()

    def validate_kind(self):
        """El signo tiene que ser coherente con el tipo de movimiento.

        `Cobro` (entra plata) y `Crédito` (excedente de una nota de crédito) van en 0 o
        positivo; `Devolución` (plata que sale) va en 0 o negativo.
        """
        monto = billing.dec(self.amount)
        if self.kind in ("Cobro", "Crédito") and monto < 0:
            frappe.throw("Un Cobro o un Crédito no puede tener monto negativo.")
        if self.kind == "Devolución" and monto > 0:
            frappe.throw("Una Devolución debe tener monto negativo: es plata que sale.")

    def _aplicaciones_previas(self):
        """Nombres de las filas de aplicación YA persistidas (las que se re-guardan)."""
        if self.is_new():
            return set()
        before = self.get_doc_before_save()
        if not before:
            return set()
        return {a.name for a in (before.applications or []) if a.name}

    def validate_aplicaciones(self):
        """Guardas del spec §6: misma organización y moneda, no cobrar borradores/anuladas,
        y no aplicar a una factura más que su saldo pendiente."""
        previas = self._aplicaciones_previas()
        for ap in self.applications or []:
            if not ap.factura:
                continue
            if billing.dec(ap.applied_amount) < 0:
                frappe.throw("El monto aplicado no puede ser negativo.")
            f = frappe.db.get_value(
                "CRM Factura",
                ap.factura,
                ["organization", "currency", "status"],
                as_dict=True,
            )
            if not f:
                frappe.throw(f"La factura {ap.factura} no existe.")
            if f.organization != self.organization:
                frappe.throw("Sólo se puede aplicar un pago a facturas del mismo cliente.")
            if not f.currency or not self.currency:
                frappe.throw("El pago y la factura deben tener moneda para poder aplicar.")
            if f.currency != self.currency:
                frappe.throw("Sólo se puede aplicar un pago a facturas de la misma moneda.")
            if f.status == "Anulada":
                frappe.throw(f"La factura {ap.factura} está anulada.")
            if f.status == "Borrador":
                # Una factura en borrador no se cobra: el estado `Borrador` no se deriva
                # (es una decisión explícita del documento), así que cobrarla la dejaría en
                # borrador CON saldo — un estado que miente. Hay que emitirla primero.
                frappe.throw(f"La factura {ap.factura} está en borrador: emitila antes de cobrarla.")

        # Tope por factura (spec §6), por SUMA: dos filas a la misma factura se validan juntas.
        # Fila por fila, 100000 + 30000 contra un saldo de 121000 pasa por separado y el exceso
        # se pierde (saldo clampado a 0). Sólo se suman las filas NUEVAS: una fila persistida ya
        # está descontada del saldo guardado (y no se puede cambiar: `guard_aplicaciones`).
        por_factura = {}
        for ap in self.applications or []:
            if not ap.factura or (ap.name and ap.name in previas):
                continue
            por_factura[ap.factura] = por_factura.get(ap.factura, billing.dec(0)) + billing.dec(
                ap.applied_amount
            )
        for factura, suma in por_factura.items():
            saldo = billing.dec(frappe.db.get_value("CRM Factura", factura, "outstanding"))
            if suma > saldo:
                frappe.throw(
                    f"El monto aplicado a {factura} ({billing.fmt_money(suma)}) "
                    f"supera su saldo pendiente ({billing.fmt_money(saldo)})."
                )

        try:
            billing.validar_aplicaciones(
                self.amount, [(a.factura, a.applied_amount) for a in (self.applications or [])]
            )
        except ValueError as e:
            frappe.throw(str(e))

    def guard_aplicaciones(self):
        """Un pago guardado no reescribe sus aplicaciones: se anula y se carga otro.

        Se permite QUITAR filas (liberar una factura) — para eso está `remove_application`— y
        AGREGAR filas nuevas (aplicar el saldo a cuenta, vía `aplicar_a`/`apply_payment`, que
        marcan `flags.aplicaciones_programaticas`). Lo que NO se permite es cambiar la factura
        o el monto de una fila ya existente —eso reescribe historia contable en silencio— ni
        agregar filas por edición directa.
        """
        if self.is_new() or self.flags.get("aplicaciones_programaticas"):
            return
        before = self.get_doc_before_save()
        if not before:
            return
        previas = {
            a.name: (a.factura, billing.money(a.applied_amount))
            for a in (before.applications or [])
            if a.name
        }
        for a in self.applications or []:
            if not a.name or a.name not in previas:
                frappe.throw(
                    "No se pueden agregar aplicaciones a un pago registrado por edición "
                    "directa. Aplicá el saldo a cuenta o anulá el pago y cargá uno nuevo."
                )
            if previas[a.name] != (a.factura, billing.money(a.applied_amount)):
                frappe.throw(
                    "No se pueden cambiar las aplicaciones de un pago registrado. "
                    "Quitá la aplicación o anulá el pago y cargá uno nuevo."
                )

    def calculate_derived(self):
        aplicado = billing.money(
            sum((billing.dec(a.applied_amount) for a in (self.applications or [])), billing.dec(0))
        )
        self.applied_amount = aplicado
        self.unapplied_amount = billing.money(billing.dec(self.amount) - aplicado)

    def on_update(self):
        """Recalcula las facturas afectadas: las de AHORA y las de ANTES.

        Si se quita o se cambia una aplicación, la factura que se dejó de tocar también
        necesita recalcularse; mirar sólo las actuales deja su saldo viejo.
        """
        facturas = {a.factura for a in (self.applications or []) if a.factura}
        before = self.get_doc_before_save()
        if before:
            facturas |= {a.factura for a in (before.applications or []) if a.factura}
        for f in facturas:
            recalcular_factura(f)

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
        # Agregar filas a un pago guardado es una operación programática legítima (aplicar
        # saldo a cuenta), no una reescritura de historia: `guard_aplicaciones` la permite
        # sólo con este flag.
        self.flags.aplicaciones_programaticas = True
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
