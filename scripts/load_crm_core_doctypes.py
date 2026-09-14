"""Workaround para cargar crm_core como módulo en Frappe v15.

Problema: `bench install-app crm_core` + `bench --site X migrate` no popula
DocTypes cuando la app custom no viene de git remote. Bug documentado de Frappe v15.

Solución:
1. Invalidar cache de módulos
2. Reconstruir `frappe.local.module_app` con la carga correcta
3. Para cada DocType JSON en apps/crm_core/crm_core/doctype/, importarlo
   via `frappe.modules.import_file.import_file_by_path` forzado, sin pasar
   por reload-doc.
"""
import os, sys, json

# Force PYTHONPATH antes de importar nada
apps_root = "/home/frappe/frappe-bench/apps"
sys.path.insert(0, apps_root)
sys.path.insert(0, f"{apps_root}/crm_core")

import frappe
frappe.set_user("Administrator")

# 1. Inicializar site
site = "crm-test"
frappe.init(site)
frappe.connect()

print("=== STEP 1: invalidar caches ===")
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")
print("caches OK")

# 2. Force reload module_app
print("=== STEP 2: rebuild local.module_app ===")
from frappe.modules.utils import get_module_app, scrub
local = frappe.local
local.module_app = local.module_app or {}
# Forzar lectura fresca de Module Def (no del cache)
all_modules = frappe.db.get_all("Module Def", fields=["module_name", "app_name"])
print(f"Module Def count: {len(all_modules)}")
for row in all_modules:
    local.module_app[scrub(row["module_name"])] = row["app_name"]

# 3. Comprobar
print(f"local.module_app has 'crm_core': {'crm_core' in local.module_app}")
print(f"lookup: get_module_app('crm_core') = {get_module_app('crm_core')}")

# 4. Force load all DocTypes in crm_core
print("=== STEP 3: load DocTypes ===")
from frappe.modules.import_file import import_file
doctype_dir = f"{apps_root}/crm_core/crm_core/doctype"
loaded = []
for fname in sorted(os.listdir(doctype_dir)):
    sub = f"{doctype_dir}/{fname}"
    if not os.path.isdir(sub):
        continue
    json_files = [f for f in os.listdir(sub) if f.endswith(".json")]
    for jf in json_files:
        full = f"{sub}/{jf}"
        try:
            print(f"  loading {fname}/{jf}...", end=" ")
            import_file(full, force=True)
            loaded.append(fname)
            print("OK")
        except Exception as e:
            print(f"FAIL: {e}")

print(f"=== RESULT ===")
print(f"DocTypes loaded: {loaded}")

# Final count
doctypes = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print(f"DocTypes in DB with module=crm_core: {len(doctypes)} → {doctypes}")

frappe.db.commit()
frappe.destroy()
