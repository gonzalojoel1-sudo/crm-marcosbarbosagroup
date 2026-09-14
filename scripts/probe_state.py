import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
site = "crm-test"
frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
print("DocTypes with module=crm_core:")
for r in frappe.db.sql("SELECT name, istable FROM tabDocType WHERE module='crm_core'", as_dict=True):
    print(f"  {r['name']} (istable={r['istable']})")
print(f"Total: {len(frappe.db.sql('SELECT name FROM tabDocType WHERE module=%s', 'crm_core'))}")
print(f"Module Def crm_core exists: {frappe.db.exists('Module Def', 'crm_core')}")
