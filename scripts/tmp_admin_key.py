"""Helper temporal: crea o borra una API key de Administrator para verificar
endpoints autenticados contra un sitio. Uso:

    MODE=create FRAPPE_SITE=crm.marcosbarbosagroup.com ./env/bin/python tmp_admin_key.py
    MODE=remove FRAPPE_SITE=crm.marcosbarbosagroup.com ./env/bin/python tmp_admin_key.py

Siempre borrar la key después de usar (MODE=remove).
"""

import os
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe

frappe.init(
    os.environ.get("FRAPPE_SITE", "crm.marcosbarbosagroup.com"),
    sites_path="/home/frappe/frappe-bench/sites",
)
frappe.connect()
frappe.flags.in_install_db = False

user = frappe.get_doc("User", "Administrator")
if os.environ.get("MODE") == "remove":
    user.api_key = ""
    user.api_secret = ""
    user.save(ignore_permissions=True)
    frappe.db.commit()
    print("REMOVED")
else:
    secret = frappe.generate_hash(length=15)
    user.api_key = frappe.generate_hash(length=15)
    user.api_secret = secret
    user.save(ignore_permissions=True)
    frappe.db.commit()
    print("KEY=" + user.api_key)
    print("SECRET=" + secret)
