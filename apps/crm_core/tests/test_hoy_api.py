"""Tests de la API de la página Hoy.

Corre contra un site de prueba (NO prod):

    FRAPPE_SITE=crm-test ./env/bin/python apps/crm_core/tests/test_hoy_api.py

Crea tareas de prueba, verifica la partición y las borra. Idempotente.
"""

import os
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe
from frappe.utils import nowdate, add_days


def setup():
    site = os.environ.get("FRAPPE_SITE", "crm-test")
    frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
    frappe.connect()
    frappe.flags.in_install_db = False
    frappe.set_user("Administrator")

    # Rebuild the in-memory module map from the DB (avoids stale cache in
    # standalone processes).
    from frappe.modules.utils import scrub

    frappe.cache.delete_value("app_modules")
    frappe.local.module_app = {}
    for row in frappe.db.get_all("Module Def", fields=["module_name", "app_name"]):
        frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]
    return site


def _mk(subject, due):
    d = frappe.get_doc(
        {"doctype": "Task", "subject": subject, "status": "Open", "due_datetime": due}
    )
    d.insert(ignore_permissions=True)
    return d


def _rm(name):
    frappe.delete_doc("Task", name, force=True, ignore_permissions=True)


def test_partition():
    from crm_core.api import get_hoy

    today = nowdate()
    overdue = _mk("__vencida", f"{add_days(today, -1)} 10:00:00")
    hoyd = _mk("__dehoy", f"{today} 09:00:00")
    done = _mk("__hecha", f"{today} 09:00:00")
    frappe.db.set_value("Task", done.name, "status", "Done")

    # Tarea sin fecha (alta rápida): debe aparecer en "hoy"
    from crm_core.api import quick_add_task

    rapid = quick_add_task("__sinfecha")

    res = get_hoy()
    subs_o = [t["subject"] for t in res["overdue"]]
    subs_t = [t["subject"] for t in res["tasks_today"]]

    assert "__vencida" in subs_o, subs_o
    assert "__dehoy" in subs_t, subs_t
    assert "__sinfecha" in subs_t, subs_t
    assert "__hecha" not in subs_o and "__hecha" not in subs_t

    for n in (overdue.name, hoyd.name, done.name, rapid["name"]):
        _rm(n)
    frappe.db.commit()
    print("test_partition: PASS")


def test_quick_add_and_complete():
    from crm_core.api import quick_add_task, complete_task

    r = quick_add_task("__rapida")
    assert r["subject"] == "__rapida", r
    assert frappe.db.get_value("Task", r["name"], "owner") == "Administrator"
    assert frappe.db.get_value("Task", r["name"], "status") == "Open"

    complete_task(r["name"])
    assert frappe.db.get_value("Task", r["name"], "status") == "Done"

    _rm(r["name"])
    frappe.db.commit()
    print("test_quick_add_and_complete: PASS")


if __name__ == "__main__":
    setup()
    test_partition()
    test_quick_add_and_complete()
    print("ALL PASS")
