# Spec — Sincronización con Google Calendar (ida y vuelta)

**Fecha:** 2026-09-19 · **Estado:** propuesto · **Urgente**

**Motivo:** hoy **ninguna de las dos direcciones funciona**. Agendar en el CRM no llega a Google (el código lo neutraliza a propósito), y las reservas de la web no llegan al CRM (el sync mira el calendario equivocado).

**Investigaciones que la fundamentan:**
- `docs/research-2026-09-19-google-calendar-sync.md` — el sync nativo de Frappe, defecto por defecto, con líneas
- `docs/superpowers/research/2026-09-19-two-way-google-calendar-sync.md` — cómo lo hacen las empresas serias (mecánica de la API, conflictos, echo loop)
- `docs/superpowers/research/2026-09-19-google-calendar-2way-sync-open-source.md` — qué hay en código abierto y con qué licencia

---

## 1. Lo que está roto hoy, con evidencia

| # | Hecho | Consecuencia |
|---|---|---|
| 1 | **El push nativo lanza dentro del `save()`** (`google_calendar.py:496-501`, `:580-585`): un `HttpError` aborta el guardado del CRM | Por eso **lo neutralizamos** — pero eso deja el CRM→Google en cero |
| 2 | **El delete nativo falla en silencio** (`:610-615`: solo `msgprint`, sin log ni retry) | Un borrado puede no llegar nunca a Google |
| 3 | **El delete no mira `sync_with_google_calendar`** (`:593`) | Es el único de los tres que no se puede apagar con el flag |
| 4 | **El sync lee `account.google_calendar_id`**, que por defecto es un calendario que **Frappe creó** — no el principal donde caen las reservas | **Web→CRM no trae nada** |
| 5 | El token existente es **`calendar.readonly`** | **Insuficiente para escribir** |
| 6 | **Hay dos sincronizadores** (el nativo y `scripts/sync/sync-gcal-crm.py`) | Van a divergir |
| 7 | **Borrar en el CRM no cancela en Google** (nuestra neutralización) | El próximo **pull completo re-inserta** el evento borrado: resurrección |

**El riesgo que introdujimos nosotros (7) es el más serio**: hay que cancelarlo en Google antes de borrar, no después.

## 2. El contrato de v1 (la decisión central)

**Autoridad por evento, nunca merge silencioso.** Es lo que hacen Nylas, CalendarBridge y vdirsyncer, y lo que evita destruir una reunión:

- **Google manda** en: reservas del Appointment Schedule, horario, título y asistentes.
- **El CRM manda** en: reuniones creadas en el CRM, el link al lead y las notas.
- **Local cambió solo** → push con `If-Match: etag`; si da `412`, se re-lee **y se re-evalúa** (no se reintenta a ciegas).
- **Remoto cambió solo** → pull.
- **Los dos cambiaron** → **gana Google** en horario/título/asistentes, el CRM conserva lead y notas, y se marca `conflict`. **Nunca se pisa en silencio lo que el otro lado cambió.**
- **Borrados conservadores**: un cancel remoto borra el local **solo si el local está limpio**; un borrado local se propaga **solo si nació en el CRM y el remoto no cambió**.

## 3. Cómo se implementa (envolver, no prender)

**No se usa el push nativo.** Se lo reemplaza:

1. **Nuestro push**: el `Event` se guarda **neutralizado y atómico** (como hoy), y después se encola `frappe.enqueue(..., enqueue_after_commit=True)` un job que llama a la API de Google dentro de `try/except Exception`. En fallo: `Error Log` **y** un campo de estado visible, con reintentos.
   - **Pasa `account.google_calendar_id`, NO `doc.google_calendar_id`** — es el bug del id vacío en el primer push.
   - Idempotente por `google_calendar_event_id`; si no existe, se inserta **con un `id` propio** (base32hex, derivado estable del nombre del `Event`) para que un reintento no duplique.
