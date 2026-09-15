# Runbook — crm_core (custom app Frappe v15)

Estado: **instalada y funcionando en producción** (`crm.marcosbarbosagroup.com`)
Fecha: 2026-09-15

## Qué es

`crm_core` es la app custom (módulo `MbCRM`) que agrega los DocTypes base
del CRM nuevo sobre Frappe Framework v15. Licencia propietaria (Marcos
Barbosa Group).

DocTypes (13): Task, Event, Event Attendee, Contact, Contact Email,
Contact Phone, Account, Lead, Deal, Activity, GCal Connection,
GCal Sync State, Sync Conflict.

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

Imagen: `crm-mb:19` (base `crm-mb:18` + `apps/crm_core` baked +
`.pth` + smoke test de import en build).

```bash
# Build (en el VPS, desde el repo)
docker build --no-cache -f docker/Dockerfile.crm-mb -t crm-mb:19 .

# Rolling update de los 6 servicios Swarm
for svc in crm_backend crm_configurator crm_frontend crm_scheduler crm_websocket crm_worker; do
  docker service update --image crm-mb:19 "$svc"
done
```

El build **falla a propósito** si `import crm_core` no funciona: nunca se
publica una imagen rota.

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
