# Premium CRM — Design Spec (Enfoque A: Frappe Framework + React desacoplado)

**Fecha:** 2026-09-14
**Estado:** Borrador para revisión — requiere aprobación antes de `writing-plans`
**Decisión base:** Abandonar `frappe/crm` (app) por tosco, pesado y sin agenda útil. Conservar **Frappe Framework (MIT)** como backend + construir **frontend React propio** nivel Linear/Attio. Licencia del producto: propia (SaaS-safe).
**Repo:** `crm-marcosbarbosagroup` · **Deploy:** Dokploy (operativo) · **VPS:** Hetzner CX23 (medido: ~1.8 GB libres para el CRM, ver `docs/spec.md` §2)

---

## 1. Por qué este diseño (y no los otros)

Investigación 2026-09-14 contra fuentes primarias (repos, docs oficiales, benchmarks). Conclusiones:

### 1.1 Referencias analizadas — qué robamos de cada una y qué descartamos

| Referencia | Stack / dato verificado | Qué robamos | Qué descartamos y por qué |
|---|---|---|---|
| **Atomic CRM** (marmelab, MIT, 1.2k★, ~15k LOC) | React + react-admin + Supabase/Postgres + shadcn; SSO nativo; registry shadcn para updates | **Patrón "CRM como toolkit"**: componentes reemplazables, theming, data model extensible, TypeScript estricto, Playwright E2E. Es la prueba de que un CRM completo cabe en 15k líneas si se apoya en librerías estándar en vez de framework monolítico | Su backend (Supabase): nosotros ya tenemos Frappe + MariaDB/Postgres corriendo; migrar de BaaS no aporta. Su UI (react-admin/MUI): densa, admin-like — no llega a "ultra premium" sin re-skin profundo |
| **Twenty CRM** (AGPL-3.0) | NestJS + TypeORM + PG + Redis + React + Jotai; GraphQL + REST auto-generadas por objeto; `⌘K` palette; objetos/vistas custom | **Patrones UX/API**: command palette como entry point universal; metadata-driven API (cada objeto/campo aparece solo en la API); vistas múltiples por objeto (tabla/kanban/calendario); webhooks en create/update/delete | **Código y licencia**: AGPL contamina SaaS (obliga a entregar source a cada usuario, §13). Benchmark Marmelab 2026: "contaminant license, huge codebase, no multi-tenancy, no mobile UI". CVEs 2026 críticos (RCE vía SQLi encadenado CVE-2026-46624, SQLi en searchVector CVE-2026-73069). No es base para producto vendible |
| **Linear** (propietario; arquitectura pública vía talks del CTO + reverse-engineering documentado) | Sync engine local-first: IndexedDB como DB real + Object Pool en memoria + MobX; `lastSyncId` monotónico; last-writer-wins; deltas por WebSocket; load strategies (instant/lazy/partial); service worker + app shell inline | **El estándar de performance**: mutación → escritura local → UI instantánea → sync en background; hidratación desde disco antes de tocar red; granular reactivity (re-render por celda); `<100ms` percibidos; keyboard-first con atajos mnemónicos | El motor custom completo (4 motores construyó su CTO antes): overkill para fase 1. Lo reimplementamos **por capas** (optimistic + SWR primero, IndexedDB persistente después) |
| **Cal.com** (AGPL-3.0) | Webhooks versionados (`x-cal-webhook-version`), triggers (BOOKING_CREATED/RESCHEDULED/CANCELLED/NO_SHOW), HMAC-SHA256 con secret, at-most-once (sin re-fire en sync duplicado), calendar cache + availability | **Diseño de webhooks propio** (mismo contrato: versionado, firma HMAC, idempotencia) + **lógica de availability/booking links** como referencia para nuestro scheduler. Cal.com como **sidecar transitorio** en Fase 0 (scheduling + GCal sync ya resueltos) mientras construimos motor propio | Adoptarlo como dependencia permanente: AGPL + segundo servicio que mantener + auth separada |
| **Google Calendar API** (docs oficiales) | `nextSyncToken` en última página de full sync; incremental con `syncToken`; **410 GONE → full resync obligatorio**; push vía `events.watch` (HTTPS + expiración de canal); conflictos con ETag + `If-Match` (412) | **Máquina de estados de sync** exacta (ver §6): full → incremental → 410 → full; canales watch con renovación; optimistic locking con ETag para 2-way sin lost updates | Nada que descartar; es el contrato que hay que implementar al pie de la letra |
| **Attio / Superhuman** (propietarios; UX pública) | Densidad de información + edición inline; "assume happy path, verify in background"; cero spinners; atajos descubribles | **Principios de UX premium** (§5): densidad > whitespace, edición inline en celdas, skeleton solo en primer load, errores solo cuando ocurren | — |
| **Frappe Framework v15** (MIT; ya deployado) | REST v1 `/api/resource/` + v2 `/api/v2/document/` con paginación y field selection; RPC en `/api/method/` (whitelisted); auth por token (API key/secret) y sesión; `frappe-react-sdk` (MIT, SWR debajo); realtime Socket.io + Redis pub-sub; scheduler RQ; multi-tenant por sites | **Todo el backend**: DocTypes = modelo + API + permisos gratis; `frappe-react-sdk` como capa de datos inicial; sites = aislamiento SaaS nativo | Desk UI como cara al usuario (solo admin/superuser); MariaDB 10.6 si migramos a Postgres por JSON/RLS futuros (decisión §9) |

