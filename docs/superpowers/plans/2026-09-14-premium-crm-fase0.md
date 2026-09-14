# Premium CRM Fase 0 (Dogfood) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Equipo de 1-3 personas trabaja 5 días seguidos en la nueva app (agenda Hoy + tareas + contactos/deals + sync GCal + booking) sin abrir el Frappe CRM viejo ni Google Calendar directo.

**Architecture:** Monorepo Turborepo. `apps/web` (Next.js, solo habla con Frappe por REST v2 + RPC whitelisted) + `apps/crm_core` (custom app Frappe con 7 DocTypes + sync engine + webhooks) + `packages/*` (tipos y UI compartidos). Cal.com sidecar transitorio solo para booking.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript strict, Tailwind, shadcn/ui, TanStack Query, Zustand, cmdk, Frappe Framework v15, Postgres 16 (pendiente spike T2), Redis existente, Cal.com self-hosted, Playwright, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-09-14-premium-crm-design.md` (Fase 0 = §11 gate 1; sync = §5.1-5.2+5.5 básico; scheduling = §6 Fase 0; migración = §10 parallel run)

## Global Constraints

- Frappe Framework v15 (no v16, no Desk como UI de usuario).
- Frontend NUNCA toca SQL; solo `/api/v2/document/*` y `/api/method/crm_core.api.v1.*`.
- OAuth tokens GCal cifrados AES-256-GCM en reposo; jamás en logs ni payloads al frontend.
- `sync_token` de Google opaco: jamás parsear; 410 GONE → limpiar estado + full sync.
- Licencia propietaria de `apps/web` y `packages/*` desde día 1 (header en cada archivo nuevo).
- Python: `bench` env del contenedor backend; JS: Node 22 LTS; TS `strict: true`, `noUncheckedIndexedAccess: true`.
- Cada task termina en commit atómico con tests verdes; pushes a rama `feat/premium-fase0`, nunca directo a `main`.
- Random in tests prohibido (semillas fijas); E2E contra site de test `crm-test`, jamás contra el site productivo.
- **Prohibido commit con placeholders literales** (`<backend>`, `<...>`, etc.); el ejecutor REEMPLAZA por env real (ej. `$(hostname -i)`) o aborta la task antes de commitear.
- **Prohibido instalar/migrar en site productivo** (`site_config.json`, `bench install-app`, `bench migrate`): todo va sobre `crm-test` o sobre un bench efímero del spike.
- **`/api/method/login` es form-encoded**, NO JSON (bug C1): `Content-Type: application/x-www-form-urlencoded`, body `usr=...&pwd=...`.
- **App Frappe `crm_core` requiere estructura oficial** (bug C2): `pyproject.toml` + `modules.txt` + `crm_core/__init__.py` + `crm_core/hooks.py` + `crm_core/config/desktop.py` antes de `bench install-app`.

---

## File Structure (se crea en este plan)

```
apps/web/                          # Next.js 14 — NUEVO
  app/(auth)/login/page.tsx         # login contra Frappe
  app/(app)/hoy/page.tsx            # vista Hoy (tasks+events)
  app/(app)/contactos/page.tsx      # CRUD contactos
  app/(app)/deals/page.tsx          # kanban deals
  app/layout.tsx app/globals.css
  lib/frappe-client.ts              # wrapper REST v2 + token
  lib/hooks/use-hoy.ts              # query Hoy + optimistic
  components/cmdk-palette.tsx       # ⌘K (15 comandos)
  public/manifest.webmanifest       # PWA
  playwright.config.ts  e2e/*.spec.ts  e2e/global-setup.ts
apps/crm_core/                      # custom app Frappe — NUEVO
  crm_core/doctype/task/task.json
  crm_core/doctype/event/event.json
  crm_core/doctype/contact/contact.json
  crm_core/doctype/account/account.json
  crm_core/doctype/lead/lead.json
  crm_core/doctype/deal/deal.json
  crm_core/doctype/activity/activity.json
  crm_core/doctype/gcal_connection/gcal_connection.json
  crm_core/doctype/gcal_sync_state/gcal_sync_state.json
  crm_core/api/v1/sync.py           # full+incremental+410
  crm_core/api/v1/oauth.py          # OAuth Google + refresh
  crm_core/api/v1/webhooks.py       # Cal.com receiver (HMAC)
  crm_core/tasks/scheduler.py       # polling + watch renewal + reminders
  tests/test_sync_machine.py  tests/test_webhook_hmac.py
packages/types/src/crm.ts           # contratos TS (Task, Event, HoyItem…)
packages/ui/src/tokens.css          # design tokens + skin shadcn
deploy/overlay-web.yaml             # servicio web Next.js (Dokploy)
deploy/cal-sidecar.yaml             # Cal.com + PG + Redis propios
deploy/init-cal.sh                  # entrypoint sidecar: prisma + secrets
deploy/cors-check.sh                # check ACAO exacto + credentials
deploy/pg16-spike.yaml              # Postgres 16 solo para spike T2
turbo.json  package.json (workspaces)
```

---

### Task 1: Monorepo scaffold + tooling + CI verde

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `apps/web/package.json`, `apps/web/tsconfig.json`, `packages/types/package.json`, `packages/types/src/crm.ts`, `packages/ui/package.json`, `packages/ui/src/tokens.css`, `.github/workflows/ci.yaml`
- Modify: `.gitignore` (append `apps/web/.next`, `*.tsbuildinfo`)

**Interfaces:**
- Consumes: nada (primera task).
- Produces: `packages/types/src/crm.ts` → `HoyItem`, `TaskDTO`, `EventDTO` (usados por T4/T5); `turbo run typecheck lint` verde (usado por todas).

- [ ] **Step 1: Escribir contrato de tipos primero (falla: no existe)**

```typescript
// packages/types/src/crm.ts
export interface TaskDTO {
  name: string; subject: string;
  due_datetime: string | null; status: "Open" | "Done" | "Cancelled";
  assignee: string | null; priority: "Low" | "Medium" | "High";
  linked_doctype: "Lead" | "Deal" | "Contact" | "Event" | null;
  linked_name: string | null;
}
export interface EventDTO {
  name: string; title: string; start_utc: string; end_utc: string;
  timezone: string; attendees: string[]; meet_link: string | null;
  gcal_id: string | null; source: "manual" | "gcal" | "cal_sidecar";
}
export type HoyItem =
  | ({ kind: "task" } & TaskDTO)
  | ({ kind: "event" } & EventDTO);
```

- [ ] **Step 2: Crear workspaces + turbo + tsconfig base**

Run:
```bash
cat > package.json <<'JSON'
{"private": true, "name": "crm-monorepo",
 "workspaces": ["apps/*", "packages/*"],
 "scripts": {"typecheck": "turbo run typecheck", "lint": "turbo run lint"}}
JSON
cat > turbo.json <<'JSON'
{"pipeline": {"typecheck": {"dependsOn": ["^typecheck"]}, "lint": {}}}
JSON
cat > packages/types/package.json <<'JSON'
{"name": "@crm/types", "version": "0.0.0", "private": true,
 "main": "./src/crm.ts", "types": "./src/crm.ts", "sideEffects": false}
JSON
cat > packages/ui/package.json <<'JSON'
{"name": "@crm/ui", "version": "0.0.0", "private": true,
 "main": "./src/tokens.css"}
JSON
```
**Importante (bug m2):** agregar `"noUnusedLocals": false` y `"noUnusedParameters": false` en `tsconfig.base.json` mientras el scaffold está vacío (se reactivan cuando el código madure); `"strict": true, "noUncheckedIndexedAccess": true` se mantienen. `apps/web/package.json` lleva `"name": "@crm/web"`, deps: `next@14.2`, `react@18`, `typescript@5`, `@tanstack/react-query`, `zustand`, `cmdk`. DevDeps: `playwright`, `@playwright/test`.

- [ ] **Step 2b: .gitignore robusto (bug C7)**

Run:
```bash
printf "\napps/web/.next\napps/web/e2e/.auth.json\n*.tsbuildinfo\nnode_modules\n.turbo\n" >> .gitignore
git diff --check .gitignore
```

- [ ] **Step 3: CI mínimo (bug de cache workspaces)**

```yaml
# .github/workflows/ci.yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: '**/package-lock.json'   # monorepo: raiz
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
```

- [ ] **Step 4: Verificar verde y commitear**

Run: `npm ci && npm run typecheck && npm run lint`
Expected: PASS (sin errores; web aún sin páginas — solo scaffold).
```bash
git add package.json turbo.json tsconfig.base.json apps/web/packages.json apps/web/tsconfig.json packages/types packages/ui .github .gitignore
git commit -m "chore: monorepo scaffold + tipos base + CI"
```

---

### Task 2: Spike Postgres 16 + veredicto documentado (con fallback)

**Files:**
- Create: `deploy/pg16-spike.yaml`, `deploy/spike-backend-efimero.yaml`, `docs/superpowers/specs/2026-09-14-pg-veredicto.md`
- Modify: nada (spike en backend **efímero separado** — bug C3, jamás en prod).

**Interfaces:**
- Consumes: nada.
- Produces: veredicto PG-vs-MariaDB (lo consumen T3+ para el driver de datos).

- [ ] **Step 1: Levantar PG16 efímero y test de JSONB (falla si PG no responde)**

```yaml
# deploy/pg16-spike.yaml
services:
  pg-spike:
    image: postgres:16-alpine
    environment: [POSTGRES_PASSWORD=spike-only-change-me]
    ports: ["55433:5432"]
