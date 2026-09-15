import frappe
frappe.flags.in_install_db = False
# Rename module_def from crm_core → Core
frappe.db.sql("UPDATE tabModule_Def SET module_name='Core' WHERE name='crm_core'")
frappe.db.commit()
print("Renamed OK")
print("Modules:")
for r in frappe.db.sql("SELECT name, module_name, app_name FROM tabModule_Def", as_dict=True):
    print(r)
print("module_app (current):", frappe.local.module_app)
