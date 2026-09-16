# Agenda y calendario — diseño (borrador para auditoría)

> **Estado:** borrador. **Secciones 1 y 2 escritas; 3 y 4 pendientes.** Este documento se somete a
> auditoría adversarial antes de convertirse en spec.
> **Contexto e investigación:** `2026-09-16-agenda-hallazgos.md` (mismo directorio).
> **Decisiones del usuario:** dos vías · el CRM crea sus calendarios por categoría · reunión con
> cliente opcional · recurrencia completa · UI de primer nivel · excepciones **desde el arranque** ·
> capa de confiabilidad **obligatoria** · migrar todo · reglas de categorización ✔ · Custom Fields ✔.

---

## Sección 1 — Modelo y categorías

### 1.1 Entidades

| Entidad | Dueño | Rol |
|---|---|---|
| `Event` (Frappe, módulo Desk) | framework | **La reunión.** `subject`, `starts_on`/`ends_on`, `all_day`, `event_category`, `color`, `status` (Open/Completed/Closed/Cancelled), `repeat_on` (Daily/Weekly/Monthly/Yearly) + 7 días + `repeat_till`, `event_participants` (invitados + RSVP), `sync_with_google_calendar`, `pulled_from_google_calendar`, `google_calendar` (Link `Google Calendar`), **`google_calendar_id` (Data: el id crudo)**, `google_calendar_event_id` (el mapeo con Google), `google_meet_link`, `links` (tabla dinámica nativa) |
| `CRM Agenda` (nueva) | nosotros | **La categoría con color**: `nombre`, `color`, `google_calendar` (Link), `duracion_default`, `activo`, `orden` |
| `CRM Agenda Regla` (nueva) | nosotros | **Origen → categoría**: `agenda` (Link), `campo` (Título / Descripción / Email del invitado / Calendario), `patron`, `prioridad`, `activo` |
| `CRM Reunión Excepción` (nueva, **hija de `Event`**) | nosotros | `instancia_original` (Datetime), `tipo` (Movida/Cancelada/Modificada), `nuevo_inicio`, `nuevo_fin`, `nota` |
| `CRM Custom Fields` sobre `Event` | nosotros | `custom_crm_deal`, `custom_crm_organization`, `custom_crm_lead` (Links al CRM), `custom_sync_estado` (No aplica/Pendiente/Sincronizada/Falló), `custom_sync_error`, `custom_sync_intentos`, `custom_origen` (CRM/Google/Reservas) |

### 1.2 Invariantes del modelo (lo que nuestro layer DEBE garantizar)

1. **`google_calendar_id` (el id crudo) es obligatorio para que el push funcione.** Se copia desde el
   `Google Calendar` de la categoría (`CRM Agenda.google_calendar` → `Google Calendar.google_calendar_id`).
   **Sin él, la llamada a Google va con `calendarId` vacío y falla.** *(Grieta encontrada en la auditoría.)*
2. Un `Event` con `pulled_from_google_calendar = 1` **no se empuja** (guard del framework).
3. Un `Event` con `sync_with_google_calendar = 0` **no se empuja** (guard del framework).
4. La **categoría define el calendario**; cambiar la categoría de una **serie** mueve todas las
   instancias (es un solo evento en Google).
5. Las **personas** van en `event_participants`; el **negocio/empresa** en los Custom Fields.
6. `instancia_original` de una excepción es **la fecha original** de la instancia (`RECURRENCE-ID` /
   `originalStartTime`), nunca la nueva.

### 1.3 Categorización automática (reglas, no calendarios)

Se evalúan **en orden de prioridad**; si ninguna matchea → **"Sin asignar"**. Se aplica **al importar**
y **al cambiar** un evento. Hoy funciona con **una** página de reservas; cuando el plan de Google
permita varias, se agrega `campo: Calendario` como una fila más (sin rediseño).
**Motivo verificado:** la cuenta es Gmail personal y el plan gratuito permite **una** página de
reservas y probablemente no admite agendas en calendarios secundarios.

### 1.4 Migración (10 reuniones; 0 eventos en Frappe hoy)

| Grupo | Cuántas | Acción | Riesgo |
|---|---|---|---|
| Vinieron de Google (`custom_event_id` + email) | 3 | `Event` con `google_calendar_event_id` = ese id + `pulled_from_google_calendar = 1` | **Ninguno; evita duplicados** (el pull busca por ese id y actualiza) |
| Las creó el CRM (sin email ni evento) | 7 | `Event` con `custom_origen = CRM` y **`sync_with_google_calendar = 0`** | **No se empujan** (decisión del usuario: se recrean cuando quiera) |

El `CRM Lead` **se queda** (es el contacto) y el `Event` se vincula. `custom_meeting_datetime` se
congela (mismo criterio que `CRM Deal.products` en F2). **El cron `sync-gcal-crm.py` se apaga** (si no,
duplicados).

---

## Sección 2 — Sync, conflictos y confiabilidad

### 2.1 Quién manda

