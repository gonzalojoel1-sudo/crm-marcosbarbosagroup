# CRM Config — estado funcional (fase 1)

**Site:** crm.marcosbarbosagroup.com · Frappe 15.120.0 · app crm (main) · imagen `crm-mb:15`

## Usuarios
| Usuario | Rol | Nota |
|---|---|---|
| Administrator | System Manager | password en `.env` del VPS (`/opt/crm-marcosbarbosagroup/.env` → ADMIN_PASSWORD) |
| joel@marcosbarbosagroup.com | System Manager + Sales User + Sales Manager | password entregado por chat 2026-09-04, cambiar al primer login |
| web-form@marcosbarbosagroup.com | Sales User (solo API, sin login UI) | API key para formularios web. Secret NO en git |

## Pipeline (CRM Deal Status — exacto brochure)
Qualification (Open) → Diagnóstico (Open) → Análisis (Open) → Estrategia (Ongoing) → Implementación (Ongoing) → Seguimiento (Ongoing) → Escalamiento (Ongoing) → Won / Lost

## Lead Sources (CRM Lead Source)
Website · WhatsApp · Referido · Conferencia · LinkedIn (+ defaults de la app)

## Config regional
Language: es · Timezone: America/Argentina/Cordoba · Country: Argentina

## Integración web → CRM (verificada end-to-end 2026-09-04)
- Endpoint: `POST https://crm.marcosbarbosagroup.com/api/resource/CRM Lead`
- Auth: `Authorization: token <API_KEY>:<API_SECRET>` (usuario web-form)
- Body: `{"data": "{\"first_name\":…,\"last_name\":…,\"email\":…,\"mobile_no\":…,\"source\":\"Website\",\"notes\":…}"}`
- Env del servicio web en Dokploy: `NEXT_PUBLIC_CRM_URL` + `CRM_API_KEY` + `CRM_API_SECRET`
- Smoke test: CRM-LEAD-2026-00001 creado (borrar de la UI cuando se quiera)

## Pendientes fase 2
- Campos custom: `custom_plan_interes` (Plan 1-4), `custom_facturacion_anual`
- SMTP saliente para welcome emails y notificaciones
- WhatsApp Business (frappe_whatsapp app)
- Backups offsite (S3/B2 vía restic — el Containerfile ya trae restic)
