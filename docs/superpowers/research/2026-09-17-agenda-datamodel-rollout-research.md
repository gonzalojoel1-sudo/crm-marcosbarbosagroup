# Agenda: modelo de datos y rollout — investigación con fuentes

**Fecha:** 2026-09-17 · **Autor:** investigación delegada · **Estado:** borrador para decisión
**No se escribió código.** Todo lo de abajo son hallazgos con fuente, opciones y recomendación.

**Contexto (el problema real):** en este CRM (`crm.marcosbarbosagroup.com`, Frappe v15 + MariaDB + React,
en producción, un solo consultor dueño) **una reunión ES un `CRM Lead`** con `custom_meeting_datetime`.
No hay duración (la API **fabrica** `fin = inicio + 1h`, `api.py:38`), ni todo-el-día, ni recurrencia, ni
timezones. Se va a agregar `custom_meeting_end` y después reemplazar toda la UI de agenda. Un cron
(`scripts/sync/sync-gcal-crm.py`) crea un `CRM Lead` por evento de Google con invitados.

**Método:** fuentes primarias (docs de API, RFC, código) antes que secundarias. Cada opción lleva URL.
Al final hay una sección explícita de **lo que NO pude verificar**.

> Nota de idioma: este repo escribe sus notas de investigación en español; el pedido fue en inglés. Se
> escribe en español para respetar la convención del repo, salvo las tablas de campos/código.

---

## 0. Resumen ejecutivo (las 5 respuestas)

1. **El modelo canónico de un evento** es: `inicio` + `fin` (o `inicio` + `duración`), un booleano/valor
   `todo-el-día`, una **zona horaria propia del evento** (IANA) separada de la del espectador, una regla
   de recurrencia (RRULE o estructura), excepciones (recurrence-id/EXDATE o instancias), asistentes, y un
   contenedor (`calendarId`/categoría). **Para un consultor único con sync de Google, el mínimo honesto
   es: `inicio`, `fin`, `all_day`, `timezone`, `título`, vínculo al lead, e ID externo + `updated`.**
   Recurrencia, asistentes, colores y recordatorios **se pueden NO soportar sin mentir**, siempre que la
   UI no muestre controles que no persisten.
2. **Gana `fin` (datetime) sobre `duración-minutos`.** Google, Microsoft, Cal.com y HubSpot almacenan
   `fin`; solo Salesforce y Pipedrive usan duración, y el RFC 5545 documenta el *pitfall* de DURATION con
   DST ("nominal duration … exact duration … más o menos de 24 horas en un día con cambio de zona").
   Guardamos `custom_meeting_end`; la duración se **deriva**, nunca es fuente de verdad.
3. **Migrar un dataset vivo en Frappe** = `bench migrate` (orden documentado) + un **patch** en
   `patches.txt` (sección `[post_model_sync]` si necesitás el esquema nuevo) + `frappe.db.set_value`
   para el backfill, con `bench backup` y `set-maintenance-mode`. Frappe **no** borra columnas
   (soft-delete) y **no soporta migraciones de esquema inversas**. Patrón general: *expand/contract*
   (agregar null → backfill → doble-escritura → cambiar lecturas → dejar de escribir viejo).
4. **Rollout de UI** = bandera de release (release toggle) + lectura de la vista vieja por defecto, la
   nueva opt-in por cookie/rol ("champagne brunch"), y **matar la vieja solo después** de que la nueva se
   adopte. Para un solo usuario no hay canary ni porcentajes: es *flag + comparación manual + rollback*.
   Frappe no tiene feature flags nativos; se emula con un campo/Custom Field, `site_config.json` o un
   Property Setter por rol.
5. **La reunión debe ser un objeto separado ligado al lead, no un lead.** Salesforce (Activity: Task/Event
   con `WhoId`/`WhatId`), HubSpot (objeto *meetings* con asociaciones) y Pipedrive (*activities*) hacen
   exactamente eso. **Un lead no puede sostener N reuniones** (descubrimiento, propuesta, seguimiento), y
   borrar/mover/duplicar una reunión no debe tocar el pipeline. Recomendación: usar el **`Event` de
   Frappe** (ya trae `starts_on`/`ends_on`/`all_day`/participantes y el sync nativo de Google Calendar)
   + Custom Field `custom_crm_lead` → `CRM Lead`; congelar `custom_meeting_datetime` y backfillear.

---

## 1. Cómo modelan un evento los productos serios

### 1.1 Tabla campo por campo (representación canónica + fuente)

