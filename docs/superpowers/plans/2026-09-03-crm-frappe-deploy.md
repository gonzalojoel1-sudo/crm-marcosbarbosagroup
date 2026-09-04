# CRM Marcos Barbosa Group — Implementation Plan (Frappe CRM Deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Frappe CRM (imagen oficial `ghcr.io/frappe/crm:stable`) tuneado para 4GB en Dokploy, sitio `crm.marcosbarbosagroup.com` con SSL, 2 usuarios y pipeline del brochure.

**Architecture:** 8 contenedores (backend gunicorn×2, websocket, worker, scheduler, frontend nginx, configurator, mariadb 10.6, redis×2) detrás de Traefik de Dokploy. Volúmenes nombrados persistentes. Memory limits por contenedor como red anti-OOM. Compose declarativo versionado en git.

**Tech Stack:** Frappe CRM main (v1.x) / Frappe Framework v15, MariaDB 10.6, Redis 6.2, Docker Compose, Dokploy, Traefik

**Spec:** `proyectos/crm-marcosbarbosagroup/docs/spec.md` · **Audit:** `docs/audit-2026-09-03.md`

## Global Constraints

- Imagen apps: `ghcr.io/frappe/crm:stable` (trae frappe + crm prebuilt). Pin por digest al primer pull. Prohibido `bench get-app` runtime (no sobrevive recreaciones)
- RAM: 3.7Gi total, ~1.8Gi disponible. Memory limits EXACTOS: mariadb 1g · backend 512m · worker 400m · scheduler 400m · websocket 192m · frontend 64m · redis 160m c/u
- Tuning: `GUNICORN_WORKERS=2`, mariadb `--innodb-buffer-pool-size=536870912`, redis-cache `128mb allkeys-lru`, redis-queue `96mb` (noeviction default)
- Flag site creation: `--install-app` (singular, repetible) — NUNCA `--install-apps`
- Dominio del site = `crm.marcosbarbosagroup.com` (= nombre del site en frappe)
- Secrets SOLO en env Dokploy / `.env` (gitignored): `DB_PASSWORD`, `ADMIN_PASSWORD`, `API_KEY/SECRET` — nunca en git
- SSH VPS: `ssh root@2.28.121.92` · Web local: `proyectos/webmarcosbarbosagroup`
- Precondición deploy: Hetzner Backups ON (usuario lo confirma)

---

### Task 1: Compose + env + preparación repo

**Files:**
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: `compose.yaml` deployable; nombres de servicios y env vars que Tasks 2-4 consumen: `DB_PASSWORD`, `ADMIN_PASSWORD`, site `crm.marcosbarbosagroup.com`

- [ ] **Step 1: Crear compose.yaml** basado en frappe_docker compose.yaml oficial, SIN pwd.yml extras, con tuning. Contenido completo:

