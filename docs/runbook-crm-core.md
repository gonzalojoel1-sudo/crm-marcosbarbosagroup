# Runbook — crm_core (custom app Frappe v15)

Estado: **instalada y funcionando en producción** (`crm.marcosbarbosagroup.com`)
Imagen actual: `crm-mb:20` · Fecha de este runbook: 2026-09-26
Servicios de app (Swarm, stack `crm`): `crm_backend`, `crm_websocket`,
`crm_worker`, `crm_scheduler`, `crm_frontend` — todos `1/1`.

> Este runbook describe **lo que los scripts hacen de verdad**, no lo que
> debería. Si algo está desactualizado, se corrige acá: un runbook que promete
> guarantías que el script no tiene es peor que no tener runbook.

## Qué es

`crm_core` es la app custom (módulo `MbCRM`) que agrega la página `/hoy` y el
API de la agenda sobre Frappe Framework v15. Licencia propietaria (Marcos
Barbosa Group).

**DocTypes propios: 0 activos.** Los 18 que se declararon (Task, Event, Contact,
Account, Lead, Deal, Activity, las tablas de Google Calendar, etc.) están
**archivados** en `apps/crm_core/crm_core/_archived_doctypes/`, no se registran
y no se deben volver a declarar: chocan con los DocTypes built-in de FCRM. Ver
"DocTypes que usa" más abajo: el app **no** crea DocTypes, agrega **Custom
Fields** sobre DocTypes de los apps `crm` y `frappe`.


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

La agenda/Hoy **no** tienen DocTypes propios. Leen y escriben DocTypes de otros
apps, y agregan sus campos como **Custom Fields** (los crea `crm_core.patches`
en el `bench migrate`):

- **Reuniones** → DocType `Event` (del app `frappe`) + `Event.custom_crm_lead`
  (Link → `CRM Lead`) y `Event.custom_crm_categoria` (Select de 5 valores).
  Las carga el cron de Google Calendar (ver abajo). En la agenda se muestran
  como bloques; el título sale de `notes` ("Reunión agendada: <título real>").
  **La columna que el API lee de verdad es `tabEvent.custom_crm_categoria`**:
  por eso el check post-migrate del deploy verifica esa columna y el Custom
  Field, y no "cuántos DocTypes hay en MbCRM" (que da igual, están archivados).
- **Tareas** → `CRM Task` (`title`, `status`, `priority`, `due_date`).
  `Todo/In Progress = pendiente`, `Done = hecha`. Sin `due_date` = inbox del día.
- **Estado de sync** → `Event.custom_gcal_etag`, `custom_gcal_updated`,
  `custom_gcal_calendar_id`, `custom_sync_origin`, `custom_last_synced_at`,
  `custom_last_synced_local_modified`, `custom_sync_estado`,
  `custom_sync_error`, `custom_sync_intentos`.

> ⚠️ **NO** crear un DocType llamado `Event`: choca con el de Frappe y lo
> sobrescribe. Recuperación: `scripts/restore_frappe_event.py`.
> ⚠️ Hay un **segundo camino** al mismo schema: `scripts/setup_custom_fields.py`
> hace a mano lo mismo que `crm_core.patches`, fuera de `Patch Log`. Preferí
> siempre `deploy-crm.sh <tag> --migrate`.

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

Estos tests necesitan `KEY`/`SEC` de un API key del Administrator.

> **Por qué no hay un script que genere la key.** Existía
> `scripts/tmp_admin_key.py` (MODE=create/remove). Se borró el 2026-09-26: era un
> generador de credenciales de privileged access sin control de retención, y la
> key que dejó(created en una corrida de E2E) **sigue viva en la base**. Generar
> y revocar a mano, en el mismo lugar, es lo que evita que se repita.

