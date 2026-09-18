# Restaurar el diseño aprobado en `/hoy` — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `crm.marcosbarbosagroup.com/hoy` **se vea como el prototipo aprobado** — tipografía de marca, paleta cálida, sidebar y mini-mes, movimiento — y que **sea imposible volver a perderlo en silencio**.

**Architecture:** el `:root` de `prototypes/agenda/index.html` deja de ser una copia y pasa a ser **la fuente mecánica** de los tokens: un script lo extrae a `apps/web/src/agenda/tokens.css` (archivo generado, no editable) y una guarda **falla** si los dos divergen. La tipografía se verifica por **fuente computada** y por `document.fonts.check()`, no mirando capturas — porque el fallo real fue un *fallback* silencioso que ninguna captura delata. La agenda se aísla del CSS global con CSS Modules y un `[data-agenda]` como raíz. La fidelidad se **prueba** con una comparación visual contra la golden del prototipo.

**Tech Stack:** React 18 + TypeScript + Vite (`apps/web`); Frappe v15 para el shell (`gen-shell.mjs`, `www/hoy.html`); `@playwright/test` para la comparación visual; Stylelint para prohibir valores crudos.

**Spec:** `docs/superpowers/specs/2026-09-18-restaurar-diseno-aprobado-en-prod.md` — **leerla antes de empezar**. Su §1 es la causa raíz y su §3 la lista de lo que hay que restaurar.

**Investigaciones:** `2026-09-18-port-fidelidad-ui-prototipo-a-app.md` (por qué los ports pierden el diseño) y `2026-09-18-visual-regression-prototipo-vs-react.md` (cómo probarlo).

---

## Global Constraints

- **El prototipo es la autoridad.** Ante cualquier duda de valor, comportamiento o detalle: `prototypes/agenda/index.html`. **No se re-diseña ni se reinterpreta.**
- **Prohibido re-derivar valores.** Ningún color, familia tipográfica, tamaño, radio, sombra ni easing puede escribirse crudo en los archivos de la agenda: todo sale de `tokens.css`, que es **generado**. Un valor nuevo ⇒ se agrega al prototipo y se re-extrae.
- **La tipografía se verifica por fuente computada**, no visualmente. El título de la semana **tiene que** computar `Fraunces`; los horarios **tienen que** computar `JetBrains Mono`. Un `fallback` silencioso es el defecto exacto que esta spec existe para matar.
- **El CSS de la app no toca la agenda.** La agenda se estiliza desde sus propios módulos, con `[data-agenda]` como raíz. Ojo: el CSS **sin capas gana** sobre `@layer`.
- **Las mejoras del port se conservan** (spec §2/D4): fila de todo el día, franja de tareas, paginador, validación en línea, teclas visibles del menú, asa de redimensionar visible, línea de ahora anclada a hoy, chips del Mes no interactivos.
- **Accesibilidad ya verificada y no degradable:** contraste de bloques ≥4.5:1, indicador de foco **5.45:1**, líneas de grilla 1.339:1/1.235:1, texto ≥11 px, controles ≥24×24 px.
- **Prohibido:** `role="grid"`, `aria-grabbed`, `aria-dropeffect`, `transition: all`, controles que nombran una acción y no la hacen.
- **La regla de alternancia foco/anuncio** se mantiene: si el foco cambia, no se anuncia; si no puede cambiar, se anuncia. La excepción es eliminar.
- Español (Argentina), voseo. Comentarios solo para el *por qué* no obvio.
- **Verificación por tarea**: typecheck + build verdes, y las guardas nuevas **medidas**, no afirmadas.

## Estructura de archivos

| Archivo | Responsabilidad | Estado |
|---|---|---|
| `apps/web/src/agenda/tokens.css` | **Generado** desde el `:root` del prototipo. Único lugar donde viven los valores | **Crear** (generado) |
| `scripts/extract-agenda-tokens.mjs` | Extrae el `:root` del prototipo y escribe `tokens.css`; con `--check` compara y falla si divergen | **Crear** |
| `scripts/check-agenda-fidelity.mjs` | Guarda de fidelidad: tokens al día, tipografías computadas, paleta idéntica | **Crear** |
| `apps/web/src/agenda/*.module.css` | Los estilos de la agenda, por componente, en módulos | **Crear / migrar** |
| `apps/web/gen-shell.mjs` | Carga las fuentes de marca y genera el shell | **Modificar** |
| `apps/web/src/agenda/**` | Sidebar, mini-mes, movimiento, y los huecos funcionales | **Modificar** |
| `apps/web/e2e/agenda.visual.spec.ts` | Comparación visual contra la golden del prototipo | **Crear** |
| `.stylelintrc` (o el de la app) | Prohíbe valores crudos en los archivos de la agenda | **Modificar** |