```yaml
# CRM Grupo Marcos Barbosa - Frappe CRM tuneado CX23 (4GB)
# Basado en frappe_docker compose.yaml - spec docs/spec.md
x-depends-on-configurator: &depends_on_configurator
  depends_on:
    configurator:
      condition: service_completed_successfully

services:
  backend:
    image: ghcr.io/frappe/crm:stable
    restart: unless-stopped
    command: >-
      bench serve --port 8000 --proxy-ssl-headers
    environment:
      - GUNICORN_WORKERS=2
      - GUNICORN_TIMEOUT=120
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
    mem_limit: 512m
    networks:
      - crm-net

  websocket:
    image: ghcr.io/frappe/crm:stable
    restart: unless-stopped
    command: node socketio.js
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
    mem_limit: 192m
    networks:
      - crm-net

  worker:
    image: ghcr.io/frappe/crm:stable
    restart: unless-stopped
    command: bench worker --queue short,default,long
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
    mem_limit: 400m
    networks:
      - crm-net
    <<: *depends_on_configurator

  scheduler:
    image: ghcr.io/frappe/crm:stable
    restart: unless-stopped
    command: bench schedule
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
    mem_limit: 400m
    networks:
      - crm-net
    <<: *depends_on_configurator

  frontend:
    image: ghcr.io/frappe/crm:stable
    restart: unless-stopped
    command: nginx-entrypoint.sh
    environment:
      - BACKEND=backend:8000
      - FRAPPE_SITE_NAME_HEADER=crm.marcosbarbosagroup.com
      - SOCKETIO=websocket:9000
      - UPSTREAM_REAL_IP_HEADER=X-Forwarded-For
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
    mem_limit: 64m
    networks:
      - crm-net
    ports:
      - "8080"

  configurator:
    image: ghcr.io/frappe/crm:stable
    restart: "no"
    entrypoint: >
      bash -c
      "wait-for-it -t 120 redis-cache:6379;
       wait-for-it -t 120 redis-queue:6379;
       wait-for-it -t 120 mariadb:3306;
       export start=`date +%s`;
       until [[ -n `ls -1 /home/frappe/frappe-bench/sites/*/*.site 2>/dev/null | grep -vc common` ]] || [ $((`date +%s`-start)) -le 180 ];
       do sleep 5; done;
       bench set-config -g db_host $$DB_HOST;
       bench set-config -gp db_port $$DB_PORT;
       bench set-config -g redis_cache redis://redis-cache:6379;
       bench set-config -g redis_queue redis://redis-queue:6379;
       bench set-config -g redis_socketio redis://redis-queue:6379;
       bench set-config -gp socketio_port 9000;"
    environment:
      - DB_HOST=mariadb
      - DB_PORT=3306
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
    networks:
      - crm-net

  mariadb:
    image: mariadb:10.6
    restart: unless-stopped
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --skip-character-set-client-handshake
      - --skip-innodb-read-only-compressed
      - --innodb-buffer-pool-size=536870912
    environment:
      - MARIADB_ROOT_PASSWORD=${DB_PASSWORD}
    volumes:
      - mariadb-data:/var/lib/mysql
    mem_limit: 1g
    healthcheck:
      test: mysqladmin ping -h localhost -p$$MARIADB_ROOT_PASSWORD
      interval: 10s
      timeout: 5s
      retries: 10
    networks:
      - crm-net

  redis-cache:
    image: redis:6.2-alpine
    restart: unless-stopped
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru --appendonly no
    volumes:
      - redis-cache-data:/data
    mem_limit: 160m
    networks:
      - crm-net

  redis-queue:
    image: redis:6.2-alpine
    restart: unless-stopped
    command: redis-server --maxmemory 96mb --appendonly yes
    volumes:
      - redis-queue-data:/data
    mem_limit: 160m
    networks:
      - crm-net

volumes:
  sites:
  logs:
  mariadb-data:
  redis-cache-data:
  redis-queue-data:

networks:
  crm-net:
    driver: overlay
```

- [ ] **Step 2: Crear .env.example** (los valores reales van en env de Dokploy):
```
# Copiar a .env local o configurar en Dokploy > Environment
# Generar con: openssl rand -base64 32
DB_PASSWORD=changeme-strong
ADMIN_PASSWORD=changeme-strong
```

- [ ] **Step 3: Crear .gitignore + README.md**
```
# .gitignore
.env
*.log
```
README: objetivo, link al spec, cómo deployar (pasos Task 2), cómo crear site (Task 3).

- [ ] **Step 4: Validar sintaxis compose localmente** (sin deploy):
```bash
docker compose -f compose.yaml config --quiet && echo "COMPOSE VALID"
```
Expected: `COMPOSE VALID` (no output = sin errores). Si YAML error → corregir indentación de anchors.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: compose frappe crm tuneado 4GB (8 servicios + limits)"
```

---

### Task 2: Deploy en Dokploy + dominio + SSL

**Files:**
- Modify: ninguno en repo (operación en VPS/Dokploy UI)
- Create: `docs/deploy-log.md` (bitácora de lo ejecutado y verificaciones)

**Interfaces:**
- Consumes: `compose.yaml` de Task 1 en GitHub `gonzalojoel1-sudo/crm-marcosbarbosagroup`
- Produces: stack CRM corriendo (contenedores healthy), dominio `crm.marcosbarbosagroup.com` enrutado, sin site aún (eso es Task 3)

- [ ] **Step 1: Push a GitHub**
```bash
git remote add origin https://github.com/gonzalojoel1-sudo/crm-marcosbarbosagroup.git 2>/dev/null || git remote set-url origin https://github.com/gonzalojoel1-sudo/crm-marcosbarbosagroup.git
git push -u origin main
```

- [ ] **Step 2: Crear servicio Compose en Dokploy** (UI http://2.28.121.92:3000 → Grupo Marcos Barbosa/producción → Crear servicio → Compose → Git → repo/branch main). Environment (env de Dokploy): `DB_PASSWORD` y `ADMIN_PASSWORD` con valores fuertes (`openssl rand -base64 24`).

- [ ] **Step 3: Deploy + verificar contenedores** por SSH:
```bash
ssh root@2.28.121.92 "docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -i crm"
```
Expected: 8 contenedores up (configurator exited 0). Si un contenedor muere: `docker logs <name>` y documentar en deploy-log.

- [ ] **Step 4: Conectar dominio en Dokploy** (servicio Compose → Domain: `crm.marcosbarbosagroup.com`, service `frontend`, port 8080) + regla websocket path `/socket.io` → service `websocket` port 9000. SSL Let's Encrypt activado.

- [ ] **Step 5: Verificar HTTPS + HTTP interno:**
```bash
ssh root@2.28.121.92 "curl -s -o /dev/null -w '%{http_code}' http://frontend:8080/api/method/ping" # desde red docker si no, usar curl al dominio
curl -sI https://crm.marcosbarbosagroup.com | head -n 3
```
Expected: SSL válido (HTTP/2 200 o 302 a login). Anotar resultado real en deploy-log.

- [ ] **Step 6: Verificar RAM total** (no romper el presupuesto):
```bash
ssh root@2.28.121.92 "free -h && docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}'"
```
Expected: CRM total ≤ 2GB, available nunca < 100Mi. Si excede → documentar y ajustar limits.

- [ ] **Step 7: Commit deploy-log**
```bash
git add docs/deploy-log.md && git commit -m "docs: deploy log - stack up + dominio + ssl"
```

---

### Task 3: Crear sitio + verificar imagen (bench version + digest)

**Files:**
- Modify: `docs/deploy-log.md` (append)

**Interfaces:**
- Consumes: stack de Task 2 corriendo
- Produces: site `crm.marcosbarbosagroup.com` creado con app `crm` instalada; `frappe_version` y `image_digest` documentados

- [ ] **Step 1: Obtener digest de la imagen y pinearlo en compose:**
```bash
ssh root@2.28.121.92 "docker images --digests | grep frappe/crm"
```
Editar `compose.yaml`: cambiar `image: ghcr.io/frappe/crm:stable` por `image: ghcr.io/frappe/crm:stable@sha256:<DIGEST>` en los 6 servicios de app. Commit + push + redeploy Dokploy. Verificar 8 contenedores up de nuevo.

- [ ] **Step 2: Registrar versión real de frappe:**
```bash
ssh root@2.28.121.92 "docker exec \$(docker ps -qf name=backend) bench version"
```
Documentar en deploy-log (spec §3 pide esto).

- [ ] **Step 3: Crear el site** (exec en backend):
```bash
ssh root@2.28.121.92 "docker exec -it \$(docker ps -qf name=backend) bench new-site crm.marcosbarbosagroup.com --db-root-password \$DB_PASSWORD --admin-password \$ADMIN_PASSWORD --install-app crm --mariadb-user-host-login-scope='%'"
```
(Con env del contenedor: exportar o pasar literales de Dokploy env). Expected: `*** Site crm.marcosbarbosagroup.com created` +Installing crm... sin errores.

- [ ] **Step 4: Verificar site responde:**
```bash
curl -sI https://crm.marcosbarbosagroup.com/api/method/ping
```
Expected: 200 con `{"message":"pong"}` (ping es allow_guest, verificado en audit). Si 404 site not found → revisar `currentsite.txt` (`bench use crm.marcosbarbosagroup.com`).

- [ ] **Step 5: Commit deploy-log actualizado**
```bash
git add docs/deploy-log.md && git commit -m "docs: site creado + digest pineado + bench version"
```

---

### Task 4: Usuarios, pipeline y configuración funcional

**Files:**
- Modify: `docs/deploy-log.md`
- Create: `docs/crm-config.md` (estado funcional: usuarios, pipeline, fuentes)

**Interfaces:**
- Consumes: site funcionando de Task 3
- Produces: CRM usable por Marcos y Joel con pipeline del brochure; credenciales entregadas por canal seguro (NUNCA en git)

- [ ] **Step 1: Login admin + cambiar password Administrator.** Entrar a `https://crm.marcosbarbosagroup.com` con `Administrator` + `ADMIN_PASSWORD` (Dokploy env). Cambiar password a uno fuerte nuevo (User > Administrator > Set New Password). Reportar credenciales a Marcos por WhatsApp (no por chat/git).

- [ ] **Step 2: Crear usuario Joel:** Users → New → email de Joel, rol **System Manager**, nombre. Enviar invitación (Welcome email si hay SMTP; si no, setear password manualmente y documentar).

- [ ] **Step 3: Configurar regional:** Settings → System Settings → Language `es`, Time Zone `America/Argentina/Cordoba`, Currency default ARS + añadir USD. Guardar.

- [ ] **Step 4: Pipeline = metodología brochure.** CRM Deal Status (Desk: search "CRM Deal Status") → crear/ajustar estados exactos:
```
Qualification (Open) · Diagnóstico (Open) · Análisis (Open) · Estrategia (Open) · Implementación (Open) · Seguimiento (Open) · Escalamiento (Open) · Won (Won) · Lost (Lost)
```
(Borrar/u ocultar los default que no apliquen; mantener _type correcto en cada uno.)

- [ ] **Step 5: Lead Sources** (doctype Lead Source): `Website, WhatsApp, Referido, Conferencia, LinkedIn` (además de los default existentes que se dejen).

- [ ] **Step 6: API user para la web:** Users → New → `web-form@marcosbarbosagroup.com`, rol **CRM User**, API Access → Generate Keys. Guardar `API_KEY`/`API_SECRET` en Dokploy env del servicio WEB (no del CRM) y en gestor de contraseñas. Documentar en crm-config.md SIN los valores.

- [ ] **Step 7: Smoke test de lead desde la API** (exacto a como lo hará la web):
```bash
curl -X POST https://crm.marcosbarbosagroup.com/api/resource/CRM Lead \
  -H "Authorization: token <API_KEY>:<API_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"data": "{\"first_name\":\"Lead de Prueba\",\"email\":\"prueba@test.com\",\"mobile_no\":\"5493510000000\",\"source\":\"Website\",\"notes\":\"Smoke test fase 1\"}"}'
```
Expected: 200 con `data.name` = `CRM-LEAD-YYYY-NNNNN`. Verificar en UI que aparece. Borrar el lead de prueba después.

- [ ] **Step 8: Commit bitácora final**
```bash
git add docs/ && git commit -m "docs: crm config - usuarios, pipeline brochure, api keys (sin secretos)"
```

---

### Task 5: Adaptar formulario web → Frappe (F2 del spec, se ejecuta tras Task 4)

**Files:**
- Modify: `proyectos/webmarcosbarbosagroup/app/api/lead/route.ts`
- Modify: `proyectos/webmarcosbarbosagroup/.env.example` (si existe) / docs

**Interfaces:**
- Consumes: API user + keys de Task 4; endpoint confirmado `POST /api/resource/CRM Lead`
- Produces: leads de la web caen en Frappe CRM

- [ ] **Step 1: Modificar mapping en route.ts** — reemplazar el POST a `/api/v1/Lead` por:
```ts
const res = await fetch(`${process.env.NEXT_PUBLIC_CRM_URL}/api/resource/CRM Lead`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `token ${process.env.CRM_API_KEY}:${process.env.CRM_API_SECRET}`,
  },
  body: JSON.stringify({
    data: JSON.stringify({
      first_name: body.name?.split(" ")[0] ?? body.name,
      last_name: body.name?.split(" ").slice(1).join(" ") || "-",
      email: body.email,
      mobile_no: body.phone ?? "",
      custom_plan_interes: body.plan ?? "",
      notes: body.mensaje ?? "",
      source: "Website",
    }),
  }),
})
```
Mantener AbortController 5s + fallback `data/leads.jsonl` existentes.

- [ ] **Step 2: Env web en Dokploy:** `NEXT_PUBLIC_CRM_URL=https://crm.marcosbarbosagroup.com`, `CRM_API_KEY=…`, `CRM_API_SECRET=…` → Redeploy web.

- [ ] **Step 3: Test end-to-end real:** completar el form de `https://marcosbarbosagroup.com/contacto` → verificar lead en CRM (UI) → verificar fallback si CRM caído (downtime simulado opcional).

- [ ] **Step 4: Commit y push web:**
```bash
cd ../webmarcosbarbosagroup && git add -A && git commit -m "feat(lead): integracion frappe crm api + fallback" && git push origin main
```

---

### Task 6: Cierre — backups verificados + runbook

**Files:**
- Create: `docs/runbook.md`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: runbook operativo + verificación de backups

- [ ] **Step 1: Verificar Hetzner Backups ON** (usuario confirma en consola; anotar fecha del primer snapshot en runbook).

- [ ] **Step 2: Probar backup Frappe:**
```bash
ssh root@2.28.121.92 "docker exec -it \$(docker ps -qf name=backend) bench --site crm.marcosbarbosagroup.com backup --with-files"
```
Expected: archivo en `sites/crm.marcosbarbosagroup.com/private/backups/`. Documentar.

- [ ] **Step 3: Escribir runbook.md:** reiniciar stack (Dokploy redeploy), restaurar backup de Hetzner (rebuild + attach volume), restaurar bench backup (`bench restore`), actualizar versión (noche + backup + staging futuro), resize CX33 cuando aplique (criterio: swap >500MB sostenido 1 semana, ERPNext, 3er usuario), comandos de diagnóstico (`docker stats`, `bench doctor`).

- [ ] **Step 4: Commit final**
```bash
git add docs/runbook.md && git commit -m "docs: runbook operativo + backups verificados"
```

---

## Self-Review

- **Spec coverage:** §3 imagen+digest (T1/T3) ✓ · §4 arquitectura (T1) ✓ · §5 tuning exacto (T1) ✓ · §6 deploy+site (T2/T3) ✓ · §7 seguridad API user (T4) + backups (T6) ✓ · §8 integración web (T5) ✓ · §9 pipeline/usuarios (T4) ✓ · §10 riesgos→runbook (T6) ✓
- **Placeholders:** ninguno — compose completo, comandos exactos, payloads reales
- **Consistencia:** `--install-app` singular en T3 ✓ · digest pineado antes de crear site ✓ · memoria verificada en T2 Step 6 ✓ · secrets nunca en git (T1 .gitignore, T4 step 6) ✓
