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
Website · WhatsApp · Referido · Conferencia · LinkedIn · **Agenda Reunión** (+ defaults de la app)

## Sync Google Calendar → CRM (activo 2026-09-04)
- Cron cada 1 min: `sync-gcal-crm.py` → log `/var/log/crm-gcal-sync.log`
- Config: `/etc/crm-gcal-sync/config.json` (client_id web + refresh token de **Agenda.personal.mb@gmail.com**)
- Solo crea leads de eventos CON invitados (eventos personales del calendar se ignoran)
- Campos: `custom_meeting_datetime` (fecha/hora reserva) + `custom_event_id` (dedupe)
- **⚠️ Refrescar token expira en 7 días si la app está en "Testing"** → publicar a producción: Google Auth Platform → Público → Publishing status → "In production" (sin verificación, los usuarios siguen viendo warning pero el token no expira)

## Config regional
Language: es · Timezone: America/Argentina/Cordoba · Country: Argentina

## Integración web → CRM (verificada end-to-end 2026-09-04)
- Endpoint: `POST https://crm.marcosbarbosagroup.com/api/resource/CRM Lead`
- Auth: `Authorization: token <API_KEY>:<API_SECRET>` (usuario web-form)
- Body: `{"data": "{\"first_name\":…,\"last_name\":…,\"email\":…,\"mobile_no\":…,\"source\":\"Website\",\"notes\":…}"}`
- Env del servicio web en Dokploy: `NEXT_PUBLIC_CRM_URL` + `CRM_API_KEY` + `CRM_API_SECRET`
- Smoke test: CRM-LEAD-2026-00001 creado (borrar de la UI cuando se quiera)

## Campos custom (creados 2026-09-04)
- `custom_plan_interes`: Select (Plan 1-4) ✅
- `notes`: Data (Notas del formulario) ✅

## Pendientes fase 2
- `custom_facturacion_anual` (si Marcos lo pide)
- SMTP saliente para welcome emails y notificaciones
- WhatsApp Business (frappe_whatsapp app)
- Backups offsite (S3/B2 vía restic — el Containerfile ya trae restic)
