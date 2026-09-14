import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
frappe.init("crm-test", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.flags.in_install_db = False
print("event_attendee:", bool(frappe.db.sql("SELECT 1 FROM tabDocType WHERE name=%s", "event_attendee")))
print("event:", bool(frappe.db.sql("SELECT 1 FROM tabDocType WHERE name=%s", "event")))
print("task:", bool(frappe.db.sql("SELECT 1 FROM tabDocType WHERE name=%s", "task")))
print("account:", bool(frappe.db.sql("SELECT 1 FROM tabDocType WHERE name=%s", "account")))
print("contact:", bool(frappe.db.sql("SELECT 1 FROM tabDocType WHERE name=%s", "contact")))
print("lead:", bool(frappe.db.sql("SELECT 1 FROM tabDocType WHERE name=%s", "lead")))
