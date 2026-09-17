# Port de la agenda al CRM real — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `crm.marcosbarbosagroup.com/hoy` muestre **la agenda nueva** — las tres vistas, la densidad, los carriles, la paleta, la accesibilidad y las operaciones sin mouse — sobre los **datos reales** del CRM.

**Architecture:** el prototipo (`prototypes/agenda/index.html`, JS puro, 2135 líneas) es la **especificación ejecutable** de la interacción: su geometría, su modelo de teclado, su regla de alternancia foco/anuncio y sus 29 guardas ya están resueltos y auditados. El port **reimplementa eso en React** dentro de `apps/web` (Vite + TypeScript), leyendo `get_agenda` y agregando los endpoints que hoy **no existen** (mover, duración, duplicar, eliminar). El shell de Frappe se regenera con `apps/web/gen-shell.mjs` y se despliega con `scripts/deploy-crm.sh`.

**Tech Stack:** React 18 + TypeScript (Vite) en `apps/web`; Frappe v15 + Python en `apps/crm_core`; Playwright para E2E contra el sitio real; `scripts/deploy-crm.sh` para el deploy con verificación y rollback.

**Spec (autoridad):** `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md` — el diseño de la interacción. **Las decisiones visuales ya están tomadas** y no se reabren: **Zoom-Amplio por defecto**, las tres vistas (Semana · Lista · Mes), carriles de solapamiento a ancho 1/n, paleta en oklch con contraste AA medido, foco a 5.45:1, y la tipografía de marca (Fraunces solo en el título de la semana, JetBrains Mono para los datos, Outfit para la interfaz).

**Referencia viva:** `prototypes/agenda/index.html` — ante cualquier duda de comportamiento, **eso es lo que hay que replicar**, y `scripts/audit-agenda-proto.mjs` muestra cómo se mide cada invariante.

## Global Constraints

- **Nada se inventa de nuevo.** Cada comportamiento ya está decidido y medido en el prototipo; el port lo traduce a React.
- **`Zoom-Amplio` es la densidad por defecto**, y las tres vistas se cambian desde la barra, con el estado en la URL.
- **La regla de alternancia:** si el foco cambia, **no** se anuncia; si el foco **no puede** cambiar, se anuncia. Excepción documentada: **eliminar** anuncia *además* de mover el foco (el foco aterriza en otro objeto).
- **Accesibilidad no negociable** (ya verificada en el prototipo, se replica medida): nombres accesibles autosuficientes por reunión (día + horario + título + agenda), eje horario y líneas `aria-hidden`, anunciador **persistente fuera del subárbol que se re-renderiza**, contraste de bloques ≥4.5:1, foco ≥3:1 (5.45:1), líneas de grilla perceptibles, texto ≥11 px, objetivos ≥24×24 px.
- **Prohibido:** `role="grid"`, `aria-grabbed`, `aria-dropeffect`, modos con estado del que haya que salir, controles que nombran una acción y no hacen nada, `transition: all`.
- **La Lista es operable** (reusa el mismo menú que la grilla) y **el Mes es una tabla nativa**.
- **Español (Argentina)**, voseo. Comentarios solo para el *por qué* no obvio.
- **Verificación obligatoria por tarea**: el E2E contra el sitio (`scripts/e2e_agenda.mjs`) verde, y **las mediciones** (contraste, foco, tamaños) corridas de verdad, no afirmadas.
- **El deploy se verifica en pantalla**: `crm.marcosbarbosagroup.com/hoy` con las tres vistas andando sobre datos reales.

## Estructura de archivos

| Archivo | Responsabilidad | Estado |
|---|---|---|
| `apps/crm_core/crm_core/api.py` | Endpoints: agregar `update_meeting`, `delete_meeting`, `duplicate_meeting` (hoy solo hay `get_agenda`, `create_event`, `get_meeting`) | **Modificar** |
| `apps/crm_core/crm_core/tests/test_agenda_api.py` | Tests de integración de los endpoints nuevos | **Crear** |
| `apps/web/src/api.ts` | Cliente tipado: `updateMeeting`, `deleteMeeting`, `duplicateMeeting` | **Modificar** |
| `apps/web/src/Agenda.tsx` | La agenda nueva: shell, 3 vistas, densidad, URL | **Reescribir** (285 líneas hoy) |
| `apps/web/src/agenda/` | El motor: geometría, carriles, bloques, panel, menú, diálogos | **Crear** (varios archivos chicos) |
| `apps/web/src/styles.css` | Tokens de la paleta oklch y las piezas de la agenda | **Modificar** |
| `apps/web/gen-shell.mjs` | Regenera `www/hoy.html` con el bundle | Sin cambios (se corre) |
| `scripts/e2e_agenda.mjs` | E2E contra el sitio real | **Extender** |