| Concepto | Google Calendar API (`Event`) | Microsoft Graph (`event`) | iCalendar RFC 5545 (`VEVENT`) | Cal.com (`Booking`) | Nuestro CRM hoy | Fuente |
|---|---|---|---|---|---|---|
| **Inicio** | `start.dateTime` (RFC3339) o `start.date` | `start` = `DateTimeTimeZone` | `DTSTART` (DATE-TIME o DATE) | `Booking.startTime` (DateTime) | `custom_meeting_datetime` | Google events docs; Graph event; RFC 3.8.2.4; Cal.com schema |
| **Fin** | `end.dateTime` / `end.date` — **exclusivo** | `end` = `DateTimeTimeZone` | `DTEND` **o** `DURATION` (mutuamente excluyentes) | `Booking.endTime` | **no existe** (se fabrica +1h) | Google events; Graph event; RFC 3.6.1; Cal.com schema |
| **Todo el día** | `start.date`/`end.date` (sin hora; **la timezone no aplica**) | `isAllDay` (bool; start/end a medianoche misma tz) | `DTSTART;VALUE=DATE` (+ `DTEND` DATE) | no hay campo bool equivalente (derivado) | **no existe** | Google concepts; Graph event; RFC 3.6.1 |
| **Zona horaria del evento** | `start.timeZone`/`end.timeZone` (IANA), y `calendars.timeZone` como default | cada `DateTimeTimeZone` trae `timeZone`; `originalStartTimeZone` | `TZID` en `DTSTART`; o `Z` (UTC); o *floating* (local del espectador) | `Attendee.timeZone`, `User.timeZone`, `EventType.timeZone` | **no existe** (sitio en `America/Argentina/Cordoba`) | Google concepts; Graph event; RFC 3.8.2.4 / 3.3.5 |
| **Zona del espectador** | parámetro `timeZone` en `events.get/list`; default = tz del calendario | Graph normaliza a UTC y devuelve offset | *floating* local sin TZID/Z = tz del espectador | `useBookerTimezone` | no existe; se asume la del sitio | Google concepts (query result conversion) |
| **Recurrencia (RRULE)** | `recurrence[]` = strings `RRULE`/`RDATE`/`EXDATE` (RFC 5545) | `recurrence` = `patternedRecurrence` (estructura, **no** RRULE texto) | `RRULE` (RECUR) | `EventType.recurringEvent` (JSON) | **no existe** | Google concepts; Graph event; RFC 3.8.5.3; Cal.com schema |
| **Excepciones / instancias** | instancia = evento con `recurringEventId` + `originalStartTime`; cancelar = `status:"cancelled"`; "esta y siguientes" = **parte la serie en dos requests** | `type` = `seriesMaster`/`occurrence`/`exception`; `seriesMasterId`, `exceptionOccurrences`, `cancelledOccurrences` | `RECURRENCE-ID` (override) + `EXDATE` (excluir) | `Booking.recurringEventId`, `fromReschedule` | no existe | Google recurring guide; Graph event; RFC 3.8.4.4 / 3.8.5.1 |
| **Asistentes** | `attendees[]` (`email` req., `responseStatus`, `optional`, `organizer`, `resource`) | `attendees[]` (`Attendee`); `organizer`; `responseStatus` | `ATTENDEE` (`mailto:`, `PARTSTAT`, `ROLE`, `RSVP`) | `Attendee` (email, name, timeZone, noShow) | el `CRM Lead` mismo / invitados en notas | Google events; Graph event; RFC 3.6.1; Cal.com schema |
| **Calendario / categoría** | `calendarId` (contenedor) + `colorId`/`eventLabelId` (por evento) | relación `calendar` + `categories[]` (`outlookCategory`) | `CATEGORIES` (multi-valor) | `EventType` + `DestinationCalendar`/`SelectedCalendar` | no existe (todo en un solo calendar y en Google) | Google concepts; Graph event; RFC 3.6.1; Cal.com schema |
| **Identidad externa / sync** | `id` (estable), `iCalUID` (compartido por instancias), `etag`, `updated` | `id`, `iCalUId`, `changeKey`, `lastModifiedDateTime` | `UID`, `SEQUENCE`, `DTSTAMP` | `Booking.uid`, `iCalUID`, `iCalSequence`, `BookingReference` | `custom_event_id` (dedupe) | Google events; Graph event; RFC 3.6.1; Cal.com schema |
| **Estado / visibilidad** | `status` (confirmed/tentative/cancelled), `transparency` (busy/free), `visibility` | `isCancelled`, `showAs`, `sensitivity` | `STATUS`, `TRANSP` | `Booking.status` (accepted/pending/cancelled…) | no existe | Google events; Graph event; RFC 3.6.1; Cal.com schema |

Fuentes:
- Google Calendar `Event`: <https://developers.google.com/calendar/api/v3/reference/events>
- Google "Calendars and events" (todo-el-día, timezones, recurrencia, instancias/excepciones):
  <https://developers.google.com/workspace/calendar/api/concepts/events-calendars>
- Google "Recurring events" (instancias, excepciones, "this and following"):
  <https://developers.google.com/workspace/calendar/api/guides/recurringevents>
- Microsoft Graph `event`:
  <https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0>
- iCalendar `VEVENT` (RFC 5545 §3.6.1): <https://icalendar.org/iCalendar-RFC-5545/3-6-1-event-component.html>
- iCalendar `RRULE` (§3.8.5.3): <https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html>
- iCalendar `DURATION` (§3.8.2.5): <https://icalendar.org/iCalendar-RFC-5545/3-8-2-5-duration.html>
- iCalendar `DTSTART` (§3.8.2.4): <https://icalendar.org/iCalendar-RFC-5545/3-8-2-4-date-time-start.html>
- Cal.com Prisma schema (`Booking`, `Attendee`, `EventType`, `BookingReference`):
  <https://github.com/calcom/cal.com/blob/main/packages/prisma/schema.prisma>

### 1.2 Notas finas que importan (y que hoy no tenemos)

- **El fin es exclusivo.** Google, RFC 5545 y FullCalendar coinciden: un evento 09:00–10:00 termina
  *antes* de las 10:00. Si nuestro campo `custom_meeting_end` se interpreta como inclusivo, todo se corre
  una unidad. (Google events; RFC 3.6.1; FullCalendar event-object.)