### 1.2 Decisión arquitectónica en una frase

**Backend Frappe (lo aburrido ya resuelto: auth, permisos, API, scheduler, multi-tenant, MIT) + frontend React propio (lo diferencial: agenda/tareas Linear-grade, GCal 2-way, command palette) + Cal.com sidecar transitorio (scheduling ya resuelto mientras construimos el propio).**

---

## 2. Arquitectura del sistema

```
┌────────────────────────────────────────────────────────────────┐
│ FRONTEND (app web + PWA) — repo `apps/web`                     │
│ Next.js 14 (App Router) + React 18 + TypeScript estricto       │
│ TanStack Query (server state) + Zustand (UI state)             │
│ Dexie.js (IndexedDB) — Fase 1; SWR/memory — Fase 0            │
│ Tailwind + shadcn/ui + FullCalendar/DnD-Kit + cmdk (palette)   │
│ Playwright E2E + Vitest unit                                   │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS/JSON  (REST v2 + RPC whitelisted + Socket.io)
┌───────────────▼────────────────────────────────────────────────┐
│ BACKEND — Frappe Framework v15 (MIT), repo `apps/crm_core`     │
│ DocTypes: Lead, Deal, Task, Event, Contact, Account, Activity, │
│   GCalConnection, GCalSyncState, SyncConflict, BookingLink,    │
│   AvailabilityRule, TenantSettings, UserPreferences            │
│ Server Scripts / whitelisted methods: sync engine, booking,    │
│   availability, conflict resolution, provisioning              │
│ Scheduler (RQ): incremental sync polling, watch renewal,       │
│   reminders, digest diario, cleanup                            │
│ Socket.io: deltas a clientes (canal por site+usuario)          │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│ DATOS — Postgres 16 (migración desde MariaDB 10.6, ver §9)     │
│ + Redis (cache/queue/pub-sub, ya corriendo)                    │
└────────────────────────────────────────────────────────────────┘
        │                │                    │
        ▼                ▼                    ▼
  Google Calendar   Cal.com sidecar      Stripe / webhooks out
  (OAuth + watch)   (Fase 0 scheduling)  (Fase 2 billing)
```

**Monorepo** (`turborepo`): `apps/web`, `apps/crm_core` (custom app Frappe), `packages/types` (contratos TS generados desde DocTypes), `packages/ui` (design system). **Regla dura**: el frontend NUNCA toca SQL; todo pasa por API Frappe o whitelisted methods versionados (`/api/method/crm_core.api.v1.*`).

