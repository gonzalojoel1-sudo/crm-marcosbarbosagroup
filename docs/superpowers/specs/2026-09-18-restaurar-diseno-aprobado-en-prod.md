# Spec — Restaurar el diseño aprobado en `/hoy`

**Fecha:** 2026-09-18
**Estado:** propuesto
**Motivo:** el port a React **(F1–F5) entregó el comportamiento pero perdió el diseño**. El usuario lo reportó: "el resultado en prod no satisface y no se parece en nada a lo que habíamos decidido". Esta spec lo corrige.

**Autoridad del diseño:** `prototypes/agenda/index.html` — el prototipo aprobado. Su intención también está en `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md` (interacción) y `docs/superpowers/specs/2026-09-17-agenda-port-a-prod-design.md` (decisiones del port).

**Investigaciones que la fundamentan:**
- `docs/superpowers/research/2026-09-18-port-fidelidad-ui-prototipo-a-app.md` — por qué los ports pierden el diseño y cómo evitarlo
- `docs/superpowers/research/2026-09-18-visual-regression-prototipo-vs-react.md` — cómo **probar** que coincide
- **Auditoría forense** (en el reporte de la investigación anterior): tabla token por token prototipo vs app

---

## 1. Causa raíz (verificada, no supuesta)

**El port copió los tokens actuales de la app en vez de los del prototipo.** El `:root` del prototipo trae la paleta aprobada, más cálida; `apps/web/src/styles.css` tiene hoy valores **más fríos y oscuros**. El prototipo tiene un comentario que dice que espeja `styles.css` — pero `styles.css` **derivó después**. El port tomó lo segundo:

| token | prototipo (aprobado) | app (lo que se ve) |
|---|---|---|
| `--bg` | `#100f0d` | `#0c0c0e` |
| `--surface` | `#171614` | `#141417` |
| `--surface-2` | `#1d1b18` | `#1a1a1f` |
| `--fg` | `#f4f1ea` | `#f2f0eb` |
| `--danger` | `oklch(0.66 0.155 28)` | `#ff5a5a` |
| `--ok` | `#0d7c66` | `#34d399` |

Es el fallo que la investigación nombra como "re-tinte aburrido / fuera de gamut": **re-derivar en vez de llevar**.

**Y tres pérdidas silenciosas, que son las que más se ven:**

1. **Fraunces nunca se carga.** El shell carga **solo Outfit** (`gen-shell.mjs`). `var(--display)` no existe en la app, así que el título de la semana —el rol tipográfico que más identidad da— cae a Outfit sin ningún aviso.
2. **JetBrains Mono tampoco**, y la app lista `ui-monospace` **primero**: los horarios y los datos se dibujan con la mono del sistema operativo, nunca con la de la marca.
3. **La barra lateral izquierda entera y el mini-mes no existen en el port**: se perdieron *Agendas* (con contadores por vertical y toggle), *Origen* (CRM / Reserva web / Google), *Buscador*, el mini-mes de Septiembre y la leyenda **"Cómo se lee"**. Es la pérdida estructural más grande.

**Lo que NO fue culpa del port (para no perseguir fantasmas):** la paleta de las 5 categorías se copió **byte por byte** ✓; sus contrastes (4.606:1 y 4.616:1) vienen del prototipo y cumplen AA.

## 2. La decisión que evita que se repita