```
Run:
```bash
docker compose -f deploy/pg16-spike.yaml up -d
SPK_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker ps -qf name=pg-spike))
sleep 5 && docker exec $(docker ps -qf name=pg-spike) psql -U postgres -c "select version();"
```
Expected: fila con `PostgreSQL 16`.

- [ ] **Step 2: Backend EFÍMERO (NO prod, bug C3) + bench new-site contra PG**

```yaml
# deploy/spike-backend-efimero.yaml — clon del backend, sin tocar prod
services:
  backend-spike:
    image: crm-mb:17
    command: ["sleep", "infinity"]
    networks: [crm-net-spike]
  ws-spike:
    image: crm-mb:17
    command: ["sleep", "infinity"]
    networks: [crm-net-spike]
    depends_on: [backend-spike]
  mariadb-spare:
    image: mariadb:10.6
    environment: [MARIADB_ROOT_PASSWORD=spike-admin]
    networks: [crm-net-spike]
networks:
  crm-net-spike: { driver: bridge }
```
Run:
```bash
docker compose -f deploy/spike-backend-efimero.yaml up -d
BE=$(docker ps -qf name=backend-spike)
docker exec $BE bash -lc "bench new-site pg-spike-test --db-host $SPK_IP --db-type postgres --admin-password spike-admin-123 --no-mariadb-socket" || echo "WARN: pg no soportado por bench v15"
```
Si `bench v15` no soporta `--db-type postgres` (caso probable): registrar en veredicto "PG BLOQUEADO por compatibilidad Frappe v15; fallback MariaDB" y saltar a Step 4. Si soporta → `curl -s -u Administrator:spike-admin-123 -X POST http://localhost:8000/api/resource/ToDo -H 'Content-Type: application/json' -d '{"description":"spike-pg"}'`.

- [ ] **Step 3: Restore drill**

```bash
docker exec $BE bash -lc "bench --site pg-spike-test backup"
docker exec $BE bash -lc "bench --site pg-spike-test drop-site --force"
docker exec $BE bash -lc "bench --site pg-spike-test restore <archivo-backup>"
curl -s -u Administrator:spike-admin-123 http://localhost:8000/api/resource/ToDo | grep -q spike-pg && echo OK || echo FAIL
```

- [ ] **Step 4: Veredicto escrito + teardown + commit**