---

## 3. Modelo de datos (DocTypes — app `crm_core`)

| DocType | Campos clave | Notas |
|---|---|---|
| `Contact` / `Account` | nombre, emails[], teléfonos[], empresa link, avatar, custom fields JSON | Dedupe por email; avatar auto (patrón Atomic) |
| `Lead` → `Deal` | stage (kanban), amount, probability, source, expected_close | Pipeline configurable por tenant |
| `Task` | subject, due_date/datetime, assignee, priority, status, linked (Lead/Deal/Contact/Event), recurrence rule | **Entidad de agenda**: sin due = backlog; con due = aparece en calendario |
| `Event` (reunión) | title, start/end + timezone, attendees[], location/meet_link, `gcal_id`, `gcal_etag`, `gcal_sync_token_ref`, source (manual/gcal/cal_sidecar/web), recurrence | `gcal_id+etag` = optimistic locking 2-way; recurrencias como serie + excepciones |
| `Activity` | append-only log (llamada, email, nota, cambio stage) | Timeline por contacto/deal; nunca se edita, solo se agrega |
| `GCalConnection` | user, oauth tokens **cifrados** (AES-256-GCM, patrón ref. `yussypu/google-calendar-oauth-sync`), calendar_id, scopes | Refresh automático con buffer 5 min |
| `GCalSyncState` | connection link, `sync_token` opaco, last_sync_at, status, error_count | Tokens opacos: jamás parsear; 410 → limpiar + full sync |
| `SyncConflict` | event link, local_version, remote_version, field_diffs JSON, resolution (manual/last-write), resolved_by/at | Cola de resolución visible en UI, no silenciosa |
| `BookingLink` / `AvailabilityRule` | slug, duration, working_hours, buffer, questions JSON | Fase 0: espejo de Cal.com vía webhook; Fase 1+: motor propio |
| `TenantSettings` / `UserPreferences` | branding, timezone default, working hours, notification prefs, shortcuts custom | White-label desde día 1 del modelo |

**Convenciones**: todo DocType lleva `tenant` implícito vía site (Fase 0-1: **site-per-tenant** = aislamiento total, backups por cliente, provisioning = `bench new-site` automatizado). RLS/shared-DB se evalúa solo si >100 tenants (ver §9).

---

## 4. Frontend: estándar Linear (qué significa en concreto, no slogans)

### 4.1 Capas de performance (por fase, sin saltos mágicos)

- **Fase 0 (dogfood, sem 1-6)**: TanStack Query + optimistic updates en mutaciones críticas (cambiar stage, completar tarea, mover evento). Skeleton solo en primer paint; después, `stale-while-revalidate`. Atajos básicos + `cmdk` palette con 15 comandos. **Métrica**: p95 interacción <300ms en red local.
- **Fase 1 (premium, mes 3-6)**: Dexie.js (IndexedDB) como store primario: hidratación desde disco antes de red; cola de transacciones outbox (reversible, con `client_mutation_id` para idempotencia); deltas por Socket.io con `lastSyncId` monotónico servido por backend; last-writer-wins ordenado por servidor; service worker + app shell. **Métrica**: p95 <100ms, funciona offline (leer/crear/editar, sync al reconectar).
- **Regla anti-mediocridad**: ningún botón muestra spinner si la acción es reversible → aplica optimistic + rollback solo en error real. Los errores de sync van a un "sync status" discreto, no a modales.

### 4.2 Agenda unificada (el diferencial del producto)

Una sola vista "Hoy", no tres tabs: **timeline vertical** que mezcla Tasks con due + Events del día, con drag entre slots (mover tarea a hora = crea/actualiza Event linkeado), multi-select con teclado, edición inline en celda, y panel lateral de detalle sin cambio de ruta. Vistas mes/semana/día + kanban de Tasks sin fecha. Timezone explícito por evento + working hours del usuario con resaltado fuera de horario. Recurrencias con UI de excepción ("solo este evento") desde Fase 1.

