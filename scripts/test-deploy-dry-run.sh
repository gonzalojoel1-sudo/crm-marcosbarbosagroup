#!/usr/bin/env bash
# Test del flujo de deploy de scripts/deploy-crm.sh SIN Docker, sin red y sin
# tocar ningún ambiente.
#
# Qué prueba:
#   1. que el rollback se dispare SOLO cuando el fallo pasó de tocar Swarm;
#   2. que revierta SOLO los servicios ya tocados, con --force, en orden inverso;
#   3. que use la imagen buena PERSISTIDA (.deploy/last.json), no el estado vivo;
#   4. que NO haya rollback en falso si el fallo fue antes del primer
#      `docker service update` (build, preflight, árbol sucio, migrate).
#
# Cómo: `deploy-crm.sh --dry-run` imprime todo comando que muta el host o el
# stack y NO los ejecuta, pero sí ejecuta los sondeos de solo lectura. En este
# test esos sondeos los atienden stubs de `docker` y `curl` que están primero en
# el PATH, así que cada rama de fallo se provoca desde el entorno:
#
#   STUB_REPL="crm_scheduler=0/1"   -> preflight ve el stack incompleto
#   STUB_UPDATE="crm_worker=paused" -> preflight ve un update pausado
#   STUB_PING_CODE=503              -> preflight ve el sitio caído
#   STUB_BACKUP_SAME=1              -> el backup "no creó archivo nuevo"
#   DEPLOY_FAULT=<fase>[:<svc>]     -> falla esa fase (seam documentado en el
#                                       script; en dry-run es la única forma de
#                                       simular el fallo de un comando que no
#                                       se ejecuta)
#
# Uso: bash scripts/test-deploy-dry-run.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="${SCRIPT_DIR}/deploy-crm.sh"
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/crm-deploy-test.XXXXXX")"
STUB_DIR="$TMPROOT/stub"
REPO="$TMPROOT/repo"
PASS=0
FAIL=0
CURRENT_CASE=""

cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

# ── stubs ───────────────────────────────────────────────────────────────────
make_stub_docker() {
  cat >"$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
# Stub de docker: responde a los sondeos de solo lectura del deploy script.
# Todo lo que MUTA (build/service update/create/rm/exec) nunca llega acá en
# --dry-run; si llegara, el stub lo registra y devuelve error, para que el test
# falle si el deploy intenta algo de verdad.
set -u
printf '%s\n' "docker $*" >>"$STUB_LOG"
case " $* " in
  *" MUTATED "*) ;;
esac

# "svc=valor" separado por comas
lookup() {  # lookup VAR_NAME svc
  local list="${!1:-}" item
  local IFS=','
  for item in $list; do
    case "$item" in
      "$2="*) printf '%s' "${item#*=}"; return 0 ;;
    esac
  done
  printf ''
}

bump() {  # bump <clave> -> contador incremental
  local f="${STUB_DIR}/count.$1" n=0
  [ -f "$f" ] && n="$(cat "$f")"
  n=$((n + 1))
  printf '%s' "$n" >"$f"
  printf '%s' "$n"
}

svc_of() {  # nombre del servicio, salteando subcomando y flags
  local a
  for a in "$@"; do
    case "$a" in
      -*) continue ;;
      service|inspect|ls|ps|rm|create|update|logs) continue ;;
      *) printf '%s' "$a"; return 0 ;;
    esac
  done
}

filter_svc() {  # valor de --filter name=<svc>
  local a
  for a in "$@"; do
    case "$a" in
      name=*) printf '%s' "${a#name=}"; return 0 ;;
    esac
  done
  printf ''
}

