# Spec — CRM Marcos Barbosa · Próximos pasos (Nivel 2)

**Fecha:** 2026-09-15
**Estado:** Propuesta para revisión (no empezar sin aprobación)
**Contexto:** sobre lo que ya está en producción (`/hoy`, imagen `crm-mb:42`)

---

## 1. Qué existe hoy (punto de partida)

App React propia servida por Frappe en `crm.marcosbarbosagroup.com/hoy`, con 3 vistas:

| Vista | Hace | Datos que lee |
|---|---|---|
| **Agenda** | Semana/día, eventos en el tiempo, crear inline, drawer | `CRM Lead.custom_meeting_datetime` |
| **Hoy** | Tareas vencidas + de hoy, alta rápida, completar | `CRM Task` |
| **Contactos** | Lista + búsqueda + drawer (detalle, tareas, comentarios) | `CRM Lead` |

**Arquitectura real (importante, para no reinterpretar nada):**

```
Google Calendar ──(cron cada 1 min, HOST)──▶ sync-gcal-crm.py ──▶ CRM Lead (+custom_meeting_datetime)
Sitio web ────────(POST)──────────────────▶ /api/resource/CRM Lead
                                                    │
                       App React (in-process) ◀─────┘  (get_leads / get_agenda / get_meeting / add_note …)
```

- El CRM real vive en el **app `crm`** (DocTypes `CRM Lead`, `CRM Task`), no en `crm_core`.
- `crm_core` aporta la **API + la UI React** (la app React va embebida en `www/hoy.html`).
- Comentarios = `Comment` de Frappe sobre `CRM Lead` (aparecen también en el CRM viejo).

**Limitación actual:** todo es **lectura + comentar + completar**. No se puede **crear** un contacto ni una tarea ligada a un contacto desde la UI.

---

## 2. Próximos pasos (priorizados)

### Paso 1 — Crear contacto desde el CRM

**Objetivo:** dar de alta un contacto sin depender de la web ni del panel viejo.

**Alcance:**
- Botón "Nuevo contacto" en la vista Contactos.
- Form mínimo (inline o drawer): nombre, apellido, email, teléfono, empresa, origen, nota.
- Reusa el drawer para "ver" después de crear.

**UX:** un botón primario + un formulario corto. Nada de wizard.

**Técnico:**
- `crm_core.api.create_lead(first_name, last_name, email, mobile_no, organization, source, notes)`
- Crea `CRM Lead` (requiere `status` + `first_name`; default `status="New"`).
- Dedupe por email: si ya existe, avisar y abrir el existente en vez de duplicar.

**Éxito:** creo un contacto desde el celular en <15s y aparece en la lista.

---

### Paso 2 — Tareas dentro del contacto

**Objetivo:** desde el drawer de un contacto, crear la próxima tarea para ese contacto.

**Alcance:**
- En el drawer (sección Tareas): input "Nueva tarea…" + Enter.
- La tarea queda con `reference_doctype="CRM Lead"` y `reference_docname=<contacto>`.
- Toggle hecho/pendiente (ya existe `toggle_task`).

**UX:** misma mecánica que el alta rápida de Hoy (input + Enter, optimista). Consistencia.

**Técnico:**
- `crm_core.api.add_task(title, reference_name=None, due_date=None)`
- `create` de `CRM Task` con el vínculo al lead.

**Éxito:** desde una reunión/contacto, dejo la próxima acción y aparece en "Hoy".

---

### Paso 3 — Pipeline (Deals)

**Objetivo:** ver y mover oportunidades entre etapas.

**Alcance (mínimo):**
- Vista **Pipeline** en el nav: columnas por etapa (`CRM Deal Status`: Qualification → Diagnóstico → … → Won/Lost).
- Tarjetas de `CRM Deal` (hoy hay 0 — se crean solas al convertir un Lead).
- **Drag & drop** entre columnas, o menú "mover a…".

**UX:** tablero tipo kanban, denso, con totales por columna.

**Técnico:**
- `get_deals()` → agrupado por `status`.
- `move_deal(name, status)` → `frappe.db.set_value("CRM Deal", name, "status", status)`.
- Deals se crean al **convertir un lead** (acción del CRM viejo; evaluar exponerla).

**Éxito:** veo el embudo de un vistazo y muevo una oportunidad de etapa.

---

### Paso 4 — Editar contacto + registrar llamada

**Objetivo:** el día a día: llamar y anotar.

**Alcance:**
- En el drawer: editar campos (email, teléfono, empresa, estado).
- Botón "Llamar" (`tel:`) y "Email" (`mailto:`) — ya están como links.
- Al colgar, caja de nota rápida (reusa comentarios).

**Técnico:** `update_lead(name, **fields)` + `add_note` (ya existe).

---

### Paso 5 — Recordatorios (notificaciones)

**Objetivo:** que la agenda avise, no que haya que mirarla.

**Alcance:** digest diario (email o in-app) con los pendientes y reuniones del día. Recordatorio N min antes de una reunión.

**Técnico:** `scheduler_events` de `crm_core` (job diario) + email SMTP de Frappe. Opcional: push PWA.

---

## 3. Prioridad y esfuerzo

| Paso | Valor | Esfuerzo | Orden sugerido |
|---|---|---|---|
| 1. Crear contacto | Alto | Bajo (½ día) | **1º** |
| 2. Tareas en el contacto | Alto | Bajo (½ día) | **2º** |
| 4. Editar + llamar | Medio | Bajo (½ día) | 3º |
| 3. Pipeline / Deals | Alto | Medio (2-3 días) | 4º |
| 5. Recordatorios | Medio | Medio (1-2 días) | 5º |

**Recomendación:** 1 y 2 juntos (dejan el ciclo completo: ver contacto → dejar próxima acción). Pipeline después.

---

## 4. Reglas de implementación (mantener el craft)

Heredadas del piso de calidad ya aplicado; no romperlas:

- **Drawer**, no modal centrado (mantener contexto).
- Íconos SVG propios (nada de glifos/emoji).
- Sin cards anidadas ni `border-left` de 2px.
- Superficies del navegador tematizadas (selección, scrollbar, caret, focus, tabular-nums).
- Estados completos: hover, focus, active, disabled, loading (skeleton), error, vacío **que enseña**.
- Mobile primero en lo que se pueda; verificar **desktop + mobile** antes de dar por hecho.
- Acciones reversibles **optimistas** (sin spinner).
- Escribir/leer los **DocTypes reales** (`CRM Lead`, `CRM Task`) — no crear tablas paralelas.

## 5. Fuera de alcance (explícito)

- Reescribir/borrar el CRM viejo (`/crm`) — sigue intacto.
- Facturación, inventario, email marketing, WhatsApp (eso es Fase 3+).
- App móvil nativa (la PWA/web alcanza).
- Multi-tenant / SaaS.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Duplicar contactos al crear | Dedupe por email |
| El cron de Google sigue creando leads; colisión de dedupe | Mismo criterio de dedupe que el cron (email) |
| Cambios de etapa de Deals afectan el CRM viejo | `CRM Deal Status` es el mismo dato: es intencional (un solo dato) |
| Regresiones al tocar la UI | Verificación visual desktop+mobile en cada paso; detector limpio |
