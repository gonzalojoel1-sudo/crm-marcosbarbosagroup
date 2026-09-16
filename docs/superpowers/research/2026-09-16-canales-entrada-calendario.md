# Canales de entrada para crear y mover eventos de calendario

**Fecha:** 2026-09-16
**Alcance:** calendario semanal de CRM (5 columnas, 05:00–21:00) + vista Lista + tabla Mes. Hoy la única forma de crear/mover es arrastrar con el mouse.
**Objetivo:** comparar canales de entrada (teclado, lector de pantalla, touch, power users) y recomendar una combinación con la menor superficie total.
**Regla:** cada afirmación concreta lleva URL. Cuando no hay fuente primaria, se dice explícitamente. No se escribe código.

---

## TL;DR

- **El canal que menos superficie agrega y más cubre es un panel lateral NO modal de edición** (form-first): sirve a teclado, lector de pantalla, touch y mouse a la vez. Google Calendar documenta su formulario de evento campo por campo, incluida la sección de fecha/hora. Fuente: https://support.google.com/accessibility/answer/6101541
- **La command palette (⌘K) es real y barata de construir, pero su valor depende del parser de lenguaje natural**, que es la pieza más frágil: Chrono (la librería que usan casi todos) declara **soporte parcial para español** (`es`). Fuentes: https://github.com/wanasit/chrono · https://www.npmjs.com/package/chrono-node
- **"next Tuesday" es genuinamente ambiguo** y depende de la región; la OED lo explica por el "punto de referencia implícito". Fuente: https://www.csmonitor.com/Arts-Culture/In-a-Word/2022/0404/Schedulers-stumble-over-what-next-week-means
- **El arrastre es un problema de accesibilidad, no solo de UX:** WCAG 2.2 SC 2.5.7 (AA) exige una alternativa de *single pointer* sin arrastre para toda funcionalidad que se opera arrastrando. Fuente: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements
- **Corrección de premisa:** SC 2.5.7 **no** postula la voz como la alternativa requerida. Exige *single pointer*; menciona la voz solo como ejemplo de dispositivo/AT. Ver §5.
- **Apple Calendar ya implementa el "nudge" por teclado** (Control-Option + flechas = mover 15 min / 1 día) y **FullCalendar resuelve el conflicto scroll-vs-arrastre con long-press de 1000 ms**. Fuentes: https://support.apple.com/guide/calendar/keyboard-shortcuts-ical002/mac · https://fullcalendar.io/docs/longPressDelay

---

## 1. COMMAND PALETTE / QUICK ADD (⌘K)

### 1.1 Cómo lo implementa cada producto