case "${1:-}" in
  service)
    case "${2:-}" in
      ls)
        svc="$(filter_svc "$@")"
        rep="$(lookup STUB_REPL "$svc")"
        printf '%s %s\n' "$svc" "${rep:-1/1}"
        exit 0
        ;;
      inspect)
        svc="$(svc_of "$@")"
        if printf '%s ' "$@" | grep -q ContainerSpec.Image; then
          # contador GLOBAL: la 1ra llamada es el descubrimiento de la imagen en
          # uso (FROM), todas las siguientes son la verificación post-deploy.
          n="$(bump img)"
          if [ "$n" = 1 ]; then
            printf '%s\n' "${STUB_IMAGE_BEFORE:-crm-mb:20}"
          else
            printf '%s\n' "${STUB_IMAGE_AFTER:-crm-mb:21}"
          fi
          exit 0
        fi
        if printf '%s ' "$@" | grep -q UpdateStatus; then
          st="$(lookup STUB_UPDATE "$svc")"
          printf '%s\n' "${st:-completed}"
          exit 0
        fi
        printf '{}\n'
        exit 0
        ;;
      ps)
        svc="$(svc_of "$@")"
        if [ "$svc" = "${STUB_MIGRATE_SVC:-crm_migrate_tmp}" ]; then
          printf '%s\n' "${STUB_MIGRATE_STATE:-Complete 4 seconds ago}"
          exit 0
        fi
        printf '%s\n' "${STUB_TASK_STATE:-Running 7 seconds ago}"
        exit 0
        ;;
      *)
        printf 'STUB ERROR: el deploy intentó MUTAR el servicio: docker %s\n' "$*" >&2
        exit 97
        ;;
    esac
    ;;
  ps)
    printf '%s\n' "${STUB_BACKEND_CID:-deadbeefcafe}"
    exit 0
    ;;
  exec)
    if printf '%s ' "$@" | grep -q 'private/backups'; then
      n="$(bump backups)"
      if [ "${STUB_BACKUP_SAME:-}" = 1 ]; then
        printf '%s\n' "${STUB_BACKUP_BEFORE:-20260901_030000-crm.sql.gz}"
      elif [ "$n" = 1 ]; then
        printf '%s\n' "${STUB_BACKUP_BEFORE:-20260901_030000-crm.sql.gz}"
      else
        printf '%s\n' "${STUB_BACKUP_AFTER:-20260926_101500-crm.sql.gz}"
      fi
      exit 0
    fi
    # check del schema post-migrate
    printf '%s\n' "${STUB_MIGRATE_CHECK:-MIGRATE_CHECK columna=si custom_field=si}"
    exit 0
    ;;
  image)
    exit 0
    ;;
  build)
    printf 'STUB ERROR: el deploy intentó construir una imagen en dry-run\n' >&2
    exit 97
    ;;
  *)
    printf 'STUB ERROR: comando no soportado: docker %s\n' "$*" >&2
    exit 97
    ;;
esac
STUB
  chmod +x "$STUB_DIR/docker"
}

make_stub_curl() {
  cat >"$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
# Stub de curl: /api/method/ping devuelve lo que marque el entorno, /hoy siempre
# 301 (que es justo por lo que NO sirve como health check).
set -u
url=""
for a in "$@"; do
  case "$a" in
    http*) url="$a" ;;
  esac
done
printf '%s\n' "curl $url" >>"$STUB_LOG"
case "$url" in
  *"/api/method/ping"*)
    if [ -z "${STUB_PING_BODY:-}" ]; then
      body='{"message":"pong"}'
    else
      body="$STUB_PING_BODY"
    fi
    code="${STUB_PING_CODE:-200}"
    ;;
  *)
    # /hoy sin sesión: 301 a /login, esté sano o no
    body=""
    code="${STUB_DIAG_CODE:-301}"
    ;;
esac
if printf '%s ' "$@" | grep -q '%{http_code}'; then
  printf '%s\n%s\n' "$body" "$code"
else
  printf '%s\n' "$body"
fi
exit "${STUB_CURL_RC:-0}"
STUB
  chmod +x "$STUB_DIR/curl"
}

# ── harness ─────────────────────────────────────────────────────────────────
start_case() { CURRENT_CASE="$1"; printf '\n\033[1m── %s\033[0m\n' "$CURRENT_CASE"; }
ok_case()    { PASS=$((PASS + 1)); printf '   \033[32mPASA\033[0m  %s\n' "$1"; }
bad_case()   { FAIL=$((FAIL + 1)); printf '   \033[31mFALLA\033[0m %s\n' "$1"; }

assert_rc() {  # assert_rc <esperado> <obtenido> <msg>
  if [ "$1" = "$2" ]; then ok_case "$3 (rc=$2)"; else bad_case "$3: esperaba rc=$1, obtuvo rc=$2"; fi
}
assert_has() {  # assert_has <archivo> <patrón> <msg>
  if grep -qF -- "$2" "$1"; then ok_case "$3"; else bad_case "$3: no encontré '$2'"; fi
}
assert_hasnt() {
  if grep -qF -- "$2" "$1"; then bad_case "$3: encontré '$2' y no debía"; else ok_case "$3"; fi
}
assert_count() {  # assert_count <archivo> <patrón> <n> <msg>
  local c
  c="$(grep -cF -- "$2" "$1" || true)"
  if [ "$c" = "$3" ]; then ok_case "$4 ($c)"; else bad_case "$4: esperaba $3 coincidencias de '$2', hubo $c"; fi
}

