"""S2 — push propio a Google Calendar (job asíncrono, idempotente, con estado).

Requiere sitio Frappe (crm-test, NUNCA producción):

    bench --site crm-test run-tests --module crm_core.tests.test_google_sync

No toca la red: inyecta un servicio de Google falso en
`google_sync._servicio_y_cuenta`. El objetivo es probar el flujo del worker
(idempotencia, If-Match/412/409/410, orden del borrado, backoff, guarda de eco y
reconciliación) sin depender de credenciales.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint, now_datetime

from crm_core import api, google_sync, patches


class _Resp:
    def __init__(self, status):
        self.status = status


class HttpError(Exception):
    def __init__(self, status):
        self.resp = _Resp(status)
        super().__init__(f"HTTP {status}")


class Peticion:
    def __init__(self, ejecutar):
        self._ejecutar = ejecutar
        self.headers = {}

    def execute(self):
        return self._ejecutar(self.headers)


class EventosFalsos:
    def __init__(self):
        self.remotos = {}
        self.llamadas = []
        self.fallar = {}
        self.orden = []
        self.on_cancel = None

    def insert(self, calendarId=None, body=None, **kwargs):
        def ejecutar(headers):
            self.llamadas.append(("insert", calendarId, body.get("id")))
            if self.fallar.get("insert"):
                raise HttpError(self.fallar["insert"])
            evento = dict(body)
            evento.setdefault("etag", '"1"')
            evento["updated"] = "2026-09-19T12:00:00.000Z"
            evento["status"] = "confirmed"
            self.remotos[evento["id"]] = evento
            return evento

        return Peticion(ejecutar)

    def get(self, calendarId=None, eventId=None, **kwargs):
        def ejecutar(headers):
            self.llamadas.append(("get", calendarId, eventId))
            if self.fallar.get("get"):
                raise HttpError(self.fallar["get"])
            evento = self.remotos.get(eventId)
            if evento is None:
                raise HttpError(404)
            return dict(evento)

        return Peticion(ejecutar)

    def update(self, calendarId=None, eventId=None, body=None, **kwargs):
        def ejecutar(headers):
            self.llamadas.append(("update", calendarId, eventId, headers.get("If-Match")))
            if self.fallar.get("update"):
                raise HttpError(self.fallar["update"])
            if body.get("status") == "cancelled":
                self.orden.append("cancel")
                if self.on_cancel:
                    self.on_cancel(eventId)
            evento = dict(body)
            evento["etag"] = '"actualizado"'
            evento["updated"] = "2026-09-19T13:00:00.000Z"
            self.remotos[eventId] = evento
            return evento

        return Peticion(ejecutar)

    def delete(self, calendarId=None, eventId=None, **kwargs):
        def ejecutar(headers):
            self.llamadas.append(("delete", calendarId, eventId))
            self.remotos.pop(eventId, None)
            return {}

        return Peticion(ejecutar)


class ServicioFalso:
    def __init__(self, eventos):
        self._eventos = eventos

    def events(self):
        return self._eventos


class CuentaFalsa:
    name = "GC-Test"
    google_calendar_id = "cal-real"
    push_to_google_calendar = 1


class TestGoogleSyncPush(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        patches.ensure_custom_fields()

    def setUp(self):
        super().setUp()
        self._log = patch("frappe.log_error").start()
        self.addCleanup(self._log.stop)
        self._servicio_original = google_sync._servicio_y_cuenta
        self._cuenta_original = google_sync.hay_cuenta_push
        # Por defecto, sin cuenta configurada: nada se encola solo.
        google_sync.hay_cuenta_push = lambda: False
        self.addCleanup(setattr, google_sync, "_servicio_y_cuenta", self._servicio_original)
        self.addCleanup(setattr, google_sync, "hay_cuenta_push", self._cuenta_original)

    # ── helpers ────────────────────────────────────────────────────────
    def _activar(self, eventos):
        servicio = ServicioFalso(eventos)
        cuenta = CuentaFalsa()
        google_sync._servicio_y_cuenta = lambda doc=None: (servicio, cuenta)

    def _evento(self, subject="Reunión", starts="2026-12-01 09:00:00", ends="2026-12-01 10:00:00"):
        return (
            frappe.get_doc(
                {
                    "doctype": "Event",
                    "subject": subject,
                    "starts_on": starts,
                    "ends_on": ends,
                    "all_day": 0,
                    "event_type": "Private",
                    "event_category": "Meeting",
                    "status": "Open",
                }
            )
            .insert(ignore_permissions=True)
            .name
        )

    def _valor(self, name, field):
        return frappe.db.get_value("Event", name, field)

    # ── S1: campos ─────────────────────────────────────────────────────
    def test_campos_de_sync_existen(self):
        meta = frappe.get_meta("Event")
        for field in (
            "custom_gcal_etag",
            "custom_gcal_updated",
            "custom_gcal_calendar_id",
            "custom_sync_origin",
            "custom_last_synced_at",
            "custom_last_synced_local_modified",
            "custom_dirty",
            "custom_content_hash",
            "custom_tombstone",
            "custom_sync_estado",
            "custom_sync_error",
            "custom_sync_intentos",
        ):
            self.assertTrue(meta.get_field(field), f"falta {field}")

    # ── Identidad y hash (puros) ───────────────────────────────────────
    def test_client_event_id_es_estable_y_valido(self):
        a = google_sync.client_event_id("EV-0001")
        b = google_sync.client_event_id("EV-0001")
        c = google_sync.client_event_id("EV-0002")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertTrue(5 <= len(a) <= 1024)
        self.assertTrue(all(ch in "0123456789abcdefghijklmnopqrstuv" for ch in a))

    def test_content_hash_cambia_con_el_contenido(self):
        name = self._evento()
        doc = frappe.get_doc("Event", name)
        h1 = google_sync.content_hash(doc)
        self.assertEqual(h1, google_sync.content_hash(frappe.get_doc("Event", name)))
        frappe.db.set_value("Event", name, "subject", "Otro título")
        self.assertNotEqual(h1, google_sync.content_hash(frappe.get_doc("Event", name)))

    def test_retraso_es_acotado(self):
        self.assertTrue(google_sync.BASE_RETRASO <= google_sync.retraso(0) <= google_sync.BASE_RETRASO * 2)
        self.assertTrue(google_sync.retraso(10) <= google_sync.MAX_RETRASO + google_sync.BASE_RETRASO)
        self.assertGreater(google_sync.retraso(3), google_sync.retraso(1))

    # ── Push: insert / update ──────────────────────────────────────────
    def test_push_insert_usa_id_propio_y_calendario_de_la_cuenta(self):
        name = self._evento()
        if frappe.get_meta("Event").get_field("google_calendar_id"):
            # El evento no tiene el id real; la cuenta sí. Debe usarse el de la cuenta.
            frappe.db.set_value(
                "Event", name, "google_calendar_id", "cal-viejo", update_modified=False
            )
        eventos = EventosFalsos()
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertEqual(self._valor(name, "google_calendar_event_id"), google_sync.client_event_id(name))
        self.assertEqual(self._valor(name, "custom_gcal_calendar_id"), "cal-real")
        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_SINCRONIZADA)
        self.assertEqual(cint(self._valor(name, "custom_dirty")), 0)
        self.assertEqual(self._valor(name, "custom_sync_origin"), "crm")
        self.assertTrue(self._valor(name, "custom_gcal_etag"))
        self.assertEqual(
            self._valor(name, "custom_content_hash"),
            google_sync.content_hash(frappe.get_doc("Event", name)),
        )
        insercion = [c for c in eventos.llamadas if c[0] == "insert"][0]
        self.assertEqual(insercion[1], "cal-real")
        self.assertEqual(insercion[2], google_sync.client_event_id(name))

    def test_push_de_un_evento_ya_ligado_actualiza_con_if_match(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {"google_calendar_event_id": "remoto1", "custom_gcal_etag": '"1"'},
            update_modified=False,
        )
        eventos = EventosFalsos()
        eventos.remotos["remoto1"] = {
            "id": "remoto1",
            "etag": '"1"',
            "updated": "2026-09-19T12:00:00.000Z",
            "status": "confirmed",
            "summary": "viejo",
        }
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertFalse(any(c[0] == "insert" for c in eventos.llamadas))
        actualizacion = [c for c in eventos.llamadas if c[0] == "update"][0]
        self.assertEqual(actualizacion[3], '"1"')
        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_SINCRONIZADA)

    def test_push_409_adopta_el_evento_existente(self):
        name = self._evento()
        eventos = EventosFalsos()
        eventos.fallar["insert"] = 409
        esperado = google_sync.client_event_id(name)
        eventos.remotos[esperado] = {
            "id": esperado,
            "etag": '"ya"',
            "updated": "2026-09-19T12:00:00.000Z",
            "status": "confirmed",
        }
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertEqual(self._valor(name, "google_calendar_event_id"), esperado)
        self.assertEqual(self._valor(name, "custom_gcal_etag"), '"ya"')
        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_SINCRONIZADA)

    # ── Conflictos: no se reintenta a ciegas ───────────────────────────
    def test_push_412_relee_y_marca_conflicto(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {"google_calendar_event_id": "remoto1", "custom_gcal_etag": '"1"'},
            update_modified=False,
        )
        eventos = EventosFalsos()
        eventos.remotos["remoto1"] = {
            "id": "remoto1",
            "etag": '"1"',
            "updated": "2026-09-19T12:00:00.000Z",
            "status": "confirmed",
        }
        eventos.fallar["update"] = 412
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_CONFLICTO)
        self.assertEqual(cint(self._valor(name, "custom_dirty")), 0)
        self.assertGreaterEqual(len([c for c in eventos.llamadas if c[0] == "get"]), 2)
        self.assertTrue(self._log.called)

    def test_push_no_pisa_si_el_remoto_cambio(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {"google_calendar_event_id": "remoto1", "custom_gcal_etag": '"1"'},
            update_modified=False,
        )
        eventos = EventosFalsos()
        eventos.remotos["remoto1"] = {
            "id": "remoto1",
            "etag": '"2"',
            "updated": "2026-09-19T12:30:00.000Z",
            "status": "confirmed",
        }
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertFalse(any(c[0] == "update" for c in eventos.llamadas))
        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_CONFLICTO)
        self.assertEqual(self._valor(name, "custom_gcal_etag"), '"2"')

    def test_push_410_no_recrea_el_evento(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {"google_calendar_event_id": "remoto1", "custom_gcal_etag": '"1"'},
            update_modified=False,
        )
        eventos = EventosFalsos()
        eventos.fallar["get"] = 410
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertFalse(any(c[0] == "insert" for c in eventos.llamadas))
        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_CONFLICTO)

    # ── Fallos transitorios: visibles y con reintentos ─────────────────
    def test_push_429_es_visible_y_reintentable(self):
        name = self._evento()
        eventos = EventosFalsos()
        eventos.fallar["insert"] = 429
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_PENDIENTE)
        self.assertEqual(cint(self._valor(name, "custom_sync_intentos")), 1)
        self.assertEqual(cint(self._valor(name, "custom_dirty")), 1)
        self.assertTrue(self._valor(name, "custom_last_synced_at"))
        self.assertTrue(self._valor(name, "custom_sync_error"))
        self.assertTrue(self._log.called)

    def test_error_no_transitorio_queda_fallido_sin_reintento(self):
        name = self._evento()
        eventos = EventosFalsos()
        eventos.fallar["insert"] = 400
        self._activar(eventos)

        google_sync.push_event(name)

        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_FALLO)
        self.assertEqual(cint(self._valor(name, "custom_dirty")), 0)
        self.assertTrue(self._log.called)

    # ── Borrado: cancela ANTES de borrar local ─────────────────────────
    def test_borrado_cancela_en_google_antes_de_borrar_local(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {"google_calendar_event_id": "remoto1", "custom_gcal_etag": '"1"'},
            update_modified=False,
        )
        eventos = EventosFalsos()
        eventos.remotos["remoto1"] = {
            "id": "remoto1",
            "etag": '"1"',
            "updated": "2026-09-19T12:00:00.000Z",
            "status": "confirmed",
        }
        visto = {}
        eventos.on_cancel = lambda eid: visto.setdefault("existia", bool(frappe.db.exists("Event", name)))
        self._activar(eventos)
        google_sync.marcar_tombstone(name)

        google_sync.procesar_borrado(name)

        # En el momento del cancel remoto el `Event` local seguía existiendo.
        self.assertTrue(visto.get("existia"))
        self.assertEqual(eventos.orden, ["cancel"])
        self.assertFalse(frappe.db.exists("Event", name))

    def test_borrado_si_el_cancel_falla_conserva_el_local(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {"google_calendar_event_id": "remoto1", "custom_gcal_etag": '"1"'},
            update_modified=False,
        )
        eventos = EventosFalsos()
        eventos.remotos["remoto1"] = {
            "id": "remoto1",
            "etag": '"1"',
            "updated": "2026-09-19T12:00:00.000Z",
            "status": "confirmed",
        }
        eventos.fallar["update"] = 500
        self._activar(eventos)
        google_sync.marcar_tombstone(name)

        google_sync.procesar_borrado(name)

        self.assertTrue(frappe.db.exists("Event", name))
        self.assertEqual(self._valor(name, "custom_sync_estado"), google_sync.ESTADO_PENDIENTE)
        self.assertTrue(self._log.called)

    def test_borrado_de_un_evento_ya_ausente_en_google_borra_local(self):
        name = self._evento()
        frappe.db.set_value(
            "Event", name, "google_calendar_event_id", "remoto1", update_modified=False
        )
        eventos = EventosFalsos()  # el remoto no existe: GET da 404
        self._activar(eventos)

        google_sync.procesar_borrado(name)

        self.assertFalse(frappe.db.exists("Event", name))

    def test_borrado_sin_id_remoto_borra_local_directo(self):
        name = self._evento()
        eventos = EventosFalsos()
        self._activar(eventos)

        google_sync.procesar_borrado(name)

        self.assertFalse(frappe.db.exists("Event", name))
        self.assertEqual(eventos.llamadas, [])

    # ── Encolado desde la API ──────────────────────────────────────────
    def test_insertar_encola_el_push_post_commit(self):
        llamadas = []
        campos = {
            "subject": "Nueva",
            "starts_on": "2026-12-20 09:00:00",
            "ends_on": "2026-12-20 10:00:00",
            "all_day": 0,
            "event_type": "Private",
            "event_category": "Meeting",
        }
        with patch.object(google_sync, "hay_cuenta_push", return_value=True), patch(
            "frappe.enqueue", side_effect=lambda *a, **k: llamadas.append((a, k))
        ):
            event = api.insertar_evento_sin_sync(campos)

        self.assertEqual(len(llamadas), 1)
        _, kwargs = llamadas[0]
        self.assertEqual(kwargs["event_name"], event.name)
        self.assertTrue(kwargs["enqueue_after_commit"])
        self.assertEqual(self._valor(event.name, "custom_sync_estado"), google_sync.ESTADO_PENDIENTE)
        self.assertEqual(cint(self._valor(event.name, "custom_dirty")), 1)

    def test_en_migrate_no_encola_ni_marca_dirty(self):
        llamadas = []
        frappe.flags.in_migrate = True
        try:
            with patch.object(google_sync, "hay_cuenta_push", return_value=True), patch(
                "frappe.enqueue", side_effect=lambda *a, **k: llamadas.append((a, k))
            ):
                event = api.insertar_evento_sin_sync(
                    {
                        "subject": "Backfill",
                        "starts_on": "2026-12-21 09:00:00",
                        "ends_on": "2026-12-21 10:00:00",
                        "all_day": 0,
                        "event_type": "Private",
                        "event_category": "Meeting",
                    }
                )
        finally:
            frappe.flags.in_migrate = False

        self.assertEqual(llamadas, [])
        self.assertEqual(cint(self._valor(event.name, "custom_dirty")), 0)

    # ── Reconciliación ─────────────────────────────────────────────────
    def test_reconciliar_marca_duplicados_por_id_de_google(self):
        a = self._evento(subject="A")
        b = self._evento(subject="B")
        frappe.db.set_value(
            "Event", a, "google_calendar_event_id", "duplicado", update_modified=False
        )
        frappe.db.set_value(
            "Event", b, "google_calendar_event_id", "duplicado", update_modified=False
        )

        marcados = google_sync.reconciliar()

        self.assertGreaterEqual(marcados, 1)
        self.assertEqual(self._valor(b, "custom_sync_estado"), google_sync.ESTADO_CONFLICTO)
        # No destruye datos: los dos eventos siguen existiendo.
        self.assertTrue(frappe.db.exists("Event", a))
        self.assertTrue(frappe.db.exists("Event", b))

    def test_reintentar_pendientes_respeta_el_backoff(self):
        name = self._evento()
        frappe.db.set_value(
            "Event",
            name,
            {
                "custom_dirty": 1,
                "custom_sync_estado": google_sync.ESTADO_PENDIENTE,
                "custom_sync_intentos": 3,
                "custom_last_synced_at": now_datetime(),
            },
            update_modified=False,
        )
        encolados = []
        with patch.object(google_sync, "hay_cuenta_push", return_value=True), patch.object(
            google_sync, "encolar_push", side_effect=lambda n: encolados.append(n)
        ):
            # Recién fallado: la ventana de backoff 2^3*30s todavía no venció.
            google_sync.reintentar_pendientes()
        self.assertEqual(encolados, [])