| Producto | Qué hace exactamente | Fuente |
|---|---|---|
| **Superhuman** | ⌘K abre "Superhuman Command". Crear evento por NL vía AI: `⌘K → Ask AI` y escribir "prompt con hora, invitados y lugar"; luego **Edit** para modificar el borrador y **Save**. Alternativa sin IA: `⌘K → Create Empty Event`. Desde un mensaje abierto, `⌘K → Create Event` precarga destinatarios, asunto y mejor horario. | https://help.superhuman.com/hc/en-us/articles/46005621734669-Create-Event |
| **Superhuman (patrón)** | Guía propia del patrón: ⌘K debe abrir/cerrar en todo el app, fuzzy matching (`command-score`), sinónimos/aliases por comando, score contextual, y mención explícita de que Superhuman/Linear/Slack usan **⌘K** mientras VS Code/Sublime usan ⌘⇧P. | https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ |
| **Linear** | "The command menu is one of the core components of Linear" — cientos de acciones agrupadas y priorizadas por contexto/vista. `Ctrl+K` (⌘K). Referencia del patrón, **no** crea eventos de calendario. | https://linear.app/changelog/2019-12-18-new-command-menu · https://keycombiner.com/collections/linear |
| **Slack** | **⌘K es Quick Switcher de navegación** (canales/DMs), no creación de eventos. Slack no es un calendario; sí tiene `/remind` para recordatorios. No aplica como "quick-create de evento". | https://slack.com/blog/productivity/slick-features-and-capabilities-you-didnt-know-about-in-slack · https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts · https://slack.com/help/articles/360057554553 |
| **Notion Calendar** | Tiene **command menu** ("manage Notion Calendar through the command menu and intuitive keyboard shortcuts") y ⌘K (ej. `cmd+K → "show Notion database"`). Crear evento: **seleccionar un slot de tiempo y completar detalles** — no hay parsing NL libre documentado. | https://www.notion.com/blog/introducing-notion-calendar · https://www.notion.com/help/use-notion-calendar-with-notion · https://www.notion.com/help/manage-your-calendars-and-events |
| **Notion Calendar / Cron** | Cron traía "a command bar you can use for quickly setting up recurring meetings and the like". | https://www.theverge.com/2024/1/17/24041330/notion-calendar-app |
| **Amie** | ⌘K abre el "quick menu — your command center". NLP documentado **para todos**: "Call John tomorrow at 3pm for 30 min", "Team standup every weekday at 9am". | https://amie.so/documentation/getting-started/quick-start |
| **Amie (señal negativa)** | Review en App Store pide NLP a nivel calendario: "calendar power users... most have natural language processing. I was actually quite surprised Amie doesn't have this feature yet" → el NLP de Amie está centrado en todos, no necesariamente en eventos. | https://apps.apple.com/us/app/amie-todos-calendar/id1548277133 |
| **Vimcal** | Marketing: "NLP for creating meetings" + "hot keys and natural language". Sin documentación detallada del parser. | https://vimcal.com/ |
| **Fantastical** | Parser NL con gramática documentada: `[nombre] at [lugar] [fecha/hora] [alerta] [URL] [calendario]`, `/w` para calendario, recurrencias ("every Tuesday", "third Thursday of every month"), tareas ("task/todo/reminder"). | https://thesweetsetup.com/natural-language-guide-for-fantastical · https://flexibits.com/fantastical/help/adding-events-and-tasks · https://flexibits.com/fantastical-ios/tips |
| **Apple Calendar (Mac)** | "Create Quick Event" con NL: "Party Feb 6", "Soccer Game on Saturday from 11am-1pm". Atajos léxicos: "breakfast/morning"→9:00, "lunch/noon"→12:00, "dinner/night"→19:00. | https://support.apple.com/en-ca/guide/calendar/icalwr13-events/mac |
| **Google Calendar** | El Quick Add NL histórico fue **descontinuado** (fuentes secundarias), pero el **endpoint API `events.quickAdd` sigue existiendo**. Hoy la UI expone la caja inline "Add title and time" que parsea título+hora ("Tennis practice at 5pm"), y atajos: `Shift+C` (burbuja/diálogo de tipo) y `C` (formulario completo). | https://developers.google.com/workspace/calendar/api/v3/reference/events/quickAdd · https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DDesktop&hl=en · https://chromewebstore.google.com/detail/google-calendar-natural-l/dpefadnnccbgjhgnnjilfgefcoallmji |

**Conclusión del patrón:** en todos los casos el NL **no guarda directo**: produce un borrador que el usuario revisa (Superhuman: Edit/Save; Fantastical: preview animado que muestra qué campos interpretó). Fuente Superhuman: https://help.superhuman.com/hc/en-us/articles/46005621734669-Create-Event. Preview de Fantastical: https://www.theverge.com/2012/11/29/3703778/fantastical-for-iphone

### 1.2 Fallas y límites conocidos del parsing NL de fechas

| Problema | Evidencia | Fuente |
|---|---|---|
| Ambigüedad de "next Friday/next Tuesday" | La OED lo atribuye al "punto de referencia implícito": en Escocia, Irlanda del Norte y buena parte de EE. UU. "next Saturday" suele ser la semana siguiente; en el sur de Inglaterra, la más próxima. Varía por hablante. | https://www.csmonitor.com/Arts-Culture/In-a-Word/2022/0404/Schedulers-stumble-over-what-next-week-means |
| La ambigüedad temporal depende del día de la semana en que se pregunta | Estudio con N=208; la resolución de la pregunta ambigua se modula por el día (lunes vs viernes). | https://pmc.ncbi.nlm.nih.gov/articles/PMC9003772 |
| El título se confunde con metadatos | Fantastical: "Prepare Friday roundup post on Thursday at 8pm" — el motor interpreta "Friday" del título como información del evento. | https://thesweetsetup.com/natural-language-guide-for-fantastical |
| Chrono (librería JS estándar) solo maneja inglés internacional por defecto | v2: soporte completo `en, ja, fr, nl, ru, uk, vi`; **parcial `de, es, it, pt, sv, zh`**. v1 intentaba todos los locales por defecto; v2 lo quitó (tradeoff precisión). | https://github.com/wanasit/chrono · https://www.npmjs.com/package/chrono-node · https://www.npmjs.com/package/chrono-node/v/2.0.3 |
| Extensiones que reviven Quick Add en Google | Dependen de Chrono y su lista de idiomas, **español incluido pero limitado por los locales de Chrono**. | https://github.com/mtimkovich/rip_quick_add |

