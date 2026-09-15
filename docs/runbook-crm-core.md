# Runbook — crm_core (custom app Frappe v15)

Estado: **instalada y funcionando en producción** (`crm.marcosbarbosagroup.com`)
Imagen actual: `crm-mb:21` (incluye la página `/hoy`)
Fecha: 2026-09-15

## Qué es

`crm_core` es la app custom (módulo `MbCRM`) que agrega los DocTypes base
del CRM nuevo sobre Frappe Framework v15. Licencia propietaria (Marcos
Barbosa Group).

DocTypes (13): Task, Event, Event Attendee, Contact, Contact Email,
Contact Phone, Account, Lead, Deal, Activity, GCal Connection,
GCal Sync State, Sync Conflict.

## Página "Hoy" / "Agenda" — app React (Nivel 1)

Ruta: `crm.marcosbarbosagroup.com/hoy` (requiere login). La app tiene dos vistas:
**Agenda** (por defecto) y **Hoy**.

- **Agenda**: calendario semanal (y vista Día) con grid de horas, eventos como
  bloques posicionados por hora, tareas marcadas en su hora, línea de hora
  actual, navegación (‹ ›, Hoy), toggle Día/Semana, y **click en un hueco para
  crear un evento**.
- **Hoy**: lista de tareas vencidas + de hoy (incluidas las sin fecha) + eventos.
  Alta rápida (escribir + Enter), completar con click, atajo `N`.

### Fuente y build

```
apps/web/                     # la app React (Vite + React + TS)
  src/{App.tsx,Agenda.tsx,Hoy.tsx,api.ts,main.tsx,styles.css}
  gen-shell.mjs               # genera el template de Frappe embebiendo el bundle
apps/crm_core/crm_core/
  www/hoy.html                # TEMPLATE GENERADO (no editar a mano)
  www/hoy.py                  # gate de login + inyecta CSRF
  api.py                      # get_hoy / get_agenda / quick_add_task /
                              # complete_task / create_event
```

Build: `cd apps/web && npm run build` → Vite + `gen-shell.mjs` → `www/hoy.html`.

### DocTypes que usa (datos REALES del app `crm`)

La agenda/Hoy leen y escriben los DocTypes que el CRM ya venía usando:
- **Reuniones/reservas** → `CRM Lead.custom_meeting_datetime`. Las carga el cron
  de Google Calendar (ver abajo). En la agenda se muestran como bloques; el
  título sale de `notes` ("Reunión agendada: <título real>").
- **Tareas** → `CRM Task` (`title`, `status`, `priority`, `due_date`).
  `Todo/In Progress = pendiente`, `Done = hecha`. Sin `due_date` = inbox del día.

> ⚠️ Las DocTypes propias `Task`/`Event` de `crm_core` quedaron **sin uso** (el
> CRM real vive en el app `crm`). No borrarlas sin migrar antes.
> ⚠️ **NO** crear un DocType llamado `Event`: choca con el de Frappe y lo
> sobrescribe. Recuperación: `scripts/restore_frappe_event.py`.

### Integraciones que YA funcionan (reutilizadas)

- **Google Calendar → CRM (cron cada 1 min, en el HOST, no en Docker):**
  - Script: `/opt/crm-marcosbarbosagroup/scripts/sync/sync-gcal-crm.py`
  - Config: `/etc/crm-gcal-sync/config.json` (client_id/secret + refresh_token
    de `Agenda.personal.mb@gmail.com`, `crm_url`, `api_key`/`api_secret`)
  - Cron: `* * * * * /usr/bin/python3 .../sync-gcal-crm.py >> /var/log/crm-gcal-sync.log`
  - Por cada evento con invitados crea un `CRM Lead` con `custom_meeting_datetime`
    y `custom_event_id` (dedupe). Eso es lo que alimenta la agenda.
  - Estado/log: `/var/log/crm-gcal-sync.log`
- **Web → CRM:** la web postea a `POST /api/resource/CRM Lead` con token del
  usuario `web-form@marcosbarbosagroup.com`.
- **Backups → Google Drive:** cron 03:30 y 15:30 UTC
  (`scripts/backup/backup-gdrive.sh`, rclone).

Referencia: `docs/crm-config.md` y `docs/runbook.md` (docs previos).


### E2E con navegador (Playwright)