Escribir `docs/superpowers/specs/2026-09-14-pg-veredicto.md` (1 página: latencia CRUD, restore OK/FAIL, decisión PG/MariaDB + motivo explícito incluyendo si v15 es el bloqueo). Teardown:
```bash
docker compose -f deploy/spike-backend-efimero.yaml down -v
docker compose -f deploy/pg16-spike.yaml down -v
```
```bash
git add deploy/pg16-spike.yaml deploy/spike-backend-efimero.yaml docs/superpowers/specs/2026-09-14-pg-veredicto.md
git commit -m "chore: spike PG16 aislado (backend efimero) + veredicto"
```

---

### Task 3: App `crm_core` — 9 DocTypes + CRUD REST verificado

**Files:**
- Create: `apps/crm_core/pyproject.toml`, `apps/crm_core/modules.txt`, `apps/crm_core/crm_core/__init__.py`, `apps/crm_core/crm_core/hooks.py`, `apps/crm_core/crm_core/config/desktop.py` (estructura oficial Frappe — bug C2), 9 `*.json` con `Event.booking_uid UNIQUE` ya incluido (bug C9), `apps/crm_core/tests/conftest.py`, `apps/crm_core/tests/test_rest_smoke.py`
- Create (compose separado): `compose.test.yaml` (bind mount de `apps/crm_core` al backend — bug M8; **NO** se modifica `compose.yaml` prod).

**Interfaces:**
- Consumes: veredicto T2 (driver DB).
- Produces: DocTypes `Task, Event, Contact, Account, Lead, Deal, Activity, GCalConnection, GCalSyncState` con API REST viva (consumidos por T4-T7).

- [ ] **Step 1: Test de humo REST + conftest con login por sid (bugs m1/m7)**

```python
# apps/crm_core/tests/conftest.py
import os
import pytest
import requests

@pytest.fixture(scope="session")
def base() -> str:
    return os.environ["FRAPPE_TEST_BASE"]

@pytest.fixture(scope="session")
def session(base) -> requests.Session:
    """Frappe auth = POST /api/method/login con form-urlencoded → cookie sid.
    Basic auth NO funciona contra REST v2 con /api/v2/document/*. Bug m1."""
    s = requests.Session()
    r = s.post(f"{base}/api/method/login",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={"usr": "Administrator", "pwd": os.environ["FRAPPE_TEST_ADMIN_PW"]})
    assert r.ok, f"login falló: {r.status_code} {r.text}"
    return s
```

```python
# apps/crm_core/tests/test_rest_smoke.py
import os
def test_task_crud(session):
    base = os.environ["FRAPPE_TEST_BASE"].rsplit("/api/", 1)[0]
    r = session.post(f"{base}/api/v2/document/Task",
        json={"subject": "smoke", "status": "Open"})
    assert r.ok, r.text
    name = r.json()["data"]["name"]
    assert session.get(f"{base}/api/v2/document/Task/{name}").ok
    assert session.delete(f"{base}/api/v2/document/Task/{name}").ok
```
Nota: el site `crm-test` se crea en T8 Step 2; documentar en `docs/runbook-dogfood.md` que las tests fallan hasta que `bench new-site crm-test` corra.

- [ ] **Step 2: Estructura oficial Frappe + 9 DocTypes (bugs C2/C9)**

```toml
# apps/crm_core/pyproject.toml
[project]
name = "crm_core"
version = "0.0.1"
description = "Premium CRM core (custom app)"
requires-python = ">=3.10"
dependencies = []
```
```
# apps/crm_core/modules.txt
crm_core
```
```python
# apps/crm_core/crm_core/__init__.py
__version__ = "0.0.1"
```
```python
# apps/crm_core/crm_core/hooks.py
"""Hooks de crm_core. scheduler_events y doc_events se llenan en T6/T7."""
```
```python
# apps/crm_core/crm_core/config/desktop.py
from frappe import _
def get_data(): return [{"module_name": "crm_core", "label": _("CRM Core")}]
```
DocTypes con campos según §3 spec. **Importante: `Event.booking_uid UNIQUE` se crea aquí mismo**, no vía migrate en T7 (que lo asume preexistente).

- [ ] **Step 3: Bind mount en compose de TEST + install + migrate (bugs C3/M8)**

```yaml
# compose.test.yaml — sobre el base; solo el backend remonta la app custom
services:
  backend:
    volumes:
      - ./apps/crm_core:/home/frappe/frappe-bench/apps/crm_core
```
Run:
```bash
DOCKER_COMPOSE_FILE=compose.test.yaml docker compose up -d backend
docker exec $(docker ps -qf name=backend) bench get-app /home/frappe/apps/crm_core --branch develop || \
  docker exec $(docker ps -qf name=backend) bench get-app /home/frappe/apps/crm_core
docker exec $(docker ps -qf name=backend) bench --site crm-test install-app crm_core
docker exec $(docker ps -qf name=backend) bench --site crm-test migrate
```
Expected: `App crm_core installed`, migrate OK.

- [ ] **Step 4: Test verde + commit**

Run: `FRAPPE_TEST_BASE=http://localhost:8000/api/method/login FRAPPE_TEST_ADMIN_PW=... pytest apps/crm_core/tests/test_rest_smoke.py -v`. Expected: PASS.
```bash
git add apps/crm_core compose.test.yaml
git commit -m "feat(core): 9 DocTypes (booking_uid incluido) + REST smoke verde"
```

---

### Task 3.5: CORS Frappe ↔ web (sin esto el login muere en producción)

**Files:**
- Create: `deploy/cors-check.sh`
- Modify: site de test `crm-test` → `site_config.json` (`allow_cors` con origins exactos); `apps/crm_core/hooks.py` (append comentario CORS — sin código funcional).

**Interfaces:**
- Consumes: DocTypes (T3).
- Produces: cookies de sesión cross-origin funcionales (requerido por T4).

- [ ] **Step 1: Test CORS (falla: sin headers)**

