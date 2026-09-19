# Estado para retomar — Agenda y sincronización con Google

**Fecha:** 2026-09-19 · **Rama:** `main` · **Producción:** `crm-mb:71` (`crm.marcosbarbosagroup.com/hoy`)
**Árbol de trabajo:** limpio · **Sin pushear:** 17 commits (`git log origin/main..HEAD`)

---

## 1. Qué está hecho y verificado

### La agenda (diseño restaurado) — **en producción**
El port a React había perdido el diseño. Se restauró y **se probó por medición**, no por opinión:
- **La causa raíz era una re-derivación**: el port copió los tokens actuales de la app en vez de los del prototipo. La paleta había derivado a fría, y **Fraunces y JetBrains Mono nunca se cargaban** (el título caía a Outfit y los horarios a la mono del sistema, en silencio).
- **Ahora**: los tokens **se generan** desde el `:root` de `prototypes/agenda/index.html` a `apps/web/src/agenda/tokens.css`; las tres fuentes cargan y **se verifican por fuente computada** (`getComputedStyle` + `document.fonts.check`); la paleta cálida computa `rgb(16,15,13)`; la sidebar (Agendas con filtrado real, Origen, Buscador), el mini-mes con la leyenda, el estado vacío, `Hoy · HH:MM`, el movimiento y el craft están; y **el sábado y el domingo existen** (7 columnas, con toggle y el nudge llegando al domingo).
- **Brecha visual contra la golden del prototipo: Semana 3%, Lista 2%, Mes 1%** (venía de 19%/2%/2%). Se corre a demanda con `npm run fidelity:visual`.

### S1+S2 de la sincronización — **implementado, NO verificado en el VPS**
- **S1**: 12 Custom Fields idempotentes en `Event` (`patches_gcal.py`), incluido el **`etag`** (sin él no hay detección de conflicto).
- **S2**: `crm_core/google_sync.py` — push asíncrono post-commit, con id base32hex propio (reintento no duplica), `If-Match`/412/409/410, estado visible, backoff con jitter, hash de eco, y **el delete cancela en Google ANTES de borrar local** (mata la resurrección).
- **Falta correrlo**: los tests (`test_google_sync.py`) están escritos pero **no ejecutados**.

## 2. Lo que falta, en orden

**Bloqueado por el usuario (sin esto no hay sync):**
1. **Credenciales OAuth de Google Cloud** con el scope **`https://www.googleapis.com/auth/calendar`**. El token actual es **`readonly`** y no alcanza para escribir. La pantalla de consentimiento debe estar en **producción** (en Testing el refresh token expira a los 7 días). Van en **Google Settings** del sitio.
2. **Redirect URI exacto**: `https://crm.marcosbarbosagroup.com?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`
3. **Qué calendario es el destino**: las reservas del Appointment Schedule caen en el **principal**, pero el `Google Calendar` de la cuenta apunta a **un calendario que Frappe creó** → por eso hoy web→CRM no trae nada. Hay que apuntarlo al de las reservas.
4. **Confirmar que el worker corre en producción** (el push es asíncrono: si el worker está caído, queda "Falló" en vez de llegar a Google).

**Después, sin bloqueo:**
- **S3 · Un solo puller.** Hoy hay **dos** sincronizadores: el nativo y `scripts/sync/sync-gcal-crm.py`. Hay que apagar uno. El pull usa `syncToken` incremental y maneja el `410`.
- **S4 · Conflictos y reconciliación.** El contrato de la spec §2: autoridad por evento, **nunca merge silencioso**; gana Google en horario/título/asistentes, el CRM conserva lead y notas, y se marca `conflict`.
- **S5 · Prueba en pantalla**: reservar en la web → verlo en el CRM; crear en el CRM → verlo en Google.
- **El deploy de S1+S2**: build + regenerar el shell + `deploy-crm.sh` con el migrate (los campos lo necesitan).

## 3. El mecanismo que impide volver a perder el diseño (no romperlo)

Tres capas, y ninguna es una convención:
1. **Los tokens son generados** desde el prototipo (`scripts/extract-agenda-tokens.mjs`, con `--check`). No hay valor que actualizar a mano: si falta uno, **se agrega al prototipo y se re-extrae**.
2. **La guarda** (`scripts/check-agenda-fidelity.mjs`) **corre en el build y en CI** (modo `--static`; el modo navegador es `npm run fidelity`): falla si los tokens divergen, si el shell no carga las fuentes, si la pila mono no empieza con JetBrains, si una categoría se re-deriva, si `styles.css` recupera reglas `.agx`, o si **una regla global por selector de elemento** (un `h2`, por ejemplo) llega a un componente de la agenda.
3. **La golden del prototipo** (`npm run fidelity:visual`): no dice "se ve bien", dice **cuántos píxeles y dónde**.

