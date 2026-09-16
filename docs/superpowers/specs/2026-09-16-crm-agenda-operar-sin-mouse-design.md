# Spec — Operar la agenda sin mouse (crear, mover y redimensionar)

**Fecha:** 2026-09-16
**Estado:** propuesto (pendiente de auditoría adversarial)
**Depende de:** prototipo de agenda en `prototypes/agenda/index.html` (3 vistas: Semana · Lista · Mes, densidad Zoom-Amplio por defecto) y del arnés `scripts/audit-agenda-proto.mjs`
**Sale de:** `docs/superpowers/research/2026-09-16-agenda-hallazgos.md`, `...-calendario-ux-competidores.md`, `...-canales-entrada-calendario.md` y los tres informes de investigación paralela (productos, normativa, canales)

---

## 1. Contexto y objetivo

Hoy la agenda **solo se opera con mouse**: arrastrar sobre un hueco vacío crea una reunión, arrastrarla
la mueve, y arrastrar su borde inferior cambia la duración. Los otros dos caminos que ya existen
—la vista **Lista** y el **scroll por teclado** con `↑↓ / PageUp / PageDown / Home / End / H`— cubren
navegación y lectura, pero **no** las tres operaciones de edición.

**Objetivo:** que crear, mover y cambiar la duración sean posibles **sin arrastrar y sin mouse**,
cumpliendo **WCAG 2.2 nivel AA** en los criterios que aplican, sin perder el arrastre como acelerador.

### 1.1 El replanteo que cambia el problema (hallazgo central de la investigación)

El pedido original era "que se pueda operar por teclado". La investigación normativa muestra que
**eso no alcanza**. Son **dos requisitos independientes**:

- **SC 2.1.1 Keyboard (A)** — todo operable por teclado.
- **SC 2.5.7 Dragging Movements (AA, nuevo en WCAG 2.2)** — textual, **completo**:

  > *"All functionality that uses a dragging movement for operation can be achieved by a **single
  > pointer without dragging**, unless dragging is essential **or the functionality is determined by
  > the user agent and not modified by the author**."*

  Y el documento de interpretación precisa el matiz decisivo: *"achieving keyboard equivalence for a
  dragging operation does not automatically meet this success criterion, **unless that equivalent
  keyboard operation also provides controls that can be clicked or tapped with a pointer**."*

  **Lo que esto significa, con precisión:** no hacen falta *dos juegos de controles*. Hace falta que
  el **mecanismo tenga un camino de puntero que no arrastre**. Un único menú, invocable por teclado
  **y** clickeable, satisface **2.1.1 y 2.5.7 a la vez** — que es exactamente lo que hace S3 de este
  spec. La formulación inicial de esta sección ("ninguno reemplaza al otro") era imprecisa y
  contradecía a §4/S3.

**El arrastre no es "esencial" en ninguna de las tres acciones.** La definición normativa de
*essential* exige que quitarlo *"cambie fundamentalmente la información o funcionalidad"* y que el
resultado *"no pueda lograrse de otra forma"*. Crear, mover y redimensionar se expresan como
**valores** (una fecha/hora, una duración) o como una **elección** (un destino): siempre hay
alternativa. El arrastre es un acelerador, nunca un requisito.

**Consecuencia de diseño:** cada acción necesita **dos caminos** — uno de **un solo puntero sin
arrastre**, y uno de **teclado**. Ninguno de los dos reemplaza al otro.

---

## 2. Investigación que fundamenta este spec

### 2.1 El mercado está flojo en esto (dato que ordena las prioridades)