---

### Task 1: El error no puede volver a cometerse (tokens mecánicos + guarda de fidelidad)

**Este es el task que justifica el plan.** Sin él, lo demás se puede volver a perder en silencio, que es exactamente lo que pasó.

**Files:**
- Create: `scripts/extract-agenda-tokens.mjs`
- Create: `apps/web/src/agenda/tokens.css` (generado por el script)
- Create: `scripts/check-agenda-fidelity.mjs`

**Interfaces:**
- `node scripts/extract-agenda-tokens.mjs` → extrae el bloque `:root` de `prototypes/agenda/index.html` y lo escribe en `apps/web/src/agenda/tokens.css` con un encabezado de "GENERADO — no editar; correr el script".
- `node scripts/extract-agenda-tokens.mjs --check` → **exit 1** si `tokens.css` no coincide con el prototipo, imprimiendo **qué token** difiere, con los dos valores.
- `node scripts/check-agenda-fidelity.mjs` → valida las tres cosas que se rompieron: (a) los tokens al día, (b) las **tipografías computadas**, (c) la paleta de categorías byte por byte.

- [ ] **Step 1: Escribir la guarda que falla**

```javascript
// scripts/check-agenda-fidelity.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let fallos = 0;
const mal = (msg) => { console.error("  ✗ " + msg); fallos++; };
const bien = (msg) => console.log("  ✓ " + msg);

// (a) los tokens tienen que estar al dia contra el prototipo
try {
  execFileSync("node", ["scripts/extract-agenda-tokens.mjs", "--check"], { stdio: "pipe" });
  bien("tokens al dia contra el prototipo");
} catch (e) {
  mal("tokens derivados del prototipo:\n" + (e.stdout?.toString() || e.message));
}

// (b) las tipografias de marca tienen que estar DECLARADAS (no alcanza con que el CSS las pida:
//     el fallo real fue que nunca se cargaban y todo caia a Outfit / a la mono del sistema)
const app = readFileSync("apps/web/src/agenda/tokens.css", "utf8");
for (const [rol, familia] of [["--display", "Fraunces"], ["--mono", "JetBrains Mono"]]) {
  if (!new RegExp(`${rol}\\s*:[^;]*${familia}`, "i").test(app))
    mal(`${rol} no apunta a ${familia} en tokens.css`);
  else bien(`${rol} -> ${familia}`);
}
const shell = readFileSync("apps/web/gen-shell.mjs", "utf8");
for (const f of ["Fraunces", "JetBrains+Mono"]) {
  if (!shell.includes(f)) mal(`el shell no carga ${f} (fallback silencioso)`);
  else bien(`el shell carga ${f}`);
}
const pilaMono = /--mono\s*:\s*([^;]+);/.exec(app)?.[1] || "";
if (pilaMono && !/^\s*"?JetBrains Mono/.test(pilaMono))
  mal(`--mono lista "${pilaMono.trim()}" — JetBrains Mono tiene que ir PRIMERO`);

// (c) la paleta de categorias, byte por byte contra el prototipo
const proto = readFileSync("prototypes/agenda/index.html", "utf8");
const cats = readFileSync("apps/web/src/agenda/categories.ts", "utf8");
const coloresProto = [...proto.matchAll(/color:\s*"(oklch\([^"]+\))"/g)].map((m) => m[1]);
const faltantes = coloresProto.filter((c) => !cats.includes(c));
if (faltantes.length) mal(`categorias re-derivadas: ${faltantes.join(", ")}`);
else bien(`las ${coloresProto.length} categorias copian el prototipo`);

console.log(fallos ? `\nFIDELIDAD: ${fallos} problema(s)` : "\nFIDELIDAD: OK");
process.exit(fallos ? 1 : 0);
```

- [ ] **Step 2: Correrla y verificar que falla**

Run: `node scripts/check-agenda-fidelity.mjs`
Expected: falla — no existe `tokens.css`, el shell no carga las fuentes, y cuenta los problemas.

- [ ] **Step 3: Implementar la extracción**

