# CRM Grupo Marcos Barbosa — Spec

**Fecha:** 2026-09-03
**Dominio:** `crm.marcosbarbosagroup.com` (DNS A → 2.28.121.92, ya propagado)
**VPS:** Hetzner CX23 Nuremberg — 2 vCPU / 3.7Gi RAM real / 40GB disco / 4GB swap
**Estado:** Frappe CRM standalone (sin ERPNext) · 2 usuarios · NO multitenant en esta fase
**Deploy:** Dokploy (ya operativo en el VPS) + Traefik SSL

---

## 1. Objetivo

CRM propio de la consultora sobre **Frappe CRM** para gestión de leads, deals y seguimiento según la metodología de 6 pasos del brochure. Dos usuarios (Marcos, Joel). La web `marcosbarbosagroup.com` envía sus formularios a este CRM vía API.

Fuera de alcance (fases futuras): ERPNext, multitenancy para clientes, WhatsApp Business API.

## 2. Presupuesto de recursos (medido, no estimado)

Medido el 2026-09-03 00:55 UTC en el CX23:

| Consumidor | RAM real |
|---|---|
| Dokploy panel | 773 MB |
| Web Next.js (standalone) | 35 MB |
| Traefik | 26 MB |
| Dokploy Postgres | 21 MB |
| Sistema + buff/cache | ~450 MB |
| **Disponible para el CRM** | **~1.8 GB** (+ 4 GB swap de emergencia) |

Presupuesto Frappe CRM con tuning (§5): **~1.7 GB** real. Headroom ~100MB + swap. Viable para 2 usuarios; si el swap sostenido supera 500 MB o se suma ERPNext → resize CX33 (4 vCPU/8 GB, +€4/mes, sin perder datos).

## 3. Decisión de stack

**Frappe CRM v15** (app `crm` sobre Frappe Framework v15), imágenes oficiales prebuild — sin builds custom:

- Imagen de apps: `frappe/erpnext:v15` (contiene el framework; tener erpnext en la imagen NO lo instala en el site — las apps se instalan por-site con `--install-apps crm` solo)
- Infra: `mariadb:10.6`, `redis:6.2-alpine` (x2: cache y queue), nginx incluido en imagen `frappe/erpnext` (frontend target `configure.py` no necesario — usamos el compose oficial de `frappe_docker` como base)

Por qué v15 y no v16: la tabla de compatibilidad oficial de Frappe CRM (docs.frappe.io/crm) lista pares estables `CRM version-15 ↔ Frappe version-15`. v16 es reciente; migramos después si hace falta.

Por qué no otras: EspoCRM (UI rechazada), Twenty (AGPL + UI aprobada pero Frappe gana por plataforma: WhatsApp nativo, portal, y camino a ERPNext), BottleCRM (producto más joven).

## 4. Arquitectura de contenedores

```
Traefik (Dokploy) ──SSL──► crm.marcosbarbosagroup.com
   ├── /            → frontend (nginx :8080)
   └── /socket.io   → websocket (:9000)   [websocket upgrade]

compose (8 servicios, red interna `crm-net`):
├── backend      frappe/erpnext:v15  gunicorn 2 workers
├── websocket    frappe/erpnext:v15  node socketio :9000
├── worker       frappe/erpnext:v15  bench worker --queue short,default,long
├── scheduler    frappe/erpnext:v15  bench schedule
├── frontend     frappe/erpnext:v15  nginx serve -c nginx-entrypoint
├── configurator (one-shot: inyecta site_config a redis) [restart: no]
├── mariadb      mariadb:10.6  + volumen
├── redis-cache  redis:6.2-alpine  maxmemory 128mb allkeys-lru
└── redis-queue  redis:6.2-alpine  maxmemory 96mb
```

Volúmenes Docker nombrados (sobreviven redeploy): `mariadb-data`, `sites`, `logs`.

## 5. Tuning 4GB (valores exactos)

| Parámetro | Valor | Dónde |
|---|---|---|
| Gunicorn workers | 2 (timeout 120) | `GUNICORN_WORKERS=2` env backend |
| MariaDB innodb_buffer_pool | 512M | compose command `--innodb-buffer-pool-size=536870912` |
| MariaDB performance_schema | OFF | `--performance-schema=OFF` (ahorra ~100MB, safe en prod chica) |
| Redis cache maxmemory | 128mb allkeys-lru | command redis-cache |
| Redis queue maxmemory | 96mb | command redis-queue |
| Memory limits Docker (red de seguridad anti-cascada OOM) | mariadb 1g · backend 512m · worker 400m · scheduler 400m · websocket 192m · frontend 64m · redis x2 160m | `deploy.resources.limits` / `mem_limit` |

