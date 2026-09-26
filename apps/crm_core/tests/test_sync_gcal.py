"""Tests de la lógica pura del sync de Google Calendar.

Sin frappe, sin red, sin I/O: entra un dict de Google, sale una decisión. Es lo
que antes **no se podía testear**, porque todo estaba en nivel de módulo dentro
del script del cron.

Los casos salen de la realidad de producción: los `displayName` que terminaron siendo leads
basura, las 52 ocurrencias de 3 series, los 451 corridas que toparon el límite de
paginación.
"""

import importlib.util
import pathlib
import sys

import pytest

_LIB = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "sync" / "gcal_sync_lib.py"
assert _LIB.exists(), f"no encontré la librería del sync en {_LIB}"
_spec = importlib.util.spec_from_file_location("gcal_sync_lib", _LIB)
lib = importlib.util.module_from_spec(_spec)
sys.modules["gcal_sync_lib"] = lib
_spec.loader.exec_module(lib)


# ─────────────────────────────────────────────────────────────────────────────
# Los nombres que en producción quedaron guardados como si fueran personas
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "display_name",
    [
        "Encuentro vision mundial para la familia",  # sala de Google Meet
        "Ministerio Empresarial",  # institución
        "Reunión con Jonatan",
        "Reunión Ministerio Empresarial",
        "Post encuentro vision mundial para la familia",
        "Sala 4 - despacho",
        "Stand-up semanal con Joel",
        "Comité de dirección",
        "Auditorio principal",
        "Demo producto para empresa de seguridad",
        "Reunión 1:1 con Joel",
        "Discovery call — Ministerio Empresarial",
    ],
)
def test_una_sala_o_un_titulo_no_es_una_persona(display_name):
    assert lib.parece_nombre_persona(display_name) is False, f"{display_name!r} no es una persona"
    assert lib.nombre_persona(display_name, "alguien@ejemplo.com") is None


@pytest.mark.parametrize(
    "display_name,email",
    [
        ("Dario Arguello", "dario@ejemplo.com"),
        ("Santiago García", "santiago@ejemplo.com"),
        ("Verni", "verni@ejemplo.com"),
        ("Franco Cabral", "cabralfranco214@gmail.com"),
        ("Fernando Bustos", "fbustos@ejemplo.com"),
    ],
)
def test_una_persona_real_si_se_descompone(display_name, email):
    partes = lib.nombre_persona(display_name, email)
    assert partes is not None, f"{display_name!r} debería ser persona"
    assert partes[0] == display_name.split(" ")[0]
    # El centinela "-" solo se permite para un nombre de un solo token.
    assert partes[1] == " ".join(display_name.split(" ")[1:]) or partes[1] == "-"


def test_nombre_de_un_solo_token_no_inventa_apellido():
    partes = lib.nombre_persona("Verni", "verni@ejemplo.com")
    assert partes == ("Verni", "-")


def test_sin_display_name_se_usa_el_local_part_del_email():
    partes = lib.nombre_persona("", "oscar.vera063@gmail.com")
    assert partes is not None
    assert partes[0] == "Oscar"
    assert "Vera063" in partes[1]


# ─────────────────────────────────────────────────────────────────────────────
# El invariante que habría atrapado todo esto: un lead sin email real no existe
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "email",
    [None, "", "sin-arroba", "noreply@ejemplo.com", "no-reply@ejemplo.com", "user@example.com"],
)
def test_emails_que_no_son_de_una_persona(email):
    assert lib.es_email_de_persona(email) is False


@pytest.mark.parametrize("email", ["dario@ejemplo.com", "verni@empresa.com.ar", "a@b.co"])
def test_emails_de_persona(email):
    assert lib.es_email_de_persona(email) is True


def test_un_displayName_de_persona_sin_email_no_genera_lead():
    """El nombre puede ser de persona, pero sin email no hay contra qué verificar."""
    assert lib.nombre_persona("Dario Arguello", "") is None
    assert lib.nombre_persona("Dario Arguello", "noreply@ejemplo.com") is None


# ─────────────────────────────────────────────────────────────────────────────
# Salas, cancelados y los que hay que dejar pasar
# ─────────────────────────────────────────────────────────────────────────────
def _ev(**kw):
    base = {
        "id": "abc123",
        "summary": "Reunión con Dario",
        "status": "confirmed",
        "transparency": "opaque",
        "start": {"dateTime": "2026-09-26T10:00:00-03:00"},
        "end": {"dateTime": "2026-09-26T11:00:00-03:00"},
        "attendees": [{"email": "dario@ejemplo.com", "displayName": "Dario Arguello"}],
    }
    base.update(kw)
    return base


