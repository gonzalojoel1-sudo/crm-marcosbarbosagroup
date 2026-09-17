# Cómo resuelven los mejores calendarios 3 problemas de UX

**Fecha:** 2026-09-16
**Alcance:** vista semanal de CRM (5 días, 05:00–21:00, poco volumen de eventos)
**Tema:** bandas vacías, despliegue de hora en el evento, densidad
**Regla:** cada afirmación concreta lleva URL de fuente. Cuando no existe fuente primaria, se dice explícitamente.

---

## TL;DR

- **Google Calendar no auto-scrollea al primer evento.** Su solución real (2026) es una ventana de **12–15 h elegida según la altura del viewport** + modos de densidad `Responsive / Comfortable / Compact`. La compresión de bandas vacías existe en el viejo Labs "Hide morning and night" (2011), retirada en 2017 y nunca repuesta.
- **Fantastical y BusyCal sí colapsan el rango visible** ("Only show hours from day start to end" / "Working Hours toggle") — es el patrón de referencia para bandas vacías.
- **Nadie hace tiempo no lineal** en los productos investigados (05:00 colapsado a una fila y 09:00 a escala real en la misma columna). Sí existía el "folded row" de Google Labs 2011.
- **La hora dentro del bloque aparece condicionada a la altura.** Google la muestra solo si el evento dura >1 h. BusyCal tiene un toggle explícito: "Show event times for single-line events".
- **Densidad:** el truco dominante es lane-splitting por solapamiento (ancho/nº de columnas, con expansión de ancho máximo), y bajar la altura por hora (zoom hours). Valores claros: Google 12–15 h en viewport, Apple 6–24 h, BusyCal 4–24 h, FullCalendar `scrollTime` 06:00 y slot 30 min, Cliniko ~40 px por slot.

---

## 1. BANDAS VACÍAS (horas no laborables / sin eventos)

### 1.1 Auto-scroll al primer evento / a "ahora"

| Producto | Comportamiento exacto | Fuente |
|---|---|---|
| Google Calendar (web) | **No hay auto-scroll al primer evento documentado.** La vista semanal renderiza 00:00→24:00 y el usuario scrollea; de ahí las quejas recurrentes. | https://support.google.com/calendar/thread/176370814/how-do-you-display-just-working-hours-in-the-calendar-display-mode |
| Google Calendar (móvil Android) | La app tiene "Jump to today" (icono de fecha arriba a la derecha), no "jump to first event". | https://support.google.com/calendar/answer/6110849?co=GENIE.Platform%3DAndroid&hl=en |
| Notion Calendar / Cron | `T` = ir a hoy, con un ajuste de "Calendar navigation": **alinear hoy en la vista** o mantener el layout actual. | https://cronhq.notion.site/Getting-around-the-grid-0e2e230ae42d48d2bf43dfe025f3ea55 · https://www.notion.com/help/notion-calendar-settings |
| Fantastical | "Up Next" en la lista **scrollea pasando eventos largos ya iniciados** para llevar al siguiente bloque relevante. | https://apps.apple.com/us/app/fantastical-calendar/id718043190 |
| FullCalendar (librería) | `scrollTime` define a qué hora se scrollea al abrir. **Default: `06:00:00`.** Se reaplica al cambiar el rango de fechas salvo `scrollTimeReset:false`. | https://fullcalendar.io/docs/scrollTime |
| Mantine Schedule (librería) | Prop `startScrollTime` ("useful when you want the view to open at a specific time (e.g., business hours start) instead of midnight"). | https://github.com/mantinedev/mantine/blob/master/apps/mantine.dev/src/pages/schedule/week-view.mdx |

> Nota de precisión: **Google Calendar NO auto-scrollea al primer evento**; lo que sí hace es elegir el rango visible. Ver 1.4.

### 1.2 Rango de horas visible configurable / "hide non-working hours"

