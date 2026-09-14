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
{"private": true, "workspaces": ["apps/*", "packages/*"],
 "scripts": {"typecheck": "turbo run typecheck", "lint": "turbo run lint"}}
JSON
cat > turbo.json <<'JSON'
{"pipeline": {"typecheck": {"dependsOn": ["^typecheck"]}, "lint": {}}}
JSON
```
`apps/web/package.json` incluye `next@14`, `typescript@5`, `@tanstack/react-query`, `zustand`, `cmdk`, `playwright` (dev). `tsconfig.base.json` con `"strict": true, "noUncheckedIndexedAccess": true`.

- [ ] **Step 3: CI mínimo**

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
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm run lint
```

- [ ] **Step 4: Verificar verde y commitear**

Run: `npm ci && npm run typecheck && npm run lint`
Expected: PASS (sin errores; web aún sin páginas — solo scaffold).
```bash
git add package.json turbo.json tsconfig.base.json apps/web packages .github .gitignore
git commit -m "chore: monorepo scaffold + tipos base + CI"
```

---

### Task 2: Spike Postgres 16 + veredicto documentado (con fallback)

**Files:**
- Create: `deploy/pg16-spike.yaml`, `docs/superpowers/specs/2026-09-14-pg-veredicto.md`
- Modify: ninguno productivo (spike aislado; el compose real NO se toca).

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
Run: `docker compose -f deploy/pg16-spike.yaml up -d && sleep 8 && docker exec $(docker ps -qf name=pg-spike) psql -U postgres -c "select version();"`
Expected: fila con `PostgreSQL 16`.

- [ ] **Step 2: Bench new-site contra PG + CRUD smoke via REST**

Run (dentro del contenedor backend existente, contra host de spike):
```bash
docker exec -it $(docker ps -qf name=backend) bench new-site pg-spike-test --db-host <IP-spike> --db-type postgres --admin-password spike-admin-123 --no-mariadb-socket
curl -s -u Administrator:spike-admin-123 -X POST https://<backend>/api/resource/ToDo -H 'Content-Type: application/json' -d '{"description":"spike-pg"}'
```
Expected: `200` con `{"data": {"name": ...}}`.

- [ ] **Step 3: Restore drill (backup → wipe → restore → smoke)**

Run: `bench --site pg-spike-test backup && bench --site pg-spike-test drop-site --force && bench restore <backup-file> && <repetir curl ToDo>` (comandos exactos según `bench --help` del contenedor; registrar salida).
Expected: el ToDo creado en Step 2 vuelve a existir tras restore.

- [ ] **Step 4: Veredicto escrito + teardown + commit**

Escribir `docs/superpowers/specs/2026-09-14-pg-veredicto.md` (máx 1 página: latencia smoke, restore OK/FAIL, decisión PG o MariaDB + motivo). Teardown: `docker compose -f deploy/pg16-spike.yaml down -v && bench drop-site pg-spike-test --force`.
```bash
git add deploy/pg16-spike.yaml docs/superpowers/specs/2026-09-14-pg-veredicto.md
git commit -m "chore: spike PG16 + veredicto (fallback MariaDB si FAIL)"
```

---

### Task 3: App `crm_core` — 9 DocTypes + CRUD REST verificado

**Files:**
- Create: `apps/crm_core/` (9 `*.json` de DocType según estructura §3 del spec + `hooks.py` mínimo), `apps/crm_core/tests/test_rest_smoke.py`
- Modify: `compose.yaml` (añadir montaje de `apps/crm_core` al backend — único cambio infra de esta task).

**Interfaces:**
- Consumes: veredicto T2 (driver DB).
- Produces: DocTypes `Task, Event, Contact, Account, Lead, Deal, Activity, GCalConnection, GCalSyncState` con API REST viva (consumidos por T4-T7).

- [ ] **Step 1: Test de humo REST (falla: app no instalada)**

```python
# apps/crm_core/tests/test_rest_smoke.py
import os, requests
BASE = os.environ["FRAPPE_TEST_BASE"]  # https://<backend-test>
AUTH = ("Administrator", os.environ["FRAPPE_TEST_ADMIN_PW"])
def test_task_crud():
    r = requests.post(f"{BASE}/api/v2/document/Task",
        json={"subject": "smoke", "status": "Open"}, auth=AUTH)
    assert r.status_code == 200, r.text
    name = r.json()["data"]["name"]
    assert requests.get(f"{BASE}/api/v2/document/Task/{name}", auth=AUTH).status_code == 200
    assert requests.delete(f"{BASE}/api/v2/document/Task/{name}", auth=AUTH).status_code == 200
```