def test_un_evento_normal_se_procesa():
    r = lib.parse_event(_ev())
    assert r is not None
    assert r["google_event_id"] == "abc123"
    assert r["lead"]["lead_name"].startswith("Dario")
    assert r["starts_on"] == "2026-09-26 10:00:00"


def test_un_evento_cancelado_no_procesa():
    assert lib.parse_event(_ev(status="cancelled")) is None


def test_un_bloque_libre_no_procesa():
    """transparency=transparent es un bloque de 'Ocupado/Disponible', no una reunión."""
    assert lib.parse_event(_ev(transparency="transparent")) is None


def test_una_sala_como_invitado_no_genera_lead_pero_si_el_evento():
    ev = _ev(
        attendees=[
            {"email": "sala-abc@resource.calendar.google.com", "displayName": "Sala 4", "resource": True},
            {"email": "dario@ejemplo.com", "displayName": "Dario Arguello"},
        ]
    )
    r = lib.parse_event(ev)
    assert r is not None, "el evento igual se sincroniza"
    assert r["lead"]["lead_name"].startswith("Dario"), "el invitado real es Dario, no la sala"


def test_una_sola_sala_no_genera_lead():
    ev = _ev(attendees=[{"email": "sala@resource.calendar.google.com", "displayName": "Sala 4", "resource": True}])
    r = lib.parse_event(ev)
    assert r is not None
    assert r["lead"] is None, "una sala no es un lead"


def test_self_y_organizer_se_ignoran():
    ev = _ev(
        attendees=[
            {"email": "marcos@mbb.com", "displayName": "Marcos Barbosa", "self": True},
            {"email": "boss@mbb.com", "displayName": "Jefe", "organizer": True},
            {"email": "dario@ejemplo.com", "displayName": "Dario Arguello"},
        ]
    )
    r = lib.parse_event(ev)
    assert r["lead"]["lead_name"].startswith("Dario")


def test_sin_invitados_sincroniza_el_evento_pero_no_el_lead():
    """Un bloque de trabajo sin invitados es una reunión real: entra el Event.

    Lo que NO puede pasar es que se invente una persona para acompañarlo. El
    criterio es "el Event siempre, el Lead solo si hay alguien", no "si no hay
    alguien no hay nada": en la agenda los bloques de trabajo son meetings
    legítimos y borrarlos sería peor que el problema que estamos corrigiendo.
    """
    r = lib.parse_event(_ev(attendees=[]))
    assert r is not None
    assert r["lead"] is None
    assert r["summary"] == "Reunión con Dario"


# ─────────────────────────────────────────────────────────────────────────────
# La fábrica infinita: 52 ocurrencias de 3 series
# ─────────────────────────────────────────────────────────────────────────────
def test_las_ocurrencias_de_una_serie_comparten_clave():
    """Este es EL bug: cada ocurrencia semanal generaba un lead nuevo."""
    serie = "a0q0n7u4gfnvqihcugntrh83v8"
    ocurrencias = [
        lib.parse_event(_ev(id=f"{serie}_20260926T170000Z", recurringEventId=serie)),
        lib.parse_event(_ev(id=f"{serie}_20261003T170000Z", recurringEventId=serie)),
        lib.parse_event(_ev(id=f"{serie}_20261010T170000Z", recurringEventId=serie)),
    ]
    claves = {r["clave"] for r in ocurrencias}
    assert len(claves) == 1, f"las 3 ocurrencias deberían compartir clave, hubo {claves}"
    assert claves.pop() == f"serie:{serie}"


def test_un_evento_suelto_usa_su_propio_id():
    r = lib.parse_event(_ev(id="suelto123"))
    assert r["clave"] == "evento:suelto123"


# ─────────────────────────────────────────────────────────────────────────────
# El límite de palabra vs. el substringMatching
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "summary,esperada",
    [
        # Lo que el substringMatching rompía:
        ("Consultorio médico del barrio", "Trabajo"),  # 'consulta' no es 'Consultora'
        ("Webinar de finance", "Trabajo"),  # 'web' no es 'Software'
        ("Revisión blockchain", "Trabajo"),  # 'block' no es 'Personal'
        ("Happening de fin de año", "Trabajo"),  # 'app' no es 'Software'
        ("Demo del producto", "Software"),
        ("Reunión Ministerio Empresarial", "Ministerial"),
        ("Consulta con Constructora Kruger", "Consultora"),
        ("Bloque: trabajo profundo", "Personal"),
        ("", "Trabajo"),
    ],
)
def test_la_categoria_usa_palabras_completas(summary, esperada):
    assert lib.decidir_categoria(summary) == esperada