# run <nombre> <args_extra...>   (siempre --dry-run)
run_deploy() {
  local name="$1"; shift
  CASE_DIR="$TMPROOT/$name"
  rm -rf "$CASE_DIR"
  mkdir -p "$CASE_DIR/docs" "$CASE_DIR/.deploy" "$CASE_DIR/stub"
  STUB_DIR="$CASE_DIR/stub"
  STUB_LOG="$CASE_DIR/stub.log"
  : >"$STUB_LOG"
  OUT="$CASE_DIR/out.txt"
  # el log y el estado son relativos a REPO_DIR: el repo es compartido por los
  # casos, así que se truncan en cada corrida y se afirman sobre el repo.
  LOG_MD="$REPO/docs/deploy-log.md"
  mkdir -p "$(dirname "$LOG_MD")"
  printf '# deploy log de prueba\n' >"$LOG_MD"
  rm -f "$REPO/.deploy/last.json"
  make_stub_docker
  make_stub_curl
  (
    cd "$REPO" || exit 99
    PATH="$STUB_DIR:$PATH" \
    STUB_DIR="$STUB_DIR" \
    STUB_LOG="$STUB_LOG" \
    STUB_REPL="${STUB_REPL:-}" \
    STUB_UPDATE="${STUB_UPDATE:-}" \
    STUB_PING_CODE="${STUB_PING_CODE:-200}" \
    STUB_PING_BODY="${STUB_PING_BODY:-}" \
    STUB_TASK_STATE="${STUB_TASK_STATE:-}" \
    STUB_IMAGE_BEFORE="${STUB_IMAGE_BEFORE:-crm-mb:20}" \
    STUB_IMAGE_AFTER="${STUB_IMAGE_AFTER:-crm-mb:21}" \
    STUB_MIGRATE_STATE="${STUB_MIGRATE_STATE:-Complete 4 seconds ago}" \
    DEPLOY_FAULT="${DEPLOY_FAULT:-}" \
    REPO_DIR="$REPO" \
    POLL_INTERVAL=0 \
    CONVERGE_TIMEOUT=2 \
    ROLLBACK_TIMEOUT=2 \
    MIGRATE_TIMEOUT=2 \
      bash "$DEPLOY" "$@" --dry-run
  ) >"$OUT" 2>&1
  RC=$?
  return 0
}

# líneas de actualización del deploy (no rollback)
deploy_update_line() { printf '[dry-run] docker service update --update-order start-first --update-parallelism 1 --image crm-mb:21 %s' "$1"; }
rollback_line()     { printf '[dry-run] docker service update --force --update-order start-first --update-parallelism 1 --image crm-mb:20 %s' "$1"; }
assert_rolled_back()   { assert_has "$OUT" "$(rollback_line "$1")" "revertido $1"; }
assert_not_rolled()    { assert_hasnt "$OUT" "$(rollback_line "$1")" "NO revirtió $1"; }

# ── preparación del repo de prueba ─────────────────────────────────────────
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q .
  git config user.email test@example.com
  git config user.name test
  printf 'x\n' >README.md
  mkdir -p docker
  printf 'FROM scratch\n' >docker/Dockerfile.crm-mb
  printf '.deploy/\n' >.gitignore
  git add -A
  git commit -qm "repo de prueba"
) || { echo "no pude armar el repo de prueba"; exit 1; }

echo "repo de prueba: $REPO"
echo "script bajo prueba: $DEPLOY"
[ -x "$DEPLOY" ] || chmod +x "$DEPLOY"

# ═══ 1. camino feliz ═══════════════════════════════════════════════════════
start_case "1. deploy sano: sale 0, actualiza los 5, log OK, sin rollback"
run_deploy ok 21
assert_rc 0 "$RC" "deploy sano"
for s in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  assert_has "$OUT" "$(deploy_update_line "$s")" "actualizó $s"
  assert_not_rolled "$s"
done
assert_has "$OUT" "DEPLOY OK: crm-mb:21" "anunció DEPLOY OK"
assert_has "$OUT" "clear-cache" "corrió clear-cache"
assert_has "$LOG_MD" "deploy crm-mb:20 → crm-mb:21 — OK" "logueó OK en deploy-log.md"
assert_has "$REPO/.deploy/last.json" '"from_tag": "crm-mb:20"' "persistió from_tag"
assert_has "$REPO/.deploy/last.json" '"status": "ok"' "persistió status ok"
assert_hasnt "$OUT" "REVIRTIENDO" "no revirtió nada"
assert_hasnt "$OUT" "STUB ERROR" "no intentó mutar nada de verdad"

