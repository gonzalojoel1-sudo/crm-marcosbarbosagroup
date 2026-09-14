"""Tests de los contratos offline (sin red).

`tests/test_rest_smoke.py` corre contra Frappe real. Estos tests verifican que
los archivos JSON cumplen invariantes offline-rápido (cuenta campos, valida
tipos), de modo que un fallo de DocType se detecta antes de subir al backend.
"""
import json
import glob
from pathlib import Path

import pytest

DOCTYPES = sorted(glob.glob("apps/crm_core/crm_core/doctype/*/*.json"))


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


def test_event_has_booking_uid_unique():
    """Pre-requisito de T7 (idempotencia webhooks Cal.com).

    Frappe serializa `unique: 1` (entero), no `true` (bool). Aceptamos ambos.
    """
    d = json.loads(Path("apps/crm_core/crm_core/doctype/event/event.json").read_text())
    field = next((f for f in d["fields"] if f["fieldname"] == "booking_uid"), None)
    assert field, "Event.booking_uid faltante"
    assert field.get("unique") in (1, True), "Event.booking_uid debe ser UNIQUE"


def test_gcal_connection_tokens_are_readonly():
    """Tokens nunca editables manualmente (solo código OAuth)."""
    d = json.loads(
        Path("apps/crm_core/crm_core/doctype/gcal_connection/gcal_connection.json").read_text()
    )
    for fname in ("enc_access", "enc_refresh"):
        f = next((f for f in d["fields"] if f["fieldname"] == fname), None)
        assert f, f"GCal Connection.{fname} faltante"
        assert f.get("read_only") in (1, True), f"{fname} debe ser read_only"


def test_activity_append_only():
    """Spec §3: Activity sin delete para roles no-admin."""
    d = json.loads(
        Path("apps/crm_core/crm_core/doctype/activity/activity.json").read_text()
    )
    perms = d["permissions"]
    all_perms = [p for p in perms if "All" in p.get("role", "")]
    assert all_perms, "falta rol `All` para usuarios autenticados"
    for p in all_perms:
        delete = p.get("delete")
        assert delete in (0, False, None), \
            f"Activity.delete debe ser 0/false/ausente para rol All (append-only), got {delete!r}"