Prohibido tocar (rompería): <2 gunicorn workers, eliminar redis-queue, mariadb <512M buffer, SQLite.

## 6. Deploy

1. Repo GitHub `gonzalojoel1-sudo/crm-marcosbarbosagroup` con `compose.yaml` + `.env.example` + `docs/`
2. Dokploy → proyecto `Grupo Marcos Barbosa` → servicio **Compose** apuntando al repo → deploy
3. **Site creation one-shot** (servicio temporal o ejec SSH): `bench new-site crm.marcosbarbosagroup.com --mariadb-root-password … --install-app crm --admin-password …`
4. Env secrets (Dokploy, nunca en git): `DB_PASSWORD`, `ADMIN_PASSWORD`, `SECRET_KEY`
5. Traefik labels (o Dokploy domain UI): dominio + router websocket `/socket.io`
6. Healthcheck: backend `curl -f http://localhost:8000/api/method/ping` (o `/api/method/frappe.ping`); frontend wget `/api/method/ping`

Rollback: el compose es declarativo; `git revert` + redeploy. Datos en volúmenes — intactos.

## 7. Seguridad

- Hetzner Backups ON (acción del usuario en consola Hetzner, +€1.30/mes) — **precondición del deploy**
- Backups Frappe: scheduler `bench backup` diario (7 días retención en volumen `sites`) — fase 2: push a S3/B2 con rclone
- `common_site_config.json`: `maintenance_mode: 0`, `skip_email_otp` N/A, disable `frappe.conf` debug
- Firewall Hetzner: solo 22/80/443 (acción manual en consola, spec nota)
- Admin password fuerte generado; usuarios secundarios con 2FA opcional
- API para la web: **API Key/Secret por usuario dedicado** (`api user "web-form"` con rol mínimo), nunca admin

## 8. Integración web → CRM

Hoy `webmarcosbarbosagroup/app/api/lead/route.ts` postea a `${NEXT_PUBLIC_CRM_URL}/api/v1/Lead` (formato EspoCRM). Adaptación post-deploy:

- Endpoint Frappe: `POST https://crm.marcosbarbosagroup.com/api/resource/CRM Lead`
- Headers: `Authorization: token <API_KEY>:<API_SECRET>` (usuario `web-form` dedicado, rol CRM User solo-create)
- Body mapping: `{first_name, last_name, email, mobile_no, custom_plan_interes, notes, source: "Website"}`
- Fallback local `data/leads.jsonl` se mantiene
- Env web: `NEXT_PUBLIC_CRM_URL=https://crm.marcosbarbosagroup.com` + `CRM_API_KEY`/`CRM_API_SECRET`

## 9. Configuración funcional del CRM

- **Tenant único:** "Grupo Marcos Barbosa"
- **Usuarios:** Administrator (Marcos, admin-password) + `joel@…` (rol System Manager)
- **Deal pipeline** = metodología brochure: Qualification → Diagnóstico → Análisis → Estrategia → Implementación → Seguimiento → Escalamiento → Won/Lost (CRM Deal Status custom)
- **Lead sources:** Website, WhatsApp, Referido, Conferencia, LinkedIn
- Campos custom fase 2: `Plan de interés` (select Plan 1-4), `Facturación anual estimada`
- Idioma/español, timezone `America/Argentina/Cordoba`, moneda ARS + USD

## 10. Riesgos y mitigaciones

| Riesgo | Prob | Mitigación |
|---|---|---|
| Lentitud en picos | Alta | Aceptado; resize CX33 cuando moleste |
| OOM en pico extremo | Baja | Memory limits por contenedor (muere el designado, no cascada) |
| Migración de versión fallida | Media al actualizar | Solo de noche, backup previo, site staging para probar (fase 2) |
| Pérdida de BD | Muy baja | Hetzner Backups + `bench backup` diario en volumen |
| Dokploy afectado | Muy baja | Limits evitan cascada; Dokploy en su propio stack |

Criterio de éxito fase 1: sitio accesible con SSL en `crm.marcosbarbosagroup.com`, login de 2 usuarios, pipeline visible, un lead de prueba creado desde la API de la web.

## 11. Fases

- **F1 (este plan):** compose + deploy + site + usuarios + pipeline + SSL
- **F2:** integración `/api/lead` de la web + campos custom + backups offsite
- **F3 (futuro):** WhatsApp Business, staging site, ERPNext (con resize CX33), multitenant para clientes
