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
    assert d["module"] == "crm_core"


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
def test_doctype_tiene_autoname_o_naming_series(path: str):
    """Un DocType sin forma de nombrarse falla al insertar, no al migrar."""
    d = json.loads(Path(path).read_text())
    fieldnames = [f.get("fieldname") for f in d["fields"]]
    assert d.get("autoname") or "naming_series" in fieldnames, f"{d['name']}: sin autoname"


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_link_apunta_a_destinos_conocidos(path: str):
    """Un Link a un DocType inexistente hace fallar el migrate en producción."""
    d = json.loads(Path(path).read_text())
    propios = {json.loads(Path(p).read_text())["name"] for p in DOCTYPES}
    externos = {
        "User", "File", "Currency", "Country", "CRM Deal", "CRM Lead",
        "CRM Organization", "CRM Task", "CRM Deal Status", "CRM Lead Source",
        "DocType",
    }
    for f in d["fields"]:
        if f.get("fieldtype") == "Link":
            destino = f.get("options")
            assert destino in propios | externos, (
                f"{d['name']}.{f['fieldname']}: Link a '{destino}' desconocido"
            )
