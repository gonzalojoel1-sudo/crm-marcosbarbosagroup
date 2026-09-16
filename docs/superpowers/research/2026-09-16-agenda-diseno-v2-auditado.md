# Agenda y calendario — diseño (v2, auditado)

> **Estado:** auditado. 20 problemas encontrados (7 críticos), **todos corregidos acá**. Listo para
> convertirse en spec (faltan las secciones 3 y 4).
> **Contexto/investigación:** `2026-09-16-agenda-hallazgos.md` · **v1 del diseño y auditoría:**
> mismo directorio. **Decisión estructural:** color **por evento** (no por calendario) para lo importado.

---

## 0. Hechos verificados que mandan sobre el diseño

1. **El plan es Google AI Pro** (tabla oficial de Google): permite **más de una agenda de reservas** ✅
   (una por vertical) pero **NO agendas de reservas en calendarios secundarios** ❌ (eso pide Business
   Standard+). **Todas las reservas caen en el calendario principal.**
2. El **título de la agenda aparece en las reservas entrantes** → sirve para clasificar por regla.
3. **El scheduler de Frappe está APAGADO** (`System Settings.enable_scheduler = 0`): el pull nativo
   **no corre**. Además `Google Settings` está sin configurar y hay **0 registros `Google Calendar`**.
4. El push nativo tiene **caminos distintos** (`insert` usa `google_calendar_id` y persiste el id;
   `update` hace `get` con `event_id` y **crashea** si falta `_doc_before_save`), y el **delete** corre
   en el hook `on_trash`, **dentro del request**.
5. Los guards del push (`sync_with_google_calendar`, `pulled_from_google_calendar`) **existen sólo en
   `insert`**; el `update` no mira `pulled_from_google_calendar`.
6. Los `frappe.throw` de Google **revientan la transacción del job** (RQ hace `rollback`), y el
   `db_set` del id **no commitea** → **duplicados en Google**.
7. Google permite **color por evento** (`colorId`, paleta de 11) — pero el push de Frappe **no lo emite**.

---

## 1. Modelo

### 1.1 Entidades

| Entidad | Dueño | Rol |
|---|---|---|
| `Event` (Frappe, Desk) | framework | **La reunión**. `subject`, `starts_on`/`ends_on`, `all_day`, `event_category`, `color`, `status`, `repeat_on` + 7 días + `repeat_till`, `event_participants`, `google_calendar` **+ `google_calendar_id` (id crudo, obligatorio)**, `google_calendar_event_id`, `sync_with_google_calendar`, `pulled_from_google_calendar`, `google_meet_link`, `links` |
| `CRM Agenda` | nosotros | **Categoría**: `nombre`, `color`, `google_calendar` (el calendario de **salida**), `google_color_id` (1–11, para el color por evento), `duracion_default`, `activo`, `orden` |
| `CRM Agenda Regla` | nosotros | **Origen → categoría**: `agenda`, `campo` (Título / Descripción / Email / Calendario), `patron`, `prioridad`, `activo` |
| `CRM Reunión Excepción` (hija de `Event`) | nosotros | `instancia_original` (**la fecha original**, = `RECURRENCE-ID`), `tipo` (Movida/Cancelada), `nuevo_inicio`, `nuevo_fin`, `nota` |
| Custom Fields en `Event` | nosotros | `custom_crm_agenda`, `custom_crm_deal`, `custom_crm_organization`, `custom_crm_lead`, `custom_origen` (CRM/Reservas/Google), `custom_sync_estado`, `custom_sync_error`, `custom_sync_intentos`, **`custom_repeat_interval`**, **`custom_repeat_count`**, `custom_google_event_uid` |

### 1.2 El modelo de calendarios (corregido por la auditoría)

**Dos roles, explícitos y separados:**

| Rol | Calendario | Dirección |
|---|---|---|
| **Ingesta** | tu **principal** (donde caen las reservas) | Sólo **lectura**: un registro `Google Calendar` con `pull=1, push=0` |
| **Salida** | **uno por categoría**, creados por el CRM | Sólo **escritura**: `pull=0, push=1` |

**La categoría NO se representa con un solo Link al calendario** (el v1 lo hacía y era falso: un evento
ingerido de *primary* no puede "vivir" en la categoría). `custom_crm_agenda` es **un campo propio**, y el
`google_calendar`/`google_calendar_id` del `Event` guardan **su calendario físico** (el de origen si vino
de Google; el de la categoría si lo creó el CRM).

**El color de las reservas importadas se resuelve por `colorId` del evento** (decisión del usuario), no
moviéndolas de calendario: se quedan en el principal, sin duplicar, sin cancelar la invitación, y
**nuestro push agrega el `colorId`** de la categoría. (Paleta de 11, aproximada; el usuario puede
pisarla desde Google.)

### 1.3 Invariantes duras

