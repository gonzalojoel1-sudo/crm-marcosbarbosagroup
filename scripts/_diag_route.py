import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

from frappe.website.path_resolver import resolve_path, PathResolver
from frappe.website.utils import get_website_rules

print("website rules:", get_website_rules())

for path in ("hoy", "crm"):
    try:
        print(f"resolve_path({path!r}) ->", resolve_path(path))
    except Exception as e:
        print(f"resolve_path({path!r}) EXC:", type(e).__name__, e)

for path in ("hoy", "crm"):
    pr = PathResolver(path)
    try:
        endpoint, renderer = pr.resolve()
        print(f"PathResolver({path!r}) -> endpoint={endpoint!r} renderer={type(renderer).__name__}")
    except Exception as e:
        print(f"PathResolver({path!r}) EXC:", type(e).__name__, e)