2. **Nuestro delete**: job asíncrono que **cancela en Google ANTES de borrar** (mata la resurrección), nunca desde `on_trash`.
3. **Un solo puller.** Se apaga el que sobre: queda el nativo (que ya maneja `syncToken` y el `410`) **apuntado al calendario correcto**, o nuestro script — pero **uno**. Se decide en la implementación y se documenta.
4. **Reconciliación periódica** barata por `google_calendar_event_id`: atrapa resurrecciones y duplicados que ninguna de las dos vías ve.
5. **El pull**: `syncToken` incremental (páginas hasta la última, donde viene el `nextSyncToken`; `410` → resync completo). **No se usan webhooks**: para un usuario, el push de Google solo dispara el mismo pull, y agrega TLS + renovación + pérdidas ("un pequeño porcentaje se descarta"). Polling, con una corrida extra **al abrir la agenda** y un botón manual.

## 4. El modelo de datos que falta

`Event` ya tiene `google_calendar`, `google_calendar_id`, `google_calendar_event_id`, `pulled_from_google_calendar`, `sync_with_google_calendar`. **Falta lo que hace falta para no perder reuniones:**

| Campo | Para qué |
|---|---|
| `custom_gcal_etag` | `If-Match` en cada escritura — **la ausencia más grave**: sin etag no hay detección de conflicto |
| `custom_gcal_updated` | Saber si el remoto cambió después de nuestro último sync |
| `custom_gcal_calendar_id` | El calendario remoto real (hoy se confunde con el de la cuenta) |
| `custom_sync_origin` | Quién cambió por última vez: `crm` o `google` |
| `custom_last_synced_at` + `custom_last_synced_local_modified` | Snapshot para calcular `local_dirty` sin adivinar |
| `custom_dirty` | Bandera durable (hoy `sync_with_google_calendar` está sobrecargado como guard de hook) |
| `custom_content_hash` | Guarda de eco: hash igual ⇒ es nuestra propia escritura |
| `custom_tombstone` | Marcar el borrado antes de propagarlo |
| `custom_sync_estado` / `custom_sync_error` / `custom_sync_intentos` | Que un fallo sea **visible** en vez de silencioso |

## 5. Prerrequisitos que dependen del usuario (bloquean la prueba end-to-end)

1. **Credenciales OAuth de Google Cloud**: client ID y secret, con el scope **`https://www.googleapis.com/auth/calendar`** (no `readonly`), consentimiento en **producción** (en modo Testing el refresh token expira a los 7 días), y el redirect URI exacto:
   `https://crm.marcosbarbosagroup.com?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`
   Van en **Google Settings** del sitio.
2. **Qué calendario es el destino**: el de las reservas del Appointment Schedule (normalmente el **principal**). El `Google Calendar` de la cuenta hay que apuntarlo ahí — si no, no se trae nada.

## 6. Fuera de v1, con su consecuencia

- **Recurrencia y excepciones por instancia** (solo series completas). Consecuencia: una reunión recurrente editada solo en una instancia no se refleja.
- **Editar en el CRM una reserva de la web** (es de solo lectura, D5). Consecuencia: para cambiarla, se hace en Google.
- **Asistentes/RSVP**: los maneja Google, no se round-tripean.
- **Multi-calendario y multi-cuenta**: uno solo.
- **Merge por campo**: regla fija + marca de conflicto. Un merge fino queda para v2 si aparecen conflictos reales.

## 7. Fases

| Fase | Entrega | Verificación |
|---|---|---|
| **S1 · Campos y modelo** | El Custom Field set de §4, idempotente | Los campos existen en `crm-test` y en producción con un migrate |
| **S2 · Nuestro push** | El job asíncrono con `If-Match`, idempotente, con estado y reintentos; el delete cancela **antes** | Tests en `crm-test`; y con la cuenta conectada, una reunión creada en el CRM **aparece en Google** |
| **S3 · El pull, un solo puller** | El puller único apuntado al calendario correcto, con `syncToken` y `410` | Una reserva de la web **aparece en el CRM** |
| **S4 · Conflictos y reconciliación** | El contrato de §2 y la reconciliación periódica | Un evento editado en los dos lados **no se pierde**: queda marcado `conflict` |
| **S5 · Prueba end-to-end en pantalla** | Reservar en la web → ver en el CRM; crear en el CRM → ver en Google | Con las credenciales del usuario, y **sin tocar la base de producción a mano** |

**S1 y S2 son lo urgente** (que lo que agendás en el CRM llegue a Google). S3 depende de las credenciales.