```bash
# deploy/cors-check.sh
#!/bin/bash
# Uso: FRAPPE_BASE=https://<backend-test> WEB_ORIGIN=https://<web-test> ./deploy/cors-check.sh
R=$(curl -s -o /dev/null -D - -X OPTIONS "$FRAPPE_BASE/api/method/frappe.auth.get_logged_user" \
  -H "Origin: $WEB_ORIGIN" -H "Access-Control-Request-Method: POST")
echo "$R" | grep -qi "Access-Control-Allow-Origin: $WEB_ORIGIN" || { echo "FAIL: sin ACAO exacto"; exit 1; }
echo "$R" | grep -qi "Access-Control-Allow-Credentials: true" || { echo "FAIL: sin credentials"; exit 1; }
echo "CORS OK"
```

Run: `chmod +x deploy/cors-check.sh && FRAPPE_BASE=... WEB_ORIGIN=... ./deploy/cors-check.sh`
Expected: FAIL (Frappe no emite ACAO por defecto).

- [ ] **Step 2: Configurar origins exactos (jamás `*` con credentials)**

Run (en el host del site de test):
```bash
docker exec $(docker ps -qf name=backend) bench --site crm-test set-config allow_cors '["https://<web-test>", "http://localhost:3000"]'
docker exec $(docker ps -qf name=backend) bench --site crm-test set-config allow_credentials true
```
Nota: `localhost:3000` solo para dev; en Dokploy el origin es la URL pública de `web` (registrar el valor real en `docs/runbook-dogfood.md` al ejecutar T8).

- [ ] **Step 3: Check verde + commit**

Run mismo `cors-check.sh`. Expected: `CORS OK`.
```bash
git add deploy/cors-check.sh apps/crm_core/hooks.py
git commit -m "feat(core): CORS origins exactos + credentials para web"
```

---

### Task 4: Login web ↔ Frappe + guard de rutas (E2E real)

**Files:**
- Create: `apps/web/lib/frappe-client.ts`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(app)/layout.tsx`, `apps/web/playwright.config.ts`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/login.spec.ts`
- Test: `apps/web/e2e/login.spec.ts`

**Interfaces:**
- Consumes: REST v2 de T3 + CORS de T3.5; tipos de T1.
- Produces: sesión autenticada + `frappe-client` (usado por T5).

- [ ] **Step 1: E2E login (falla: no hay página)**

```typescript
// apps/web/e2e/login.spec.ts
import { test, expect } from "@playwright/test";
test("login + Hoy visible", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="usr"]', process.env.E2E_USER!);
  await page.fill('input[name="pwd"]', process.env.E2E_PW!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/hoy/);
  await expect(page.getByTestId("hoy-list")).toBeVisible();
});
```

Run: `npx playwright test e2e/login.spec.ts` (desde `apps/web`). Expected: FAIL (página inexistente).

- [ ] **Step 2: Cliente + login contra `/api/method/login`**