```javascript
// scripts/extract-agenda-tokens.mjs — el :root del prototipo es la fuente; tokens.css es la copia.
import { readFileSync, writeFileSync } from "node:fs";

const PROTO = "prototypes/agenda/index.html";
const SALIDA = "apps/web/src/agenda/tokens.css";

const html = readFileSync(PROTO, "utf8");
// el bloque :root { ... } del prototipo, mas las dos familias de body (--display / --mono)
const raiz = /:root\s*\{([\s\S]*?)\}/.exec(html)?.[1];
if (!raiz) { console.error("no encontre :root en " + PROTO); process.exit(1); }
const familias = [...html.matchAll(/(--display|--mono)\s*:\s*([^;]+);/g)]
  .map(([, k, v]) => `  ${k}: ${v.trim()};`).join("\n");
const cuerpo = `${raiz.trim()}\n${familias}`;
const contenido = `/* GENERADO por scripts/extract-agenda-tokens.mjs — NO EDITAR A MANO.
   La fuente es el :root de prototypes/agenda/index.html. Si falta un valor,
   se agrega ALLI y se vuelve a correr el script. */
:root {
${cuerpo}
}
`;
if (process.argv.includes("--check")) {
  const actual = readFileSync(SALIDA, "utf8").replace(/\s+/g, " ").trim();
  const esperado = contenido.replace(/\s+/g, " ").trim();
  if (actual !== esperado) {
    console.error("tokens.css NO coincide con el prototipo. Correr: node scripts/extract-agenda-tokens.mjs");
    process.exit(1);
  }
  console.log("tokens.css al dia");
  process.exit(0);
}
writeFileSync(SALIDA, contenido);
console.log(`escrito ${SALIDA}`);
```

- [ ] **Step 4: Generar los tokens, cargar las fuentes y verificar que la guarda pasa**

En `apps/web/gen-shell.mjs`, agregar al `<link>` de Google Fonts: `Fraunces:opsz,wght@9..144,300..600` y `JetBrains+Mono:wght@400;500`, **junto a** Outfit (hoy solo carga Outfit). Lo mismo en `apps/web/index.html` para el dev server.

Run: `node scripts/extract-agenda-tokens.mjs && node scripts/check-agenda-fidelity.mjs`
Expected: `FIDELIDAD: OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-agenda-tokens.mjs scripts/check-agenda-fidelity.mjs apps/web/src/agenda/tokens.css apps/web/gen-shell.mjs apps/web/index.html
git commit -m "feat(agenda): los tokens salen del prototipo y una guarda impide re-derivarlos"
```

---

### Task 2: La tipografía de marca, verificada por fuente computada

**Files:** `apps/web/src/agenda/*.module.css`, `apps/web/gen-shell.mjs`, `scripts/check-agenda-fidelity.mjs`

**Interfaces:** consume `tokens.css` (T1). Produce `--display` aplicado al título de la semana y `--mono` (con JetBrains primero) en horarios y datos.

- [ ] **Step 1: La guarda que falla — por fuente COMPUTADA, no por captura**

Agregar a `check-agenda-fidelity.mjs` (o a un spec de Playwright si ya está disponible en T1) las dos aserciones que cazan el fallback silencioso:

```javascript
// en el navegador, contra el shell generado:
const titulo = getComputedStyle(document.querySelector(".agx-title")).fontFamily;
const hora = getComputedStyle(document.querySelector(".agx-hora, [class*=hora], [class*=time]")).fontFamily;
// y que la fuente este REALMENTE disponible, no solo pedida:
const okTitulo = document.fonts.check("400 23px Fraunces");
const okMono = document.fonts.check("400 11px 'JetBrains Mono'");
```
Las cuatro cosas tienen que ser verdaderas: el título **computa** Fraunces, la hora **computa** JetBrains Mono, y `document.fonts.check` pasa para ambas. Si el CSS las pide pero el shell no las carga, `getComputedStyle` devuelve la familia pedida **y** `fonts.check` da `false` — por eso hacen falta las dos.

- [ ] **Step 2: Correrla y verificar que falla** — hoy el título computa Outfit y `fonts.check('Fraunces')` es `false`.
- [ ] **Step 3: Implementar** — `.agx-title { font-family: var(--display); font-size: 23px; font-weight: 400; letter-spacing: -.015em; font-optical-sizing: auto; }` (valores del prototipo: `index.html:105`), y reordenar la pila mono para que `"JetBrains Mono"` vaya **primero** en `tokens.css`.
- [ ] **Step 4: Verificar** — `node scripts/check-agenda-fidelity.mjs` verde, con las cuatro aserciones.
- [ ] **Step 5: Commit** — `feat(agenda): tipografia de marca verificada por fuente computada`

