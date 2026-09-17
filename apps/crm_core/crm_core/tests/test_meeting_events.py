"""Backfill de la reunión-lead a `Event` de Frappe (F1).

Requiere sitio Frappe (crm-test, NUNCA producción), con el runner de `bench`:

    bench --site crm-test run-tests --module crm_core.tests.test_meeting_events

El Custom Field `Event.custom_crm_lead` lo crea `crm_core.patches.execute()`
(idempotente); el `setUpClass` lo asegura para que el módulo corra aunque el
sitio todavía no haya pasado por el patch.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint, get_datetime

from crm_core import api, patches


class TestMeetingEventsBackfill(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        patches.ensure_custom_fields()

    def _lead(self, dt, suffix, notes=None, subject=None):
        first = f"EventBackfill{suffix}"
        if dt and notes is None:
            subject = subject or f"Reunión {suffix}"
            notes = f"Reunión agendada: {subject}\nCuando: {dt}"
        valores = {
            "doctype": "CRM Lead",
            "first_name": first,
            "last_name": "Test",
            "email": f"{first.lower()}@example.com",
            "status": "New",
            "notes": notes,
        }
        if dt:
            valores["custom_meeting_datetime"] = dt
        # `source` es un Link: su valor puede existir en producción y no en crm-test.
        campo_source = frappe.get_meta("CRM Lead").get_field("source")
        if campo_source and campo_source.options:
            existente = frappe.db.get_value(campo_source.options, {}, "name")
            if existente:
                valores["source"] = existente
        return frappe.get_doc(valores).insert(ignore_permissions=True).name

    def _eventos(self, lead):
        return frappe.get_all(
            "Event",
            filters={"custom_crm_lead": lead},
            fields=[
                "name",
                "subject",
                "starts_on",
                "ends_on",
                "all_day",
                "sync_with_google_calendar",
                "pulled_from_google_calendar",
                "custom_crm_lead",
            ],
            order_by="starts_on asc",
            limit_page_length=0,
        )

    def test_backfill_crea_un_event_por_reunion(self):
        lead = self._lead("2026-12-01 09:00:00", "Crea", subject="Reunión Crea")

        patches.backfill_events_from_meetings()

        eventos = self._eventos(lead)
        self.assertEqual(len(eventos), 1)
        ev = eventos[0]
        self.assertEqual(str(ev["starts_on"]), "2026-12-01 09:00:00")
        self.assertEqual(str(ev["ends_on"]), "2026-12-01 10:00:00")
        self.assertEqual(ev["subject"], "Reunión Crea")
        self.assertEqual(cint(ev["all_day"]), 0)
        # Sin sync nativo: el push de Google no puede tirar dentro del save.
        self.assertEqual(cint(ev["sync_with_google_calendar"]), 0)
        self.assertEqual(cint(ev["pulled_from_google_calendar"]), 0)
        # El vínculo al lead es lo que hace que la reunión sirva al CRM.
        self.assertEqual(ev["custom_crm_lead"], lead)
        # `custom_meeting_datetime` se congela: el backfill no lo toca.
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", lead, "custom_meeting_datetime")),
            "2026-12-01 09:00:00",
        )

    def test_backfill_es_idempotente(self):
        lead = self._lead("2026-12-02 09:00:00", "Idem")

        patches.backfill_events_from_meetings()
        patches.backfill_events_from_meetings()

        self.assertEqual(len(self._eventos(lead)), 1)

    def test_lead_sin_fecha_no_crea_event(self):
        lead = self._lead(None, "SinFecha", notes="Reunión agendada: Sin fecha")

        patches.backfill_events_from_meetings()

        self.assertEqual(self._eventos(lead), [])

    def test_fin_legacy_en_notes_se_respeta(self):
        lead = self._lead(
            "2026-12-03 09:00:00",
            "FinLegacy",
            notes=(
                "Reunión agendada: Reunión FinLegacy\n"
                "Cuando: 2026-12-03 09:00:00\n"
                "Fin: 2026-12-03 11:30:00"
            ),
        )

        patches.backfill_events_from_meetings()

        ev = self._eventos(lead)[0]
        self.assertEqual(str(ev["ends_on"]), "2026-12-03 11:30:00")

    def test_ends_on_da_la_duracion_real(self):
        lead = self._lead(
            "2026-12-04 09:00:00",
            "Duracion",
            notes=(
                "Reunión agendada: Reunión Duracion\n"
                "Cuando: 2026-12-04 09:00:00\n"
                "Fin: 2026-12-04 11:15:00"
            ),
        )

        patches.backfill_events_from_meetings()

        ev = self._eventos(lead)[0]
        duracion = get_datetime(ev["ends_on"]) - get_datetime(ev["starts_on"])
        self.assertEqual(duracion.total_seconds(), 2 * 3600 + 15 * 60)

    # ── Ciclo de vida sobre `Event` (D1) ───────────────────────────────
    def _evento(self, lead, subject, starts_on, ends_on):
        return api.insertar_evento_sin_sync(
            {
                "subject": subject,
                "starts_on": starts_on,
                "ends_on": ends_on,
                "all_day": 0,
                "event_type": "Private",
                "event_category": "Meeting",
                "custom_crm_lead": lead,
            }
        )

    def test_crear_event_lo_linkea_al_lead_y_no_toca_el_lead(self):
        lead = self._lead("2026-12-05 09:00:00", "CreaEvent")

        self._evento(lead, "Reunión creada", "2026-12-05 09:00:00", "2026-12-05 09:45:00")

        eventos = self._eventos(lead)
        self.assertEqual(len(eventos), 1)
        self.assertEqual(eventos[0]["custom_crm_lead"], lead)
        self.assertEqual(eventos[0]["subject"], "Reunión creada")
        # Crear la reunión no muta el contacto.
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", lead, "custom_meeting_datetime")),
            "2026-12-05 09:00:00",
        )

    def test_borrar_event_no_toca_el_lead(self):
        lead = self._lead("2026-12-06 10:00:00", "BorraEvent")
        ev = self._evento(lead, "Reunión a borrar", "2026-12-06 10:00:00", "2026-12-06 11:00:00")

        frappe.delete_doc("Event", ev.name, force=True, ignore_permissions=True)

        # La reunión desaparece…
        self.assertFalse(frappe.db.exists("Event", ev.name))
        self.assertEqual(self._eventos(lead), [])
        # …y el lead (contacto/historial) queda intacto: el punto de D1.
        self.assertTrue(frappe.db.exists("CRM Lead", lead))
        self.assertEqual(
            str(frappe.db.get_value("CRM Lead", lead, "custom_meeting_datetime")),
            "2026-12-06 10:00:00",
        )
