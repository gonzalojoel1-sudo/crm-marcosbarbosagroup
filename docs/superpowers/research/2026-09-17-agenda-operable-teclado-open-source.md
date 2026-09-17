# Agenda/Lista operable por teclado en proyectos open source — informe de código

**Fecha:** 2026-09-17
**Encargo:** encontrar proyectos open source que ya implementan una vista Lista/Agenda de calendario **operable** (crear/editar/mover/redimensionar/duplicar/borrar), sobre todo **por teclado**, para estudiar su enfoque real (código, no intuición). No se escribe código.
**Relacionado:** `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md` (S3 "Menú de la reunión", S4 nudge, S6 Lista operable) y `docs/superpowers/research/2026-09-16-calendario-ux-competidores.md`.
**Regla:** cada afirmación concreta lleva URL. Lo que no pude verificar se marca **"sin verificar"**. Si una vista Lista es de solo lectura, se dice de forma explícita.

---

## TL;DR

1. **El único proyecto open source con licencia permisiva que hoy tiene una agenda operable por teclado y un modelo ARIA documentado es MUI X Scheduler** (Community, **MIT**). Su modelo es exactamente el que propone el spec del CRM: **evento enfocado → `Space` abre un menú de acciones** (Editar / Borrar), un **toolbar con `role="toolbar"`** para las acciones armadas, y manejo explícito del **foco perdido tras borrar**. Es el match más cercano.
2. **FullCalendar** (MIT) tiene vista Lista, pero **la arrastra/redimensiona desactivadas a propósito** y **no tiene mover/redimensionar por teclado**: la propuesta existe desde 2015 y sigue **abierta** para la v9. Sus issues #2535 y #6528 son el mejor "write-up" del patrón que queremos (popover con "Move event"/"Change event duration"), pero **no hay implementación que copiar**.
3. **react-big-calendar** (MIT) tiene Agenda y su código es un **anti-ejemplo**: la fila es un `<td onClick/onDoubleClick>`, sin foco, sin roles y sin teclado.
4. **Ningún proyecto open source con licencia permisiva documenta "mover/redimensionar desde la Lista por teclado"**. Está resuelto a medias (MUI: solo editar/borrar desde la agenda; el mover se hace en el diálogo). Los que sí documentan borrar con `Delete` (Mobiscroll) son **comerciales**.
5. **Borrar + recuperar el foco** es el problema recurrente y sin solución general: MUI tuvo que escribir un fallback a mano (`getFocusFallback`), Drupal Accessible Calendar construye anuncios y foco propios para AJAX, y la APG advierte que si el elemento activo se elimina, el foco cae a `<body>`.

---

## 1. Librerías de calendario

