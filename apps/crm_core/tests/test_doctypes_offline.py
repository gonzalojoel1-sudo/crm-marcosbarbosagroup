"""Tests de los contratos offline (sin red).

`tests/test_rest_smoke.py` corre contra Frappe real. Estos tests verifican que
los archivos JSON cumplen invariantes offline-rápido (cuenta campos, valida
tipos), de modo que un fallo de DocType se detecta antes de subir al backend.
"""
import json
import glob
from pathlib import Path

import pytest

DOCTYPES = sorted(
    glob.glob("crm_core/mbcrm/doctype/*/*.json")
    + glob.glob("crm_core/doctype/*/*.json")
)


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
    """La red no sirve si el glob vuelve vacío: eso ya pasó (ruta mal escrita)."""
    assert len(DOCTYPES) >= 3, f"el glob no encontró DocTypes: {DOCTYPES}"


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_define_la_clase_que_frappe_busca(path: str):
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
    """Un Link a un DocType inexistente hace fallar el migrate en producción."""
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
