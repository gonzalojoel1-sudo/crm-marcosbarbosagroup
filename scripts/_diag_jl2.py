import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

j = frappe.get_jloader()
print("jloader:", type(j))
loaders = getattr(j, "loaders", [])
print("num loaders:", len(loaders))
for L in loaders:
    sp = getattr(L, "searchpath", None)
    if sp:
        for p in sp:
            if "crm_core" in p or "crm/www" in p or p.endswith("/www"):
                print("  PATH:", p)

for tpl in ("www/hoy.html", "www/crm.html"):
    try:
        j.get_source(frappe.get_jenv(), tpl)
        print(f"{tpl}: FOUND")
    except Exception as e:
        print(f"{tpl}: {type(e).__name__}: {e}")

# where does frappe look for www of an app?
from frappe.website.page_renderers.template_page import TemplatePage
import inspect
src = inspect.getsource(TemplatePage.can_render)
print("---- TemplatePage.can_render ----")
print(src)
