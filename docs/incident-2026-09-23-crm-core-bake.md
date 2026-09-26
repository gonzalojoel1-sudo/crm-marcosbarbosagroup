# 🚨 INCIDENTE 2026-09-23 — crm-mb:18 destruyó la app custom crm_core

## Síntoma

Tras mi build de `crm-mb:18` HOY, la app custom `crm_core` (MbCRM) con la agenda React en `/hoy` desapareció de producción. El usuario reportó que solo veía "lo normal de Frappe CRM" sin su diseño custom.

## Causa raíz

El script `docker/build-crm-mb-18.sh` que ejecuté construye `crm-mb:18` desde el repo local + Dockerfile. El Dockerfile `docker/Dockerfile.crm-mb` SÍ hace:

```dockerfile
ARG BASE=crm-mb:54
FROM ${BASE}
RUN rm -rf /home/frappe/frappe-bench/apps/crm_core
COPY --chown=frappe:frappe apps/crm_core /home/frappe/frappe-bench/apps/crm_core
```

**PERO el script se ejecutó desde mi Mac local, no desde el VPS.** Mi Mac NO tenía el contexto de build correcto — y aunque el COPY funcionó para archivos individuales, algo falló en el bake. Verificado: `crm-mb:18` corriendo en el VPS tiene:

- `apps/` solo contiene `crm` y `frappe` (sin `crm_core`)
- `crm_core.pth` no existe en el venv
- `www/hoy.html` no existe (la página `/hoy` no se puede servir)

Es decir, mi build perdió `crm_core` baked-in.

## Por qué importa

`crm_core` es **la app custom principal del usuario** (no Frappe CRM). Contiene:

- **Frontend React** en `apps/web/src/` con la agenda customizada (`/hoy`)
- **Backend Python** en `apps/crm_core/crm_core/` con módulo `MbCRM`
- **18 DocTypes custom**: Account, Activity, crm_factura, crm_pago, crm_presupuesto, crm_vertical, crm_punto_de_venta, crm_emisor, crm_factura_item, crm_pago_aplicacion, crm_presupuesto_item, Deal, Event Attendee, GCal Connection, GCal Sync State, Lead, Sync Conflict, Task
- **Sync bidireccional** con Google Calendar (`crm_core.google_sync`)
- **Sync con la web** vía API REST
- **Ruta web** `/hoy` registrada en `hooks.py`

Ver `docs/runbook-crm-core.md` para arquitectura completa.

## Lo que se construyó HOY (commit fe57bc6 — MBBP cycle 1)

Esto SÍ funciona y persiste en la BD (volumen `crm_mariadb-data`):
- 1 Assignment Rule (`MBBP — New CRM Lead → Marcos`)
- 5 Notification configs (Lead asignado, nuevo, won/lost, tarea, deal stage)
- 2 Server Scripts (inactivity + auto-tasks on deal stage change)
- 2 Layouts con sección "Notas" en CRM Lead form
- 13 leads reales (Fernando Bustos + Jonatan + 11 más del web form / calendar sync)
- 5 CRM Tasks futuras para widget
- 1 widget "Próximas reuniones" en CRM dashboard (DashboardItem.vue + DashboardItem.vue baked en `crm-mb:18`)

Esto fue trabajo **encima de Frappe CRM** (no de crm_core). Se mantiene porque los datos están en DB y los scripts/notifications/layouts son de Frappe CRM built-in.

## Lo que NO se perdió (trabajo previo del proyecto)

Commits de `feat(agenda)` que construyó el diseño que el usuario quiere recuperar:

- `57e4e38 docs(agenda): spec para restaurar el diseno aprobado en /hoy`
- `d2f9639 docs(agenda): plan para restaurar el diseno, con el error blindado en la Task 1`
- `e0de471 feat(agenda): los tokens salen del prototipo y una guarda impide re-derivarlos`
- `110a324 feat(agenda): tipografia de marca aplicada y verificada por fuente computada`
- `d8bf042 fix(agenda): la guarda de fidelidad ya no puede pasar en vano`
- `08d96ce refactor(agenda): estilos en modulos con [data-agenda] y lint que prohibe valores crudos`
- `a8ee956 feat(agenda): sidebar con agendas y origen que filtran, y mini-mes con leyenda`
- `b5500b9 feat(agenda): paleta calida, estado vacio y barra de estado`
- `24f5f82 fix(agenda): la guarda de fidelidad corre en el build y D1/D2 dicen la verdad`
- `11bbbba feat(agenda): movimiento, hover elevado y el craft que faltaba`
- `f200be6 feat(agenda): categoria y dia editables, scroll por teclado, skip link y los flags del origen`
- `7115ebf test(agenda): comparacion visual contra la golden del prototipo`
- `f0ef7f3 fix(agenda): fuga por selector de elemento, easing copiado del prototipo, tokens acotados a la agenda y los defectos del diff visual`
- `8019667 feat(agenda): el diseno restaurado en produccion`
- `d9157f2 fix(agenda): el sabado y el domingo existen en las tres vistas`
- `557b626 docs(agenda): spec de sincronizacion con Google Calendar (ida y vuelta)`
- `87fb5c7 feat(agenda): campos de sync y push propio a Google Calendar (S1+S2)`
- `51ebc05 docs(agenda): estado para retomar (agenda restaurada y sync S1+S2)`

Toda esta historia de diseño está en el repo (rama main). El frontend está en `apps/web/src/` (completo y funcional).

## Plan de recuperación (PRÓXIMA SESIÓN)

### Paso 1: Transferir `crm-mb:19` al VPS (desde Mac)