| Producto | Comportamiento exacto | Fuente |
|---|---|---|
| Fantastical (iOS/Windows) | **"Only Show Day Start And End Hours" / "Only show hours from day start to end"**: restringe Day y Week view a las horas definidas en "Day Starts/Ends At". | https://flexibits.com/fantastical-ios/help/settings · https://flexibits.com/fantastical-windows/help/settings |
| Fantastical (Mac) | "Day starts/ends at" **resalta** esas horas; "Show (hours) at a time" fija cuántas horas caben por página en Day/Week. | https://flexibits.com/fantastical/help/settings |
| BusyCal | **Working Hours toggle** en la toolbar: "quickly collapse hours outside your Day Start and Day End settings". Al activarlo muestra un overlay sutil recordando que estás en modo horas laborables. Se recuerda por Smart Filter. | https://www.busymac.com/docs/busycal/70587-day-view · https://www.busymac.com/docs/busycal/70588-week-view |
| BusyCal prefs | "Show Only Working Hours (Day Start – End) — Limits visible time to your configured workday range". | https://www.busymac.com/docs/busycal/70607-preferences |
| Notion Calendar | "Zoom Hours In / Out" + "Default Hour Size" (Shift ⌘ 0). El propósito declarado es "change the density on your grid or **remove empty space**". | https://cronhq.notion.site/Calendar-view-options-329f8bc37d8f4c509f7fd56a220a584e |
| Apple Calendar | Day/Week: de **6 a 24 horas** visibles + "mark when your day starts and ends". No hay "ocultar" estricto, solo marcar y ajustar rango. | https://support.apple.com/guide/calendar/change-the-days-and-times-displayed-icl1002/mac |
| FullCalendar | `slotMinTime` (default 00:00) y `slotMaxTime` (default 24:00) recortan el eje de tiempo (exclusivo el fin). | https://fullcalendar.io/docs/slotMinTime · https://fullcalendar.io/docs/slotMaxTime |
| Google Calendar | **No permite ocultar bandas.** "The Working hours setting only controls when others can book" (2025). | https://support.google.com/calendar/thread/344886591/can-t-hide-early-morning-hours-in-calendar |

### 1.3 Compresión / colapso de bandas vacías (doblarlas)

| Producto | Comportamiento exacto | Fuente |
|---|---|---|
| Google Calendar (histórico, Labs 2011) | "Hide morning and night": **con un slider se doblaban todas las horas vacías en una sola fila**; "The folded rows still show all your events, just in more compact form". Los eventos ocultos se concentraban en un slot tipo "12am–8am". Retirado en el rediseño de 2017. | https://gmail.googleblog.com/2011/11/hide-morning-and-night-hours-in.html · https://www.theverge.com/web/2011/11/30/2600221/google-calendar-hide-morning-night-hours |
| Google Calendar (hoy) | Sin opción nativa. Solo extensiones (GCalPlus: oculta horas de la mañana y pone **línea roja punteada de aviso** si hay eventos ocultos). | https://support.google.com/calendar/thread/1206271/is-it-possible-to-zoom-in-on-the-8am-6pm-part-of-the-week-view-in-the-desktop-version · https://chromewebstore.google.com/detail/gcalplus/mjelhipeelammmhpghkpigkdonihkakj |
| BusyCal / Fantastical | No "doblan": recortan el rango (1.2). Efecto equivalente para bandas periféricas; no para huecos centrales. | ver 1.2 |

### 1.4 Auto-fit / zoom-to-content (la solución moderna de Google)

| Producto | Comportamiento exacto | Fuente |
|---|---|---|
| Google Calendar (mar 2026) | Nuevo escalado: "**The grid will prioritize showing a relevant 12–15 hour range (such as 7:00 AM to 7:00 PM) based on your viewport height**" y "reducing unnecessary whitespace". ON por defecto. | https://workspaceupdates.googleblog.com/2026/03/better-screen-scaling-for-google-calendar-on-large-monitors.html |
| Google Calendar (jul 2026) | Modos de densidad: **Responsive** (escala dinámicamente para llenar monitores grandes), **Comfortable** (layout clásico), **Compact** (más denso, más eventos). | https://support.google.com/calendar/answer/15619910 · https://workspaceupdates.googleblog.com/2026/07/updated-options-to-better-view-google-Calendar-on-large-monitors.html |
| Notion Calendar | "Zoom Hours In/Out" (densidad del grid) separado de "Interface scale". | https://www.notion.com/help/notion-calendar-settings |
| BusyCal | 4–24 h visibles, ajustable con **Option+scroll** o arrastrando la regla de tiempo; Day y Week recuerdan su propio zoom. | https://www.busymac.com/docs/busycal/70587-day-view · https://www.busymac.com/docs/busycal/70588-week-view |
| Apple Calendar | 6–24 h; pinch-to-zoom en Month view iOS 18 cambia nivel de detalle (puntos → barras → títulos → horas). | https://support.apple.com/guide/calendar/change-the-days-and-times-displayed-icl1002/mac · https://9to5mac.com/2025/02/10/this-hidden-ios-18-trick-makes-apples-calendar-app-more-useful-than-ever |

