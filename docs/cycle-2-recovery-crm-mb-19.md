# Cycle 2 Recovery — crm-mb:19 con crm_core baked-in

## Resumen

El `crm-mb:18` que se construyó la sesión previa NO tenía `crm_core` baked-in (la app custom MbCRM con la agenda React en `/hoy`). Esta sesión reconstruye todo desde el VPS con la base correcta.

## Cambios aplicados

### 1. Reconstrucción de la imagen
- Construido `crm-mb:19` desde el VPS usando `docker/Dockerfile.crm-mb` con `BASE=crm-mb:18`
- Verificado: smoke test OK (`import crm_core, crm_core.api`)
- Reposicionado `apps/crm_core/crm_core/mbcrm/doctype/` → `_archived_doctypes/` (18 DocTypes legacy)
- Editado `Dockerfile.crm-mb` smoke test: ahora valida `crm_core.api` en vez de `crm_core.mbcrm.doctype.task.task` (ya archivado)
- Actualizado `compose.yaml`: `crm-mb:17` → `crm-mb:19` (6 services)
- Deploy exitoso via `docker stack deploy`

### 2. Setup pre-install
- `common_site_config.json` estaba vacío (0 bytes) → reconstruido con dns/db_host/redis
- `apps.txt` actualizado: `frappe / crm` → `frappe / crm / crm_core`
- `tabModule Def.MbCRM.app_name` actualizado de `crm` a `crm_core`
- `installed_apps` global actualizado a `["frappe", "crm", "crm_core"]`

### 3. Install + Migrate
- `bench install-app crm_core` exitoso
- `bench migrate` ejecutó y eliminó **automáticamente** los 18 DocTypes orphaned (existían en BD pero no en código por el archivado)
- Total DocTypes: 319 (después del cleanup)

### 4. Verificación `/hoy`
- HTTP 200 con SPA React servido (302KB)
- `id="root"`, `window.CSRF`, `<title>CRM · Marcos Barbosa Group</title>`

## Cycle 2 features (ejecutadas en este session)

### P0.2 — Service Level Agreements
- `MBBP — Lead Response SLA` (60min para Open, 4h para Replied)
- `MBBP — Deal Resolution SLA` (4h para Open, 8h para Replied)

### P0.3 — Sales Dashboards (3 dashboards, 5 charts, 2 number cards)
- **Sales Pipeline Value**: Pipeline Won + Pipeline Open (Sum Bars)
- **Sales Activities**: Tasks Over Time + Leads Over Time (Time-series)
- **Sales Lead Source Mix**: Leads by Source (Donut)
- **Number Cards**: Leads Stale sin actividad 7d + Total Leads Abiertos

### P2.6 — Activity timeline enhancements
Custom Fields agregados a CRM Lead:
- `custom_last_call_date` (Datetime, read-only)
- `custom_last_email_date` (Datetime, read-only)
- `custom_next_followup` (Date, editable, in list view)

### P2.7 — Lead scoring
Custom Fields + Server Script semanal (cron Mondays 8am):
- `custom_score` (Int, read-only, in list view)
- `custom_score_reason` (Small Text, read-only)
- Reglas: source +0/+10, email +5, mobile +3, industry match +5/+10, inactivity -1/day (max -20)

### Updated Server Script
`MBBP — Deal stage → auto-tasks` ahora también setea `custom_next_followup` en el Deal cuando cambia stage.

## Estado al cerrar cycle 2

| Componente | Estado |
|---|---|
| Imagen | crm-mb:19 corriendo |
| installed_apps | ["frappe", "crm", "crm_core"] |
| /hoy route | ✅ Funcionando |
| Datos reales | 13 leads, 5 tasks, 2 deals, 9 events |
| Cycle 1 widgets | ✅ Widget Próximas reuniones funcional (3 items) |
| Cycle 2 dashboards | 3 dashboards + 5 charts + 2 number cards |
| Cycle 2 SLAs | 2 SLAs (Lead + Deal) |
| Cycle 2 custom fields | 5 nuevos |
| Cycle 2 lead scoring | ✅ Server Script creado |

## Pendientes (bloqueados o para cycle 3)

### P0.1 — Email Account (BLOQUEADO)
- Requiere App Password de Google del usuario
- Acción: crear `consultora.marcosbarbosa@gmail.com` o similar, activar 2FA, generar App Password
- Sin esto no llegan notifications por email

### P1.4 — frappe_whatsapp (BLOQUEADO)
- El `bench get-app` descargó pero `bench build --app frappe_whatsapp` FALLÓ por falta de memoria
- Requiere CX33 (8GB) para rebuildear imagen con este app baked-in

### Otros para cycle 3
- Command palette (⌘K)
- Dark mode toggle
- PWA features (offline, push)
- Conversion funnel dashboard
- Email sequence engine (custom DocType + cron)
- Webhooks Slack/Discord

## Commits realizados en esta sesión

`7ebb1cb chore(deploy): crm-mb:19 con crm_core baked-in` (con los archivados + Dockerfile fixed + compose 19)

`03a268a refactor(crm_core): archivar 18 DocTypes legacy que chocan con FCRM built-in` (en mi Mac antes de sincronizar con VPS)

## Notas operacionales

- No pude pushear a GitHub (sin credenciales en este entorno). Los cambios quedaron en commits locales del VPS y del Mac.
- El transfer de 3GB via SSH se cortó — la estrategia fue construir desde el VPS directamente (más eficiente).
- El `docker build` desde Mac con arm64 vs linux/amd64 emulation funcionó pero requirió `--platform=linux/amd64 --build-arg`.
- El orphan cleanup automático de `bench migrate` resolvió las 18 collisions retroactivas sin intervención manual.
