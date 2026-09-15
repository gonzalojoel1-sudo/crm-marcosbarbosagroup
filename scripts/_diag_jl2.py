import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

j = frappe.get_jloader()
for i, L in enumerate(getattr(j, "loaders", [])):
    print(f"--- loader {i}: {type(L).__name__} ---")
    for p in getattr(L, "searchpath", []):
        print("   ", p)

print()
print("installed_apps:", frappe.get_installed_apps())
print("crm_core app path:", frappe.get_app_path("crm_core"))
print("crm_core www exists:", os.path.isdir(os.path.join(frappe.get_app_path("crm_core"), "www")))