**Regla de oro para cualquier cambio visual: el prototipo primero, después el port.** Al revés es la re-derivación que costó esta spec entera.

## 4. Cómo verificar en el VPS (receta, cuesta re-descubrirla)

El VPS corre Docker Swarm; **no hay `bench` en el host**. Para correr tests contra `crm-test` **sin tocar producción**:

1. **Servicio Swarm descartable** unido a la red `crm_crm-net` (el bench necesita resolver `mariadb` y `redis-cache`, y esa red no es "manually attachable" con `docker run`):
   `docker service create --name agenda-test --network crm_crm-net --mount type=volume,src=crm_sites,dst=/home/frappe/frappe-bench/sites --mount type=volume,src=crm_logs,dst=/home/frappe/frappe-bench/logs --restart-condition none crm-mb:71 tail -f /dev/null`
2. `mkdir -p /home/frappe/logs && chown -R frappe:frappe /home/frappe/logs` (el gotcha del logging de los scripts standalone).
3. **Copiar el set COMPLETO** de `apps/crm_core`: `api.py`, `google_sync.py`, **`patches.py`, `patches_f2.py`, `patches_categoria.py`, `patches_gcal.py`**, `patches.txt` y los `tests/`. **Olvidar `patches.py` rompió runs dos veces** — el contenedor descartable arranca de la imagen, que no tiene los archivos de la rama.
4. `bench --site crm-test migrate` y `bench --site crm-test run-tests --module crm_core.tests.<módulo>`.
5. `docker service rm agenda-test`.

**Los Custom Fields se crean con `bench`, no standalone**: `bench --site crm-test execute frappe.custom.doctype.custom_field.custom_field.create_custom_fields --kwargs "$(cat /tmp/kwargs.json)"`. El script standalone falla por el logging.

## 5. Lo que ya está declarado y no hay que re-descubrir

- **`patches.txt` tiene que estar en el paquete** (`apps/crm_core/crm_core/patches.txt`), no en la raíz del app, y llevar la sección `[pre_model_sync]` **aunque esté vacía** — Frappe la exige. Esto hizo que el primer deploy de F5 sirviera una agenda vacía.
- **Una reunión es un `Event` de Frappe** linkeado al lead por `Event.custom_crm_lead`. `custom_meeting_datetime` está congelado (no se borra: Frappe nunca borra columnas y no hay migraciones inversas).
- **Regla de alternancia foco/anuncio**: si el foco cambia, **no** se anuncia; si no puede cambiar, se anuncia. La excepción es **eliminar** (el foco cae en otro objeto).
- **Deudas declaradas**: el estado de sync no se muestra en la UI (D5); el paginador es una mejora del port protegida (D4); recurrencia, asistentes, multi-calendario y edición en el CRM de reservas de la web quedan fuera de v1, cada uno con su consecuencia escrita en la spec.
- **`origin/main` está 17 commits atrás**; los dos últimos deploys subieron por `git bundle` porque el push quedó pendiente.

## 6. Archivos que importan

| Qué | Dónde |
|---|---|
| **La autoridad del diseño** | `prototypes/agenda/index.html` |
| Los tokens (generados) | `apps/web/src/agenda/tokens.css` + `scripts/extract-agenda-tokens.mjs` |
| La guarda de fidelidad | `scripts/check-agenda-fidelity.mjs` |
| La comparación visual | `apps/web/e2e/agenda.visual.spec.ts` + `npm run fidelity:visual` |
| La agenda en React | `apps/web/src/agenda/**` |
| **El sync** | `apps/crm_core/crm_core/google_sync.py` + `api.py` |
| Los campos del sync | `apps/crm_core/crm_core/patches_gcal.py` + `scripts/setup_custom_fields.py` |
| Spec del sync | `docs/superpowers/specs/2026-09-19-sincronizacion-google-calendar-design.md` |
| Spec del diseño | `docs/superpowers/specs/2026-09-18-restaurar-diseno-aprobado-en-prod.md` |
| Las investigaciones | `docs/research-2026-09-19-google-calendar-sync.md` y `docs/superpowers/research/2026-09-19-*` |
| El ledger de la ejecución | `.superpowers/sdd/agenda-port/progress.md` (gitignored, en disco) |
