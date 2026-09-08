# CRM Dashboard "Próximas reuniones" — Sesión 2026-09-07

## Estado: deployed y persistente

Imagen custom **`crm-mb:17`** corriendo en producción. Dashboard widget "Próximas reuniones" funciona y sobrevive restart del container.

## Stack

- Servidor: Hetzner CX23 (`2.28.121.92`), 3.73GB RAM, swarm mode
- Imagen: `crm-mb:17` (built local en Mac, push vía `docker save`/`docker load`)
- Compose usa `crm-mb:17` en 6 services (backend/frontend/websocket/worker/scheduler/configurator)
- MariaDB y Redis: imágenes vanilla (`mariadb:10.6`, `redis:6.2-alpine`)

## Cambios persistentes

| Componente | Detalle |
|---|---|
| `crm/api/dashboard.py` | `get_upcoming_events()` (línea ~1207) + `_format_meeting()` helper. Admin/System Manager ve TODO, sales users solo lo suyo. |
| `crm/frontend/src/components/Dashboard/DashboardItem.vue` | `v-else-if="item.type == 'event_list'"` con render inline |
| `tabCRM Dashboard.layout` | Entry `upcoming_events` (y=3, w=20, h=4) al **top**, full-width |
| `compose.yaml` | `image: crm-mb:15` → `crm-mb:17` (6 líneas) |

## Rebuild recipe (referencia)

Si hay que rebuild `crm-mb:18+` (ej: agregar otra feature):

1. **Mac**: aplicar cambios en `/tmp/crm-build/frontend/src/...`
2. **Mac**: `yarn install --ignore-engines` (4 min) + `yarn build` (31s) → genera `/tmp/crm-build/frontend/dist/`
3. **Mac**: append function a `/tmp/crm-build/patches/dashboard_full.py` + `cp -r dist/ /tmp/crm-build/dist/`
4. **Mac**: en `/tmp/crm-build/Containerfile` cambiar tag a `crm-mb:18`
5. **Mac**: `docker buildx build --platform linux/amd64 -f Containerfile -t crm-mb:18 --load .`
6. **Mac**: `docker save crm-mb:18 -o /tmp/crm-mb-18.tar && rsync -avzP /tmp/crm-mb-18.tar root@2.28.121.92:/tmp/`
7. **VPS**: `docker load -i /tmp/crm-mb-18.tar`
8. **VPS**: `sed -i 's/crm-mb:17/crm-mb:18/g' compose.yaml && docker stack deploy -c compose.yaml crm`

## Cosas pendientes / para discutir

- **Dashboard link oculto en mobile** (`condition: () => !props.mobile` en `AppSidebar.vue:258`). Si querés que se vea también en mobile, hay que cambiar línea y rebuild (5 min).
- **Google Calendar sync**: cuando se quiera, hay que configurar Frappe's built-in `tabGoogle Calendar` (el cron script `sync-gcal-crm.py` solo pull, no push).
- **Tamaño de backups**: el asset tarball de macOS se transfiere lento vía SSH (~30-60 min para 3GB). Mejor gzip antes.
- **CX33 upgrade**: si se hace otro build pesado, parar otros servicios o upgrade memoria. CX23 con 3.73GB es justo.

## Personas y contexto

- **Joel** (`joel@marcosbarbosagroup.com`, `gonzalojoel1@gmail.com`) — admin/supervisor, ve todo el system
- **Marcos** (`marcos@marcosbarbosagroup.com`) — sales lead, asignado a Fernando Bustos y Jonatan lead
- Roles clave: Administrator, System Manager (joel), Sales Manager + Sales User (marcos)

## Datos CRM relevantes creados en esta sesión

| Lead | Status | Notas |
|---|---|---|
| Fernando Bustos `CRM-LEAD-2026-00005` | Converted | Custom field `custom_descripcion` con texto completo. 6 tareas creadas (ver abajo). |
| Jonatan `CRM-LEAD-2026-00006` | New | Rosario/Santa Fe/Argentina, source `Referido`, due_date 10/9 15:00 con Marcos |

### Custom Fields en CRM Lead
- `custom_descripcion` (Text, después de `notes`) — descripción larga del lead

### Tareas (CRM Task) creadas en lead Fernando Bustos

| ID | Título | Pri | Asignados | Status | due_date |
|---|---|---|---|---|---|
| 2 | Presupuesto de constitucionalidad | Medium | Marcos + Joel | Todo | 4/9 (backdated) |
| 3 | Contrato de eventualidad por empleado | High | Marcos + Joel | Todo | 4/9 |
| 4 | Armar "Paragua Legal" para eventualidades | High | Marcos solo | Todo | 4/9 |
| 5 | Armar Estructura de Costos | Medium | Marcos + Joel | Todo | 4/9 |
| 6 | Preparar Minutas | High | Joel solo | **Done** | 4/9 |
| 7 | Establecer Contrato | High | Marcos + Joel | Todo | **8/9 18:00** |

### Tarea en lead Jonatan

| ID | Título | Pri | Asignado | due_date |
|---|---|---|---|---|
| 9 | Reunión con Jonatan | Medium | Marcos | **10/9 15:00** |

## URL para verificar

- `https://crm.marcosbarbosagroup.com/crm/dashboard` — widget "Próximas reuniones" arriba del todo
- `https://crm.marcosbarbosagroup.com/crm/leads/CRM-LEAD-2026-00005?viewType=list#tasks` — tareas de Fernando
- `https://crm.marcosbarbosagroup.com/crm/leads/CRM-LEAD-2026-00006?viewType=list#tasks` — tareas de Jonatan

## Credenciales (NO compartir en chat)

- DB password y admin password en `/opt/crm-marcosbarbosagroup/.env` (chmod 600)
- API key/secret en `/etc/crm-gcal-sync/config.json`
- SSH en VPS via `id_ed25519` (Mac)
