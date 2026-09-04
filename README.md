# CRM Grupo Marcos Barbosa

Deploy de [Frappe CRM](https://github.com/frappe/crm) via Docker Compose, tuneado para un VPS Hetzner CX23 (4GB RAM).

## Objetivo

Levantar Frappe CRM en producción con presupuesto de memoria estricto (límites por contenedor como red de seguridad anti-OOM) y toques de tuning en MariaDB, Redis y Gunicorn. Ver `docs/spec.md` para la spec completa y las Global Constraints.

## Estructura

- `compose.yaml` — 8 servicios: backend, websocket, worker, scheduler, frontend, configurator, mariadb, redis-cache, redis-queue (ver spec §arquitectura)
- `.env.example` — variables requeridas (`DB_PASSWORD`, `ADMIN_PASSWORD`)

## Deploy (Task 2)

Se deploya en Dokploy (Docker Swarm, red `overlay`):

1. Crear proyecto en Dokploy apuntando a este repo
2. Cargar las variables de `.env.example` (con valores reales) en Dokploy > Environment
3. Deployar `compose.yaml` — Dokploy resuelve `ports: 8080` del frontend y el dominio
4. Configurar dominio `crm.marcosbarbosagroup.com` + SSL (Let's Encrypt) en Dokploy

## Crear el sitio (Task 3)

Una vez deployado:

```bash
ssh root@<vps> "docker exec -it \$(docker ps -qf name=backend) bench new-site crm.marcosbarbosagroup.com --db-root-password \$DB_PASSWORD --admin-password \$ADMIN_PASSWORD --install-app crm --mariadb-user-host-login-scope='%'"
```

Ver `docs/superpowers/plans/2026-09-03-crm-frappe-deploy.md` (Tasks 2-3) para el detalle completo.