- **Todo-el-día y timezone son incompatibles.** Google dice explícitamente: "the timezone field has no
  significance for all-day events", y `start.date`+`end.dateTime` es inválido. Microsoft obliga a
  medianoche en la misma tz cuando `isAllDay=true`. → No se puede reusar el mismo camino para ambos.
- **Timezone del evento ≠ timezone del espectador.** Google distingue el `timeZone` que *adjuntás al
  evento* del `timeZone` *query param* con el que **presentás** los resultados (default = tz del
  calendario). Para eventos recurrentes la tz es **obligatoria** (define la expansión). Nuestro sito
  tiene una sola tz (`America/Argentina/Cordoba`): alcanza para renderizar, **no** para sync honesto si un
  booking llega en otra tz.
- **Las excepciones de recurrencia no son "borrar el evento".** Google las modela como instancias con
  `recurringEventId` + `originalStartTime` y `status:"cancelled"`; "esta y las siguientes" exige **dos
  requests** (recortar la serie + crear la nueva) y **resetea las excepciones posteriores**. Microsoft las
  expone como `type:"exception"` + `seriesMasterId`. El RFC usa `RECURRENCE-ID`/`EXDATE`.
- **No hay un solo "evento" en Google.** El recurso tiene `eventType` (default/birthday/focusTime/
  outOfOffice/workingLocation/fromGmail) y `eventLabelId` (etiquetas). Ignorarlo hace que un out-of-office
  importado se vea como reunión. (Google events; Google event-types.)
- **Frappe ya tiene el modelo.** El DocType `Event` del framework trae `starts_on`, `ends_on`, `all_day`,
  `subject`, `event_category`, `color`, `event_participants`, `repeat_on`/`repeat_till`, y la config de
  calendario lo declara explícitamente (`field_map: {start:'starts_on', end:'ends_on', allDay:'all_day',
  title:'subject', color:'color'}`). El sync **nativo** de Google Calendar del framework sincroniza ese
  `Event`, no `CRM Lead`.
  Fuente: <https://docs.frappe.io/framework/user/en/desk> y
  <https://docs.frappe.io/framework/user/en/guides/integration/google_calendar>
- **La integración nativa de Google en Frappe tiene límites documentados:** "if an instance of a recurring
  event is cancelled in Google Calendar, this change will not be reflected in Frappe".
  (Misma doc de Google Calendar Integration.)

### 1.3 El "mínimo honesto" para un consultor único con sync de Google

Defino *honesto* = **la UI nunca muestra un control cuyo valor no se persiste, y la API nunca inventa un
dato.** Hoy hay una mentira concreta: `fin = inicio + 1h` fabricado. Eso se arregla con `custom_meeting_end`.

| Campo | ¿Entra al mínimo? | Por qué | Fuente |
|---|---|---|---|
| `inicio` (datetime) | **Sí, obligatorio** | todo el modelo depende de esto | Google/Graph |
| `fin` (datetime) | **Sí, obligatorio** | sin esto no hay duración real; hoy se fabrica | Google/Graph/Cal.com |
| `all_day` (bool) | **Sí** | Google importa all-day; sin esto un feriado/ausencia se vuelve "reunión de 00:00 a 00:00" | Google concepts; Graph `isAllDay` |
| `timezone` (IANA) | **Sí (guardar), no (selector)** | guardar la tz de origen evita corromper el round-trip; con una sola tz alcanza para renderizar. *No* ofrecer selector de tz del espectador es honesto; asumir UTC no lo es | Google concepts; RFC `TZID` |
| Vínculo al `CRM Lead` | **Sí** | una reunión sin contacto no sirve en un CRM | (diseño) |
| ID externo + `updated`/etag | **Sí** | sin esto no hay sync idempotente ni reconciliación | Google events (`id`,`updated`,`etag`) |
| `título` | **Sí** | hoy se parsea de `notes` ("Reunión agendada: …"), que es frágil | repo: `api.py`, `sync-gcal-crm.py` |
| `event_category` / agenda | **Recomendado, no mínimo** | sirve para clasificar/colorear, pero se puede vivir sin | Google `colorId`/`eventLabelId`; Frappe `event_category` |
| **Recurrencia (RRULE)** | **No ahora — y es honesto no tenerla** | Google ya expande y entrega instancias; si el CRM nunca muestra "repetir", no miente. Ojo: si NO soportás RRULE y guardás una serie, perdés las instancias | Google recurring guide; RFC 3.8.5.3 |
| **Excepciones de serie** | **No ahora** | requieren `RECURRENCE-ID`/`recurringEventId`; sin recurrencia no existen | Google recurring guide; Graph |
| **Asistentes (attendee list)** | **No ahora** | un consultor único; el lead ya tiene email. Si en el futuro invita gente, `Event.event_participants` lo cubre | Google `attendees[]` |
| **Múltiples calendarios/colores** | **No ahora** | se puede usar un solo calendar; el color por categoría es cosmético | Google `calendarId`/`colorId` |
| **Recordatorios, transparency, visibility, conference** | **No ahora** | no afectan el dato de la reunión; declararlos "no soportado" | Google events; Graph |

**La frase honesta para el dueño:** *"Soportamos reuniones con inicio, fin, todo-el-día y zona horaria de
origen. No soportamos series recurrentes, invitados múltiples ni recordatorios; si un evento de Google
tiene esas cosas, lo importamos como evento simple y lo marcamos como tal."*

**Riesgo concreto si se saltea `all_day`:** el cron ya importa eventos de Google con invitados. Un evento
all-day con un invitado entra como `custom_meeting_datetime` a medianoche y la API lo pinta 00:00–01:00.
Eso es una mentira visible. Por eso `all_day` está en el mínimo, no en "recomendado".

