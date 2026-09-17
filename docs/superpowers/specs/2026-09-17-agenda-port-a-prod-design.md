# Spec — Port de la agenda a producción (`/hoy`)

**Fecha:** 2026-09-17
**Estado:** propuesto (fundamentado en tres investigaciones paralelas, abajo)
**Reemplaza a:** `docs/superpowers/plans/2026-09-17-agenda-port-a-prod.md` (ese plan asumía que la reunión seguía siendo un `CRM Lead`; **esta spec cambia el modelo**)
**Diseño de la interacción (vigente, no se reabre):** `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md` — ya implementado y medido en el prototipo, con 29 guardas verdes.

**Investigaciones que la fundamentan:**
- `2026-09-17-decision-build-vs-adopt-agenda.md` — qué construir y de qué apalancarse
- `2026-09-17-agenda-datamodel-rollout-research.md` — modelo de datos y migración
- `2026-09-17-shipping-verificacion-frontend-prod.md` — cómo shippear y verificar en producción

---

## 1. Las cinco decisiones que salen de la investigación

| # | Decisión | Por qué | Si me equivoco |
|---|---|---|---|
| **D1** | **La reunión deja de ser un `CRM Lead` y pasa a ser un `Event` de Frappe**, linkeado al lead por un campo propio | `Event` ya trae **`ends_on`** (duración real), todo-el-día, recurrencia, participantes y **sync con Google correcto en zona horaria**. Un `CRM Lead` **no puede tener N reuniones** y hoy borrar/duplicar/mover toca el pipeline. Salesforce, HubSpot y Pipedrive modelan la reunión como **objeto separado linkeado**; ninguno como estado del contacto | Hay que migrar las ~10 reuniones existentes y tocar el sync de Google. Es el riesgo más alto del port, y por eso es una fase propia con backup |
| **D2** | **Se construye la agenda nosotros, no se adopta una librería** | Ninguna opción permisiva trae mover/redimensionar por teclado. MUI X Scheduler (MIT, todavía `beta`) **obliga a `role="grid"`**, que nuestra spec prohíbe; Schedule-X pone el arrastre detrás de €479/año; DHTMLX es GPL-2.0; Bryntum/Kendo son comerciales. Nuestra interacción **ya está diseñada, auditada y medida** | Si una librería hiciera falta, `@mantine/schedule` (MIT) es el único candidato a spike. Costo: reescribir la interacción en vez de portarla |
| **D3** | **El arrastre sigue siendo acelerador, no requisito**: el cumplimiento de 2.5.7 lo dan el menú y los diálogos | Lo dice la guía de Pragmatic DnD y es exactamente lo que ya shippeamos. No se adopta `dnd-kit` ni ninguna librería de arrastre | Si algún día se quiere arrastre por teclado píxel a píxel, `dnd-kit` `KeyboardSensor` es el menos malo, pero necesita un `coordinateGetter` propio y **no tiene resize** |
| **D4** | **Se abandona el base64 en el shell de `www`** | El base64 existe por un problema **documentado y desactivable**: Frappe rechaza templates con `.__` ("Illegal template") y el bundle minificado lo contiene. Se apaga con `safe_render = False` en `www/hoy.py`, y ahí el bundle se sirve normal. El mecanismo sancionado por Frappe es `frappe-ui/vite` con `buildConfig.indexHtmlPath` → `www/*.html` y los assets en `/assets` | Si `safe_render` no alcanza, se vuelve al base64 (funciona, solo es incómodo para depurar y testear) |
| **D5** | **Se guarda el `fin` como fecha-hora, no una duración en minutos** | Google, Microsoft, Cal.com y HubSpot usan `end`; solo Salesforce y Pipedrive usan minutos. RFC 5545 §3.8.5.3 documenta que una DURACIÓN nominal **varía ±1 h con el cambio de horario** | Si se elige duración, cada evento recurrente queda mal en los cambios de horario |

## 2. El modelo de datos mínimo honesto

**De la investigación, lo mínimo que no miente al usuario:**