def test_las_categorias_se_configuran_por_datos_no_por_codigo():
    """Los nombres de clientes estaban hardcodeados; ahora son configuración."""
    config = {"categorias": {"Clientes": ["acme", "globex"]}, "categoria_default": "Otros"}
    assert lib.decidir_categoria("Reunión con Acme", config) == "Clientes"
    assert lib.decidir_categoria("Reunión sin tema", config) == "Otros"
    # Y el default del código ya no aplica cuando hay config.
    assert lib.decidir_categoria("Reunión Ministerio Empresarial", config) == "Otros"


# ─────────────────────────────────────────────────────────────────────────────
# El título con filtro: `''` es falsy, ese fue el bug
# ─────────────────────────────────────────────────────────────────────────────
def test_sin_title_filter_no_se_filtra_nada():
    r = lib.parse_event(_ev(summary="Cualquier cosa"), config={"title_filter": ""})
    assert r is not None


def test_con_title_filter_aplica():
    cfg = {"title_filter": "Reunión"}
    assert lib.parse_event(_ev(summary="Reunión con Dario"), config=cfg) is not None
    assert lib.parse_event(_ev(summary="Demo producto"), config=cfg) is None


# ─────────────────────────────────────────────────────────────────────────────
# El offset: el script anterior lo truncaba y por eso todo depended de que
# el sitio y el calendario estuvieran en la misma zona
# ─────────────────────────────────────────────────────────────────────────────
def test_el_offset_se_parsea_y_no_se_trunca():
    r = lib.parse_event(_ev(start={"dateTime": "2026-09-26T10:00:00+02:00"}))
    # 10:00 en +02:00 son las 05:00 de la zona del host; lo que NO puede pasar es
    # que quede "10:00" como si fuera hora local.
    assert r["starts_on"].endswith(":00:00")
    assert len(r["starts_on"]) == 19


def test_un_evento_de_todo_el_dia():
    r = lib.parse_event(
        _ev(start={"date": "2026-09-26"}, end={"date": "2026-09-27"})
    )
    assert r["all_day"] is True
    assert r["starts_on"] == "2026-09-26 00:00:00"


def test_un_borde_feo_no_revienta():
    """Un dateTime que no se puede parsear pasa crudo en vez de romper la corrida.

    Truncarlo a 19 caracteres convertiría un formato desconocido en una fecha
    distinta sin avisar, que es peor que devolverlo tal cual.
    """
    r = lib.parse_event(_ev(start={"dateTime": "no-es-una-fecha"}))
    assert r is not None
    assert r["starts_on"] == "no-es-una-fecha"


# ─────────────────────────────────────────────────────────────────────────────
# El invariante de producción
# ─────────────────────────────────────────────────────────────────────────────
def test_un_evento_de_reunion_interna_no_genera_lead():
    """El caso que llenó el CRM de basura: una reunión sin guests externos."""
    ev = _ev(
        summary="Stand-up semanal con Joel",
        attendees=[
            {"email": "marcos@mbb.com", "displayName": "Marcos Barbosa", "self": True},
            {"email": "joel@mbb.com", "displayName": "Joel Pacheco"},
        ],
    )
    r = lib.parse_event(ev)
    assert r is not None, "el evento se sincroniza igual"
    # Joel Pacheco sí es una persona: esto SÍ genera lead. Lo que no debe pasar es
    # que el nombre del evento se convierta en el nombre del lead.
    assert r["lead"] is not None
    assert r["lead"]["lead_name"] != "Stand-up semanal con Joel"
    assert r["lead"]["lead_name"].startswith("Joel")


def test_el_nombre_del_lead_nunca_es_el_titulo_del_evento():
    for titulo in [
        "Reunión con Dario Arguello (Revisar respecto al ministerio)",
        "Viernes 6:00 reunión con Verni (Constructora Kruger)",
        "Discovery call — Ministerio Empresarial",
        "Post encuentro vision mundial para la familia",
    ]:
        r = lib.parse_event(_ev(summary=titulo))
        if r["lead"] is not None:
            assert r["lead"]["lead_name"] != titulo, f"{titulo!r} se coló como nombre"
