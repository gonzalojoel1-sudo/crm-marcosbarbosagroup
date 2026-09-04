# Runbook — CRM Grupo Marcos Barbosa

**Stack:** Docker Swarm `crm` (9 servicios) · imagen `crm-mb:15` · VPS Hetzner CX23 · `crm.marcosbarbosagroup.com`

## Comandos esenciales (SSH root@2.28.121.92)

```bash
# Estado del stack
docker stack services crm
docker stack ps crm
docker stats --no-stream | grep crm

# Logs
docker service logs crm_backend --since 10m
docker service logs crm_worker --since 10m

# RAM global
free -h
```

## Redeploy (tras cambios en compose.yaml del repo)
```bash
cd /opt/crm-marcosbarbosagroup && git pull
set -a && . ./.env && set +a
docker stack deploy -c compose.yaml crm
```

## Backup de la BD
```bash
# Manual (con archivos)
docker exec $(docker ps -qf name=crm_backend) bench --site crm.marcosbarbosagroup.com backup --with-files
# Output: sites/crm.marcosbarbosagroup.com/private/backups/  (volumen sites)
```
Automático: Frappe scheduler hace backup diario (retención 3). **Hetzner Backups:** activar en consola Hetzner → server → Backups → Enable (+€1.30/mes) — captura TODO el disco incl. volúmenes.

## Restaurar
### Desde Hetzner Backup
Consola Hetzner → Snapshots → restaurar a un server nuevo (o rebuild). Los volúmenes swarm se recrean vacíos → restaurar de bench backup:
### Desde bench backup
```bash
docker exec -it $(docker ps -qf name=crm_backend) bash
cd sites/crm.marcosbarbosagroup.com/private/backups
bench --site crm.marcosbarbosagroup.com restore <archivo-sql.gz> --with-private-files <tar-private> --with-files <tar-files>
```

## Actualizar versión (CRM/Framework)
1. NO hacerlo directo en prod. Orden:
   - Backup manual completo
   - Editar apps.json del build (`/tmp/apps.json` → versiones nuevas) y rebuildear imagen:
     ```bash
     cd /opt/frappe_docker
     export APPS_JSON_BASE64=$(base64 -w 0 /tmp/apps.json)
     docker build --secret id=apps_json,src=/tmp/apps.json \
       --build-arg PYTHON_VERSION=3.11 --build-arg NODE_VERSION=20 \
       --build-arg FRAPPE_BRANCH=version-15 --tag=crm-mb:16 \
       -f images/custom/Containerfile .
     ```
   - Cambiar tag en compose.yaml → `docker stack deploy`
   - `bench --site crm.marcosbarbosagroup.com migrate`
2. Hacerlo de noche. Si el migrate falla por RAM → CX33 primero (2 min, datos intactos).

## Resize a CX33 (cuando: swap >500MB sostenido, ERPNext, 3er usuario activo)
1. Consola Hetzner → server → apagar (Power → Shutdown)
2. Rescale → CX33 (4 vCPU/8GB) → encender. IP y datos intactos.
3. Swap crece solo tras boot; verificar `free -h`.

## Diagnóstico rápido
| Síntoma | Check | Fix |
|---|---|---|
| 502 en crm.marcosbarbosagroup.com | `docker service logs crm_frontend` | verificar file `/etc/dokploy/traefik/dynamic/crm.yml` + attach a dokploy-network |
| Lento general | `free -h` (swap usado) | cerrar pico; resize si persiste |
| Leads no llegan de la web | `docker service logs crm_backend` + fallback `proyectos/webmarcosbarbosagroup/data/leads.jsonl` | revisar env CRM_API_KEY/SECRET en Dokploy web |
| Workers muertos | `docker stack ps crm` | `docker service update --force crm_worker` |

## Contactos / rutas clave
- Repo: github.com/gonzalojoel1-sudo/crm-marcosbarbosagroup (compose.yaml fuente de verdad)
- Traefik dinámico: `/etc/dokploy/traefik/dynamic/crm.yml` (patrón Dokploy)
- Secrets: `/opt/crm-marcosbarbosagroup/.env` (DB_PASSWORD, ADMIN_PASSWORD)
- Config funcional: `docs/crm-config.md`
