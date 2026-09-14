#!/usr/bin/env bash
# build-crm-mb-18.sh — build crm-mb:18 on the VPS host.
#
# Why a script: ensures idempotent rollback tags are present BEFORE we replace
# anything. Run from the repo root on the VPS host (/opt/crm-marcosbarbosagroup).
#
# Requires: docker installed on host. Repo mounted there. Branch checked out.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
    echo "must run as root" >&2; exit 1
fi
if [[ ! -f compose.yaml ]]; then
    echo "must run from repo root (compose.yaml missing)" >&2; exit 1
fi

# Rollback tag — REGARDLESS of whether we proceed
if ! docker inspect crm-mb:17-pre-crm-core >/dev/null 2>&1; then
    echo "[1/3] Tagging crm-mb:17 → crm-mb:17-pre-crm-core (rollback anchor)"
    docker tag crm-mb:17 crm-mb:17-pre-crm-core
else
    echo "[1/3] crm-mb:17-pre-crm-core already exists (skip)"
fi

echo "[2/3] Building crm-mb:18 with crm_core baked"
docker build \
    -f docker/Dockerfile.crm-mb \
    -t crm-mb:18 \
    .

echo "[3/3] Done. Images now present:"
docker images | grep -E '^crm-mb ' | sort -k2

cat <<'EOF'

[Next steps, by hand — DO NOT proceed without explicit user OK]
  # 1) Verify image
  docker run --rm crm-mb:18 bash -lc "ls /home/frappe/frappe-bench/apps/crm_core | head"
  docker run --rm crm-mb:18 bash -lc "cd /home/frappe/frappe-bench/apps/crm_core && git log --oneline"

  # 2) Update compose.yaml image tags (6 services)
  sed -i 's|image: crm-mb:17|image: crm-mb:18|g' /opt/crm-marcosbarbosagroup/compose.yaml

  # 3) Redeploy via docker compose up -d (or Dokploy UI)
  cd /opt/crm-marcosbarbosagroup && docker compose pull backend 2>/dev/null || true
  docker compose up -d
  docker compose ps

  # 4) Create crm-test site (FIRST — never install on prod without testing here)
  docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
    "bench new-site crm.marcosbarbosagroup.com.test \
       --mariadb-user-host-login-scope='%' \
       --admin-password ${1:-TestAdmin123-PLACEHOLDER} \
       --no-mariadb-socket"
  # ↓ Will fail on the prod hostname. Use:
  docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
    "bench new-site crm-test \
       --mariadb-user-host-login-scope='%' \
       --admin-password ${1:-TestAdmin123-PLACEHOLDER}"

  # 5) Install crm_core on crm-test (NOT prod yet)
  docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
    "bench --site crm-test install-app crm_core && bench --site crm-test migrate"

  # 6) Run smoke tests from inside backend
  docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
    "cd apps/crm_core && pip install --user -q pytest && \
     FRAPPE_TEST_BASE=http://localhost:8000/api/method/login \
     FRAPPE_TEST_ADMIN_PW='<password>' \
     python3 -m pytest tests/test_rest_smoke.py -v"

  # 7) ONLY if step 6 is GREEN, install on prod
  docker exec $(docker ps -qf name=crm_backend.1) bash -lc \
    "bench --site crm.marcosbarbosagroup.com install-app crm_core && \
     bench --site crm.marcosbarbosagroup.com migrate"
EOF
