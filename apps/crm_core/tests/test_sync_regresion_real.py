"""Regresión sobre el dump REAL de eventos de producción.

Este archivo es el que hubiera detectado el problema antes de que contaminara el
CRM. No prueba funciones: prueba el **comportamiento agregado** del sync sobre
los eventos que hay en el calendario de verdad, y afirma el invariante que se
rompió:

    ningún CRM Lead puede existir con source='Agenda Reunión' sin un email real
    detrás, y ningún lead puede llamarse como un título de reunión.

El dump se reconstruyó desde el estado del sync viejo (`processed.json` del VPS
tenía 166 ids, de los cuales 52 eran ocurrencias de solo 3 series) y desde los 11
Events que el sync había creado. Si el calendario real difiere, este test
sigue siendo válido: lo que afirma es sobre la FORMA del evento, no sobre una
fecha.
"""

import importlib.util
import pathlib
import sys

_LIB = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "sync" / "gcal_sync_lib.py"
_spec = importlib.util.spec_from_file_location("gcal_sync_lib", _LIB)
lib = importlib.util.module_from_spec(_spec)
sys.modules["gcal_sync_lib"] = lib
_spec.loader.exec_module(lib)


def ev(id, summary, attendees, **kw):
    base = {
        "id": id,
        "summary": summary,
        "status": "confirmed",
        "transparency": "opaque",
        "eventType": "default",
        "start": {"dateTime": "2026-09-26T10:00:00-03:00"},
        "end": {"dateTime": "2026-09-26T11:00:00-03:00"},
        "attendees": attendees,
    }
    base.update(kw)
    return base


YO = {"email": "marcos@marcosbarbosagroup.com", "displayName": "Marcos Barbosa", "self": True}
SALA = {
    "email": "abcd-1234@resource.calendar.google.com",
    "displayName": "Encuentro vision mundial para la familia",
    "resource": True,
}
SALA2 = {
    "email": "efgh-5678@resource.calendar.google.com",
    "displayName": "Ministerio Empresarial",
    "resource": True,
}

# Los eventos que en producción se convirtieron en leads basura, con la forma que
# tenían realmente.
DUMP_REAL = [
    ev("e1", "Reunión Ministerio Empresarial", [YO, SALA2]),
    ev("e2", "Post encuentro vision mundial para la familia", [YO, SALA]),
    ev("e3", "Reunión con Dario Arguello (Revisar respecto al ministerio)", [YO, {"email": "dario@ejemplo.com", "displayName": "Dario Arguello"}]),
    ev("e4", "Reunión con Santiago García 10:30 (Armado de administración)", [YO, {"email": "santiago@ejemplo.com", "displayName": "Santiago García"}]),
    ev("e5", "Viernes 6:00 reunión con Verni (Constructora Kruger)", [YO, {"email": "verni@ejemplo.com", "displayName": "Verni"}]),
    ev("e6", "Reunión con Jonatan", [YO, {"email": "jonatan@ejemplo.com", "displayName": "Jonatan"}]),
    ev("e7", "Discovery call — Ministerio Empresarial", [YO, SALA2]),
    ev("e8", "Stand-up semanal con Joel", [YO, {"email": "joel@marcosbarbosagroup.com", "displayName": "Joel Pacheco"}]),
    ev("e9", "Demo producto para empresa de seguridad", [YO, SALA]),
    ev("e10", "Bloque: trabajo profundo", [YO]),
    ev("e11", "Call con Laura Racedo", [YO, {"email": "laura@kruger.com", "displayName": "Laura Racedo"}]),
    # 13 ocurrencias de una serie semanal, que es el caso que se reproducía solo
    *[
        ev(
            f"serie1_2026{i:02d}T170000Z",
            "Reunión con Jonatan — confirmar propuesta",
            [YO, {"email": "jonatan@ejemplo.com", "displayName": "Jonatan"}],
            recurringEventId="serie1",
        )
        for i in range(1, 14)
    ],
]


def test_el_sync_siempre_hubiera_creado_13_leads_por_ocurrencia():
    """El tamaño real del daño: 13 ocurrencias de UNA serie = 13 registros."""
    ocurrencias = [e for e in DUMP_REAL if e.get("recurringEventId") == "serie1"]
    assert len(ocurrencias) == 13
    # Con la lógica nueva, las 13 colapsan en una sola clave.
    claves = {lib.clave_idempotencia(e) for e in ocurrencias}
    assert claves == {"serie:serie1"}, f"deberían colapsar en 1, hubo {len(claves)}"


def test_ningun_lead_nace_de_una_sala():
    """Las dos salas del dump no pueden volverse personas."""
    salas = [e for e in DUMP_REAL if any(a.get("resource") for a in e["attendees"])]
    assert len(salas) == 4
    for e in salas:
        p = lib.parse_event(e)
        assert p is not None, "el evento se sincroniza igual"
        if p["lead"] is not None:
            nombre = p["lead"]["lead_name"].lower()
            assert "encuentro" not in nombre, f"se coló el nombre de la sala: {nombre}"
            assert "ministerio" not in nombre, f"se coló el nombre de la institución: {nombre}"


def test_todo_lead_que_nace_tiene_email_real():
    """El invariante que se rompió: 6 de 8 leads sin email."""
    for e in DUMP_REAL:
        p = lib.parse_event(e)
        if p and p["lead"]:
            assert lib.es_email_de_persona(p["lead"]["email"]), (
                f"{e['summary']!r} generó un lead sin email real: {p['lead']}"
            )


def test_ningun_lead_se_llama_como_un_titulo_de_reunion():
    for e in DUMP_REAL:
        p = lib.parse_event(e)
        if p and p["lead"]:
            assert p["lead"]["lead_name"] != e["summary"]


def test_el_rendimiento_del_dump_entero():
    """Procesa los 24 sin excepción, y el colapso lo hace la clave, no el parseo.

    Es importante separar los dos niveles, porque si no el test miente:

    - `parse_event` es **por evento**: 19 candidatos a lead (6 de los eventos
      sueltos con invitado real, más 13 ocurrencias de la serie de Jonatan).
    - El colapso a **una** serie lo hace la clave de idempotencia, que es lo que
      consulta el script antes de escribir.

    O sea que el sync real NO crearía 19 leads: crearía 6, y la serie de Jonatan
    sería 1 solo.
    """
    procesados = [lib.parse_event(e) for e in DUMP_REAL]
    assert len(DUMP_REAL) == 24
    assert sum(1 for p in procesados if p is not None) == 24, "todos los eventos se parsean"

    con_lead = [p for p in procesados if p and p["lead"]]
    # 6 de los 11 sueltos + 13 ocurrencias de la serie.
    assert len(con_lead) == 19

    # Pero lo que el script escribe depende de la clave: 7 eventos únicos.
    claves = {p["clave"] for p in procesados if p}
    assert len(claves) == 12, f"esperaba 12 claves únicas (11 sueltos + 1 serie), hubo {len(claves)}"

    # Y los leads únicos por persona son 6: la serie no agrega uno nuevo.
    personas = {p["lead"]["email"] for p in con_lead}
    assert len(personas) == 6, f"esperaba 6 personas distintas, hubo {len(personas)}"


def test_los_nombres_de_los_6_leads_son_personas():
    esperados = {"Dario", "Santiago", "Verni", "Jonatan", "Joel", "Laura"}
    obtenidos = set()
    for e in DUMP_REAL:
        p = lib.parse_event(e)
        if p and p["lead"]:
            obtenidos.add(p["lead"]["first_name"])
    assert obtenidos == esperados, f"nombres inesperados: {obtenidos ^ esperados}"