### 4.3 Command palette + teclado

`⌘K`: fuzzy sobre contactos/deals/tareas/eventos + comandos ("crear tarea para mañana 9am" con parsing ES de fecha). Atajos mnemónicos (T = tarea, E = evento, / = buscar). Descubribles: cada botón muestra su atajo en tooltip. Mouse 100% soportado, teclado 100% suficiente.

### 4.4 Diseño visual

Dark-first, densidad alta, Inter Variable, tokens en `packages/ui`. shadcn/ui como base (velocidad) con skin propio (diferenciación). Nada de MUI-admin-look: la referencia es Linear/Attio, no react-admin.

---

## 5. Google Calendar sync 2-way (el módulo de mayor riesgo — diseño exacto)

### 5.1 Máquina de estados (contrato Google, implementado al pie de la letra)

```
[sin token] → FULL SYNC (paginar con nextPageToken hasta agotarlo,
              guardar nextSyncToken de la ÚLTIMA página) → [con token]
[con token] ⇄ INCREMENTAL (syncToken → solo cambios incl. status=cancelled
              → guardar nuevo nextSyncToken)
[con token] → 410 GONE → limpiar estado local del calendario → FULL SYNC
```

### 5.2 Tiempo real (push, no polling ciego)

`POST /calendars/{id}/events/watch` por conexión (callback HTTPS del backend, token de canal firmado, expiración renovada por scheduler **antes** del vencimiento). El push solo avisa "algo cambió" → el worker hace incremental sync con el `sync_token` guardado. Polling incremental cada 10-15 min como red de seguridad (cubre canales caídos).

### 5.3 Escrituras hacia Google (sin lost updates)

Toda escritura CRM→GCal lleva `If-Match: <gcal_etag>`:
- match → update OK, guardar nuevo etag;
- **412** → otro escribió en el medio → crear `SyncConflict` + mostrar en UI con diff por campo (título, hora, attendees) y botones "quedarme con mío / con Google / mezclar". Nada se sobrescribe en silencio. Default configurable: last-write-wins para campos no críticos, manual para horario/asistentes.

**REGLA FASE 0 (revisión 2026-09-14): ante conflicto, GCal es fuente de verdad (remote wins).** Se registra `SyncConflict` con `resolution=auto_resolved_remote` para auditoría; la UI de resolución manual llega en Fase 1. Esto evita pérdidas de datos inexplicables mientras no hay UI de merge.

### 5.4 Casos borde (lista cerrada, cada uno con test E2E)

Recurrentes (serie vs instancia vs excepción), eventos borrados en GCal (`cancelled` → soft-delete local + actividad), evento borrado en CRM con sync activo (borrar en GCal o deslinkear, a elección del usuario), múltiples calendarios por usuario (uno primario escribible + N solo-lectura), calendarios compartidos/delegados (solo lectura + aviso), timezones (almacenar UTC + tz original; render en tz del viewer), rate limits (backoff exponencial + cola RQ con prioridad), OAuth revocado (estado `needs_reauth` + banner + re-auth en 2 clics), 410 en cascada (full sync con paginación y progress en UI).

### 5.5 Seguridad de tokens

OAuth access/refresh **cifrados en reposo** (AES-256-GCM, clave en variable de entorno / secret manager, rotación documentada). Refresh con buffer 5 min. Nunca en logs ni en payloads al frontend.

---

## 6. Scheduling / booking (página pública "agendar reunión")

- **Fase 0**: Cal.com self-hosted como sidecar (mismo Dokploy, compose aparte) + webhooks (`BOOKING_CREATED/RESCHEDULED/CANCELLED`, firma HMAC-SHA256 verificada, `webhook_id+timestamp` para idempotencia at-most-once) → crean/actualizan `Event` + `Task` de preparación + `Activity`. Booking links embebidos en la web `marcosbarbosagroup.com`.
- **Fase 1+**: motor propio (`BookingLink`, `AvailabilityRule`, página pública en `apps/web`, ICS por invitado, recordatorios) y Cal.com se retira. El contrato de webhooks propio replica el diseño Cal.com (versionado `x-crm-webhook-version`, HMAC, reintentos con backoff).

