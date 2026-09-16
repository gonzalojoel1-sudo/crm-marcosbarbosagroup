# Agenda y calendario — contexto, hallazgos y decisiones

> **Qué es este documento.** Todo lo que se investigó y aprendió sobre la agenda del CRM
> (2026-09-16), en un solo lugar, con las rutas y las líneas del código para no tener que volver a
> buscarlo. Se actualiza a medida que avanzamos. **No es el spec todavía**: es el material del que
> sale el spec.

---

## 1. Los 10 problemas y su causa real

| # | Síntoma | Causa verificada |
|---|---|---|
| 1 | Agendo en el CRM y no se agenda en Google | El sync es **de una sola dirección (Google → CRM)**: un cron en el host cada minuto (`scripts/sync/sync-gcal-crm.py`) lee el calendario y **crea leads**. **No existe el camino CRM → Google.** |
| 2 | No puedo modificar horario ni con quién | No hay `update_event`; y "con quién" **es** el contacto: el invitado se guarda como `first_name`/`last_name` del `CRM Lead` |
| 3 | 20:00 me queda 19:00 | **No es zona horaria.** Es un **desfasaje de render**: las etiquetas de hora viven en `.ag-gutter` (arrancan en el borde superior) y las casillas en `.ag-body` (arrancan ~40px abajo, debajo de `.ag-dayhead`). `HOUR_H = 46px` → la etiqueta queda ≈0,87 h arriba de su casilla → clickeás "20:00" y caés en 19:00. **Verificado con los números.** El sitio está en `America/Argentina/Cordoba` y los eventos que vienen de Google guardan la hora correcta. |
| 4 | No puedo agendar 19:15 / 19:30 | La UI es **por hora entera**: `creating.hour` es un entero y arma `${día} ${hora}:00:00` |
| 5 | No puedo modificar la duración | `create_event(subject, starts_on, ends_on)` **recibe `ends_on` y lo ignora** (el lead no tiene hora de fin). Y para las reservas de clientes, la duración se configura en la **página de Google**, no en el CRM |
| 6 | No puedo hacer recurrentes | No hay modelo de recurrencia |
| 7 | No puedo marcar un lead/cliente/empresa | `create_event` **crea un contacto nuevo con el título partido en nombre y apellido**; no puede vincular uno existente |
| 8 | No puedo eliminar | No hay delete. Y como "reunión = lead", borrar la reunión sería **borrar el contacto** |
| 9 | No puedo cambiar el título | El título vive en `notes` como `"Reunión agendada: …"` y se **re-parsea** con `_summary_from_notes` (un split de string) |
| 10 | Falta nivel | Consecuencia de todo lo anterior |

## 2. La causa de raíz, en una línea

En `apps/crm_core/crm_core/api.py:757` está escrito literalmente:

```python
# Una reunión en este CRM es un CRM Lead con custom_meeting_datetime.
```

Una reunión **es un contacto**. De ahí salen los puntos 2, 5, 6, 7, 8 y 9: no hay entidad reunión donde
poner título, duración, invitados, repetición ni empresa.

## 3. Cómo funciona hoy (los tres escritores)

```
Prospecto → sitio web (marcosbarbosagroup.com)
              └─ "Agendar Reunión" → Google Appointment Schedule   ← config/theme.ts:20 y :23
                    ├─ el cliente elige horario
                    └─ Google crea el evento con el prospecto como INVITADO
                          ↓
        cron del host (cada minuto) scripts/sync/sync-gcal-crm.py
              ├─ lee el calendario (singleEvents=true → expande las series)
              ├─ toma el primer invitado (no self, no organizer)
              └─ crea un CRM Lead: custom_meeting_datetime + notas "Reunión agendada: <título>"
                          ↓
                   El CRM lo muestra en Agenda (pero no lo creó ni lo entiende)

El CRM, por su lado: create_event() crea OTRO lead con el título partido → nunca llega a Google
Vos, por tu lado: movés/cancelás en Google → el CRM no se entera
```

**El sitio NO toca la API de Google** (verificado: no hay `googleapis`/`calendar/v3` en el proyecto).
Lo que hace es **enlazar** a la página de reservas de Google. El tercer escritor es **Google mismo**
(Appointment Schedule).

