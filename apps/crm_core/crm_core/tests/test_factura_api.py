"""Contrato de la API de facturas. Requiere sitio Frappe (crm-test, NUNCA producción).

Este archivo lo corre el coordinador con el runner de `bench` sobre `crm-test`; el
`pytest` local de `apps/crm_core` no lo colecciona (ahí no hay sitio).
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from crm_core import api


class TestFacturaApi(FrappeTestCase):
    ORG = "Factura Test Org"

    def _org(self, organization_name=None):
        # `CRM Organization` se autonombra por `organization_name` y FrappeTestCase
        # comparte los datos dentro de la clase: hay que REUSAR la organizacion, no
        # crearla en cada test (si no, el segundo choca con el primero).
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

    def _factura(self, estado="Emitida", rate=100000):
        org = self._org()
        doc = api.create_invoice(org, [{"description": "Servicio", "qty": 1, "rate": rate}])
        f = frappe.get_doc("CRM Factura", doc["name"])
        if estado != "Borrador":
            f.issue()
        return frappe.get_doc("CRM Factura", doc["name"])

    # ── Alta ───────────────────────────────────────────────────────────
    def test_nace_en_borrador_con_totales_calculados(self):
        # rate=121000 CON iva_mode="incluido": el neto ya trae el IVA adentro,
        # o sea 100000 de neto + 21000 de IVA contenidos en 121000. Si la API
        # sumara el IVA sobre el 121000 (modo "sumar"), el total seria 146410.
        d = api.create_invoice(
            self._org(),
            [{"description": "x", "qty": 1, "rate": 121000}],
            iva_mode="incluido",
        )
        assert d["status"] == "Borrador"
        assert d["subtotal"] == 121000.0
        assert d["iva_amount"] == 21000.0
        assert d["total"] == 121000.0

    def test_create_invoice_sin_items_falla_en_espanol(self):
        with self.assertRaises(frappe.ValidationError) as ctx:
            api.create_invoice(self._org(), [{"description": "   "}])
        self.assertIn("ítem", str(ctx.exception))

    # ── Transiciones del controller, expuestas por la API ──────────────
    def test_emitir_fija_fechas_y_hash(self):
        f = self._factura("Borrador")
        f.issue()
        assert f.status == "Emitida"
        assert f.issue_date and f.due_date
        assert f.snapshot_hash

    def test_no_se_emite_sin_items(self):
        f = self._factura("Borrador")
        f.items = []
        with self.assertRaises(frappe.ValidationError):
            f.issue()

    def test_no_se_edita_una_emitida(self):
        f = self._factura()
        f.items[0].rate = 999999
        with self.assertRaises(frappe.ValidationError):
            f.save()

    def test_vencida_es_derivada_no_manual(self):
        org = self._org()
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue_date = add_days(nowdate(), -30)
        f.due_date = add_days(nowdate(), -5)
        f.issue()
        # El estado NO se seteo a mano: lo derivo el controller de la fecha pasada.
        assert f.status == "Vencida"
        # Y el endpoint expone ese estado derivado, no un campo que la UI invente.
        assert api.get_invoice(f.name)["status"] == "Vencida"

    def test_la_lectura_deriva_el_estado_aunque_la_cache_este_vieja(self):
        """El estado guardado es una cache; la lectura lo deriva (spec §5.1).

        Se emite una factura con vencimiento pasado y se fuerza el estado guardado a
        'Emitida' (como si el job diario no hubiera corrido): la lectura debe ver 'Vencida'.
        """
        org = self._org()
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue_date = add_days(nowdate(), -30)
        f.due_date = add_days(nowdate(), -5)
        f.issue()
        frappe.db.set_value("CRM Factura", f.name, "status", "Emitida")  # cache vieja a proposito
        assert api.get_invoice(f.name)["status"] == "Vencida"

    def test_el_filtro_por_estado_usa_el_derivado(self):
        """Filtrar 'Vencida' tiene que traer la factura vencida aunque la cache diga otra cosa."""
        org = self._org()
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue_date = add_days(nowdate(), -30)
        f.due_date = add_days(nowdate(), -5)
        f.issue()
        frappe.db.set_value("CRM Factura", f.name, "status", "Emitida")  # cache vieja
        assert f.name in [x["name"] for x in api.get_invoices(status="Vencida")["facturas"]]
        assert f.name not in [x["name"] for x in api.get_invoices(status="Pagada")["facturas"]]

    def test_no_se_anula_con_cobros_aplicados(self):
        f = self._factura()
        f.paid_amount = 1000
        f.save(ignore_permissions=True)  # para simular cobro sin la API de pagos
        with self.assertRaises(frappe.ValidationError):
            f.void()

    def test_issue_invoice_endpoint(self):
        d = api.create_invoice(self._org(), [{"description": "x", "qty": 1, "rate": 1000}])
        assert d["status"] == "Borrador"
        out = api.issue_invoice(d["name"])
        self.assertTrue(out["ok"])
        self.assertEqual(out["name"], d["name"])
        self.assertEqual(out["status"], "Emitida")
        doc = frappe.get_doc("CRM Factura", d["name"])
        self.assertEqual(doc.status, "Emitida")
        self.assertTrue(doc.issue_date and doc.due_date)

    def test_void_invoice_anula(self):
        f = self._factura()
        out = api.void_invoice(f.name)
        self.assertTrue(out["ok"])
        self.assertEqual(out["status"], "Anulada")
        self.assertEqual(frappe.db.get_value("CRM Factura", f.name, "status"), "Anulada")
        self.assertFalse(api.get_invoice(f.name)["is_editable"])

    def test_mark_invoice_uncollectible(self):
        org = self._org()
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue_date = add_days(nowdate(), -30)
        f.due_date = add_days(nowdate(), -5)
        f.issue()
        out = api.mark_invoice_uncollectible(f.name)
        self.assertTrue(out["ok"])
        self.assertEqual(out["status"], "Incobrable")
        self.assertEqual(api.get_invoice(f.name)["status"], "Incobrable")

    # ── Lectura ────────────────────────────────────────────────────────
    def test_get_invoices_filtra_por_estado(self):
        emitida = self._factura()
        anulada = self._factura()
        api.void_invoice(anulada.name)

        vigentes = {f["name"] for f in api.get_invoices(status="Emitida")["facturas"]}
        self.assertIn(emitida.name, vigentes)
        self.assertNotIn(anulada.name, vigentes)

        anuladas = {f["name"] for f in api.get_invoices(status="Anulada")["facturas"]}
        self.assertIn(anulada.name, anuladas)
        self.assertNotIn(emitida.name, anuladas)

    def test_get_invoice_inexistente_falla_en_espanol(self):
        with self.assertRaises(frappe.ValidationError) as ctx:
            api.get_invoice("F-1900-0001")
        self.assertIn("La factura no existe.", str(ctx.exception))

    def test_dto_deriva_editabilidad_y_dias_para_vencer(self):
        org = self._org()
        org_nombre = frappe.db.get_value("CRM Organization", org, "organization_name")
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])
        # Borrador, sin vencimiento: editable y sin cuenta de dias.
        self.assertTrue(d["is_editable"])
        self.assertIsNone(d["dias_para_vencer"])
        self.assertEqual(d["org"], org_nombre)
        self.assertTrue(d["sin_cae"])

        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue_date = nowdate()
        f.due_date = add_days(nowdate(), 15)
        f.issue()
        dto = api.get_invoice(f.name)
        self.assertFalse(dto["is_editable"])
        self.assertEqual(dto["dias_para_vencer"], 15)

    # ── Facturar desde un presupuesto ──────────────────────────────────
    def _presupuesto_aceptado(self, lead_name, rate=1000):
        org = self._org()
        deal = frappe.get_doc(
            {
                "doctype": "CRM Deal",
                "lead_name": lead_name,
                "status": "Qualification",
                "organization": org,
            }
        ).insert(ignore_permissions=True)
        p = frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": deal.name,
                "organization": org,
                "iva_mode": "sumar",
                "items": [{"description": "x", "qty": 1, "rate": rate}],
            }
        ).insert(ignore_permissions=True)
        p.send()
        p.accept()
        return p

    def test_facturar_un_presupuesto_aceptado(self):
        p = self._presupuesto_aceptado("Factura Test", rate=500000)
        d = api.create_invoice_from_quote(p.name)
        assert d["total"] == 605000.0
        assert d["presupuesto"] == p.name
        assert d["status"] == "Borrador"
        assert len(d["items"]) == 1

    def test_no_se_factura_dos_veces_el_mismo_presupuesto(self):
        p = self._presupuesto_aceptado("Factura Test 2")
        api.create_invoice_from_quote(p.name)
        with self.assertRaises(frappe.ValidationError):
            api.create_invoice_from_quote(p.name)

    def test_no_se_factura_un_presupuesto_no_aceptado(self):
        org = self._org()
        deal = frappe.get_doc(
            {
                "doctype": "CRM Deal",
                "lead_name": "Factura Test 3",
                "status": "Qualification",
                "organization": org,
            }
        ).insert(ignore_permissions=True)
        p = frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": deal.name,
                "organization": org,
                "iva_mode": "sumar",
                "items": [{"description": "x", "qty": 1, "rate": 1000}],
            }
        ).insert(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            api.create_invoice_from_quote(p.name)