**Sobre español / rioplatense específicamente:**

- Existe investigación sólida de *temporal tagging* en español: HeidelTime tiene recursos manuales en español (TempEval-3) y hay trabajos específicos ("Time for More Languages: ... Spanish"). Fuentes: https://ds.ifi.uni-heidelberg.de/resources/temporal-tagging · https://aclanthology.org/S10-1071.pdf
- Fantastical declara estar **localizado en español** y que "puedes empezar a escribir tu evento en cualquiera de estos idiomas y Fantastical lo entenderá". Fuente: https://apps.apple.com/lu/app/fantastical-calendar/id975937182?mt=12
- **No encontré ningún benchmark ni dato público sobre frases argentinas/rioplatenses** ("el martes que viene", "el próximo martes", "el jueves a la tarde"). **Esto queda sin verificar.** La única evidencia indirecta es que Chrono marca `es` como parcial.

### 1.3 Qué se deduce para el diseño

1. El input libre debe mostrar siempre **la fecha/hora interpretada antes de guardar** (preview o borrador editable). Práctica confirmada por Superhuman y Fantastical.
2. El parser NL **no puede ser el único camino**: si falla "el martes que viene", el usuario debe poder abrir el mismo evento en el formulario.
3. Para español hay que asumir cobertura incompleta; conviene un set acotado de frases soportadas + fallback explícito.

---

## 2. FORM-FIRST / DRAWER

### 2.1 Cómo es el editor de "cuándo" en Google Calendar (referencia)

Google Calendar documenta el orden de campos del formulario de evento (doc para lector de pantalla). Secuencia real al crear: título → **"date and time fields"** → recurrencia ("Does not repeat") → invitados → salas/lugar → descripción → adjuntos → notificaciones. Además permite saltar directo a un campo con `Alt/Option + {número}`, donde **2 = Date and time**. Fuente: https://support.google.com/accessibility/answer/6101541

> Precisión: el doc llama a la sección **"date and time fields"**; no confirmé el rótulo literal "When" en la UI actual, así que **no lo afirmo**.

Esto valida el enfoque form-first: campos etiquetados, agrupados, navegables por Tab y accesibles por atajo. La edición de recurrencia también es un dropdown navegable con flechas y `Enter/Space`. Fuente: ídem.

### 2.2 Modal vs drawer lateral vs popover: qué dicen las guías

| Guía | Recomendación | Fuente |
|---|---|---|
| NN/g — Modal & Nonmodal | Usar modal **solo** para advertencias importantes / información crítica; **no** para información no esencial que no pertenece al flujo. | https://www.nngroup.com/articles/modal-nonmodal-dialog |
| NN/g — Popups | "Favor nonmodal overlays placed at the bottom or on the side of the page" en lugar de overlays modales. | https://www.nngroup.com/articles/popups |
| Carbon (IBM) | El diálogo debe dispararse por acción del usuario, no interrumpir; foco inicial dentro del diálogo, cierre con `Esc` **y** botón Close, y **devolver el foco** al disparador. | https://carbondesignsystem.com/patterns/dialog-pattern |
| W3C APG — Dialog (Modal) | Al cerrar, el foco vuelve al elemento que lo invocó; se recomienda incluir siempre un elemento visible tipo botón que cierre. | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal |

