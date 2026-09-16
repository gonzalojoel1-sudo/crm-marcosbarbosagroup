"""Transiciones del presupuesto. Requiere sitio Frappe (crm-test, NUNCA producción)."""
import frappe
from frappe.tests.utils import FrappeTestCase

from crm_core.mbcrm.doctype.crm_presupuesto.crm_presupuesto import new_version


class TestPresupuestoEstados(FrappeTestCase):
    def _deal(self):
        # `status` es REQD en CRM Deal (Link a CRM Deal Status) y los valores válidos
        # son los del embudo: Qualification es el inicial.
        org = frappe.get_doc(
            {"doctype": "CRM Organization", "organization_name": "Test F2 Org"}
        ).insert(ignore_permissions=True)
        return frappe.get_doc(
            {
                "doctype": "CRM Deal",
                "lead_name": "Test F2",
                "status": "Qualification",
                "organization": org.name,
            }
        ).insert(ignore_permissions=True)

    def _quote(self, deal):
        # `organization` es REQD en CRM Presupuesto (denormalizado para informar):
        # se copia del negocio, que es lo que va a hacer `save_quote`.
        return frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": deal.name,
                "organization": deal.organization,
                "iva_mode": "sumar",
                "items": [
                    {"description": "Servicio", "billing_type": "Único", "qty": 1, "rate": 100000}
                ],
            }
        ).insert(ignore_permissions=True)

    def test_calcula_los_dos_totales_al_guardar(self):
        q = self._quote(self._deal())
        self.assertEqual(q.total_one_time, 100000)
        self.assertEqual(q.total_one_time_gross, 121000)
        self.assertEqual(q.total_recurring_monthly, 0)

    def test_no_se_puede_enviar_sin_items(self):
        q = self._quote(self._deal())
        q.items = []
        with self.assertRaises(frappe.ValidationError):
            q.send()

    def test_enviar_congela_y_marca_la_traza(self):
        q = self._quote(self._deal())
        q.send()
        self.assertEqual(q.status, "Enviado")
        self.assertTrue(q.sent_on)
        self.assertTrue(q.snapshot_hash)

    def test_no_se_puede_editar_un_enviado(self):
        q = self._quote(self._deal())
        q.send()
        q.items[0].rate = 999999
        with self.assertRaises(frappe.ValidationError):
            q.save()

    def test_versionar_deja_una_sola_vigente(self):
        deal = self._deal()
        q = self._quote(deal)
        q.send()
        nueva = new_version(deal.name)
        self.assertEqual(nueva.version, 2)
        self.assertEqual(nueva.status, "Borrador")
        vigentes = frappe.get_all(
            "CRM Presupuesto", filters={"deal": deal.name, "is_current": 1}, pluck="name"
        )
        self.assertEqual(vigentes, [nueva.name])

    def test_rechazar_exige_motivo(self):
        q = self._quote(self._deal())
        q.send()
        with self.assertRaises(frappe.ValidationError):
            q.reject("   ")

    def test_no_se_puede_aceptar_un_borrador(self):
        q = self._quote(self._deal())
        with self.assertRaises(frappe.ValidationError):
            q.accept()

    def test_no_se_puede_cambiar_el_iva_de_un_enviado(self):
        q = self._quote(self._deal())
        q.send()
        q.iva_mode = "exento"
        with self.assertRaises(frappe.ValidationError):
            q.save()

    def test_un_enviado_no_vuelve_a_borrador(self):
        q = self._quote(self._deal())
        q.send()
        q.status = "Borrador"
        with self.assertRaises(frappe.ValidationError):
            q.save()

    def test_no_se_versiona_un_anulado(self):
        q = self._quote(self._deal())
        q.void()
        with self.assertRaises(frappe.ValidationError):
            new_version(q.deal)

    def test_versionar_un_vencido_nace_con_validez_nueva(self):
        q = self._quote(self._deal())
        q.send()
        q.status = "Vencido"
        q.save()
        nueva = new_version(q.deal)
        self.assertEqual(nueva.status, "Borrador")
        self.assertTrue(nueva.valid_until, "la version nueva debe nacer con validez")
        self.assertGreaterEqual(str(nueva.valid_until), str(frappe.utils.nowdate()))

    def test_enviar_dos_veces_falla(self):
        q = self._quote(self._deal())
        q.send()
        with self.assertRaises(frappe.ValidationError):
            q.send()
