import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

print("=== apps instaladas ===", frappe.get_installed_apps())

print("\n=== Server Scripts ===")
try:
    for r in frappe.db.sql("SELECT name, script_type, doctype_event, event_frequency, disabled FROM `tabServer Script`", as_dict=True):
        print("  ", r["name"], "|", r["script_type"], "|", r.get("doctype_event"), "|", r.get("event_frequency"), "| disabled:", r.get("disabled"))
except Exception as e:
    print("  ERR:", str(e)[:150])

print("\n=== Scheduled Jobs NO-core (method no empieza con frappe.) ===")
for r in frappe.db.sql("SELECT name, method, frequency, stopped FROM `tabScheduled Job Type` WHERE method NOT LIKE 'frappe.%'", as_dict=True):
    print("  *", r["name"], "|", r["method"], "|", r["frequency"], "| stopped:", r["stopped"])

print("\n=== Cualquier job con 'http', 'webhook', 'calendly', 'meet' ===")
for r in frappe.db.sql("SELECT name, method FROM `tabScheduled Job Type` WHERE method LIKE '%http%' OR method LIKE '%webhook%' OR method LIKE '%calendly%' OR method LIKE '%meet%'", as_dict=True):
    print("  *", r["name"], "|", r["method"])
