"""Smoke test REST v2 contra DocTypes de crm_core.

Antes de install-app, este test falla con 404 (Task no existe, esperado).
Después de install-app + migrate, devuelve 200 y CRUD funciona end-to-end.
"""
import pytest


def test_task_crud_full_cycle(session, base_no_login):
    """Create → Read → Update → Delete sobre Task."""
    create = session.post(
        f"{base_no_login}/api/v2/document/Task",
        json={"subject": "smoke-task", "status": "Open", "priority": "Medium"},
        timeout=15,
    )
    assert create.ok, f"create Task: {create.status_code} {create.text[:200]}"
    name = create.json()["data"]["name"]
    assert name.startswith("TASK-") or len(name) > 0

    read = session.get(f"{base_no_login}/api/v2/document/Task/{name}", timeout=15)
    assert read.ok, f"read Task: {read.status_code}"
    assert read.json()["data"]["subject"] == "smoke-task"

    update = session.put(
        f"{base_no_login}/api/v2/document/Task/{name}",
        json={"status": "Done"},
        timeout=15,
    )
    assert update.ok, f"update Task: {update.status_code} {update.text[:200]}"
    assert update.json()["data"]["status"] == "Done"

    delete = session.delete(
        f"{base_no_login}/api/v2/document/Task/{name}", timeout=15
    )
    assert delete.ok, f"delete Task: {delete.status_code} {delete.text[:200]}"


def test_event_crud_with_booking_uid(session, base_no_login):
    """Event CRUD, idempotency contract: booking_uid UNIQUE."""
    payload = {
        "title": "smoke-event",
        "start_utc": "2026-09-20T14:00:00",
        "end_utc": "2026-09-20T14:30:00",
        "timezone": "America/Argentina/Buenos_Aires",
        "source": "manual",
        "booking_uid": "smoke-uid-1",
    }
    r = session.post(f"{base_no_login}/api/v2/document/Event", json=payload, timeout=15)
    assert r.ok, f"create Event: {r.status_code} {r.text[:200]}"
    name = r.json()["data"]["name"]

    r2 = session.post(f"{base_no_login}/api/v2/document/Event", json=payload, timeout=15)
    assert not r2.ok, "booking_uid duplicado debería fallar por constraint UNIQUE"
    assert r2.status_code in (409, 400, 417), f"got {r2.status_code}"

    session.delete(f"{base_no_login}/api/v2/document/Event/{name}", timeout=15)


@pytest.mark.parametrize(
    "doctype",
    [
        "Task",
        "Event",
        "Contact",
        "Account",
        "Lead",
        "Deal",
        "Activity",
        "GCal Connection",
        "GCal Sync State",
        "Sync Conflict",
    ],
)
def test_doctype_metadata_available(session, base_no_login, doctype):
    """Verifica que cada DocType aparece en /api/v2/doctype/<X>/meta."""
    r = session.get(
        f"{base_no_login}/api/v2/doctype/{doctype}/meta", timeout=15
    )
    assert r.ok, f"meta {doctype}: {r.status_code} {r.text[:200]}"