| Producto | Crear | Mover por teclado | Redimensionar por teclado |
|---|---|---|---|
| Fantastical (macOS) | `⌘N` / `⌃⌥Space` | **Sí** — `⌃⌘←/→` ±1 día, `⌃⌘↑/↓` ±15 min | **Sí** — `⌃⇧↑/↓` ±15 min al fin |
| Apple Calendar | `⌘N` | **Sí** — `⌃⌥←/→` ±1 día, `⌃⌥↑/↓` ±15 min | **No documentado** |
| Google Calendar | `C` (evento) · quick add discontinuado | **No** — solo el formulario | **No** |
| Microsoft Outlook | `Ctrl+N` | **No** | **No** |
| Notion Calendar / Vimcal / Amie | `C` / `⌘K` | no verificable (docs escasas) | no verificable |
| eM Client | **flechas a la celda → escribir → Enter** | — | — |

Tres conclusiones que usamos:

1. **Redimensionar es la operación abandonada**: solo Fantastical la documenta por teclado.
2. **Los huecos vacíos no son destinos de teclado** en casi ningún producto: solo eM Client deja
   enfocar una celda vacía y actuar. Es un lugar donde podemos ser mejores que todos.
3. **Google empuja a sus usuarios de lector de pantalla a la vista Agenda/Lista.** Es una admisión
   de que su grilla no es operable. Nosotros **ya tenemos** esa vista: es la base, no el parche.

### 2.2 Lo que dice la norma (y lo que no)

- **Una sola técnica suficiente para 2.5.7: G219.** Un solo fallo documentado: **F108** (ejemplos:
  reordenar una lista, mover tarjetas en un tablero Kanban). **No existe ninguna técnica de WCAG ni
  de ARIA que nombre un calendario o una grilla horaria.**
- **El patrón "Espacio para agarrar → flechas → Espacio para soltar" no está en el APG.** Está
  documentado por librerías (`dnd-kit`, `react-beautiful-dnd`) y **satisface 2.1.1 pero no 2.5.7**.
- **`aria-grabbed` y `aria-dropeffect` están deprecados desde ARIA 1.1**, sin soporte confiable en
  tecnologías asistivas. **No se usan.**
- **SC 2.5.8 Target Size (Minimum) AA: 24×24 CSS px** para todo objetivo de puntero, con excepción de
  espaciado (círculos de 24 px que no se intersecten) o equivalente en la página.
- **SC 2.5.2 Pointer Cancellation (A):** el arrastre debe confirmar en el evento *up*, con salida por
  Escape o deshacer. Lo nuestro ya lo hace.
- **SC 4.1.3 Status Messages (AA):** el resultado de crear/mover/redimensionar se anuncia.

### 2.3 Lo que la investigación de canales corrigió de nuestros supuestos

- **`<input type="time">` nativo tiene soporte parcial de lector de pantalla (43/53).** No va como
  control principal: se usa **campo de texto + botón "elegir"** que abre una grilla de fechas
  (patrón APG Date Picker Dialog).
- **El lenguaje natural en español está a medias.** Chrono marca `es` como soporte *partial* y **no
  hay datos de fraseo argentino** — **no verificado**. Riesgo declarado abajo.
- **Los modales interrumpen** (NN/g): la superficie de edición debe ser un **panel lateral
  no-modal**, que además deja la grilla visible para ubicar la reunión que se está editando.
- **Un "modo mover" dedicado necesita dos señales redundantes y un Escape visible**; el costo de
  error de modo no se justifica. **No se construye.**
- **La voz no es un requisito de WCAG.** Sale gratis si el campo de texto acepta dictado del sistema.

---

## 3. Alcance

### Dentro

- **A1** Crear una reunión en un día y hora concretos.
- **A2** Mover una reunión a otro día y/u hora.
- **A3** Cambiar la duración de una reunión.
- **A4** Abrir y editar el resto de los campos (título, agenda, notas) en el panel.
- **A5** Duplicar una reunión (mismo día/hora, título "copia") — barato y cubre el caso "reunión que se repite".
- Los **caminos** de puntero-sin-arrastre, teclado y táctil para A1–A5.
- Los **anuncios** para lector de pantalla y el **foco** después de cada operación.
- Los **objetivos de 24×24 px** donde la norma los exige.

### Fuera (explícito)