---

## 7. Auth, permisos, multi-tenant SaaS

- Auth: Frappe session + API tokens; OAuth Google/Microsoft; SAML/SSO en plan Enterprise (Fase 2). MFA TOTP Fase 1.
- Roles: Owner/Admin/Member/Viewer por site + permisos por DocType (nativo Frappe). Invitaciones por email con expiración.
- Tenancy: **site-per-tenant** (aislamiento físico, `bench new-site` + provisioning API). Dominios custom por tenant (white-label) vía Traefik + TLS. Billing Stripe (trial → paid, portal, metering de seats/eventos sync) Fase 2.
- Auditoría: `Activity` + versionado de docs críticos (quién cambió qué, cuándo) — requisito enterprise no negociable.

---

## 8. Tiempo real y notificaciones

Socket.io (ya en stack): canales `site:{site}:user:{user}`, eventos `doc:update/create/delete` con `lastSyncId`; el cliente aplica deltas o marca stale. Notificaciones: in-app + email (SMTP/IMAP nativo Frappe) + push PWA (Fase 1). Recordatorios de tareas/eventos vía scheduler (15 min antes default, configurable). Digest diario opcional 8am.

---

## 9. Infra, datos y decisiones pendientes de validación

- **DB**: migrar MariaDB 10.6 → **Postgres 16** (JSONB para custom fields/activity diffs, mejor Full-Text, parity con ecosistema React/Supabase si algún día se comparte tooling). Es el cambio infra más caro: validar en spike (Fase 0, sem 1) con restore real. Si el spike falla → quedarse en MariaDB, sin drama.
- **Recursos CX23**: frontend Next.js (~150-250 MB) + Frappe tuned (~1.5 GB, se baja 1 worker al no servir Desk pesado) + PG (~300 MB) + Redis (existente) + Cal.com sidecar transitorio (~250 MB) → **~2.2 GB vs 1.8 GB libres**: viable con swap como hoy, pero **resize a CX33 al entrar Fase 1** (decisión presupuestada, no sorpresa).
- **Backups**: snapshots Dokploy + `pg_dump`/mariadb-dump por site + restore drill mensual (runbook).
- **Calidad**: CI con lint+typecheck+tests en cada PR; E2E Playwright en flujos críticos (login, crear tarea, mover evento, sync GCal mock, booking webhook); contrato API con tests de snapshot del schema; Sentry + PostHog desde Fase 0.

---

## 10. Migración desde el Frappe CRM actual

Script `migrate:frappe-crm` (export vía REST v1 → mapping → import a `crm_core`): Contacts, Leads/Deals, Tasks, Notes→Activity. **Parallel run 2 semanas** (lectura en ambos, escritura en nuevo) + rollback = volver al site viejo (no se borra hasta Fase 1 verde). Cero downtime diurno: corte un viernes tarde con checklist.

---

## 11. Fases y criterios de salida (gates, no fechas vacías)

- **Fase 0 — Dogfood usable (sem 1-6)**: login, Hoy (tasks+events), CRUD contactos/deals, GCal sync vía motor propio básico (full+incremental+410), Cal.com sidecar para booking, PWA instalable. **Gate**: el equipo trabaja 5 días seguidos sin abrir el CRM viejo ni Google Calendar directo.
- **Fase 1 — Premium core (mes 3-6)**: IndexedDB offline, palette completa, recurrentes + conflictos UI, motor booking propio, multi-tenant provisioning manual, MFA. **Gate**: p95 <100ms medido (PostHog), 0 lost-updates en tests de conflicto, Lighthouse PWA ≥90.
  - Alcance ampliado (revisión 2026-09-14): validación runtime **Zod** en `frappe-client` (anti white-screen por datos sucios); **correlation IDs** + tracing básico del sync; **circuit breaker** en sync GCal (tras N fallos seguidos, pausa + aviso UI); **track_changes** nativo Frappe en Deal/Contact/Task + timeline de auditoría; **service worker + background sync** (PWA offline real).
