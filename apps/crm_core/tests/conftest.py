"""pytest fixtures para tests de crm_core contra el backend Frappe de test.

Requiere:
  FRAPPE_TEST_BASE    ej. https://crm-test.marcosbarbosagroup.com/api/method/login
  FRAPPE_TEST_ADMIN_PW  contraseña del Administrator en el site `crm-test`
  FRAPPE_TEST_LANG=en   opcional

El site `crm-test` se crea/asegura en T8 Step 2 del plan. Si no existe, los tests
fallan en runtime — esto es by design (no se tests contra prod).
"""
import os

import pytest
import requests


@pytest.fixture(scope="session")
def base() -> str:
    base = os.environ.get("FRAPPE_TEST_BASE")
    assert base, "FRAPPE_TEST_BASE no configurada"
    return base


@pytest.fixture(scope="session")
def admin_pw() -> str:
    pw = os.environ.get("FRAPPE_TEST_ADMIN_PW")
    assert pw, "FRAPPE_TEST_ADMIN_PW no configurada"
    return pw


@pytest.fixture(scope="session")
def base_no_login(base) -> str:
    """URL base sin /api/method/login (para REST v2 /api/v2/...)."""
    return base.rsplit("/api/", 1)[0]


@pytest.fixture(scope="session")
def session(base, admin_pw) -> requests.Session:
    """POST form-urlencoded al login de Frappe → cookie sid por sesión.

    Basic auth NO funciona contra REST v2 (/api/v2/document/*). Solo login
    tradicional con cookies. Bug m1 documentado en plan §12.
    """
    s = requests.Session()
    r = s.post(
        base,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={"usr": "Administrator", "pwd": admin_pw},
        timeout=30,
    )
    assert r.ok, f"login falló: {r.status_code} {r.text[:200]}"
    return s