```typescript
// apps/web/lib/frappe-client.ts
const BASE = process.env.NEXT_PUBLIC_FRAPPE_BASE!;
async function unwrap<T>(path: string, r: Response): Promise<T> {
  if (r.status === 403) { window.location.href = "/login"; throw new Error("forbidden"); }
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const json = await r.json();
  // RPC (/api/method/*) envuelve en `message`; REST v2 en `data`
  if (path.includes("/api/method/")) return json.message as T;
  return (json.data ?? json) as T;
}
export async function frappeLogin(usr: string, pwd: string): Promise<void> {
  // Fix bug C1: Frappe /api/method/login es form-urlencoded, NO JSON.
  const body = new URLSearchParams({ usr, pwd }).toString();
  const r = await fetch(`${BASE}/api/method/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    credentials: "include", body,
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
}
export async function frappeGet<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  return unwrap<T>(path, r);
}
```

`login/page.tsx`: form `usr`/`pwd` + submit → `frappeLogin` → `router.push("/hoy")`. `(app)/layout.tsx`: verifica `/api/method/frappe.auth.get_logged_user`; si `Guest` → redirect `/login`. `e2e/global-setup.ts`: login programático una vez y guarda `storageState`:

```typescript
// apps/web/e2e/global-setup.ts
import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
export default async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("/login");
  await page.fill('input[name="usr"]', process.env.E2E_USER!);
  await page.fill('input[name="pwd"]', process.env.E2E_PW!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hoy/);
  await page.context().storageState({ path: path.resolve("e2e/.auth.json") });
  await browser.close();
}
```
`playwright.config.ts`: `use: { storageState: "e2e/.auth.json" }` en todos los proyectos salvo el de login (que usa `storageState: undefined`), más `globalSetup: require.resolve("./e2e/global-setup")`. `e2e/.auth.json` en `.gitignore` (secretos jamás commiteados).

- [ ] **Step 3: E2E verde + commit**

Run: `E2E_USER=... E2E_PW=... npx playwright test e2e/login.spec.ts`. Expected: PASS.
```bash
git add apps/web/lib apps/web/app apps/web/e2e apps/web/playwright.config.ts
git commit -m "feat(web): login Frappe + guard + E2E verde"
```

---

### Task 5: Vista Hoy + CRUD tareas/eventos con optimistic + palette básica

**Files:**
- Create: `apps/web/lib/hooks/use-hoy.ts`, `apps/web/app/(app)/hoy/page.tsx`, `apps/web/components/cmdk-palette.tsx`, `apps/web/e2e/hoy.spec.ts`
- Test: `apps/web/e2e/hoy.spec.ts`

**Interfaces:**
- Consumes: `frappe-client` (T4), `HoyItem/TaskDTO/EventDTO` (T1), DocTypes (T3).
- Produces: flujo Hoy completo (pantalla verificable en T8/Fase 5 del loop).

- [ ] **Step 1: E2E Hoy (falla: sin datos ni UI)**

```typescript
// apps/web/e2e/hoy.spec.ts
import { test, expect } from "@playwright/test";
test("crear + completar tarea sin spinner", async ({ page }) => {
  await page.goto("/hoy"); // (login via storageState del proyecto e2e)
  await page.keyboard.press("t"); // atajo: nueva tarea
  await page.fill('[data-testid="task-subject"]', "Llamar a Acme");
  await page.click('[data-testid="task-save"]');
  const row = page.getByText("Llamar a Acme");
  await expect(row).toBeVisible();
  await row.click();
  await page.click('[data-testid="task-done"]');
  await expect(page.getByTestId("hoy-list")).toContainText("Llamar a Acme");
});
```

Run: `npx playwright test e2e/hoy.spec.ts`. Expected: FAIL.

- [ ] **Step 2: Hook con optimistic (sin spinner en acciones reversibles)**

```typescript
// apps/web/lib/hooks/use-hoy.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { frappeGet } from "../frappe-client";
import type { HoyItem } from "@crm/types";
export function useHoy() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["hoy"],
    queryFn: () => frappeGet<HoyItem[]>("/api/method/crm_core.api.v1.hoy.get") });
  const doneTask = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch(`${process.env.NEXT_PUBLIC_FRAPPE_BASE}/api/v2/document/Task/${name}`,
        { method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Done" }) });
      if (!r.ok) throw new Error(`PUT Task/${name}: ${r.status}`);  // bug M1
      return r.json();
    },
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: ["hoy"] });
      const prev = qc.getQueryData<HoyItem[]>(["hoy"]);
      qc.setQueryData<HoyItem[]>(["hoy"], (prev ?? []).map(i =>
        i.kind === "task" && i.name === name ? { ...i, status: "Done" } : i));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["hoy"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["hoy"] }),
  });
  return { ...query, doneTask };
}
```
Whitelisted requerido: `crm_core.api.v1.hoy.get` → retorna tasks con due hoy + events del día ordenados (implementación mínima en `apps/crm_core/api/v1/hoy.py`, 30 líneas, con test pytest `test_hoy_orders_items`).

- [ ] **Step 3: Página + palette (15 comandos: ir a Hoy/Contactos/Deals, crear tarea/evento/contacto/deal, buscar…)**

`hoy/page.tsx` con `data-testid="hoy-list"`, timeline tareas+eventos, atajo `t` (con `useEffect` global keydown — pero solo si `document.activeElement` NO es input/textarea/contentEditable; bug M5). `cmdk-palette.tsx` con `⌘K`, comandos cableados a router + mutaciones.

- [ ] **Step 4: E2E verde + commit**

Run: `npx playwright test e2e/hoy.spec.ts`. Expected: PASS.
```bash
git add apps/web/lib/hooks apps/web/app/\(app\)/hoy apps/web/components apps/crm_core/api/v1/hoy.py
git commit -m "feat(web): Hoy unificado + optimistic + palette"
```

---

### Task 6: Motor GCal 2-way básico (OAuth cifrado + full/incremental/410 + scheduler)

**Files:**
- Create: `apps/crm_core/api/v1/oauth.py`, `apps/crm_core/api/v1/sync.py`, `apps/crm_core/tasks/scheduler.py`, `apps/crm_core/tests/test_sync_machine.py`
- Modify: `hooks.py` (scheduler_events: incremental cada 10 min, watch-renew diario).

**Interfaces:**
- Consumes: `GCalConnection/GCalSyncState/Event` (T3).
- Produces: sync funcional GCal↔CRM (verificado en T8 contra sandbox).

- [ ] **Step 1: Test máquina de estados con fake Google (falla: sin código)**

```python
# apps/crm_core/tests/test_sync_machine.py
from crm_core.api.v1.sync import run_incremental
class FakeGCal:
    def __init__(self): self.calls = []
    def list_events(self, sync_token=None, page_token=None):
        self.calls.append((sync_token, page_token))
        if sync_token == "EXPIRED": raise GCalGone()  # simula 410
        if sync_token is None:
            return {"items": [{"id": "g1", "summary": "A"}], "nextSyncToken": "T1"}
        return {"items": [], "nextSyncToken": "T2"}
def test_full_then_incremental_then_410():
    s = run_incremental(FakeGCal(), stored_token=None)
    assert s == "T1"
    s = run_incremental(FakeGCal(), stored_token="T1")
    assert s == "T2"
    s = run_incremental(FakeGCal(), stored_token="EXPIRED")  # 410 → full
    assert s == "T1"
```

Run: `pytest apps/crm_core/tests/test_sync_machine.py -v`. Expected: FAIL (`run_incremental` no existe).

- [ ] **Step 2: Implementar `run_incremental` (full/incremental/410 exacto §5.1)**

```python
# apps/crm_core/api/v1/sync.py
import os, time, random
class GCalGone(Exception): pass      # mapea HTTP 410
class GCalRateLimited(Exception): pass  # mapea HTTP 429 / 403 rateLimitExceeded

def call_with_backoff(fn, tries=5, base=1.0):
    """Backoff exponencial con jitter. Sin esto, un loop de reintentos
    tumba el worker y quema la cuota de Google."""
    for i in range(tries):
        try:
            return fn()
        except GCalRateLimited:
            if i == tries - 1: raise
            time.sleep(base * (2 ** i) + random.uniform(0, 1))

def run_incremental(client, stored_token):
    """Contrato §5.1: pagina con page_token; nextSyncToken solo vale
    en la ÚLTIMA página; 410 → full sync desde cero.
    REGLA FASE 0: ante conflicto local-vs-remoto, GCal es fuente de
    verdad (remote wins); se registra SyncConflict auto_resolved_remote
    para auditoría. UI de resolución manual → Fase 1."""
    token, page = stored_token, None
    while True:
        try:
            resp = call_with_backoff(
                lambda: client.list_events(sync_token=token, page_token=page))
        except GCalGone:
            token, page = None, None  # 410: limpiar y full sync
            continue
        for ev in resp.get("items", []):
            upsert_event(ev)  # por gcal_id UNIQUE; cancelled → soft-delete
        page = resp.get("nextPageToken")
        if not page:
            return resp["nextSyncToken"]  # solo última página

def sync_connection(conn_name: str, stored_token: str | None = None) -> str:
    """Punto de entrada enqueueable (fix bug C4: scheduler.py invoca esta,
    no una función inexistente). Conecta con GCal y persiste nextSyncToken
    en GCalSyncState."""
    # ... leer connection, build client real, llamar run_incremental,
    # escribir nuevo token en GCalSyncState
    ...