- **Fase 2 — SaaS hardening (mes 6-9)**: billing Stripe, dominios custom, SSO/SAML, auditoría exportable, SLA/backups por tenant, status page. **Gate**: tenant piloto externo pagando 30 días sin intervención manual.
- **Fase 3 — Plataforma (mes 9-12)**: API pública + OAuth apps, marketplace de integraciones (n8n/Make templates), AI (resúmenes, next-best-action) con opt-in y DPA. **Gate**: 1 integración partner construida solo con docs públicas.

---

## 12. Riesgos (con mitigación asignada, no lista de miedos)

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Sync GCal 2-way con bugs sutiles (duplicados, loops) | Alta | Alto | §5 al pie de la letra; `client_mutation_id` + `gcal_id` únicos; loop-guard (ignorar ecos del propio `channel_id`); suite E2E contra GCal sandbox + replay de webhooks |
| Subestimar "lo aburrido" (permisos, auditoría, migraciones) | Media | Alto | Frappe ya lo trae; prohibido reimplementar; checklist enterprise en cada PR de Fase 2 |
| Dos codebases (Python+TS) con 1-2 devs | Media | Medio | Monorepo + tipos generados; `frappe-react-sdk` al inicio; regla "frontend tonto, backend listo" |
| Migración MariaDB→PG se complica | Media | Medio | Spike sem 1 con restore real; fallback MariaDB sin cambiar diseño (ORM abstrae) |
| Alcance "ultra premium" vs equipo chico | Alta | Medio | Gates por fase (§11): si Fase 0 no pasa su gate en sem 8, recortar Fase 1 (quitar offline IndexedDB, quedarse en optimistic+SWR) antes de seguir |
| Twenty/otros copian el nicho | Baja | Medio | Wedge = UX agenda + GCal + curva cero para equipos 1-10 hispanohablantes; velocidad de dogfood propio como ventaja |

---

## 13. Qué NO es este producto (anti-scope, para no hacer un "medio pelo" por dispersión)

No es: ERP, facturación, inventario, marketing automation, WhatsApp nativo, app móvil nativa (PWA primero), IA generativa como core. Todo eso es Fase 3+ o integraciones. **Lo único que tiene que ser 10/10 en Fase 1: agenda + tareas + GCal sync + velocidad + curva de aprendizaje cero.**

---

## 14. Preguntas abiertas para vos (bloquean el plan, no el spec)

1. **DB**: ¿aprobás el spike Postgres sem 1 (con fallback MariaDB), o prefieren no tocar la DB actual?
2. **Cal.com sidecar**: ¿OK como transitorio Fase 0 (un compose más en Dokploy), o lo consideran deuda inaceptable y vamos directo a motor propio (suma ~3 sem a Fase 0)?
3. **Resize CX33**: ¿presupuesto OK al entrar Fase 1 (verificar precio vigente Hetzner CX33 vs CX23 al momento de decidir), o hay que caber en CX23 todo el proyecto?
4. **Marca/licencia**: nombre del producto + ¿licencia propietaria del frontend desde día 1?

---

*Fuentes primarias consultadas: marmelab.com benchmark 2026 + repo `marmelab/atomic-crm` (MIT); docs Twenty (stack NestJS/PG/Redis/React/Jotai, GraphQL+REST); Linear talks CTO Tuomas Artman + análisis `performance.dev`/`iocombats`/`ggprompts`; docs Cal.com webhooks + API v2; Google Calendar API guides (sync + push) + `developers.googleblog`; `yussypu/google-calendar-oauth-sync`; Frappe Framework docs (REST v1/v2, RPC) + `frappe/frappe-react-sdk` (MIT). CVEs Twenty vía OpenCVE 2026.*