| Origen | Manda | Mecanismo |
|---|---|---|
| `custom_origen = CRM` | **El CRM** | Su edición se empuja; si además lo editan en Google, el pull lo actualiza |
| `pulled_from_google_calendar = 1` | **Google** | El push está **bloqueado** por el guard del framework |
| Al **editarlo en el CRM** un evento importado | Pasa a **mixto** | Nuestro layer **limpia `pulled_from_google_calendar`** (explícito, una vez) y queda registrado |

**Verdad incómoda (no se promete más):** el motor nativo es *"el último que escribe, gana"* por
dirección. Nuestra capa **detecta y avisa**, no fusiona campos. Ni HubSpot ni Cal.com hacen merge.

### 2.2 La capa de confiabilidad (5 piezas)

**Pieza 1 — Guardar primero, sincronizar después (mecanismo corregido en la auditoría).**

```
Nuestra API guarda el Event con sync_with_google_calendar = 0  → el guard del framework NO empuja
                 ↓
Encola un job (Redis + el crm_worker que ya corre)
                 ↓
El job NO "prende el flag y guarda" (eso dispararía el camino UPDATE con event id vacío → loop ✗).
El job llama EXPLÍCITAMENTE la función que corresponde:
     sin google_calendar_event_id  → frappe...insert_event_in_google_calendar(doc)
     con google_calendar_event_id  → frappe...update_event_in_google_calendar(doc)
     borrado                       → frappe...delete_event_from_google_calendar(doc)
   con doc.sync_with_google_calendar = 1 y doc.pulled_from_google_calendar = 0 EN MEMORIA
   (sus guards internos lo exigen; no se persiste el cambio de flags en este paso)
                 ↓
  éxito → persiste google_calendar_event_id (lo hace la propia función) + sync_estado = Sincronizada
  fallo → sync_estado = Falló + sync_error; reintento con espera creciente; **nunca en tu request**
```

**Pieza 2 — Cola con reintentos.** Un barrido periódico levanta los `Pendiente`, reintenta con espera
creciente y marca `Falló` tras N intentos.

**Pieza 3 — Estado visible.** `sync_estado` / `sync_error` / `sync_intentos` + badge en la UI + lista de
"no se pudieron sincronizar".

**Pieza 4 — Reconciliación.** Job diario que compara por `google_calendar_event_id` + `updated`,
repara lo evidente (evento de un solo lado) y reporta lo dudoso.

**Pieza 5 — RRULE completo.** Completamos lo que el framework **no emite**: `UNTIL` (desde
`repeat_till`), `INTERVAL` y `COUNT`. Verificado: `repeat_on_to_google_calendar_recurrence_rule` sólo
arma `RRULE:FREQ=…;BYDAY=…` → hoy *"cada 2 semanas hasta diciembre"* llegaría a Google como **todas las
semanas para siempre**.

### 2.3 Excepciones de recurrencia (desde el arranque)

1. **"Sólo esta"** → fila en `CRM Reunión Excepción` (con la **fecha original**) + **PUT a la instancia**
   en Google.
2. **"Esta y las siguientes"** → **dos requests** (recortar la serie + crear la nueva), como documenta Google.
3. **"Todas"** → se edita el `Event` padre (el RRULE) y Google propaga.
4. **Reconciliador de excepciones** → lee las instancias de la serie en una **ventana acotada**
   (`events.instances()` con `timeMin`/`timeMax`) y completa el child table con lo que Google generó
   (el dato que el framework descarta en la línea 340 con un `...`).

### 2.4 Lo que se apaga

- **El cron `sync-gcal-crm.py`** (única puerta de entrada pasa a ser el pull nativo con `next_sync_token`).
- Los avisos por email del `Event` (`send_reminder`/`notifications`): **no hay SMTP** en el servidor.

---

## Sección 3 — UI (bosquejo, pendiente de aprobación)

Slots de 15 min · arrastrar/estirar/crear con mouse · mes + mini-mes · buscar y filtrar por categoría,
origen y estado de sync · color por categoría · disponibilidad real y **aviso de superposición** ·
drawer de la reunión (título, categoría, duración, invitados, negocio/empresa, recurrencia con alcance,
historial y estado de sync) · **se arregla el desfase de 40px del grid** (punto 3).

## Sección 4 — Fases (pendiente)

---

## Riesgos abiertos para la auditoría

1. ¿La llamada explícita a las funciones de Frappe desde el job es segura (contexto, transacción, permisos)?
2. ¿`events.instances()` con series infinitas: qué ventana y qué paginado?
3. ¿El pull incremental respeta `pulled_from_google_calendar` para no crear duplicados entre corridas?
4. ¿Qué pasa si dos categorías apuntan al mismo calendario de Google (o ninguna)?
5. ¿Los Custom Fields sobre `Event` sobreviven a una actualización del framework?
6. ¿`sync_with_google_calendar=0` en la migración alcanza, o el pull va a insertar duplicados de los 3 de Google?
7. ¿La regla "limpiar el flag al editar un importado" puede provocar un eco (push → pull → push)?