---

### Task 3: Aislar la agenda del CSS global

**Files:** `apps/web/src/agenda/**` (migrar a `.module.css`), `apps/web/src/Agenda.tsx`, `.stylelintrc`

- [ ] **Step 1: Migrar los estilos de la agenda a CSS Modules**, con `[data-agenda]` como raíz del contenedor. Regla: ningún archivo bajo `apps/web/src/agenda/` importa `styles.css`.
- [ ] **Step 2: Stylelint que prohíbe valores crudos** en `apps/web/src/agenda/**`: `color-no-hex`, `declaration-property-value-disallowed-list` para `font-family`/`border-radius`/`transition` con valores literales, y `unit-disallowed-list` no — se permite `px` porque los tokens son px. **Que falle el build**, no que avise.
- [ ] **Step 3: Verificar** — probar que el lint **falla** al meter un `#ff0000` a mano en un módulo de la agenda (y sacarlo después), y que el CSS global ya no llega.
- [ ] **Step 4: Commit** — `refactor(agenda): estilos en modulos con [data-agenda] y lint que prohibe valores crudos`

---

### Task 4: La sidebar y el mini-mes (la pérdida estructural más grande)

**Files:** `apps/web/src/agenda/Sidebar.tsx`, `MiniMonth.tsx`, `Agenda.tsx`, sus módulos.

**Interfaces:** produce el filtrado real por agenda y por origen. Consume los eventos ya cargados.

- [ ] **Step 1: Copiar del prototipo** (`index.html:1501-1521` y su CSS `:71-91`, `:181-189`): **Agendas** (las 5 verticales con contador y toggle), **Origen** (CRM / Reserva web / Google), **Buscador**, el mini-mes de Septiembre con puntos y estados, y la leyenda **"Cómo se lee"** incluida la fila "Ocupado (de Google)". Y el botón **Panel** que pliega el mini-mes.
- [ ] **Step 2: Que los toggles filtren de verdad** — apagar una agenda saca sus eventos de las tres vistas y **actualiza los contadores**; apagar un origen ídem. El prototipo tiene el predicado (`oculto(e)`) y la regla (los importados sin categoría se filtran por origen).
- [ ] **Step 3: Verificar con la guarda** — una aserción que apague una agenda y compruebe que los eventos visibles bajan exactamente en su contador, y que apagar todo deja la grilla vacía **con el estado vacío** (que llega en T5).
- [ ] **Step 4: Commit** — `feat(agenda): sidebar con agendas y origen que filtran, y mini-mes con leyenda`

---

### Task 5: Paleta cálida, estado vacío y la barra de estado

**Files:** los módulos de la agenda, `Agenda.tsx`, `tokens.css` (vía el prototipo).

- [ ] **Step 1:** confirmar que la paleta cálida entra por `tokens.css` (T1) y **borrar los `#a0431c` sueltos** que no son de ninguna categoría.
- [ ] **Step 2:** el **estado vacío** de la grilla: título, subtítulo y botón "Nueva reunión" (`index.html:1553-1557`).
- [ ] **Step 3:** `Hoy · HH:MM` (la hora actual en el botón, `index.html:1527-1541`) y el **chip de ventana** con la ventana visible y los pendientes de sync.
- [ ] **Step 4: Verificar** — contraste de bloques ≥4.5:1 **medido**, foco ≥3:1, y el diff visual (T8) sin desvíos de color.
- [ ] **Step 5: Commit** — `feat(agenda): paleta calida, estado vacio y barra de estado`

---

### Task 6: Movimiento y craft (el port no tiene ninguna transición)

**Files:** los módulos de la agenda.

- [ ] **Step 1:** las transiciones del prototipo: bloques 150 ms con **hover elevado** (`filter: brightness(1.07)` + `inset 0 1px 0 rgba(255,255,255,.2), 0 5px 14px rgba(0,0,0,.45)`), sidebar/menú/lista 140 ms, encabezado 160 ms.
- [ ] **Step 2:** la **sombra del encabezado al scrollear** (`data-scrolled`, `index.html:128-131`).
- [ ] **Step 3:** el bloque **`prefers-reduced-motion`** que apaga todo.
- [ ] **Step 4:** el craft menor: etiqueta **"Nueva reunión"** y aviso **"· se superpone"** en el fantasma del arrastre; `data-densa`; base `14px/1.45`; selección `rgba(254,65,0,.22)`; radio del panel 14 px; anillo de foco radio 4 px.
- [ ] **Step 5: Verificar** — con `prefers-reduced-motion: reduce`, **medido**: ninguna transición activa.
- [ ] **Step 6: Commit** — `feat(agenda): movimiento, hover elevado y el craft que faltaba`

