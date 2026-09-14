"""Workaround para popular DocTypes de crm_core cuando bench install-app falla.

Uso:  docker exec ... python3 /home/frappe/load_crm_core_doctypes.py
"""
import os, sys, json

apps_root = "/home/frappe/frappe-bench/apps"
sys.path.insert(0, apps_root)
sys.path.insert(0, f"{apps_root}/crm_core")

import frappe

# Site config
site = os.environ.get("FRAPPE_SITE", "crm-test")
frappe.init(site=site, sites_path=f"{apps_root}/..")
frappe.connect()
frappe.flags.in_install_db = False

# 1. Limpiar caches
frappe.cache.delete_value("app_modules")
frappe.cache.delete_value("installed_app_modules")

# 2. Reconstruir local.module_app desde Module Def tabla
from frappe.modules.utils import scrub
md_list = frappe.db.get_all("Module Def", fields=["module_name", "app_name"])
print(f"Module Def rows: {len(md_list)}")
frappe.local.module_app = frappe.local.module_app or {}
for row in md_list:
    frappe.local.module_app[scrub(row["module_name"])] = row["app_name"]
# Agregar crm_core manualmente si no está
if "crm_core" not in frappe.local.module_app:
    frappe.local.module_app["crm_core"] = "crm_core"
    print("forzando local.module_app['crm_core'] = crm_core")

# 3. Cargar DocTypes uno a uno via import_file
print("=== loading DocTypes ===")
from frappe.modules.import_file import import_file
doctype_dir = f"{apps_root}/crm_core/crm_core/doctype"
loaded, failed = [], []
for fname in sorted(os.listdir(doctype_dir)):
    sub = f"{doctype_dir}/{fname}"
    if not os.path.isdir(sub):
        continue
    json_files = [f for f in os.listdir(sub) if f.endswith(".json")]
    for jf in json_files:
        full = f"{sub}/{jf}"
        try:
            doc = json.load(open(full))
            # Construir/actualizar DocType via ORM
            dt_name = doc.get("name")
            if frappe.db.exists("DocType", dt_name):
                d = frappe.get_doc("DocType", dt_name)
                # Actualizar campos críticos
                d.module = doc.get("module", "crm_core")
                d.title = doc.get("title", dt_name)
                d.custom = 0
                d.is_virtual = doc.get("is_virtual", 0)
                d.istable = doc.get("istable", 0)
                d.editable_grid = 1
                d.track_changes = doc.get("track_changes", 1)
                d.allow_rename = doc.get("allow_rename", 1)
                # Reemplazar fields y permissions
                d.fields = []
                for fdef in doc.get("fields", []):
                    d.append("fields", fdef)
                d.permissions = []
                for perm in doc.get("permissions", []):
                    d.append("permissions", perm)
                d.save(ignore_permissions=True)
                print(f"  UPD {dt_name}")
            else:
                d = frappe.new_doc("DocType")
                d.update(doc)
                d.insert(ignore_permissions=True)
                print(f"  INS {dt_name}")
            loaded.append(dt_name)
        except Exception as e:
            failed.append((fname, str(e)[:120]))
            print(f"  FAIL {fname}: {e}")

# Commit
frappe.db.commit()
print(f"=== SUMMARY ===")
print(f"loaded={len(loaded)} failed={len(failed)}")
print(f"DB DocTypes with module=crm_core:")
doctypes = frappe.db.get_all("DocType", filters={"module": "crm_core"}, pluck="name")
print(f"  {len(doctypes)}: {doctypes}")
frappe.destroy()