```bash
# 1) Generar: en el Desk → User: Administrator → "API Access" → Generate Keys
#    (es el MISMO sitio donde después se revoca)
# 2) correr el test
KEY=... SEC=... node scripts/e2e_agenda.mjs   # screenshot -> agenda.png
KEY=... SEC=... node scripts/e2e_hoy.mjs      # screenshot -> hoy.png
# 3) Revocar: mismo lugar → "API Access" → Clear / Reset Secret
# 4) Verificar que no quedó ninguna (debería imprimir vacío):
docker exec "$(docker ps -qf 'name=crm_backend\.1')" \
  bench --site crm.marcosbarbosagroup.com execute frappe.client.get_value \
  --kwargs '{"doctype":"User","name":"Administrator","fieldname":"api_key"}'
```

> ⚠️ **PENDIENTE (2026-09-26):** hay un `api_key` de Administrator asentado en
> la base de producción, sin dueño conocido. Hay que revocarlo desde el Desk
> (paso 3) y después correr el paso 4 hasta que imprima vacío.



### Por qué el bundle va inline en el shell (leer antes de tocar)

1. Los contenedores `crm_backend` y `crm_frontend` **no comparten `sites/assets`**
   de forma confiable (verificado con un archivo marcador), así que `/assets/...`
   **no sirve** para los assets del frontend. Por eso el build (`gen-shell.mjs`)
   genera **un único `www/hoy.html` autocontenido**: el JS se inyecta crudo en
   `<script type="module">` y el CSS en `<style>`. Nada de `atob`/`Uint8Array`/
   `Blob`/`import(blob:)` y nada de pedir assets por red.
2. Frappe **rechaza cualquier template que contenga `.__`** (`Illegal template`)
   y el bundle minificado de React lo tiene. Se apaga con `safe_render = False`,
   que **debe ir en el objeto `context` dentro de `get_context` de `www/hoy.py`**,
   no a nivel módulo: `WEBPAGE_PY_MODULE_PROPERTIES`
   (`frappe/website/page_renderers/template_page.py`) no incluye `safe_render`, así
   que una asignación a nivel módulo nunca llega al context (es código muerto).
   Frappe lee `context.safe_render` en `TemplatePage.render_template()` del mismo
   archivo, y recién ahí decide si valida o no.
3. `window.CSRF` (no `__CSRF__`) por el mismo motivo histórico.

**Con `safe_render = False`, la única barrera que evita que el Jinja de Frappe
interprete el bundle inline (o que el parser HTML cierre el bloque antes) es el
chequeo de `apps/web/gen-shell.mjs`.** Ese script falla el build si el bundle trae
`{{`, `{%`, `{#`, `<!--` o `-->`, o si trae un cierre `</script` / `</style`. Si
se debilita ese chequeo, `/hoy` puede romperse en silencio: no lo toques sin
entender esta sección.

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
  renderiza en navegador real y saca screenshot). La API key se genera y se
  revoca **a mano** en el Desk (User: Administrator → API Access); ver la
  sección "E2E con navegador".


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

**Usar el script, no `docker build` a mano.** Eligé el tag siguiente al que está
corriendo (`docker service ls | grep crm_` te dice cuál es):

```bash
ssh root@2.28.121.92
cd /opt/crm-marcosbarbosagroup
bash scripts/deploy-crm.sh <sig-tag>            # p.ej. 21
bash scripts/deploy-crm.sh <sig-tag> --migrate  # si el deploy cambia el schema
```

`docker/build-crm-mb-18.sh` está **RETIRADO**: delegaba en `docker compose up -d`
+ un `sed` de `compose.yaml`, y producción corre **Swarm**, no compose. Ese
script, seguido al pie de la letra, mandaba los servicios a una imagen
inexistente. Ahora solo imprime el aviso y delega en `deploy-crm.sh`.

### Qué hace el script, en orden (y por qué)

