"""Contrato del punto único de recálculo de saldos (Task 7).

Se corre con el runner de `bench` sobre el sitio `crm-test` (NUNCA producción): el
`pytest` local de `apps/crm_core` no lo colecciona porque `testpaths = tests` y este
archivo vive dentro del paquete `crm_core`.

Lo que se prueba acá es el corazón de la cobranza: `recalcular_factura` **lee** las
aplicaciones de los pagos registrados y escribe `paid_amount` / `credit_total` /
`outstanding`; ningún handler pasa montos. Los hooks del controller
(`on_update` / `after_insert` / `on_trash`) son los que garantizan que ninguna vía de
escritura deje el saldo viejo.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from crm_core import api
from crm_core.mbcrm.doctype.crm_pago.crm_pago import recalcular_factura


class TestPagoRecalculo(FrappeTestCase):
    ORG = "Pago Recalculo Test Org"

    # ── Helpers ────────────────────────────────────────────────────────
    def _org(self, organization_name=None):
        # `CRM Organization` se autonombra por `organization_name` y FrappeTestCase
        # comparte los datos dentro de la clase: se REUSA la organización.
        organization_name = organization_name or self.ORG
        existente = frappe.db.get_value(
            "CRM Organization", {"organization_name": organization_name}, "name"
        )
        if existente:
            return existente
        return (
            frappe.get_doc(
                {"doctype": "CRM Organization", "organization_name": organization_name}
            )
            .insert(ignore_permissions=True)
            .name
        )

    def _moneda(self, code):
        if not frappe.db.exists("Currency", code):
            frappe.get_doc(
                {"doctype": "Currency", "currency_name": code, "enabled": 1}
            ).insert(ignore_permissions=True)
        return code

    def _factura(self, rate=100000, org=None, currency=None, due_date=None):
        org = org or self._org()
        d = api.create_invoice(
            org,
            [{"description": "Servicio", "qty": 1, "rate": rate}],
            currency=currency or self._moneda("ARS"),
            due_date=due_date,
        )
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue()
        return frappe.get_doc("CRM Factura", d["name"])

    def _borrador(self, org=None, currency=None):
        org = org or self._org()
        d = api.create_invoice(
            org,
            [{"description": "Servicio", "qty": 1, "rate": 1000}],
            currency=currency or self._moneda("ARS"),
        )
        return frappe.get_doc("CRM Factura", d["name"])

    def _pago(self, amount, applications=None, kind="Cobro", org=None, currency=None):
        doc = frappe.get_doc(
            {
                "doctype": "CRM Pago",
                "organization": org or self._org(),
                "kind": kind,
                "payment_date": nowdate(),
                "amount": amount,
                "currency": currency or self._moneda("ARS"),
                "applications": applications or [],
            }
        )
        doc.insert(ignore_permissions=True)
        return doc

    # ── El recálculo escribe los saldos ────────────────────────────────
    def test_pago_parcial_escribe_saldos_y_deriva_parcial(self):
        f = self._factura(100000)  # total 121000
        self._pago(40000, [{"factura": f.name, "applied_amount": 40000}])
        f.reload()
        self.assertEqual(f.paid_amount, 40000.0)
        self.assertEqual(f.credit_total, 0.0)
        self.assertEqual(f.outstanding, 81000.0)
        self.assertEqual(f.status, "Parcial")

    def test_pago_total_deriva_pagada_y_sella_paid_on(self):
        f = self._factura(100000)
        self._pago(121000, [{"factura": f.name, "applied_amount": 121000}])
        f.reload()
        self.assertEqual(f.outstanding, 0.0)
        self.assertEqual(f.status, "Pagada")
        self.assertTrue(f.paid_on)

    def test_un_pago_cubre_varias_facturas(self):
        f1 = self._factura(50000)
        f2 = self._factura(50000)
        self._pago(
            121000,
            [
                {"factura": f1.name, "applied_amount": 60500},
                {"factura": f2.name, "applied_amount": 60500},
            ],
        )
        f1.reload()
        f2.reload()
        self.assertEqual(f1.status, "Pagada")
        self.assertEqual(f2.status, "Pagada")
        self.assertEqual(f1.outstanding, 0.0)
        self.assertEqual(f2.outstanding, 0.0)

    def test_el_credito_no_es_un_cobro(self):
        """Una nota de crédito al 100% deja `outstanding` en 0 pero NO es `Pagada`.

        Es la corrección de la auditoría (§5.1): `Pagada` exige que haya entrado plata.
        Un `kind = Crédito` baja el saldo sin contar como cobro.
        """
        f = self._factura(100000)
        self._pago(121000, [{"factura": f.name, "applied_amount": 121000}], kind="Crédito")
        f.reload()
        self.assertEqual(f.credit_total, 121000.0)
        self.assertEqual(f.paid_amount, 0.0)
        self.assertEqual(f.outstanding, 0.0)
        self.assertEqual(f.status, "Emitida")

    def test_recalcular_lee_las_aplicaciones_y_no_confia_en_el_valor_guardado(self):
        """El campo guardado es basura si no sale de las aplicaciones: se corrige."""
        f = self._factura(100000)
        self._pago(40000, [{"factura": f.name, "applied_amount": 40000}])
        frappe.db.set_value("CRM Factura", f.name, "paid_amount", 999999)  # basura a proposito
        recalcular_factura(f.name)
        f.reload()
        self.assertEqual(f.paid_amount, 40000.0)
        self.assertEqual(f.outstanding, 81000.0)

    def test_un_pago_a_cuenta_no_toca_ninguna_factura(self):
        f = self._factura(100000)
        p = self._pago(50000)  # sin aplicaciones
        self.assertEqual(p.applied_amount, 0.0)
        self.assertEqual(p.unapplied_amount, 50000.0)
        f.reload()
        self.assertEqual(f.paid_amount, 0.0)
        self.assertEqual(f.outstanding, 121000.0)

    # ── Anular / borrar devuelven el saldo ─────────────────────────────
    def test_anular_un_pago_devuelve_el_saldo(self):
        f = self._factura(100000)
        p = self._pago(121000, [{"factura": f.name, "applied_amount": 121000}])
        f.reload()
        self.assertEqual(f.status, "Pagada")

        p.void()
        f.reload()
        self.assertEqual(p.status, "Anulado")
        self.assertEqual(f.paid_amount, 0.0)
        self.assertEqual(f.outstanding, 121000.0)
        self.assertEqual(f.status, "Emitida")

    def test_borrar_un_pago_recalcula_por_on_trash(self):
        f = self._factura(100000)
        p = self._pago(121000, [{"factura": f.name, "applied_amount": 121000}])
        f.reload()
        self.assertEqual(f.outstanding, 0.0)

        p.delete(ignore_permissions=True)
        f.reload()
        self.assertEqual(f.paid_amount, 0.0)
        self.assertEqual(f.outstanding, 121000.0)

    def test_un_pago_anulado_no_suma_para_otro_pago(self):
        f = self._factura(100000)
        p1 = self._pago(50000, [{"factura": f.name, "applied_amount": 50000}])
        self._pago(50000, [{"factura": f.name, "applied_amount": 50000}])
        f.reload()
        self.assertEqual(f.paid_amount, 100000.0)

        p1.void()
        f.reload()
        self.assertEqual(f.paid_amount, 50000.0)
        self.assertEqual(f.outstanding, 71000.0)
        self.assertEqual(f.status, "Parcial")

    # ── Guardas de validación ──────────────────────────────────────────
    def test_no_se_sobreaplica_un_pago(self):
        f = self._factura(100000)
        with self.assertRaises(frappe.ValidationError):
            self._pago(1000, [{"factura": f.name, "applied_amount": 5000}])

    def test_no_se_aplica_a_otra_organizacion(self):
        f = self._factura(100000)
        otra = self._org("Pago Recalculo Otra Org")
        with self.assertRaises(frappe.ValidationError):
            self._pago(50000, [{"factura": f.name, "applied_amount": 50000}], org=otra)

    def test_no_se_aplica_a_otra_moneda(self):
        f = self._factura(100000, currency=self._moneda("ARS"))
        with self.assertRaises(frappe.ValidationError):
            self._pago(
                50000,
                [{"factura": f.name, "applied_amount": 50000}],
                currency=self._moneda("USD"),
            )

    def test_no_se_aplica_a_una_factura_anulada(self):
        f = self._factura(100000)
        f.void()
        with self.assertRaises(frappe.ValidationError):
            self._pago(50000, [{"factura": f.name, "applied_amount": 50000}])

    def test_no_se_aplica_a_una_factura_en_borrador(self):
        f = self._borrador()
        with self.assertRaises(frappe.ValidationError):
            self._pago(500, [{"factura": f.name, "applied_amount": 500}])

    def test_una_devolucion_no_puede_tener_aplicaciones(self):
        f = self._factura(100000)
        with self.assertRaises(frappe.ValidationError):
            self._pago(
                -5000,
                [{"factura": f.name, "applied_amount": 5000}],
                kind="Devolución",
            )

    # ── Aplicar a cuenta por FIFO ──────────────────────────────────────
    def test_aplicar_a_reparte_fifo_por_vencimiento(self):
        vieja = self._factura(100000, due_date=add_days(nowdate(), -20))
        nueva = self._factura(100000, due_date=add_days(nowdate(), -5))
        p = self._pago(100000)
        p.aplicar_a(
            [
                {"name": vieja.name, "outstanding": 121000, "due_date": vieja.due_date},
                {"name": nueva.name, "outstanding": 121000, "due_date": nueva.due_date},
            ]
        )
        vieja.reload()
        nueva.reload()
        self.assertEqual(vieja.paid_amount, 100000.0)
        self.assertEqual(nueva.paid_amount, 0.0)
        self.assertEqual(nueva.outstanding, 121000.0)

    def test_aplicar_a_sin_monto_no_aplica_nada(self):
        f = self._factura(100000)
        p = self._pago(0)
        p.aplicar_a([{"name": f.name, "outstanding": 121000, "due_date": f.due_date}])
        f.reload()
        self.assertEqual(len(p.applications or []), 0)
        self.assertEqual(f.outstanding, 121000.0)

    def test_recalcular_una_factura_inexistente_no_explota(self):
        recalcular_factura("F-1900-9999")  # no hace nada, no levanta