- `/api/lead` del sitio (`app/api/lead/route.ts`) es el **formulario de contacto** → POSTea un
  `CRM Lead` con `source: "Website"` y `custom_plan_interes`. **No tiene fecha ni reunión.**

---

## 4. Decisiones tomadas (2026-09-16)

| Pregunta | Decisión |
|---|---|
| ¿Dónde vive la verdad? | **Dos vías, sincronización real** |
| ¿Qué calendarios? | El CRM **crea y administra sus propios calendarios por categoría** en la cuenta de Google; de los otros calendarios sólo **lee** para saber disponibilidad |
| ¿Reunión sin cliente? | **Sí**: la reunión es una entidad propia, con cliente/empresa/contacto **opcional** |
| ¿Recurrencia? | **Completa tipo Google Calendar** (diaria/semanal/mensual/anual, varios días, intervalo, fin por fecha o cantidad) |
| ¿Nivel de UI? | **Todo**: arrastrar/estirar/crear con mouse · mes completo + mini-mes · buscar y filtrar por tipo · distinguir por color · **ver disponibilidad real y avisar si te pisás** |
| Categorías con color | **Trabajo (rojo) · Ministerial (azul) · Personal (verde)**, coexistiendo e identificables. **Cada categoría = un calendario del CRM** |

---

## 5. Referencias investigadas y qué decide cada una

| Fuente | Hallazgo | Decisión que informa |
|---|---|---|
| **Google Calendar API — recurrentes** | La serie es **un** evento con `RRULE`; las instancias son virtuales; las modificadas son **excepciones**. *"No modifiques instancias individuales cuando querés modificar toda la serie… crea muchísimas excepciones que ensucian el calendario"* | El editor **pregunta el alcance**: esta / esta y las siguientes / todas |
| **Google Calendar API — instancias** | Campos de instancia: **`recurringEventId`** y **`originalStartTime`** ("identifica la instancia aunque se haya movido"). Para modificar una: PUT a la URL de la instancia. Para cancelar: `status: "cancelled"` | **Existe el identificador estable de instancia** que hace falta para resolver excepciones |
| **Google Calendar API — `events.list`** | *"Por defecto devuelve eventos sueltos, recurrentes **y excepciones**; las instancias que no son excepciones no se devuelven"* | **Las excepciones SÍ llegan** en el sync incremental (con `syncToken`). Ver §7 |
| **RFC 5545 (el estándar)** | El conjunto de recurrencia = `DTSTART` + `RRULE` + `RDATE` − `EXDATE`; **`RECURRENCE-ID`** identifica la instancia; **`RANGE=THISANDFUTURE`** = "esta y las siguientes" | El modelo correcto para excepciones, si las implementamos |
| **IETF (draft calext-icalendar-series)** | *"La definición de reglas de recurrencia de iCalendar es ambigua y ha llevado a interpretaciones distintas **incluso entre desarrolladores de calendario experimentados**"* | Calibración: esto es **difícil por estándar**, no por inexperiencia nuestra |
| **Cal.com (OSS)** | Bug **#16017**: reunión a horas distintas según la zona del dueño y del invitado. Bug **#28834**: si falla el `PATCH` a Google **no reintenta**, *"el cambio se pierde para siempre pero la reserva figura exitosa"* | (a) Guardar **UTC + zona**; (b) el sync necesita **reintentos + estado visible + reconciliación** |
| **HubSpot (CRM líder)** | Agendar en el CRM **crea el evento en el calendario y lo registra en el contacto**. Sincroniza ediciones y borrados **desde** el calendario. **No** resuelve: varios calendarios, series (sólo el primer evento), y *"borrar en HubSpot no borra el evento de Google"* | Calibración de qué es "primer nivel" y qué no lo tiene ni el líder |
| **HubSpot + Calendar.com** | Al cancelar: la actividad se marca **[Canceled]** y **no desaparece**: queda el historial | **Cancelar ≠ borrar** (punto 8) |
| **calsync-oss** | Tabla central: **`event_sync_index`** (mapea id origen ↔ id destino). Declaran como *no-objetivo*: "no two-way sync" y "no conflict resolution: el destino siempre se pisa desde el origen" | El mapeo de ids es el corazón de un sync; y **dos vías es la parte que nadie escribe** |

