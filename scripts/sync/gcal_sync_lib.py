#!/usr/bin/env python3
"""Lógica pura del sync de Google Calendar → CRM, sin I/O y sin frappe.

Existe separada del script por dos razones concretas:

1. **Testeable.** El script original era 155 líneas de nivel de módulo con
   efectos secundarios al importar (abría el lock, leía la config, pegaba contra
   la API). No había ni un test posible. Acá todo es función pura: entra un dict
   de Google, sale una decisión.

2. **El cron corre con `/usr/bin/python3`**, no con el venv del bench. Así que el
   script tiene que ser autocontenido y solo stdlib. Este módulo también.

Lo que arregla, en orden de gravedad:

- El nombre del lead era el `displayName` del primer invitado **sin filtrar los
  `resource: true`** (salas y salas de Meet). "Encuentro vision mundial para la
  familia" es el nombre de una sala, y terminaba como si fuera una persona.
- `title_filter` estaba en `''`, que es falsy: el filtro no existía. Toda
  reunión creaba un lead.
- El lead se creaba ANTES del único chequeo de duplicado, así que reprocesar un
  evento dejaba un lead huérfano garantizado.
- `singleEvents=true` sin mirar `recurringEventId`: cada ocurrencia de una serie
  semanal es un id nuevo → un lead nuevo por semana, para siempre.
"""

from __future__ import annotations

import datetime
import re
import unicodedata

# ── Configuración por defecto ────────────────────────────────────────────────
# Los nombres de clientes (`kruger`, `agenda marcos`) estaban hardcodeados en el
# código: cuando cambia el portfolio, el clasificador mintiendo en silencio. Ahora
# son datos, y se sobreescriben desde config.json.
CATEGORIAS_POR_DEFECTO: dict[str, list[str]] = {
    "Ministerial": ["ministerio", "iglesia", "pastoral"],
    "Software": ["software", "app", "aplicacion", "web", "demo"],
    "Consultora": ["constructora", "kruger", "agenda marcos", "consultora", "consulta"],
    "Personal": ["personal", "block", "profundo"],
}
CATEGORIA_POR_DEFECTO = "Trabajo"

# Dominios de correo que NO son una persona real: rex FREE/Google Workspace de
# pruebas, direcciones de recurso, noreply.
EMAIL_NO_PERSONA = re.compile(
    r"^(noreply|no-reply|postmaster|abuse|admin|info|contacto|hola)\b|"
    r"\.(invalid|local|test|example)$|"
    r"^(user|mailer-daemon)@",
    re.I,
)

# Palabras que delatan que un displayName es un título de reunión o un recurso, no
# una persona. Se comparan con acentos normalizados.
PALABRAS_DE_REUNION = {
    "reunion", "reuniones", "meeting", "call", "demo", "discovery", "standup",
    "stand-up", "agenda", "entrevista", "visita", "llamada", "zoom", "meet",
    "bloque", "block", "post", "pre", "sync", "sync-", "equipo", "team",
    "ministerio", "iglesia", "empresarial", "vision", "encuentro", "junta",
    "comite", "directiva", "consejo", "asamblea", "capacitacion", "curso",
    "webinar", "conferencia", "presentacion", "clase", "taller", "charla",
    "reunion-con", "nueva-reunion", "reserva", "booking", "appointment",
    "sala", "room", "auditorio", "oficina",
}