**Lectura para un calendario:** editar un evento es un formulario multi-campo y de baja criticidad; un modal que secuestra el foco impide ver la grilla de fondo. La guía empuja hacia **panel no modal lateral** (mantiene contexto de la semana visible) o popover inline para creación rápida, reservando el modal para confirmaciones destructivas (borrar serie, etc.).

### 2.3 Componentes de fecha/hora: nativos vs custom y sus trampas

| Tema | Hallazgo | Fuente |
|---|---|---|
| `<input type=date/time>` | El picker lo dibuja el navegador/SO (apariencia variable); el valor se normaliza a `yyyy-mm-dd` y `HH:mm`; la UI se elige por locale. Validación limitada: un valor vacío es válido. | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date · https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/time |
| Soporte de AT del input nativo | `input[type=time]`: **screen reader parcial (43/53)**; **Voice Control parcial (10/28)**; la implementación varía por navegador (texto único vs múltiples spinners vs picker), lo que rompe semántica consistente. | https://a11ysupport.io/tech/html/input(type-time)_element |
| Patrón recomendado por W3C | Date Picker Dialog: input de texto + botón "Choose Date" que abre `dialog` con `grid`. Solo **una** celda del grid en el orden de Tab; flechas navegan; live region anuncia mes/año; el formato se describe con `aria-describedby`; al elegir, el `aria-label` del botón pasa a "Change Date, DATE_STRING". | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog |
| Variante combobox | Date Picker Combobox: el `Down Arrow` abre el diálogo; útil para touch+SR. | https://www.w3.org/TR/2021/NOTE-wai-aria-practices-1.2-20211129/examples/combobox/combobox-datepicker.html |
| Librerías lo confirman | MUI X remite explícitamente a los patrones APG de date picker (dialog y spinbutton). | https://mui.com/x/react-date-pickers/accessibility |

**Conclusión:** un `<input>` nativo es cómodo pero **no basta** como único control (soporte AT parcial y validación débil). El patrón robusto es campo de texto con formato explícito + botón que abre un grid APG-compliant. Esto también cumple WCAG 2.1.1 Keyboard.

---

## 3. CONTROLES IN-PLACE (dentro del evento)

### 3.1 Quién ya los envía

| Control | Producto que lo envía | Detalle | Fuente |
|---|---|---|---|
| **Nudge por teclado (mover)** | **Apple Calendar (Mac)** | Con evento seleccionado: `Control-Option-Up/Down` = **15 min antes/después**; `Control-Option-Left/Right` = 1 día antes/después (en Mes, 1 semana). Es la implementación de referencia del "arrow-key nudging". | https://support.apple.com/guide/calendar/keyboard-shortcuts-ical002/mac |
| Mover a otro calendario | Apple Calendar (Mac) | `Control-click` → elegir calendario del menú contextual. | ídem |
| Mover evento (teclado) | **Google Calendar web** | **No documenta** atajo para mover un evento existente: la navegación por flechas es para moverse por la grilla, no para desplazar el evento. El movimiento es arrastre. Esta ausencia es la causa directa del problema WCAG 2.5.7. | https://support.google.com/accessibility/answer/6101541 · https://support.google.com/calendar/answer/37034 |
| Resize en touch con "handles" | Google Calendar iOS/Android | "To change the event duration, **tap and drag the top or bottom circles** of the event." | https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DiOS&hl=en · https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DAndroid&hl=en |
| Handles al mantener presionado | Fantastical iOS | "tap and hold on an event to reveal handles that let you change the duration"; "tap, hold, and drag events to reschedule them". | https://flexibits.com/fantastical-ios/help/calendar-views |
| Duplicar / copiar | Apple Calendar iOS | "You can copy an event and paste it to another date." | https://support.apple.com/guide/iphone/create-and-edit-events-in-calendar-iph3d110f84/ios |
| Duplicar / reprogramar por long-press | Fantastical (señal de usuario) | Review de App Store menciona "the feature of being able to duplicate or reschedule an event by long tapping" — **fuente débil (review de usuario), no doc oficial**. | https://apps.apple.com/us/app/fantastical-calendar/id718043190?platform=iphone&see-all=reviews |
| **Duration stepper** (control numérico de duración) | — | **No encontré ningún calendario de escritorio de los relevados que documente un stepper de duración dentro del evento.** Google solo tiene un setting global "Default event duration". **No verificado** como patrón de producto. | https://support.google.com/calendar/answer/6084644?co=GENIE.Platform%3DAndroid&hl=en-GB |
| Drag handles como botones | Patrón avalado (no producto) | G219 ejemplifica explícitamente: "a single tap or click can reveal controls (arrows) to move a target in a stepwise fashion, or a drop-down menu can allow users to select the drop position". | https://www.w3.org/WAI/WCAG22/Techniques/general/G219 |