# ═══ 2. fallo de build: SIN rollback ═══════════════════════════════════════
start_case "2. falla el build (antes de tocar Swarm): NO hay rollback"
DEPLOY_FAULT=build run_deploy build-fail 21
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
assert_hasnt "$OUT" "REVIRTIENDO" "no revirtió (bien: no se había tocado nada)"
assert_hasnt "$OUT" "docker service update" "no emitió ningún service update"
assert_has "$OUT" "no se tocó Swarm" "lo dijo explícito"
assert_has "$LOG_MD" "sin cambios en Swarm" "logueó 'sin cambios en Swarm'"

# ═══ 3. preflight: sitio caído ═════════════════════════════════════════════
start_case "3. preflight con el sitio YA caído (ping 503): NO hay rollback"
STUB_PING_CODE=503 run_deploy preflight-ping 21
unset STUB_PING_CODE
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "el sitio YA estaba roto" "detectó que ya estaba roto"
assert_hasnt "$OUT" "REVIRTIENDO" "no revirtió"
assert_hasnt "$OUT" "docker service update" "no emitió service update"
assert_hasnt "$OUT" "construyendo crm-mb:21" "no llegó a compilar"

# ═══ 4. preflight: réplicas ════════════════════════════════════════════════
start_case "4. preflight con un servicio en 0/1: NO hay rollback"
STUB_REPL="crm_scheduler=0/1" run_deploy preflight-repl 21
unset STUB_REPL
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "crm_scheduler está en '0/1'" "detectó el servicio caído"
assert_has "$OUT" "el stack ya estaba incompleto" "avisó que no se puede revertir"
assert_hasnt "$OUT" "REVIRTIENDO" "no revirtió"

# ═══ 5. preflight: update pausado + cómo destrabarlo ══════════════════════
start_case "5. preflight con update PAUSADO: aborta y dice el comando exacto"
STUB_UPDATE="crm_worker=paused" run_deploy preflight-paused 21
unset STUB_UPDATE
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "update PAUSADO" "detectó el pause"
assert_has "$OUT" "docker service update --update-failure-action continue crm_worker" "dio el comando de destrabe"
assert_has "$OUT" "moby#37693" "advirtió del bug PreviousSpec"
assert_hasnt "$OUT" "REVIRTIENDO" "no revirtió"

# ═══ 6. FALLO DE UPDATE: rollback solo de lo tocado ════════════════════════
start_case "6. 'docker service update crm_worker' falla: revierte SOLO backend y websocket"
DEPLOY_FAULT=update:crm_worker run_deploy update-fail 21
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
assert_rolled_back crm_websocket
assert_rolled_back crm_backend
assert_not_rolled crm_worker
assert_not_rolled crm_scheduler
assert_not_rolled crm_frontend
assert_has "$OUT" "REVIRTIENDO a crm-mb:20" "revierte a la imagen buena persistida"
assert_has "$OUT" "fallo inyectado en 'docker service update'" "reportó el fallo"
assert_has "$LOG_MD" "FALLO" "logueó FALLO"
# orden inverso al deploy: websocket antes que backend
assert_has "$OUT" "$(rollback_line crm_websocket)" "revierte en orden inverso"
awk '/REVIRTIENDO/{f=1} f' "$OUT" | grep -n 'crm_websocket\|crm_backend' | head -2 >"$CASE_DIR/order.txt"
if head -1 "$CASE_DIR/order.txt" | grep -q crm_websocket; then
  ok_case "orden inverso: primero crm_websocket, después crm_backend"
else
  bad_case "orden inverso mal: $(tr '\n' ' ' <"$CASE_DIR/order.txt")"
fi

# ═══ 7. no converge: rollback de los 5 ═════════════════════════════════════
start_case "7. un servicio no converge (el incidente de crm_worker): revierte los 5"
DEPLOY_FAULT=converge:crm_worker run_deploy converge-fail 21
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
for s in crm_frontend crm_scheduler crm_worker crm_websocket crm_backend; do
  assert_rolled_back "$s"
done
assert_has "$OUT" "no converge (fallo inyectado)" "detectó que no convergió"
assert_has "$LOG_MD" "revertido a crm-mb:20" "logueó el revert"

