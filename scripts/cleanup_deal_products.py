"""Vacía CRM Deal.products (los presupuestos viejos, que eran de prueba).

Los presupuestos ahora viven en el DocType CRM Presupuesto. El campo queda en
desuso hasta que se elimine en una fase posterior.

Uso:
    ... ./env/bin/python cleanup_deal_products.py --dry-run
    ... ./env/bin/python cleanup_deal_products.py
"""
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe

DRY = "--dry-run" in sys.argv


def main():
    frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
    frappe.connect()
    frappe.flags.in_install_db = False

    con_items = [
        r.name
        for r in frappe.get_all("CRM Deal", fields=["name"], limit_page_length=0)
        if frappe.get_all("CRM Products", filters={"parent": r.name}, limit=1)
    ]
    print(f"negocios con ítems en CRM Deal.products: {len(con_items)} -> {con_items}")
    if DRY:
        print("dry-run: no se toca nada")
        return

    for name in con_items:
        frappe.db.sql("delete from `tabCRM Products` where parent=%s", name)
    frappe.db.commit()
    print("listo. negocios con ítems ahora:", 0)


main()
