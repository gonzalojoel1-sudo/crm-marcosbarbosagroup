"""Contrato de la API del presupuesto. Requiere sitio Frappe (crm-test, NUNCA producción)."""
import frappe
from frappe.tests.utils import FrappeTestCase

from crm_core import api


class TestPresupuestoAPI(FrappeTestCase):
    ORG = "Test F2 API Org"

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
        return frappe.get_doc(
            {"doctype": "CRM Organization", "organization_name": organization_name}
        ).insert(ignore_permissions=True).name

    def _deal(self, organization=True, lead_name="Test F2 API"):
        # `status` es REQD en CRM Deal (Link a CRM Deal Status) y el inicial del
        # embudo es Qualification.
        values = {
            "doctype": "CRM Deal",
            "lead_name": lead_name,
            "status": "Qualification",
        }
        if organization:
            values["organization"] = self._org()
        return frappe.get_doc(values).insert(ignore_permissions=True)

    def _items(self):
        # Un cobro Único y un abono Mensual: bases de tiempo distintas a propósito.
        return [
            {
                "description": "Implementación",
                "billing_type": "Único",
                "qty": 1,
                "rate": 850000,
            },
            {
                "description": "Abono mensual",
                "billing_type": "Mensual",
                "qty": 1,
                "rate": 210000,
            },
        ]

    def test_save_quote_crea_borrador_version_1(self):
        deal = self._deal()
        res = api.save_quote(deal.name, self._items(), "sumar")
        self.assertEqual(res["status"], "Borrador")
        self.assertEqual(res["version"], 1)
        self.assertRegex(res["name"], r"^P-\d{4}-\d+$")
        self.assertEqual(res["totals"]["one_time_gross"], 1028500)
        self.assertEqual(res["totals"]["recurring_gross"], 254100)

        doc = frappe.get_doc("CRM Presupuesto", res["name"])
        self.assertEqual(doc.status, "Borrador")
        self.assertEqual(doc.is_current, 1)
        self.assertEqual(doc.version, 1)
        self.assertEqual(doc.deal, deal.name)

    def test_los_items_distinguen_cobro(self):
        deal = self._deal()
        res = api.save_quote(deal.name, self._items(), "sumar")
        doc = frappe.get_doc("CRM Presupuesto", res["name"])
        self.assertEqual(doc.total_one_time, 850000)
        self.assertEqual(doc.total_one_time_gross, 1028500)
        self.assertEqual(doc.total_recurring_monthly, 210000)
        self.assertEqual(doc.total_recurring_monthly_gross, 254100)
        self.assertEqual(
            sorted(it.billing_type for it in doc.items), ["Mensual", "Único"]
        )

    def test_save_quote_dos_veces_edita_el_mismo(self):
        deal = self._deal()
        first = api.save_quote(deal.name, self._items(), "sumar")
        second = api.save_quote(deal.name, self._items(), "sumar")

        self.assertEqual(second["name"], first["name"])
        self.assertEqual(second["version"], 1)
        self.assertEqual(frappe.db.count("CRM Presupuesto", {"deal": deal.name}), 1)
        doc = frappe.get_doc("CRM Presupuesto", first["name"])
        self.assertEqual(len(doc.items), 2)
        self.assertEqual(doc.total_one_time_gross, 1028500)

    def test_get_deal_devuelve_el_quote(self):
        deal = self._deal()
        res = api.save_quote(deal.name, self._items(), "sumar")
        quote = api.get_deal(deal.name)["quote"]

        self.assertEqual(quote["name"], res["name"])
        self.assertEqual(quote["version"], 1)
        self.assertEqual(quote["status"], "Borrador")
        self.assertTrue(quote["is_editable"])
        self.assertEqual(quote["iva_mode"], "sumar")
        self.assertEqual(
            set(quote["totals"]),
            {
                "one_time_net",
                "one_time_iva",
                "one_time_gross",
                "recurring_net",
                "recurring_iva",
                "recurring_gross",
                "discount",
            },
        )
        self.assertEqual(quote["totals"]["one_time_gross"], 1028500)
        self.assertEqual(quote["totals"]["recurring_gross"], 254100)
        self.assertEqual(len(quote["items"]), 2)
        self.assertEqual(
            {it["billing_type"] for it in quote["items"]}, {"Único", "Mensual"}
        )

    def test_get_deal_sin_presupuesto_devuelve_quote_none(self):
        deal = self._deal()
        self.assertIsNone(api.get_deal(deal.name)["quote"])

    def test_send_quote_cambia_estado_y_congela(self):
        deal = self._deal()
        res = api.save_quote(deal.name, self._items(), "sumar")
        out = api.send_quote(res["name"])
        self.assertEqual(out["status"], "Enviado")

        quote = api.get_deal(deal.name)["quote"]
        self.assertEqual(quote["status"], "Enviado")
        self.assertFalse(quote["is_editable"])

    def test_save_quote_despues_de_enviar_versiona(self):
        deal = self._deal()
        v1 = api.save_quote(deal.name, self._items(), "sumar")
        api.send_quote(v1["name"])
        v2 = api.save_quote(deal.name, self._items(), "sumar")

        self.assertNotEqual(v2["name"], v1["name"])
        self.assertEqual(v2["version"], 2)
        self.assertEqual(v2["status"], "Borrador")
        self.assertEqual(frappe.db.get_value("CRM Presupuesto", v1["name"], "is_current"), 0)
        self.assertEqual(frappe.db.get_value("CRM Presupuesto", v2["name"], "is_current"), 1)
        self.assertEqual(api.get_deal(deal.name)["quote"]["name"], v2["name"])

    def test_accept_quote_sobre_borrador_falla_y_sobre_enviado_funciona(self):
        deal = self._deal()
        res = api.save_quote(deal.name, self._items(), "sumar")
        with self.assertRaises(frappe.ValidationError):
            api.accept_quote(res["name"])

        api.send_quote(res["name"])
        out = api.accept_quote(res["name"])
        self.assertEqual(out["status"], "Aceptado")
        self.assertEqual(
            frappe.db.get_value("CRM Presupuesto", res["name"], "status"), "Aceptado"
        )

    def test_reject_quote_exige_motivo(self):
        deal = self._deal()
        res = api.save_quote(deal.name, self._items(), "sumar")
        api.send_quote(res["name"])

        with self.assertRaises(frappe.ValidationError):
            api.reject_quote(res["name"], "   ")

        out = api.reject_quote(res["name"], "Precio muy alto")
        self.assertEqual(out["status"], "Rechazado")
        doc = frappe.get_doc("CRM Presupuesto", res["name"])
        self.assertEqual(doc.status, "Rechazado")
        self.assertEqual(doc.rejected_reason, "Precio muy alto")
        self.assertTrue(doc.rejected_on)

    def test_sin_organizacion_resuelve_una(self):
        deal = self._deal(organization=False, lead_name="Test F2 Sin Org")
        self.assertFalse(deal.organization)

        res = api.save_quote(deal.name, self._items(), "sumar")
        org = frappe.db.get_value("CRM Presupuesto", res["name"], "organization")
        self.assertTrue(org)
        self.assertEqual(
            frappe.db.get_value("CRM Organization", org, "organization_name"),
            "Test F2 Sin Org",
        )

    def test_save_quote_sin_items_falla_en_espanol(self):
        deal = self._deal()
        with self.assertRaises(frappe.ValidationError) as ctx:
            api.save_quote(deal.name, [], "sumar")
        self.assertIn("ítem", str(ctx.exception))
        self.assertEqual(frappe.db.count("CRM Presupuesto", {"deal": deal.name}), 0)

    def test_sin_organizacion_no_duplica_al_guardar_dos_veces(self):
        deal = self._deal(organization=False, lead_name="Test F2 Dup Org")
        api.save_quote(deal.name, self._items(), "sumar")
        api.save_quote(deal.name, self._items(), "sumar")
        self.assertEqual(
            frappe.db.count(
                "CRM Organization", {"organization_name": "Test F2 Dup Org"}
            ),
            1,
        )

    def test_new_quote_version_desde_un_enviado(self):
        deal = self._deal()
        v1 = api.save_quote(deal.name, self._items(), "sumar")
        api.send_quote(v1["name"])

        nueva = api.new_quote_version(deal.name)
        self.assertEqual(nueva["version"], 2)
        self.assertEqual(frappe.db.get_value("CRM Presupuesto", v1["name"], "is_current"), 0)
        vigente = frappe.db.get_value(
            "CRM Presupuesto", {"deal": deal.name, "is_current": 1}, "name"
        )
        self.assertEqual(vigente, nueva["name"])

    def test_quote_pdf_de_un_negocio_sin_presupuesto_falla_en_espanol(self):
        deal = self._deal()
        with self.assertRaises(frappe.ValidationError) as ctx:
            api.quote_pdf(deal.name)
        self.assertIn("El negocio no tiene un presupuesto cargado.", str(ctx.exception))

    def test_get_deals_marca_has_quote(self):
        con = self._deal()
        api.save_quote(con.name, self._items(), "sumar")
        sin = self._deal()

        deals = {d["name"]: d for d in api.get_deals()["deals"]}
        self.assertTrue(deals[con.name]["has_quote"])
        self.assertFalse(deals[sin.name]["has_quote"])

    def _vertical(self, nombre, activo=1, orden=0):
        existente = frappe.db.exists("CRM Vertical", nombre)
        if existente:
            return existente
        doc = frappe.get_doc(
            {"doctype": "CRM Vertical", "nombre": nombre, "activo": activo, "orden": orden}
        )
        doc.insert(ignore_permissions=True)
        return doc.name

    def test_get_deal_expone_la_vertical_del_presupuesto(self):
        deal = self._deal()
        self._vertical("Servicios")
        api.save_quote(deal.name, self._items(), "sumar", vertical="Servicios")

        quote = api.get_deal(deal.name)["quote"]
        self.assertEqual(quote["vertical"], "Servicios")

    def test_save_quote_persiste_la_vertical(self):
        deal = self._deal()
        self._vertical("Servicios")
        res = api.save_quote(deal.name, self._items(), "sumar", vertical="Servicios")

        self.assertEqual(
            frappe.db.get_value("CRM Presupuesto", res["name"], "vertical"), "Servicios"
        )
        self.assertEqual(api.get_deal(deal.name)["quote"]["vertical"], "Servicios")

    def test_save_quote_conserva_o_limpia_la_vertical(self):
        deal = self._deal()
        self._vertical("Servicios")
        api.save_quote(deal.name, self._items(), "sumar", vertical="Servicios")

        # Omitir `vertical` es "no me mandaron nada": conserva el valor.
        api.save_quote(deal.name, self._items(), "sumar")
        self.assertEqual(api.get_deal(deal.name)["quote"]["vertical"], "Servicios")

        # `vertical=""` es "me mandaron vacío": limpia.
        api.save_quote(deal.name, self._items(), "sumar", vertical="")
        self.assertEqual(api.get_deal(deal.name)["quote"]["vertical"], "")
        self.assertIsNone(
            frappe.db.get_value("CRM Presupuesto", {"deal": deal.name, "is_current": 1}, "vertical")
        )

    def test_get_deals_verticals_solo_activas_y_en_orden(self):
        primera = self._vertical("Vertical F2 Test A", activo=1, orden=-5)
        inactiva = self._vertical("Vertical F2 Test Inactiva", activo=0, orden=0)
        ultima = self._vertical("Vertical F2 Test Z", activo=1, orden=9999)
        try:
            verticales = api.get_deals()["verticals"]
            self.assertIn("Vertical F2 Test A", verticales)
            self.assertIn("Vertical F2 Test Z", verticales)
            self.assertNotIn("Vertical F2 Test Inactiva", verticales)
            self.assertLess(
                verticales.index("Vertical F2 Test A"),
                verticales.index("Vertical F2 Test Z"),
            )
        finally:
            for nombre in (primera, inactiva, ultima):
                if frappe.db.exists("CRM Vertical", nombre):
                    frappe.delete_doc(
                        "CRM Vertical", nombre, force=True, ignore_permissions=True
                    )

