# Deploy Log — CRM Grupo Marcos Barbosa

## 2026-09-04 — Stack LIVE ✅

**Estado final:** `https://crm.marcosbarbosagroup.com/api/method/ping` → `{"message":"pong"}` con SSL (Let's Encrypt vía Traefik de Dokploy).

### Resultado
- 9 servicios 1/1 healthy (backend, frontend, websocket, worker, scheduler, mariadb, redis×2, configurator completado)
- RAM CRM real: **~585 MB total** (backend 286M, mariadb 135M, scheduler 92M, worker 44M, websocket 17M, resto <10M) — muy por debajo del presupuesto 1.75GB
- RAM VPS: 2.2Gi usados / 1.6Gi disponible — sin presión
- Imagen: `crm-mb:15` (2.94GB) construida en el VPS con `frappe_docker/images/custom/Containerfile` (secret apps_json: solo crm main; frappe branch version-15; Python 3.11, Node 20)
- Frappe version: **15.120.0** (verificado `bench version`)
- Site: `crm.marcosbarbosagroup.com` (creado; app crm instalada después del cambio de imagen)
- Routing: `/etc/dokploy/traefik/dynamic/crm.yml` (patrón file-provider de Dokploy, routers web+websecure+websocket `/socket.io`, certresolver letsencrypt)
- Secrets: en `/opt/crm-marcosbarbosagroup/.env` (chmod 600, gitignored)

### Problemas encontrados y fixes (orden cronológico)
1. `docker stack deploy --env-file` no existe → `set -a; . ./.env; set +a`
2. Interpolación Swarm: `$((` → `$$((` en configurator
3. `depends_on` con condition no soportado en Swarm → eliminado (workers reintentan)
4. `bench serve --proxy-ssl-headers` no existe en esta imagen → comando gunicorn oficial de frappe_docker
5. `node socketio.js` cwd wrong → path completo `/home/frappe/frappe-bench/apps/frappe/socketio.js`
6. Env frontend: nombres de servicio Swarm `crm_backend`/`crm_websocket` (no `backend`/`websocket`)
7. **S1 del audit era incompleto:** `ghcr.io/frappe/crm:stable` NO trae la app crm en el bench (solo frappe) → imagen custom `crm-mb:15` via build oficial frappe_docker
8. apps.txt del volumen sites era del primer intento (solo frappe) → reescrito `frappe\ncrm`
9. `echo crm >>` pegó sin newline → `frappecrm` → reescrito con printf
10. Frontend/websocket sin attach a `dokploy-network` → 502 Traefik → fix en compose

### Desviaciones del plan (rulings)
- Deploy vía `docker stack deploy` SSH (no UI Dokploy) — routing por file-provider dinámico, patrón replicado de Dokploy
- Imagen custom build en VPS (no prebuild) — resuelve S1 real
- La precondición Hetzner Backups sigue pendiente de activar por el usuario en consola

### Comandos de acceso
- Login CRM: `https://crm.marcosbarbosagroup.com` → Administrator / password en `.env` (ADMIN_PASSWORD)
- SSH VPS: `ssh root@2.28.121.92` · Stack dir: `/opt/crm-marcosbarbosagroup`
- Logs: `docker service logs crm_backend --since 10m`
