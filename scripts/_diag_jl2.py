import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

j = frappe.get_jloader()
for i, L in enumerate(getattr(j, "loaders", [])):
    name = type(L).__name__
    pkg = getattr(L, "package_name", None) or getattr(L, "package", None)
    paths = getattr(L, "searchpath", None)
    print(f"loader {i}: {name} package={pkg}")

for tpl in ("www/hoy.html", "www/crm.html"):
    try:
        j.get_source(frappe.get_jenv(), tpl)
        print(f"{tpl}: FOUND")
    except Exception as e:
        print(f"{tpl}: {type(e).__name__}")

# How is the jloader built?
import frappe.utils.jinja_globals as jg
import inspect
src = inspect.getsource(jg)
for line in src.splitlines():
    if "PackageLoader" in line or "def set_jloader" in line or "def get_jloader" in line:
        print("SRC:", line.strip())
