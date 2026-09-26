#!/usr/bin/env bash
# Restaurar la BD del CRM desde Google Drive.
#
#   ./restore-gdrive.sh YYYY-MM-DD [--force] [--yes] [--dry-run]
#
# ⚠️  ESTO RESTAURA ENCIMA DEL SITIO VIVO. Por defecto ABORTA salvo que el host
#     sea un ambiente de test explícito o se pase --force.
#
# Por qué el guard existe (2026-09-26): el script anterior restauraba directo
# sobre el backend de producción, sin confirmación, sin dry-run y sin backup
# previo. Un `--force` de más o un `rclone copy` de la fecha equivocada borra la
# base sin red. Ahora:
#   1. sin ambiente de test declarado ni --force → aborta;
#   2. pide confirmación interactiva (o --yes para scripts);
#   3. toma un backup del estado ACTUAL antes de sobrescribir (si no, restaurar
#      un dump viejo es una puerta de una sola dirección);
#   4. --dry-run baja y valida el dump sin tocar nada.
set -Eeuo pipefail

DATE=""
FILE_PIN=""
FORCE=0
ASSUME_YES=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --file)
      shift
      [ $# -gt 0 ] || { echo "--file necesita un nombre de archivo" >&2; exit 1; }
      FILE_PIN="$1"
      ;;
    --file=*) FILE_PIN="${1#--file=}" ;;
    -*) echo "flag desconocido: $1" >&2; exit 1 ;;
    *)
      if [ -n "$DATE" ]; then echo "sobra un argumento: $1" >&2; exit 1; fi
      DATE="$1"
      ;;
  esac
  shift
done
if [ -z "$DATE" ]; then
  echo "uso: restore-gdrive.sh YYYY-MM-DD [--file <dump>] [--force] [--yes] [--dry-run]" >&2
  exit 1
fi

SITE="${SITE:-crm.marcosbarbosagroup.com}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
BACKUPS_ROOT="${BACKUPS_ROOT:-CRM-MarcosBarbosa-Backups}"
# El ambiente tiene que declararse explícito. Vacío = producción = no se toca.
DEPLOY_ENV="${DEPLOY_ENV:-}"

say()  { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
err()  { printf '%s ERROR  %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ── 1. guard de ambiente ────────────────────────────────────────────────────
if [ "$FORCE" != 1 ]; then
  case "$DEPLOY_ENV" in
    test|staging|dev|local)
      say "ambiente declarado: $DEPLOY_ENV (restauración habilitada)"
      ;;
    *)
      cat >&2 <<GUARD
════════════════════════════════════════════════════════════════════════
 RESTAURAR ENCIMA DEL SITIO VIVO. Me freno.

 Este script NO sabe si el host es producción o un ambiente de prueba, así que
 por defecto NO hace nada. Para(probablemente no es lo que querés):

   --force                  seguir adelante igual
   DEPLOY_ENV=test ...      declarar que el host es un test

 Antes de continuar, mirá dos cosas:
   * la fecha: $DATE  (debe existir en ${RCLONE_REMOTE}:${BACKUPS_ROOT}/$DATE)
   * el destino: site $SITE sobre el backend de producción
════════════════════════════════════════════════════════════════════════
GUARD
      exit 1
      ;;
  esac
fi

# ── 2. confirmación interactiva ─────────────────────────────────────────────
if [ "$ASSUME_YES" != 1 ] && [ "$DRY_RUN" != 1 ]; then
  [ -t 0 ] || die "no es un terminal: pasá --yes si sabés lo que estás haciendo"
  printf 'Vas a SOBRESCRIBIR la base de %s con el dump de %s. ¿Seguro? [NO] ' "$SITE" "$DATE"
  read -r r
  case "$r" in
    s|S|si|SI|SÍ|sí|SI|yes|Y) : ;;
    *) die "cancelado por el usuario" ;;
  esac
fi

# ── 3. bajar el dump ────────────────────────────────────────────────────────
# `name=crm_backend` sin el `.1` devuelve TODOS los contenedores del servicio
# durante un rolling update; `docker exec` con varios ids revienta. El patrón
# correcto es el de la task.
BACKEND_CID=$(docker ps -qf 'name=crm_backend\.1')
BACKEND_CID=$(printf '%s\n' "$BACKEND_CID" | head -n1)
[ -n "$BACKEND_CID" ] || die "no encontré el contenedor crm_backend.1 (¿el stack está arriba?)"

TMP=/tmp/crm-restore-$$
mkdir -p "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

say "[1/6] descargando ${RCLONE_REMOTE}:${BACKUPS_ROOT}/${DATE} (todas las horas)"
rclone copy "${RCLONE_REMOTE}:${BACKUPS_ROOT}/${DATE}" "$TMP"