1. **Orden obligatorio de arranque:** (1) `Google Settings` con client id/secret → (2) `refresh_token`
   por OAuth → (3) crear el registro `Google Calendar` de ingesta (principal) → (4) **materializar** los
   calendarios de salida y **persistir su `google_calendar_id`** → (5) recién ahí crear eventos.
   *(Sin el paso 4, `calendarId` va vacío y **falla para siempre**: el calendario se crea perezosamente
   y se guarda en la cuenta, no en el evento.)*
2. **`google_calendar_id` (el id crudo) se copia al evento** desde su `Google Calendar`. Nuestro wrapper
   lo **relee en cada intento**, no confía en el valor del evento.
3. **`sync_with_google_calendar` se persiste SIEMPRE en 0.** Nuestro job lo prende **sólo en memoria**
   para llamar al push. Es la única forma de matar el eco (el `update` nativo no mira
   `pulled_from_google_calendar` y cada pull re-empujaría).
4. **`event_type = "Public"`** en todo evento del CRM: es `reqd` y decide la visibilidad
   (`event.py:280-301`). Con `Private`, el resto del equipo no lo ve.
5. **Los invitados van como `Contact`/`User`** (o email libre en el child). Un participante que apunte a
   un `CRM Lead` sin `Contact` queda con `email = None` y **no se invita**.
6. **Unicidad:** a lo sumo una `CRM Agenda` por `Google Calendar` de salida.
7. **`instancia_original`** = fecha original (verificado: `originalStartTime` es estable aunque muevan
   la instancia dos veces).

### 1.4 Categorización automática

Reglas por prioridad sobre **título** (verificado: el título de la agenda de reservas aparece en las
reservas entrantes ✓), descripción, email del invitado o calendario. Sin match → **"Sin asignar"**.
Cuando haya más páginas de reservas (una por vertical ✓ **el plan lo permite**), se distinguen por
**título**, no por calendario ✗ (imposible con este plan).

### 1.5 Migración

| Grupo | Cuántas | Acción |
|---|---|---|
| Vinieron de Google | 3 | `Event` con `google_calendar_event_id` = ese id, `pulled_from_google_calendar = 1`, `google_calendar` = el de **ingesta** (principal) |
| Las creó el CRM | 7 | `Event` con `custom_origen = CRM`, **`sync_with_google_calendar = 0`** (no se empujan; se recrean cuando se quiera) |

`CRM Lead` se queda (es el contacto); `custom_meeting_datetime` se congela. **El cron
`sync-gcal-crm.py` se apaga** — pero **sólo después** de que la ingesta esté funcionando (§2.1).

---

## 2. Sync, conflictos y confiabilidad

### 2.1 Lo que hay que encender primero (crítico, del audit)

1. **Habilitar `System Settings.enable_scheduler`** — hoy está en **0** y el pull **no corre nunca**.
   Al encenderlo se activan **todos** los jobs del framework (dígitos diarios, flush de emails, etc.):
   **revisar uno por uno** antes.
2. `Google Settings` con client id/secret + OAuth (el proyecto de Google ya existe: es el del cron).
3. **Crear el registro de ingesta** (principal, `pull=1`) y **los de salida** (uno por categoría,
   `push=1`), materializando los calendarios (§1.3.1).
4. **Recién entonces apagar el cron.** Si se apaga antes, **las reservas de la web dejan de entrar**
   (el pull sólo escanea los calendarios del CRM; el cron era el único que leía *primary*).
5. El pull corre cada `scheduler_interval` (**240 s por defecto**), no "en continuo": la UI debe saberlo
   para no prometer tiempo real.

### 2.2 Quién manda

| Origen | Manda | Mecanismo |
|---|---|---|
| `custom_origen = CRM` | **El CRM** | Su edición se empuja; si además lo editan en Google, el pull actualiza |
| Importado (`pulled_from_google_calendar = 1`) | **Google** | El guard del **insert** lo bloquea (el del update no existe → por eso la invariante 3) |
| Editado en el CRM | Pasa a mixto | Nuestro layer **limpia el flag** de forma explícita y **en memoria**, nunca persistido |

**Sin merge de campos.** El motor nativo es *"el último que escribe gana"* por dirección; nuestra capa
**detecta y avisa**, no fusiona. Ni HubSpot ni Cal.com hacen merge.

### 2.3 La capa de confiabilidad (corregida con el audit)

**A. Nunca escribir en el request.** Nuestra API guarda el `Event` con `sync_with_google_calendar = 0`
(los guards del framework no empujan ✗ no puede fallar) y **encola**.

**B. El job NO llama las funciones del framework a ciegas.** Se verificó que:
- `update_event_in_google_calendar` **se saltea en silencio** si `modified == creation` y **crashea**
  (`AttributeError`) en `get_doc_before_save()` cuando el doc se cargó con `get_doc`.