```bash
# crear key temporal en el server (tmp_admin_key.py MODE=create), luego:
KEY=... SEC=... node scripts/e2e_agenda.mjs   # screenshot -> agenda.png
KEY=... SEC=... node scripts/e2e_hoy.mjs      # screenshot -> hoy.png
# y SIEMPRE borrar la key (MODE=remove)
```


### Por qué el bundle va embebido en base64 (leer antes de tocar)

1. Los contenedores `crm_backend` y `crm_frontend` **no comparten `sites/assets`**
   de forma confiable (verificado con un archivo marcador), así que `/assets/...`
   no sirve para los assets del frontend.
2. Frappe **rechaza cualquier template que contenga `.__`** (`Illegal template`).
   El bundle minificado de React lo tiene. Base64 no tiene `.` → pasa.
3. `window.CSRF` (no `__CSRF__`) por el mismo motivo.

El shell hace: `atob` → `Uint8Array` (¡clave para UTF-8!) → `Blob` → `import()`.
**Ojo:** usar `Uint8Array`; si se usa el string de `atob` directo, los acentos
se rompen (día → dÃa).

### Tests

```bash
# contra el site de prueba crm-test, NUNCA prod:
FRAPPE_SITE=crm-test ./env/bin/python apps/crm_core/tests/test_hoy_api.py
```

### Gotchas

- **404 fantasma:** si `/hoy` da 404 aunque el archivo exista, limpiar la cache:
  `frappe.cache.delete_value("website_404")`.
- **Cambios requieren reinicio:** `www/`, `api.py` y `hooks.py` se cachean en los
  procesos gunicorn. Los cambios van **horneados en la imagen** (`crm-mb:N` +
  rolling update), no por `docker cp` (se pierde al recrear el contenedor).
- **Verificación E2E:** `KEY=... SEC=... node scripts/e2e_hoy.mjs` (usa Playwright,
  renderiza en navegador real y saca screenshot). `scripts/tmp_admin_key.py`
  crea/borra una API key de Administrator para el test (¡borrarla después!).


## Estructura (idéntica al app `crm` de Frappe)

```
apps/crm_core/
  pyproject.toml            # [build-system] flit_core (patrón Frappe)
  tests/
  crm_core/                 # el paquete Python
    __init__.py
    hooks.py
    modules.txt             # "MbCRM"
    config/desktop.py
    mbcrm/                  # submódulo = nombre del módulo
      __init__.py
      doctype/<X>/<X>.json  # definición
      doctype/<X>/<X>.py    # controller class PascalCase(Document)
```

Referencia canónica: `apps/crm/crm/fcrm/doctype/`.

## Cómo se registra en el bench (clave del asunto)

Frappe detecta apps mediante un `.pth` en el **venv del bench**, no del
Python del sistema:

```
/home/frappe/frappe-bench/env/lib/python3.11/site-packages/crm_core.pth
  → contenido: /home/frappe/frappe-bench/apps/crm_core
```

Mismo mecanismo que ya usan `frappe.pth` y `crm.pth`. **El `.pth` contiene
el directorio PADRE del app** (no el paquete interno).

## Deploy

La imagen `crm-mb:N` = base del bench + `apps/crm_core` baked (plantilla del
presupuesto, fuente, `www/`, `.pth`) + smoke test de import en build.

**Usar el script, no `docker build` a mano:**

```bash
ssh root@2.28.121.92
cd /opt/crm-marcosbarbosagroup
bash scripts/deploy-crm.sh 56        # construye y despliega crm-mb:56
```

El script parte de la imagen **que está corriendo**, construye, actualiza los 5
servicios, espera, verifica `1/1` + HTTP y **revierte** si algo falla.

### ⚠️ No volver a una base fija (`FROM crm-mb:19`)

El Dockerfile usa `ARG BASE`, y por defecto la imagen viva. Antes decía
`FROM crm-mb:19` y pasó esto:

1. **Dokploy poda las imágenes sin usar** → se llevó `crm-mb:19` y todas las
   intermedias (quedaron solo las 7 en uso).
2. El build murió, pero `docker build … | tail -2` **enmascaró el exit code**,
   así que el `for` que sigue se ejecutó igual.
3. Los 5 servicios quedaron apuntando a `crm-mb:55` (inexistente) → **caída 502**.