---

## 2. Duración: `fin` datetime vs `duración-minutos`

### 2.1 Qué usa cada API

| API | Representación | Notas | Fuente |
|---|---|---|---|
| Google Calendar | **`end` (datetime/date)**, exclusivo | no tiene campo "duration" en el event resource | <https://developers.google.com/calendar/api/v3/reference/events> |
| Microsoft Graph | **`end` = `DateTimeTimeZone`** | no hay `duration` | <https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0> |
| iCalendar RFC 5545 | **`DTEND` o `DURATION`**, nunca ambos | ambos son válidos; `DURATION` debe ser `dur-day`/`dur-week` en all-day | <https://icalendar.org/iCalendar-RFC-5545/3-6-1-event-component.html> |
| Cal.com | **`startTime` + `endTime`** | duración derivada (`EventType.length` es la *plantilla*) | <https://github.com/calcom/cal.com/blob/main/packages/prisma/schema.prisma> |
| HubSpot | **`hs_meeting_start_time` + `hs_meeting_end_time`** | también `hs_timestamp` obligatorio | <https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide> |
| Pipedrive | `due_date` + `due_time` + **`duration`** | duración como string | <https://developers.pipedrive.com/docs/api/v1/Activities> |
| Salesforce Event | `ActivityDateTime` (inicio) + **`DurationInMinutes`** | `StartDateTime`/`EndDateTime` existen; all-day usa `ActivityDate` | <http://help.salesforce.com/s/articleView?id=000386128&language=en_US&type=1> y <https://developer.salesforce.com/blogs/2014/09/formulas-in-salesforce> |
| FullCalendar (UI) | `start` + `end` | `end` exclusivo; si falta, usa `defaultTimedEventDuration` | <https://fullcalendar.io/docs/event-object> |

### 2.2 Pitfalls documentados

| Representación | Pitfall | Fuente |
|---|---|---|
| **`DURATION` (nominal)** | Con recurrencia y DST, "the same nominal duration will apply … the exact duration of each recurrence instance will depend on its specific start time. For example, recurrence instances of a nominal duration of one day will have an exact duration of **more or less than 24 hours** on a day where a time zone shift occurs." | RFC 5545 §3.8.5.3 (<https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html>) |
| **`DTEND` (exacto)** | "the same exact duration will apply to all the members of the generated recurrence set" — para cambios de duración en una serie hay que **partir la serie** (Google: dos requests; MS: editar el series master), lo que **resetea excepciones posteriores** | RFC §3.8.5.3; Google recurring guide |
| **Duración derivada (`fin-inicio`)** | Si se recalcula al mover el inicio, se pierde la duración original; Salesforce documenta que `DurationInMinutes` **no se recalcula** cuando cambiás `StartDateTime` (comportamiento histórico reportado) | <https://salesforce.stackexchange.com/questions/111505> (secundario) |
| **All-day + duración** | RFC obliga `DURATION` a `dur-day`/`dur-week` para DATE; una "duración de 1 hora" en all-day no tiene sentido | RFC §3.6.1 / §3.8.2.5 |

### 2.3 Recomendación para nuestro caso

**Guardar `fin` (datetime) como fuente de verdad; derivar la duración para la UI.**
Razones, en orden de peso:
1. **Round-trip con Google es sin pérdida.** Google entrega `end.dateTime`; si guardamos minutos,
   tenemos que reconstruir y podemos desviarnos.
2. **All-day no tiene duración.** Un feriado de 3 días no es "4320 minutos"; es `date`–`date`.
3. **DST.** El RFC documenta que la duración nominal varía ±1h en los cambios de hora; el `fin` en hora
   local evita recalcular nada.
4. **Todos los competidores relevantes (Google/MS/Cal.com/HubSpot) ya usan `fin`.**

**Caveat honesto:** Frappe guarda `Datetime` como string **naive** y lo interpreta en la tz del sitio
(`System Settings`). Para no corromper eventos que vengan de otra tz, guardar además `custom_time_zone`
(IANA) del evento; al reconstruir el RFC3339 para Google, usar `custom_time_zone` + inicio/fin locales.
La duración se muestra como **campo derivado**, nunca editable por separado.

---

## 3. Migrar un modelo vivo y en uso (Frappe v15 / MariaDB)

### 3.1 Cómo funciona `bench migrate` (orden documentado)

`bench --site <site> migrate` ejecuta, en orden: `before_migrate` hooks → **patches** → **sync de esquema**
(compara hash MD5 del JSON del DocType) → sync de fixtures/dashboards/jobs → `after_migrate` hooks. Los
patches se parten en `[pre_model_sync]` y `[post_model_sync]`: los "post" corren **después** de que los
DocTypes se recargan (no necesitan `reload_doc`).
Fuente: <https://docs.frappe.io/framework/user/en/database-migrations> y
<https://docs.frappe.io/framework/user/en/bench/reference/migrate>.

### 3.2 Tabla de opciones