### 1.5 Sombreado gris de horas no laborables

| Producto | Comportamiento exacto | Fuente |
|---|---|---|
| BusyCal | "Day ends at — **Shade the times after the end of day** in Day view and Week View". | https://www.busymac.com/docs/busycal/70607-preferences |
| Fantastical | "Day starts/ends at: These options will determine **which hours are highlighted** in the day view". | https://flexibits.com/fantastical/help/settings |
| Google Calendar | Gris para horas no laborables **de otras personas** y en la pestaña "Find a time" ("non-working hours appears in grey color, while the working hours zone is white"). Muchos usuarios reportan que **su propio** calendario no se grisa. | https://support.google.com/calendar/thread/176370814/... · https://support.google.com/calendar/thread/18108473/how-do-i-grey-out-my-non-working-hours |
| Outlook (referencia) | Work Time pinta gris fuera de horario, pero **no oculta**; workaround de evento recurrente "Non-working hours". | https://learn.microsoft.com/en-us/answers/questions/5601031/i-only-want-to-see-working-hours-on-my-calendar-an |

### 1.6 Sticky time gutter / "jump to next event"

- **Gutter multi-zona (sticky por diseño):** BusyCal muestra hasta **3 zonas horarias** en la regla vertical izquierda de Day/Week. https://www.busymac.com/docs/busycal/70588-week-view
- **Jump to next event:** no lo encontré como acción de grilla en ningún producto. Lo equivalente son: Google "Jump to today" (https://support.google.com/calendar/answer/6110849?co=GENIE.Platform%3DAndroid&hl=en), Notion Calendar `T` + alinear hoy (https://cronhq.notion.site/Getting-around-the-grid-0e2e230ae42d48d2bf43dfe025f3ea55), Fantastical "Up Next" (https://apps.apple.com/us/app/fantastical-calendar/id718043190).
- **Tiempo no lineal (comprimido solo el centro):** no hay ningún producto actual que lo haga; solo el "folded row" de Google Labs 2011 (1.3). FullCalendar tampoco: `slotDuration` es uniforme. https://fullcalendar.io/docs/slotDuration

---

## 2. DESPLIEGUE DE LA HORA EN EL EVENTO

### 2.1 Qué muestra cada producto dentro del bloque

| Producto | Contenido del bloque | Fuente |
|---|---|---|
| Google Calendar (web, Day/Week) | Título + rango de hora. Product expert: "If you use Day or Week view and **the event lasts >1 hour, you should see the start and end times**". En Agenda siempre muestra inicio. | https://support.google.com/calendar/thread/258512113/show-time-until-next-event |
| Google Calendar (Android) | El bloque puede no mostrar hora exacta; **long-press sobre el evento ajusta el número en la regla izquierda para mostrar la hora de inicio exacta**. | https://www.computerworld.com/article/1722623/google-calendar-android.html |
| BusyCal | Bloque con título; para eventos de una sola línea hay un toggle explícito: **"Show event times for single-line events"** (en Accessibility/Appearance) para mostrar u ocultar la hora. "Show event times for single-line events - Toggle to hide times for single-line items". | https://www.busymac.com/docs/busycal/70588-week-view |
| Fantastical | Lista: "Show when events end" añade la hora de fin. Ventana: hasta "Show (hours) at a time". | https://flexibits.com/fantastical-windows/help/settings · https://flexibits.com/fantastical/help/settings |
| Apple Calendar (Month, iOS 18) | Zoom progresivo: puntos → barras de color → **títulos** → **títulos + horas** → más espacio. La hora solo aparece a máxima densidad. | https://9to5mac.com/2025/02/10/this-hidden-ios-18-trick-makes-apples-calendar-app-more-useful-than-ever |

### 2.2 ¿A qué altura se recorta/elimina la hora?

- **Regla de Google:** la hora (inicio–fin) se muestra cuando el evento supera ~1 h de duración; por debajo, el bloque prioriza el título. Fuente: https://support.google.com/calendar/thread/258512113/show-time-until-next-event
- **Regla de altura física:** Google redujo los eventos **<25 min para que ocupen menos espacio vertical** ("better reflect the true duration"), configurable con "Display shorter events the same size as 30 minute events". Es decir: el bloque corto es más bajo y con menos texto. https://workspaceupdates.googleblog.com/2020/07/better-visualize-shorter-meetings-in-calendar.html
- **BusyCal** resuelve el caso límite con un toggle binario por "single-line event", no por umbral de píxeles. https://www.busymac.com/docs/busycal/70588-week-view
- No encontré ningún producto que documente el umbral en **píxeles**. Google usa duración; Apple usa nivel de zoom; BusyCal usa nº de líneas.

### 2.3 ¿La hora a la izquierda, en la columna, en lugar de dentro?

- **No como patrón general.** La hora izquierda es la **regla/axis** (gutter), no el evento.
- Excepción concreta: **Google Calendar Android** — al hacer long-press en un evento, la hora exacta de inicio aparece **en la regla de la izquierda**. https://www.computerworld.com/article/1722623/google-calendar-android.html
- **Mantine Schedule / FullCalendar / la mayoría:** hora dentro del bloque y eje horario en la gutter. https://github.com/mantinedev/mantine/blob/master/apps/mantine.dev/src/pages/schedule/week-view.mdx

---

## 3. DENSIDAD

### 3.1 Manejo de solapamiento (lanes / división de ancho)

| Fuente | Regla exacta |
|---|---|
| Algoritmo clásico (Stack Overflow, 71 votos) | Se agrupan eventos que solapan directa o indirectamente; se asignan a columnas greedy (primer carril libre); **ancho = 1/nº de columnas**; luego cada evento **se expande a la derecha** hasta chocar con otra columna, para ancho máximo. | https://stackoverflow.com/questions/11311410/visualization-of-calendar-events-algorithm-to-layout-events-with-maximum-width |
| Google Calendar | Los solapados van lado a lado. Orden: "**The overlapping order is based on start time. The event that starts later is displayed on top.**" | https://support.google.com/calendar/thread/203429627/google-calendar-display-of-overlapping-events |
| Google Calendar (eventos muy cortos) | Si el bloque es demasiado bajo para mostrar texto y caber en la franja, **el evento se mueve al lado** en lugar de apilarse. | https://support.google.com/calendar/thread/116152493/seamless-events-that-begin-as-others-end-are-displaying-inconsistently |
| FullCalendar | `slotEventOverlap` default `true`: solapan visualmente y **"At most half of each event will be obscured"**. Con `false`, cero solape (lado a lado). | https://github.com/fullcalendar/fullcalendar-docs/blob/main/_docs-v5/timegrid-view/slotEventOverlap.md |
| react-big-calendar | `dayLayoutAlgorithm`: `overlap` (default, se superponen) vs `no-overlap` (lado a lado). | https://deepwiki.com/jquense/react-big-calendar/4.1-event-layout-algorithms |
| BusyCal | **Opción de layout**: "Side-by-side vs stacked layout for overlapping events" / "Disable overlapping layout — Stack overlapping events vertically". | https://www.busymac.com/docs/busycal/70588-week-view · https://www.busymac.com/compare/apple-calendar |
| Calendar 366 (Mac) | Novedad: opción en week view para **apilar** eventos solapados en vez de lado a lado. | https://apps.apple.com/us/app/calendar-366-events-tasks/id6502818600?platform=mac |
| Eventually (SwiftUI) | Layout custom que coloca eventos lado a lado y maximiza el ancho para que el título siga visible. | https://github.com/claustrofob/Eventually |

> **No encontré evidencia pública de un tope de columnas** (p. ej. "a partir de 4 solapes se apilan o aparece '+N'") en Google Calendar web. En Month view Apple usa "N more…" (https://apple.stackexchange.com/questions/407959/how-can-the-macos-calendar-show-1-more-daily-events-in-the-month-view), pero eso es vista mensual, no week.

### 3.2 Altura por hora / zoom (con valores)

| Producto / librería | Valor por defecto / rango | Fuente |
|---|---|---|
| Google Calendar (web) | Rango visible auto de **12–15 h** según viewport; modos Responsive/Comfortable/Compact. El px/hora no está publicado. | https://workspaceupdates.googleblog.com/2026/03/better-screen-scaling-for-google-calendar-on-large-monitors.html |
| Apple Calendar | **6–24 h** visibles en Day/Week. | https://support.apple.com/guide/calendar/change-the-days-and-times-displayed-icl1002/mac |
| BusyCal | **4–24 h**; `⌘-Option-[1-9]` para 1–9 días; Option+scroll y arrastre de la regla para zoom. | https://www.busymac.com/docs/busycal/70587-day-view |
| Notion Calendar | Zoom Hours In/Out; "Default Hour Size" (Shift ⌘ 0). Sin px públicos. | https://cronhq.notion.site/Calendar-view-options-329f8bc37d8f4c509f7fd56a220a584e |
| Fantastical | "Show (hours) at a time" (Day y Week), "Days in week view" (7, 5, etc.). | https://flexibits.com/fantastical/help/settings |
| FullCalendar | `slotDuration` default **30 min**; `scrollTime` default **06:00**; `slotMinTime`/`slotMaxTime` 00:00–24:00. | https://fullcalendar.io/docs/slotDuration · https://fullcalendar.io/docs/scrollTime |
| Mantine Schedule | `intervalMinutes` default **60**; `startTime`/`endTime`; `startScrollTime`. | https://github.com/mantinedev/mantine/blob/master/apps/mantine.dev/src/pages/schedule/week-view.mdx |
| Cliniko (scheduling) | "Time slot height": ejemplo de **40 px**, bajable a 30/20/15 px. | https://help.cliniko.com/en/articles/1738660-adjust-your-calendar-s-display |
| Tutorial "Google-Calendar-Style" | Ejemplo real de **44 px por hora** y gutter de **48 px**. | https://www.webdevpuneet.com/2026/07/building-google-calendar-style-week.html |

### 3.3 Compact vs comfortable, ocultar fines de semana, fila all-day

| Técnica | Producto | Detalle | Fuente |
|---|---|---|---|
| Modos de densidad | Google Calendar | Responsive / Comfortable / Compact. | https://support.google.com/calendar/answer/15619910 |
| Compact display | BusyCal | Reducir tamaños de fuente en Appearance Settings para ver más eventos; "Show event times for single-line events". | https://www.busymac.com/docs/busycal/70588-week-view |
| Ocultar fin de semana | Google (API) | `hideWeekends: true/false`. | https://developers.google.com/workspace/calendar/api/v3/reference/settings |
| Ocultar fin de semana | Notion Calendar | Ctrl/⌘K → Show/Hide weekends. | https://cronhq.notion.site/Calendar-view-options-329f8bc37d8f4c509f7fd56a220a584e |
| Ocultar fin de semana | BusyCal | `Shift-⌘-K`. | https://www.busymac.com/docs/busycal/70588-week-view |
| Ocultar fin de semana | Apple Calendar | Week view de 7 o **solo lunes–viernes**. | https://support.apple.com/guide/calendar/change-the-days-and-times-displayed-icl1002/mac |
| Ocultar fin de semana | Amie | Setting "Hide weekends". | https://amie.so/documentation/account/settings |
| Ocultar fin de semana | FullCalendar | `weekends: true/false`; `hiddenDays`. | https://fullcalendar.io/docs/weekends |
| Fila all-day | BusyCal | Sección all-day arriba de Day/Week con banners, tareas y multi-día; rellena huecos entre banners. | https://www.busymac.com/docs/busycal/70588-week-view |
| Fila all-day | Mantine | Sección separada arriba; eventos que cruzan medianoche o duran todo el día van ahí. | https://github.com/mantinedev/mantine/blob/master/apps/mantine.dev/src/pages/schedule/week-view.mdx |
| "Stacked"/cascading overlap | BusyCal, Calendar 366 | Apilar verticalmente en vez de lado a lado. | https://www.busymac.com/docs/busycal/70588-week-view |

---

## 4. DÓNDE LOS PRODUCTOS DISCREPAN

1. **Ocultar bandas vacías:** Google **no** lo permite; Fantastical, BusyCal y Apple **sí** (recorte de rango). Fuentes: https://support.google.com/calendar/thread/344886591/... vs https://flexibits.com/fantastical-ios/help/settings y https://www.busymac.com/docs/busycal/70587-day-view.
2. **Solape:** Google y FullCalendar (default) **superponen** visualmente; BusyCal, Calendar 366 y FullCalendar `no-overlap` **lado a lado**; react-big-calendar permite ambos. Fuentes: https://support.google.com/calendar/thread/203429627/... · https://github.com/fullcalendar/fullcalendar-docs/blob/main/_docs-v5/timegrid-view/slotEventOverlap.md · https://www.busymac.com/docs/busycal/70588-week-view
3. **Hora en el bloque:** Google la ata a **duración** (>1 h); BusyCal a **nº de líneas**; Apple al **nivel de zoom**. Tres criterios distintos para el mismo recorte.
4. **Hora de apertura:** FullCalendar scrollea a **06:00** por defecto; Google renderiza 00:00→24:00 salvo auto-fit; Fantastical/BusyCal arrancan en "Day Start".
5. **Densidad automática vs manual:** Google 2026 auto-escala por viewport; Notion Calendar/BusyCal/Apple exigen acción explícita.

## 5. CRÍTICAS CONOCIDAS

- **Google:** pérdida del Labs "Hide morning and night" en 2017, con quejas activas hasta 2025; "no such setting". https://lifehacker.com/this-extension-brings-back-working-hours-to-google-cale-1827815781 · https://support.google.com/calendar/thread/344886591/...
- **Google "Responsive":** en 2026 hubo reportes de proporciones de eventos que "cambiaron de repente" y workarounds con zoom del navegador / reset de densidad. https://support.google.com/calendar/thread/429461132/google-calendar-responsive-to-your-screen-density-proportions-have-suddenly-changed
- **Extensiones que ocultan horas:** no expanden el calendario (dejan espacio en blanco abajo) y tienen riesgo de permisos. https://webapps.stackexchange.com/questions/114768/how-to-limit-visible-hours-in-new-google-calendar
- **Amie:** queja de que Day/Week están "zoomed in too much, even when you zoom out" y falta vista mensual. https://apps.apple.com/gb/app/amie-todos-calendar/id1548277133
- **Apple Calendar:** en Month view, "+N more…" no abre nada al clickear (solo al doble click en la fecha). https://apple.stackexchange.com/questions/407959/how-can-the-macos-calendar-show-1-more-daily-events-in-the-month-view
- **Outlook/Evolution/GNOME:** sin hide non-working hours nativo; se recomienda scrollear. https://learn.microsoft.com/en-us/answers/questions/5601031/... · https://discourse.gnome.org/t/is-there-a-way-to-show-only-work-hours-in-calendar-view/22505

---

## 6. RECOMENDACIÓN para 5 días, 05:00–21:00, pocos eventos

**Propuesta concreta:**

1. **Rango visible por defecto 05:00–21:00, no 00:00–24:00.** En un calendario de CRM el rango lo fija el negocio. Equivale a `slotMinTime: "05:00"` / `slotMaxTime: "21:00"` (FullCalendar) o `startTime/endTime` (Mantine). Fuentes de referencia: https://fullcalendar.io/docs/slotMinTime · https://github.com/mantinedev/mantine/blob/master/apps/mantine.dev/src/pages/schedule/week-view.mdx
   - **Tradeoff:** si aparece un evento a las 04:30 o 22:00, hay que indicarlo (badge "1 evento fuera de rango" o fila colapsada de 30 px). Es exactamente lo que hacía GCalPlus con su "línea roja punteada". https://support.google.com/calendar/thread/1206271/...

2. **Auto-scroll a la primera franja con contenido de la semana** (no a "ahora"). Con 05:00–21:00 el ahorro es menor, pero si un lunes está vacío a las 05:00 el grid abre directo a las 08:00. Implementación de referencia: `scrollTime` de FullCalendar (default 06:00) o `startScrollTime` de Mantine. https://fullcalendar.io/docs/scrollTime · https://github.com/mantinedev/mantine/blob/master/apps/mantine.dev/src/pages/schedule/week-view.mdx

3. **Sombreado gris de 05:00–09:00 y 18:00–21:00** (no ocultar, no doblar) + una franja más oscura para 00:00–05:00 y 21:00–24:00 si se permite scrollear fuera de rango. Patrón: BusyCal "Day ends at — Shade the times". https://www.busymac.com/docs/busycal/70607-preferences

4. **Altura por hora: 44 px** con gutter de 48 px, que es el valor usado en implementaciones que imitan Google Calendar. https://www.webdevpuneet.com/2026/07/building-google-calendar-style-week.html
   - Con 16 h visibles = 704 px de columna. Cabe en un portátil sin scroll y deja legible un evento de 30 min (22 px).
   - **Tradeoff:** 44 px es cómodo pero no "todo el día de un vistazo" en pantallas chicas; por eso hace falta (3) o un toggle "Compact".

5. **Toggle Compact** que baje a ~30 px/h → 480 px para 16 h. Referencia de rango y de que el zoom por hora es el mecanismo correcto: BusyCal 4–24 h (https://www.busymac.com/docs/busycal/70587-day-view) y Notion Calendar "Zoom Hours In/Out" (https://cronhq.notion.site/Calendar-view-options-329f8bc37d8f4c509f7fd56a220a584e).

6. **Hora dentro del bloque condicionada a la altura, no a la duración.** Con 44 px/hora, un evento de 30 min = 22 px (cabe título o título+corta hora, no ambos). Regla recomendada:
   - altura ≥ 44 px → hora `HH:MM – HH:MM` + título;
   - 22–44 px → solo título, hora en tooltip;
   - < 22 px → solo una barra de color, con detalle en hover.
   Fuente del patrón: BusyCal "Show event times for single-line events" (https://www.busymac.com/docs/busycal/70588-week-view) y Google >1 h (https://support.google.com/calendar/thread/258512113/show-time-until-next-event). **No hay un estándar publicado en píxeles; el umbral es decisión propia.**

7. **Solape:** lane-splitting con **ancho = 1/nº de carriles** y expansión a ancho máximo cuando el carril vecino está libre (algoritmo de Stack Overflow: https://stackoverflow.com/questions/11311410/). Con poco volumen, limitar a **2 carriles visibles** y, a partir del 3.º, apilar o mostrar un indicador "+N" al estilo Apple "N more…" (https://apple.stackexchange.com/questions/407959/...) — evita títulos ilegibles.
   - **Tradeoff:** el apilado oculta eventos; el "+N" requiere un popover. Para un CRM con bajo volumen, 2 carriles suele bastar.

8. **Ocultar fin de semana** si el CRM opera L–V: `weekends:false` (https://fullcalendar.io/docs/weekends) o Week view de 5 días como Apple (https://support.apple.com/guide/calendar/change-the-days-and-times-displayed-icl1002/mac). Aquí ya son 5 días, así que no aplica.

**Descartes explícitos y por qué:**
- **Tiempo no lineal / colapsar 05:00–09:00 a una fila:** ningún producto actual lo ofrece y rompe la lectura de posiciones relativas; alto costo de implementación y de comprensión. Solo Google Labs 2011 lo hizo. https://gmail.googleblog.com/2011/11/hide-morning-and-night-hours-in.html
- **Auto-fit tipo Google 12–15 h:** pensado para monitorear grandes con muchos eventos; con 16 h fijas y poco volumen no aporta y añade imprevisibilidad (ver críticas de "Responsive"). https://support.google.com/calendar/thread/429461132/...
- **Hora a la izquierda del bloque:** es la regla/axis, no el evento; solo Google Android lo usa como gesto de long-press. https://www.computerworld.com/article/1722623/google-calendar-android.html

---

## 7. Método y limitaciones

- Fuentes primarias: help centers (Google, Notion, Apple, BusyCal, Fantastical, Amie, Reclaim, Motion), changelogs/blogs oficiales, docs de librerías (FullCalendar, Mantine, react-big-calendar).
- Fuentes secundarias: The Verge, Lifehacker, Computerworld, 9to5Mac, Android Police, Android Headlines, Stack Overflow, Apple StackExchange, hilos de soporte de Google.
- **No verificado / no público:** px/hora por defecto de Google Calendar, Notion Calendar y Amie; tope de columnas de solape en Google; comportamiento exacto de auto-scroll en la web de Google. Se marcaron como tales.
- **Productos con poca documentación de vista:** Vimcal (sus docs cubren features de scheduling, no zoom/ocultar horas), Motion (Display Options solo cubre tema/semana/timezone/tasks), Rise (producto en transición; su narrativa no documenta la grilla).
