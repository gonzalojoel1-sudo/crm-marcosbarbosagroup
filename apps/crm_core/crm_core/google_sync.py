"""S2 — nuestro push a Google Calendar (reemplaza el push nativo, roto).

El sync nativo de Frappe no se puede usar tal cual (research 2026-09-19):
el push lanza DENTRO de `Event.save()` (`google_calendar.py:496-501`, `:580-585`)
y un error de Google aborta el guardado del CRM; y el delete falla en silencio
(`:610-615`: sólo `msgprint`, sin log ni retry). Por eso el `Event` se sigue
guardando **neutralizado y atómico** (ver `api.insertar_evento_sin_sync` y
`api._neutralizar_sync_evento`) y el push vive acá, fuera de los hooks.

Piezas de esta fase:

1. **Job de push asíncrono.** `push_event` se encola post-commit
   (`enqueue_after_commit=True`) desde `api.insertar_evento_sin_sync` y
   `api.update_meeting`. El worker llama a la API dentro de `try/except Exception`
   y, ante fallo, escribe `Error Log` y persiste
   `custom_sync_estado`/`custom_sync_error`/`custom_sync_intentos`: el fallo es
   visible, con reintentos.
2. **`account.google_calendar_id`, NO `doc.google_calendar_id`.** Es el bug del
   id vacío en el primer push (`check_google_calendar` recién crea/establece el id
   en la cuenta, `google_calendar.py:247-271`).
3. **Idempotencia** por `google_calendar_event_id`; al insertar se usa un id
   propio (base32hex minúscula a–v/0–9, derivado estable del nombre del `Event`),
   así un reintento no duplica. `409` = ya existe → se adopta. `If-Match: <etag>`
   en cada update/delete: `412` → se relee el remoto y se re-evalúa (no se
   reintenta a ciegas); `404/410` → el remoto ya no está.
4. **El delete cancela en Google ANTES de borrar local** (`procesar_borrado`): si
   se borrara primero, el próximo pull completo re-insertaría el evento
   (resurrección, research §2.5). `custom_tombstone` marca el borrado.
5. **Guarda de eco**: `custom_sync_origin="crm"` + `custom_content_hash` en
   nuestras escrituras; el pull (S3) compara el hash y descarta su propio eco.
6. **Estado actual de los dos syncers (para S3, no se resuelve acá):** corren el
   syncer nativo (`frappe.integrations...google_calendar.sync`, el único que
   escribe `Event` y maneja `syncToken`/`410`) y el cron legacy
   `scripts/sync/sync-gcal-crm.py` (crea `CRM Lead`s desde `primary`). **Decisión
   para S3: queda el nativo como único puller apuntado al calendario correcto y se
   retira el cron legacy.** En S2 no se toca ninguno de los dos: nuestro push no
   escribe en el CRM, así que todavía no hay dos writers.
7. **Reconciliación** barata y periódica (`reconciliar`): por
   `google_calendar_event_id` marca duplicados y tombstones sin propagar en
   `custom_sync_estado`, sin destruir datos.

Reintentos: `reintentar_pendientes` (scheduler cada 5 min) levanta los `Event`
con `custom_dirty=1` y estado Pendiente/Falló, y los re-encola sólo si pasó la
ventana de backoff exponencial con jitter (`retraso`). `403`/`429` (y errores de
red/5xx) son transitorios; el resto marca `Falló` y no se reintenta solo.
"""

import hashlib
import json
import random

import frappe
from frappe.utils import cint, get_datetime, now_datetime

# Debe coincidir con las opciones del Custom Field `custom_sync_estado`.
ESTADO_NO_APLICA = "No aplica"
ESTADO_PENDIENTE = "Pendiente"
ESTADO_SINCRONIZADA = "Sincronizada"
ESTADO_FALLO = "Falló"
ESTADO_CONFLICTO = "Conflicto"