---

### Task 1: Endpoints que faltan (mover, duración, duplicar, eliminar)

**Files:** `apps/crm_core/crm_core/api.py`, `apps/crm_core/crm_core/tests/test_agenda_api.py`

**Interfaces:**
- `update_meeting(name, starts_on, ends_on=None)` → mueve y/o cambia la duración de una reunión; valida permisos y que el fin sea posterior al inicio.
- `delete_meeting(name)` → elimina con verificación de permiso de borrado.
- `duplicate_meeting(name, starts_on=None)` → copia con los mismos campos, título con sufijo `(copia)`.
- Los tres devuelven el DTO de la reunión (o `{ok: true}` en delete) y **fallan con `frappe.throw`** en datos inválidos, nunca en silencio.

**Por qué primero:** sin estos endpoints las tres operaciones son imposibles, y son la mitad del valor del trabajo. Se testean en `crm-test` (nunca contra producción).

- [ ] **Step 1: Tests que fallan** (en `test_agenda_api.py`, con el patrón de `test_presupuesto_api.py`): mover cambia `custom_meeting_datetime`; mover al pasado se permite pero se registra; fin ≤ inicio falla; eliminar borra y no deja huérfanos; duplicar crea con el sufijo y los mismos campos; sin permiso, los tres fallan.
- [ ] **Step 2: Correr y verificar que fallan** — `bench --site crm-test run-tests --module crm_core.tests.test_agenda_api`
- [ ] **Step 3: Implementar los tres endpoints** sobre `CRM Lead.custom_meeting_datetime`, reusando `_meeting_dto` para la respuesta.
- [ ] **Step 4: Correr y verificar que pasan**, y que los tests de F3 siguen verdes.
- [ ] **Step 5: Commit** — `feat(agenda): endpoints para mover, cambiar duración, duplicar y eliminar reuniones`

---

### Task 2: Cliente tipado en `api.ts`

**Files:** `apps/web/src/api.ts`

**Interfaces:** consume los endpoints de Task 1; produce `updateMeeting(name, startsOn, endsOn?)`, `deleteMeeting(name)`, `duplicateMeeting(name, startsOn?)` con tipos `EventDTO`.

- [ ] **Step 1..4:** agregar los tres métodos siguiendo el patrón exacto de los existentes (`get<AgendaData>("crm_core.api.get_agenda", …)`), con los parámetros nombrados igual que los acepta el backend.
- [ ] **Step 5: Commit** — `feat(web): cliente de la API para las operaciones de la agenda`

---

### Task 3: El esqueleto de la agenda nueva (shell + 3 vistas + densidad + URL)

**Files:** `apps/web/src/Agenda.tsx` (reescritura), `apps/web/src/agenda/` (nuevos), `apps/web/src/styles.css`

**Interfaces:** produce el componente `Agenda` con el estado `VIEW` (`semana` | `lista` | `mes`), la densidad `ZOOM_MULT` con **Amplio por defecto**, y la ventana visible; todo reflejado en la URL (`?view=&zoom=`). Consume `api.getAgenda`.

- [ ] **Step 1:** leer a fondo `prototypes/agenda/index.html` (el render de las tres vistas) y `apps/web/src/Agenda.tsx` (lo que hoy hace, para no perder nada que ya funcione: navegación de semana, modo día).
- [ ] **Step 2:** los tokens de la paleta y las piezas visuales en `styles.css` (los valores **ya están medidos**: copiarlos del prototipo, no re-elegirlos).
- [ ] **Step 3:** el shell con la barra, el cambio de vista y el control de densidad, con el título de la semana en Fraunces y los datos en JetBrains Mono.
- [ ] **Step 4:** las tres vistas renderizando datos reales de `get_agenda` (aunque al principio sean mínimas: primero que se vean los datos, después el detalle).
- [ ] **Step 5: Verificar en pantalla** (dev server) y **Commit** — `feat(agenda): esqueleto de la agenda nueva con las tres vistas`

---

### Task 4: La grilla semanal (geometría, densidad, carriles, scroll, arrastre)

**Files:** `apps/web/src/agenda/*`, `apps/web/src/Agenda.tsx`

**Interfaces:** réplica de la geometría del prototipo: alto de hora **derivado del alto disponible** (nunca una constante), carriles de solapamiento a ancho 1/n, encabezado de días y gutter **fijos**, scroll interno solo cuando la densidad lo pide, y el arrastre (crear/mover/redimensionar) con umbral de 4 px y cancelación con Escape.