---

### Task 7: Lo funcional que se perdió

**Files:** `apps/web/src/agenda/**`, `apps/crm_core/crm_core/api.py`, tests.

- [ ] **Step 1:** **categoría y día editables en el panel** — hoy la categoría **no se puede cambiar en absoluto**: el panel perdió el campo y la API no la expone para editar. Agregar el campo, el parámetro en `update_meeting` y el test de integración (se corre en `crm-test`).
- [ ] **Step 2:** **scroll por teclado** en la grilla: `↑/↓` media hora, `PageUp/PageDown` 0.9 de viewport, `Home/End`, `h` = ir a ahora (`index.html:688-698`).
- [ ] **Step 3:** el **skip link** "Saltar a la grilla".
- [ ] **Step 4:** decidir y **registrar** la suerte de **busy/Google de solo lectura y los puntos de sync**: o el modelo expone los flags, o la divergencia se declara permanente en la spec. No se deja como olvido.
- [ ] **Step 5: Commit** — `feat(agenda): categoria y dia editables, scroll por teclado y skip link`

---

### Task 8: La prueba permanente (la golden del prototipo)

**Files:** `apps/web/e2e/agenda.visual.spec.ts`, `playwright.config.ts`, `apps/web/e2e/fixtures/agenda.json`

- [ ] **Step 1:** migrar a `@playwright/test` con `snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}"` para que el prototipo y la app resuelvan **la misma baseline**.
- [ ] **Step 2:** el **fixture sembrado** y el **reloj congelado** (`page.clock.setFixedTime()`): sin esto el diff falla por los datos y la hora, no por el diseño. El fixture son las reuniones del prototipo.
- [ ] **Step 3:** la golden desde el prototipo (Semana en Amplio, Lista, Mes) y su comparación contra la app, con `animations: "disabled"` y espera de `document.fonts.ready`.
- [ ] **Step 4: Verificar** — la comparación corre **a demanda** y reporta, por vista, cuántos píxeles difieren y dónde. Documentar los `maxDiffPixels` elegidos y por qué.
- [ ] **Step 5: Commit** — `test(agenda): comparacion visual contra la golden del prototipo`

---

## Self-review

**1. Cobertura de la spec.** Cada punto de la §3 tiene su task: tipografías → T2 · sidebar y mini-mes → T4 · paleta → T5 · estado vacío → T5 · movimiento → T6 · categoría y día → T7 · `Hoy · HH:MM` y chip → T5 · scroll por teclado y skip link → T7 · busy/sync → T7 · craft menor → T6. Las decisiones D1/D2 → T1 y T3. La prueba D3 → T8. Las mejoras a conservar (D4) son un **Global Constraint** y una lista explícita de lo que T4/T5/T7 **no** deben revertir.

**2. El error no puede volver a cometerse — tres capas, y ninguna es una convención:**
- **Capa 1 (mecánica):** los tokens **son generados** desde el prototipo. No hay un valor que "actualizar a mano": si falta uno, se agrega al prototipo.
- **Capa 2 (la guarda):** `check-agenda-fidelity.mjs` **falla** con exit 1 si los tokens divergen, si el shell no carga las fuentes, si la pila mono no empieza con JetBrains, o si una categoría se re-derivó. Y las fuentes se verifican por **fuente computada + `document.fonts.check`**, porque el fallo original fue un *fallback* silencioso que una captura no delata.
- **Capa 3 (el árbitro):** la comparación visual contra la **golden del prototipo**. No "se ve bien": cuántos píxeles y dónde.

**3. Lo que este plan NO resuelve, y lo declara:** el táctil, las operaciones del Mes, la recurrencia, y todo lo de la spec §6. Y el `busy`/sync depende de que el modelo exponga los flags: T7 lo obliga a **decidirse y registrarse**, que es distinto de implementarse.

**4. Consistencia de nombres:** `tokens.css`, `extract-agenda-tokens.mjs` (`--check`), `check-agenda-fidelity.mjs`, `.module.css`, `[data-agenda]`, `data-scrolled`, `data-densa`. Se usan con el mismo nombre en todas las tasks.