# Clave en `extendedProperties.private`: sobrevive a un restore local donde se
# pierde el mapeo por `google_calendar_event_id` (research §1.3).
CLAVE_CRM = "crm_event"

BASE_RETRASO = 30
MAX_RETRASO = 3600
MAX_INTENTOS = 8
ALFABETO_BASE32HEX = "0123456789abcdefghijklmnopqrstuv"


# ── Identidad estable del evento ──────────────────────────────────────
def _base32hex_lower(digest):
    """Codifica bytes en base32hex minúscula (a–v, 0–9), sin dependencias."""
    bits, valor, salida = 0, 0, []
    for byte in digest:
        valor = (valor << 8) | byte
        bits += 8
        while bits >= 5:
            bits -= 5
            salida.append(ALFABETO_BASE32HEX[(valor >> bits) & 31])
    if bits:
        salida.append(ALFABETO_BASE32HEX[(valor << (5 - bits)) & 31])
    return "".join(salida)


def client_event_id(name):
    """Id de Google elegido por nosotros, estable para un `Event`.

    Reglas de `events.insert`: base32hex minúscula, largo 5–1024, único por
    calendario. Derivarlo del nombre hace que un reintento no cree un duplicado.
    """
    digest = hashlib.sha256(("crm:" + (name or "")).encode("utf-8")).digest()
    return _base32hex_lower(digest)[:32]