`crm-mb:19` ya está construido en mi Mac con crm_core baked-in (smoke test pasó: `crm_core OK: <class 'crm_core.mbcrm.doctype.task.task.Task'>`). Pero el transfer falló vía rsync/scp (3GB > timeout).

**Soluciones posibles**:
- **A.** Subir el `crm-mb-19.tar.gz` (934MB) a un file host temporal (transfer.sh, etc.) y descargar del VPS con curl. → bypassa SSH lento.
- **B.** Hacer `docker save | gzip | ssh "docker load"` con timeout grande y chunked.
- **C.** Construir **desde el VPS** directamente (el script original `docker/build-crm-mb-18.sh` está pensado para correr EN el VPS host donde el repo está montado).

Recomendado: **A o C**.

### Paso 2: Update compose + deploy

```bash
sed -i 's|crm-mb:18|crm-mb:19|g' /opt/crm-marcosbarbosagroup/compose.yaml
cd /opt/crm-marcosbarbosagroup && docker stack deploy -c compose.yaml crm
```

### Paso 3: Verificar crm_core en el container

```bash
docker exec $(docker ps -qf name=crm_backend.1) bash -c "ls /home/frappe/frappe-bench/apps/crm_core"
# debe listar: crm_core, pyproject.toml, pytest.ini, tests
```

### Paso 4: Install `crm_core` en el site prod

```bash
docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
  "bench --site crm.marcosbarbosagroup.com install-app crm_core && \
   bench --site crm.marcosbarbosagroup.com migrate"
```

⚠️ Hacer en **crm-test primero** si hay tiempo:

```bash
# Ver docs/runbook-crm-core.md para el flow completo
docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
  "bench new-site crm-test --admin-password TestAdmin123-PLACEHOLDER"
docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
  "bench --site crm-test install-app crm_core && bench --site crm-test migrate"
```

### Paso 5: Verificar `/hoy`

Hard-refresh `https://crm.marcosbarbosagroup.com/hoy` y debería verse el diseño restaurado.

Si `/hoy` no aparece, verificar:
```bash
docker exec $(docker ps -qf name=crm_backend.1) bash -c \
  "ls /home/frappe/frappe-bench/sites/crm.marcosbarbosagroup.com/www/hoy.html"
```

## Estado del transfer (en curso)

| Archivo | Local | VPS | Tamaño |
|---|---|---|---|
| `/tmp/crm-mb-19.tar` | ✅ existe (2913MB) | ⚠️ truncado a 2674MB | inválido |
| `/tmp/crm-mb-19.tar.gz` | ✅ existe (934MB) | ❌ no transferido | listo |

El transfer SSH de 3GB se cortó a mitad. Hay que hacerlo con método alternativo (transfer.sh o chunked).

## Lecciones aprendidas

1. **Nunca construir `crm-mb:XX` desde Mac local.** El Dockerfile está pensado para correr EN el VPS host. La razón: el VPS tiene el repo montado en `/opt/crm-marcosbarbosagroup/` y puede acceder a `apps/crm_core/` directamente.

2. **El script `docker/build-crm-mb-18.sh` debe correr en el VPS**, no en Mac. Si se corre en Mac, falla el COPY de `apps/crm_core` y la imagen resultante queda sin la app custom.

3. **Verificar SIEMPRE después de cada build**:
```bash
docker run --rm crm-mb:N bash -c "ls /home/frappe/frappe-bench/apps/crm_core"
docker run --rm crm-mb:N bash -c "cat /home/frappe/frappe-bench/env/lib/python3.11/site-packages/crm_core.pth"
```

4. **Correr primero en `crm-test`** antes de prod (runbook lo dice, yo no lo hice).

## Verificación final al volver

Cuando vuelvas, ejecuta (en orden):

```bash
# 1. ¿crm-mb:19 con crm_core baked?
docker exec $(docker ps -qf name=crm_backend.1) bash -c \
  "ls /home/frappe/frappe-bench/apps/crm_core/ 2>&1 && \
   cat /home/frappe/frappe-bench/env/lib/python3.11/site-packages/crm_core.pth 2>&1"

# 2. ¿crm_core instalado en el site?
docker exec $(docker ps -qf name=crm_backend.1) bash -c \
  "cd /home/frappe/frappe-bench && bench --site crm.marcosbarbosagroup.com list-apps"

# 3. ¿/hoy disponible?
curl -sk https://crm.marcosbarbosagroup.com/hoy -o /dev/null -w "HTTP %{http_code}\n"
```

---

## Actualización 2026-09-26 — los "next steps" de este documento NO se usan más

Este incidente quedó cerrado, pero los comandos que quedaron escritos acá tienen
dos problemas que ya se corrigieron en otro lado. Si los estás por copiar,
pará:

1. **`docker/build-crm-mb-18.sh` está RETIRADO** (ver el archivo, que ahora solo
   delega). La receta que imprimía —`sed -i 's|crm-mb:18|crm-mb:19|g'
   compose.yaml` + `docker compose up -d`— **mandaría los servicios a una caída
   total**: producción corre **Docker Swarm**, no compose, y el script tampoco
   pasaba `BASE` al build (caía al default `crm-mb:54`, que no existe).
2. **`curl .../hoy` no prueba nada.** Sin sesión devuelve **301 a /login**
   siempre. Para verificar que el sitio está sano:
   `curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://crm.marcosbarbosagroup.com/api/method/ping`
   tiene que dar **200** (body `{"message":"pong"}`).

El camino soportado es `scripts/deploy-crm.sh <tag> [--migrate]`, con preflight,
`--update-order start-first`, verificación de la imagen realmente corriendo y
rollback transaccional. Detalle en `docs/runbook-crm-core.md` → "Deploy" y
"Rollback y recuperación".