- [ ] **Step 1:** la geometría por tramos con `yOf`/`minOf` — **incluido el inverso**, que en el prototipo faltaba y hacía fallar todo arrastre con `TypeError`.
- [ ] **Step 2:** los carriles (agrupar lo que se solapa, ancho 1/n) — sin esto, dos reuniones simultáneas se tapan.
- [ ] **Step 3:** el bloque, con la regla de contenido: rango completo cuando entra, hora de inicio cuando no, **título siempre**.
- [ ] **Step 4:** el scroll interno con encabezado y gutter fijos, y abrir en la hora actual.
- [ ] **Step 5:** el arrastre con umbral, cancelación y **el arrastre entre días** (que en el prototipo no existía).
- [ ] **Step 6: Verificar en pantalla** y **Commit**.

---

### Task 5: El panel de crear/editar, con guardado

**Files:** `apps/web/src/agenda/*`, `apps/web/src/Agenda.tsx`, `apps/web/src/api.ts`

**Interfaces:** panel **no modal** (la grilla queda visible), `role="dialog"`, `aria-modal="false"`, título que dice el contexto (crear/editar + día + horario), campos: título, agenda (categoría), día, hora, duración, notas. **Escape cierra sin guardar y devuelve el foco.** Al guardar: el evento aparece, **el foco va al evento creado** y **no se anuncia** (el foco es el anuncio).

- [ ] **Step 1..5:** implementar, conectar a `create_event`/`update_meeting`, verificar que el foco y el anuncio cumplen la regla de alternancia, y **Commit**.

---

### Task 6: El menú de la reunión y los diálogos (mover, duración, duplicar, eliminar)

**Files:** `apps/web/src/agenda/*`, `apps/web/src/Agenda.tsx`

**Interfaces:** un menú por reunión (abierto con `Enter`/`Space`/click) con **Editar · Mover a… · Cambiar duración… · Duplicar · Eliminar**; diálogos con borrador, `Aplicar` y `Escape` que **no escribe**; `Tab` recorriendo los controles del diálogo sin escaparse (el defecto crítico del prototipo fue justo eso); eliminar **con confirmación**.

- [ ] **Step 1..6:** implementar cada acción sobre los endpoints de Task 1, con el recorrido **por teclado de punta a punta** verificado, y **Commit**.

---

### Task 7: Accesibilidad medida

**Files:** `apps/web/src/agenda/*`, `apps/web/src/Agenda.tsx`

**Interfaces:** nombres accesibles autosuficientes, `aria-hidden` en el eje y las líneas, **anunciador persistente fuera del subárbol que se re-renderiza**, alternancia foco/anuncio en **todas** las rutas, atajos de una tecla **acotados al foco** (2.1.4), nudge con `Ctrl+Alt`+flechas, objetivos ≥24×24.

- [ ] **Step 1..5:** implementar y **medir** (contraste de bloques y de botones, foco, líneas, tamaños) — el prototipo tiene el código de medición para copiar — y **Commit**.

---

### Task 8: Deploy y verificación en prod

**Files:** `apps/crm_core/crm_core/www/hoy.html` (generado), `scripts/e2e_agenda.mjs`

- [ ] **Step 1:** `apps/web` build + `node gen-shell.mjs` → regenerar el shell.
- [ ] **Step 2:** `scripts/e2e_agenda.mjs` contra el sitio real: las tres vistas, cambiar densidad, crear/mover/duplicar/eliminar una reunión de prueba, y el recorrido por teclado.
- [ ] **Step 3:** deploy con `bash scripts/deploy-crm.sh <N>` desde el VPS (sin `--migrate`: no hay DocTypes nuevos).
- [ ] **Step 4: Verificar en pantalla** `crm.marcosbarbosagroup.com/hoy` con datos reales, y **borrar la reunión de prueba**.
- [ ] **Step 5: Commit.**

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Reemplazar la agenda que hoy usa el usuario y que algo se pierda (navegación de semana, modo día, tareas) | Task 3 empieza **leyendo** `Agenda.tsx` para inventariar lo que ya funciona; nada se borra sin haberlo replicado |
| Los endpoints nuevos tocan `CRM Lead`, que es el corazón del CRM | Tests de integración en `crm-test` primero; nunca contra producción; permisos verificados |
| El prototipo es JS puro y la app es React: traducir mal un comportamiento medido | Cada tarea referencia el prototipo y **mide** en vez de afirmar |
| Deploy a un CRM en uso | `deploy-crm.sh` verifica y **revierte** solo; backup previo si hubiera migrate |
| El tamaño real: es un proyecto de ~8 tareas, no un paso final | Se ejecuta con el mismo proceso (brief → implementador → review → fixes), una tarea por vez |
