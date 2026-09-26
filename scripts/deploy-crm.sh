#!/usr/bin/env bash
# Deploy de crm-mb sobre Docker Swarm (VPS Hetzner, stack `crm`).
#
#   scripts/deploy-crm.sh <tag-nuevo> [--migrate] [--dry-run]
#   scripts/deploy-crm.sh 21 --migrate
#
# Por qué existe (y por qué está escrito así):
#   - Dokploy poda imágenes sin usar. Si el Dockerfile partiera de una base fija
#     ("crm-mb:19"), esa base desaparece y el build muere. La base es SIEMPRE la
#     imagen que está corriendo (la referencia un contenedor vivo).
#   - El deploy es TRANSACCIONAL. `set -Eeuo pipefail` + `trap ... ERR INT TERM`
#     disparan un rollback real de los servicios YA TOCADOS, con `--force` y sin
#     que un servicio roto aborte el rollback de los demás.
#   - Antes de tocar nada se persiste la imagen buena en `.deploy/last.json`. El
#     rollback lee ESE archivo, no el estado vivo: si un deploy quedó a medias, el
#     estado vivo es la versión a medio desplegar y el "rollback" no vuelve atrás.
#   - Hay PREFLIGHT (disco, salud real del sitio, réplicas, updates pausados): no
#     se despliega sobre un stack que ya estaba roto.
#   - Nada de `sleep 40` adivinado: convergencia por polling con timeout y corte
#     temprano si el task pasa a Failed/Rejected o el update se pausa.
#
# Por qué `/hoy` NO sirve como health check:
#   `/hoy` sin sesión devuelve SIEMPRE 301 a /login (es el gate de login de
#   `www/hoy.py`), esté sano o caído el app. Un chequeo `case 200|301|302 → OK`
#   acepta un sitio muerto. Lo que sí prueba algo es el endpoint sin auth:
#   `GET /api/method/ping` → 200 `{"message":"pong"}` (toca gunicorn + la DB).
#
# Inyección de fallas (SOLO para tests, ver scripts/test-deploy-dry-run.sh):
#   DEPLOY_FAULT=update:crm_worker            # falla esa fase
#   DEPLOY_FAULT=converge:a,rollback:b        # varias, separadas por coma
#   Sin la variable, el deploy es 100% normal. No la uses en producción.
set -Eeuo pipefail

# ── 0. salida y helpers ──────────────────────────────────────────────────────
say()  { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
ok()   { say "  ok  $*"; }
warn() { say "AVISO  $*" >&2; }
err()  { say "ERROR  $*" >&2; }
die()  { err "$*"; exit 1; }
usage() {
  cat >&2 <<'USO'
uso: deploy-crm.sh <tag-nuevo> [--migrate] [--dry-run]

  <tag-nuevo>   entero. Ej: 21
  --migrate     corre `bench migrate` con la imagen nueva ANTES de swapear los
                servicios. OBLIGATORIO si el deploy agrega/cambia DocTypes o
                Custom Fields (la columna no existe hasta después del migrate).
  --dry-run     no compila, no hace fetch/merge, no toca el repo remoto y
                IMPRIME cada comando que muta el host o el stack. Los sondeos de
                solo lectura (docker inspect/ls/ps, curl) sí se ejecutan, así el
                preflight muestra el estado real. Con eso el preflight y el
                rollback quedan visibles sin riesgo.
USO
}

# ── 1. argumentos ───────────────────────────────────────────────────────────
NEW=""
MIGRATE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*)        usage; die "flag desconocido: $arg" ;;
    *)
      if [ -n "$NEW" ]; then usage; die "sobra un argumento: $arg"; fi
      NEW="$arg"
      ;;
  esac
done
[ -n "$NEW" ] || { usage; die "falta el tag de la imagen nueva"; }
# Sin esto `deploy-crm.sh --migrate 20` dejaba NEW="--migrate" y construía una
# imagen basura (y el `case` de flags se la comía como tag).
case "$NEW" in
  ''|*[!0-9]*) die "el tag tiene que ser un entero (recibi: '$NEW'). Ej: deploy-crm.sh 21" ;;
esac

# ── 2. configuración ────────────────────────────────────────────────────────
SITE="${SITE:-crm.marcosbarbosagroup.com}"
if [ -z "${REPO_DIR:-}" ]; then
  if [ -d /opt/crm-marcosbarbosagroup ]; then
    REPO_DIR=/opt/crm-marcosbarbosagroup
  else
    REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
fi
SERVICES=(crm_backend crm_websocket crm_worker crm_scheduler crm_frontend)
REPLICAS_ESPERADAS="${REPLICAS_ESPERADAS:-1/1}"

HEALTH_URL="${HEALTH_URL:-https://${SITE}/api/method/ping}"
# /hoy sin sesión responde 301 SIEMPRE (gate de login). Sirve para diagnóstico,
# nunca como verificación de deploy.
DIAG_URL="${DIAG_URL:-https://${SITE}/hoy}"