- Ambas **retornan `None`** en sus guards → no se puede distinguir "no aplica" de "salió bien".

⇒ **Escribimos nuestro propio wrapper de push** (usando el SDK de Google, con la misma cuenta y el
mismo mapeo de campos) que:
- elige **insert** o **update** según si hay `google_calendar_event_id`;
- **verifica precondiciones explícitas** antes (categoría con calendario, `google_calendar_id` no vacío,
  OAuth con `access_token` no vacío) → si no, marca **"No aplica"**, no "Sincronizada";
- manda también el **`colorId`** de la categoría;
- **emite el RRULE completo** (`UNTIL` desde `repeat_till`, `INTERVAL`, `COUNT`) — el del framework sólo
  arma `FREQ;BYDAY`;
- captura `HttpError` **y** `RefreshError` (token revocado) con mensajes distintos.

**C. Idempotencia real (evita duplicados).** El insert usa un **id de evento generado por el cliente**
(base32hex, soportado por Google): un reintento con el mismo id devuelve **409** en vez de duplicar ✓.
Además: **una transacción por evento** y **commit inmediato** del `google_calendar_event_id` después del
insert, antes de cualquier otra escritura. *(Sin esto, el `rollback` de RQ pierde los ids y el barrido
reinserta: la capa generaba justo los duplicados que venía a evitar.)*

**D. Reintentos y estado visible.** El `crm_worker` ya corre. Barrido periódico que toma los
`Pendiente`, reintenta con espera creciente, y marca **Falló** tras N intentos con el motivo en
`custom_sync_error`. Badge por reunión + lista de "no se pudieron sincronizar".

**E. Borrado controlado.** El hook `on_trash` nativo llama a Google **dentro del request** y **no mira
los flags del evento**. Nuestro layer **evita que el hook corra** (el borrado se hace por una vía que no
dispara `on_trash`, o limpiando `google_calendar` antes) y decide en el job: **cancelar en Google** y
marcar `Cancelled` en el CRM (el patrón "no se borra, queda el historial"), o borrar de verdad si el
usuario lo pide explícitamente.

**F. Reconciliación.** Job diario: compara por `google_calendar_event_id` + `updated`, repara lo
evidente y reporta lo dudoso. **Una transacción por evento**, con tope de páginas.

### 2.4 Excepciones de recurrencia (desde el arranque)

1. **"Sólo esta"** → fila en `CRM Reunión Excepción` (con la **fecha original**) + **PUT a la instancia**
   en Google.
2. **"Esta y las siguientes"** → **dos requests** (recortar la serie + crear la nueva), como documenta Google.
3. **"Todas"** → se edita el `Event` padre y se re-emite el RRULE completo.
4. **Reconciliador de excepciones** → `events.instances()` **con ventana** (`-30d..+90d`),
   `maxResults=2500`, **tope duro de páginas** y `showDeleted=True`, y completa el child table.

### 2.5 Límites heredados del framework (declarados, no escondidos)

| Límite | Evidencia | Qué hacemos |
|---|---|---|
| Un `Yearly` con `UNTIL` **pierde el fin** | `google_calendar.py:685-688` | Nuestro parser lo lee igual; el push nuestro lo emite bien |
| Un `Daily` **pierde `ends_on`** | `google_calendar.py:656-658` | Nuestro wrapper preserva la duración |
| `INTERVAL`/`COUNT` no existen en el modelo | `event.json` | Custom Fields + nuestro serializador/parser |
| El pull **descarta las excepciones** (un `...`) | `google_calendar.py:339-340` | Reconciliador propio (§2.4.4) |
| El delete falla en silencio | `:610-615` | Borrado controlado (§2.3.E) |
| Las notificaciones por email necesitan SMTP | no hay SMTP en el servidor | No se usan |

---

## 3. UI — pendiente de aprobación

Slots de 15 min · arrastrar/estirar/crear · mes + mini-mes · buscar y filtrar por categoría, origen y
estado de sync · color por categoría · disponibilidad real y **aviso de superposición** · drawer de la
reunión (título, categoría, duración, invitados, negocio/empresa, recurrencia **con alcance**, historial
y estado de sync) · **se arregla el desfase de 40px del grid** (punto 3) · aviso de que el sync corre
cada ~4 minutos (no prometer tiempo real).

## 4. Fases — pendiente

---

## Pendientes antes del spec

1. **Roles/permisos**: qué rol crea/edita reuniones de quién (`event_type`, `owner`, `DocShare`), y si
   la API usa `ignore_permissions` con validación propia.
2. **Concurrencia**: encolar por `event.name` o lock optimista para que el pull y el push no se pisen.
3. **Series infinitas en la UI**: cómo se muestran (ventana) para no paginar sin fin.
4. **Conflicto de campos**: qué versión se **muestra** y qué se **persiste** después del aviso.
