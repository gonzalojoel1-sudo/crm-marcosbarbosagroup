"""Contrato de la API de la agenda: mover, cambiar duración, duplicar y eliminar.

Requiere sitio Frappe (crm-test, NUNCA producción), con el runner de `bench`:

    bench --site crm-test run-tests --module crm_core.tests.test_agenda_api

El sitio debe tener ya el Custom Field `CRM Lead.custom_meeting_end`; se crea con
`scripts/setup_custom_fields.py` (idempotente). Sin él, `get_agenda` no puede
traer la columna y estos tests no corren.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days

from crm_core import api


class TestAgendaApi(FrappeTestCase):
    def _lead(self, dt, suffix="A", subject=None, end=None):
        # Una reunión en este CRM es un CRM Lead con custom_meeting_datetime.
        # El título real vive en notes ("Reunión agendada: <título>").
        subject = subject or f"Reunión {suffix}"
        first = f"Agenda{suffix}"
        campos = {
            "doctype": "CRM Lead",
            "first_name": first,
            "last_name": "Test",
            "email": f"{first.lower()}@example.com",
            "status": "New",
            "notes": f"Reunión agendada: {subject}\nCuando: {dt}",
            "custom_meeting_datetime": dt,
        }
        # `end` opcional: sin él el lead queda como los viejos (fin vacío) y el
        # DTO tiene que caer a inicio + 1 h.
        if end:
            campos["custom_meeting_end"] = end
        # `source` es un Link: su valor puede existir en producción y no en crm-test,
        # y el insert falla con LinkValidationError antes de llegar al endpoint.
        # Se usa un valor que exista de verdad en este sitio, o se omite el campo.
        campo_source = frappe.get_meta("CRM Lead").get_field("source")
        if campo_source and campo_source.options:
            existente = frappe.db.get_value(campo_source.options, {}, "name")
            if existente:
                campos["source"] = existente
        return frappe.get_doc(campos).insert(ignore_permissions=True).name

    def _ensure_source(self, nombre="Agenda Reunión"):
        # `create_event` usa un Link a `CRM Lead Source`; en crm-test puede faltar.
        doctype = frappe.get_meta("CRM Lead").get_field("source").options
        if frappe.db.exists(doctype, nombre):
            return
        frappe.get_doc({"doctype": doctype, "source_name": nombre}).insert(ignore_permissions=True)

    def _events(self, day):
        return {e["name"]: e for e in api.get_agenda(start=day, end=add_days(day, 1))["events"]}

    # ── Crear ──────────────────────────────────────────────────────────
    def test_create_con_fin_explicito_lo_persiste(self):
        self._ensure_source()
        res = api.create_event("Reunión CreaFin", "2026-11-01 09:00:00", "2026-11-01 10:15:00")

        ev = self._events("2026-11-01")[res["name"]]
        self.assertEqual(ev["starts_on"], "2026-11-01 09:00:00")
        self.assertEqual(ev["ends_on"], "2026-11-01 10:15:00")

    def test_create_sin_fin_usa_una_hora(self):
        self._ensure_source()
        res = api.create_event("Reunión CreaDefault", "2026-11-02 09:00:00")

        ev = self._events("2026-11-02")[res["name"]]
        self.assertEqual(ev["ends_on"], "2026-11-02 10:00:00")

    # ── Mover ──────────────────────────────────────────────────────────
    def test_update_mueve_la_reunion(self):
        name = self._lead("2026-10-05 10:00:00", "Mueve")
        dto = api.update_meeting(name, "2026-10-05 15:30:00")

        self.assertEqual(dto["starts_on"], "2026-10-05 15:30:00")
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", name, "custom_meeting_datetime")),
            "2026-10-05 15:30:00",
        )
        self.assertIn(name, self._events("2026-10-05"))

    # ── Duración ───────────────────────────────────────────────────────
    def test_update_cambia_la_duracion(self):
        name = self._lead("2026-10-06 09:00:00", "Duracion")
        dto = api.update_meeting(name, "2026-10-06 09:00:00", "2026-10-06 11:30:00")

        self.assertEqual(dto["ends_on"], "2026-10-06 11:30:00")
        # Y el cambio se ve en la agenda, no solo en la respuesta.
        self.assertEqual(self._events("2026-10-06")[name]["ends_on"], "2026-10-06 11:30:00")

    def test_update_sin_fin_conserva_la_duracion(self):
        name = self._lead("2026-10-07 10:00:00", "Conserva")
        api.update_meeting(name, "2026-10-07 10:00:00", "2026-10-07 12:00:00")

        dto = api.update_meeting(name, "2026-10-07 14:00:00")
        self.assertEqual(dto["starts_on"], "2026-10-07 14:00:00")
        self.assertEqual(dto["ends_on"], "2026-10-07 16:00:00")

    def test_update_solo_mueve_conserva_la_duracion_real(self):
        name = self._lead("2026-10-16 10:00:00", "SoloMueve", end="2026-10-16 11:45:00")

        dto = api.update_meeting(name, "2026-10-16 16:00:00")
        self.assertEqual(dto["starts_on"], "2026-10-16 16:00:00")
        self.assertEqual(dto["ends_on"], "2026-10-16 17:45:00")

    def test_update_cambia_solo_la_duracion_conserva_el_inicio(self):
        name = self._lead("2026-10-17 09:00:00", "SoloDur", end="2026-10-17 10:00:00")

        dto = api.update_meeting(name, "2026-10-17 09:00:00", "2026-10-17 12:30:00")
        self.assertEqual(dto["starts_on"], "2026-10-17 09:00:00")
        self.assertEqual(dto["ends_on"], "2026-10-17 12:30:00")

    def test_lead_legacy_sin_fin_cae_a_una_hora(self):
        name = self._lead("2026-10-18 08:30:00", "Legacy")  # sin custom_meeting_end

        ev = self._events("2026-10-18")[name]
        self.assertEqual(ev["ends_on"], "2026-10-18 09:30:00")

    def test_update_fin_antes_o_igual_que_inicio_falla(self):
        name = self._lead("2026-10-08 10:00:00", "Invalido")

        with self.assertRaises(frappe.ValidationError):
            api.update_meeting(name, "2026-10-08 10:00:00", "2026-10-08 09:00:00")
        with self.assertRaises(frappe.ValidationError):
            api.update_meeting(name, "2026-10-08 10:00:00", "2026-10-08 10:00:00")

        # El rechazo no deja la reunión a medio tocar.
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", name, "custom_meeting_datetime")),
            "2026-10-08 10:00:00",
        )

    # ── Eliminar ───────────────────────────────────────────────────────
    def test_delete_saca_la_reunion_de_la_agenda_sin_borrar_el_lead(self):
        name = self._lead("2026-10-09 10:00:00", "Borra")
        self.assertIn(name, self._events("2026-10-09"))

        res = api.delete_meeting(name)

        self.assertTrue(res["ok"])
        self.assertNotIn(name, self._events("2026-10-09"))
        # Menos destructivo: el lead (contacto/historial) sigue existiendo.
        self.assertTrue(frappe.db.exists("CRM Lead", name))
        self.assertFalse(frappe.db.get_value("CRM Lead", name, "custom_meeting_datetime"))

    # ── Duplicar ───────────────────────────────────────────────────────
    def test_duplicate_crea_copia_con_sufijo_y_mismo_horario(self):
        name = self._lead("2026-10-10 10:00:00", "Dup", subject="Reunión Dup")
        copia = api.duplicate_meeting(name)

        self.assertNotEqual(copia["name"], name)
        self.assertEqual(copia["subject"], "Reunión Dup (copia)")
        self.assertEqual(copia["starts_on"], "2026-10-10 10:00:00")
        self.assertTrue(frappe.db.exists("CRM Lead", copia["name"]))
        self.assertTrue(frappe.db.exists("CRM Lead", name))

    def test_duplicate_con_starts_on_reubica(self):
        name = self._lead("2026-10-11 10:00:00", "DupReubica")
        copia = api.duplicate_meeting(name, "2026-10-12 16:00:00")

        self.assertEqual(copia["starts_on"], "2026-10-12 16:00:00")
        self.assertEqual(copia["ends_on"], "2026-10-12 17:00:00")

    def test_duplicate_copia_el_fin_real(self):
        name = self._lead("2026-10-19 10:00:00", "DupFin", end="2026-10-19 12:30:00")

        copia = api.duplicate_meeting(name)
        self.assertEqual(copia["starts_on"], "2026-10-19 10:00:00")
        self.assertEqual(copia["ends_on"], "2026-10-19 12:30:00")

    # ── Permisos ───────────────────────────────────────────────────────
    def _sin_permiso(self, fn, *args):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                fn(*args)
        finally:
            frappe.set_user("Administrator")

    def test_update_sin_permiso_falla(self):
        name = self._lead("2026-10-13 10:00:00", "PermUpd")
        self._sin_permiso(api.update_meeting, name, "2026-10-13 11:00:00")

    def test_delete_sin_permiso_falla(self):
        name = self._lead("2026-10-14 10:00:00", "PermDel")
        self._sin_permiso(api.delete_meeting, name)

    def test_duplicate_sin_permiso_falla(self):
        name = self._lead("2026-10-15 10:00:00", "PermDup")
        self._sin_permiso(api.duplicate_meeting, name)
