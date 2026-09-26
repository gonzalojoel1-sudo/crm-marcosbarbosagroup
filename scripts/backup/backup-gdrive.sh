#!/usr/bin/env bash
# Backup diario CRM -> Google Drive (rclone)
# Cron: 30 3 * * *  /opt/crm-marcosbarbosagroup/scripts/backup/backup-gdrive.sh >> /var/log/crm-backup.log 2>&1
#
# Qué cambió (2026-09-26): el script anterior submía a Drive lo que hubiera
# salido de `bench backup` sin verificar NADA. Si el dump salía truncado o vacío
# ( disco lleno, OOM, bench a medias), el backup "OK" de las 03:30 subía un
# .sql.gz corrupto y el `exit 0` del cron lo hacía parecer sano. Cuando alguien
# lo descubre es tarde: el archivo de Drive que REEMPLAZÓ al bueno.
#
# Ahora, antes de subir:
#   1. `bench backup` tiene que devolver 0 Y crear un .sql.gz NUEVO;
#   2. el .sql.gz pasa `gzip -t` (íntegro de punta a punta);
#   3. el tar de archivos, si existe, pasa `tar -tf`;
#   4. el dump no se escribe en /tmp del mismo disco (que es el que se llena):
#      va a un dir configurable, por defecto con espacio para 2 dumps;
#   5. si algo falla, se dice en el log con detalle y el script sale != 0, así
#      que el cron queda registrado como fallado en vez de "OK".
set -Eeuo pipefail

SITE="${SITE:-crm.marcosbarbosagroup.com}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
GDRIVE_ROOT="${GDRIVE_ROOT:-CRM-MarcosBarbosa-Backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# Destino local de los dumps. Antes era /tmp del mismo disco que guarda la base:
# si se llena el disco, el backup es justamente lo que se lleva por delante.
STAGE_DIR="${STAGE_DIR:-/var/backups/crm}"
DATE=$(date +%F)
DEST="${RCLONE_REMOTE}:${GDRIVE_ROOT}/${DATE}/$(date +%H)"
LOCK=/tmp/crm-backup.lock
MIN_BYTES="${MIN_BYTES:-1024}"   # un .sql.gz de menos de 1KB no es un dump

say() { printf '[%s] %s\n' "$(date)" "$*"; }
die() { printf '[%s] ERROR %s\n' "$(date)" "$*" >&2; exit 1; }

exec 9>"$LOCK"
if ! flock -n 9; then echo "[$(date)] backup ya corriendo, salgo"; exit 0; fi

# `name=crm_backend` sin el `.1` devuelve TODOS los contenedores del servicio
# durante un rolling update; `docker exec` con varios ids revienta.
BACKEND_CID=$(docker ps -qf 'name=crm_backend\.1' | head -n1)
[ -n "$BACKEND_CID" ] || die "no encontré el contenedor crm_backend.1 (¿el stack está arriba?)"

echo "[$(date)] === backup ${DATE} ==="

cleanup() { [ -n "${TMPDIR_B:-}" ] && rm -rf "$TMPDIR_B"; }
trap cleanup EXIT

# 1) bench backup con archivos
if ! docker exec "$BACKEND_CID" bench --site "$SITE" backup --with-files >/dev/null; then
  die "bench backup falló: NO se sube nada a Drive (antes se subía igual y el cron decía OK)"
fi

# 2) ubicar los archivos más recientes generados
LATEST_SQL=$(docker exec "$BACKEND_CID" bash -c \
  "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*.sql.gz 2>/dev/null | head -n1")
LATEST_FILES=$(docker exec "$BACKEND_CID" bash -c \
  "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*private-files*.tar 2>/dev/null | head -n1 \
   || ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*files*.tar 2>/dev/null | head -n1")
[ -n "$LATEST_SQL" ] || die "no hay .sql.gz en el contenedor después del backup"

# 3) verificar que el dump existe y está entero ANTES de subirlo
mkdir -p "$STAGE_DIR"
TMPDIR_B=$(mktemp -d "${STAGE_DIR%/}/crm-backup-XXXXXX") \
  || die "no pude crear el dir de staging $STAGE_DIR (disco lleno?)"
docker cp "$BACKEND_CID:$LATEST_SQL" "$TMPDIR_B/" || die "falló docker cp del .sql.gz"

SQL_BASE=$(basename "$LATEST_SQL")
SQL_LOCAL="$TMPDIR_B/$SQL_BASE"
[ -s "$SQL_LOCAL" ] || die "el .sql.gz copiado está vacío (0 bytes): no es un dump"
SQL_BYTES=$(wc -c <"$SQL_LOCAL" | tr -d ' ')
[ "$SQL_BYTES" -ge "$MIN_BYTES" ] \
  || die "el .sql.gz pesa ${SQL_BYTES}B (< ${MIN_BYTES}B): no parece un dump de este sitio"
gzip -t "$SQL_LOCAL" || die "gzip -t falló: el dump está CORRUPTO, no lo subo a Drive"
gzip -l "$SQL_LOCAL" 2>/dev/null | tail -n1 | sed "s/^/[$(date)] dump: /" || true
echo "[$(date)] dump íntegro: $SQL_BASE (${SQL_BYTES} bytes)"

if [ -n "$LATEST_FILES" ]; then
  docker cp "$BACKEND_CID:$LATEST_FILES" "$TMPDIR_B/" || die "falló docker cp del tar de archivos"
  TAR_LOCAL="$TMPDIR_B/$(basename "$LATEST_FILES")"
  tar -tf "$TAR_LOCAL" >/dev/null 2>&1 || die "el tar de archivos está corrupto: no lo subo"
  echo "[$(date)] tar de archivos íntegro: $(basename "$TAR_LOCAL")"
else
  echo "[$(date)] AVISO: el backup no trajo tar de archivos (solo base)"
fi
echo "[$(date)] a subir: $(ls "$TMPDIR_B" | tr '\n' ' ')"

# 4) subir a Drive (carpeta del día)
rclone copy "$TMPDIR_B" "$DEST" --drive-chunk-size 8M \
  || die "rclone falló: el backup NO llegó a Drive (revisá /var/log/crm-backup.log)"
echo "[$(date)] rclone upload ok -> ${DEST}"

# 5) verificar que está del otro lado
for f in "$TMPDIR_B"/*; do
  rclone ls "$DEST" --include "$(basename "$f")" 2>/dev/null | grep -q "$(basename "$f")" \
    || die "subí $(basename "$f") pero no aparece en Drive. Backups sin verificar > sin backups."
done
echo "[$(date)] verificado en Drive"

# 6) retencion: borrar carpetas > RETENTION_DAYS
rclone lsf "${RCLONE_REMOTE}:${GDRIVE_ROOT}" --dirs-only 2>/dev/null | tr -d '/' | while read -r d; do
  if [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ "$d" < "$(date -d "-${RETENTION_DAYS} days" +%F 2>/dev/null || date -v-${RETENTION_DAYS}d +%F)" ]]; then
    rclone purge "${RCLONE_REMOTE}:${GDRIVE_ROOT}/${d}" && echo "[$(date)] purgada carpeta $d"
  fi
done

rm -rf "$TMPDIR_B"
TMPDIR_B=""
echo "[$(date)] === backup completo OK ==="