Lecciones, todas aplicadas en `scripts/deploy-crm.sh`: la base debe ser una
imagen referenciada por un contenedor vivo; nunca encadenar `docker build | tail`
sin propagar el error; verificar siempre después de desplegar y saber volver.

## Presupuesto en PDF

`crm_core.api.quote_pdf(name, iva_mode)` → HTML (Jinja) → **Chromium
headless** → PDF A4 descargable (`frappe.local.response.type = "download"`).

- Plantilla: `apps/crm_core/crm_core/templates/quote.html` (autocontenida).
- Fuente: `templates/fonts/outfit-latin.woff2` embebida en base64 — el
  contenedor solo tiene DejaVu, y la marca va en Outfit. Se usa Chromium y no
  `wkhtmltopdf` (existe en la imagen, pero no soporta grid/flex/SVG como
  Chromium; la fidelidad de la hoja depende de eso).
- `iva_mode`: `sumar` (21% sobre el subtotal) · `incluido` (precios con IVA y se
  muestra el IVA contenido) · `exento`.
- El `deal_value` del negocio es el **subtotal sin IVA**; el PDF agrega la línea.
- Datos de la empresa en `COMPANY` (api.py). **Pendiente: CUIT y dirección reales
  (hoy van como `—`).**

### Iterar la maqueta sin desplegar

```bash
python3 scripts/quote-preview.py     # plantilla + datos de ejemplo
node scripts/quote-shot.mjs          # mide páginas, genera PNG y PDF
```

`quote-shot.mjs` compara la altura real contra la caja imprimible (180×272 mm)
y avisa si la hoja se va a 2 páginas. Ojo: el viewport debe medir la **caja
imprimible** (680px), no A4 completo, o la medición miente.

## Instalar en un site

```bash
bench --site <site> install-app crm_core
bench --site <site> migrate
```

Nota: al migrar puede aparecer `Module FCRM not found` (warning del app
`crm` oficial, no de crm_core). No afecta la instalación de crm_core.

Si algún DocType no se registra tras el migrate, forzarlo:
```bash
bench --site <site> reload-doc MbCRM doctype <snake_case_name>
```

## ⚠️ IMPORTANTE — `sites/apps.txt` es global del bench

`sites/apps.txt` lista TODAS las apps del bench (no es por site). Debe
contener **siempre** las apps base, en orden de dependencia:

```
frappe
crm
crm_core
```

**Si se pierde `crm` de `apps.txt`**: el CRM oficial (`/crm`) devuelve
`500 TemplateNotFound: www/crm.html`, aunque los archivos y la DB estén
bien. Causa: el app no queda registrado y su carpeta `www/` sale del
loader de templates.

**Nunca sobreescribir `apps.txt` completo** — usar `echo <app> >> apps.txt`
para agregar. Para repararlo:

```bash
BE=$(docker ps -qf name=crm_backend.1)
docker exec "$BE" bash -c 'printf "frappe\ncrm\ncrm_core\n" > /home/frappe/frappe-bench/sites/apps.txt'
docker exec "$BE" bash -c 'cd /home/frappe/frappe-bench && bench --site <site> clear-cache'
for svc in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  docker service update --force "$svc"
done
```

El `clear-cache` es imprescindible: los hooks de apps quedan cacheados en
Redis y no se refrescan solo al reiniciar el contenedor.

## Rollback

```bash
# Tag de la imagen previa (mismo SHA que :18)
docker tag crm-mb:18-pre-crm-core crm-mb:rollback
# Reapuntar servicios
for svc in crm_backend crm_configurator crm_frontend crm_scheduler crm_websocket crm_worker; do
  docker service update --image crm-mb:18-pre-crm-core "$svc"
done
# Desinstalar del site si hace falta
bench --site <site> uninstall-app crm_core
```

Backups del prod previos a la instalación:
`crm.marcosbarbosagroup.com/private/backups/20260915_111243-*`

## Repos

- App pública (para `bench get-app`): https://github.com/gonzalojoel1-sudo/crm-core-app (tag v0.0.2)
- Monorepo cliente: apps/crm_core dentro de crm-marcosbarbosagroup

## Pendiente (fases siguientes)

- UI React (agenda Hoy, palette) — Fase 1
- Sync Google Calendar 2-way — Fase 6
- Bridge Cal.com — Fase 7
- PWA + deploy web — Fase 8
