import os, sys
sys.path.insert(0, "/home/frappe/frappe-bench/apps")
import frappe
from frappe.utils import add_to_date, now_datetime
frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect(); frappe.flags.in_install_db = False
when = add_to_date(now_datetime(), minutes=15)
d = frappe.get_doc({"doctype":"CRM Lead","first_name":"ZZ Reunion","last_name":"Prueba","email":"zzreunion@example.com","status":"New","source":"Agenda Reunión","custom_meeting_datetime": when,
  "notes": "Reunión agendada: Llamada de seguimiento con cliente\nCuando: %s" % when})
d.insert(ignore_permissions=True)
frappe.db.commit()
print("meeting:", d.name, "at", when)