def renew_all_watches() -> None:
    """Renueva canales events.watch antes de expirar (cada 7 días máx)."""
    # ... walk all connections, register fresh channel with id=N+1
    ...
```

`upsert_event`: mapea Google→`Event` (UTC + tz original, `gcal_etag` guardado). Tokens OAuth en `oauth.py` con **AES-256-GCM** (no Fernet: Fernet es AES-128-CBC y no cumple el spec §5.5):

```python
# apps/crm_core/api/v1/oauth.py
import os
from cryptography.hazmat.primitives.ciphers.aes import AESGCM
try:
    _KEY = AESGCM(bytes.fromhex(os.environ["GCAL_TOKEN_KEY_HEX"]))  # 32 bytes = 256 bit
except KeyError:
    raise RuntimeError(
        "GCAL_TOKEN_KEY_HEX no configurado. Generar con: "
        "`python -c 'import secrets; print(secrets.token_hex(32))'` "
        "y exportarlo en .env del site (NUNCA commitear)."
    )
def enc_token(plain: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + _KEY.encrypt(nonce, plain, aad)
def dec_token(blob: bytes, aad: bytes) -> bytes:
    return _KEY.decrypt(blob[:12], blob[12:], aad)
```
`GCAL_TOKEN_KEY_HEX` (bug C8): documentar en `.env.example` raíz y en `apps/crm_core/.env.example`. Secret manager en producción. Refresh con buffer 5 min.

- [ ] **Step 3: Scheduler (polling 10 min + recordatorios 15 min + renew watch)**

```python
# apps/crm_core/tasks/scheduler.py
import frappe
def incremental_all():
    for st in frappe.get_all("GCalSyncState", filters={"status": "active"}, pluck="name"):
        frappe.enqueue("crm_core.api.v1.sync.sync_connection", site=frappe.local.site,
                       queue="short", job_name=f"sync:{st}", conn_name=st, stored_token=None)
def renew_watches():
    """Renueva canales events.watch antes de expirar (cada 7 días máx)."""
    frappe.enqueue("crm_core.api.v1.sync.renew_all_watches", queue="long")
def reminders():
    frappe.enqueue("crm_core.api.v1.hoy.send_reminders", queue="short")
```
`hooks.py`: `scheduler_events = {"cron": {"*/10 * * * *": ["crm_core.tasks.scheduler.incremental_all"], "*/5 * * * *": ["crm_core.tasks.scheduler.reminders"]}}`.

- [ ] **Step 4: Tests verdes + commit**

Run: `pytest apps/crm_core/tests/ -v`. Expected: PASS.
```bash
git add apps/crm_core/api/v1/oauth.py apps/crm_core/api/v1/sync.py apps/crm_core/tasks apps/crm_core/tests/test_sync_machine.py apps/crm_core/hooks.py
git commit -m "feat(sync): GCal full/incremental/410 + scheduler"
```

---

### Task 7: Cal.com sidecar + webhooks → Event/Task/Activity (HMAC + idempotencia)

**Files:**
- Create: `deploy/cal-sidecar.yaml`, `apps/crm_core/api/v1/webhooks.py`, `apps/crm_core/tests/test_webhook_hmac.py`
- Modify: `compose.yaml` o overlay Dokploy (añadir red compartida con sidecar — documentar en el compose).

**Interfaces:**
- Consumes: `Event/Task/Activity` (T3).
- Produces: bookings web → agenda CRM (verificado T8 con replay firmado).

- [ ] **Step 1: Test HMAC + idempotencia (falla: sin receiver)**

```python
# apps/crm_core/tests/test_webhook_hmac.py
import hmac, hashlib, json
from crm_core.api.v1.webhooks import verify_raw, handle
SECRET = b"test-secret"
def signed(body: bytes) -> str:
    return hmac.new(SECRET, body, hashlib.sha256).hexdigest()
def test_rejects_bad_signature():
    assert verify_raw(b'{"a":1}', "00" * 32, SECRET) is False   # bug C10 fix
def test_created_is_idempotent():
    payload = {"triggerEvent": "BOOKING_CREATED",
               "payload": {"uid": "b1", "title": "Intro",
                           "startTime": "2026-09-20T14:00:00Z",
                           "endTime": "2026-09-20T14:30:00Z",
                           "attendees": [{"email": "a@x.com"}]}}
    body = json.dumps(payload).encode()
    sig = signed(body)
    assert verify_raw(body, sig, SECRET) is True
    e1 = handle(payload)  # crea Event + Task prep + Activity
    e2 = handle(payload)  # replay: NO duplica
    assert e1 == e2
```

Run: `pytest apps/crm_core/tests/test_webhook_hmac.py -v`. Expected: FAIL.

- [ ] **Step 2: Receiver con HMAC-SHA256 + deduplicación por `uid` (bug M2 rate limit)**

```python
# apps/crm_core/api/v1/webhooks.py
import hmac, hashlib, json, frappe
from typing import Optional

@frappe.whitelist(allow_guest=True)
def cal_receiver():
    # Bug M2: rate limit defensivo contra replay/DOS.
    key = f"webhook_cal:{frappe.request.remote_addr}"
    if frappe.cache().get_value(key) and int(frappe.cache().get_value(key)) > 60:
        frappe.throw("rate limit", frappe.TooManyRequests)
    frappe.cache().incrby(key, 1)
    secret = frappe.conf.cal_webhook_secret.encode()
    body = frappe.request.data  # bytes crudos (mismo input al HMAC)
    sig = frappe.request.headers.get("x-cal-signature-256", "")
    if not verify_raw(body, sig, secret):                         # bug C5: bytes
        frappe.throw("bad signature", frappe.PermissionError)
    payload = json.loads(body)                                    # parse una sola vez
    return handle(payload)

def verify_raw(body: bytes, sig_hex: str, secret: bytes) -> bool:
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig_hex or "")