# La carpeta del día tiene un dump por hora. "El más nuevo" por mtime puede
# embolarse si dos dumps se escribieron en el mismo segundo, así que la lista se
# muestra y `--file` puede fijar cuál se restaura. En un restore destructivo,
# adivinar es lo que no hay que hacer.
pick_newest() {  # pick_newest <glob> -> path (solo el path a stdout; avisos a stderr)
  local pattern="$1" f newest="" n=0
  for f in $pattern; do
    [ -e "$f" ] || continue
    n=$((n + 1))
    if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then newest="$f"; fi
  done
  printf '%s' "$newest"
  if [ "$n" -gt 1 ]; then
    say "  hay $n dumps en la carpeta; uso el más nuevo por fecha de modificación." >&2
    for f in $pattern; do [ -e "$f" ] && say "    candidato: $(basename "$f")" >&2; done
    say "    para fijar uno: --file <nombre>" >&2
  fi
  return 0
}

if [ -n "$FILE_PIN" ]; then
  SQL="$TMP/$FILE_PIN"
  [ -e "$SQL" ] || die "--file $FILE_PIN no está en ${RCLONE_REMOTE}:${BACKUPS_ROOT}/${DATE}"
  say "  dump fijado a mano: $FILE_PIN"
else
  SQL="$(pick_newest "$TMP/*.sql.gz")"
fi
[ -n "$SQL" ] || die "no hay ningún .sql.gz en ${RCLONE_REMOTE}:${BACKUPS_ROOT}/${DATE}"
# Idempotente como el de backup-gdrive.sh: el dump tiene que existir y estar
# entero antes de tocar la base viva.
gzip -t "$SQL" || die "el dump $SQL está corrupto (gzip -t falló). No toco nada."
say "  usando: $(basename "$SQL") ($(du -h "$SQL" | cut -f1))"

# El tar de archivos es opcional. El bug anterior armaba un `ARGS` que nunca
# usaba (código muerto) y, si faltaba el tar, `${FILEC/...}` disparaba
# `unbound variable` bajo `set -u` → exit 1 DESPUÉS de haber copiado el SQL al
# backend vivo. Ahora se resuelve antes de copiar nada.
FILES="$(pick_newest "$TMP"/*files*.tar)"
if [ -n "$FILES" ]; then
  tar -tf "$FILES" >/dev/null 2>&1 || die "el tar de archivos $FILES está corrupto"
  say "  con archivos: $(basename "$FILES")"
else
  say "  (el dump no trae tar de archivos: se restaura solo la base)"
fi

if [ "$DRY_RUN" = 1 ]; then
  say "[dry-run] NO se toca el sitio. Habría que ejecutar, sobre $BACKEND_CID:"
  if [ -n "$FILES" ]; then
    say "  bench --site $SITE restore /tmp/$(basename "$SQL") --with-files /tmp/$(basename "$FILES")"
  else
    say "  bench --site $SITE restore /tmp/$(basename "$SQL")"
  fi
  say "[dry-run] OK (no se modificó nada)"
  exit 0
fi

# ── 4. backup del estado ACTUAL (una puerta de salida) ─────────────────────
say "[2/6] backup del estado ACTUAL (por si el restore sale mal)"
SAFETY=$(docker exec "$BACKEND_CID" bash -c \
  "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*.sql.gz 2>/dev/null | head -n1")
if docker exec "$BACKEND_CID" bench --site "$SITE" backup --with-files >/dev/null; then
  NOW=$(docker exec "$BACKEND_CID" bash -c \
    "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*.sql.gz 2>/dev/null | head -n1")
  if [ -n "$NOW" ] && [ "$NOW" != "${SAFETY:-}" ]; then
    say "  red de seguridad: $NOW"
  else
    err "  el backup no creó un archivo nuevo; sigo igual pero Anotá que no hay red"
  fi
else
  err "  el backup previo FALLÓ. Sigo (--force pedido explícitamente), pero sabé"
  err "  que restaurando $DATE no hay forma de volver atrás."
fi

# ── 5. restaurar ───────────────────────────────────────────────────────────
say "[3/6] copiando al contenedor"
SQLC=$(basename "$SQL")
docker cp "$SQL" "$BACKEND_CID:/tmp/$SQLC"
RESTORE_ARGS=("/tmp/$SQLC")
if [ -n "$FILES" ]; then
  FILEC=$(basename "$FILES")
  docker cp "$FILES" "$BACKEND_CID:/tmp/$FILEC"
  RESTORE_ARGS+=(--with-files "/tmp/$FILEC")
fi

say "[4/6] restaurando (esto reemplaza la base del sitio)"
docker exec "$BACKEND_CID" bench --site "$SITE" restore "${RESTORE_ARGS[@]}"

# ── 6. cerrar el restore ────────────────────────────────────────────────────
say "[5/6] migrate + clear-cache"
docker exec "$BACKEND_CID" bench --site "$SITE" migrate
docker exec "$BACKEND_CID" bench --site "$SITE" clear-cache

say "[6/6] reinicio de los servicios para que todos los procesos lean la base nueva"
for svc in crm_backend crm_websocket crm_worker crm_scheduler crm_frontend; do
  docker service update --force --update-order start-first --update-parallelism 1 "$svc" >/dev/null
  say "  $svc -> reiniciado"
done

say "RESTAURACION OK - verificá login en https://${SITE} y /api/method/ping (200 pong)"
say "si algo quedó raro, la red de seguridad está en el paso [2/6] del log de esta corrida"