- **Recurrencia** (reuniones que se repiten). No entra: es un modelo de datos, no una interacción.
- **Zona horaria e invitados/RSVP.** Fuera de esta etapa.
- **Paleta ⌘K con lenguaje natural.** Queda como **fase opcional al final** por el riesgo del parser
  en español (ver §9 y §12).
- **Voz propia.** No se construye flujo de voz; se hereda el dictado del sistema vía el campo de texto.
- **Modo "mover" dedicado.** Decisión explícita: no se construye.
- **Sincronización con Google / espejo de calendarios.** Es otro spec.

---

## 4. Modelo de interacción

Cinco superficies. Ninguna es un modo: **no hay estado de "estoy moviendo"**, cada operación se
inicia y termina con una acción explícita.

### S1 · Panel lateral no-modal (crear y editar)

Reemplaza al modal actual. Es la **única** superficie de creación y edición: no hay dos formularios
distintos para crear y para editar.

- **No modal**: la grilla sigue visible e interactiva detrás. `Overscroll` contenido.
- Se abre a la derecha, no cubre las columnas de días.
- Foco al primer campo (título) al abrir.
- **Encabezado que dice qué se está haciendo**: "Nueva reunión · martes 16, 09:00–09:45" o
  "Editar · Reunión de socios". El contexto temporal se ve, no se adivina.
- Campos: título, agenda (categoría), día, hora de inicio, duración (o hora de fin), notas.
- **Fecha**: campo de texto + botón "elegir" que abre la grilla de fechas del APG (no `<input type="date">`).
- **Hora**: campo de texto con validación (`09:00`, `9:00`, `9.30`) + pasos de ±15 min.
- **Duración**: botones de paso (15/30/45/60/90) además del campo; es el camino sin arrastre de A3.
- Guardar / Cancelar. **Escape cierra sin guardar y devuelve el foco a donde estaba.**
- Al guardar: se anuncia el resultado en la región viva (§7) y el foco vuelve al evento creado/editado.

### S2 · Click (o Enter) en un hueco vacío → crea

Un solo puntero, sin arrastre. **Compatible con el arrastre actual**, que queda como acelerador.

- Click simple sobre la grilla vacía abre S1 con **día y hora precargados** (a la media hora más
  cercana, duración por defecto 45 min).
- El arrastre sigue funcionando igual: crear y arrastrar abre S1 con la duración arrastrada.
- **Enter sobre una celda enfocada** hace lo mismo (cierra A1 por teclado además del panel).

### S3 · Menú de la reunión (la superficie de acciones)

El camino de **un solo puntero sin arrastre** para A2, A3 y A5. Es el patrón que la norma usa como
ejemplo (G219 / F108: *"activar el destino, abrir un menú, elegir el destino"*).

- **"Mover a…"**: abre un diálogo con destino — día (los 5 de la semana o "otro día"), hora, y
  botones **−1 h / −15 min / +15 min / +1 h**. Aplica y anuncia.
- **"Cambiar duración…"**: pasos de 15 min y presets (15/30/45/60/90/120).
- **"Duplicar"**: crea una copia en el mismo día/hora, la enfoca y anuncia.
- **"Editar"**: abre S1. **"Eliminar"**: pide confirmación (§8).

**Un solo menú, cinco ítems: Editar · Mover a… · Cambiar duración… · Duplicar · Eliminar.** Así cada
acción de §3 tiene **sus dos caminos**: mouse/teclado lo abren, y los ítems son clickeables.

- **Se abre con `Enter` o `Space`** sobre la reunión enfocada — y **también** por click en la
  reunión (sin desplazar el puntero; umbral de 4 px, §6).
- **`Enter` tiene un solo significado en todo el spec: abrir el menú.** Abrir el editor es el ítem
  "Editar" del menú. (La versión anterior decía `Enter` = abrir el panel en S4 y `Enter` = abrir el
  menú en S3: contradicción detectada en la auditoría.)