1. **Lock** (`flock` sobre `.deploy/deploy.lock`): dos deploys a la vez se pisan.
2. **Preflight**, y aborta si algo de esto no está bien:
   - >2GB libres en `/var/lib/docker`;
   - `GET /api/method/ping` → **200 con `pong`**. Si el sitio YA estaba roto,
     aborta: desplegar sobre nada no se puede revertir;
   - los **5** servicios de app en `1/1`. Ojo: `crm_configurator` es un
     servicio one-shot y está `0/1` por diseño; no lo compares con los de app;
   - ningún servicio con `UpdateStatus.State == paused` (ver "destrabar un
     update pausado" más abajo).
3. **Git**: working tree limpio (excluyendo `docs/deploy-log.md`, que el propio
   script modifica), `git fetch` + `git merge --ff-only <upstream>`, y **pinea
   el SHA** que se compila. El SHA va como label
   `org.opencontainers.image.revision` de la imagen y al log. Si el upstream
   divergió, el `--ff-only` falla y el deploy corta antes de compilar.
4. **Build** con `BASE` = la imagen **que está corriendo** (Dokploy poda las que
   no usa).
5. **`--migrate`** (optativo, ver abajo).
6. **Persiste** `.deploy/last.json` con `from_tag`/`to_tag`/`sha`/`backup`/
   `started_at` **antes** del primer `service update`. El rollback lee ese
   archivo, no el estado vivo.
7. **`docker service update --update-order start-first --update-parallelism 1`**
   en los 5 servicios, de a uno. Con `replicas=1`, `stop-first` deja el sitio en
   502 en cada deploy y deja el servicio en `0/1` si el task nuevo muere.
8. **Convergencia por polling** (no `sleep 40`): corta apenas el servicio está
   `1/1`, y antes corta si el task pasa a `Failed*`/`Rejected*` o si el update se
   pausa.
9. **Verificación que prueba algo**: ping 200 + `pong`, y **comparación de la
   imagen realmente corriendo** en los 5 servicios contra la pedida (estar `1/1`
   con la imagen vieja es un deploy que no pasó). Con `--migrate`, además
   verifica la columna `tabEvent.custom_crm_categoria` + su Custom Field.
10. **`bench clear-cache`** (imprescindible: los hooks de apps quedan cacheados
    en Redis y no se refrescan solos al reiniciar el contenedor).
11. **Anota** el resultado (fecha, from → to, SHA, migrate sí/no, OK/fallo) en
    `docs/deploy-log.md`.

Y lo que **no** hace: **no** hace rollback del schema. Si un deploy con
`--migrate` falla, la imagen vuelve atrás pero un `bench migrate` a medias
**no se puede deshacer** (no es transaccional): hay que restaurar el backup que
el script tomó antes del migrate. El rollback lo avisa con el nombre exacto del
backup.

### Por qué `/hoy` NO es health check

`/hoy` sin sesión responde **301 a `/login` siempre** (es el gate de login de
`www/hoy.py`), esté sano o caído el app. Por eso el check del deploy usa
`/api/method/ping` (200 + `{"message":"pong"}`), que sí toca gunicorn y la base.
`/hoy` se imprime solo como dato de diagnóstico.

### `--migrate` (obligatorio si el deploy toca el schema)

```bash
bash scripts/deploy-crm.sh <sig-tag> --migrate
```

Obligatorio cuando el deploy **agrega o cambia DocTypes/Custom Fields**: en
Frappe la columna no existe hasta después del migrate, así que el `/hoy` nuevo
leería un campo inexistente y el sitio tiraría 500.

Cómo lo corre el script:

- pone el sitio en **maintenance mode** antes y lo saca después (si el deploy
  muere con el maintenance puesto, es una caída igual de visible: por eso hay
  un trap que lo apaga siempre);
- toma un **backup antes del migrate** y verifica que `bench backup` haya creado
  un `.sql.gz` **nuevo** (si no, aborta);
- crea un servicio descartable `crm_migrate_tmp` con la imagen nueva (no con la
  vieja: la vieja no trae `patches.py`), con la red overlay del stack (que no es
  attachable) y con **`--limit-memory 1g`** — el nodo tiene 3.8GB con swap en
  uso, y sin tope este servicio puede empujar al backend a OOM;
- espera el task a mano y **exige un estado terminal** (`Complete*`). Si queda
  `Failed*`/`Rejected*` o se agota el timeout: **no toca ningún servicio** y
  dice qué backup restaurar. `bench migrate` no es transaccional: un migrate
  cortado deja el schema a medias.

### Destrabar un update pausado

Los servicios tienen `UpdateConfig {order: stop-first, failure_action: pause,
max_failure_ratio: 0, parallelism: 1}` con `replicas=1`: si el task nuevo muere,
Swarm pausa el update y el servicio queda en `0/1`.

```bash
# ver el estado (nil-safe: hay servicios que nunca tuvieron UpdateStatus y
# `{{.UpdateStatus.State}}` a secas tira "nil pointer evaluating")
for s in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  printf '%s ' "$s"
  docker service inspect "$s" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}none{{end}}'
done

# destrabar: pasar failure_action a continue
docker service update --update-failure-action continue crm_worker
```

**No** uses `docker service update crm_worker` pelado: no cambia el spec, sólo
reinicia el update, y pisa `PreviousSpec` con `CurrentSpec`, con lo cual se
pierde la posibilidad de `docker service update --rollback` (moby#37693).

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

### Probar el script sin tocar producción

```bash
bash scripts/deploy-crm.sh <tag> --dry-run   # imprime lo que haría, no muta nada
bash scripts/test-deploy-dry-run.sh           # 106 aserciones, sin docker ni red
```

`--dry-run` no compila, no hace fetch/merge y **no ejecuta** ningún comando que
muta el host o el stack: los imprime. Los sondeos de solo lectura (docker
inspect/ls/ps, curl) sí corren, así que el preflight muestra el estado real.


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

### Presupuestos viejos: `CRM Deal.products` quedó en desuso

Los presupuestos viejos vivían en la tabla hija `CRM Deal.products`. Ahora el
presupuesto es un documento propio (`CRM Presupuesto`) y esa tabla quedó **vacía
y en desuso**. Se vació una sola vez con `scripts/cleanup_deal_products.py`
(corre dentro del contenedor; acepta `--dry-run`).

El DocType `CRM Products` y el campo `CRM Deal.products` **no** se borran: quedan
sin uso hasta que se eliminen en una fase posterior.

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
BE=$(docker ps -qf 'name=crm_backend\.1')
docker exec "$BE" bash -c 'printf "frappe\ncrm\ncrm_core\n" > /home/frappe/frappe-bench/sites/apps.txt'
docker exec "$BE" bash -c 'cd /home/frappe/frappe-bench && bench --site <site> clear-cache'
for svc in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  docker service update --force --update-order start-first --update-parallelism 1 "$svc"
done
```

El `clear-cache` es imprescindible: los hooks de apps quedan cacheados en
Redis y no se refrescan solo al reiniciar el contenedor.

## Rollback y recuperación

### Lo que hace el script (automático)

Si algo falla **después** del primer `docker service update`, el
`trap ... ERR INT TERM` dispara el rollback:

- revierte **solo los servicios que ese deploy ya había tocado**, en orden
  inverso, con `--force` y `--update-order start-first`;
- usa el `from_tag` de `.deploy/last.json` (la imagen buena persistida antes de
  tocar nada), **no** el estado vivo — si un deploy quedó a medias, el estado
  vivo es la versión a medias y "volver atrás" no volvería atrás;
- si un servicio está con el update **paused**, le pasa `failure_action` a
  `continue` antes de revertir (sin eso, `service update` es rechazado y el
  rollback se queda a mitad);
- un servicio que no se puede revertir **no** aborta la reversión de los demás:
  los que fallaron se listan explícitos, con el comando para hacerlos a mano;
- si el deploy había corrido `bench migrate`, avisa que **la imagen volvió pero el
  schema no** y qué backup restaurar.

Y lo que **no** hace, a propósito: si el fallo fue **antes** de tocar Swarm
(preflight, git, build, migrate), no inventa un rollback — no hay nada que
revertir, y revertir un deploy que no ocurrió es cómo se rompe un stack sano.

### Si el deploy se cortó y el script no pudo revertir

```bash
# 1. qué imagen era la buena: el estado persistido por el propio script
cat /opt/crm-marcosbarbosagroup/.deploy/last.json
#    -> from_tag = a dónde volver, to_tag = a qué se intentó ir

# 2. qué está corriendo ahora, servicio por servicio
for svc in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  printf '%-16s %-12s %-10s ' "$svc" \
    "$(docker service inspect "$svc" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')" \
    "$(docker service ls --filter "name=$svc" --format '{{.Replicas}}')"
  docker service inspect "$svc" \
    --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}none{{end}}'
done

# 3. destrabar los que estén paused (ver "destrabar un update pausado")

# 4. volver a la imagen buena, uno por uno
GOOD=crm-mb:<from_tag del paso 1>
for svc in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  docker service update --force --update-order start-first --update-parallelism 1 \
    --image "$GOOD" "$svc"
done

# 5. verificar (NO usar /hoy: siempre da 301 sin sesión)
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' \
  https://crm.marcosbarbosagroup.com/api/method/ping   # tiene que dar 200
curl -sS --max-time 10 https://crm.marcosbarbosagroup.com/api/method/ping
docker service ls --filter name=crm_
```

### Si el problema es el schema (el deploy corrió `--migrate`)

`bench migrate` **no es transaccional**: si se cortó, el schema puede haber
quedado a medias y **no hay `downgrade`**. La salida es restaurar el backup que
el script tomó antes del migrate (el nombre está en `.deploy/last.json`, campo
`backup`):

```bash
BE=$(docker ps -qf 'name=crm_backend\.1')
docker exec "$BE" bash -c 'ls -1t /home/frappe/frappe-bench/sites/crm.marcosbarbosagroup.com/private/backups/*.sql.gz | head -5'
docker cp <site>:/home/frappe/frappe-bench/sites/<site>/private/backups/<archivo>.sql.gz /tmp/
docker exec "$BE" bench --site <site> restore /tmp/<archivo>.sql.gz
docker exec "$BE" bench --site <site> migrate
docker exec "$BE" bench --site <site> clear-cache
# y recién después volver la imagen
```

Si el backup también está en Drive: `scripts/backup/restore-gdrive.sh` (lee el
"cómo recuperar un deploy fallido" de más abajo: **aborta** salvo que el host sea
un ambiente de test declarado o se pase `--force`; tomá un backup del estado
actual antes de sobrescribir).

### Instalación anterior (crm-mb:18, 2026-09-15) — histórico

```bash
# el tag de rollback de aquella época era crm-mb:18-pre-crm-core
docker tag crm-mb:18-pre-crm-core crm-mb:rollback
for svc in crm_backend crm_frontend crm_scheduler crm_websocket crm_worker; do
  docker service update --image crm-mb:18-pre-crm-core "$svc"
done
# Desinstalar del site si hace falta
bench --site <site> uninstall-app crm_core
```

Backups del prod previos a la instalación:
`crm.marcosbarbosagroup.com/private/backups/20260915_111243-*`

## Pendientes abiertos (2026-09-26)

- **API key de Administrator viva en producción.** No tiene dueño conocido (la
  dejó `scripts/tmp_admin_key.py`, que se borró). Revocar desde el Desk → User:
  Administrator → API Access, y verificar con el comando de la sección "E2E con
  navegador" hasta que imprima vacío.
- **Backups en `/var/backups/crm`:** `backup-gdrive.sh` ahora stagea los dumps
  ahí (no en `/tmp` del mismo disco) y aborta si no hay espacio. Hay que
  verificar que el path exista y que el cron (`30 3 * * *`, y 15:30) apunte al
  script nuevo.

## Repos

- App pública (para `bench get-app`): https://github.com/gonzalojoel1-sudo/crm-core-app (tag v0.0.2)
- Monorepo cliente: apps/crm_core dentro de crm-marcosbarbosagroup

## Pendiente (fases siguientes)

- UI React (agenda Hoy, palette) — Fase 1
- Sync Google Calendar 2-way — Fase 6
- Bridge Cal.com — Fase 7
- PWA + deploy web — Fase 8