---

## 6. Spike sobre la integración nativa de Frappe (veredicto)

**Qué existe en el servidor** (v15, verificado en la fuente instalada):
`frappe/integrations/doctype/google_calendar/google_calendar.py` (905 líneas) + el DocType `Event`
(módulo Desk) + el DocType `Google Calendar` (módulo Integrations).

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿Varios calendarios o uno? | **Varios**: el sync recorre **todos** los registros habilitados (`filters={enable:1, pull_from_google_calendar:1}`) y **crea el calendario en Google** si no existe (`account.db_set("google_calendar_id", created_calendar["id"])`). Y el push usa el calendario **del propio evento** (`calendarId=doc.google_calendar_id`) | ⇒ **una categoría = un registro de calendario** ✓ |
| ¿Push y pull? | **Los dos.** Push por `doc_events` del `Event`: `after_insert` / `on_update` / `on_trash` → Google. Pull **incremental** con `next_sync_token`, en `scheduler_events["all"]`. Recurrencia mapeada en ambas direcciones (`repeat_on` ↔ `RRULE`). Participantes, Google Meet, todo-el-día | `frappe/hooks.py:199-203` y `:245` |
| ¿Desde app propia? | **Sí**: el motor son funciones + hooks. Del Desk sólo el **setup de OAuth** (una vez) | — |

**Punto fuerte que no esperaba:** el manejo de **zona horaria es correcto** ✓
```python
# al traer: convierte a la zona del sitio y guarda naive    google_calendar.py:618
parser.parse(dt["dateTime"]).astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
# al empujar: manda la fecha CON su zona                    google_calendar.py:692
{"dateTime": starts_on.isoformat(), "timeZone": get_system_timezone()}
```
Cero `start[:19]` (el bug que sí tiene nuestro cron). **Adoptarlo arregla la clase de bug del punto 3.**

**Los dos bordes duros (trabajo nuestro, no del framework):**

1. **El push bloquea el guardado.** `insert_event_in_google_calendar` / `update_event_in_google_calendar`
   hacen `frappe.throw` **dentro del `save()`** → **si Google falla, no se puede guardar la reunión en
   el CRM**.
2. **El borrado falla en silencio.** `delete_event_from_google_calendar` atrapa el `HttpError` con un
   `msgprint` y sigue → **el CRM la borra y Google la conserva**.
3. **Ninguno tiene** reintentos, cola, ni estado "no se pudo sincronizar" visible.

**El `Event` corrompido no es un riesgo.** La historia (commit `d86586c`): `crm_core` definía **un
DocType propio llamado `Event`** que sobrescribió el de Frappe. Ya se removió y el runbook lo advierte
(`docs/runbook-crm-core.md:53-55`). **El peligro vino de nuestro error, y está desarmado.**

---

## 7. Excepciones de recurrencia: la respuesta a "¿cómo lo resuelven otros?"

### El estándar
`RECURRENCE-ID` identifica una instancia dentro de la serie (con el `DTSTART` **original** de esa
instancia), y `RANGE=THISANDFUTURE` expresa "esta y las siguientes". Una excepción se representa
**reemplazando** la instancia por un componente completo con ese `RECURRENCE-ID`. Exclusiones = `EXDATE`.
(Aviso del propio IETF: *"Si una recurrencia larga está muy sobrescrita, se vuelve muy engorrosa"*.)