DOCKER_DIR="${DOCKER_DIR:-/var/lib/docker}"
MIN_FREE_GB="${MIN_FREE_GB:-2}"
CURL_MAX_TIME="${CURL_MAX_TIME:-10}"
CONVERGE_TIMEOUT="${CONVERGE_TIMEOUT:-180}"
ROLLBACK_TIMEOUT="${ROLLBACK_TIMEOUT:-120}"
MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-900}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
# El nodo tiene 3.8GB con swap en uso: el servicio descartable del migrate NO
# puede comerse la RAM que necesita el backend.
MIGRATE_MEM_LIMIT="${MIGRATE_MEM_LIMIT:-1g}"
MIGRATE_SVC="${MIGRATE_SVC:-crm_migrate_tmp}"
MIGRATE_NET="${MIGRATE_NET:-crm_crm-net}"

STATE_DIR="${STATE_DIR:-$REPO_DIR/.deploy}"
STATE_FILE="$STATE_DIR/last.json"
DEPLOY_LOG="${DEPLOY_LOG:-$REPO_DIR/docs/deploy-log.md}"
IMAGE_PREFIX="${IMAGE_PREFIX:-crm-mb}"

# ── 3. ejecución de comandos ────────────────────────────────────────────────
# run_write: MUTA el host o el stack. En --dry-run se imprime y no se ejecuta.
# run_write_show: idem pero el comando real escribe en stdout.
# run_read: solo lectura; SIEMPRE se ejecuta (también en --dry-run, para que el
# preflight muestre el estado real y el test pueda mentir con un stub de docker).
run_write() {
  if [ "$DRY_RUN" = 1 ]; then say "[dry-run] $*"; return 0; fi
  "$@" >/dev/null
}
run_write_show() {
  if [ "$DRY_RUN" = 1 ]; then say "[dry-run] $*"; return 0; fi
  "$@"
}
# Igual que run_write pero se come también stderr (comandos cuyo error es ruido:
# `docker service rm` de un servicio que no existe, etc).
run_quiet() {
  if [ "$DRY_RUN" = 1 ]; then say "[dry-run] $*"; return 0; fi
  "$@" >/dev/null 2>&1
}
run_read() { "$@"; }
dr() { run_read docker "$@"; }

# Inyección de fallas para tests. Ver scripts/test-deploy-dry-run.sh.
# Lista separada por comas de `fase[:servicio]`, ej:
#   DEPLOY_FAULT=converge:crm_worker,rollback:crm_frontend
FAULT_LIST="${DEPLOY_FAULT:-}"
if [ -n "$FAULT_LIST" ]; then
  for _f in ${FAULT_LIST//,/ }; do
    case "${_f%%:*}" in
      build|backup|git|preflight|migrate|update|converge|image|http|rollback|clear-cache) ;;
      *) die "DEPLOY_FAULT desconocido: '$_f' (fases: build backup git preflight migrate update converge image http rollback clear-cache)" ;;
    esac
  done
fi
fault() {  # fault <fase> [servicio]
  local phase="$1" svc="${2:-}" item p s
  [ -n "$FAULT_LIST" ] || return 1
  for item in ${FAULT_LIST//,/ }; do
    p="${item%%:*}"
    s=""
    case "$item" in *:*) s="${item#*:}" ;; esac
    [ "$p" = "$phase" ] || continue
    [ -z "$s" ] || [ "$s" = "$svc" ] || continue
    return 0
  done
  return 1
}

# ── 4. estado de la transacción ─────────────────────────────────────────────
PHASE="arranque"
DEPLOYED=()          # servicios YA TOCADOS por este deploy (los únicos que se revierten)
MIGRATED=0           # el migrate de este run ya llegó a tocar el schema
MAINT=0              # maintenance mode puesto por este run
ROLLBACK_DONE=0
FROM_TAG=""
TO_TAG="crm-mb:$NEW"
SHA=""
BACKUP_FILE=""
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 5. lock: dos deploys a la vez se pisan ──────────────────────────────────
LOCK_MODE=""
acquire_lock() {
  mkdir -p "$STATE_DIR"
  if command -v flock >/dev/null 2>&1; then
    # flock(1) en el VPS (Debian). Libera solo al morir el proceso.
    exec 9>"$STATE_DIR/deploy.lock"
    if ! flock -n 9; then
      err "ya hay un deploy corriendo (lock $STATE_DIR/deploy.lock)"
      return 1
    fi
    LOCK_MODE=flock
    return 0
  fi
  # Fallback portable (macOS no tiene flock): mkdir es atómico.
  local d="$STATE_DIR/deploy.lock.d" owner=""
  if mkdir "$d" 2>/dev/null; then
    printf '%s\n' "$$" >"$d/pid"
    LOCK_MODE=mkdir
    return 0
  fi
  owner="$(cat "$d/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    err "ya hay un deploy corriendo (pid $owner)"
    return 1
  fi
  warn "lock viejo (pid ${owner:-desconocido} muerto); lo tomo"
  rm -rf "$d"
  mkdir "$d" || return 1
  printf '%s\n' "$$" >"$d/pid"
  LOCK_MODE=mkdir
  return 0
}
release_lock() {
  case "$LOCK_MODE" in
    mkdir) rm -rf "$STATE_DIR/deploy.lock.d" ;;
    *) : ;;
  esac
  LOCK_MODE=""
}

