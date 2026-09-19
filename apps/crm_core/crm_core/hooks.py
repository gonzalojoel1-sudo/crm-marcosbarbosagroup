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
scheduler_events = {
    # S2: reintenta el push pendiente con backoff exponencial (lee `custom_dirty`).
    "cron": {
        "*/5 * * * *": ["crm_core.google_sync.reintentar_pendientes"],
    },
    # S2: reconciliación barata (duplicados por id de Google y tombstones sin propagar).
    "daily_long": ["crm_core.google_sync.reconciliar"],
}

# El recálculo de saldos (paid_amount / credit_total / outstanding) es un punto único.
# El camino confiable son los hooks del padre (CRMPago.on_update/after_insert/after_delete);
# el hook del hijo es refuerzo: en Frappe los doc_events de child tables no siempre disparan.
doc_events = {
    "CRM Pago Aplicacion": {
        "on_update": "crm_core.mbcrm.doctype.crm_pago.crm_pago.recalcular_desde_hijo",
    },
}

# Datos base idempotentes: las 7 verticales se siembran en cada migrate.
after_migrate = ["crm_core.fixtures.seed_verticales"]

# Rutas web propias. Mismo mecanismo que usa el app `crm` para /crm.
website_route_rules = [
    {"from_route": "/hoy", "to_route": "hoy"},
]