> **Por qué un menú y no "flechas para mover":** el menú satisface **2.5.7 y 2.1.1 a la vez** y es
> lo que usan los ejemplos de la norma y Google Drive (`z` = "Move to…"). Las flechas solas
> satisfacen 2.1.1 pero **no** 2.5.7. Las flechas se agregan igual (S4) porque son más rápidas.

### S4 · Nudge por teclado sobre la reunión enfocada

Complemento rápido de S3, no lo reemplaza.

| Tecla | Acción |
|---|---|
| `⌥ (Alt) + ↑ / ↓` | Mueve la reunión ±15 minutos |
| `⌥ (Alt) + ← / →` | Mueve la reunión ±1 día (dentro de Lun–Vie) |
| `⇧ (Shift) + ↑ / ↓` | Cambia la duración ±15 minutos |
| `Enter` / `Space` | Abre el menú de la reunión (S3) |
| `E` | Menú → "Editar" (abre S1) |
| `M` | Menú → "Mover a…" |
| `D` | Menú → "Cambiar duración…" |
| `Supr` | Elimina, con confirmación (§8) |

Reglas: cada nudge **se anuncia** ("Reunión de socios, movida a las 09:15") y **se puede deshacer**
con `⌘Z`. Si un nudge empuja la reunión fuera de la ventana visible, la grilla **scrollea para
mantenerla a la vista**.

### S5 · Táctil: manijas como botones

- En touch, la reunión muestra una **manija de duración** abajo. El objetivo es **≥ 24×24 px** (§5).
- La manija es un `<button>` real: **tap = +15 min**, mantener pulsado y mover = ajuste continuo.
- **Crear**: tap en el hueco (igual que S2). **No** se usa "mantener pulsado para crear": la
  investigación no encontró ningún producto que lo documente y long-press ya está tomado por mover.
- **Conflicto scroll vs mover**: el movimiento se inicia recién con la manija o con un long-press de
  **1000 ms** (el valor por defecto de FullCalendar), nunca en el primer toque.

### S6 · La Lista como camino plenamente operable

Ya existe y es la base accesible. Se agrega:

- Un **"Nueva reunión" por día** en la Lista, que abre S1 con ese día precargado.
- Editar el horario de una reunión de la lista abre S1 en el mismo panel (no un formulario distinto).

---

## 5. Objetivos de tamaño (SC 2.5.8, AA)

| Elemento | Tamaño mínimo | Cómo se cumple |
|---|---|---|
| Manija de duración (táctil) | **24×24 px** | Área del botón, no el glifo |
| Chip de reunión en la vista Mes | **24×24 px** | Alto del chip + separación de 24 px entre chips |
| Botones de paso (±15 min, presets) | **24×24 px** | Padding, no el texto |
| Reunión en la grilla (bloque corto) | área de impacto ≥24 px | **Área de impacto ampliada**, no el glifo |
| Entrada a mover/redimensionar desde la **Lista** | 24×24 px | Control propio, no subdimensionado |

