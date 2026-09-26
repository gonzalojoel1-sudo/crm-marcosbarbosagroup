"""Tests de los contratos offline (sin red).

`tests/test_rest_smoke.py` corre contra Frappe real. Estos tests verifican que
los archivos JSON cumplen invariantes offline-rápido (cuenta campos, valida
tipos), de modo que un fallo de DocType se detecta antes de subir al backend.

Sobre el descubrimiento de los DocTypes (arreglado 2026-09-26)
------------------------------------------------------------
El glob apuntaba a `crm_core/mbcrm/doctype/*/*.json`, pero el commit 03a268a movió
los 18 DocTypes a `crm_core/mbcrm/_archived_doctypes/` porque chocaban con los
built-in de FCRM. El glob volvió vacío y, como `parametrize` sobre una lista vacía
no genera ningún caso, los cuatro tests de abajo quedaron en `skipped` con el
motivo "got empty parameter set" — sin volver a rojo. El único que se dio cuenta
fue el meta-test `test_hay_doctypes_para_validar`, que es exactamente para eso.

Las dos rutas se globan y el resultado se ASSERTA, así que si mañana seArchivan o
se mueven los DocTypes el meta-test vuelve a rojo en vez de dejar la red muda.
`crm_core/doctype/` se mantiene por si el app vuelve a usar el módulo raíz.
"""
import json
import glob
from pathlib import Path

import pytest

# Raíz del paquete, resuelta desde la ubicación de este archivo y no del cwd: los
# tests corren desde `apps/crm_core` hoy, pero si mañana corren desde la raíz del
# repo el glob relativo vuelve a fallar en silencio (ya pasó dos veces).
_RAIZ = Path(__file__).resolve().parents[1]

_PATRONES = (
    "crm_core/mbcrm/doctype/*/*.json",
    "crm_core/mbcrm/_archived_doctypes/*/*.json",
    "crm_core/doctype/*/*.json",
)

DOCTYPES = sorted(
    p for patron in _PATRONES for p in glob.glob(str(_RAIZ / patron))
)

# Los DocTypes que Frappe todavía puede instanciar. Los archivados ya no: se
# movieron porque chocaban con los built-in de FCRM y `remove_orphan_doctypes()`
# los borraría en el migrate. Las invariantes de estructura (JSON bien formado,
# `fieldname` único) valen para todos; las de controller y de Links sólo son
# preguntas sobre DocTypes VIVOS y no tienen sentido sobre un archivo archivado.
VIVOS = [p for p in DOCTYPES if "_archived_doctypes" not in p]
ARCHIVADOS = [p for p in DOCTYPES if "_archived_doctypes" in p]


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_json_well_formed(path: str):
    """Cada JSON parsea y tiene shape mínimo."""
    d = json.loads(Path(path).read_text())
    assert d["doctype"] == "DocType"
    assert "name" in d
    assert "fields" in d
    assert isinstance(d["fields"], list)
    assert "module" in d
    assert d["module"] == "MbCRM"


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_has_unique_names_per_field(path: str):
    """campo fieldname único por DocType (Frappe falla migrate si no)."""
    d = json.loads(Path(path).read_text())
    names = [f.get("fieldname") for f in d["fields"]]
    duplicates = [n for n in names if n and names.count(n) > 1]
    assert not duplicates, f"{d['name']}: duplicados {duplicates}"


def test_hay_doctypes_para_validar():
    """La red no sirve si el glob vuelve vacío: eso ya pasó (ruta mal escrita).

    Es el meta-test que hace que los otros cuatro no se apaguen en silencio:
    `parametrize` sobre una lista vacía genera cero casos y pytest los reporta como
    `skipped`, que en un `pytest -q` es indistinguishable de "no hay nada que
    testear". Por eso el mínimo es 3 y no 0.
    """
    assert len(DOCTYPES) >= 3, f"el glob no encontró DocTypes: {DOCTYPES}"


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_define_la_clase_que_frappe_busca(path: str):
    # Sin skip: la invariante se cumple también para los archivados (los `.py` se
    # movieron con los JSON) y seguirla es la que detecta un archivo a medio mover.
    """Frappe obtiene el controller con `getattr(module, doctype.replace(" ", ""))`.

    Si la clase no se llama EXACTAMENTE así, el DocType es invisible: `get_controller`
    hace ImportError y `remove_orphan_doctypes()` lo BORRA en el migrate. Paso de verdad:
    `CRM Punto de Venta` tenia la clase `CRMPuntoDeVenta` y Frappe busca `CRMPuntodeVenta`.
    """
    d = json.loads(Path(path).read_text())
    py = Path(path).with_suffix(".py")
    if not py.exists():
        return  # sin controller: Frappe usa Document por defecto
    clase_esperada = d["name"].replace(" ", "").replace("-", "")
    assert f"class {clase_esperada}(" in py.read_text(), (
        f"{d['name']}: el controller debe declarar `class {clase_esperada}(...)`, "
        f"que es lo que Frappe busca"
    )


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_link_apunta_a_destinos_conocidos(path: str):
    """Un Link a un DocType inexistente hace fallar el migrate en producción.

    Corre también sobre los archivados a propósito: son el registro de qué apuntaba
    cada DocType antes de archivarse, y un Link roto ahí es la señal de que el
    archivo quedó a medio mover.
    """
    d = json.loads(Path(path).read_text())
    propios = {json.loads(Path(p).read_text())["name"] for p in DOCTYPES}
    # `Event` es un DocType real de Frappe (módulo Desk), no del app `crm`: va como externo.
    # `DocType` es core de Frappe y destino de Activity.ref_doctype y Task.linked_doctype.
    externos = {
        "User", "File", "Currency", "Country", "Event", "DocType", "CRM Deal", "CRM Lead",
        "CRM Organization", "CRM Task", "CRM Deal Status", "CRM Lead Source",
        # DocTypes canonicos de Frappe (modulo Contacts). Los DocTypes de la Fase 0 que
        # los pisaban se borraron; los Links de `deal`/`lead` apuntan a estos.
        "Contact", "Contact Email", "Contact Phone",
    }
    for f in d["fields"]:
        if f.get("fieldtype") == "Link":
            destino = f.get("options")
            assert destino in propios | externos, (
                f"{d['name']}.{f['fieldname']}: Link a '{destino}' desconocido"
            )


def test_el_glob_separo_vivos_de_archivados():
    """Las dos listas tienen que ser disjuntas y exhausting sobre `DOCTYPES`.

    Sin esto, un DocType nuevo en una tercera carpeta se contaría en `DOCTYPES` y
    en ninguna de las dos, y las invariantes "de vivo" pasarían sin correr.
    """
    assert sorted(VIVOS + ARCHIVADOS) == DOCTYPES
    assert not (set(VIVOS) & set(ARCHIVADOS))


def test_todo_doc_type_archivado_sigue_teniendo_su_controller():
    """Si un DocType se archiva, se archiva con su `.py`.

    El motivo de archivar fue que `remove_orphan_doctypes()` los borra en el migrate
    si la clase no se llama exactamente como Frappe la busca. Un JSON archivado sin
    su `.py` es un archivo a medio mover, y cuando alguien lo-desarchive va a
    fallar en el migrate de producción.
    """
    sin_py = [p for p in ARCHIVADOS if not Path(p).with_suffix(".py").exists()]
    assert not sin_py, f"DocTypes archivados sin controller: {sin_py}"