| Opción | Qué te da | Qué te cuesta | Fuente |
|---|---|---|---|
| **Agregar el campo con `Customize Form` / `Custom Field` y `bench migrate`** | Camino documentado y reversible en código si se versiona como fixture; `migrate` sincroniza Custom Fields | Requiere `developer_mode` para crear DocType JSON; en prod el Custom Field vive en DB (versionarlo en un fixture/script, como ya hace `setup_custom_fields.py`) | <https://docs.frappe.io/framework/user/en/database-migrations>; <https://docs.frappe.io/erpnext/custom-field> |
| **Patch en `patches.txt` con `execute()` + `frappe.db.set_value`** | Backfill masivo en una transacción controlada; corre una sola vez; el meta disponible es el **viejo** (para migrar con los campos viejos) | Durante el patch ves el esquema viejo; si necesitás el nuevo, usá `[post_model_sync]` | <https://docs.frappe.io/framework/user/en/database-migrations> |
| **Backfill con `frappe.db.set_value` / `frappe.db.sql` dentro del patch** | Evita hooks por doc; rápido | `set_value` individual no actualiza `modified` salvo que pidas `update_modified`; para volúmenes, SQL directo | <https://docs.frappe.io/framework/user/en/database-migrations>; <https://github.com/frappe/frappe/blob/version-16/frappe/custom/doctype/custom_field/custom_field.py> |
| **Backup + mantenimiento antes del migrate** | `bench backup` y `bench --site x set-maintenance-mode on` reducen el riesgo de escritura concurrente | Downtime breve; el scheduler y los jobs deben estar considerados | <https://docs.frappe.io/framework/user/en/bench/frappe-commands> (set-maintenance-mode); <https://docs.frappe.io/framework/user/en/bench/reference/migrate> |
| **Doble-escritura / doble-lectura (expand-contract)** | Cero downtime de datos: se agrega null, se backfillea, se escribe nuevo+viejo, se cambian las lecturas, se deja de escribir el viejo | Más fases y disciplina; Frappe **no borra columnas** al quitar un campo (soft-delete), así que la "contracción" es manual | <https://martinfowler.com/articles/feature-toggles.html> (separa release de código); ver §3.4 |
| **`bench migrate` completo en prod** | Aplica esquema nuevo y Custom Fields | Downtime corto, hay que revisar jobs al re-habilitar scheduler; en este repo el scheduler está **apagado** (`enable_scheduler=0`) según la auditoría | repo: `docs/superpowers/research/2026-09-16-agenda-diseno-v2-auditado.md` |

### 3.3 Límites duros de Frappe (no son opinión)

- **Las columnas no se borran.** Al quitar/renombrar un campo, "the corresponding database columns are not
  removed … but they will not be visible in the form view. This is done to avoid any potential data loss".
- **No hay migraciones inversas.** "Frappe doesn't support reverse schema migrations."
- Los patches corren **en orden** y **una sola vez**; re-ejecutar exige cambiar la línea (p. ej. comentario
  con fecha).
- **Durante el patch, el meta es el viejo.** Para ver el esquema nuevo dentro del patch: `reload_doc`.
Fuente: <https://docs.frappe.io/framework/user/en/database-migrations>.

### 3.4 Recomendación de migración (aplicada a este CRM)

Patrón **expand → backfill → switch → contract**, sobre `CRM Lead.custom_meeting_end` (y luego sobre las
reuniones si se separan, §5):

1. **Expand:** agregar `custom_meeting_end` (nullable) + `custom_time_zone` + `custom_all_day`. Deploy con
   `bench backup` y `set-maintenance-mode on`; `bench migrate`.
2. **Backfill (patch):** `UPDATE` donde `custom_meeting_end IS NULL AND custom_meeting_datetime IS NOT
   NULL` → `custom_meeting_end = custom_meeting_datetime + 1h` (la duración que hoy se fabrica, ahora
   persistida). **Marcar esos registros** (`custom_duracion_estimada=1`) para no mentir: son estimados.
3. **Doble-escritura:** la API sigue escribiendo `custom_meeting_datetime` (compat) y ahora también
   `custom_meeting_end`. Las lecturas nuevas usan `end`.
4. **Switch:** la agenda nueva lee `end`; la vieja sigue leyendo `datetime`. El campo viejo queda
   **congelado y read-only** (patrón que ya propone la auditoría del repo).
5. **Contract:** eventualmente dejar de escribir `datetime` (la columna queda, Frappe no la borra).

**Riesgo declarado:** un `migrate` sobre el CRM en uso ya está identificado como cambio de plan en
`docs/superpowers/DECISIONES-PENDIENTES-agenda.md` (DECISIÓN 1): el plan preveía deploy **sin** migrate;
agregar el campo lo cambia y exige backup previo.

---

## 4. Rollout de una UI nueva en una app viva

### 4.1 Estrategias estándar

| Estrategia | Qué te da | Qué te cuesta | Fuente |
|---|---|---|---|
| **Release toggle (bandera estática on/off)** | Sacar la vista nueva a prod apagada; encenderla sin redeploy de datos | Hay que probar **ambos** caminos; deuda de toggle si no se retira | <https://martinfowler.com/articles/feature-toggles.html> |
| **Cookie/header override por request (champagne brunch)** | El dueño prueba la nueva en prod sin afectar a nadie | Superficie de ataque si se firma mal; hay que acordarse de sacarla | Fowler (feature-toggles) |
| **Ruta paralela (vieja y nueva conviven)** | Comparación lado a lado; rollback trivial (volver a la ruta vieja) | Doble mantenimiento mientras dure | Fowler; patrón general |
| **Porcentaje / canary rollout** | Reparte tráfico gradual y monitorea | **No aplica a un solo usuario** (n=1): un "10%" es 0 o 1 | <https://launchdarkly.com/docs/home/releases/percentage-rollouts> |
| **Progressive rollout (auto-incremento por tiempo)** | Sube el % solo, con pasos | Tampoco aplica con n=1; además no trae métricas (solo *guarded* las trae) | <https://launchdarkly.com/docs/home/releases/progressive-rollouts> |
| **Kill switch / ops toggle** | Apagar la vista nueva rápido si falla en prod | Hay que mantener el código viejo vivo | Fowler |
| **Matar la vieja solo tras adopción** | Limpieza real, sin deuda | Requiere criterio de "adoptada" (aquí: el dueño dejó de abrir la vieja N días) | Fowler (managing carrying cost) |