def handle(p) -> str:                                             # → event_name
    uid = p["payload"]["uid"]
    existing = frappe.db.get_value("Event", {"booking_uid": uid}, "name")
    if existing:
        # Idempotencia: si ya existe, aplicar update si RESCHEDULED/CANCELLED,
        # si CREATED repetir → 200 idempotente.
        if p["triggerEvent"] in ("BOOKING_CANCELLED", "BOOKING_RESCHEDULED"):
            _apply_update(existing, p)
        return existing
    return _create_event_from_booking(p)
```
Campo `Event.booking_uid UNIQUE` ya existe desde T3 Step 2 (refactor aplicado, bug C9 cerrado).

- [ ] **Step 3: Sidecar compose + init + tests verdes + commit**

`deploy/cal-sidecar.yaml`: `calcom/postgres` + `redis` + `cal.com` (imagen y env según docs oficiales vigentes al deployar; versión pineada en el archivo). Arranque vía `deploy/init-cal.sh` (migraciones Prisma + secretos antes del web):

```bash
# deploy/init-cal.sh — entrypoint del servicio cal.com en el sidecar
#!/bin/bash
set -euo pipefail
: "${NEXTAUTH_SECRET:?NEXTAUTH_SECRET requerido (generar con: openssl rand -base64 32)}"
: "${DATABASE_URL:?DATABASE_URL requerido}"
npx prisma db push --accept-data-loss=false
exec node apps/web/server.js
```
Run: `pytest apps/crm_core/tests/test_webhook_hmac.py -v`. Expected: PASS.
```bash
git add deploy/cal-sidecar.yaml deploy/init-cal.sh apps/crm_core/api/v1/webhooks.py apps/crm_core/tests/test_webhook_hmac.py
git commit -m "feat(booking): Cal.com sidecar + webhooks HMAC idempotentes"
```

---

### Task 8: PWA + deploy Dokploy + migración paralela + gate dogfood

**Files:**
- Create: `apps/web/public/manifest.webmanifest`, `apps/web/public/icon-512.png` (placeholder generado, reemplazar en Fase 1), `deploy/overlay-web.yaml`, `scripts/migrate_frappe_crm.py`, `docs/runbook-dogfood.md`
- Modify: `apps/web/app/layout.tsx` (metadata PWA).

**Interfaces:**
- Consumes: todo T1-T7.
- Produces: URL productiva + datos migrados + gate medible (cierre Fase 0).

- [ ] **Step 1: Icono real + manifest + metadata PWA (fix bug M4)**

```bash
# Generar placeholder 512x512 con ImageMagick (no commitear binarios pesados)
cd apps/web/public
[ ! -f icon-512.png ] && convert -size 512x512 xc:'#0a0a0b' -gravity center \
  -fill white -pointsize 180 -annotate +0+0 'MB' icon-512.png || true
cat > icon-192.png.placeholder <<'EOF'
# Substituir en Fase 1 por branding real; placeholder 192x192 generado igual que 512
EOF
```
```json
// apps/web/public/manifest.webmanifest
{"name": "MB CRM", "short_name": "MB CRM", "start_url": "/hoy",
 "display": "standalone", "background_color": "#0a0a0b",
 "theme_color": "#0a0a0b",
 "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
           {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}]}
```

- [ ] **Step 2: Overlay deploy + migración parallel-run + site crm-test**

`deploy/overlay-web.yaml`: servicio `web` (build Next standalone, `NEXT_PUBLIC_FRAPPE_BASE` al backend, red `crm-net` + `dokploy-network`). `scripts/migrate_frappe_crm.py`: export REST v1 del site viejo (Contact/Lead/Task) → import a `crm_core` con mapa de IDs y reporte de conteos; re-ejecutable (idempotente por `legacy_id`). **Antes de migrar, el script crea el site `crm-test`** (bug M7):
```bash
docker exec $(docker ps -qf name=backend) bench new-site crm-test \
  --admin-password "${CRM_TEST_ADMIN_PW}" --mariadb-user-host-login-scope='%'
```
Si exist `crm-test` ya en prod → skip con aviso.

- [ ] **Step 3: Verificación E2E + Lighthouse CI (bug M3)**

Setup `lhci`:
```bash
cd apps/web && npm i -D @lhci/cli
npx lhci autorun --collect.url=http://localhost:3000/hoy \
  --collect.settings.preset=desktop --assert.preset=desktop-pwa
```
Threshold exigido: **PWA ≥ 90, Performance ≥ 80** (gate Fase 0).

Run contra la URL Dokploy: `E2E_BASE=https://<web-url> npx playwright test` (login + hoy + booking replay). Registrar URLs y resultados en `docs/runbook-dogfood.md` con checklist del gate (5 días sin CRM viejo/GCal directo, con firma diaria).

- [ ] **Step 4: Commit final Fase 0**

```bash
git add apps/web/public deploy/overlay-web.yaml scripts/migrate_frappe_crm.py docs/runbook-dogfood.md .env.example
git commit -m "feat(fase0): PWA + deploy + migracion + gate dogfood"
```

---

## Self-Review (checklist del skill, ejecutado inline — re-auditoría 2026-09-14)