# ── 6. estado persistido (.deploy/last.json) ────────────────────────────────
# Se escribe ANTES del primer `docker service update`: aunque el script muera
# con SIGKILL, en disco queda cuál era la imagen buena.
state_write() {  # state_write <status> [finished_at] [note]
  local status="$1" finished="${2:-}" note="${3:-}" svc_json="" svc
  for svc in "${SERVICES[@]}"; do
    svc_json="$svc_json${svc_json:+,}\"$svc\""
  done
  mkdir -p "$STATE_DIR"
  cat >"$STATE_FILE" <<JSON
{
  "from_tag": "$FROM_TAG",
  "to_tag": "$TO_TAG",
  "services": [$svc_json],
  "sha": "$SHA",
  "backup": "$BACKUP_FILE",
  "migrate": $([ "$MIGRATE" = 1 ] && echo true || echo false),
  "started_at": "$STARTED_AT",
  "finished_at": "$finished",
  "status": "$status",
  "note": "$note"
}
JSON
}

json_get() {  # json_get <archivo> <clave>  -> string ("" si no está)
  local f="$1" k="$2" v=""
  [ -f "$f" ] || return 0
  if command -v jq >/dev/null 2>&1; then
    v="$(jq -r --arg k "$k" '.[$k] // "" | tostring' "$f" 2>/dev/null || true)"
  fi
  if [ -z "$v" ]; then
    v="$(sed -n "s/.*\"$k\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$f" 2>/dev/null | head -n1 || true)"
  fi
  printf '%s' "$v"
}

rollback_target() {
  local t
  t="$(json_get "$STATE_FILE" from_tag || true)"
  printf '%s' "$t"
}

last_run_status() {
  local s
  s="$(json_get "$STATE_FILE" status || true)"
  printf '%s' "$s"
}

# ── 7. log append-only ──────────────────────────────────────────────────────
# docs/deploy-log.md se commitea, así que este append deja el working tree
# sucio. Por eso el chequeo de árbol limpio de git lo excluye (ver git_preflight).
log_result() {  # log_result <OK|FALLO> <detalle>
  local result="$1" detail="$2" revertidos="ninguno"
  if [ "$ROLLBACK_DONE" = 1 ] && [ "${#DEPLOYED[@]}" -gt 0 ]; then
    revertidos="$(printf '%s ' "${DEPLOYED[@]}")"
  fi
  mkdir -p "$(dirname "$DEPLOY_LOG")" 2>/dev/null || true
  {
    printf '\n## %s — deploy %s → %s — %s\n\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${FROM_TAG:-?}" "$TO_TAG" "$result"
    printf -- '- SHA: `%s`\n' "${SHA:-?}"
    printf -- '- migrate: %s\n' "$([ "$MIGRATE" = 1 ] && echo sí || echo no)"
    printf -- '- servicios tocados: %s\n' "$revertidos"
    printf -- '- backup previo: %s\n' "${BACKUP_FILE:-n/a}"
    printf -- '- detalle: %s\n' "$detail"
  } >>"$DEPLOY_LOG" 2>/dev/null || warn "no pude escribir en $DEPLOY_LOG"
}

# ── 8. sondeos de docker ────────────────────────────────────────────────────
svc_replicas() {  # "1/1" (o "" si el servicio no existe)
  local svc="$1" line
  line="$(dr service ls --filter "name=$svc" --format '{{.Name}} {{.Replicas}}' 2>/dev/null \
    | awk -v s="$svc" '$1==s {print $2; exit}' || true)"
  printf '%s' "$line"
}

svc_update_state() {  # "paused" | "completed" | "none" (UpdateStatus nil-safe)
  local svc="$1" st
  st="$(dr service inspect "$svc" \
    --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{else}}none{{end}}' 2>/dev/null || true)"
  printf '%s' "${st:-none}"
}

svc_image() {  # imagen del spec (la pedida), no la que quedó corriendo
  dr service inspect "$1" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true
}

backend_cid() {  # un (1) SOLO id
  # `name=crm_backend` sin el `.1` devuelve TODOS los contenedores del servicio
  # durante un rolling update: `docker exec` con varios args revienta. El patrón
  # correcto es el de la task: crm_backend.1 (punto escapado, el filtro es regex).
  local cids arr=()
  cids="$(dr ps -q --filter 'name=crm_backend\.1' 2>/dev/null || true)"
  read -r -a arr <<<"$cids"
  if [ "${#arr[@]}" -ne 1 ]; then
    err "no pude resolver 1 y solo 1 contenedor de crm_backend.1 (encontrados ${#arr[@]})"
    return 1
  fi
  printf '%s' "${arr[0]}"
}

ping_site() {  # ping_site <url> -> "código|body"
  local url="$1" raw code body
  raw="$(curl -sS --max-time "$CURL_MAX_TIME" -w $'\n%{http_code}' "$url" 2>&1 || true)"
  code="${raw##*$'\n'}"
  body="${raw%$'\n'*}"
  printf '%s|%s' "$code" "$body"
}

newest_backup() {  # nombre del .sql.gz más nuevo dentro del contenedor backend
  local cid
  cid="$(backend_cid)" || return 1
  dr exec "$cid" bash -c \
    "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*.sql.gz 2>/dev/null | head -n1" \
    2>/dev/null || true
}

