import os, sys, json
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

# Config del sync (sin secretos)
cfg = json.load(open("/etc/crm-gcal-sync/config.json"))
print("=== config del sync (sin secretos) ===")
for k, v in cfg.items():
    if "secret" in k.lower() or "token" in k.lower():
        print(" ", k, "= ***", f"(len {len(str(v))})")
    else:
        print(" ", k, "=", v)

frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False

for dt in ("CRM Lead", "CRM Deal", "CRM Task", "Event", "Task"):
    try:
        print(f"{dt}:", frappe.db.count(dt))
    except Exception as e:
        print(f"{dt}: ERR", str(e)[:60])

print("\n=== CRM Leads con custom_meeting_datetime ===")
try:
    rows = frappe.db.sql(
        "SELECT name, first_name, last_name, email, custom_meeting_datetime, custom_event_id, status "
        "FROM `tabCRM Lead` WHERE custom_meeting_datetime IS NOT NULL ORDER BY custom_meeting_datetime DESC LIMIT 10",
        as_dict=True,
    )
    for r in rows:
        print("  ", r)
    print("  total con meeting:", frappe.db.sql("SELECT COUNT(*) FROM `tabCRM Lead` WHERE custom_meeting_datetime IS NOT NULL")[0][0])
except Exception as e:
    print("  ERR:", str(e)[:150])
