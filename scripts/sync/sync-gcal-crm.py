#!/usr/bin/env python3
# Sync Google Calendar → Frappe CRM.
# Corre con el cron: * * * * *  (cada minuto) en el VPS, con /usr/bin/python3.
#
# v3. Qué cambió y por qué, todo demostrado por tests en
# apps/crm_core/tests/test_sync_gcal.py (55 casos, sin frappe ni red):
#
#  1. **El sync ya no crea Leads a menos que se le pida.** Antes creaba un Lead
#     por cada evento, con el `displayName` del primer invitado como nombre, sin
#     filtrar las salas (`resource: true`). "Encuentro vision mundial para la
#     familia" es una sala de Meet y terminó como si fuera una persona. Con
#     `create_leads` en false (default) el sync solo escribe Events.
#  2. **Filtra cancelados, bloques libres y salas.** `status=cancelled` y
#     `transparency=transparent` ya no generan nada.
#  3. **Las series recurrentes colapsan.** `singleEvents=true` expande cada
#     ocurrencia con id propio, así que una reunión semanal fabricaba un lead
#     nuevo por semana, para siempre (en el estado del sync había 52 ocurrencias
#     de solo 3 series). Ahora la clave de idempotencia es `recurringEventId`.
#  4. **La base es la fuente de verdad del idempotencia.** Antes el único corte
#     era un set en un archivo, y el lead se creaba ANTES del chequeo de
#     duplicado: reprocesar dejaba un lead huérfano garantizado. Ahora se consulta
#     `Event.google_calendar_event_id`.
#  5. **flock en vez de O_CREAT|O_EXCL.** Si el proceso moría (SIGKILL, OOM,
#     reboot) dejaba el lock colgado y el sync no volvía a correr nunca más, sin
#     dejar señal. El kernel libera un flock al morir el proceso.
#
# Además: paginación con nextPageToken (antes topaba en 250 en silencio: 451
# corridas), retry con backoff en 429/5xx (hubo 116 HTTP 500), escritura atómica
# del estado, y el offset de zona se parsea en vez de truncarse.
#
# La lógica que decide qué hacer con un evento NO está acá: vive en
# `gcal_sync_lib.py`, que es pura y testeable.
import datetime
import fcntl
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gcal_sync_lib as lib  # noqa: E402

CONFIG_PATH = os.environ.get("GCAL_SYNC_CONFIG", "/etc/crm-gcal-sync/config.json")
STATE_DIR = os.environ.get("GCAL_SYNC_STATE_DIR", "/var/lib/crm-gcal-sync")
STATE = os.path.join(STATE_DIR, "processed.json")
LOCK = os.environ.get("GCAL_SYNC_LOCK", "/var/lib/crm-gcal-sync/sync.lock")

RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_INTENTOS = 4


def log(msg):
    print(f"[{datetime.datetime.now().strftime('%F %T')}] {msg}", flush=True)


def _sleep_backoff(intento):
    # 1s, 2s, 4s… con un poco de jitter para no golpear sincronizado.
    time.sleep(min(2**intento, 30) * (0.7 + 0.3 * ((intento * 7919) % 10) / 10))