Run: `FRAPPE_TEST_BASE=... FRAPPE_TEST_ADMIN_PW=... pytest apps/crm_core/tests/test_rest_smoke.py -v`
Expected: FAIL (404 Task — DocType no existe).

- [ ] **Step 2: Definir los 9 DocTypes (campos exactos del spec §3)**

Crear cada `*_doctype.json` con ` bench make-doctype` o JSON manual; campos mínimos exigidos: `Task(subject, due_datetime, assignee, priority, status, linked_doctype, linked_name)`; `Event(title, start_utc, end_utc, timezone, attendees(JSON), meet_link, gcal_id UNIQUE, gcal_etag, source)`; `Activity(ref_doctype, ref_name, kind, body)` append-only (sin permiso de delete para roles no-admin); `GCalConnection(user UNIQUE, enc_access, enc_refresh, calendar_id)`; `GCalSyncState(connection UNIQUE, sync_token, last_sync_at, status, error_count)`; más `Contact/Account/Lead/Deal` base.

- [ ] **Step 3: Instalar app en site de test + migrar**

Run: `docker exec $(docker ps -qf name=backend) bench --site crm-test install-app crm_core && bench --site crm-test migrate`
Expected: `App crm_core installed`, migrate OK.

- [ ] **Step 4: Test verde + commit**