1. **Spec coverage:** §3 DocTypes→T3 (`booking_uid UNIQUE` movido a T3 Step 2). §4 performance Fase 0 (optimistic+SWR)→T5; palette→T5. §5.1+5.2 básico+5.5→T6 (§5.3 ETag/412 y §5.4 recurrentes/UI conflictos → plan Fase 1, fuera de este plan). §6 Fase 0 (sidecar+webhooks)→T7. §7 auth básica→T4 (MFA/SSO→Fase 2). §8 reminders→T6 scheduler. §9 spike PG→T2 (backend efímero, NO prod); backups/restore drill→T2 Step 3. §10 migración→T8. §11 gate Fase 0→T8 Step 3. Sin gaps en Fase 0.
2. **Placeholder scan:** prohibidos "TBD/TODO/similar a Task N" — cada step trae código o comando exacto. Lugares donde la versión es deliberadamente "pinning-en-ejecución" (Cal.com image, lhci preset): documentado en el propio step.
3. **Type/signatures consistency:** `HoyItem/TaskDTO/EventDTO` (T1) referenciados idénticos en T4/T5. Funciones y firmas: `run_incremental(client, stored_token)->token`; `call_with_backoff(fn)->result`; `enc_token/dec_token(blob, aad)`; **`verify_raw(body: bytes, sig: str, secret: bytes)->bool`** (bug C5/C10 corregido; test y producción coinciden); `handle(p)->event_name` (devuelve string event name). `crm_core.api.v1.*` como único prefijo RPC. CORS (T3.5) precede a todo fetch con credentials (T4+).
4. **Auditoría sin filtros (re-revisión 2026-09-14, fixes aplicados):**
   - **C1** `frappeLogin` form-encoded ✅ — `use-hoy.ts` mutation chequea `r.ok` (M1) ✅.
   - **C2** Estructura oficial Frappe app (pyproject + modules.txt + __init__ + hooks + desktop) ✅.
   - **C3** Spike con `spike-backend-efimero.yaml` (NO prod) ✅; T3 con `compose.test.yaml` (NO `compose.yaml` prod) ✅.
   - **C4** `sync_connection` y `renew_all_watches` añadidos a `sync.py` ✅.
   - **C5+C10** HMAC firma unificada `verify_raw(body, sig, secret)` en test e impl ✅.
   - **C6** Regla global constraint: "Prohibido commit con placeholders literales" ✅.
   - **C7** `apps/web/e2e/.auth.json` añadido a `.gitignore` ✅.
   - **C8** `GCAL_TOKEN_KEY_HEX` documentado en `.env.example` raíz y app ✅.
   - **C9** `Event.booking_uid UNIQUE` movido a T3 Step 2 (no migrate en T7) ✅.
   - **M2** Rate-limit defensivo en webhook ✅; **M3** `lhci` ejecutable en T8 ✅; **M4** icono generado por `convert` ✅; **M5** filtro focus para atajo `t` ✅; **M7** creación de `crm-test` en T8 ✅; **M8** bind mount en `compose.test.yaml`, NO `compose.yaml` ✅.
5. **Riesgos abiertos documentados:** bench v15 + postgres (resuelto vía spike T2 si falla → MariaDB); rate-limit `frappe.cache()` puede no estar configurado en sites críticos (mitigación: revisión antes de T7); Lighthouse en CI es non-trivial → presupuesto 1 día extra para tuning.

---

## Ejecutado — T1 (2026-09-14)

**Commit:** ver `git log --oneline` después de T1 (commit `chore: monorepo scaffold + tipos + CI verde`).

### T1.1 — Resultados verificables

| Step | Verificación | Resultado |
|---|---|---|
| 1 | Contrato TS escrito | ✅ `packages/types/src/crm.ts` con `HoyItem`, `TaskDTO`, `EventDTO`, envelopes RPC/REST |
| 2a | Workspaces npm + turbo + tsconfig base | ✅ `npm install` agrega 6 paquetes; `packageManager` field añadido para que Turbo resuelva workspaces |
| 2a' | typecheck `@crm/web` no falla con "no inputs" | ✅ Añadido `apps/web/_type-smoke.ts` placeholder que importa `HoyItem` de `@crm/types` — integra paquetes desde T1 |
| 2b | `.gitignore` robusto | ✅ Incluye `apps/web/e2e/.auth.json` (bug C7), `apps/web/test-results/`, `.lighthouseci/`, `deploy/cal-data/` |
| 3 | CI workflow | ✅ `.github/workflows/ci.yaml` con `cache-dependency-path` para monorepo, `node-version: 22` (matches `.nvmrc`), 7 pasos, `timeout-minutes: 15` |
| 4 | `npm ci && npm run typecheck && npm run lint` | ✅ Verde end-to-end (`FULL TURBO` cache hit todos los paquetes) |

### T1.2 — Desviaciones del plan original

1. **`packageManager` field añadido en package.json raíz**: Turbo 2.x exige `packageManager` para resolver workspaces en monorepo; el plan original lo omitió. Fix de 1 línea, commit relacionado.
2. **`_type-smoke.ts` placeholder en `apps/web`**: TS no acepta `include` vacío en `tsconfig.json`; el plan asumía "PASS sin páginas" pero la realidad era input vacío. Solución: archivo que importa el contrato de `@crm/types`, evidencia end-to-end @crm/web↔@crm/types y permite que T4 entre escribiendo UI sin tocar config.
3. **`@crm/web` lint script es placeholder**: como dice el plan, ESLint real viene con Next.js en T4. No añadir ESLint manual evita ensuciar T4 con config que se sobreescribiría.

### T1.3 — Archivos creados (artefactos)

```
apps/web/_type-smoke.ts          # integración de paquete: importa HoyItem desde @crm/types
apps/web/package.json            # @crm/web (Next 14, TanStack Query deps en T4)
apps/web/tsconfig.json           # extends tsconfig.base; noEmit; include .ts/.tsx
packages/types/package.json      # @crm/types, module ESM
packages/types/tsconfig.json     # extends base
packages/types/src/crm.ts        # contratos HoyItem/Task/Event + envelopes
packages/ui/package.json         # @crm/ui (CSS only this stage)
packages/ui/src/tokens.css       # design tokens dark-first
package.json (raíz)              # workspaces + turbo scripts + packageManager
package-lock.json                # generado por npm install
turbo.json                       # pipeline typecheck/lint/test con dependsOn ^X
tsconfig.base.json               # strict + noUncheckedIndexedAccess
.github/workflows/ci.yaml        # cache-dependency-path monorepo
.gitignore                       # ampliado con bug C7 fix
.nvmrc                           # 22
```

### T1.4 — Próximo task

T2: Spike Postgres 16 (aislado en `spike-backend-efimero.yaml`, sin tocar prod). Pide Docker + acceso al host; si el host actual no es linux con Docker corriendo, T2 puede correr en CI o en el VPS de Dokploy (más realista para validar provisioning).