| Campo | ¿Obligatorio ahora? | Por qué |
|---|---|---|
| `starts_on`, `ends_on` (naive, en la zona del sitio) | **Sí** | Es el núcleo. `ends_on` da la duración |
| `all_day` | **Sí, aunque no lo usemos** | **Google importa eventos de todo el día**: sin el campo, un evento de todo el día entra como si empezara a medianoche |
| zona horaria (IANA) | **Sí, mínima** | El evento tiene su zona y el visor la suya; confundirlas corre reuniones |
| link al lead (`custom_crm_lead`) | **Sí** | Es lo que hace que la reunión sirva al CRM |
| `subject` | Sí | El título real (hoy se **parsea de `notes`** ✗) |
| recurrencia (RRULE) | **No** (declarado) | Es una fase propia. `Event` ya tiene el campo: se usa cuando se implemente |
| excepciones de recurrencia, invitados, recordatorios, colores | **No** | Declarado fuera de alcance |

**Regla de zona horaria (crítica, y fácil de romper):** los datetimes de Frappe se tratan como **hora de pared naive en la zona del sitio**. **Nunca** `toISOString()` sobre ellos. La aritmética de slots se hace en **minutos enteros**; `Intl` solo para mostrar; y la recurrencia se expande **en el servidor** (Frappe ya tiene `get_events`).

## 3. Dos bugs de infraestructura que hay que arreglar antes de deployar

**I1 — El orden del deploy está al revés.** `deploy-crm.sh` **cambia los servicios y después migra**, así que el frontend nuevo lee el Custom Field **antes de que exista** → error en producción. **Corrección:** migrar primero (dos deploys) **o** hacer el frontend defensivo (que tolere el campo ausente). La investigación recomienda **migrar primero**; el script además **ya hace backup previo** ✓.

**I2 — El health check no verifica nada útil.** `deploy-crm.sh` solo comprueba `1/1` + HTTP 200. **Un bundle cliente que revienta igual devuelve 200** ✗ → una agenda rota pasa el chequeo y se da por buena. **Corrección:** `e2e_hoy.mjs` **ya captura `pageerror` pero nunca afirma**: convertir eso en aserción es el cambio de mayor valor del port, y va en esta spec como **requisito de la fase de deploy**, no como opcional.

## 4. Plan por fases

Cada fase termina con su verificación **medida**, no afirmada. La verificación en VPS ya está resuelta: **servicio Swarm descartable** en la red `crm_crm-net` (necesita resolver `mariadb` y `redis-cache`), `docker cp` de los archivos, `bench --site crm-test run-tests`, y se elimina. Producción no se toca.

| Fase | Qué entrega | Verificación | Bloquea a |
|---|---|---|---|
| **F0 · Saneamiento del entorno** | El script de Custom Fields corriendo **por `bench`** y no standalone (el standalone falla por el logging: `FileNotFoundError`), y `custom_meeting_end` creado en `crm-test` | Los 16 tests de agenda pasan en `crm-test` | Todo lo demás |
| **F1 · Modelo de datos: `Event`** | Migración de la reunión-lead a `Event` con `custom_crm_lead`; backfill de las reuniones existentes; el sync de Google envuelto (tiene 3 defectos documentados: el push lanza dentro de `save()`, el delete falla en silencio, el guard del update es inseguro) | Tests de integración: crear/mover/redimensionar/duplicar/borrar sobre `Event`, y que el lead **no** se toque al borrar una reunión | F2+ |
| **F2 · API de la agenda sobre `Event`** | `get_agenda` leyendo `Event`; endpoints de mover/duración/duplicar/borrar; sin parsear el título de `notes` | Los tests de F1 + los de F3 siguen verdes | F3+ |
| **F3 · Shell sin base64** | `safe_render = False` en `www/hoy.py`, bundle servido normal, `frappe-ui/vite` como mecanismo | `/hoy` carga y el E2E llega al DOM sin Blob | F4+ |
| **F4 · La agenda en React** | El esqueleto con las tres vistas, la densidad Zoom-Amplio por defecto y el estado en la URL; la grilla con carriles, scroll y arrastre; el panel; el menú y los diálogos; la accesibilidad medida | E2E contra el sitio real: tres vistas, densidad, crear/mover/duplicar/borrar, y el recorrido por teclado de punta a punta | F5 |
| **F5 · Deploy y verificación** | `deploy-crm.sh` con **migrate primero**; `e2e_hoy.mjs` con `pageerror` **como aserción**; deploy con backup | E2E verde contra `crm.marcosbarbosagroup.com/hoy` con datos reales, y la reunión de prueba borrada | — |