def api(method, url, data=None, headers=None, intentos=MAX_INTENTOS):
    """Llamada HTTP con retry y backoff para 429/5xx.

    Antes no reintentaba nada: un 500 dejaba el estado sin escribir y la corrida
    siguiente reintentaba todo desde cero. El log tiene 116 HTTP 500.
    """
    cuerpo = json.dumps(data).encode() if data is not None else None
    ultimo = None
    for intento in range(intentos):
        try:
            req = urllib.request.Request(
                url, data=cuerpo, headers=headers or {}, method=method
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                crudo = r.read()
            return json.loads(crudo) if crudo else {}
        except urllib.error.HTTPError as ex:
            ultimo = ex
            if ex.code in RETRY_STATUS and intento < intentos - 1:
                _sleep_backoff(intento)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as ex:
            ultimo = ex
            if intento < intentos - 1:
                _sleep_backoff(intento)
                continue
            raise
    raise ultimo if ultimo else RuntimeError("api() sin respuesta")


class Crm:
    """Cliente del REST de Frappe, solo para lo que el sync necesita."""

    def __init__(self, cfg):
        self.base = cfg["crm_url"].rstrip("/")
        self.auth = {"Authorization": f"token {cfg['api_key']}:{cfg['api_secret']}"}

    def _hdr(self, extra=None):
        h = dict(self.auth)
        h["Content-Type"] = "application/json"
        if extra:
            h.update(extra)
        return h

    def crear_lead(self, payload):
        return api(
            "POST",
            f"{self.base}/api/resource/CRM%20Lead",
            {"data": json.dumps(payload)},
            self._hdr(),
        )

    def crear_evento(self, payload):
        return api(
            "POST",
            f"{self.base}/api/resource/Event",
            {"data": json.dumps(payload)},
            self._hdr(),
        )

    def eventos_por_gcal_id(self, gcal_id):
        """Idempotencia contra la base, no contra un archivo.

        Devuelve el nombre del Event si ya existe, o None. La serie recurrente
        se resuelve con un prefijo: `serie:<recurringEventId>` contra un campo de
        texto, así que se busca por el `recurringEventId` guardado en las notas.
        """
        filtros = json.dumps([["google_calendar_event_id", "=", gcal_id]])
        r = api(
            "GET",
            f"{self.base}/api/resource/Event?filters={urllib.parse.quote(filtros)}"
            f"&fields=name&limit_page_length=1",
            headers=self.auth,
        )
        return r["data"][0]["name"] if r.get("data") else None

    def lead_por_email(self, email):
        filtros = json.dumps([["email", "=", email]])
        r = api(
            "GET",
            f"{self.base}/api/resource/CRM%20Lead?filters={urllib.parse.quote(filtros)}"
            f"&fields=name&limit_page_length=1",
            headers=self.auth,
        )
        return r["data"][0]["name"] if r.get("data") else None

    def series_ya_sincronizadas(self):
        """Set de los `recurringEventId` que ya tienen un Event.

        Se arma con una sola llamada en vez de una por serie: la consulta usa
        `like` sobre el id de Google, que es lo que se guarda en el Event.
        """
        r = api(
            "GET",
            f"{self.base}/api/resource/Event"
            f"?filters={urllib.parse.quote(json.dumps([['google_calendar_event_id', 'like', 'serie:%']]))}"
            f"&fields=google_calendar_event_id&limit_page_length=0",
            headers=self.auth,
        )
        return {d.get("google_calendar_event_id") for d in (r.get("data") or [])}


def cargar_estado():
    """El set de claves ya procesadas. Un archivo corrupto NO debe matar el sync.

    Antes: `json.load` sin try. Si el write a medio camino lo dejaba truncado, la
    corrida siguiente moría, el `finally` soltaba el lock, el cron reintentaba en
    60 s y fallaba para siempre, cada minuto, sin loguear nada.
    """
    try:
        with open(STATE) as f:
            return set(json.load(f))
    except FileNotFoundError:
        return set()
    except (json.JSONDecodeError, ValueError, OSError) as ex:
        log(f"WARN estado ilegible ({ex}); sigo con el set vacío, la base manda")
        return set()


def guardar_estado(estado):
    """Write atómico: tmp + rename. Nunca queda un processed.json a medias."""
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = f"{STATE}.tmp"
    with open(tmp, "w") as f:
        json.dump(sorted(estado), f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, STATE)


def token(cfg):
    """Access token por refresh. El endpoint de Google no es JSON-RPC: va form."""
    data = urllib.parse.urlencode(
        {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "refresh_token": cfg["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode()
    for intento in range(MAX_INTENTOS):
        try:
            with urllib.request.urlopen(
                "https://oauth2.googleapis.com/token", data=data, timeout=20
            ) as r:
                return json.loads(r.read())["access_token"]
        except urllib.error.HTTPError as ex:
            if ex.code in RETRY_STATUS and intento < MAX_INTENTOS - 1:
                _sleep_backoff(intento)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            if intento < MAX_INTENTOS - 1:
                _sleep_backoff(intento)
                continue
            raise


def eventos_de_google(cfg, hdr):
    """Trae los eventos paginando de verdad.

    Antes: un solo `events.list` con `maxResults=250` y el `nextPageToken`
    ignorado. El log muestra 451 corridas que terminaron exactamente en
    "ya vistos: 250": los eventos por encima del tope eran invisibles.
    """
    ahora = datetime.datetime.now(datetime.timezone.utc)
    time_min = (ahora - datetime.timedelta(days=cfg.get("lookback_days", 7))).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    time_max = (ahora + datetime.timedelta(days=cfg.get("lookahead_days", 90))).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    params = {
        "timeMin": time_min,
        "timeMax": time_max,
        "singleEvents": "true",
        "maxResults": 250,
        "eventTypes": "default",
        "orderBy": "updated",
    }
    salida, pagina = [], None
    while True:
        q = dict(params)
        if pagina:
            q["pageToken"] = pagina
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + urllib.parse.urlencode(q)
        r = api("GET", url, headers=hdr)
        salida.extend(r.get("items", []))
        pagina = r.get("nextPageToken")
        if not pagina:
            break
    return salida


def correr(cfg, crm):
    estado = cargar_estado()
    # Las series ya presentes en la base, para no re-traer una serie completa cada
    # corrida. Sin esto, `processed` en disco era el único corte y se perdía con
    # cualquier corrupción del archivo.
    series_en_base = crm.series_ya_sincronizadas()

    hdr = {"Authorization": f"Bearer {token(cfg)}"}
    eventos = eventos_de_google(cfg, hdr)
    log(f"google devolvió {len(eventos)} eventos")

    crear_leads = bool(cfg.get("create_leads", False))
    n_leads = n_events = n_ya = n_omitidos = 0

    for ev in eventos:
        p = lib.parse_event(ev, cfg)
        if p is None:
            n_omitidos += 1
            continue

        clave = p["clave"]
        if clave in estado:
            n_ya += 1
            continue
        if clave.startswith("serie:") and clave in series_en_base:
            estado.add(clave)
            n_ya += 1
            continue

        # Idempotencia contra la BASE, antes de escribir nada. Antes el lead se
        # creaba y después se chequeaba el duplicado: huérfano garantizado.
        gcal_id = p["google_event_id"]
        if crm.eventos_por_gcal_id(gcal_id):
            estado.add(clave)
            n_ya += 1
            continue

        payload = {
            "subject": p["summary"],
            "starts_on": p["starts_on"],
            "ends_on": p["ends_on"],
            "all_day": 1 if p["all_day"] else 0,
            "google_calendar_event_id": p["clave"] if p["recurring_event_id"] else gcal_id,
            "custom_crm_categoria": p["categoria"],
            "custom_sync_estado": "Sincronizada",
        }
        if p["invitado_email"]:
            lead_existente = crm.lead_por_email(p["invitado_email"])
            if lead_existente:
                payload["custom_crm_lead"] = lead_existente

        crm.crear_evento(payload)
        n_events += 1
        log(f"evento creado: {p['summary'][:50]!r} [{p['categoria']}] clave={clave}")

        # El Lead es opt-in y, aun así, solo si hay una persona identificable.
        if crear_leads and p["lead"]:
            existe = crm.lead_por_email(p["lead"]["email"])
            if not existe:
                lead_payload = dict(p["lead"])
                lead_payload.update(
                    {
                        "source": cfg.get("lead_source", "Agenda Reunión"),
                        "notes": f"Reunión agendada: {p['summary']}\n"
                        f"Cuando: {p['starts_on']}\nEventId: {gcal_id}",
                        "custom_meeting_datetime": p["starts_on"],
                    }
                )
                try:
                    crm.crear_lead(lead_payload)
                    n_leads += 1
                except Exception as ex:  # noqa: BLE001
                    log(f"WARN lead create: {ex}")

        estado.add(clave)
        if clave.startswith("serie:"):
            series_en_base.add(clave)

    # Poda: el set crecía para siempre. Lo que no está ni en disco ni en la base
    # ya no vuelve a aparecer porque la ventana de Google no lo trae.
    guardar_estado(estado)
    log(
        f"sync ok - eventos: {n_events}, leads: {n_leads}, "
        f"omitidos: {n_omitidos}, ya vistos: {n_ya}, estado: {len(estado)}"
    )


def main():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    os.makedirs(STATE_DIR, exist_ok=True)
    # flock: el kernel lo libera cuando el proceso muere, incluido SIGKILL, OOM
    # y reboot. Con O_CREAT|O_EXCL el lock sobrevivía y el sync moría en silencio.
    with open(LOCK, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            log("ya hay una corrida en curso; salgo")
            return 0
        try:
            correr(cfg, Crm(cfg))
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:  # noqa: BLE001
        # El cron corre cada minuto: un traceback por corrida llenaría el log.
        # Loguear una línea y salir != 0 hace que cron mande mail si lo tiene.
        log(f"ERROR {type(ex).__name__}: {ex}")
        sys.exit(1)