### 4.2 Frappe: páginas custom + banderas

| Mecanismo Frappe | Cómo se usa como flag | Fuente |
|---|---|---|
| **`site_config.json` vía `bench set-config <key> <value>`** | Bandera por sitio, leíble con `frappe.conf.<key>`; ideal para release toggle sin tocar DB | <https://docs.frappe.io/framework/user/en/bench/reference/set-config> |
| **Custom Field / Property Setter controlado por fixture** | "Mostrar agenda nueva" como campo de config; `migrate` sincroniza Custom Fields | <https://docs.frappe.io/framework/user/en/database-migrations> |
| **Roles / permisos** | Qué rol ve la página nueva (permissioning toggle) | <https://docs.frappe.io/framework/user/en/guides/integration/google_calendar> (patrón de permisos) — ver nota |
| **Ruta nueva en la app React** | Montar la agenda nueva en una ruta paralela (`/agenda-v2`) y dejar la vieja intacta | repo: `frontend/` de la app `crm` |

> **Nota honesta:** Frappe **no** documenta un sistema de feature flags de primera clase en v15. Lo que
> existe es `site_config` + `frappe.conf`, Custom Fields y permisos por rol. Para un solo usuario, con
> cualquiera de esos alcanza; no hace falta LaunchDarkly.

### 4.3 Recomendación de rollout (aquí)

Para n=1 (Marcos):
1. **Ruta paralela** `/agenda-v2` (o pagina custom) + la vieja sigue en `/agenda`.
2. **Bandera en `site_config`** (`agenda_v2=1`) para que la nueva sea la default cuando vos quieras.
3. **Comparación manual**: un pequeño banner "Estás en la agenda nueva · volver a la clásica" que setea
   una cookie/`frappe.conf` override para vos. Esto es el *champagne brunch* de Fowler.
4. **Criterio de retiro:** cuando uses la nueva una semana sin volver a la vieja, se borra la ruta vieja.
   No hay canary ni porcentaje que tenga sentido con un solo usuario.
5. **Rollback:** desactivar la bandera (no hay migración que revertir mientras no se borre el campo viejo).

---

## 5. La reunión como lead vs objeto separado (la decisión más importante)

### 5.1 Qué hacen los CRM con calendario propio

| Producto | ¿Qué es una reunión? | Vínculo | Borrar la reunión… | Fuente |
|---|---|---|---|---|
| **Salesforce** | `Event`, un tipo de **Activity** (junto con `Task`), objeto **separado** del Lead/Opportunity | `WhoId` (Contact/Lead) y `WhatId` (Account/Opportunity) — **polimórfico** | No toca el Lead/Opportunity | <https://www.salesforceben.com/salesforce-activities-everything-you-need-to-know>; <https://developer.salesforce.com/blogs/2014/09/formulas-in-salesforce> |
| **HubSpot** | Objeto **`meetings`** (engagement) con propiedades propias | `associations` a contacts/companies/deals | No toca el contacto | <https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide> |
| **Pipedrive** | Objeto **`activities`**, asociable a deal, **lead**, person y organization | `deal_id`, `lead_id`, `person_id`, `org_id` | Marca la actividad como eliminada; no toca el lead/person | <https://developers.pipedrive.com/docs/api/v1/Activities> |
| **Cal.com** | `Booking`, entidad propia | `Attendee` hijos; `EventType`; destino es un calendar/CRM | Cancela el booking, no borra el contacto | <https://github.com/calcom/cal.com/blob/main/packages/prisma/schema.prisma> |
| **Frappe (framework)** | DocType **`Event`** | campo `reference_document` + `event_participants`; el sync Google nativo va contra `Event` | Borra el evento, no el documento referenciado | <https://docs.frappe.io/framework/user/en/desk>; <https://docs.frappe.io/framework/user/en/guides/integration/google_calendar> |
| **Frappe CRM (app)** | **No hay objeto reunión.** Features listadas: tasks, notes, comments, call logs. No calendar/meeting | — | — | <https://github.com/frappe/crm/blob/develop/README.md> |
| **Nuestro CRM** | **Es un `CRM Lead`** con `custom_meeting_datetime` | el lead *es* la reunión | hay que elegir soft-delete (repo) o perder el lead | repo: `docs/superpowers/DECISIONES-PENDIENTES-agenda.md` |

**Conclusión de la tabla:** los tres CRM con calendario serio modelan la reunión/actividad como **objeto
separado** ligado a la persona/negocio. **Ninguno** hace que la reunión *sea* el contacto ni un estado del
contacto.

### 5.2 Los efectos laterales concretos de "reunión = lead"

