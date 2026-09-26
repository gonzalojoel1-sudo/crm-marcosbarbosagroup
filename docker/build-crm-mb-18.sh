#!/usr/bin/env bash
# build-crm-mb-18.sh — RETIRADO. Delegá en scripts/deploy-crm.sh.
#
# Por qué se borró el contenido (esto es el aviso, no un script que hace nada):
#
#   El script anterior construía `crm-mb:18` SIN pasar `BASE`, así que el
#   `ARG BASE=crm-mb:54` default del Dockerfile se usaba: una imagen que NO
#   existe. Después imprimía unos "next steps" que decían:
#
#       sed -i 's|image: crm-mb:17|image: crm-mb:18|g' compose.yaml
#       docker compose up -d
#
#   Producción corre DOCKER SWARM (servicios crm_backend, crm_websocket,
#   crm_worker, crm_scheduler, crm_frontend), no compose. Si alguien seguía
#   esos pasos, los 6 servicios del compose pasaban a una imagen inexistente:
#   caída total del sitio. El comando estaba además documentado como válido en
#   docs/deploy-log.md, o sea que la receta iba a fallar en producción.
#
#   Además: sin `--update-order start-first` y sin rollback transaccional, un
#   fallo a mitad dejaba el stack mixto (ver el incidente de crm_worker).
#
# Lo único que hay que usar es:
#
#   bash scripts/deploy-crm.sh <tag> [--migrate]
#
# que (a) construye con BASE = la imagen que está CORRIENDO, (b) pasa preflight
# (disco, salud real del sitio, réplicas, updates pausados), (c) actualiza los 5
# servicios con start-first, (d) verifica ping 200/pong + la imagen realmente
# corriendo, (e) corre clear-cache, y (f) si algo falla revierte SOLO los
# servicios que tocó a la imagen buena persistida.
#
# Para NO desplegar (solo compilar y quedarse con la imagen local) no hay script
# hoy. Si lo necesitás, se agrega con un flag --build-only al deploy script;
# NO lo improvises con `docker build` pelado: la base tiene que ser la imagen
# viva (Dokploy poda las que no usa).
set -Eeuo pipefail

cat >&2 <<'AVISO'
════════════════════════════════════════════════════════════════════════
 docker/build-crm-mb-18.sh ESTÁ RETIRADO. No lo ejecutes.
 Este script antes pedía `docker compose up -d` + un `sed` de compose.yaml.
 Producción corre SWARM, no compose: esos pasos mandaban los servicios a una
 imagen inexistente (caída total).
 Delegando en scripts/deploy-crm.sh, que sí es el camino soportado.
════════════════════════════════════════════════════════════════════════
AVISO

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$SCRIPT_DIR/../scripts/deploy-crm.sh"
[ -f "$DEPLOY" ] || { echo "no encuentro $DEPLOY" >&2; exit 1; }
TAG="${1:-}"
shift || true
exec bash "$DEPLOY" "$TAG" "$@"
