# Spike Postgres 16 — Veredicto (2026-09-14)

**Fecha:** 2026-09-14
**Ejecutado por:** arquitecto/coordinador (Phase 1 Fase 4 del loop)
**Veredicto:** ❌ **PG16 RECHAZADO** para Frappe v15 — bloqueo confirmado por upstream.

---

## Contexto

Evaluar migración de MariaDB 10.6 (actual) a Postgres 16 (futuro) por JSONB, mejor FTS, RLS, y dar plan para Fase 2 SaaS. El plan (`docs/superpowers/specs/2026-09-14-premium-crm-design.md` §9) exige este spike con spike separado del backend prod, restore drill y veredicto explícito.

## Setup ejecutado (VPS Dokploy)

- PG16 efímero vía `deploy/pg16-spike.yaml` — `postgres:16-alpine`.
- Backend efímero vía `deploy/spike-backend-efimero.yaml` — clon `crm-mb:17` (la misma imagen usada en prod), red aislada `crm-spike-net`.
- `pg_isready` OK en 5–7 s; `version()` devuelve `PostgreSQL 16.15 (Alpine 15.2.0)`.

## Hallazgos (en orden de relevancia)

### 🔴 H1 — Frappe v15 NO tiene soporte oficial de PostgreSQL

Texto literal del CLI durante `bench new-site`:

> `Note: PostgreSQL support is limited to Frappe v16 and above. Fixes for earlier versions will not be added.`

Esto descarta la migración en el CRM actual (Frappe v15, según `docs/spec.md` y `compose.yaml`).

### 🟡 H2 — `bench drop-site` con `--db-type postgres` exige stdin interactivo

Aun pasando `--db-root-password`, el comando demanda:

> `Enter postgres super user:`

Y aborta con `Aborted!` si no se alimenta via stdin. La cadena `--db-root-username postgres --db-root-password …` no se acepta en `--db-root-username` cuando hay un parámetro dedicado (sólo en Frappe v16+). **Síntoma adicional de "v15 con PG es tierra de nadie"**, pero documentado: bench v16 ya lo arregló.

### 🟢 H3 — psycopg2 SÍ está en el venv de bench

`bench --version` = 5.31.0. Driver disponible. **No es falta de driver; es falta de soporte upstream.**

## Restore drill

**No se llegó a ejecutar** porque `bench new-site` no completó (H1/H2). El smoke CRUD contra `/api/resource/ToDo` queda fuera de alcance este spike.

## Decisión

**FACTOR:** MariaDB 10.6 queda como driver de Fase 0–1. Migración a PG se re-evalúa únicamente **al pasar a Frappe v16+** (upgrade de plataforma, no decisión CRM). En ese momento, este spike se reejecuta contra v16+ y se confirma `bench new-site --db-type postgres` no interactivo.

## Consecuencias para el plan

- `crm_core` se modela agnostic al driver (Frappe ORM abstrae; el spike sirve para confirmar que cambiar a PG en el futuro no implica re-trabajar la app, solo instalar driver + upgrade framework).
- Resto de Fase 0–2 sigue sobre MariaDB 10.6.
- Fase 3 (Plataforma) considera upgrade Frappe como **pre-requisito** para algunas features enterprise (RLS multi-tenant, JSONB para audit log de cambios).

## Teardown

```bash
docker compose -f deploy/spike-backend-efimero.yaml -f deploy/pg16-spike.yaml down -v
```

Verificado: contenedores borrados, redes borradas, sin residuos en el host.