# ── 9. preflight ────────────────────────────────────────────────────────────
# Se corre en contexto `||`, así que NO puede apoyarse en `set -e`: cada check
# devuelve 0/1 explícito.
check_disk() {
  if [ ! -d "$DOCKER_DIR" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      say "  disco: $DOCKER_DIR no existe acá; en el VPS se mide con: df -Pk $DOCKER_DIR"
      return 0
    fi
    err "  disco: $DOCKER_DIR no existe (DOCKER_DIR mal seteado?)"
    return 1
  fi
  local kb gb
  kb="$(df -Pk "$DOCKER_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  case "$kb" in
    ''|*[!0-9]*) err "  disco: no pude leer el espacio libre de $DOCKER_DIR"; return 1 ;;
  esac
  gb=$((kb / 1024 / 1024))
  if [ "$kb" -lt $((MIN_FREE_GB * 1024 * 1024)) ]; then
    err "  disco: solo ${gb}GB libres en $DOCKER_DIR (mínimo ${MIN_FREE_GB}GB). Liberá y reintentá."
    return 1
  fi
  ok "disco: ${gb}GB libres en $DOCKER_DIR (mínimo ${MIN_FREE_GB}GB)"
}

check_ping() {
  local r code body
  r="$(ping_site "$HEALTH_URL" || true)"
  code="${r%%|*}"
  body="${r#*|}"
  if [ "$code" != "200" ] || [ "${body#*pong}" = "$body" ]; then
    err "  salud: $HEALTH_URL -> HTTP $code, body='${body:0:200}'"
    err "  el sitio YA estaba roto: NO se despliega sobre nada. Arreglalo primero."
    if [ "$code" = "000" ]; then err "  (000 = sin respuesta en ${CURL_MAX_TIME}s: nginx/Traefik o red)"; fi
    return 1
  fi
  ok "salud: $HEALTH_URL -> 200 pong"
}

check_replicas() {
  local svc rep bad=0
  for svc in "${SERVICES[@]}"; do
    rep="$(svc_replicas "$svc" || true)"
    if [ "$rep" != "$REPLICAS_ESPERADAS" ]; then
      err "  $svc está en '${rep:-desconocido}' (esperado $REPLICAS_ESPERADAS)"
      bad=1
    else
      ok "$svc $rep"
    fi
  done
  if [ "$bad" != 0 ]; then
    err "  el stack ya estaba incompleto. Un deploy encima de eso no se puede revertir:"
    err "  el rollback solo sabe volver a la IMAGEN, no a un servicio que ya estaba caído."
    err "  Revisá: docker service ps <svc> --no-trunc"
  fi
  return "$bad"
}

check_not_paused() {
  local svc st bad=0
  for svc in "${SERVICES[@]}"; do
    st="$(svc_update_state "$svc" || true)"
    if [ "$st" = "paused" ]; then
      err "  $svc tiene el update PAUSADO (UpdateConfig: stop-first / pause / max_failure_ratio=0)"
      err "     cómo destrabarlo:"
      err "       docker service update --update-failure-action continue $svc"
      err "       (después volvés a la imagen buena con --force --update-order start-first)"
      err "     NO uses 'docker service update $svc' pelado: no cambia el spec, reinicia el"
      err "     update y pisa PreviousSpec con CurrentSpec, con lo cual se pierde la"
      err "     posibilidad de 'docker service update --rollback' (moby#37693)."
      bad=1
    elif [ "$st" = "updating" ]; then
      warn "  $svc tiene un update 'updating' en curso; otro deploy encima se pisa"
    else
      ok "$svc update=${st:-none}"
    fi
  done
  return "$bad"
}

preflight() {
  say "PREFLIGHT"
  check_disk        || return 1
  check_ping        || return 1
  check_replicas    || return 1
  check_not_paused  || return 1
  local st
  st="$(last_run_status || true)"
  if [ "$st" = "in_progress" ]; then
    warn "la corrida anterior ($STATE_FILE) quedó 'in_progress': hubo un deploy cortado."
    warn "si el stack está sano, la imagen buena es la de ahora (ya verificada arriba)."
  fi
  return 0
}

# ── 10. convergencia ────────────────────────────────────────────────────────
wait_converged() {  # wait_converged <svc> <timeout_s> ; 0 = 1/1
  local svc="$1" timeout="$2" waited=0 state rep ustate
  while :; do
    if fault converge "$svc"; then
      err "  $svc: no converge (fallo inyectado)"
      return 1
    fi
    ustate="$(svc_update_state "$svc" || true)"
    if [ "$ustate" = "paused" ]; then
      err "  $svc: el update quedó PAUSADO (el task nuevo murió). Destrabá con:"
      err "     docker service update --update-failure-action continue $svc"
      return 1
    fi
    state="$(dr service ps "$svc" --format '{{.CurrentState}}' 2>/dev/null | head -n1 || true)"
    rep="$(svc_replicas "$svc" || true)"
    # Corte temprano: no tiene sentido esperar el timeout si el task ya murió.
    case "$state" in
      Failed*|Rejected*)
        err "  $svc: task en estado '$state' (no va a converger)"
        return 1
        ;;
    esac
    if [ "$rep" = "$REPLICAS_ESPERADAS" ]; then
      ok "$svc $rep (último estado del task: ${state:-?})"
      return 0
    fi
    if [ "$waited" -ge "$timeout" ]; then
      err "  $svc: no convergió en ${timeout}s (réplicas='${rep:-?}', task='${state:-?}')"
      err "     logs: docker service logs $svc --tail 80 --timestamps"
      return 1
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
}