### 3.2 "Move mode": tradeoffs

- Modo = estado oculto: "the same user action can have different results depending on the state of the system. Poorly signaled modes can easily trigger user errors". NN/g exige **≥2 indicadores visuales** del modo activo (ej. resaltado + cursor) y **evitar modos cuando el slip puede ser inseguro**. Fuente: https://www.nngroup.com/articles/modes · https://www.nngroup.com/videos/ui-modes-modals
- Por eso, un "modo mover" explícito es viable **solo** con señalización redundante y `Esc` visible; nunca como único camino.
- La alternativa avalada por WCAG no es un modo sino **controles discretos**: flechas/stepper o un dropdown "Mover a…". Fuente: https://www.w3.org/WAI/WCAG22/Techniques/general/G219
- **Escenario de falla a evitar (F108):** que el arrastre sea la única forma de mover un evento. Fuente: https://www.w3.org/WAI/WCAG22/Techniques/failures/F108.html

### 3.3 Requisito normativo aplicable (clave)

> **SC 2.5.7 Dragging Movements (AA):** "All functionality that uses a dragging movement for operation can be achieved by a **single pointer** without dragging, unless dragging is essential..."

Fuente: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements

Matiz importante y contraintuitivo, textual de la guía: **la equivalencia de teclado NO satisface 2.5.7**; la alternativa debe poder operarse con un solo puntero (click/tap), porque "people using a touchscreen device may not use a physical keyboard". Fuente: ídem ("Relationship to keyboard accessibility requirements").

---

## 4. TOUCH

### 4.1 Cómo crean y reprograman los calendarios móviles

| App | Crear | Mover / redimensionar | Fuente |
|---|---|---|---|
| **Google Calendar iOS** | (a) botón Create → formulario; (b) **tap en un slot vacío** en Día/3 días/Semana | "tap and drag the top or bottom circles of the event" | https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DiOS&hl=en |
| **Google Calendar Android** | (a) botón Create; (b) **tap en slot vacío** | Mismos "circles"; además "To move an event, drag and drop it to a new time and date" | https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DAndroid&hl=en |
| **Apple Calendar iPhone** | Botón crear / formulario | **"touch and hold the event, then drag it to a new time, or adjust the grab points"** en Día/Semana | https://support.apple.com/guide/iphone/create-and-edit-events-in-calendar-iph3d110f84/ios |
| **Fantastical iOS** | Long-press en un día del DayTicker abre la pantalla "New Event" (review, 2012); hoy el alta principal es el formulario NL | "tap, hold, and drag events to reschedule them"; "tap and hold on an event to reveal handles that let you change the duration" | https://www.theverge.com/2012/11/29/3703778/fantastical-for-iphone · https://flexibits.com/fantastical-ios/help/calendar-views |

### 4.2 Tap-to-create vs long-press-to-create

- **Tap-to-create es la norma:** Google (tap slot vacío) y Apple usan tap/formulario para crear.
- **Long-press se reserva para manipular un evento existente:** Google (circles), Apple (touch and hold → drag / grab points), Fantastical (hold → handles).
- **Long-press-to-create no está documentado en ninguna de las apps relevadas. No verificado.**

### 4.3 El conflicto "drag to scroll" vs "drag to move" — cómo se resuelve

**FullCalendar** (la librería de calendario más usada en React, con wrapper oficial de React) lo resuelve con long-press:

- "On a touch device, for the user to begin drag-n-dropping events, **they must first tap-and-hold on the event in order to 'select' it**!" Hasta entonces, el gesto es scroll nativo.
- `longPressDelay` — **default: 1000 ms (1 segundo)** — controla cuánto hay que mantener antes de que el evento sea arrastrable o una fecha seleccionable.
- Variantes finas: `eventLongPressDelay` y `selectLongPressDelay`.