def _normalizar(texto: str) -> str:
    """minúsculas, sin acentos, sin puntuación, espacios colapsados."""
    if not texto:
        return ""
    t = unicodedata.normalize("NFD", str(texto).lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9\s-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def es_email_de_persona(email: str) -> bool:
    """¿Este email identifica a una persona, o es un recurso/noreply?"""
    if not email or "@" not in email:
        return False
    if EMAIL_NO_PERSONA.search(email):
        return False
    local, _, domain = email.partition("@")
    if not local or "." not in domain:
        return False
    return True


def parece_nombre_persona(display_name: str) -> bool:
    """¿El displayName parece una persona o el título de algo?

    Filtra los casos reales de producción: `"Encuentro vision mundial para la
    familia"` y `"Ministerio Empresarial"` son recursos, no gente.
    """
    n = _normalizar(display_name)
    if not n:
        return False
    palabras = set(n.split())
    if palabras & PALABRAS_DE_REUNION:
        return False
    # Un nombre de persona no suele pasar de 5 palabras, ni tener dígitos.
    if len(palabras) > 5 or any(c.isdigit() for c in n):
        return False
    return True


def nombre_persona(display_name: str, email: str) -> tuple[str, str] | None:
    """(first_name, last_name) si es una persona identificable; None si no.

    Devolver `None` es el punto: antes el script **siempre** devolvía algo, y por
    eso "Oscarvera063 -" terminó con un last_name centinela "-" y una sala
    terminó con first_name "Encuentro".
    """
    nombre = (display_name or "").strip()
    if not nombre and email:
        nombre = email.split("@")[0].replace(".", " ").replace("_", " ").title()
    if not nombre:
        return None
    # Si vino del email (sin displayName) hay que ser más tolerante: no tenemos
    # con qué juzgar si es una persona, pero el email ya es la prueba.
    if not display_name and es_email_de_persona(email):
        partes = nombre.split()
        if not partes:
            return None
        return partes[0], " ".join(partes[1:]) if len(partes) > 1 else "-"
    if not parece_nombre_persona(nombre):
        return None
    if not es_email_de_persona(email):
        # Sin email real no hay contra qué verificar: no se crea el lead.
        return None
    partes = nombre.split()
    if len(partes) == 1:
        return partes[0], "-"
    return partes[0], " ".join(partes[1:])


def invitado_real(ev: dict) -> dict | None:
    """El primer invitado que es una persona de verdad, o None.

    Filtra, en este orden: `self`, `organizer`, `resource: true` (salas, salas de
    Meet, Hardware), sin email, y noreply.
    """
    for a in ev.get("attendees") or []:
        if a.get("self") or a.get("organizer") or a.get("resource"):
            continue
        if not es_email_de_persona(a.get("email", "")):
            continue
        return a
    return None


def es_ignorable(ev: dict) -> str | None:
    """Motivo por el que el evento no debe generar nada, o None si sí debe."""
    if ev.get("status") == "cancelled":
        return "cancelado"
    if ev.get("transparency") == "transparent":
        return "libre (transparente)"
    if ev.get("eventType") not in (None, "default"):
        return f"eventType={ev.get('eventType')}"
    return None


def clave_idempotencia(ev: dict) -> str:
    """La clave con la que se decide si algo ya se sincronizó.

    Para una serie recurrente **todas las ocurrencias comparten clave**: así una
    reunión semanal no fabrica un registro nuevo por semana. Es el bug que
    produjo 52 ocurrencias de 3 series en el estado del sync.
    """
    rec = ev.get("recurringEventId")
    if rec:
        return f"serie:{rec}"
    return f"evento:{ev.get('id')}"


def parse_event(ev: dict, config: dict | None = None) -> dict | None:
    """Decide qué hacer con un evento de Google. Puro: entra un dict, sale otro.

    Devuelve None si el evento no debe producir nada (con el motivo en
    `_motivo`), o un dict con lo que hay que escribir.
    """
    config = config or {}
    motivo = es_ignorable(ev)
    if motivo:
        return None

    titulo_filtro = (config.get("title_filter") or "").strip()
    summary = (ev.get("summary") or "").strip()
    if titulo_filtro and titulo_filtro.lower() not in summary.lower():
        return None

    invitado = invitado_real(ev)
    lead = None
    if invitado is not None:
        partes = nombre_persona(invitado.get("displayName", ""), invitado.get("email", ""))
        if partes is not None:
            lead = {
                "first_name": partes[0],
                "last_name": partes[1],
                "email": invitado["email"],
                "mobile_no": invitado.get("phoneNumber") or "",
                "lead_name": f"{partes[0]} {partes[1]}".strip(),
            }

    return {
        "clave": clave_idempotencia(ev),
        "google_event_id": ev.get("id"),
        "recurring_event_id": ev.get("recurringEventId"),
        "summary": summary,
        "categoria": decidir_categoria(summary, config),
        "all_day": "date" in (ev.get("start") or {}),
        "starts_on": _a_naive(ev.get("start")),
        "ends_on": _a_naive(ev.get("end")) or _a_naive(ev.get("start")),
        "lead": lead,
        "invitado_email": (invitado or {}).get("email"),
    }


def _a_naive(borde: dict | None) -> str:
    """'2026-09-26T17:00:00-03:00' → '2026-09-26 17:00:00'.

    El script anterior hacía `start[:19].replace("T", " ")`, que **trunca el
    offset**: un evento de otra zona horaria quedaba corrido y no había forma de
    saberlo. Acá se parsea de verdad y se normaliza a la hora del sitio, que es
    lo que espera un Datetime naive de Frappe.
    """
    if not borde:
        return ""
    crudo = borde.get("dateTime") or borde.get("date") or ""
    if not crudo:
        return ""
    try:
        dt = datetime.datetime.fromisoformat(str(crudo).replace("Z", "+00:00"))
    except ValueError:
        return str(crudo)[:19].replace("T", " ")
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def decidir_categoria(summary: str, config: dict | None = None) -> str:
    """Categoría por el título, con **límite de palabra**, no substring.

    El substringMatching rompía de formas obvias: `"Consultorio médico"` caía en
    `Consultora` porque contains `consulta`, `"Webinar"` en `Software` porque
    contiene `web`, `"Blockchain"` en `Personal` porque contiene `block`.
    """
    config = config or {}
    mapa = config.get("categorias") or CATEGORIAS_POR_DEFECTO
    n = _normalizar(summary)
    if not n:
        return config.get("categoria_default") or CATEGORIA_POR_DEFECTO
    palabras = set(n.split())
    for categoria, claves in mapa.items():
        for clave in claves:
            k = _normalizar(clave)
            if not k:
                continue
            if " " in k or "-" in k:
                if k in n:  # frases: substring con espacios sí es correcto
                    return categoria
            elif k in palabras:  # palabra completa, no pedazo
                return categoria
    return config.get("categoria_default") or CATEGORIA_POR_DEFECTO