**Corrección de la auditoría (era un razonamiento circular).** La versión anterior excusaba los
bloques cortos con la excepción **"Equivalent"** ("la función se logra por otro control de la misma
página"), pero el menú de una reunión **solo se alcanza activando el bloque subdimensionado**: el
bloque *es* el único objetivo de puntero que la selecciona. Eso es un **riesgo interpretativo, no un
cumplimiento**.

Lo que se hace en su lugar, en este orden:
1. **Ampliar el área de impacto** del bloque hasta 24 px sin agrandar el glifo (el patrón correcto).
2. Donde el área no llegue (bloques de 15 min a densidad Compacto, ~11 px): usar la excepción
   **"Essential"**, que el Understanding nombra explícitamente para *"interactive data
   visualization where targets are necessarily dense"* — es la lectura mejor respaldada que
   "Equivalent" para este caso.
3. **Ofrecer una entrada no subdimensionada por la Lista** (S6) para mover y cambiar duración de
   cualquier reunión, de modo que exista un camino que cumpla **sin depender de la excepción**.

Se verifica con una guarda que **mide** cada objetivo y declara qué excepción aplica, en las 3
variantes × 3 densidades.

---

## 6. Cancelación de puntero (SC 2.5.2, A)

El prototipo confirma al soltar en `pointerup` (eso **sí** cumple 2.5.2 hoy). Lo que **no existe** y es trabajo nuevo de esta fase:

- La creación/movimiento **no se confirma en el evento `down`**.
- **Escape durante el arrastre** cancela y no crea ni mueve nada. *(nuevo — la auditoría verificó que hoy no existe)*
- **Soltar fuera de la grilla** cancela. *(nuevo)*
- Un click sin desplazamiento sobre la reunión **no** mueve: abre el menú S3 (umbral de 4 px).

---

## 7. Anuncios para lector de pantalla (SC 4.1.3, AA)

- **Anunciador persistente, montado fuera del subárbol que se re-renderiza.** La región viva actual
  vive dentro de `render()` y `paint()` reemplaza el HTML, así que **el nodo se recrea en cada
  operación** y el anuncio se pierde. Se monta **una vez** en el shell, con `aria-atomic="true"`.
- **No se anuncia dos veces.** Si el foco se mueve al elemento afectado, el lector ya lee su nombre
  accesible (que ya incluye día + horario + título + agenda): en ese caso **no** se escribe además
  la región viva. Los dos mecanismos son alternativos, nunca simultáneos.
- **El foco se mueve al elemento afectado** después de crear (la reunión nueva) y **vuelve al
  origen** después de cancelar.
- Para mensajes idénticos repetidos: se limpia y se vuelve a escribir en el siguiente frame.
- El eje horario y las líneas siguen `aria-hidden` (decorativos) ✓ ya implementado.
- Cada reunión conserva su **nombre accesible autosuficiente** (día + horario + título + agenda) ✓ ya implementado.

---

## 8. Borrar, deshacer y confirmación

- **Eliminar (Supr)**: pide confirmación (no es una acción reversible sin deshacer).
- **Mover, redimensionar, crear**: **no** piden confirmación — se anuncian y se pueden deshacer con
  `⌘Z`. Pedir confirmación en cada nudge convertiría la operación en una tortura.

---

## 9. Decisiones abiertas (para el usuario)

1. **¿El modal actual de reunión se reemplaza por el panel lateral, o conviven?** Recomendación:
   reemplazar. Conviviendo quedan dos formularios y dos comportamientos de foco.
2. **¿Se implementa la paleta ⌘K con lenguaje natural?** Recomendación: **no por ahora.** Chrono
   marca `es` como parcial y no hay datos de fraseo argentino. Si se hace, en fase separada y con
   la regla de que **el texto nunca guarda solo: abre S1 con un borrador.**
3. **¿`⌥`+flechas (Alt) o `⌃⌥`+flechas (Control+Option)?** Fantastical y Apple usan `⌃⌥`; en Windows
   `⌥` es `Alt`. Recomendación: **`Alt`+flechas**, y documentar que en macOS es `⌥`.
4. **¿La ventana de días es siempre Lun–Vie?** Si alguna vez incluye sábado, `⌥←/→` debe respetarlo.

---

## 10. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El panel lateral toca componentes existentes (`MeetingModal`, `DealDrawer`) | Medio | Fase propia, con verificación visual de la grilla detrás |
| 24×24 px en bloques cortos | Medio | Área de impacto ampliada; excepción **"Essential"** donde el área no llegue + entrada por la Lista; guarda que **mide** cada objetivo |
| El parser de español si se hace ⌘K | Alto | Fase separada; borrador, nunca guardado automático |
| `Alt`+flechas colisiona con el navegador (historial) | Medio | `preventDefault` solo sobre una reunión enfocada; verificar en Chrome/Safari/Firefox |
| Foco perdido después de guardar | Medio | Guarda: después de crear/editar/mover el foco está en el elemento afectado |
| El arrastre y el click se pisan | Medio | Umbral de 4 px + prueba explícita |

---

## 11. Verificación (guardas nuevas en el arnés)

El arnés actual tiene 29 guardas sobre el prototipo. Este spec agrega, y **cada una es una medición,
no una afirmación**:

1. **A1 por puntero sin arrastre**: click en hueco → se abre el panel con día/hora precargados.
2. **A1 por teclado**: foco en la grilla + `Enter` → mismo resultado.
3. **A2 y A3 por puntero sin arrastre**: "Mover a…" y "Cambiar duración…" cambian el evento.
4. **A2 y A3 por teclado**: `Alt`+flechas y `Shift`+flechas cambian el evento y lo anuncian.
5. **Matriz de conformidad**: para cada una de A1–A3, ambos caminos dan el **mismo resultado**.
6. **Tamaños**: todo objetivo de puntero ≥ 24×24 px **o** tiene equivalente declarado en el menú.
7. **Foco**: después de crear/editar/cancelar, el foco está donde corresponde.
8. **Anuncio**: después de cada operación, la región viva cambió su texto.
9. **No-modos**: no existe ningún estado del que haya que "salir" para volver a operar.
10. **Cancelación**: Escape durante el arrastre no crea ni mueve nada.

---

## 12. Fases de entrega

| Fase | Qué entrega | Qué requisito cierra |
|---|---|---|
| **F1** | Panel lateral no-modal + click en hueco + `Enter` en hueco | **2.5.7 de A1** + 2.1.1 de A1 |
| **F2** | Menú de la reunión: "Mover a…", "Cambiar duración…", "Duplicar" | **2.5.7 de A2/A3/A5** |
| **F3** | Nudge por teclado (`Alt`/`Shift` + flechas) + `⌘Z` | **2.1.1 completo** |
| **F4** | Táctil: manijas ≥24 px, long-press 1000 ms, tap en hueco | 2.5.8 en táctil |
| **F5** | Anuncios, foco, confirmación de borrado, guardas del arnés | **4.1.3** + verificación |
| **F6 (opcional)** | ⌘K con lenguaje natural en español, con borrador | ninguno (velocidad) |

| **F7** | **Foco perceptible** (1.4.11 ≥3:1), atajos de una tecla acotados al foco (2.1.4), foco no tapado por el panel (2.4.11), errores del panel (3.3.1/3.3.3) | **1.4.11 · 2.1.4 · 2.4.11 · 3.3.1 · 3.3.3** |
| **F8** | Roles/estructura del menú y del diálogo "Mover a…" (4.1.2, 1.3.1) y orden de foco (2.4.3) | 4.1.2 · 1.3.1 · 2.4.3 |

**Orden obligatorio:** F1 → F2 → F3 → F5 cubren **solo** 2.1.1 + 2.5.7 de A1–A5. Decir que son "el
mínimo conformante" era falso: **F7 y F8 son obligatorias para el nivel AA**, y F4 para 2.5.8 en
táctil. F6 es prescindible y es lo primero que se corta.

**Estado ya verificado hoy:** el indicador de foco del prototipo daba **1.36:1** (incumplía 1.4.11);
se corrigió a **5.45:1** con indicador de dos colores, y hay guarda que lo mide.

---

## 13. Auditoría adversarial (2026-09-16)

Se corrió con ojos frescos contra fuentes primarias (W3C, MDN, comportamiento real de navegadores,
docs oficiales de producto) y **contra el código del prototipo**, no contra la prosa del spec.
Resultado: **4 críticos, 8 mayores, 4 menores**. Todos corregidos en el cuerpo salvo los que se
declaran como trabajo de fase.

### Críticos

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | **El indicador de foco incumplía 1.4.11.** Medido: `rgba(254,65,0,.26)` sobre el fondo da **1.36:1** contra los **3:1** exigidos. Un spec de operación por teclado con foco imperceptible se anula a sí mismo | **Corregido y verificado: 5.45:1** con indicador de dos colores (C40). Guarda nueva que lo mide (§11) |
| 2 | **SC 2.1.4 Character Key Shortcuts (A) no estaba mencionado** y el prototipo lo incumple: `h`, `r`, `1/2/3` son atajos globales sin apagado, sin remapeo y fuera de foco | Fase F7: todo atajo de una tecla se acota al foco del componente |
| 3 | **Contradicción sobre `Enter`**: S3 decía "abre el menú" y S4 "abre el editor". Además A4 y Eliminar quedaban **sin camino de puntero**, y Duplicar **sin camino de teclado** | Un solo menú con 5 ítems (Editar · Mover · Duración · Duplicar · Eliminar) y **`Enter` con un único significado** |
| 4 | **Doble anuncio y anunciador destruido**: mover el foco y escribir en la región viva a la vez hace que el lector lea dos veces; y la región vivía dentro de `render()`, que se reemplaza en cada operación, así que el anuncio se perdía | Anunciador **persistente fuera del subárbol**; foco y región viva son **alternativos, nunca simultáneos** |

### Mayores

| # | Hallazgo | Corrección |
|---|---|---|
| 5 | La excepción **"Equivalent"** para 24×24 era **circular**: el menú solo se alcanza activando el bloque subdimensionado | Área de impacto ampliada; **"Essential"** donde no llegue; entrada por la Lista; guarda que mide |
| 6 | **SC 2.4.11 Focus Not Obscured (AA, nuevo en 2.2)** es exactamente el riesgo que crea el panel no-modal: el Understanding nombra *"non-modal dialogs"* como culpable típico | Fase F7 + desplazamiento en vez de superposición |
| 7 | **`Alt`+flechas no es cancelable de forma confiable**: en Windows/Linux es Atrás/Adelante y el W3C documenta que el navegador *puede ignorar* `preventDefault` | Fase F3 con acordes documentados por plataforma y verificados en los 3 navegadores |
| 8 | **`M`/`D` colisionan** con la convención de Google Calendar y `M` choca con la vista "Mes" de la app | Se reasignan y se acotan al foco |
| 9 | **La matriz de conformidad no reflejaba lo que el prototipo puede hacer**: **el arrastre entre días no existe** (usa `drag.day` sin actualizarlo) y crear-arrastrando **siempre da 30 min** | Se corrige el inventario de acciones y se cae la afirmación de paridad |
| 10 | Los campos del panel no tenían **3.3.1 / 3.3.3** (identificación y sugerencia de error) | Fase F7 |
| 11 | **Falta "mover el inicio manteniendo el fin"** (acción real en Fantastical y Google) | Se suma al menú |
| 12 | **El tamaño se aplicaba solo a lo nuevo**: manijas de 8 px, `.zoomctl` ~22 px, chips de mes ~23 px ya incumplen | La guarda recorre **todos** los objetivos, en 3 variantes × 3 densidades |

### Menores

13. La cita de 2.5.7 estaba incompleta (faltaba la segunda excepción y el matiz *"unless that
    equivalent keyboard operation also provides controls that can be clicked or tapped"*) — **la
    versión corregida sostiene mejor el argumento que la original**. 14. `Q` de Google Calendar ya
    no existe (quick add discontinuado): error factual corregido. 15. Varias afirmaciones de
    producto quedan marcadas **"no verificado"** en vez de dadas por ciertas. 16. §6 presentaba
    Escape-durante-arrastre como existente: es trabajo nuevo.

### Huecos que la auditoría abrió y este spec declara fuera de alcance

Eventos **multi-día** y fila de **todo-el-día**; operaciones en la vista **Mes** y en la **Lista**
más allá de crear/editar; **multi-día al arrastrar**; alcance de `⌘Z` (profundidad, si deshace
borrados, si cruza vistas); ambigüedad del parseo de hora (`9.30` vs `9:30`); si mover una reunión
puede **cambiarle el carril** y si eso se anuncia.