**D1 · El `:root` del prototipo es el único artefacto de tokens.** Se extrae a un archivo versionado (`apps/web/src/agenda/tokens.css`) que la app **consume tal cual**, sin re-tipear valores. Además Stylelint **prohíbe valores crudos** en los módulos de la agenda: hex/rgb/hsl (colores), `font-family`, `border-radius`, `box-shadow` y `transition`/easing. **Las excepciones son solo valores para los que el prototipo NO define token**, y están listadas acá (`apps/web/.stylelintrc.cjs` las implementa una por una):
  - **Colores:** `#fff` (texto sobre el bloque sólido, `index.html:207`) y `#141417` (base del `color-mix` del fantasma, `index.html:1679`); y los `rgba(...)` de grilla/sombra/hover: `rgba(0,0,0,.85)` foco, `rgba(0,0,0,.38)` y `rgba(255,255,255,.16)` sombra del bloque, `rgba(255,255,255,.55)` asa, `rgba(255,255,255,.09)` borde de columna, `rgba(244,241,234,.022)` columna de hoy, `rgba(244,241,234,.12)` línea de hora, `rgba(255,255,255,.05)` borde de celda del Mes, `rgba(254,65,0,.055)` celda de hoy, `rgba(255,90,90,.2)` hover del confirm. El prototipo no tokeniza ninguno.
  - **Radios:** el único tokenizado es `--r` (12px); el resto son literales del prototipo sin token: `3px`, `4px` (anillo de foco, `index.html:54`), `5px`, `6px`, `7px`, `8px`, `9px`, `10px`, `14px` (`index.html:72`), `50%` y `999px`.
  - **Sombras:** `--shadow` es la única tokenizada; quedan sin token la del bloque, la del foco, el `inset` del fantasma y el de la celda de hoy.
  - **`font-size` y duraciones de `transition`:** el prototipo **no define ningún token**, así que D1 no los cubre (no es una omisión: es que no hay token contra el cual compararlos). `px` es legítimo: los tokens son px.
  - **Colores en estilos inline de TSX:** no hay ninguno; los bloques/chips pintan con `categoryOf(...).color`, que la guarda verifica byte por byte contra el `CATS` del prototipo (sección c).
  La investigación lo dice derecho: mientras los valores se puedan re-escribir a mano, van a volver a derivar.

  **Actualización (ronda de fidelidad):** el `:root` del prototipo define `--ease: cubic-bezier(.23,1,.32,1)`, pero **ninguna transición del prototipo lo usa**: todas llevan el literal `ease-out` (`index.html:83,111,128,204,290,313`). El easing de la agenda es `ease-out`; `--ease` queda solo como token extraído del `:root` y **no se deriva de él**. Tokens acotados: `tokens.css` las define en `[data-agenda]`, no en `:root`, para que la paleta cálida no re-vista el resto del CRM (fuga que la comparación visual detectó). El fondo del bloque ocupado (`#211f1b`), su texto (`rgba(244,241,234,.55)`) y su sombra se agregaron al `:root` del prototipo como `--busy-bg` / `--busy-fg` / `--busy-shadow` y se extraen como cualquier token.

**D2 · La agenda se separa del CSS global — sin exagerar la garantía.** El CSS de la app son ~3.300 líneas **globales sin scope**, y el CSS sin capas le gana a `@layer`. Se usa **CSS Modules + `[data-agenda]` como raíz**, pero **esto NO es encapsulamiento**: los nombres de clase se conservan sin hashear (la guarda de fidelidad y los E2E consultan `.agx-*`, y los nombres del prototipo son parte de lo que se copia), así que una regla global `.agx-*` **igual matchea** el elemento; `[data-agenda]` solo la hace perder por especificidad frente a la misma propiedad, y **no** frena selectores de elemento ni clases globales de mayor especificidad — la fuga de `.empty` (una regla global que rompía la celda del Mes) lo probó: se arregló **borrando la clase**, no con el scope. La garantía real es más simple y por eso se verifica: **`styles.css` no define ninguna regla `.agx`** y **ningún archivo de la agenda importa `styles.css`**; `scripts/check-agenda-fidelity.mjs` (secciones e/f) falla si eso se rompe, y corre en el build/lint. (Se descarta Shadow DOM: garantiza más pero cuesta caro en React.)

**D3 · La fidelidad se PRUEBA, no se opina.** Playwright puede sacar la **golden del prototipo** y comparar la app contra ella con `toHaveScreenshot` y un `snapshotPathTemplate` compartido. Requiere migrar a `@playwright/test`. **El enemigo no es el diff, son los datos y el reloj**: el prototipo tiene eventos fijos y `/hoy` tiene los reales, así que hay que sembrar el mismo fixture y congelar el reloj (`page.clock.setFixedTime()`). Se corre **a demanda** (no un CI permanente: para un solo usuario sería sobre-ingeniería, y la investigación lo dice sin vueltas).

  **Cómo se corre.** `npm run fidelity:visual:golden` (en `apps/web`) genera la golden **desde el prototipo** —las tres vistas, variante `?v=3` con densidad Amplio— en `apps/web/e2e/__screenshots__/`; esa carpeta **se commitea**, porque es el diseño aprobado hecho píxel y una baseline versionada hace reproducible la comparación. Después `npm run fidelity:visual` construye la app y la compara contra esa golden. El fixture `apps/web/e2e/fixtures/agenda.json` espeja las reuniones del prototipo y se siembra con un mock de `get_agenda` (`page.route`); el reloj se congela en `2025-09-16 15:42`; el chrome de cada punta (nav del CRM / selector del prototipo) se oculta y la captura espera `document.fonts.ready` con `animations: "disabled"`. **Qué prueba:** que la app renderiza el mismo armazón visual (geometría, densidad, tipografía, paleta, estructura). **Qué NO prueba:** interacción (eso es E2E) ni datos con longitudes arbitrarias. Los valores elegidos (`maxDiffPixels: 0`, `threshold: 0.2` default) y la corrida de referencia están en el reporte de la task.

