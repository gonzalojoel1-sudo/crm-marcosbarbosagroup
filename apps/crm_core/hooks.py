"""Hooks for crm_core (Fase 0).

scheduler_events, doc_events, app_include_js, etc., se llenan en
T6 (GCal sync scheduler) y T7 (Cal.com webhook). Hoy queda el shell.
"""

app_name = "crm_core"
app_title = "MB CRM Core"
app_publisher = "Marcos Barbosa Group"
app_description = "Premium CRM core on Frappe Framework"
app_email = "ops@marcosbarbosagroup.com"
app_license = "proprietary"

# Stubs: tareas reales llegan en T6 (scheduler) y T7 (webhooks).
scheduler_events = {}
doc_events = {}
