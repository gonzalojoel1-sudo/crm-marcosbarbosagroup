import os, sys

# ── Guard de producción ──────────────────────────────────────────────────────
# Este script CREA y BORRA documentos en el sitio de producción, por diseño ("CRUD
# test on PROD"). Eso está bien para una verificación manual y a propósito; lo que
# no está bien es que se pueda disparar por accidente: un `python3 smoke_prod.py` a
# ciegas en el server siembra documentos reales en el CRM de un cliente. Por eso el
# sitio tiene que estar escrito en el comando:
#
#     ALLOW_PROD=1 SITE=crm.marcosbarbosagroup.com python3 scripts/smoke_prod.py
#
# Sin `ALLOW_PROD=1` no hace nada. El default del script pasó a ser el sitio de
# pruebas, que es donde tiene que estar la verificación automática.
SITE = os.environ.get("SITE", "crm-test.marcosbarbosagroup.com")
# Coincidencia EXACTA de host, no por sufijo: el sitio de pruebas es
# `crm-test.marcosbarbosagroup.com` y un match por sufijo lo tomaría por producción,
# que es el error inverso: te bloquea el sitio donde SÍ hay que correrlo.
PRODUCCION = {"crm.marcosbarbosagroup.com", "www.marcosbarbosagroup.com"}
PRODUCCION |= {
    h.strip().lower()
    for h in os.environ.get("CRM_PROD_HOSTS", "").split(",")
    if h.strip()
}
if SITE.lower() in PRODUCCION and os.environ.get("ALLOW_PROD") != "1":
    sys.stderr.write(
        f"\nRECHAZADO: {SITE} es producción y este script crea y borra documentos.\n"
        "  Para correr contra pruebas:  SITE=crm-test.marcosbarbosagroup.com\n"
        f"  Para producción, asumilo:   ALLOW_PROD=1 SITE={SITE}\n\n"
    )
    sys.exit(2)
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

site = SITE
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

# Force module map from DB (same pattern as the successful crm-test run)
from frappe.modules.utils import scrub
frappe.local.module_app = frappe.local.module_app or {}
for row in frappe.db.get_all("Module Def", fields=["module_name", "app_name"]):
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]

print("=== CRUD test on PROD (creates + deletes, no residue) ===")
t = frappe.new_doc("Task")
t.subject = "crm_core smoke test (auto-deletes)"
t.status = "Open"
t.priority = "Medium"
t.insert(ignore_permissions=True)
print(f"INSERTED: {t.name}")

read = frappe.db.get_value("Task", t.name, ["subject", "status"], as_dict=True)
print(f"READ:     {read}")

frappe.db.delete("Task", t.name)
frappe.db.commit()
print(f"DELETED:  {t.name}")

remaining = frappe.db.count("Task")
print(f"Task rows remaining: {remaining}")
print("=== CRUD OK ===")
