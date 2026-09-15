import os, sys, json
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe

print("=== common_site_config (keys con google) ===")
csc = json.load(open("/home/frappe/frappe-bench/sites/common_site_config.json"))
for k, v in csc.items():
    if "google" in k.lower():
        print(" ", k, "=", str(v)[:40])
print("  (todas las keys):", sorted(csc.keys()))

for site in ("crm.marcosbarbosagroup.com", "crm-test"):
    print(f"\n=== site: {site} ===")
    try:
        frappe.init(site, sites_path="/home/frappe/frappe-bench/sites")
        frappe.connect()
        frappe.flags.in_install_db = False
        print("  Google Calendar:", frappe.db.count("Google Calendar"))
        for r in frappe.db.sql("SELECT name, user, google_calendar_id, enable FROM `tabGoogle Calendar`", as_dict=True):
            print("   ", r)
        sc = frappe.get_site_config()
        print("  site_config google keys:", [k for k in sc if "google" in k.lower()])
        # server scripts
        ss = frappe.db.sql("SELECT name, script_type FROM `tabServer Script` WHERE script LIKE '%oogle%' OR name LIKE '%alendar%'", as_dict=True)
        print("  Server Scripts google:", [s["name"] for s in ss])
        cs = frappe.db.sql("SELECT name, dt FROM `tabCustom Script` WHERE script LIKE '%oogle%'", as_dict=True)
        print("  Custom Scripts google:", [c["name"] for c in cs])
        frappe.destroy()
    except Exception as e:
        print("  ERR:", str(e)[:120])