**D4 · Las mejoras del port se conservan.** No todo lo distinto es pérdida. Se mantienen: la fila de **todo el día**, la **franja de tareas**, el **paginador** prev/next, la **validación en línea** del panel, las **teclas visibles** en el menú, el **asa de redimensionar** visible, la línea de "ahora" anclada a la columna de hoy real, y los chips del Mes no interactivos (honestos, porque las operaciones del Mes están fuera de alcance).

**D5 · `busy`/origen se derivan de un dato real; lo que falta se declara.** El modelo ya expone el origen de lo importado con el campo **nativo** `Event.pulled_from_google_calendar`: el DTO de `get_agenda` agrega `origin` (`"Google" | "CRM"`) y `busy` (solo lectura), y la UI renderiza los importados como bloque/fila de solo lectura (sin menú, sin arrastre, sin color de agenda), los cuenta en *Origen* y agrega la fila **"Ocupado (de Google)"** a la leyenda. **Divergencias declaradas, no olvidos:**
  - **"Reserva web" no tiene campo en el modelo.** Ninguna reserva web se distingue hoy de una reunión creada en el CRM (el `source` del lead lo escribe el sync legacy, no el canal). Su contador queda en **0** y su toggle no filtra nada; se deja de mentir sobre una discriminación que el dato no tiene.
  - **El sync pendiente no se expone.** El contador/indicador de "¿nuestra escritura llegó a Google?" mide un estado que el modelo no tiene: el chip de ventana se renderiza **sin** él y no se inventa un número.
  - **El fondo exacto del bloque ocupado (`#211f1b`) no está tokenizado** y D1 prohíbe re-derivar colores, así que se usa `--surface-2`; mismo criterio en Lista y en el swatch de la leyenda.

## 3. Lo que hay que restaurar, por impacto visual

| # | Qué | Detalle | Por qué importa |
|---|---|---|---|
| **1** | **Las tres tipografías** | Cargar `Fraunces:opsz,wght@9..144,300..600` y `JetBrains+Mono:wght@400;500` en `gen-shell.mjs` y en `index.html`; agregar `--display`/`--mono` al `:root`; `.agx-title` a Fraunces 23px/400/`-0.015em`/`optical-sizing`; **`"JetBrains Mono"` primero** en la pila mono | El título y **cada horario** — lo que más se ve |
| **2** | **Sidebar y mini-mes** | *Agendas* (5 verticales con contador y toggle real), *Origen* (CRM / Reserva web / Google), *Buscador*, mini-mes con puntos y estados, leyenda **"Cómo se lee"** (incluido "Ocupado (de Google)"), y el botón **Panel** | La pérdida estructural más grande |
| **3** | **Calentar la paleta** | Restaurar `#100f0d / #171614 / #1d1b18 / #f4f1ea`, `--danger`, `--ok` | Hoy la página se ve más oscura y fría que lo aprobado |
| **4** | **Estado vacío de la grilla** | Título, subtítulo y botón "Nueva reunión" | Sin él, una semana sin reuniones queda en blanco |
| **5** | **Movimiento y afordancias** | `transition` en los bloques + hover con sombra elevada, transiciones de sidebar/menú/lista, **sombra del encabezado al scrollear** (`data-scrolled`), y el bloque **`prefers-reduced-motion`** | El port no tiene **ninguna** transición: se siente muerto |
| **6** | **Categoría y Día en el panel** | Restaurado: el panel vuelve a tener *Agenda* y *Día*; `update_meeting` ya acepta `categoria` y el test de integración lo cierra de punta a punta | Funcionalidad perdida, no solo estética |
| **7** | **`Hoy · HH:MM` y el chip de ventana** | El botón Hoy mostraba la hora; el chip mostraba la ventana visible y los pendientes de sync | Orientación |
| **8** | **Scroll por teclado + skip link** | Restaurado: `↑/↓` media hora, `PageUp/PageDown` 0.9 del viewport, `Home/End` y `h` = ir a ahora en la grilla; y el skip link "Saltar a la grilla" | Era parte de "operar sin mouse" |
| **9** | **Bloques de Google de solo lectura + origen** | Decidido y registrado en **D5**: `origin`/`busy` desde `pulled_from_google_calendar`, solo lectura + leyenda; "Reserva web" y sync pendiente **declarados** (el dato no existe, no se inventa) | Semántica: lo importado no se edita |
| **10** | **Craft menor** | Etiqueta "Nueva reunión" + aviso **"· se superpone"** en el fantasma del arrastre; `data-densa`; base 14px/1.45; selección `rgba(254,65,0,.22)`; radio del panel 14px; anillo de foco radio 4px; borrar los `#a0431c` sueltos | Detalles que suman al conjunto |