| Operación | Con "reunión = lead" | Con objeto separado |
|---|---|---|
| **Una segunda reunión con el mismo contacto** | **Imposible**: una fila `CRM Lead` = una reunión. El cron ya crea un lead por evento → si el mismo email reserva dos veces, hay **leads duplicados** | N eventos → 1 lead |
| **Borrar la reunión** | O borra el lead/contacto/historial, o hace soft-delete y la fila queda como "lead sin reunión" (indistinguible) | Borra el evento; el lead queda |
| **Duplicar** | Duplica el lead → contactos y pipeline duplicados | Duplica el evento |
| **Mover / reprogramar** | Muta un campo del lead; sin historial de reprogramaciones | Muta el evento; se puede guardar historial/origen |
| **Convertir a Deal** | ¿La reunión viaja con el lead? Si el lead se convierte, el campo de reunión puede desincronizarse del pipeline | El evento se re-vincula al Deal |
| **Pipeline** | El estado de venta queda entrelazado con el agendamiento | Separados (Salesforce los relaciona explícitamente) |
| **Sync Google** | El cron mapea evento→lead y **no puede actualizar sin crear otro lead** (`custom_event_id` dedupe) | El sync va contra el objeto evento, por `id` externo |

### 5.3 Recomendación (con trade-off)

**Introducir un objeto reunión separado y dejar que el `CRM Lead` sea el contacto.**

**Opción A (recomendada): usar el `Event` de Frappe + Custom Fields.**
- **Qué da:** modelo completo ya hecho (`starts_on`/`ends_on`/`all_day`/`event_participants`/`repeat_on`),
  la **integración nativa de Google Calendar del framework** (pull y push) en vez de mantener el cron, y
  una vista de calendario en Desk si hace falta.
- **Qué cuesta:** `Event` es genérico (incluye cosas que no usás); hay que agregar `custom_crm_lead`
  (Link a `CRM Lead`), `custom_crm_deal`, `custom_origen`, `custom_sync_estado`; la doc nativa avisa que
  las **cancelaciones de instancias de series no se reflejan** en Frappe.
- **Encaja con lo ya auditado:** la auditoría previa del repo ya eligió exactamente esto (Event = reunión;
  `CRM Agenda` = categoría; `CRM Lead` se queda como contacto; el cron se apaga después de encender la
  ingesta). Fuente interna: `docs/superpowers/research/2026-09-16-agenda-diseno-v2-auditado.md`.
- **Fuentes:** <https://docs.frappe.io/framework/user/en/desk>;
  <https://docs.frappe.io/framework/user/en/guides/integration/google_calendar>

**Opción B: crear un DocType propio `CRM Meeting` (Link a `CRM Lead`).**
- **Qué da:** forma CRM-native, sin el lastre del `Event` genérico; control total del modelo mínimo (§1.3).
- **Qué cuesta:** hay que **re-implementar todo el sync** de Google contra el nuevo DocType (el nativo
  apunta a `Event`); más código propio y más superficie de bugs de sync. Solo conviene si el `Event` de
  Frappe resulta demasiado incómodo en la UI.

**Opción C: quedarse con `CRM Lead` + `custom_meeting_end` (estado actual + campo).**
- **Qué da:** cero migración estructural, un solo deploy chico.
- **Qué cuesta:** arrastra todos los efectos de §5.2; en particular **no podés representar dos reuniones
  por contacto** ni distinguir una reunión borrada de un lead sin reunión. Es la opción más barata y la
  menos honesta a mediano plazo. La auditoría ya la descartó.

**Migración que implica A (o B):**
1. Crear el vínculo `custom_crm_lead` en `Event`.
2. **Backfill:** por cada `CRM Lead` con `custom_meeting_datetime`, crear **un** `Event` con
   `starts_on = custom_meeting_datetime`, `ends_on = custom_meeting_end` (backfilleado en §3), `all_day=0`,
   `custom_crm_lead = <lead>`, `custom_origen = 'CRM'`. Dedupe por `custom_event_id` cuando exista.
3. **Congelar** `custom_meeting_datetime`/`custom_meeting_end` (read-only) — no borrarlos (Frappe no los
   borra igual).
4. **Doble-lectura** durante la transición: la agenda nueva lee `Event`; la vieja sigue leyendo el lead.
5. **Apagar el cron `sync-gcal-crm.py` solo después** de que la ingesta nativa esté funcionando (si se
   apaga antes, las reservas de la web dejan de entrar). Fuente interna: auditoría v2, §2.1.
6. **Decidir el caso "lead creado por el cron con datos de la reunión":** el cron hoy crea un lead por
   evento; al separar, hay que **deduplicar por email** para no dejar un lead por reserva.

**Trade-off explícito:** A gana por costo de sync (reusa Google nativo y el modelo completo de Frappe);
B gana en limpieza de modelo pero paga con sync propio; C es la más barata hoy y la que más miente mañana.
Dado que el dueño es uno y el calendario ya viene de Google, **A es la recomendación**.

---

## 6. Lo que NO pude verificar (explícito)

1. **Modelo interno de Notion Calendar** (ex Cron): no hay API ni esquema público; no encontré una fuente
   primaria. Lo que es público es que consume iCalendar/Google, pero **no pude citar su modelo de datos**.
2. **Modelo interno de Apple Calendar**: propietario (CloudKit/EventKit); su formato de intercambio es
   iCalendar/CalDAV, que es lo que cité (RFC 5545 / CalDAV). El esquema on-disk/CloudKit **no lo verifiqué**.
3. **Modelo interno de Google Calendar**: solo es público el **recurso de la API**, que usé como
   representación canónica. La tabla de storage real de Google no es pública.