**F0 y F1 son las que cambian el resultado**, y F1 es la de mayor riesgo: toca el sync de Google que hoy trae las reservas. Va con backup y con las reuniones existentes migradas.

## 5. Verificación (lo que se agrega al arnés)

- **E2E con Playwright Test** contra el sitio real, con `storageState` de un usuario de prueba (hoy los scripts usan una API key temporal de Administrator). Ojo con dos trampas verificadas: **`page.route` no puede interceptar `blob:`** en Chromium ni Firefox, y **`networkidle` está oficialmente desaconsejado**.
- **`pageerror` como aserción** (I2). Es el cambio más barato y el que atrapa el deploy roto.
- **axe-core es complementario, no redundante**: no tiene reglas para contraste del indicador de foco, contraste de bordes/líneas, existencia y persistencia de `aria-live`, ni orden de foco — **exactamente lo que nuestro arnés mide**. Se agrega axe para lo que sí cubre, y nuestra medición sigue siendo la autoridad en lo demás.
- **Monitoreo mínimo**: `window.onerror` + `unhandledrejection` → un endpoint whitelisteado → `frappe.log_error`. Nada de Sentry por ahora.

## 6. Lo que NO entra (declarado, para no sorprender)

Recurrencia (RRULE) y excepciones · invitados y RSVP · recordatorios y colores por evento · zona horaria por evento **más allá de leerla del sync** · táctil (F4 del spec de interacción) · operaciones en la vista Mes · deshacer (`⌘Z`) · la paleta ⌘K en español · notificaciones por email (no hay SMTP).

### Deuda declarada que deja F2 (API sobre `Event`)

Ninguna es un bug de F2: son consecuencias conocidas que se resuelven en otra fase. Se declaran acá para que no sorprendan.

- **Desvincular eventos importados de Google.** Update y delete limpian `google_calendar` (invariante anti-hooks de F2), así que un `Event` que vino de Google pierde el link a su calendario, y borrarlo en el CRM **no** lo borra en Google. Peor: si se re-enciende el pull, el próximo sync lo **re-inserta** (el pull identifica por `google_calendar_event_id`, que no se borra). Se resuelve en la fase del push propio (push con estado + reconciliación), no antes.
- **`frappe.get_all` salta los permisos** en la ventana de la agenda: correcto para el CRM de un solo usuario (y necesario para no ocultar los `Event` backfilleados con owner `Administrator`), pero con un segundo usuario filtraría títulos privados. **Precondición antes de multiusuario:** filtrar por calendario/categoría o por una regla de share.
- **La ventana filtra sólo por `starts_on`** (`api.py`): un evento de varios días que empieza antes de la ventana queda afuera. Item de **F4** (es el visor el que decide la ventana).
- **La UI ignora `all_day`** y `EventDTO` (`apps/web/src/api.ts`) no declara el campo: un evento de todo el día se dibujaría como un bloque de altura cero. Item de **F4**.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| **F1 toca el sync de Google que trae las reservas del CRM** | Fase propia, con backup, y las reuniones migradas antes de tocar el sync. Si algo falla, se revierte a la imagen anterior |
| Migrar ~10 reuniones de `CRM Lead` a `Event` | Backfill idempotente desde `custom_meeting_datetime`, con el lead linkeado; `custom_meeting_datetime` **se congela, no se borra** (Frappe nunca borra columnas y no hay migraciones inversas) |
| El frontend nuevo lee un campo que todavía no existe | I1: migrar antes de swapear servicios |
| Un deploy roto pasa el health check | I2: `pageerror` como aserción en el E2E |
| El port es grande y varias sesiones | Fases con entregables independientes: F0–F3 se verifican sin UI, F4 es la UI, F5 el deploy |