| Proyecto | ¿Lista/Agenda? | ¿Operable desde la lista? (crear/editar/mover/redimensionar/borrar) | ¿Teclado? | Licencia | Fuente exacta |
|---|---|---|---|---|---|
| **MUI X Scheduler** | Sí (`agenda`) | **Sí**: editar (diálogo), borrar (menú + toolbar). Mover/redimensionar = con diálogo de fecha/hora (el drag es puntero, no teclado) | **Sí**: Tab entre celdas/eventos; `Space` abre el menú de acciones; `role="toolbar"`; `Escape` desarma | **MIT** (Community) / Premium comercial | [`AgendaView.tsx`](https://github.com/mui/mui-x/blob/master/packages/x-scheduler/src/agenda-view/AgendaView.tsx) · [`EventItem.tsx`](https://github.com/mui/mui-x/blob/master/packages/x-scheduler/src/internals/components/event/event-item/EventItem.tsx) · [`EventContextMenu.tsx`](https://github.com/mui/mui-x/blob/master/packages/x-scheduler/src/internals/components/event-context-menu/EventContextMenu.tsx) · [`EventContextMenuItems.tsx`](https://github.com/mui/mui-x/blob/master/packages/x-scheduler/src/internals/components/event-context-menu/EventContextMenuItems.tsx) · [`EventToolbar.tsx`](https://github.com/mui/mui-x/blob/master/packages/x-scheduler/src/internals/components/event-toolbar/EventToolbar.tsx) |
| **FullCalendar** | Sí (`listDay/Week/Month/Year`) | **No**: solo abrir (`eventClick` / `event.url`). El arrastre y el resize están **desactivados explícitamente** en la lista | Parcial: eventos tabulables con `eventInteractive` (o si tienen `url`) + Enter/Space. **Mover/redimensionar por teclado: NO** (issues abiertos) | **MIT** | [`ListEvent.tsx`](https://github.com/fullcalendar/fullcalendar/blob/main/packages/preact/src/list/components/ListEvent.tsx) (`disableDragging`/`disableResizing`) · [`ListView.tsx`](https://github.com/fullcalendar/fullcalendar/blob/main/packages/preact/src/list/components/ListView.tsx) (`role="list"`, `disableHits: true // HACK to not do date-clicking/selecting`) |
| **react-big-calendar** | Sí (`agenda`, 30 días) | **No**: solo abrir (`onSelectEvent` / `onDoubleClickEvent`) | **No**: la celda de evento es un `<td onClick onDoubleClick>` sin `tabindex`, sin roles y sin manejadores de teclado | **MIT** | [`src/Agenda.js`](https://github.com/bigcalendar/react-big-calendar/blob/master/src/Agenda.js) |
| **Schedule-X** | Sí (`List`, `Month agenda`, `Week agenda`) | Parcial: hay plugins **premium** de drag-and-drop, resize y modal. En la vista List **sin verificar** | **Sin verificar** (no hay sección de teclado en la doc de vistas) | **MIT** core / Premium comercial | [Docs Views](https://schedule-x.dev/docs/calendar/views) |
| **DHTMLX Scheduler** | Sí (`agenda`, `week_agenda`, `grid`) | Sí por puntero (drag/resize + lightbox) | `key_nav`/`key_nav_step` existen en los tipos. Alcance real en Agenda: **sin verificar** | **GPL-2.0** (Standard) o comercial | [`dhtmlxscheduler.d.ts`](https://github.com/DHTMLX/scheduler/blob/master/codebase/dhtmlxscheduler.d.ts) · [Agenda docs](https://docs.dhtmlx.com/scheduler/views/agenda) · [Precios/licencias](https://dhtmlx.com/docs/products/licenses.shtml) |
| **Kendo UI Scheduler** | Sí (`agenda`, 7 días; `timeline`, `year`…) | Sí (formulario de edición integrado) | Sí, documentado (navegar, crear, abrir). Mover/redimensionar por teclado: **sin verificar** | **Comercial** (el repo `kendo-ui-core` es Apache-2.0 **y NO incluye el código del Scheduler** — ver §7) | [views.md](https://github.com/telerik/kendo-ui-core/blob/master/docs/controls/scheduler/views.md) · [WAI-ARIA](https://www.telerik.com/kendo-react-ui/components/scheduler/accessibility/wai-aria-support) |
| **Bryntum Calendar** | Sí (`agenda`) | Sí por puntero (drag create/resize/move + event editor) | La feature list solo promete "Accessibility support – focus position is easily visible". Teclado en agenda: **sin verificar** | **Comercial** (End-User / OEM) | [Docs](https://bryntum.com/products/calendar/docs) · [AgendaView API](https://bryntum.com/products/calendar/docs/api/Calendar/widget/AgendaView) · [Licencias](https://bryntum.com/licensing) |
| **Mobiscroll Event Calendar** | Sí (agenda día/semana/mes/año) | Sí: `editable`, `dragInTime`, `resize`, `eventDelete`. Ítems de agenda "actionable" (`actionableEvents`, default `true`) | **Borrar con `Delete`/`Backspace` sobre el evento enfocado está documentado.** Resto: **sin verificar** | **Comercial** (el repo público solo libera Forms) | [Agenda](https://mobiscroll.com/docs/react/eventcalendar/agenda) · [Calendar](https://mobiscroll.com/docs/react/eventcalendar/calendar) · [Accessibility](https://mobiscroll.com/docs/react/eventcalendar/accessibility) |
| **TOAST UI Calendar** (`@toast-ui/calendar`) | **No hay vista Lista/Agenda** | N/A | N/A | **MIT** | [API: `getViewName` → month/week/day](https://github.com/nhn/tui.calendar/blob/main/docs/en/apis/calendar.md) · [Home](https://ui.toast.com/tui-calendar) |
| **V-Calendar** | **No hay vista Lista/Agenda** (date picker + layouts de mes/semana) | N/A | N/A | **MIT** | [vcalendar.io](https://vcalendar.io/) |

**Notas de verificación (fuente primaria, no intuición):**

- **FullCalendar** — el código dice literalmente que no hay drag/resize ni selección de fecha en la lista:
  `ListEvent.tsx` pasa `disableDragging` y `disableResizing`; `ListView.tsx` registra el componente con `disableHits: true, // HACK to not do date-clicking/selecting`.
  La accesibilidad documentada es: "any interactive element can be focused with the tab key" y `eventInteractive` ([docs Accessibility](https://fullcalendar.io/docs/accessibility)); la v5.10 hizo tabulables los eventos y disparables con Enter/Space ([blog v5.10](https://fullcalendar.io/blog/2021/11/accessibility-enhancements-in-v510), [issue #3364](https://github.com/fullcalendar/fullcalendar/issues/3364)).
  Mover/redimensionar por teclado sigue **abierto** con milestone **v9**: [#2535](https://github.com/fullcalendar/fullcalendar/issues/2535) y [#6528](https://github.com/fullcalendar/fullcalendar/issues/6528).
- **MUI X Scheduler** — la agenda se opera: `EventContextMenu.tsx` documenta *"The menu shown on right-click of an event, **or on pressing `Space` while it is focused**"*, y los ítems son Editar (o "Ver detalles" si es read-only) y Borrar. El contenedor usa `<ul>`/`<li>` y la fila es un botón de Base UI (`EventItem.tsx`: `<Button nativeButton={false}>`). El `EventToolbar` es `role="toolbar"` con `aria-label` y `Escape` desarma.
- **Kendo** — el repo `kendo-ui-core` es Apache-2.0, pero al inspeccionar el árbol del repo por API **no aparece ningún `.js` de scheduler** (`kendo.scheduler.agendaview.js` solo se menciona en la documentación). `LICENSE.md` acota el Apache-2.0 a "the source of this repository". Conclusión: el Scheduler es **comercial**.

---

## 2. Aplicaciones completas

| Proyecto | Vista Lista/Agenda | Modelo de interacción | ¿Teclado? | Licencia | Fuente |
|---|---|---|---|---|---|
| **Nextcloud Calendar** | Sí (usa FullCalendar: `listMonth`, `listWeek`, `listDay`) | Hereda las limitaciones de la lista de FullCalendar: abrir evento; sin mover/resize desde la lista | Reclamos abiertos de teclado | **AGPL-3.0** | [Docs embed views](https://docs.nextcloud.com/server/31/user_manual/en/groupware/calendar.html) · [issue #9994](https://github.com/nextcloud/server/issues/9994) · [Universal access](https://docs.nextcloud.com/server/stable/user_manual/en/universal_access.html) |
| **GNOME Calendar** | Sí ("scheduling list view") | Foco por eventos y celdas; navegación por flechas; activación con Space/Enter | **Sí, en construcción activa** (MRs de accesibilidad) | **GPL-3.0** | [Apps](https://apps.gnome.org/Calendar) · [MR !564](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/564) · [MR !576](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/576) · [repo mirror](https://github.com/GNOME/gnome-calendar) |
| **Evolution** | Sí (`List View`, atajo `Ctrl+L`) | Lista de citas ("appointment list"); edición por diálogo | Sí: atajos documentados; hay un parche histórico "Alt+O abre el diálogo de edición del ítem seleccionado" | **LGPL-2.1** | [Views](https://help.gnome.org/evolution/calendar-layout-views.html) · [Shortcuts (mirror)](https://evolution-1832eb.pages.gitlab.gnome.org/help/gl/intro-keyboard-shortcuts.html) · [patch 2003](https://mail.gnome.org/archives/evolution-patches/2003-September/msg00405.html) · [repo](https://github.com/GNOME/evolution) |
| **Thunderbird (Lightning)** | "Today Pane" (agenda de próximos) + unifinder (lista de eventos) | Panel de agenda; lista de eventos | Documentación general de teclado/lectores, **sin detalle por agenda** | MPL-2.0 (**sin verificar en esta sesión**) | [UI](https://support.mozilla.org/en-US/kb/lightning-user-interface) · [Accessibility](https://support.mozilla.org/en-US/kb/thunderbird-accessibility-features) · [Bug de foco de alarmas #1978903](https://bugzilla.mozilla.org/show_bug.cgi?id=1978903) |
| **Cal.com** | "Bookings" (lista de reservas), no una agenda de eventos editable | Lista de reservas/detalle; no mover/redimensionar eventos | No verificado como agenda operable | **AGPL-3.0** | [v6.2 changelog: la lista "is fine for quick checks" → agregaron vista calendario](https://cal.com/blog/calcom-v6-2) · [blog accesibilidad](https://cal.com/blog/designing-an-accessible-calendar-app-best-practices-for-inclusivity) |
| **Vikunja** | No es agenda de eventos; vistas List/Kanban/Gantt/Table con atajos | Tareas, no eventos de calendario | Atajos de teclado sí; agenda de eventos no aplica | **AGPL-3.0** | [vikunja.io](https://vikunja.io/) · [repo](https://github.com/go-vikunja/vikunja) |
| **Home Assistant (Calendar card)** | Sí (`listWeek`; nota: "shows the next 7 days, not a calendar week") | Usa FullCalendar ⇒ lista **de solo lectura** para edición de eventos | Reclamos de lector de pantalla | **Apache-2.0** (el detector de GitHub devuelve `NOASSERTION`; sin verificar el archivo LICENSE) | [Docs Calendar card](https://www.home-assistant.io/dashboards/calendar/) · [issue #25497](https://github.com/home-assistant/frontend/issues/25497) |
| **Drupal "Accessible Calendar"** | Mes y semana (**no lista**) | Plugins de Views; foco y anuncios gestionados | Sí en su alcance: pager accesible, `aria-current`, anuncios AJAX, foco al caption | **GPL-2.0-or-later** (Drupal) | [drupal.org/project/accessible_calendar](https://www.drupal.org/project/accessible_calendar) |
| **Google Calendar** (referencia propietaria) | Agenda | Agenda es la vía accesible; la grilla empuja a usuarios de lector a Agenda | Agenda "fully accessible using a screen reader" | Propietario | [U. Colorado OIT](https://oit.colorado.edu/services/messaging-collaboration/google-workspace/accessibility/calendar) · [Google Accessibility](https://support.google.com/accessibility/answer/16271522) |

---

## 3. Los 3 matches más cercanos (y qué leer exactamente)

### 1º — MUI X Scheduler, Community (MIT) ← el más cercano
**Modelo de interacción:** la agenda es una lista semántica (`<ul>`/`<li>`, cada día es una `<section aria-labelledby>` apuntando al header del día). Cada evento es un **botón** (`EventItem`) envuelto en un **trigger de menú contextual**. El menú se abre **con click derecho o con `Space`** sobre el evento enfocado, y ofrece **Editar** (abre el diálogo) y **Borrar**. Cuando hay una edición "armada", aparece un **toolbar** `role="toolbar"` con Editar/Borrar; **`Escape` desarma**. El foco tras borrar se recompone con un fallback explícito.
**Archivos a leer (en este orden):**
1. `packages/x-scheduler/src/agenda-view/AgendaView.tsx`
2. `packages/x-scheduler/src/internals/components/event/event-item/EventItem.tsx`
3. `packages/x-scheduler/src/internals/components/event-context-menu/EventContextMenu.tsx`
4. `.../event-context-menu/EventContextMenuItems.tsx` ← **contiene el patrón de foco tras borrar**
5. `.../event-toolbar/EventToolbar.tsx` ← patrón APG Toolbar
6. `packages/x-scheduler/src/internals/components/armed-occurrence/useDisarmOnEscape.ts`
**Docs:** [Accessibility (modelo ARIA + teclado)](https://mui.com/x/react-scheduler/accessibility) · [Views](https://mui.com/x/react-scheduler/event-calendar/views)

Frases textuales útiles del código (citas literales):
- Menú: *"The menu shown on right-click of an event, or on pressing `Space` while it is focused."* (`EventContextMenu.tsx`)
- Foco tras borrar (`EventContextMenuItems.tsx`): el comentario explica que borrar desmonta el `anchorEl` y MUI intentaría restaurar el foco a un nodo ya desprendido, "focus is lost to `<body>`"; por eso hace `const focusFallback = getFocusFallback(anchorEl); store.deleteEvent(...); focusFallback?.focus();`

### 2º — FullCalendar, issues #2535 + #6528 (MIT, propuesta, sin implementar)
**Por qué importa:** describen **exactamente** el patrón que propone el spec del CRM (S3): sobre un evento enfocado, `Space/Enter` abre un **popover/menú** con "Move event" y "Change event duration"; al elegir "Move", el usuario entra en un modo de roving con flechas; `Enter` confirma y `Escape` cancela. También registran el estado del arte: `aria-grabbed`/`aria-dropeffect` deprecados y sin soporte fiable.
**Archivos/links:**
- [#2535 "Event drag-n-drop / resize with keyboard" (abierto, milestone v9)](https://github.com/fullcalendar/fullcalendar/issues/2535)
- [#6528 "dateClick / select with keyboard" (abierto, v9)](https://github.com/fullcalendar/fullcalendar/issues/6528)
- Código de la lista: [`ListEvent.tsx`](https://github.com/fullcalendar/fullcalendar/blob/main/packages/preact/src/list/components/ListEvent.tsx) y [`ListView.tsx`](https://github.com/fullcalendar/fullcalendar/blob/main/packages/preact/src/list/components/ListView.tsx)

### 3º — Mobiscroll Agenda (comercial; referencia de comportamiento)
**Por qué importa:** es el único que **documenta borrar desde la agenda por teclado**: *"the focused event will be deleted on pressing the Delete or Backspace keys on the keyboard"* (`eventDelete`). La agenda tiene ítems "actionable" por defecto (`actionableEvents: true`). Sirve para **estudiar el comportamiento**, no para copiar código (licencia comercial).
**Links:** [Agenda](https://mobiscroll.com/docs/react/eventcalendar/agenda) · [Calendar (`eventDelete`)](https://mobiscroll.com/docs/react/eventcalendar/calendar) · [Accessibility](https://mobiscroll.com/docs/react/eventcalendar/accessibility)

**Menciones honoríficas:** `react-big-calendar/src/Agenda.js` como **anti-ejemplo** (fila no enfocable); **Drupal Accessible Calendar** para el paquete "anuncios + foco tras AJAX" ([link](https://www.drupal.org/project/accessible_calendar)); **GNOME Calendar** para el modelo de foco evento↔celda ([MR !564](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/564)).

---

## 4. Patrones reutilizables (con fuente)

1. **NO usar `role="listbox"` para filas con acciones.** La APG lo dice de forma explícita: el listbox *"does not provide an accessible way to present a list of interactive elements, such as links, buttons, or checkboxes. To present a list of interactive elements, see the Grid Pattern."* → [APG Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
2. **APG Grid Pattern** (para listas de widgets interactivos): [APG Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
3. **Roving tabindex vs `aria-activedescendant`.** La APG documenta los dos métodos de gestión de foco en compuestos; recomienda roving tabindex porque el navegador hace scroll al elemento enfocado. → [Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/). MUI Scheduler usa `tabIndex="0"` en las celdas y el Tab entra a los eventos de la celda ([docs](https://mui.com/x/react-scheduler/accessibility)).
4. **APG Toolbar Pattern** para las acciones del elemento enfocado: [APG Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/). Implementación real: `EventToolbar.tsx` (`role="toolbar"`, botones con `aria-label`, navegación por flechas, `Escape`).
5. **APG Menu Button / Menu** para el menú por fila: [Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) · [Menu and Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)
6. **Persistencia del foco al eliminar.** La APG exige gestionarlo: si el usuario borra un ítem, hay que mover el foco al siguiente o al disparador, o el foco cae a `<body>`. → [sección "Discernible and Predictable Keyboard Focus"](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_focus_discernable_predictable). Implementación real: `getFocusFallback` en MUI (`EventContextMenuItems.tsx`).
7. **Anunciar el resultado (status messages).** WCAG 4.1.3; el patrón de "región viva persistente" + "foco y anuncio alternativos" ya está en el spec del CRM. Referencia de otro proyecto que lo hizo: Drupal Accessible Calendar ("AJAX update announcements for AT users", "focus moves to the calendar caption").
8. **Primitivas headless con teclado ya resuelto:**
   - **Headless UI** `Listbox` (tabla de teclado documentada) → [headlessui.com/react/listbox](https://headlessui.com/react/listbox); para acciones por fila, `Menu` → [headlessui.com/react/menu](https://headlessui.com/react/menu)
   - **React Aria** (Adobe): `useListBox`, `useMenu`, `useToolbar`, `useGridList` → [React Aria ListBox](https://react-spectrum.adobe.com/react-aria/ListBox.html) · [Toolbar](https://react-spectrum.adobe.com/react-aria/Toolbar.html) · [Menu](https://react-spectrum.adobe.com/react-aria/Menu.html)
   - **Base UI** (la base headless de MUI; el Scheduler importa `@base-ui/react/button`) → [base-ui.com](https://base-ui.com/)
9. **dnd-kit `KeyboardSensor`** (patrón "agarrar → flechas → soltar"): por defecto `Space`/`Enter` inician, flechas mueven (25 px por defecto, personalizable con `getNextCoordinates`), `Space`/`Enter` sueltan, `Escape` cancela. **Cumple operabilidad por teclado, pero no sustituye el arrastre según WCAG 2.5.7** (coincide con el análisis del spec del CRM). → [dnd-kit Keyboard Sensor](https://docs.dndkit.com/api-documentation/sensors/keyboard). Nota: la propia página distingue la API legacy de `@dnd-kit/dom`.

---

## 5. Casos de estudio / write-ups (con los problemas que tuvieron)

- **FullCalendar #2535 — "Event drag-n-drop / resize with keyboard"** (2015, abierto, v9). El hilo más completo: propone que enfocar + `Space/Enter` abra un popover con "Move event" / "Change event duration", navegación up/down/tab, `Enter` para soltar, `Escape` para abortar; menciona explícitamente que `aria-grabbed` está deprecado. → https://github.com/fullcalendar/fullcalendar/issues/2535
- **FullCalendar #6528 — "dateClick / select with keyboard"** (2021, abierto, v9). Construye sobre roving tabindex; reconoce la limitación *"There is no way to detect a single-day selection."* → https://github.com/fullcalendar/fullcalendar/issues/6528
- **FullCalendar #3364 — "ARIA improvements for event elements, tabindex"** (cerrado, v5.10): detectar si el evento es "interactable" para ponerlo en el tab order y disparar con Enter/Space. → https://github.com/fullcalendar/fullcalendar/issues/3364
- **FullCalendar #2536 — "Better accessibility with screen readers"** (cerrado): el problema del marcado de eventos desprendido del calendario. → https://github.com/fullcalendar/fullcalendar/issues/2536
- **MUI X — `getFocusFallback` (comentario en código)** es un mini write-up del problema "foco tras borrar". Archivo: `packages/x-scheduler/src/internals/components/event-context-menu/EventContextMenuItems.tsx`.
- **MUI X #22883 — atajos de vista `d/w/m/a`** (abierto): exige que los atajos de una tecla estén **acotados al foco**, se puedan **desactivar/remappear**, no disparen mientras se escribe y que el lector **anuncie la vista**. → https://github.com/mui/mui-x/issues/22883
- **GNOME Calendar — MRs !564 / !576 / !362** y el hilo público del desarrollador: foco al primer evento al entrar con Tab, `Ctrl+Tab` a la celda, `Shift+flechas` para selección, botón de overflow cuando la celda desborda; y la admisión de que el popover de quick-add estuvo **años inalcanzable por teclado** por falta de foco en celdas. → [MR !564](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/564) · [MR !576](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/576) · [MR !362](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/362)
- **Nextcloud server #9994 — "Keyboard accessibility"** (checklist de huecos de teclado). → https://github.com/nextcloud/server/issues/9994
- **Drupal Accessible Calendar**: documenta el paquete completo de anuncios + foco tras navegación AJAX (útil como referencia de status messages, aunque no tiene lista). → https://www.drupal.org/project/accessible_calendar
- **Home Assistant frontend #25497 — "Screen Reader Accessibility Issues"**. → https://github.com/home-assistant/frontend/issues/25497
- **Google Calendar**: la Agenda es la única vista con soporte de teclado/lector según la Universidad de Colorado OIT. → https://oit.colorado.edu/services/messaging-collaboration/google-workspace/accessibility/calendar

---

## 6. Lo que nadie ha resuelto bien (honesto)

1. **Mover/redimensionar desde la Lista por teclado no existe en ningún proyecto open source permisivo.** FullCalendar lo tiene como propuesta abierta desde 2015 (v9) y MUI no lo documenta (el drag/resize son de puntero; el "mover" se logra abriendo el diálogo de fecha/hora). Los que sí tienen agenda operable por teclado (Mobiscroll, Kendo, Bryntum) son comerciales y el detalle de mover/resize por teclado está **sin verificar**.
2. **"Duplicar" desde la agenda es prácticamente inexistente.** El menú de MUI solo tiene Editar y Borrar; FullCalendar no tiene acciones de lista. No encontré ningún proyecto con duplicar como acción de la fila.
3. **El foco después de una acción es el punto débil universal.** MUI necesitó un `getFocusFallback` hecho a mano; Drupal lo resolvió con foco al caption; la APG advierte que sin gestión el foco cae a `<body>`. No hay una primitiva estándar.
4. **Los anuncios (aria-live) para "moví/redimensioné/creé" no están estandarizados** en ninguna librería de calendario. Cada proyecto que lo hizo lo construyó ad hoc (Drupal; el anunciador persistente que el spec del CRM ya define).
5. **No hay patrón APG para calendarios ni para "lista de ítems con acciones" en el sentido de agenda con edición sin grilla.** La APG derivó el problema al Grid Pattern, pero no modela fechas/eventos. → [índice de patrones APG](https://www.w3.org/WAI/ARIA/apg/patterns/) (ningún "calendar").
6. **Crear en un hueco concreto desde la Lista** no lo hace nadie: la lista/agenda solo lista. Los huecos-vacíos-como-destino-de-teclado quedaron fuera en todos los productos investigados (ver también `2026-09-16-calendario-ux-competidores.md`).

---

## 7. Nota de licencias (explícita, para decidir qué se puede copiar)

**Permisivas (estudiar y reimplementar sin restricción):**
- **MIT:** FullCalendar, react-big-calendar, Schedule-X (core), MUI X Scheduler **Community**, TOAST UI Calendar, V-Calendar. Verificado por API de GitHub (`spdx_id`).
- **Apache-2.0:** kendo-ui-core como repo, pero **NO contiene el Scheduler** (verificado por API: no hay archivos `.js` de scheduler). El componente Scheduler es **comercial**.

**Copyleft (cuidado):**
- **AGPL-3.0:** Nextcloud Calendar, Vikunja, Cal.com. No conviene copiar código hacia un CRM propietario.
- **GPL-3.0:** GNOME Calendar. **GPL-2.0:** DHTMLX Scheduler Standard, Drupal Accessible Calendar. **LGPL-2.1:** Evolution.
- Nota: **DHTMLX Standard es GPL-2.0** (no LGPL), o sea que adaptar su código obliga a liberar el proyecto bajo GPL-2.0-compatible.

**Comerciales (no copiar código):** Bryntum Calendar, Kendo UI Scheduler, Mobiscroll Event Calendar, Schedule-X Premium, MUI X Premium.

**Conclusión para el CRM:** los únicos enfoques "cercanos" con código **permisivo** son **MUI X Scheduler (MIT)** y **FullCalendar (MIT)**. React-Aria/Base UI/Headless UI son MIT. Reimplementar **patrones e interacciones** (menú de acciones con `Space`, toolbar con `role="toolbar"`, roving tabindex, fallback de foco, región viva) a partir de fuentes MIT está **sin restricciones**; copiar código de proyectos AGPL/GPL o comerciales no.

---

## 8. Método y límites

- **Fuentes primarias:** archivos fuente vía `raw.githubusercontent.com` y árboles de repo vía API de GitHub; documentación oficial de cada librería; issues de GitHub; MRs de GitLab; documentación de W3C APG.
- **Sin verificar:** teclado en la Agenda de DHTMLX, Kendo, Bryntum y (parcialmente) Mobiscroll; drag/resize en la List de Schedule-X; estado moderno del `List View` de Evolution; licencia exacta de Home Assistant frontend (el detector devuelve `NOASSERTION`); comportamiento por teclado de Thunderbird Today Pane.
- **Descartado por poco fiable:** una URL de issue de "cal.diy" que apareció en resultados de búsqueda y no corresponde al repo oficial de Cal.com; no se cita.
- **No se ejecutó ningún proyecto:** todas las conclusiones salen de código y documentación, no de prueba en vivo. Donde el comportamiento es ambiguo, se marcó "sin verificar".
