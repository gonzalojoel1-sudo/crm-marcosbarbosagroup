import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

for dt in ("CRM Lead", "CRM Deal", "CRM Task", "Event", "Task"):
    try:
        print(f"{dt}:", frappe.db.count(dt))
    except Exception as e:
        print(f"{dt}: ERR", str(e)[:60])

print("\n=== CRM Leads con custom_meeting_datetime (reservas reales) ===")
try:
    total = frappe.db.sql("SELECT COUNT(*) FROM `tabCRM Lead` WHERE custom_meeting_datetime IS NOT NULL")[0][0]
    print("  total con meeting:", total)
    rows = frappe.db.sql(
        "SELECT name, first_name, last_name, email, custom_meeting_datetime, status "
        "FROM `tabCRM Lead` WHERE custom_meeting_datetime IS NOT NULL "
        "ORDER BY custom_meeting_datetime DESC LIMIT 10",
        as_dict=True,
    )
    for r in rows:
        print("  ", r)
except Exception as e:
    print("  ERR:", str(e)[:200])