wait_all_converged() {  # <timeout> <servicios...>
  local timeout="$1"; shift
  local svc bad=0
  for svc in "$@"; do
    say "  esperando ${svc}…"
    wait_converged "$svc" "$timeout" || bad=1
  done
  return "$bad"
}

# ── 11. maintenance mode ────────────────────────────────────────────────────
# Si queda prendido, TODOS los usuarios ven "down for maintenance": es una
# caída igual de visible que la que estamos tratando de evitar.
set_maintenance() {  # on|off
  local mode="$1" cid
  if fault migrate "maintenance-$mode"; then
    warn "  (fallo inyectado al poner maintenance $mode)"
    return 0
  fi
  cid="$(backend_cid)" || return 1
  run_write docker exec "$cid" bench --site "$SITE" set-maintenance-mode "$mode"
}
clear_maintenance() {
  [ "$MAINT" = 1 ] || return 0
  MAINT=0
  if set_maintenance off; then
    ok "maintenance mode OFF"
  else
    err "!!! no pude quitar el maintenance mode. SiteUpdater en 'down for maintenance'."
    err "!!! manual: docker exec $(docker ps -qf 'name=crm_backend\.1' | head -n1) bench --site $SITE set-maintenance-mode off"
    return 1
  fi
}

# ── 12. migrate ─────────────────────────────────────────────────────────────
run_migrate() {
  local before after state="" waited=0 cid
  say "migrate (imagen $TO_TAG, servicio descartable, con maintenance mode)…"

  # La imagen buena ya está persistida: si esto sale mal no se toca ningún
  # servicio, así que no hay rollback que hacer (y no se inventa uno).
  MAINT=1
  set_maintenance on || abort_now "no pude activar el maintenance mode; no sigo con el migrate"

  # El backup es la red: `bench migrate` NO es transaccional. Si muere a mitad,
  # el schema queda A MEDIAS y la única salida es restaurar este archivo.
  local previous_backup
  previous_backup="$(newest_backup || true)"
  say "  bench backup (pre-migrate)…"
  if fault backup; then
    err "  bench backup: fallo inyectado"
  else
    if [ "$DRY_RUN" = 1 ]; then
      say "[dry-run] docker exec <backend> bench --site $SITE backup"
    else
      cid="$(backend_cid)" || abort_now "no pude resolver el contenedor del backend para el backup"
      dr exec "$cid" bench --site "$SITE" backup >/dev/null \
        || abort_now "falló el backup previo; no sigo (sin red para un migrate)"
    fi
  fi
  BACKUP_FILE="$(newest_backup || true)"
  if [ -n "$BACKUP_FILE" ] && [ "$BACKUP_FILE" = "${previous_backup:-}" ]; then
    abort_now "el backup no creó un archivo nuevo (sigue $BACKUP_FILE); no sigo con el migrate"
  fi
  if [ -n "$BACKUP_FILE" ]; then ok "  backup: $BACKUP_FILE"; fi

  run_quiet docker service rm "$MIGRATE_SVC" || true
  # `--limit-memory`: el nodo tiene 3.8GB con swap en uso. Sin tope, este
  # servicio puede empujar al backend a OOM y matar el sitio entero.
  run_write docker service create \
    --name "$MIGRATE_SVC" \
    --network "$MIGRATE_NET" \
    --restart-condition none \
    --limit-memory "$MIGRATE_MEM_LIMIT" \
    --mount "type=volume,source=crm_sites,target=/home/frappe/frappe-bench/sites" \
    --mount "type=volume,source=crm_logs,target=/home/frappe/frappe-bench/logs" \
    "$TO_TAG" bench --site "$SITE" migrate

  # `docker service create --detach=false` no vuelve nunca con
  # `restart-condition none` (el servicio no converge): hay que esperar el estado
  # del task a mano.
  while :; do
    if fault migrate; then
      err "  migrate: fallo inyectado (el estado nunca es terminal)"
      break
    fi
    state="$(dr service ps "$MIGRATE_SVC" --format '{{.CurrentState}}' 2>/dev/null | head -n1 || true)"
    case "$state" in
      Complete*|Failed*|Rejected*) break ;;
    esac
    if [ "$waited" -ge "$MIGRATE_TIMEOUT" ]; then
      err "  migrate: '${state:-?}' después de ${MIGRATE_TIMEOUT}s"
      break
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done

  run_write_show docker service logs "$MIGRATE_SVC" 2>&1 | tail -n 30 || true
  run_quiet docker service rm "$MIGRATE_SVC" || true

  case "$state" in
    Complete*)
      MIGRATED=1
      ok "  migrate OK (schema cambiado)"
      ;;
    *)
      clear_maintenance || true
      err "FALLO el migrate (estado: ${state:-timeout})."
      err "bench migrate NO es transaccional: el schema puede haber quedado A MEDIAS."
      err "no se toca ningún servicio. Para volver atrás:"
      err "  bench --site $SITE restore ${BACKUP_FILE:-<backup previo en private/backups>}"
      err "  bench --site $SITE migrate && bench --site $SITE clear-cache"
      err "  (scripts/backup/restore-gdrive.sh si hay que bajar el backup de Drive)"
      return 1
      ;;
  esac

  clear_maintenance || true
}