## 4. Fases

| Fase | Qué entrega | Verificación |
|---|---|---|
| **R1 · Tokens y tipografía** | D1: `tokens.css` extraído del prototipo y consumido; las tres fuentes cargadas y aplicadas; D2: scope `[data-agenda]` + CSS Modules | Comparación visual a demanda (D3) sobre las tres vistas: **0 diferencias** en tipografía y color; el título en Fraunces y los horarios en JetBrains **verificados por fuente computada**, no a ojo |
| **R2 · Estructura** | La sidebar completa (Agendas con toggle real, Origen, Buscador), el mini-mes con la leyenda, el botón Panel | El toggle de agendas **filtra de verdad**; el conteo por vertical coincide con los eventos visibles |
| **R3 · Paleta y estados** | Paleta cálida restaurada, estado vacío, `Hoy · HH:MM`, chip de ventana, selector de vista y densidad | Contraste de bloques ≥4.5:1 **medido**, foco ≥3:1, y el diff visual contra el prototipo sin desvíos de color |
| **R4 · Movimiento y craft** | Transiciones, hover elevado, sombra del encabezado, `prefers-reduced-motion`, y los 10 detalles de craft | Con `prefers-reduced-motion`, **medido**: ninguna transición activa |
| **R5 · Lo funcional que falta** | Categoría y Día en el panel (con el soporte de API), scroll por teclado, skip link, y la decisión sobre `busy`/sync | Categoría editable de punta a punta; el scroll por teclado medido con un recorrido real |
| **R6 · La prueba permanente** | D3: `@playwright/test` con la golden del prototipo, fixture sembrado y reloj congelado, corriendo a demanda | Una corrida que diga, por vista, cuántos píxeles difieren y dónde |

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Volver a re-derivar valores** | D1 con Stylelint prohibiendo valores crudos. Es el riesgo central de esta spec |
| El CSS global de la app pisando la agenda | D2 con `[data-agenda]`; recordar que el CSS **sin capas gana** sobre `@layer` |
| La comparación visual da ruido y se abandona | Fixture sembrado + reloj congelado + `animations: "disabled"`; comparar contra la golden del prototipo, no entre corridas |
| Restaurar la sidebar rompe el layout de 3 columnas en pantallas chicas | El prototipo ya resuelve el plegado por ancho; copiar su comportamiento |
| Tocar `styles.css` (compartido con el resto del CRM) | La agenda **no** se estiliza desde ahí: sus estilos van en sus módulos. Solo los tokens compartidos se ajustan, y con el diff visual como prueba |
| El trabajo se hace por partes y se pierde el hilo | Cada fase tiene su verificación y su commit; la golden del prototipo es el árbitro |

## 6. Lo que NO entra

Recurrencia, invitados, recordatorios, colores por evento, táctil, operaciones en el Mes, deshacer (`⌘Z`), la paleta ⌘K en español, y notificaciones por email (no hay SMTP). Y **no se re-diseña nada**: el prototipo es la autoridad y esta spec restaura, no reinterpreta.
