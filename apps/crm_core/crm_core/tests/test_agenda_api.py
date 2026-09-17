"""Contrato de la API de la agenda sobre `Event`: leer la ventana, crear, mover,
cambiar duración, duplicar y eliminar.

Requiere sitio Frappe (crm-test, NUNCA producción), con el runner de `bench`:

    bench --site crm-test run-tests --module crm_core.tests.test_agenda_api

Desde F1 la reunión es un `Event` linkeado al contacto por el Custom Field
`Event.custom_crm_lead`; desde F2 la API lee y escribe `Event`. La duración es
`Event.ends_on` y el título es `Event.subject` (no se parsea de `notes`).
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days

from crm_core import api, patches


class TestAgendaApi(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        patches.ensure_custom_fields()

    def _lead(self, suffix="A", meeting=None):
        first = f"Agenda{suffix}"
        campos = {
            "doctype": "CRM Lead",
            "first_name": first,
            "last_name": "Test",
            "email": f"{first.lower()}@example.com",
            "status": "New",
        }
        if meeting:
            campos["custom_meeting_datetime"] = meeting
        # `source` es un Link: su valor puede existir en producción y no en crm-test,
        # y el insert falla con LinkValidationError antes de llegar al endpoint.
        # Se usa un valor que exista de verdad en este sitio, o se omite el campo.
        campo_source = frappe.get_meta("CRM Lead").get_field("source")
        if campo_source and campo_source.options:
            existente = frappe.db.get_value(campo_source.options, {}, "name")
            if existente:
                campos["source"] = existente
        return frappe.get_doc(campos).insert(ignore_permissions=True).name

    def _event(self, subject="Reunión", starts="2026-11-01 09:00:00", ends="2026-11-01 10:00:00", lead=None, all_day=0):
        campos = {
            "subject": subject,
            "starts_on": starts,
            "all_day": all_day,
            "event_type": "Private",
            "event_category": "Meeting",
            "status": "Open",
        }
        if ends is not None:
            campos["ends_on"] = ends
        if lead:
            campos["custom_crm_lead"] = lead
        return api.insertar_evento_sin_sync(campos)

    def _events(self, day):
        return {e["name"]: e for e in api.get_agenda(start=day, end=add_days(day, 1))["events"]}

    # ── Leer la ventana ────────────────────────────────────────────────
    def test_get_agenda_devuelve_los_event_de_la_ventana(self):
        dentro = self._event(subject="Adentro", starts="2026-11-01 09:00:00", ends="2026-11-01 10:30:00")
        fuera = self._event(subject="Afuera", starts="2026-11-05 09:00:00", ends="2026-11-05 10:00:00")

        events = self._events("2026-11-01")

        self.assertIn(dentro.name, events)
        self.assertNotIn(fuera.name, events)
        # La duración sale de `Event.ends_on`, no de un `+1 h` fabricado.
        self.assertEqual(events[dentro.name]["starts_on"], "2026-11-01 09:00:00")
        self.assertEqual(events[dentro.name]["ends_on"], "2026-11-01 10:30:00")
        self.assertEqual(events[dentro.name]["subject"], "Adentro")

    def test_event_sin_fin_cae_a_una_hora(self):
        ev = self._event(starts="2026-11-20 08:30:00", ends=None)

        dto = self._events("2026-11-20")[ev.name]
        self.assertEqual(dto["ends_on"], "2026-11-20 09:30:00")

    def test_all_day_se_reporta_como_all_day(self):
        ev = self._event(
            subject="Feriado",
            starts="2026-11-21 00:00:00",
            ends="2026-11-22 00:00:00",
            all_day=1,
        )

        dto = self._events("2026-11-21")[ev.name]
        # No se disfraza de reunión de 00:00: el DTO dice que es de todo el día.
        self.assertTrue(dto["all_day"])
        self.assertEqual(dto["ends_on"], "2026-11-22 00:00:00")

    # ── Crear ──────────────────────────────────────────────────────────
    def test_create_crea_un_event_y_lo_linkea_al_lead(self):
        lead = self._lead("Crea", meeting="2026-11-02 09:00:00")

        res = api.create_event("Reunión Crea", "2026-11-02 09:00:00", "2026-11-02 10:15:00", lead=lead)

        self.assertTrue(frappe.db.exists("Event", res["name"]))
        ev = frappe.get_doc("Event", res["name"])
        self.assertEqual(ev.custom_crm_lead, lead)
        self.assertEqual(ev.subject, "Reunión Crea")
        self.assertEqual(str(ev.ends_on), "2026-11-02 10:15:00")
        # El contacto no se toca al crear la reunión.
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", lead, "custom_meeting_datetime")),
            "2026-11-02 09:00:00",
        )

    def test_create_sin_lead_no_linkea(self):
        res = api.create_event("Reunión Suelta", "2026-11-03 09:00:00")

        self.assertFalse(frappe.get_doc("Event", res["name"]).custom_crm_lead)

    def test_create_sin_fin_usa_una_hora(self):
        res = api.create_event("Reunión Default", "2026-11-04 09:00:00")

        self.assertEqual(self._events("2026-11-04")[res["name"]]["ends_on"], "2026-11-04 10:00:00")

    def test_create_all_day_se_persiste_y_dura_el_dia(self):
        res = api.create_event("Feriado Crea", "2026-11-17 00:00:00", all_day=1)

        ev = frappe.get_doc("Event", res["name"])
        self.assertTrue(ev.all_day)
        self.assertEqual(str(ev.ends_on), "2026-11-18 00:00:00")
        dto = self._events("2026-11-17")[res["name"]]
        self.assertTrue(dto["all_day"])
        self.assertEqual(dto["ends_on"], "2026-11-18 00:00:00")

    # ── Mover / duración ───────────────────────────────────────────────
    def test_update_solo_mueve_conserva_la_duracion(self):
        ev = self._event(subject="Mueve", starts="2026-11-06 10:00:00", ends="2026-11-06 11:45:00")

        dto = api.update_meeting(ev.name, "2026-11-06 16:00:00")

        self.assertEqual(dto["starts_on"], "2026-11-06 16:00:00")
        self.assertEqual(dto["ends_on"], "2026-11-06 17:45:00")
        # Y quedó en la base, no sólo en la respuesta.
        self.assertEqual(
            str(frappe.db.get_value("Event", ev.name, "ends_on")), "2026-11-06 17:45:00"
        )

    def test_update_con_fin_cambia_la_duracion(self):
        ev = self._event(subject="Dura", starts="2026-11-07 09:00:00", ends="2026-11-07 10:00:00")

        dto = api.update_meeting(ev.name, "2026-11-07 09:00:00", "2026-11-07 12:30:00")

        self.assertEqual(dto["starts_on"], "2026-11-07 09:00:00")
        self.assertEqual(dto["ends_on"], "2026-11-07 12:30:00")

    def test_update_fin_antes_o_igual_que_inicio_falla(self):
        ev = self._event(starts="2026-11-08 10:00:00", ends="2026-11-08 11:00:00")

        with self.assertRaises(frappe.ValidationError):
            api.update_meeting(ev.name, "2026-11-08 10:00:00", "2026-11-08 09:00:00")
        with self.assertRaises(frappe.ValidationError):
            api.update_meeting(ev.name, "2026-11-08 10:00:00", "2026-11-08 10:00:00")

        # El rechazo no deja la reunión a medio tocar.
        self.assertEqual(
            str(frappe.db.get_value("Event", ev.name, "starts_on")), "2026-11-08 10:00:00"
        )

    # ── Duplicar ───────────────────────────────────────────────────────
    def test_duplicate_copia_el_fin_y_no_toca_el_lead(self):
        lead = self._lead("Dup")
        ev = self._event(
            subject="Reunión Dup",
            starts="2026-11-09 10:00:00",
            ends="2026-11-09 12:30:00",
            lead=lead,
        )

        copia = api.duplicate_meeting(ev.name)

        self.assertNotEqual(copia["name"], ev.name)
        self.assertEqual(copia["subject"], "Reunión Dup (copia)")
        self.assertEqual(copia["starts_on"], "2026-11-09 10:00:00")
        self.assertEqual(copia["ends_on"], "2026-11-09 12:30:00")
        # Duplicar no duplica el contacto: la copia es otro `Event` del mismo lead.
        self.assertEqual(frappe.get_doc("Event", copia["name"]).custom_crm_lead, lead)
        self.assertTrue(frappe.db.exists("CRM Lead", lead))

    def test_duplicate_con_starts_on_reubica_y_conserva_la_duracion(self):
        ev = self._event(starts="2026-11-10 10:00:00", ends="2026-11-10 11:15:00")

        copia = api.duplicate_meeting(ev.name, "2026-11-12 16:00:00")

        self.assertEqual(copia["starts_on"], "2026-11-12 16:00:00")
        self.assertEqual(copia["ends_on"], "2026-11-12 17:15:00")

    # ── Eliminar ───────────────────────────────────────────────────────
    def test_delete_saca_el_event_y_no_toca_el_lead(self):
        lead = self._lead("Borra", meeting="2026-11-13 10:00:00")
        ev = self._event(lead=lead, starts="2026-11-13 10:00:00", ends="2026-11-13 11:00:00")
        self.assertIn(ev.name, self._events("2026-11-13"))

        res = api.delete_meeting(ev.name)

        self.assertTrue(res["ok"])
        self.assertFalse(frappe.db.exists("Event", ev.name))
        self.assertNotIn(ev.name, self._events("2026-11-13"))
        # El lead (contacto/historial) no se toca: el punto de D1.
        self.assertTrue(frappe.db.exists("CRM Lead", lead))
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", lead, "custom_meeting_datetime")),
            "2026-11-13 10:00:00",
        )

    # ── Permisos ───────────────────────────────────────────────────────
    def _sin_permiso(self, fn, *args):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                fn(*args)
        finally:
            frappe.set_user("Administrator")

    def test_update_sin_permiso_falla(self):
        ev = self._event(starts="2026-11-14 10:00:00", ends="2026-11-14 11:00:00")
        self._sin_permiso(api.update_meeting, ev.name, "2026-11-14 12:00:00")

    def test_delete_sin_permiso_falla(self):
        ev = self._event(starts="2026-11-15 10:00:00", ends="2026-11-15 11:00:00")
        self._sin_permiso(api.delete_meeting, ev.name)

    def test_duplicate_sin_permiso_falla(self):
        ev = self._event(starts="2026-11-16 10:00:00", ends="2026-11-16 11:00:00")
        self._sin_permiso(api.duplicate_meeting, ev.name)