# Check del migrate. Contar DocTypes de `MbCRM` NO prueba nada: los 18 propios
# están archivados en _archived_doctypes/ (chocan con los built-in de FCRM) y
# el app lee Custom Fields sobre DocTypes del app `crm`/`frappe`.
# Lo que el API lee de verdad es `Event.custom_crm_categoria` (ver
# apps/crm_core/crm_core/api.py y patches.py), o sea la COLUMNA
# `tabEvent.custom_crm_categoria` más el Custom Field que la crea.
check_migrate_schema() {
  local cid out
  cid="$(backend_cid)" || return 1
  out="$(dr exec -i -e CRM_DEPLOY_SITE="$SITE" "$cid" bash -s <<'PY' 2>&1 || true
set -u
cd /home/frappe/frappe-bench/sites || exit 1
../env/bin/python - <<'PYEOF'
import os
import frappe

site = os.environ["CRM_DEPLOY_SITE"]
frappe.init(site=site, sites_path=".")
frappe.connect()
try:
    rows = frappe.db.sql(
        "SHOW COLUMNS FROM `tabEvent` LIKE %s", ("custom_crm_categoria",)
    )
    # OJO: `Custom Field` NO tiene columna `disabled` en Frappe v15. Pedirla
    # levanta un OperationalError (1054), el `frappe.get_all` no devuelve nada y
    # este check concluía que el schema estaba mal SIEMPRE: bloqueaba todo deploy
    # con --migrate. La señal de "el campo está vivo" es que el registro exista
    # (un Custom Field deshabilitado no existe; se borra).
    cfs = frappe.get_all(
        "Custom Field",
        filters={"dt": "Event", "fieldname": "custom_crm_categoria"},
        fields=["name"],
        ignore_permissions=True,
    )
    col = "si" if rows else "no"
    cf = "si" if cfs else "no"
    print("MIGRATE_CHECK columna=%s custom_field=%s" % (col, cf))
finally:
    frappe.destroy()
PYEOF
PY
)"
  printf '%s %s\n' "$(date -u +%H:%M:%S)" "$(printf '%s' "$out" | tr '\n' ' ' | sed 's/  */ /g')"
  if printf '%s' "$out" | grep -q 'MIGRATE_CHECK columna=si custom_field=si'; then
    return 0
  fi
  err "el schema NO quedó como el API lo espera (esperaba columna=si custom_field=si)"
  err "el migrate dijo Complete pero el API no va a poder leer Event.custom_crm_categoria"
  return 1
}

# ── 13. verificación post-deploy ─────────────────────────────────────────────
# Compara la imagen REALMENTE corriendo contra la pedida. `Replicas 1/1` solo
# dice que hay una task viva: si el update se aplicó a medias, 1/1 con la imagen
# vieja es un deploy que no pasó.
verify_running_image() {
  local svc img bad=0
  for svc in "${SERVICES[@]}"; do
    if fault image "$svc"; then
      err "  $svc: imagen incorrecta (fallo inyectado)"
      bad=1
      continue
    fi
    img="$(svc_image "$svc" || true)"
    if [ "$img" = "$TO_TAG" ]; then
      ok "$svc corre $img"
    else
      err "$svc corre '${img:-?}', se pidió $TO_TAG"
      bad=1
    fi
  done
  return "$bad"
}

verify_http() {
  local r code body
  if fault http; then
    err "  $HEALTH_URL: fallo inyectado"
    return 1
  fi
  r="$(ping_site "$HEALTH_URL" || true)"
  code="${r%%|*}"
  body="${r#*|}"
  # /hoy NO se usa: sin sesión responde 301 a /login siempre, esté sano o no.
  # ping sí: 200 + {"message":"pong"} prueba gunicorn + la DB.
  if [ "$code" = "200" ] && [ "${body#*pong}" != "$body" ]; then
    ok "$HEALTH_URL -> 200 pong"
    local diag
    diag="$(curl -sS --max-time "$CURL_MAX_TIME" -o /dev/null -w '%{http_code}' "$DIAG_URL" 2>&1 || true)"
    say "  (diagnóstico, NO es health check: $DIAG_URL -> ${diag:-?} — sin sesión da 301 a /login siempre)"
    return 0
  fi
  err "$HEALTH_URL -> HTTP ${code:-000}, body='${body:0:200}'"
  err "  si ${CURL_MAX_TIME}s no alcanza, el backend no está levantando: docker service logs crm_backend --tail 80"
  return 1
}

