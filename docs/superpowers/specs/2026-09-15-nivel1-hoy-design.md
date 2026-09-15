# Spec — Nivel 1: Página "Hoy"

**Fecha:** 2026-09-15
**Estado:** Borrador para revisión (no empezar implementación sin aprobación)
**Alcance:** una página visible y usable en `crm.marcosbarbosagroup.com/hoy`
**Contexto:** existe `crm_core` instalado en prod (13 DocTypes). Falta la capa visible.

---

## 1. Objetivo

Que el equipo pueda ver **de un vistazo** lo que tiene hoy (tareas pendientes +
eventos del día) y cargar una tarea nueva en segundos, en una sola pantalla
liviana, sin pasar por el panel de administración de Frappe.

## 2. Criterios de éxito (medibles)

1. Abrís `crm.marcosbarbosagroup.com/hoy` y en menos de 1 segundo ves: tareas
   vencidas, tareas de hoy y eventos del día.
2. Creás una tarea escribiendo el texto y apretando Enter. Sin formulario.
3. Marcás una tarea como hecha con un clic.
4. El equipo lo usa 5 días seguidos para ver el día, sin abrir el panel de
   administración ni Google Calendar para tareas.

## 3. Alcance

**Incluye**
- Página `/hoy` (una sola pantalla, server-rendered, rápida).
- Tareas vencidas (rojo), tareas de hoy, eventos de hoy.
- Alta rápida de tarea (input + Enter).
- Marcar tarea como hecha (checkbox).
- Contador de pendientes.
- Estados vacíos claros.
- Funciona en celular (responsive básico).

**NO incluye (queda para Nivel 2+)**
- Sync con Google Calendar.
- Editar tarea/evento (más allá de completar).
- Vista de semana o mes.
- Drag & drop, offline, notificaciones.
- App móvil.
- Rediseño del CRM `/crm` existente.

## 4. UX (qué se ve y cómo se usa)

```
┌─────────────────────────────────────────────┐
│  Hoy · lunes 15 de septiembre     5 pendientes│
│                                              │
│  [ Nueva tarea…                        ⏎ ]   │
│                                              │
│  VENCIDAS (2)                                │
│   ☐  Llamar a Acme            ayer 14:00  ●  │
│   ☐  Enviar propuesta         vie 10:00   ●  │
│                                              │
│  HOY (3)                                     │
│   ☐  Reunión equipo           hoy  09:00     │
│   ☐  Responder mails          hoy  11:30     │
│   ☐  Cerrar contrato          hoy  16:00     │
│                                              │
│  EVENTOS (2)                                 │
│   10:00  Reunión con cliente · Meet          │
│   15:00  Demo producto                        │
└─────────────────────────────────────────────┘
```

- El input de nueva tarea **tiene el foco al cargar** (escribís y Enter).
- El checkbox completa la tarea (optimista: se tacha al toque, sin recargar).
- Vencidas en rojo, arriba. Hoy después. Eventos al final.
- Si no hay nada: "No tenés pendientes para hoy 🎉" / "Sin eventos".
- Atajo: `n` enfoca el input de nueva tarea.

## 5. Diseño técnico

### 5.1 Tipo de página
Página **Frappe `www`** (Jinja + controlador Python), server-rendered.
Motivo: cero build, cero framework, rápida, y ya integrada a la sesión de
Frappe. Es el mismo mecanismo que usa el `/crm` existente.

### 5.2 Archivos
```
apps/crm_core/crm_core/
  www/
    hoy.html          # template (layout + CSS propio)
    hoy.py            # controlador: get_context(), has_permission()
  api.py              # métodos whitelisted (get_hoy, quick_add_task, complete_task)
```

### 5.3 Ruta
`/hoy` (Frappe sirve `www/hoy.html` en esa ruta, igual que `crm/www/crm.html` → `/crm`).

### 5.4 Acceso
- Requiere sesión: si no hay usuario logueado, redirige a `/login`.
- Todos los métodos `@frappe.whitelist()` (login obligatorio).

### 5.5 Datos

Zona horaria del sitio: **America/Argentina/Cordoba** (verificado).
"Hoy" = el día actual en esa zona. Rango `[hoy 00:00, mañana 00:00)`.

