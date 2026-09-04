#!/usr/bin/env bash
# Restaurar BD del CRM desde Google Drive
# Uso: ./restore-gdrive.sh 2026-09-04   (fecha de la carpeta en Drive)
set -euo pipefail
DATE="${1:?usage: restore-gdrive.sh YYYY-MM-DD}"
SITE="crm.marcosbarbosagroup.com"
RCLONE_REMOTE="gdrive"
BACKEND_CID=$(docker ps -qf name=crm_backend)
TMP=/tmp/crm-restore-$$
mkdir -p "$TMP"

echo "[1/4] descargando ${RCLONE_REMOTE}:CRM-MarcosBarbosa-Backups/${DATE}"
rclone copy "${RCLONE_REMOTE}:CRM-MarcosBarbosa-Backups/${DATE}" "$TMP"
SQL=$(ls "$TMP"/*.sql.gz | head -n1)
FILES=$(ls "$TMP"/*files*.tar 2>/dev/null | head -n1 || true)

echo "[2/4] copiando al contenedor"
SQLC=$(basename "$SQL"); docker cp "$SQL" "$BACKEND_CID:/tmp/$SQLC"
[ -n "${FILES:-}" ] && { FILEC=$(basename "$FILES"); docker cp "$FILES" "$BACKEND_CID:/tmp/$FILEC"; }

echo "[3/4] restaurando BD + archivos"
ARGS="--with-private-files /tmp/$FILEC --with-public-files /tmp/${FILEC/public-files/private-files}" 2>/dev/null || true
if [ -n "${FILES:-}" ]; then
  docker exec "$BACKEND_CID" bench --site "$SITE" restore "/tmp/$SQLC" --with-files "/tmp/$FILEC"
else
  docker exec "$BACKEND_CID" bench --site "$SITE" restore "/tmp/$SQLC"
fi

echo "[4/4] migrate + clear-cache"
docker exec "$BACKEND_CID" bench --site "$SITE" migrate
docker exec "$BACKEND_CID" bench --site "$SITE" clear-cache
rm -rf "$TMP"
echo "RESTAURACION OK - verificar login en https://${SITE}"