### Google ya trae la información — **Frappe la tira a la basura**
- El sync **incremental** de Google **devuelve las excepciones** (las instancias movidas o canceladas),
  con `recurringEventId` + `originalStartTime` + `status` ✓ (documentado: *"events.list devuelve
  eventos sueltos, recurrentes **y excepciones**"*).
- En el código de Frappe, la rama que debería procesarlas es:

```python
339:   if event.get("recurringEventId"):
340:       ...        ← el Ellipsis de Python: NO HACE NADA
```

**No es una limitación de la API: es un hueco del framework.** El dato llega y se descarta.

### Por qué no alcanza con "arreglar esa línea"
El problema de fondo es el **modelo**: el `Event` de Frappe es **una fila por serie** (con `repeat_on`),
y **no tiene dónde guardar** "esta instancia se movió" o "esta se canceló" ✗.

### Lo que sí se puede hacer (y es acotado)
1. **Un reconciliador propio** (job nuestro, aditivo): leer las instancias/excepciones de las series
   con `events.instances()` / el sync incremental, y guardarlas en un **DocType propio de excepciones**
   (custom) linkeado al `Event` — sin forkear Frappe ✓
2. **La UI** las muestra: "esta semana se movió a…", "esta se canceló", "esta y las siguientes cambian".
3. **Editar** con alcance: "esta" → una excepción; "esta y las siguientes" → **dos requests** (recortar
   la serie original + crear una nueva), que es exactamente lo que documenta Google.

**Calibración honesta:** HubSpot sincroniza **sólo el primer evento** de una serie; el IETF dice que el
estándar es ambiguo incluso para expertos. Resolver excepciones **es un diferenciador, no un piso**.

### Qué falta verificar antes de prometerlo
- Si `python-dateutil` está disponible en el entorno (para expandir `RRULE` localmente).
- Cómo se comporta `events.instances()` con series largas (ventana de tiempo, paginado).

---

## 8. Decisiones abiertas

1. **Excepciones de recurrencia**: ¿las resolvemos con la capa del §7.3, o las declaramos como límite
   explícito en la UI de la Fase 1 y las dejamos para después?
2. **La capa de confiabilidad** (ver §9): **obligatoria** — pendiente de confirmación del usuario.
3. **Los datos de OAuth**: reutilizar el proyecto de Google que ya usa el cron (hay que agregar la URI
   de callback de Frappe: `https://{sitio}?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`).

## 9. La capa de confiabilidad (explicada en simple)

**No es una capa de red ni de infraestructura: es hacer que el CRM funcione aunque Google falle.**

Hoy, con la integración nativa, guardar una reunión **depende** de que Google responda en ese instante:
la llamada a Google ocurre **dentro del mismo `save()`** y, si falla, **tira un error y no se guarda**.
Y al revés: al borrar, si Google falla, **no avisa** y las dos agendas quedan distintas para siempre.

**Qué hace la capa:**
1. **Guardar siempre primero, sincronizar después.** La reunión se guarda en el CRM aunque Google esté
   caído (nadie debería perder una reunión porque falló una API).
2. **Cola con reintentos.** Si Google falla, queda pendiente y se reintenta (con espera creciente).
3. **Un estado visible.** Cada reunión muestra "sincronizada ✓ / pendiente / falló", así el usuario
   **sabe** que algo no llegó en vez de descubrirlo cuando el cliente no aparece.
4. **Reconciliación.** Un job periódico compara las dos agendas y arregla las diferencias (por ejemplo,
   "el CRM cree que se borró y Google la tiene").

**Por qué "no es gratis" el punto 1:** porque la integración nativa **no** lo hace así — está escrita
para fallar ruidosamente al guardar y en silencio al borrar. Adoptarla tal cual significa heredar esos
dos comportamientos. La capa es lo que los corrige, y es **poco código** comparado con escribir el motor
de sync entero — pero **hay que escribirlo**.

## 10. Rutas para volver rápido

| Qué | Dónde |
|---|---|
| El bug del -1h (render) | `apps/web/src/Agenda.tsx:177` (etiquetas) vs `:195` (slots) · `apps/web/src/styles.css:573` (`.ag-gutter`) y `:593` (`.ag-dayhead`) |
| "Una reunión es un lead" | `apps/crm_core/crm_core/api.py:757` (`create_event`) |
| El cron de una vía | `scripts/sync/sync-gcal-crm.py` (77 líneas) |
| La página de reservas de Google | `~/PROYECTOS/webmarcosbarbosagroup/config/theme.ts:20,23` |
| Integración nativa de Frappe | `apps/frappe/frappe/integrations/doctype/google_calendar/google_calendar.py` (pull `:274`, push `:442`/`:504`, borrado `:588`, zona horaria `:618`/`:692`) |
| Hooks que la enchufan | `apps/frappe/frappe/hooks.py:199-203` (doc_events de Event) y `:245` (scheduler) |
| Por qué no crear un DocType `Event` | `docs/runbook-crm-core.md:53-55` |
| La restauración del Event | `scripts/restore_frappe_event.py` |