4. **`event.json` de Frappe**: no pude descargar el JSON (`raw.githubusercontent` y `github.com/.../blob`
   devolvieron 404 desde este entorno). Los campos de `Event` los tomé de la doc oficial de vista de
   calendario (`docs.frappe.io/.../desk`, que declara `starts_on`/`ends_on`/`all_day`/`subject`/`color`)
   y del `event.json` citado por la auditoría interna del repo. **Verificar en el VPS** con
   `bench --site <site> execute "frappe.get_meta('Event')"` antes de decidir.
5. **`refactoring.com/catalog/parallelChange.html`** devolvió 404; el patrón expand/contract lo describo
   sin URL de catálogo, apoyado en el artículo de Feature Toggles de Fowler.
6. **Página oficial de `salesforce_api_objects_event.htm`** devolvió 403 desde este entorno; la corroboré
   con Salesforce Help (Activity date/time), el blog de developers de Salesforce (DurationInMinutes) y un
   listado de columnas de CData (**secundario**). La URL del objeto es la canónica pero no la pude leer.
7. **Unidad exacta del `duration` de Pipedrive** (¿minutos? ¿"HH:MM"?): la doc v2 dice "string" y no
   explicita la unidad en lo que pude leer. **No verificado.**
8. **`Interoperabilidad real de `DURATION` en CalDAV servers (RFC 4791)**: no leí el RFC 4791 a fondo;
   asumo que un servidor CalDAV guarda el VEVENT tal cual, pero **no lo verifiqué**.
9. **Comportamiento de `DurationInMinutes` al cambiar `StartDateTime`**: lo reporta un hilo de
   StackExchange (secundario), no la doc oficial de Salesforce. Tratarlo como indicio, no como hecho.

---

## 7. Fuentes (lista completa)

**Productos / APIs**
- Google Calendar `Event`: <https://developers.google.com/calendar/api/v3/reference/events>
- Google "Calendars and events": <https://developers.google.com/workspace/calendar/api/concepts/events-calendars>
- Google "Recurring events": <https://developers.google.com/workspace/calendar/api/guides/recurringevents>
- Google "Event types": <https://developers.google.com/workspace/calendar/api/guides/event-types>
- Microsoft Graph `event`: <https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0>
- iCalendar `VEVENT`: <https://icalendar.org/iCalendar-RFC-5545/3-6-1-event-component.html>
- iCalendar `DURATION`: <https://icalendar.org/iCalendar-RFC-5545/3-8-2-5-duration.html>
- iCalendar `DTSTART`: <https://icalendar.org/iCalendar-RFC-5545/3-8-2-4-date-time-start.html>
- iCalendar `RRULE`: <https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html>
- Cal.com Prisma schema: <https://github.com/calcom/cal.com/blob/main/packages/prisma/schema.prisma>
- FullCalendar event object: <https://fullcalendar.io/docs/event-object>

**CRM**
- HubSpot Meetings API: <https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide>
- Pipedrive Activities: <https://developers.pipedrive.com/docs/api/v1/Activities>
- Salesforce Activity date/time (help): <http://help.salesforce.com/s/articleView?id=000386128&language=en_US&type=1>
- Salesforce Activity formulas (developer blog): <https://developer.salesforce.com/blogs/2014/09/formulas-in-salesforce>
- Salesforce Event (object ref, 403 desde este entorno): <https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_event.htm>
- Salesforce Activities (secundario): <https://www.salesforceben.com/salesforce-activities-everything-you-need-to-know>

**Frappe**
- Database Migrations: <https://docs.frappe.io/framework/user/en/database-migrations>
- Deployment Migrations: <https://docs.frappe.io/framework/user/en/guides/deployment/migrations>
- `bench migrate`: <https://docs.frappe.io/framework/user/en/bench/reference/migrate>
- Frappe Commands (set-maintenance-mode): <https://docs.frappe.io/framework/user/en/bench/frappe-commands>
- `bench set-config`: <https://docs.frappe.io/framework/user/en/bench/reference/set-config>
- Google Calendar Integration (framework): <https://docs.frappe.io/framework/user/en/guides/integration/google_calendar>
- Desk / Calendar view (`Event` field_map): <https://docs.frappe.io/framework/user/en/desk>
- Custom Field (Customize Form): <https://docs.frappe.io/erpnext/custom-field>
- Frappe CRM Custom Fields: <https://docs.frappe.io/crm/custom-fields>
- `create_custom_field` (código): <https://github.com/frappe/frappe/blob/version-16/frappe/custom/doctype/custom_field/custom_field.py>
- `migrate.py` v15 (orden de migración): <https://github.com/frappe/frappe/blob/version-15/frappe/migrate.py>

**Rollout**
- Martin Fowler / Pete Hodgson, Feature Toggles: <https://martinfowler.com/articles/feature-toggles.html>
- LaunchDarkly, Percentage rollouts: <https://launchdarkly.com/docs/home/releases/percentage-rollouts>
- LaunchDarkly, Progressive rollouts: <https://launchdarkly.com/docs/home/releases/progressive-rollouts>

**Fuentes internas del repo**
- `docs/superpowers/DECISIONES-PENDIENTES-agenda.md` (DECISIÓN 1, 2, 3)
- `docs/superpowers/research/2026-09-16-agenda-diseno-v2-auditado.md` (modelo Event + Agenda, migración, sync)
- `docs/crm-config.md` (cron, timezone, campos custom)
- `apps/crm_core/crm_core/api.py` (`_end_or_default`, `_meeting_dto`)
- `scripts/sync/sync-gcal-crm.py`, `scripts/setup_custom_fields.py`
