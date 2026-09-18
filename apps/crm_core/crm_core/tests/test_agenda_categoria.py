"""Categoría de la reunión en el modelo y en la API (gap de modelo de la agenda).

La categoría es la vertical de la agenda: "Trabajo", "Ministerial", "Personal",
"Consultora", "Software". Vive como Custom Field `Event.custom_crm_categoria`
(Select, cinco valores fijos, decisión de producto) y viaja en el DTO como
`categoria`, con default "Trabajo" para que la UI nunca reciba vacío.

Requiere sitio Frappe (crm-test, NUNCA producción), con el runner de `bench`:

    bench --site crm-test run-tests --module crm_core.tests.test_agenda_categoria
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import get_datetime

from crm_core import api, patches


class TestAgendaCategoria(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        patches.ensure_custom_fields()

    def _event(self, **kwargs):
        campos = {
            "subject": "Reunión",
            "starts_on": "2026-12-01 09:00:00",
            "ends_on": "2026-12-01 10:00:00",
            "all_day": 0,
            "event_type": "Private",
            "event_category": "Meeting",
            "status": "Open",
        }
        campos.update(kwargs)
        return api.insertar_evento_sin_sync(campos)

    def _dto(self, ev):
        eventos = api.get_agenda(start="2026-12-01", end="2026-12-31")["events"]
        return {e["name"]: e for e in eventos}[ev.name]

    # ── El campo ───────────────────────────────────────────────────────
    def test_el_campo_es_un_select_con_las_cinco_categorias(self):
        df = frappe.get_meta("Event").get_field("custom_crm_categoria")
        self.assertIsNotNone(df)
        self.assertEqual(df.fieldtype, "Select")
        # Las opciones del campo no pueden derivar del contrato de la API.
        self.assertEqual(tuple(df.options.split("\n")), api.CATEGORIAS)
        self.assertEqual(df.default, api.CATEGORIA_DEFAULT)

    # ── Crear ──────────────────────────────────────────────────────────
    def test_create_guarda_la_categoria(self):
        res = api.create_event(
            "Reunión Consultora", "2026-12-01 09:00:00", categoria="Consultora"
        )
        self.assertEqual(
            frappe.db.get_value("Event", res["name"], "custom_crm_categoria"),
            "Consultora",
        )

    def test_create_sin_categoria_usa_el_default(self):
        res = api.create_event("Reunión Default", "2026-12-02 09:00:00")
        self.assertEqual(
            frappe.db.get_value("Event", res["name"], "custom_crm_categoria"),
            api.CATEGORIA_DEFAULT,
        )

    def test_create_con_categoria_invalida_falla(self):
        with self.assertRaises(frappe.ValidationError):
            api.create_event("Reunión Inválida", "2026-12-03 09:00:00", categoria="Otra")

    # ── Actualizar ─────────────────────────────────────────────────────
    def test_update_cambia_la_categoria(self):
        ev = self._event(**{"custom_crm_categoria": "Trabajo"})

        dto = api.update_meeting(ev.name, "2026-12-04 09:00:00", categoria="Ministerial")

        self.assertEqual(dto["categoria"], "Ministerial")
        self.assertEqual(
            frappe.db.get_value("Event", ev.name, "custom_crm_categoria"), "Ministerial"
        )

    def test_update_sin_categoria_no_la_toca(self):
        ev = self._event(**{"custom_crm_categoria": "Software"})

        dto = api.update_meeting(ev.name, "2026-12-05 09:00:00")

        self.assertEqual(dto["categoria"], "Software")

    def test_update_cambia_dia_y_categoria(self):
        """El panel edita Día y Agenda en un solo guardado: van al mismo `Event`."""
        ev = self._event(**{"custom_crm_categoria": "Trabajo"})

        dto = api.update_meeting(ev.name, "2026-12-08 10:30:00", categoria="Software")

        self.assertEqual(dto["categoria"], "Software")
        self.assertEqual(
            frappe.db.get_value("Event", ev.name, "starts_on"),
            get_datetime("2026-12-08 10:30:00"),
        )

    # ── Origen y solo lectura (Google) ─────────────────────────────────
    def test_el_dto_marca_origen_crm_por_defecto(self):
        ev = self._event()

        dto = self._dto(ev)

        self.assertEqual(dto["origin"], "CRM")
        self.assertFalse(dto["busy"])

    def test_el_dto_marca_origen_google_y_busy_cuando_vino_del_sync(self):
        ev = self._event()
        frappe.db.set_value(
            "Event", ev.name, "pulled_from_google_calendar", 1, update_modified=False
        )

        dto = self._dto(ev)

        self.assertEqual(dto["origin"], "Google")
        self.assertTrue(dto["busy"])

    # ── DTO ────────────────────────────────────────────────────────────
    def test_el_dto_devuelve_la_categoria(self):
        ev = self._event(**{"custom_crm_categoria": "Personal"})

        self.assertEqual(self._dto(ev)["categoria"], "Personal")

    def test_event_sin_categoria_el_dto_devuelve_el_default_y_no_vacio(self):
        ev = self._event()  # sin categoría
        frappe.db.set_value("Event", ev.name, "custom_crm_categoria", None, update_modified=False)

        categoria = self._dto(ev)["categoria"]

        self.assertEqual(categoria, api.CATEGORIA_DEFAULT)
        self.assertNotEqual(categoria, "")

    def test_get_meeting_devuelve_la_categoria(self):
        ev = self._event(**{"custom_crm_categoria": "Consultora"})

        self.assertEqual(api.get_meeting(ev.name)["categoria"], "Consultora")

    def test_el_dto_no_rompe_con_una_categoria_desconocida(self):
        ev = self._event(**{"custom_crm_categoria": "Trabajo"})
        # Valor fuera del `Select` (p. ej. escrito por SQL): la lectura cae al default.
        frappe.db.set_value("Event", ev.name, "custom_crm_categoria", "Vieja", update_modified=False)

        self.assertEqual(self._dto(ev)["categoria"], api.CATEGORIA_DEFAULT)

    # ── Duplicar ───────────────────────────────────────────────────────
    def test_duplicate_copia_la_categoria(self):
        ev = self._event(**{"custom_crm_categoria": "Ministerial"})

        copia = api.duplicate_meeting(ev.name, "2026-12-06 09:00:00")

        self.assertEqual(copia["categoria"], "Ministerial")

    # ── Backfill ───────────────────────────────────────────────────────
    def test_backfill_pone_el_default_a_los_event_sin_categoria(self):
        from crm_core.patches_categoria import backfill_categorias

        ev = self._event()
        frappe.db.set_value("Event", ev.name, "custom_crm_categoria", None, update_modified=False)

        n = backfill_categorias()

        self.assertGreaterEqual(n, 1)
        self.assertEqual(
            frappe.db.get_value("Event", ev.name, "custom_crm_categoria"),
            api.CATEGORIA_DEFAULT,
        )
        # Idempotente: la segunda corrida no encuentra nada que tocar.
        self.assertEqual(backfill_categorias(), 0)