Fuentes: https://fullcalendar.io/docs/touch · https://fullcalendar.io/docs/longPressDelay

### 4.4 Guías de tamaño táctil y duración de long-press

| Norma / plataforma | Mínimo | Fuente |
|---|---|---|
| Apple HIG | **44 × 44 pt**; "Create controls that measure at least 44 points x 44 points so they can be accurately tapped with a finger." | https://developer.apple.com/design/tips |
| Material Design 3 | **48 × 48 dp** touch (icono de 24dp + padding = target 48dp); ~9 mm; pointer targets mín. 44dp; separación 8dp | https://m3.material.io/foundations/designing/structure |
| WCAG 2.5.8 Target Size (Minimum, **AA**) | **24 × 24 CSS px** o excepción de espaciado (círculo de 24px que no intersecta otro target) | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum |
| WCAG 2.5.5 Target Size (Enhanced, **AAA**) | **44 × 44 CSS px** | https://www.w3.org/WAI/WCAG21/Understanding/target-size |
| Long-press (duración) | Apple expone `minimumPressDuration` configurable en UIKit; **no publica un número universal**. Los context menus se revelan con "touch and hold". | https://developer.apple.com/documentation/uikit/handling-long-press-gestures · https://developer.apple.com/design/human-interface-guidelines/context-menus |

**Nota:** el HIG lista "Touch (or pinch) and hold" como gesto estándar para "reveal actions and controls" — es decir, long-press es convención aceptada, pero siempre como acelerador con alternativa visible. Fuente: https://developer.apple.com/design/human-interface-guidelines/gestures

---

## 5. VOZ / OTROS

### 5.1 ¿La voz es un canal práctico?

**Sí, pero como capa del SO, no como feature propia.**

| Evidencia | Fuente |
|---|---|
| Apple Calendar: "Siri: Ask Siri something like, 'Set up a meeting with Gordon at 9.'" y "Change my lunch from 12:30 to 1 p.m." | https://support.apple.com/guide/iphone/create-and-edit-events-in-calendar-iph3d110f84/ios · https://support.apple.com/en-ca/guide/calendar/icalwr13-events/mac |
| Apple expone **App Schemas / App Intents** (iOS 27 beta) para que una app de calendario reciba creación/edición por Siri: "create a new event", "move this to 10 in the evening", "change this to repeat weekly"; **Siri hace la interpretación, el pedido de aclaración y la confirmación**. | https://developer.apple.com/documentation/AppIntents/integrating-your-calendar-app-with-apple-intelligence · https://developer.apple.com/videos/play/wwdc2026/344 |
| Fantastical: "Type in your details **or use dictation** and watch your words magically turn into an actual event or task". | https://apps.apple.com/lu/app/fantastical-calendar/id975937182?mt=12 |
| Google Calendar lista la voz bajo "Alternative input": "Voice input for: Command, Control, Dictation". | https://support.google.com/calendar/answer/16271522?co=GENIE.Platform%3DDesktop&hl=en |

**Implicación de diseño:** en una web app, el canal de voz práctico es **dictado del SO hacia el mismo input de texto** del formulario/palette. No hace falta construir un flujo de voz propio; el parser NL (§1) ya es el punto de entrada de texto.

### 5.2 Verificación de la premisa: ¿WCAG SC 2.5.7 lista la voz como alternativa?

**No, la premisa es inexacta.** El texto normativo de 2.5.7 exige una alternativa de **single pointer** sin arrastre. La voz aparece solo como:

1. Ejemplo de dispositivo adaptado que vuelve el arrastre incómodo: "a specialized or adapted input device, such as a trackball, head pointer, eye-gaze system, or **speech-controlled mouse emulator**, which may make dragging cumbersome and error-prone."
2. Parte de la definición de *assistive technology*: "alternative input methods (**e.g., voice**)".
3. Nota sobre inputs de texto: "text entry can take place through **voice**, pointer or keyboard".

Fuente (verbatim): https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements

Los criterios pertinentes para entrada por teclado/voz son:
- **2.1.1 Keyboard (A):** toda funcionalidad operable por teclado. https://www.w3.org/WAI/WCAG22/Understanding/keyboard
- **2.5.7 Dragging Movements (AA):** alternativa de single pointer sin arrastre (no teclado). https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements

**Conclusión:** la voz no es requisito; es una modalidad de entrada que, si el formulario y el palette son solo-inputs, ya queda cubierta gratis.

---

## 6. COSTO, A QUIÉN SIRVE Y QUÉ NO CUBRE

> Los niveles de esfuerzo son **estimaciones relativas** (no hay fuente); lo demás está citado.

| Canal | A quién sirve | Esfuerzo | Qué NO cubre | Fuente clave |
|---|---|---|---|---|
| **1. Command palette + quick add (texto/NL)** | Power users, teclado; indirectamente voz por dictado | **Medio-alto** (UI del palette: bajo; parser NL + i18n + confirmación: alto) | Touch puro; usuarios sin hábito de atajos; **no** es accesible por sí solo si no expone el resultado antes de guardar; parser `es` parcial | https://github.com/wanasit/chrono · https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ |
| **2. Form-first (panel/drawer + inputs etiquetados)** | Teclado, lector de pantalla, touch, mouse; base de todo | **Medio** (form + validación + date picker APG) | No es "rápido" para crear en masa; el arrastre sigue existiendo para quien lo prefiera | https://support.google.com/accessibility/answer/6101541 · https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog |
| **3a. Nudge por teclado (flechas)** | Power users de teclado; usuarios con dificultad motriz que usan teclado | **Bajo** | Touch sin teclado; lectores de pantalla necesitan anuncio del resultado | https://support.apple.com/guide/calendar/keyboard-shortcuts-ical002/mac |
| **3b. Menú "Mover a…" / "Cambiar duración…"** | Single-pointer sin arrastre: touch, head-pointer, eye-gaze, discapacidad motriz | **Bajo-medio** | No es eficiente para mover 15 min repetidas veces | https://www.w3.org/WAI/WCAG22/Techniques/general/G219 |
| **3c. "Move mode" explícito** | Nadie en particular (redundante con 3a/3b) | Medio | Alto riesgo de mode error; requiere doble señalización + Esc | https://www.nngroup.com/articles/modes |
| **4. Touch: tap-slot-create + handles de resize + long-press para arrastrar** | Tablet/phone | **Medio** (gestos, conflictos de scroll, hit targets) | Precisión de minutos sin zoom; usuarios con temblor (necesita 3b igual) | https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DiOS&hl=en · https://fullcalendar.io/docs/longPressDelay |
| **5. Voz** | Usuarios con discapacidad motriz/visual; manos ocupadas | **Bajo si se reutiliza el texto** del canal 1/2; alto si es flujo propio | Sin hardware/micrófono; no disponible en todos los idiomas/regiones (Apple lo advierte) | https://support.apple.com/guide/mac-mini/siri-apdf7bb2fad4/mac |

---

## 7. TABLA COMPARATIVA

| Canal | Sirve a | Esfuerzo | Huecos | Fuente principal |
|---|---|---|---|---|
| Command palette / quick add | Power users, teclado, voz (dictado) | Medio-alto | NL español parcial; ambigüedad "next Tuesday"; touch; requiere confirmación | https://github.com/wanasit/chrono · https://www.csmonitor.com/Arts-Culture/In-a-Word/2022/0404/Schedulers-stumble-over-what-next-week-means |
| Form-first / drawer lateral | Teclado, lector de pantalla, touch, mouse | Medio | Lento para alta masiva; no elimina el arrastre existente | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog |
| In-place: nudge teclado | Power users, teclado, dificultad motriz con teclado | Bajo | No touch; requiere feedback audible para SR | https://support.apple.com/guide/calendar/keyboard-shortcuts-ical002/mac |
| In-place: menú "Mover a" / handles-botón | Touch, pointer sin arrastre, AT | Bajo-medio | Menos eficiente que el arrastre para movimientos chicos | https://www.w3.org/WAI/WCAG22/Techniques/general/G219 |
| In-place: "move mode" | — (redundante) | Medio | Mode errors; requiere doble señal + Esc; no avalado como único camino | https://www.nngroup.com/articles/modes |
| Touch (tap-create + long-press-drag + circles) | Tablet/phone | Medio | Conflicto scroll/mover; precisión; necesita alternativa single-pointer | https://fullcalendar.io/docs/longPressDelay |
| Voz | Discapacidad motriz/visual, manos ocupadas | Bajo (reusando texto) | No es requisito WCAG; depende del SO | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements |

