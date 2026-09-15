#!/usr/bin/env bash
# Deploy de crm-mb sobre Docker Swarm (VPS Hetzner).
#
#   scripts/deploy-crm.sh 56        # construye y despliega crm-mb:56
#
# Por qué existe:
#   - Dokploy poda imágenes sin usar. Si el Dockerfile parte de una base fija
#     ("crm-mb:19"), esa base desaparece y el build muere. Acá la base es la
#     imagen que está CORRIENDO (siempre presente, la referencia un contenedor).
#   - Verifica el resultado y, si algo queda mal, vuelve a la imagen anterior.
#   - No enmascara errores: cualquier fallo de build corta antes de tocar Swarm.
set -euo pipefail

NEW="${1:?uso: deploy-crm.sh <tag-nuevo, ej 56>}"
REPO_DIR=/opt/crm-marcosbarbosagroup
SERVICES="crm_backend crm_websocket crm_worker crm_scheduler crm_frontend"
HEALTH_URL=https://crm.marcosbarbosagroup.com/hoy

cd "$REPO_DIR"
git pull -q

CURRENT=$(docker service inspect crm_backend \
  --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | sed 's/.*\(crm-mb:[^ ]*\)/\1/')
echo "imagen en uso: $CURRENT"

docker image inspect "$CURRENT" >/dev/null 2>&1 || {
  echo "ERROR: no existe la base $CURRENT en el host"; exit 1;
}

echo "construyendo crm-mb:$NEW (base $CURRENT)…"
docker build --no-cache --build-arg "BASE=$CURRENT" \
  -f docker/Dockerfile.crm-mb -t "crm-mb:$NEW" .

echo "actualizando servicios…"
for svc in $SERVICES; do
  docker service update --image "crm-mb:$NEW" "$svc" >/dev/null
  echo "  $svc -> crm-mb:$NEW"
done

echo "esperando arranque…"
sleep 40

FAIL=0
for svc in $SERVICES; do
  REP=$(docker service ls --filter "name=$svc" --format '{{.Replicas}}')
  echo "  $svc $REP"
  [ "$REP" = "1/1" ] || FAIL=1
done

if [ "$FAIL" != "0" ]; then
  echo "FALLO: servicios incompletos; volviendo a $CURRENT"
  for svc in $SERVICES; do docker service update --image "$CURRENT" "$svc" >/dev/null; done
  sleep 30
  exit 1
fi

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL")
echo "$HEALTH_URL -> $CODE"
case "$CODE" in
  200|301|302) echo "DEPLOY OK: crm-mb:$NEW" ;;
  *) echo "ATENCION: HTTP $CODE (revisar igual)"; exit 1 ;;
esac