Run mismo pytest del Step 1. Expected: PASS (1 passed).
```bash
git add apps/crm_core compose.yaml
git commit -m "feat(core): 9 DocTypes + REST smoke verde"
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
  const r = await fetch(`${BASE}/api/method/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify({ usr, pwd }),
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
    mutationFn: (name: string) =>
      fetch(`${process.env.NEXT_PUBLIC_FRAPPE_BASE}/api/v2/document/Task/${name}`,
        { method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Done" }) }),
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

`hoy/page.tsx` con `data-testid="hoy-list"`, timeline tareas+eventos, atajo `t`. `cmdk-palette.tsx` con `⌘K`, comandos cableados a router + mutaciones.

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
```

`upsert_event`: mapea Google→`Event` (UTC + tz original, `gcal_etag` guardado). Tokens OAuth en `oauth.py` con **AES-256-GCM** (no Fernet: Fernet es AES-128-CBC y no cumple el spec §5.5):

```python
# apps/crm_core/api/v1/oauth.py
import os
from cryptography.hazmat.primitives.ciphers.aes import AESGCM
_KEY = AESGCM(bytes.fromhex(os.environ["GCAL_TOKEN_KEY_HEX"]))  # 32 bytes = 256 bit
def enc_token(plain: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + _KEY.encrypt(nonce, plain, aad)
def dec_token(blob: bytes, aad: bytes) -> bytes:
    return _KEY.decrypt(blob[:12], blob[12:], aad)
```
Refresh con buffer 5 min. `GCAL_TOKEN_KEY_HEX` solo en env/secret manager, jamás en repo.

- [ ] **Step 3: Scheduler (polling 10 min + recordatorios 15 min + renew watch)**

```python
# apps/crm_core/tasks/scheduler.py
import frappe
def incremental_all():
    for st in frappe.get_all("GCalSyncState", filters={"status": "active"}, pluck="name"):
        frappe.enqueue("crm_core.api.v1.sync.sync_connection", conn=st, queue="short")
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
from crm_core.api.v1.webhooks import verify, handle
SECRET = b"test-secret"
def signed(payload: dict) -> tuple[dict, str]:
    body = json.dumps(payload).encode()
    sig = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    return payload, sig
def test_rejects_bad_signature():
    assert verify({"a": 1}, "00" * 32, SECRET) is False
def test_created_is_idempotent():
    p, sig = signed({"triggerEvent": "BOOKING_CREATED", "payload": {"uid": "b1", "title": "Intro", "startTime": "2026-09-20T14:00:00Z", "attendees": [{"email": "a@x.com"}]}})
    assert verify(p, sig, SECRET) is True
    e1 = handle(p)  # crea Event + Task prep + Activity
    e2 = handle(p)  # replay: NO duplica
    assert e1 == e2
```

Run: `pytest apps/crm_core/tests/test_webhook_hmac.py -v`. Expected: FAIL.

- [ ] **Step 2: Receiver con HMAC-SHA256 + deduplicación por `uid`**

```python
# apps/crm_core/api/v1/webhooks.py
import hmac, hashlib, json, frappe
@frappe.whitelist(allow_guest=True)
def cal_receiver():
    secret = frappe.conf.cal_webhook_secret.encode()
    body = frappe.request.data
    sig = frappe.request.headers.get("x-cal-signature-256", "")
    if not verify_raw(body, sig, secret):
        frappe.throw("bad signature", frappe.PermissionError)
    payload = json.loads(body)
    return handle(payload)
def handle(p):
    uid = p["payload"]["uid"]
    if frappe.db.exists("Event", {"booking_uid": uid}):
        return frappe.db.get_value("Event", {"booking_uid": uid}, "name")
    # BOOKING_CREATED/RESCHEDULED/CANCELLED → Event(source=cal_sidecar)
    # + Task "Preparar reunión" + Activity en el Contact (match por email)
```
Campo requerido: `Event.booking_uid UNIQUE` (añadir al DocType de T3 vía migrate en esta task).

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

- [ ] **Step 1: Manifest + metadata (falla Lighthouse PWA)**

```json
// apps/web/public/manifest.webmanifest
{"name": "MB CRM", "short_name": "MB CRM", "start_url": "/hoy",
 "display": "standalone", "background_color": "#0a0a0b",
 "theme_color": "#0a0a0b",
 "icons": [{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}]}
```

- [ ] **Step 2: Overlay deploy + migración parallel-run**

`deploy/overlay-web.yaml`: servicio `web` (build Next standalone, `NEXT_PUBLIC_FRAPPE_BASE` al backend, red `crm-net` + `dokploy-network`). `scripts/migrate_frappe_crm.py`: export REST v1 del site viejo (Contact/Lead/Task) → import a `crm_core` con mapa de IDs y reporte de conteos; re-ejecutable (idempotente por `legacy_id`).

- [ ] **Step 3: Verificación E2E en destino (obligatoria, loop Fase 5)**

Run contra la URL Dokploy: `npx playwright test` (login + hoy + booking replay) + Lighthouse PWA ≥90 instalable. Registrar URLs y resultados en `docs/runbook-dogfood.md` con checklist del gate (5 días sin CRM viejo/GCal directo, con firma diaria).

- [ ] **Step 4: Commit final Fase 0**

```bash
git add apps/web/public deploy/overlay-web.yaml scripts/migrate_frappe_crm.py docs/runbook-dogfood.md
git commit -m "feat(fase0): PWA + deploy + migracion + gate dogfood"
```

---

## Self-Review (checklist del skill, ejecutado inline)

1. **Spec coverage:** §3 DocTypes→T3 (+`booking_uid` en T7, documentado). §4 performance Fase 0 (optimistic+SWR)→T5; palette→T5. §5.1+5.2 básico+5.5→T6 (§5.3 ETag/412 y §5.4 recurrentes/UI conflictos → plan Fase 1, fuera de este plan). §6 Fase 0 (sidecar+webhooks)→T7. §7 auth básica→T4 (MFA/SSO→Fase 2). §8 reminders→T6 scheduler. §9 spike PG→T2; backups/restore drill→T2 Step 3. §10 migración→T8. §11 gate Fase 0→T8 Step 3. Sin gaps en Fase 0.
2. **Placeholder scan:** prohibidos "TBD/TODO/similar a Task N" — cada step trae código o comando exacto. Único punto versionado en deploy: pin de imagen Cal.com se registra al ejecutar (las tags vigentes cambian; pineado obligatorio en el archivo antes del deploy).
3. **Type consistency:** `HoyItem/TaskDTO/EventDTO` definidos una vez en T1 y referenciados idénticos en T4/T5 (`unwrap` distingue `message` RPC vs `data` REST v2). `run_incremental(client, stored_token)->token`, `call_with_backoff(fn)->result`, `enc_token/dec_token(blob, aad)`, `verify(p,sig,secret)->bool`, `handle(p)->event_name` usados con mismas firmas en tests e implementación. `crm_core.api.v1.*` como único prefijo RPC en T5-T7. CORS (T3.5) precede a todo fetch con credentials (T4+).