# ═══ 8. el task nuevo muere: corte temprano ═══════════════════════════════
start_case "8. el task nuevo muere (Failed): corta temprano, no espera el timeout, revierte"
STUB_TASK_STATE="Failed 12 seconds ago" run_deploy task-failed 21
unset STUB_TASK_STATE
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "task en estado 'Failed" "detectó el task muerto"
assert_rolled_back crm_backend
assert_hasnt "$OUT" "no se tocó Swarm" "no dijo que no tocó Swarm (sí tocó)"

# ═══ 9. verificación HTTP falla: también revierte (la asimetría del viejo) ═══
start_case "9. el HTTP falla POST-deploy: también revierte (el viejo no lo hacía)"
DEPLOY_FAULT=http run_deploy http-fail 21
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
for s in crm_frontend crm_scheduler crm_worker crm_websocket crm_backend; do
  assert_rolled_back "$s"
done
assert_has "$OUT" "REVIRTIENDO a crm-mb:20" "revirtió"

# ═══ 10. imagen que no coincide ════════════════════════════════════════════
start_case "10. la imagen REAL no es la pedida: revierte (1/1 no alcanza)"
STUB_IMAGE_AFTER=crm-mb:20 run_deploy wrong-image 21
unset STUB_IMAGE_AFTER
assert_rc 1 "$RC" "aborta con 1"
assert_rolled_back crm_backend
assert_has "$OUT" "corre 'crm-mb:20', se pidió crm-mb:21" "detectó la imagen vieja"

# ═══ 11. migrate falla: NO hay rollback, y avisa del schema a medias ═══════
start_case "11. el migrate falla: NO toca servicios, avisa schema A MEDIAS"
DEPLOY_FAULT=migrate run_deploy migrate-fail 21 --migrate
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
assert_hasnt "$OUT" "docker service update --update-order" "no actualizó ningún servicio"
assert_hasnt "$OUT" "REVIRTIENDO" "no revirtió (bien: no se había tocado nada)"
assert_has "$OUT" "NO es transaccional" "avisó que el schema puede quedar a medias"
assert_has "$OUT" "20260926_101500-crm.sql.gz" "dijo qué backup restaurar"
assert_has "$OUT" "maintenance mode OFF" "apagó el maintenance mode"

# ═══ 12. migrate OK: limit-memory + check del schema correcto ══════════════
start_case "12. migrate OK: limit-memory, maintenance y check de tabEvent"
run_deploy migrate-ok 21 --migrate
assert_rc 0 "$RC" "deploy sano con migrate"
assert_has "$OUT" "--limit-memory 1g" "el servicio del migrate tiene tope de memoria"
assert_has "$OUT" "set-maintenance-mode on" "prendió maintenance antes del migrate"
assert_has "$OUT" "set-maintenance-mode off" "lo apagó después"
assert_has "$OUT" "MIGRATE_CHECK columna=si custom_field=si" "verificó la columna que lee el API"
assert_hasnt "$OUT" "get_count" "ya no cuenta DocTypes de MbCRM"

# ═══ 13. el rollback también puede fallar: hay que reportarlo ═══════════════
start_case "13. si un servicio no se puede revertir, lo reporta y sigue con los otros"
DEPLOY_FAULT="converge:crm_worker,rollback:crm_frontend" run_deploy rollback-fail 21
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
assert_rolled_back crm_worker
assert_rolled_back crm_backend
assert_has "$OUT" "NO se pudieron revertir: crm_frontend" "reportó el que no revirtió"
assert_has "$OUT" "el stack quedó MIXTO" "avisó que el stack quedó mixto"
assert_has "$OUT" "docker service update --force --update-order start-first --update-parallelism 1 --image crm-mb:20 crm_frontend" "dio el comando manual"

# ═══ 13b. el migrate corrió: el rollback avisa que el schema NO volvió ══════
start_case "13b. migrate + revert: avisa que la imagen volvió pero el schema no"
DEPLOY_FAULT="converge:crm_worker" run_deploy rollback-migrate 21 --migrate
unset DEPLOY_FAULT
assert_rc 1 "$RC" "aborta con 1"
assert_rolled_back crm_backend
assert_has "$OUT" "CORRIÓ migrate" "avisó que el migrate ya había corrido"
assert_has "$OUT" "no es transaccional" "avisó que no hay downgrade"