**Tareas** — DocType `Task` (limpio, sin colisión con Frappe core):
- Vencidas: `status = 'Open'` y `due_datetime < hoy 00:00`.
- De hoy: `status = 'Open'` y `due_datetime` dentro de hoy.
- Sin fecha: cuentan como pendientes pero NO se listan en el día (o sección
  aparte, opcional).

**Eventos** — DocType `Event` (el de Frappe, campos `subject`, `starts_on`, `ends_on`):
- De hoy: `starts_on` dentro de hoy y `status != 'Cancelled'`.

> **Nota técnica:** el DocType custom `Event` de crm_core chocó con el `Event`
> interno de Frappe y se fusionaron los campos. Para el Nivel 1 se usan los
> campos del Event de Frappe (`subject`, `starts_on`, `ends_on`). La limpieza
> del nombre (renombrar el custom a `MB Event` o sacarlo) queda para Nivel 2.

### 5.6 Métodos de API (`crm_core.api`)

| Método | Entrada | Salida | Notas |
|---|---|---|---|
| `get_hoy` | — | `{today, overdue[], tasks_today[], events_today[], count}` | Solo lectura |
| `quick_add_task` | `subject` | `{name, subject}` | Crea `Task`, owner = usuario actual |
| `complete_task` | `name` | `{ok}` | Setea `status='Done'`, valida permisos |

### 5.7 Frontend (JS mínimo, ~60 líneas)
- Enviar nueva tarea: `fetch('/api/method/crm_core.api.quick_add_task', {method:'POST', ...})`
- Completar: `fetch('/api/method/crm_core.api.complete_task', ...)`
- Actualización optimista: tachar la tarea al instante, revertir si falla.
- Sin spinner en acciones reversibles (regla de UX premium del spec grande).

### 5.8 Estilos
CSS propio embebido en el template. Dark, tipografía del sistema, sin
dependencias externas. Debe cargar rápido y verse bien en celular.

## 6. Seguridad

- Todos los métodos requieren login (`@frappe.whitelist()`).
- `quick_add_task`: `owner = frappe.session.user`, sin permitir inyectar owner.
- `complete_task`: validar que la tarea es del usuario o tiene permiso de
  escritura (`frappe.has_permission("Task", "write", doc=name)`).
- **Vista de equipo:** la página lista TODAS las tareas abiertas (el equipo es
  de 1-3 personas). El filtro por usuario queda para Nivel 2 si hace falta.
- La página NO expone datos de otros sitios ni endpoints sin auth.

## 7. Deploy

- **Iterar (rápido):** `docker cp` de los archivos al contenedor backend +
  `bench clear-cache`. Los cambios en `www/` y `api.py` se leen al vuelo.
- **Producción:** rebuild de imagen (`crm-mb:20`) + rolling update de los 6
  servicios. Mismo procedimiento ya probado.

## 8. Testing

- **Unit (pytest):** `get_hoy()` con datos fijos (una tarea vencida, una de hoy,
  un evento de hoy, una hecha que NO debe aparecer). Verifica partición correcta.
- **Unit:** `quick_add_task()` crea con owner correcto; `complete_task()` cambia
  status.
- **E2E manual:** abrir `/hoy` logueado → crear tarea → completarla → recargar y
  ver el estado persistido.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| `/hoy` choca con una ruta existente | Verificar antes de crear (Task 1 del plan) |
| Zona horaria mal → tareas en el día equivocado | Usar tz del sitio explícita; test con fecha fija |
| El `Event` fusionado con Frappe da datos raros | Nivel 1 usa solo `subject`/`starts_on`/`ends_on`; limpiar en Nivel 2 |
| `www/` requiere rebuild para prod | Iterar con `docker cp`; rebuild solo al final |
| Vista de equipo muestra tareas de todos | Decisión intencional (equipo chico); filtro por usuario en Nivel 2 |

## 10. Fuera de alcance explícito (para que no se estire)

Nada de Google Calendar, nada de React, nada de multi-tenant, nada de
app móvil, nada de tocar la app `/crm` existente. Si algo de esto aparece,
es Nivel 2 y va a otro spec.