def content_hash(doc):
    """Hash canónico de lo que empujamos: la guarda de eco del pull (S3)."""
    payload = {
        "subject": (doc.get("subject") or "").strip(),
        "description": (doc.get("description") or "").strip(),
        "starts_on": str(doc.get("starts_on") or ""),
        "ends_on": str(doc.get("ends_on") or ""),
        "all_day": cint(doc.get("all_day")),
        "repeat_on": doc.get("repeat_on") or "",
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def retraso(intentos):
    """Backoff exponencial con jitter (segundos) para el intento N."""
    intentos = max(0, min(cint(intentos), 10))
    bruto = min(BASE_RETRASO * (2**intentos), MAX_RETRASO)
    return bruto + random.randint(0, BASE_RETRASO)


# ── Estado en la base (sin hooks: no dispara el sync nativo) ──────────
def _set_vals(name, vals):
    meta = frappe.get_meta("Event")
    campos = {k: v for k, v in vals.items() if meta.get_field(k)}
    if campos:
        frappe.db.set_value("Event", name, campos, update_modified=False)


def _en_patch():
    """No encolar durante migrate/install: los backfills no son cambios del user."""
    return bool(
        frappe.flags.get("in_migrate")
        or frappe.flags.get("in_patch")
        or frappe.flags.get("in_install")
    )


def hay_cuenta_push():
    """¿Hay alguna `Google Calendar` con push habilitado? Gatea el encolado."""
    try:
        return bool(
            frappe.db.exists(
                "Google Calendar", {"enable": 1, "push_to_google_calendar": 1}
            )
        )
    except Exception:
        return False


def marcar_pendiente(doc, origin="crm"):
    """Marca una escritura local del CRM como pendiente de push."""
    name = getattr(doc, "name", doc)
    _set_vals(
        name,
        {
            "custom_sync_origin": origin,
            "custom_dirty": 1,
            "custom_sync_estado": ESTADO_PENDIENTE,
            "custom_tombstone": 0,
        },
    )


def marcar_tombstone(name):
    """Marca el borrado antes de propagarlo (el worker lo resuelve)."""
    _set_vals(
        name,
        {
            "custom_tombstone": 1,
            "custom_dirty": 1,
            "custom_sync_estado": ESTADO_PENDIENTE,
            "custom_sync_error": None,
        },
    )


def _marcar_estado(name, estado, error=None):
    vals = {"custom_sync_estado": estado}
    if error is not None:
        vals["custom_sync_error"] = error
    _set_vals(name, vals)


# ── Encolado ──────────────────────────────────────────────────────────
def _encolar(metodo, name):
    if _en_patch() or not hay_cuenta_push():
        return
    try:
        frappe.enqueue(
            metodo,
            queue="short",
            event_name=name,
            enqueue_after_commit=True,
        )
    except Exception:
        # Encolar nunca puede romper el guardado del CRM; el reintento periódico
        # (`reintentar_pendientes`) levanta lo que quede con `custom_dirty=1`.
        frappe.log_error(
            title="Google Calendar sync: no se pudo encolar",
            message=f"{metodo} event={name}",
        )


def encolar_push(doc):
    _encolar("crm_core.google_sync.push_event", getattr(doc, "name", doc))


def encolar_borrado(name):
    _encolar("crm_core.google_sync.procesar_borrado", name)


# ── Cuenta y servicio ─────────────────────────────────────────────────
def _resolver_cuenta(doc=None):
    vinc = doc.get("google_calendar") if doc is not None else None
    if vinc and frappe.db.exists("Google Calendar", vinc):
        return vinc
    cuentas = frappe.get_all(
        "Google Calendar",
        filters={"enable": 1, "push_to_google_calendar": 1},
        pluck="name",
        order_by="creation asc",
        limit_page_length=2,
    )
    if not cuentas:
        return None
    if len(cuentas) == 1:
        return cuentas[0]
    if doc is not None and doc.get("owner"):
        propia = frappe.db.get_value(
            "Google Calendar",
            {"user": doc.get("owner"), "enable": 1, "push_to_google_calendar": 1},
            "name",
        )
        if propia:
            return propia
    return cuentas[0]


def _servicio_y_cuenta(doc=None):
    """Devuelve (google_api, account). Nunca usa `doc.google_calendar_id`."""
    from frappe.integrations.doctype.google_calendar.google_calendar import (
        get_google_calendar_object,
    )

    cuenta = _resolver_cuenta(doc)
    if not cuenta:
        raise ValueError("No hay una cuenta de Google Calendar con push habilitado.")
    # Se mira ANTES de `get_google_calendar_object`: si el id está vacío, el nativo
    # crearía un calendario nuevo (`check_google_calendar`) en vez de fallar claro.
    if not frappe.db.get_value("Google Calendar", cuenta, "google_calendar_id"):
        raise ValueError(
            "La cuenta de Google Calendar no tiene google_calendar_id: apuntarla al "
            "calendario correcto (normalmente 'primary') antes de empujar."
        )
    google, account = get_google_calendar_object(cuenta)
    if not account.push_to_google_calendar:
        raise ValueError("La cuenta de Google Calendar tiene el push apagado.")
    return google, account


# ── Cuerpo del evento ─────────────────────────────────────────────────
def _cuerpo(doc):
    from frappe.integrations.doctype.google_calendar.google_calendar import (
        format_date_according_to_google_calendar,
        get_attendees,
        repeat_on_to_google_calendar_recurrence_rule,
    )

    body = {"summary": doc.subject, "description": doc.description}
    body.update(
        format_date_according_to_google_calendar(
            doc.all_day,
            get_datetime(doc.starts_on),
            get_datetime(doc.ends_on) if doc.ends_on else None,
        )
    )
    if doc.get("repeat_on"):
        body["recurrence"] = repeat_on_to_google_calendar_recurrence_rule(doc)
    asistentes = get_attendees(doc)
    if asistentes:
        body["attendees"] = asistentes
    body["extendedProperties"] = {"private": {CLAVE_CRM: doc.name}}
    return body


# ── Errores y clasificación ───────────────────────────────────────────
class _ConflictoRemoto(Exception):
    """El remoto cambió desde nuestro último sync: la versión de Google manda."""

    def __init__(self, remoto):
        self.remoto = remoto or {}
        super().__init__("conflicto remoto")


def _status(err):
    return getattr(getattr(err, "resp", None), "status", None) or getattr(
        err, "status_code", None
    )


def _mensaje(err):
    return f"{type(err).__name__}: {err}"


def _es_transitorio(status):
    return status in (403, 429, 500, 502, 503, 504) or status is None


def _gcal_datetime(valor):
    if not valor:
        return None
    try:
        from dateutil import parser
        from zoneinfo import ZoneInfo

        from frappe.utils import get_system_timezone

        return (
            parser.parse(valor)
            .astimezone(ZoneInfo(get_system_timezone()))
            .replace(tzinfo=None)
        )
    except Exception:
        return None


def _releer(google, calendar_id, remote_id):
    try:
        return google.events().get(calendarId=calendar_id, eventId=remote_id).execute()
    except Exception:
        return None


# ── Upsert ────────────────────────────────────────────────────────────
def _upsert(doc, google, account):
    calendar_id = account.google_calendar_id
    if not calendar_id:
        raise ValueError("La cuenta de Google Calendar no tiene google_calendar_id.")
    body = _cuerpo(doc)
    remote_id = (doc.get("google_calendar_event_id") or "").strip()
    if remote_id:
        return _actualizar(doc, google, calendar_id, remote_id, body)
    return _insertar(doc, google, calendar_id, body)


def _insertar(doc, google, calendar_id, body):
    nuevo_id = client_event_id(doc.name)
    body = dict(body)
    body["id"] = nuevo_id
    try:
        return (
            google.events()
            .insert(calendarId=calendar_id, body=body, sendUpdates="all")
            .execute()
        )
    except Exception as err:
        if _status(err) == 409:
            # Un intento anterior ya lo creó: adoptar el existente, no duplicar.
            remoto = _releer(google, calendar_id, nuevo_id)
            if remoto:
                return remoto
        raise


def _actualizar(doc, google, calendar_id, remote_id, body):
    etag_local = (doc.get("custom_gcal_etag") or "").strip()
    try:
        remoto = google.events().get(calendarId=calendar_id, eventId=remote_id).execute()
    except Exception as err:
        if _status(err) in (404, 410):
            _marcar_estado(
                doc.name,
                ESTADO_CONFLICTO,
                "El evento remoto ya no existe en Google; no se recrea automáticamente.",
            )
            return None
        raise

    etag_remoto = (remoto.get("etag") or "").strip()
    if etag_local and etag_remoto and etag_local != etag_remoto:
        raise _ConflictoRemoto(remoto)

    remoto["summary"] = body["summary"]
    remoto["description"] = body.get("description")
    remoto["start"] = body["start"]
    remoto["end"] = body["end"]
    if "recurrence" in body:
        remoto["recurrence"] = body["recurrence"]
    props = remoto.setdefault("extendedProperties", {}).setdefault("private", {})
    props[CLAVE_CRM] = doc.name

    peticion = google.events().update(
        calendarId=calendar_id, eventId=remote_id, body=remoto, sendUpdates="all"
    )
    peticion.headers["If-Match"] = etag_local or etag_remoto
    try:
        return peticion.execute()
    except Exception as err:
        if _status(err) == 412:
            raise _ConflictoRemoto(_releer(google, calendar_id, remote_id))
        if _status(err) in (404, 410):
            _marcar_estado(
                doc.name,
                ESTADO_CONFLICTO,
                "El evento remoto desapareció durante la actualización.",
            )
            return None
        raise


def _marcar_exito(doc, evento, account):
    vals = {
        "google_calendar_event_id": evento.get("id")
        or doc.get("google_calendar_event_id"),
        "custom_gcal_etag": evento.get("etag"),
        "custom_gcal_updated": _gcal_datetime(evento.get("updated")),
        "custom_gcal_calendar_id": account.google_calendar_id,
        "custom_last_synced_at": now_datetime(),
        "custom_last_synced_local_modified": doc.get("modified"),
        "custom_dirty": 0,
        "custom_sync_origin": "crm",
        "custom_sync_estado": ESTADO_SINCRONIZADA,
        "custom_sync_error": None,
        "custom_sync_intentos": 0,
        "custom_content_hash": content_hash(doc),
        "custom_tombstone": 0,
    }
    if evento.get("hangoutLink"):
        vals["google_meet_link"] = evento.get("hangoutLink")
    _set_vals(doc.name, vals)


def _resolver_conflicto(doc, remoto):
    vals = {
        "custom_sync_estado": ESTADO_CONFLICTO,
        "custom_dirty": 0,
        "custom_sync_error": (
            "El evento cambió en Google desde el último sync; se conserva la versión "
            "de Google (revisar y resolver)."
        ),
    }
    if remoto:
        if remoto.get("etag"):
            vals["custom_gcal_etag"] = remoto["etag"]
        if remoto.get("updated"):
            vals["custom_gcal_updated"] = _gcal_datetime(remoto["updated"])
    _set_vals(doc.name, vals)
    frappe.log_error(
        title=f"Google Calendar conflicto (Event {doc.name})",
        message=json.dumps(
            {k: (remoto or {}).get(k) for k in ("id", "status", "etag", "updated")}
        ),
    )


def _manejar_fallo(doc, err, borrado=False):
    status = _status(err)
    intentos = cint(doc.get("custom_sync_intentos") or 0) + 1
    transitorio = _es_transitorio(status) and intentos < MAX_INTENTOS
    vals = {
        "custom_sync_estado": ESTADO_PENDIENTE if transitorio else ESTADO_FALLO,
        "custom_sync_error": _mensaje(err)[:500],
        "custom_sync_intentos": intentos,
        # Marca temporal del último intento: `reintentar_pendientes` mide el backoff.
        "custom_last_synced_at": now_datetime(),
        "custom_dirty": 1 if transitorio else 0,
    }
    _set_vals(doc.name, vals)
    frappe.log_error(
        title=f"Google Calendar sync (Event {doc.name})",
        message=f"{_mensaje(err)}\nstatus={status}\nborrado={borrado}",
    )


# ── Jobs ──────────────────────────────────────────────────────────────
def push_event(event_name):
    """Worker de push. Nunca propaga excepciones: el fallo queda visible en el doc."""
    if not frappe.db.exists("Event", event_name):
        return
    doc = frappe.get_doc("Event", event_name)
    if cint(doc.get("custom_tombstone")):
        return procesar_borrado(event_name)
    # Una reserva de la web la manda Google (contrato §2): no se re-empuja.
    if cint(doc.get("pulled_from_google_calendar")):
        return
    try:
        google, account = _servicio_y_cuenta(doc)
    except Exception as err:
        _manejar_fallo(doc, err)
        return
    try:
        evento = _upsert(doc, google, account)
    except _ConflictoRemoto as conflicto:
        _resolver_conflicto(doc, conflicto.remoto)
        return
    except Exception as err:
        _manejar_fallo(doc, err)
        return
    if evento:
        _marcar_exito(doc, evento, account)


def _cancelar(doc, google, account):
    """Cancela en Google. Idempotente: 404/410 = ya no está."""
    calendar_id = account.google_calendar_id
    remote_id = (doc.get("google_calendar_event_id") or "").strip()
    etag_local = (doc.get("custom_gcal_etag") or "").strip()
    try:
        remoto = (
            google.events().get(calendarId=calendar_id, eventId=remote_id).execute()
        )
    except Exception as err:
        if _status(err) in (404, 410):
            return
        raise
    if remoto.get("status") == "cancelled":
        return
    etag_remoto = (remoto.get("etag") or "").strip()
    if etag_local and etag_remoto and etag_local != etag_remoto:
        # El remoto cambió: no se pisa en silencio (contrato §2).
        raise _ConflictoRemoto(remoto)
    remoto["status"] = "cancelled"
    remoto["recurrence"] = None
    peticion = google.events().update(
        calendarId=calendar_id, eventId=remote_id, body=remoto, sendUpdates="all"
    )
    peticion.headers["If-Match"] = etag_local or etag_remoto
    try:
        peticion.execute()
    except Exception as err:
        if _status(err) == 412:
            raise _ConflictoRemoto(_releer(google, calendar_id, remote_id))
        if _status(err) in (404, 410):
            return
        raise


def _borrar_local(name):
    from crm_core.api import _sacar_del_sync_antes_de_borrar

    # Limpia el link al calendario ANTES del delete: si no, el `on_trash` nativo
    # volvería a intentar cancelar (en silencio) sobre un evento ya cancelado.
    _sacar_del_sync_antes_de_borrar(name)
    frappe.delete_doc("Event", name, ignore_permissions=True, force=True)


def procesar_borrado(event_name):
    """Cancela en Google y recién entonces borra local. Prueba el orden en los tests."""
    if not frappe.db.exists("Event", event_name):
        return
    doc = frappe.get_doc("Event", event_name)
    remote_id = (doc.get("google_calendar_event_id") or "").strip()
    if not remote_id:
        _borrar_local(event_name)
        return
    try:
        google, account = _servicio_y_cuenta(doc)
    except Exception as err:
        _manejar_fallo(doc, err, borrado=True)
        return
    try:
        _cancelar(doc, google, account)
    except _ConflictoRemoto as conflicto:
        _resolver_conflicto(doc, conflicto.remoto)
        return
    except Exception as err:
        _manejar_fallo(doc, err, borrado=True)
        return
    _borrar_local(event_name)


# ── Reintentos y reconciliación ───────────────────────────────────────
def reintentar_pendientes():
    """Reencola los pendientes cuando venció su ventana de backoff. Devuelve cuántos."""
    if not hay_cuenta_push() or not frappe.get_meta("Event").get_field("custom_dirty"):
        return 0
    filas = frappe.get_all(
        "Event",
        filters=[
            ["custom_dirty", "=", 1],
            ["pulled_from_google_calendar", "=", 0],
            ["custom_sync_estado", "in", [ESTADO_PENDIENTE, ESTADO_FALLO]],
        ],
        fields=["name", "custom_sync_intentos", "custom_last_synced_at"],
        limit_page_length=0,
    )
    ahora = now_datetime()
    encolados = 0
    for fila in filas:
        intentos = cint(fila.get("custom_sync_intentos") or 0)
        if intentos >= MAX_INTENTOS:
            continue
        ultimo = fila.get("custom_last_synced_at")
        if ultimo and (ahora - get_datetime(ultimo)).total_seconds() < retraso(intentos):
            continue
        encolar_push(fila["name"])
        encolados += 1
    return encolados


def reconciliar():
    """Marca duplicados por id de Google y tombstones sin propagar. No borra nada."""
    if not frappe.get_meta("Event").get_field("custom_gcal_etag"):
        return 0
    filas = frappe.get_all(
        "Event",
        filters=[["google_calendar_event_id", "is", "set"]],
        fields=["name", "google_calendar_event_id"],
        order_by="creation asc",
        limit_page_length=0,
    )
    grupos = {}
    for fila in filas:
        gid = (fila.get("google_calendar_event_id") or "").strip()
        if gid:
            grupos.setdefault(gid, []).append(fila["name"])
    marcados = 0
    for gid, nombres in grupos.items():
        if len(nombres) > 1:
            for nombre in nombres[1:]:
                _marcar_estado(
                    nombre,
                    ESTADO_CONFLICTO,
                    f"Evento duplicado en el CRM para el id de Google {gid}.",
                )
                marcados += 1
    for fila in frappe.get_all(
        "Event", filters=[["custom_tombstone", "=", 1]], fields=["name", "custom_sync_estado"], limit_page_length=0
    ):
        if fila.get("custom_sync_estado") not in (ESTADO_PENDIENTE, ESTADO_FALLO):
            _marcar_estado(
                fila["name"],
                ESTADO_CONFLICTO,
                "Evento marcado para borrar que no se pudo propagar a Google.",
            )
            marcados += 1
    return marcados