# ── 14. rollback ────────────────────────────────────────────────────────────
# Revierte SOLO los servicios que este deploy tocó, en orden inverso al deploy.
# `--force` + `set +e`: un servicio roto no puede abortar la reversión de los
# demás (con el `set -e` del script, el primer fallo dejaba el stack a medias
# otra vez, que es el bug que esto arregla).
do_rollback() {
  [ "$ROLLBACK_DONE" = 1 ] && return 0
  ROLLBACK_DONE=1
  local target svc i ustate
  local -a no=()

  target="$(rollback_target || true)"
  if [ -z "$target" ]; then
    err "no sé a qué imagen volver ($STATE_FILE no tiene from_tag)."
    err "revertí a mano, servicio por servicio:"
    for svc in "${DEPLOYED[@]}"; do
      err "  docker service update --force --update-order start-first --update-parallelism 1 --image $IMAGE_PREFIX:<imagen-buena> $svc"
    done
    return 1
  fi

  say "REVIRTIENDO a $target (imagen buena persistida en $STATE_FILE, NO el estado vivo)"
  # `set +e` explícito: un servicio que no se puede revertir NO puede abortar la
  # reversión de los demás. Con el `set -e` del script, el primer fallo dejaba el
  # stack a medias otra vez (que es el bug que esto arregla).
  set +e
  for ((i = ${#DEPLOYED[@]} - 1; i >= 0; i--)); do
    svc="${DEPLOYED[$i]}"
    # Un servicio con el update PAUSADO rechaza `service update` con
    # "service update paused". Hay que sacarle el pause primero: la forma
    # soportada es pasar failure_action a continue (un `docker service update`
    # pelado no cambia el spec y además pisa PreviousSpec, moby#37693).
    ustate="$(svc_update_state "$svc" || true)"
    if [ "$ustate" = "paused" ]; then
      warn "  $svc tiene el update pausado; lo destrabo antes de revertir"
      run_quiet docker service update --update-failure-action continue "$svc"
    fi
    if fault rollback "$svc"; then
      err "  $svc -> $target: fallo inyectado"
      no+=("$svc")
      continue
    fi
    if run_write docker service update --force --update-order start-first \
        --update-parallelism 1 --image "$target" "$svc"; then
      ok "$svc -> $target"
    else
      err "$svc -> $target: la reversión falló"
      no+=("$svc")
    fi
  done

  # Esperar a que los revertidos convergieran, best effort y sin abortar.
  for ((i = ${#DEPLOYED[@]} - 1; i >= 0; i--)); do
    svc="${DEPLOYED[$i]}"
    case " ${no[*]-} " in *" $svc "*) continue ;; esac
    wait_converged "$svc" "$ROLLBACK_TIMEOUT" || true
  done
  case $- in *e*) set -e ;; esac

  if [ "${#no[@]}" -gt 0 ]; then
    err "NO se pudieron revertir: ${no[*]}"
    err "  el stack quedó MIXTO. Para cada uno:"
    for svc in "${no[@]}"; do
      err "    docker service update --force --update-order start-first --update-parallelism 1 --image $target $svc"
    done
  else
    ok "revertidos ${#DEPLOYED[@]} servicios a $target"
  fi

  if [ "$MIGRATED" = 1 ]; then
    err "OJO: este deploy CORRIÓ migrate. La imagen volvió atrás, el SCHEMA no:"
    err "  bench migrate no es transaccional, no hay 'downgrade'."
    err "  si el migrate fue lo que rompió, restaurá el backup previo:"
    err "    bench --site $SITE restore ${BACKUP_FILE:-<el de private/backups>}"
    err "    bench --site $SITE migrate && bench --site $SITE clear-cache"
  fi
  return 0
}

clear_cache() {
  local cid
  if fault clear-cache; then
    warn "  (clear-cache: fallo inyectado)"
    return 0
  fi
  cid="$(backend_cid)" || return 1
  # Los hooks de apps quedan cacheados en Redis y no se refrescan solos al
  # reiniciar el contenedor: sin esto, /hoy sirve el bundle viejo.
  run_write docker exec "$cid" bench --site "$SITE" clear-cache || return 1
  ok "clear-cache OK"
}

# ── 15. failure handling ────────────────────────────────────────────────────
finish_failure() {  # finish_failure <razón>
  local reason="$1"
  clear_maintenance || true
  if [ "${#DEPLOYED[@]}" -eq 0 ]; then
    # El punto clave: si el fallo fue antes de tocar Swarm, NO hay rollback.
    # Revertir acá sería inventar un cambio sobre un deploy que no ocurrió.
    warn "no se tocó Swarm en la fase '$PHASE': NO hay nada que revertir."
    warn "  (si esperabas un revert, el fallo fue antes del primer service update)"
    log_result "FALLO" "$reason — sin cambios en Swarm"
    return 0
  fi
  do_rollback || true
  log_result "FALLO" "$reason — revertido a ${FROM_TAG:-?}"
}

# Abortar desde adentro de una fase del deploy dejando rastro: log + lock limpio.
# `die` no sirve acá (no loguea nada y deja el .deploy/last.json en in_progress).
abort_now() {  # abort_now <mensaje>
  err "$1"
  trap - ERR
  finish_failure "$1"
  release_lock
  exit 1
}

on_err() {
  local rc=$? line="${1:-?}"
  trap - ERR INT TERM
  err "FALLO (rc=$rc) en la fase '$PHASE' (línea $line)"
  finish_failure "$PHASE (rc=$rc)"
  release_lock
  exit 1
}
trap 'on_err $LINENO' ERR
trap 'err "interrumpido"; trap - ERR; finish_failure "interrumpido"; release_lock; exit 130' INT
trap 'err "terminado por SIGTERM"; trap - ERR; finish_failure "SIGTERM"; release_lock; exit 143' TERM
trap 'release_lock' EXIT

# ── 16. flujo ───────────────────────────────────────────────────────────────
git_preflight() {
  local dirty
  # docs/deploy-log.md se commitea y este script le anexa una línea por deploy,
  # así que queda sucio por diseño: excluirlo o el segundo deploy nunca pasa.
  dirty="$(run_read git status --porcelain -- . ':!docs/deploy-log.md' 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    err "el working tree tiene cambios sin commitear; no se puede saber qué se despliega:"
    printf '%s\n' "$dirty" >&2
    err "commitealos o stashéalos, y reintentá."
    if [ "$DRY_RUN" = 1 ]; then
      warn "dry-run: sigo igual (esto abortaría el deploy real)"
      return 0
    fi
    return 1
  fi
  ok "árbol de trabajo limpio (docs/deploy-log.md excluido a propósito)"
}

main() {
  PHASE="lock"
  cd "$REPO_DIR" || die "no existe el repo en REPO_DIR=$REPO_DIR"
  acquire_lock || die "otro deploy está corriendo; no se pisan"
  ok "lock tomado ($LOCK_MODE), repo=$REPO_DIR"

  PHASE="preflight"
  preflight || { trap - ERR; finish_failure "preflight fallido"; release_lock; exit 1; }

  PHASE="git"
  git_preflight || return 1
  if [ "$DRY_RUN" = 1 ]; then
    warn "dry-run: NO hago fetch ni merge. El build real usa el SHA de abajo."
  else
    run_write git fetch --quiet origin
    local up
    up="$(run_read git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
    [ -n "$up" ] || abort_now "la rama actual no tiene upstream; fijalo a mano antes de deployear"
    run_write git merge --ff-only "$up"
  fi
  SHA="$(run_read git rev-parse HEAD 2>/dev/null || true)"
  [ -n "$SHA" ] || abort_now "no pude resolver el SHA que se va a construir"
  ok "código a despleñar: ${SHA:0:12} (rama $(run_read git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"

  PHASE="descubrimiento de la imagen actual"
  FROM_TAG="$(dr service inspect "${SERVICES[0]}" \
    --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
  case "$FROM_TAG" in
    "$IMAGE_PREFIX":*) : ;;
    *) abort_now "no pude leer la imagen en uso de ${SERVICES[0]} (obtuve: '${FROM_TAG:-?}')" ;;
  esac
  say "imagen en uso (base del build): $FROM_TAG"
  if [ "$TO_TAG" = "$FROM_TAG" ]; then abort_now "$TO_TAG ya es la imagen en uso; elegí un tag nuevo"; fi
  if [ "$DRY_RUN" = 1 ]; then
    run_read docker image inspect "$FROM_TAG" >/dev/null 2>&1 \
      || warn "dry-run: la imagen base $FROM_TAG no está en este host (en el VPS está)"
  else
    run_read docker image inspect "$FROM_TAG" >/dev/null 2>&1 \
      || abort_now "no existe la imagen base $FROM_TAG en el host (Dokploy la podó?)"
  fi

  # ── acá abajo empieza la transacción: cualquier fallo después dispara rollback ──
  PHASE="build"
  if fault build; then
    err "build: fallo inyectado"
    return 1
  fi
  say "construyendo $TO_TAG (base $FROM_TAG)…"
  # run_write_show (no run_write): si el build falla hay que VER POR QUÉ. Un
  # `docker build … >/dev/null` con `set -e` mata el deploy sin decir nada, que
  # es medio incidente del mismo.
  run_write_show docker build --no-cache \
    --build-arg "BASE=$FROM_TAG" \
    --label "org.opencontainers.image.revision=$SHA" \
    --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -f docker/Dockerfile.crm-mb -t "$TO_TAG" .
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] no se compiló nada; el build real lleva el revision $SHA"
  else
    ok "$TO_TAG construida (revision $SHA)"
  fi

  if [ "$MIGRATE" = 1 ]; then
    PHASE="migrate"
    run_migrate || return 1
  fi

  PHASE="persistencia del estado"
  state_write "in_progress" "" "despliegue en curso"

  PHASE="actualización de servicios"
  local svc
  for svc in "${SERVICES[@]}"; do
    PHASE="actualización de $svc"
    if fault update "$svc"; then
      err "  $svc: fallo inyectado en 'docker service update'"
      return 1
    fi
    # start-first: con replicas=1, stop-first deja el sitio en 502 en CADA
    # deploy y deja el servicio en 0/1 si el task nuevo muere. Es exactamente la
    # causa del incidente de crm_worker. parallelism 1 = un task a la vez.
    run_write docker service update --update-order start-first --update-parallelism 1 \
      --image "$TO_TAG" "$svc"
    DEPLOYED+=("$svc")
    say "  $svc -> $TO_TAG"
  done

  PHASE="convergencia"
  wait_all_converged "$CONVERGE_TIMEOUT" "${SERVICES[@]}" || return 1

  PHASE="verificación de imagen"
  verify_running_image || return 1

  if [ "$MIGRATE" = 1 ]; then
    PHASE="verificación del schema"
    check_migrate_schema || return 1
  fi

  PHASE="verificación HTTP"
  verify_http || return 1

  PHASE="clear-cache"
  clear_cache || return 1

  PHASE="cierre"
  state_write "ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "desplegado y verificado"
  log_result "OK" "imagen $TO_TAG verificada en los 5 servicios, ping 200 pong"
  ok "DEPLOY OK: $TO_TAG"
  say "resumí/reviví el sitio con el flujo de /hoy: node scripts/e2e_hoy.mjs (Playwright, browser real)"
  return 0
}

main "$@"
