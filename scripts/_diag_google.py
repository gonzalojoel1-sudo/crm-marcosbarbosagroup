import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

print("=== DocTypes con 'Google' ===")
for r in frappe.db.sql("SELECT name FROM `tabDocType` WHERE name LIKE '%Google%' ORDER BY name", as_dict=True):
    print(" ", r["name"])

print("\n=== Google Calendar (calendarios conectados) ===")
try:
    cols = [c[0] for c in frappe.db.sql("SHOW COLUMNS FROM `tabGoogle Calendar`")]
    for r in frappe.db.sql("SELECT * FROM `tabGoogle Calendar`", as_dict=True):
        print(" ", {k: (str(v)[:40] if v else v) for k, v in r.items() if k in ("name", "user", "calendar_name", "google_calendar_id", "enable", "pull_from_google_calendar", "push_to_google_calendar")})
    print("  total:", frappe.db.count("Google Calendar"))
except Exception as e:
    print("  ERR:", e)

print("\n=== Google Settings (OAuth) ===")
try:
    gs = frappe.get_single("Google Settings")
    print("  enabled:", gs.enable)
    print("  client_id:", (gs.client_id or "")[:30])
    print("  has_secret:", bool(gs.get_password("client_secret", raise_exception=False) if gs.client_id else None))
except Exception as e:
    print("  ERR:", e)

print("\n=== Scheduled Job Type (no detenidos) ===")
for r in frappe.db.sql("SELECT name, method, frequency, stopped FROM `tabScheduled Job Type` WHERE stopped=0 ORDER BY name", as_dict=True):
    if "google" in r["method"].lower() or "calendar" in r["method"].lower() or "sync" in r["method"].lower():
        print("  *", r["name"], "|", r["method"], "|", r["frequency"])
print("  total jobs:", frappe.db.count("Scheduled Job Type"))

print("\n=== Eventos con google ===")
print("  pulled_from_google:", frappe.db.count("Event", {"pulled_from_google_calendar": 1}))
print("  google_calendar_event_id set:", frappe.db.sql("SELECT COUNT(*) FROM tabEvent WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id != ''")[0][0])