---

## 8. COMBINACIÓN RECOMENDADA

**Construir 3 piezas, reutilizando superficies:**

1. **Panel lateral NO modal de evento** (form-first) como la **única superficie de crear/editar**.
   - Campos etiquetados, orden: título → fecha/hora → duración → recurrencia → notas.
   - Input de texto con formato explícito + botón "Elegir fecha" que abre un **grid APG** (una sola celda en el tab order, flechas, live region de mes/año).
   - Es la base que sirve teclado, lector de pantalla y touch, y es el fallback del parser NL.
   - Fuentes: https://support.google.com/accessibility/answer/6101541 · https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog · https://www.nngroup.com/articles/popups

2. **⌘K / Ctrl+K command palette con quick-add**, cuyo input de texto es **el mismo** tipo de campo del panel.
   - Al escribir "Nueva cita martes 15:30" **no guarda**: abre el panel con los campos pre-cargados (borrador). Esto reutiliza el patrón de Superhuman/Fantastical y neutraliza el riesgo de parseo.
   - El mismo input recibe dictado del SO → la voz queda cubierta sin flujo propio.
   - Fuentes: https://help.superhuman.com/hc/en-us/articles/46005621734669-Create-Event · https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ · https://support.google.com/calendar/answer/16271522?co=GENIE.Platform%3DDesktop&hl=en

3. **Mover/redimensionar con alternativa single-pointer, además del arrastre.**
   - Con el evento seleccionado: **nudge por teclado** (`Alt/Control + flechas` = mover; `Shift + flechas` o `+/-` = duración), calcado de Apple Calendar.
   - Y **menú "Mover a…" / "Cambiar duración…"** operáble con tap/click, más los **circles/handles como botones** en touch (estilo Google).
   - Esto cumple **2.1.1 y 2.5.7** a la vez.
   - Fuentes: https://support.apple.com/guide/calendar/keyboard-shortcuts-ical002/mac · https://www.w3.org/WAI/WCAG22/Techniques/general/G219 · https://support.google.com/calendar/answer/72143?co=GENIE.Platform%3DiOS&hl=en

**Qué NO construir:** un "move mode" dedicado (redundante y proclive a mode errors — https://www.nngroup.com/articles/modes) y un flujo de voz propio (la voz entra por dictado al input).

### Tradeoff de la combinación

- **Costo:** son **dos puntos de entrada** (palette + panel) y **un mecanismo de mover** (nudge + menú). Más superficie que un diseño "solo palette" o "solo panel". La pieza más riesgosa y costosa es el **parser NL en español**, con `es` marcado como **soporte parcial** por Chrono (https://github.com/wanasit/chrono) y sin datos públicos de frases argentinas (**no verificado**). Por eso el parser nunca guarda solo: siempre abre el panel con borrador editable.
- **Beneficio:** esa duplicación es lo que cubre a la vez teclado, lector de pantalla, touch y power users, y es lo que satisface **2.1.1** (teclado) **y 2.5.7** (single pointer sin arrastre) — dos requisitos que un solo mecanismo no cubre.
- **Si hay que recortar:** cortar primero la **palette**. El **panel + nudge + menú "Mover a…"** ya cubre teclado, SR y touch y cumple WCAG por sí solo; la palette agrega velocidad para power users, no cobertura. Fuentes de los criterios: https://www.w3.org/WAI/WCAG22/Understanding/keyboard · https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements

---

## Anexo: límites de esta investigación

- No probé las apps en vivo; todo sale de documentación oficial, notas de producto y reviews.
- **Sin verificar:** rendimiento del parsing NL en español rioplatense; existencia de un "duration stepper" in-place en calendarios de escritorio; long-press-to-create como patrón; etiqueta literal "When" en la UI actual de Google.
- El default de 1000 ms de `longPressDelay` es de **FullCalendar** (librería), no de Google/Apple.