# ═══ 14. parseo del tag ════════════════════════════════════════════════════
start_case "14. el tag se valida: '--migrate 20' NO construye una imagen basura"
run_deploy badtag-migrate --migrate 20
assert_has "$OUT" "crm-mb:20 ya es la imagen en uso" "tomó 20 como tag (no --migrate)"
assert_hasnt "$OUT" "construyendo crm-mb:--migrate" "no usó --migrate como tag"
run_deploy badtag-word v20
assert_rc 1 "$RC" "un tag no numérico aborta"
assert_has "$OUT" "el tag tiene que ser un entero" "explica el problema"
assert_hasnt "$OUT" "construyendo" "no llegó a construir"

# ═══ 15. árbol de trabajo sucio ════════════════════════════════════════════
start_case "15. working tree sucio: aborta y muestra qué, sin rollback"
printf 'basura\n' >"$REPO/archivo-sin-commitear.txt"
run_deploy dirty 21
assert_rc 0 "$RC" "en dry-run sigue (en el deploy real abortaría)"
assert_has "$OUT" "cambios sin commitear" "lo detectó"
assert_has "$OUT" "archivo-sin-commitear.txt" "mostró el archivo"
rm -f "$REPO/archivo-sin-commitear.txt"

# ═══ 16. docs/deploy-log.md sucio no bloquea ═══════════════════════════════
start_case "16. deploy-log.md commiteado no bloquea el próximo deploy"
(
  cd "$REPO" || exit 1
  printf '## entrada anterior\n' >>docs/deploy-log.md
  git add docs/deploy-log.md
  git commit -qm "log"
  printf '## entrada sin commitear\n' >>docs/deploy-log.md
  git status --porcelain -- . ':!docs/deploy-log.md'
) >"$TMPROOT/git-check.txt" 2>&1
if [ -z "$(cat "$TMPROOT/git-check.txt")" ]; then
  ok_case "'git status -- . \":!docs/deploy-log.md\"' ignora solo el log"
else
  bad_case "el chequeo de git ve el log como sucio: $(cat "$TMPROOT/git-check.txt")"
fi
run_deploy log-dirty 21
assert_has "$OUT" "árbol de trabajo limpio" "el log sucio no bloquea el deploy"

# ═══ 17. el backup "no creó archivo nuevo" ═════════════════════════════════
start_case "17. si el backup no crea un archivo nuevo, no se toca nada"
STUB_BACKUP_SAME=1 run_deploy backup-nuevo 21 --migrate
unset STUB_BACKUP_SAME
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "el backup no creó un archivo nuevo" "lo detectó"
assert_hasnt "$OUT" "docker service create" "no levantó el servicio del migrate"
assert_hasnt "$OUT" "docker service update --update-order" "no actualizó servicios"
assert_hasnt "$OUT" "REVIRTIENDO" "no inventó un rollback"
assert_has "$LOG_MD" "FALLO" "logueó el fallo"

# ═══ 18. el schema quedó como el API NO lo espera ══════════════════════════
start_case "18. migrate 'Complete' pero la columna no está: revierte (no es sello de goma)"
STUB_MIGRATE_CHECK="MIGRATE_CHECK columna=no custom_field=no" run_deploy schema-malo 21 --migrate
unset STUB_MIGRATE_CHECK
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "el schema NO quedó como el API lo espera" "detectó el schema incompleto"
assert_rolled_back crm_backend
assert_rolled_back crm_frontend

# ═══ 19. lock: dos deploys a la vez ════════════════════════════════════════
start_case "19. si ya hay un deploy corriendo, el segundo no entra"
mkdir -p "$REPO/.deploy/deploy.lock.d"
sleep 30 &          # pid vivo: el lock NO es stale
LOCKPID=$!
printf '%s\n' "$LOCKPID" >"$REPO/.deploy/deploy.lock.d/pid"
run_deploy locked 21
kill "$LOCKPID" 2>/dev/null
rm -rf "$REPO/.deploy/deploy.lock.d"
assert_rc 1 "$RC" "aborta con 1"
assert_has "$OUT" "ya hay un deploy corriendo" "lo detectó"
assert_hasnt "$OUT" "construyendo" "no llegó a construir"
assert_hasnt "$OUT" "REVIRTIENDO" "no inventó un rollback"

# ── resumen ─────────────────────────────────────────────────────────────────
printf '\n\033[1m══ %d pasaron, %d fallaron ══\033[0m\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "artefactos en: $TMPROOT (no se borran por el trap si falló; mirá out.txt por caso)"
  trap - EXIT
  exit 1
fi
trap - EXIT
cleanup
exit 0
