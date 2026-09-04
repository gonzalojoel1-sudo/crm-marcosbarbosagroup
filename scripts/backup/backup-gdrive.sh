#!/usr/bin/env bash
# Backup diario CRM -> Google Drive (rclone)
# Cron: 30 3 * * *  /opt/crm-marcosbarbosagroup/scripts/backup/backup-gdrive.sh >> /var/log/crm-backup.log 2>&1
set -euo pipefail

SITE="crm.marcosbarbosagroup.com"
RCLONE_REMOTE="gdrive"
GDRIVE_ROOT="CRM-MarcosBarbosa-Backups"
RETENTION_DAYS=30
BACKEND_CID=$(docker ps -qf name=crm_backend)
DATE=$(date +%F)
DEST="${RCLONE_REMOTE}:${GDRIVE_ROOT}/${DATE}/$(date +%H)"
LOCK=/tmp/crm-backup.lock

exec 9>"$LOCK"
if ! flock -n 9; then echo "[$(date)] backup ya corriendo, salgo"; exit 0; fi

echo "[$(date)] === backup ${DATE} ==="

# 1) bench backup con archivos
docker exec "$BACKEND_CID" bench --site "$SITE" backup --with-files > /dev/null
echo "[$(date)] bench backup ok"

# 2) copiar los archivos mas recientes generados
LATEST_SQL=$(docker exec "$BACKEND_CID" bash -c "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*.sql.gz 2>/dev/null | head -n1")
LATEST_FILES=$(docker exec "$BACKEND_CID" bash -c "ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*private-files*.tar 2>/dev/null | head -n1 || ls -1t /home/frappe/frappe-bench/sites/${SITE}/private/backups/*files*.tar 2>/dev/null | head -n1")
[ -z "$LATEST_SQL" ] && { echo "[$(date)] ERROR: no hay .sql.gz"; exit 1; }

TMPDIR_B=/tmp/crm-backup-$$
mkdir -p "$TMPDIR_B"
docker cp "$BACKEND_CID:$LATEST_SQL" "$TMPDIR_B/"
[ -n "$LATEST_FILES" ] && docker cp "$BACKEND_CID:$LATEST_FILES" "$TMPDIR_B/"
echo "[$(date)] archivos copiados del contenedor: $(ls $TMPDIR_B | tr '\n' ' ')"

# 3) subir a Drive (carpeta del dia)
rclone copy "$TMPDIR_B" "$DEST" --drive-chunk-size 8M
echo "[$(date)] rclone upload ok -> ${DEST}"

# 4) retencion: borrar carpetas > RETENTION_DAYS
rclone lsf "${RCLONE_REMOTE}:${GDRIVE_ROOT}" --dirs-only 2>/dev/null | tr -d '/' | while read -r d; do
  if [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ "$d" < "$(date -d "-${RETENTION_DAYS} days" +%F 2>/dev/null || date -v-${RETENTION_DAYS}d +%F)" ]]; then
    rclone purge "${RCLONE_REMOTE}:${GDRIVE_ROOT}/${d}" && echo "[$(date)] purgada carpeta $d"
  fi
done

rm -rf "$TMPDIR_B"
echo "[$(date)] === backup completo OK ==="
