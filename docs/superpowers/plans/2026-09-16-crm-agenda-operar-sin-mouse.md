# Operar la agenda sin mouse — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que crear, mover, cambiar la duración, duplicar y eliminar una reunión sean posibles **sin arrastrar** y **por teclado**, cumpliendo WCAG 2.2 AA en los criterios que aplican (2.1.1, 2.5.7, 2.1.4, 4.1.3), sin perder el arrastre como acelerador.

**Architecture:** Cinco superficies sobre el prototipo existente, ninguna es un modo: un **panel lateral no-modal** como única superficie de crear/editar; **click o Enter en un hueco** para crear; **un menú por reunión** con cinco acciones; **nudge por teclado**; y **la Lista** como camino plenamente operable. Se agrega un **anunciador persistente** fuera del subárbol que se re-renderiza. La verificación no es visual: cada tarea agrega una **guarda medida** al arnés `scripts/audit-agenda-proto.mjs`, que ya mide 30 invariantes.

**Tech Stack:** HTML/CSS/JS sin dependencias (el prototipo es un archivo autocontenido por diseño), Playwright para el arnés (Node, ya instalado), Node `--check` para sintaxis.

**Spec:** `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md` — **leerlo antes de empezar**, en especial §1.1 (el replanteo normativo), §4 (las superficies) y §13 (la auditoría: 4 críticos ya corregidos en el spec).

**Target:** este plan implementa en el **prototipo** `prototypes/agenda/index.html`, que es donde el arnés puede medir la interacción. El port a `apps/web` (React) es **otro plan**, y no debe empezar hasta que las guardas de éste estén verdes.

---

## Correcciones de la auditoría que este plan aplica desde el arranque

El spec se auditó adversarialmente antes de planificar (4 críticos, 8 mayores). Las que **no se pueden descubrir después** porque cambian la estructura:

| Corrección | Dónde se aplica |
|---|---|
| **El indicador de foco incumplía 1.4.11** (medido: 1.36:1). Ya corregido a 5.45:1 con indicador de dos colores | **Hecho** — Task 10 agrega la guarda que lo mantiene |
| **Doble anuncio**: mover el foco y escribir en la región viva a la vez hace leer dos veces | Task 1: `announce()` es **alternativo** al movimiento de foco, nunca simultáneo |
| **El anunciador se destruye**: vivía dentro de `render()`, que se reemplaza en cada operación | Task 1: se monta **una vez**, fuera del subárbol intercambiado |
| **SC 2.1.4**: `h`, `r`, `1/2/3` son atajos globales de una tecla sin apagado ni remapeo | Task 9: todo atajo de una tecla queda **acotado al foco** |
| **`Enter` tenía dos significados** (abrir menú en S3, abrir panel en S4) | Task 5: `Enter` = abrir el menú, **un solo significado**; editar es un ítem |
| **A4 y Eliminar no tenían camino de puntero; Duplicar no tenía camino de teclado** | Task 5 los mete en el **mismo menú**; Task 8 los implementa |
| **La excepción "Equivalent" de 24×24 era circular** | Task 10 usa **"Essential"** + área de impacto ampliada, y la guarda **mide** |
| **El arrastre entre días no existe** y crear-arrastrando siempre da 30 min | Task 3 lo declara: el click/Enter **sí** precarga el día; no se afirma paridad falsa |
| **`Alt`+flechas no es cancelable de forma confiable** (es Atrás/Adelante en Windows/Linux) | Task 9 verifica en los 3 navegadores o cambia el acorde |

## Alcance de este plan

**Dentro:** las fases **F1, F2, F3, F5** del spec §12 — el conjunto que cierra **2.1.1 + 2.5.7** de A1–A5 y **4.1.3** — más la guarda de **1.4.11** (F7 parcial, ya corregida).

**Fuera, con su plan:** **F4** (táctil: manijas ≥24 px, long-press 1000 ms) · **F6** (⌘K con lenguaje natural en español — *prescindible, se corta primero*) · **F7** (2.4.11 foco no tapado, 3.3.1/3.3.3 errores del panel) · **F8** (roles completos del menú y del diálogo) · **multi-día, todo-el-día y operaciones en la vista Mes** (declarados fuera de alcance en el spec §13).

## Global Constraints

- **Un solo archivo de implementación:** `prototypes/agenda/index.html`. No se agregan dependencias: el prototipo debe seguir abriéndose con doble click.
- **Sin `role="grid"`, sin `aria-grabbed`, sin `aria-dropeffect`.** Los dos últimos están deprecados desde ARIA 1.1 y sin soporte confiable.
- **`Enter` tiene un único significado en toda la interacción: abrir el menú de la reunión.**
- **Ninguna operación abre un modo.** No existe estado del que haya que "salir".
- **El arrastre queda como acelerador**, con Escape y soltar-fuera cancelando.
- **Contraste mínimo:** texto ≥4.5:1, elementos no textuales y foco ≥3:1. Los valores ya verificados (4.61:1 y 5.45:1) no se degradan.
- **Todo texto ≥11 px.** Verificado hoy; no baja.
- **Idioma:** español de Argentina, voseo en la UI ("Activá", "Creá").
- **Verificación obligatoria por tarea:** `node scripts/audit-agenda-proto.mjs` debe seguir verde, y cada tarea agrega su guarda.
- **Sintaxis:** `node -e` con `new Function(js)` sobre el `<script>` extraído, después de cada edición.

## Estructura de archivos

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `prototypes/agenda/index.html` | Todo el prototipo: datos, geometría, render de las 3 vistas, puntero, teclado | **Modificar** en las 10 tareas |
| `scripts/audit-agenda-proto.mjs` | El arnés: mide 30 invariantes sobre las 3 variantes × 3 viewports + Lista + Mes | **Modificar**: una guarda nueva por tarea |

Bloques de `index.html` que se tocan, y quién los toca:

| Bloque (identificador) | Qué es | Tasks |
|---|---|---|
| `#stage` | contenedor raíz del prototipo | 1 (anunciador), 2 (panel) |
| `render()` | arma el shell completo | 2, 3, 5 |
| `renderEvent()` | un bloque de reunión | 5 |
| el handler de click delegado en `stage` | acciones | 2, 3, 5, 6, 7, 8 |
| `onDown`/`onMove`/`onUp` | arrastre | 3 (umbral de 4 px), 10 (cancelación) |
| `renderList()` | vista Lista | 3 (Nueva reunión por día) |
| listener global de `keydown` | teclado | 9 |

---

### Task 1: Anunciador persistente

Sin esto, ningún anuncio posterior funciona: la región viva vive hoy dentro de `render()` y `mount()` reemplaza el HTML, así que el nodo se recrea y el anuncio se pierde.

**Files:**
- Modify: `prototypes/agenda/index.html` (`#stage` y un helper nuevo)
- Test: `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Produces: `announce(texto: string): void` — escribe en el anunciador persistente. **No se llama si se está moviendo el foco al elemento afectado** (los dos mecanismos son alternativos).
- Produces: `#announcer` — nodo `role="status" aria-live="polite" aria-atomic="true"`, hermano de `#stage`, nunca reemplazado.

- [ ] **Step 1: Escribir la guarda que falla**

En `scripts/audit-agenda-proto.mjs`, dentro del bloque de vista Lista (o uno nuevo), agregar:

```javascript
// anunciador persistente: sobrevive a un re-render y no esta dentro del subarbol que se reemplaza
const ann = await page.evaluate(() => {
  const a = document.querySelector("#announcer");
  if (!a) return { falta: true };
  const dentro = document.querySelector("#stage").contains(a);
  window.__annRef = a;                       // referencia antes de re-renderizar
  return { rol: a.getAttribute("role"), live: a.getAttribute("aria-live"), atomic: a.getAttribute("aria-atomic"), dentro };
});
await page.locator('[data-view="lista"]').click();
await page.waitForTimeout(400);
const sobrevive = await page.evaluate(() => document.querySelector("#announcer") === window.__annRef);
const v = [];
if (ann.falta) v.push("no existe #announcer");
else {
  if (ann.dentro) v.push("#announcer esta dentro de #stage (se destruye al re-renderizar)");
  if (!sobrevive) v.push("#announcer no sobrevivio al re-render");
  if (ann.rol !== "status" || ann.live !== "polite" || ann.atomic !== "true") v.push(`atributos ${ann.rol}/${ann.live}/${ann.atomic}`);
}
console.log((v.length ? "  ✗ " : "  ✓ ") + `anunciador persistente · fuera de #stage ${!ann.dentro} · sobrevive ${sobrevive}`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -6`
Expected: `✗ no existe #announcer`

- [ ] **Step 3: Implementar**

En `index.html`, agregar el nodo junto a `#stage` (hermano, **no** dentro):

```html
<div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
```

Y el helper, junto a las utilidades. **El anunciador no se limpia por render**: se reescribe solo.

```javascript
/* Anuncios: el nodo vive fuera del subarbol que se reemplaza, y se limpia
   antes de escribir para que un mensaje identico repetido se vuelva a leer. */
let lastMsg = "";
function announce(texto) {
  const a = document.getElementById("announcer");
  if (!a) return;
  a.textContent = "";
  requestAnimationFrame(() => { a.textContent = texto; lastMsg = texto; });
}
```

Y **quitar** del template de `render()` la línea del `role="status"` que hoy se re-crea:

```javascript
// BORRAR esta linea de render():
// <span class="sr-only" role="status" aria-live="polite">Mostrando ${total} reuniones…</span>
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node -e "const h=require('fs').readFileSync('prototypes/agenda/index.html','utf8');new Function(h.split('<script>').slice(-1)[0].split('</script>')[0]);console.log('JS: OK')" && node scripts/audit-agenda-proto.mjs 2>&1 | tail -6`
Expected: `JS: OK` y `✓ anunciador persistente · fuera de #stage true · sobrevive true`, con las 9 filas de variantes todavía verdes.

- [ ] **Step 5: Commit**

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): anunciador persistente fuera del subarbol re-renderizado"
```

---

### Task 2: Panel lateral no-modal (S1)

**Files:**
- Modify: `prototypes/agenda/index.html` (template de `render()`, CSS, handler de click)
- Test: `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Consumes: `announce()` de Task 1.
- Produces: `abrirPanel({ dia, min, dur, evento })` — `dia: 0..4`, `min: number` (minutos desde 00:00), `dur: number`, `evento: object|null`. Si `evento` es null, es creación; si no, edición.
- Produces: `cerrarPanel({ volverFoco: boolean })`.
- Produces: el elemento `#panel` con `role="dialog" aria-modal="false" aria-labelledby="panel-titulo"`.
- Produce: `#panel-titulo` con el contexto explícito ("Nueva reunión · martes 16, 09:00–09:45").

- [ ] **Step 1: Escribir la guarda que falla**

```javascript
// panel no-modal: se abre con foco en el titulo, Escape cierra y devuelve el foco, y la grilla sigue operable
const panelInicial = await page.evaluate(() => !!document.querySelector("#panel"));
await page.locator(".slot").first().click({ position: { x: 40, y: 8 } });
await page.waitForTimeout(300);
const abierto = await page.evaluate(() => {
  const p = document.querySelector("#panel");
  if (!p) return { falta: true };
  const t = p.querySelector("#panel-titulo");
  return {
    rol: p.getAttribute("role"), modal: p.getAttribute("aria-modal"),
    etiquetado: p.getAttribute("aria-labelledby") === "panel-titulo" && !!t,
    focoEnTitulo: document.activeElement === p.querySelector("input, textarea, [tabindex]"),
    grillaOperable: document.querySelectorAll(".ev").length > 0,
    texto: (t?.textContent || "").trim(),
  };
});
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const cerrado = await page.evaluate(() => ({ hayPanel: !!document.querySelector("#panel"), focoEnStage: document.querySelector("#stage").contains(document.activeElement) }));
const v = [];
if (panelInicial) v.push("el panel ya estaba en el DOM antes de abrir");
if (abierto.falta) v.push("no se abre #panel");
else {
  if (abierto.rol !== "dialog") v.push(`role ${abierto.rol}`);
  if (abierto.modal !== "false") v.push(`aria-modal ${abierto.modal}`);
  if (!abierto.etiquetado) v.push("sin aria-labelledby correcto");
  if (!abierto.focoEnTitulo) v.push("el foco no entra al panel");
  if (!abierto.grillaOperable) v.push("la grilla desaparecio (el panel no debe taparla)");
}
if (cerrado.hayPanel) v.push("Escape no cierra el panel");
if (!cerrado.focoEnStage) v.push("Escape no devuelve el foco");
console.log((v.length ? "  ✗ " : "  ✓ ") + `panel no-modal · abre ${abierto.texto || "-"} · foco entra ${abierto.focoEnTitulo} · Escape cierra ${!cerrado.hayPanel} · foco vuelve ${cerrado.focoEnStage}`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -6`
Expected: `✗ no se abre #panel`

- [ ] **Step 3: El estado y el render del panel**

```javascript
/* El panel NO es un modo: se abre, hace una cosa, se cierra. Nunca bloquea la grilla. */
let PANEL = null;   // { dia, min, dur, evento } | null

function abrirPanel({ dia, min, dur, evento = null }) {
  PANEL = { dia, min, dur, evento };
  mount(current);
  requestAnimationFrame(() => {
    const f = document.querySelector("#panel input, #panel textarea");
    if (f) f.focus();
  });
}

function cerrarPanel({ volverFoco = true } = {}) {
  const origen = document.activeElement;
  PANEL = null;
  mount(current);
  if (volverFoco) requestAnimationFrame(() => {
    const buscado = document.querySelector("#grilla .ev, #grilla [data-slot]");
    if (buscado) buscado.focus();
  });
}

function renderPanel() {
  if (!PANEL) return "";
  const { dia, min, dur, evento } = PANEL;
  const fin = min + dur;
  const rango = `${fmt(min)} – ${fmt(fin)}`;
  const titulo = evento ? `Editar · ${evento.title}` : `Nueva reunión · ${DIAS_LARGOS[dia]}, ${rango}`;
  const horaValida = /^\d{1,2}[:.]\d{2}$/.test(fmt(min));
  return `<aside id="panel" role="dialog" aria-modal="false" aria-labelledby="panel-titulo">
    <h2 id="panel-titulo">${titulo}</h2>
    <form id="panel-form">
      <label for="p-titulo">Título</label>
      <input id="p-titulo" name="titulo" autocomplete="off" value="${evento ? evento.title : ""}">
      <label for="p-inicio">Hora de inicio</label>
      <p class="p-hint" id="p-inicio-ayuda">Formato 24 h, por ejemplo 09:30</p>
      <input id="p-inicio" name="inicio" inputmode="numeric" value="${fmt(min)}" aria-describedby="p-inicio-ayuda">
      <fieldset><legend>Duración</legend>
        ${[15, 30, 45, 60, 90].map((d) => `<button type="button" class="p-dur${d === dur ? " on" : ""}" data-dur="${d}" aria-pressed="${d === dur}">${d} min</button>`).join("")}
      </fieldset>
      <div class="p-acciones">
        <button type="submit" class="btn primary">Guardar</button>
        <button type="button" class="btn" data-cerrar-panel>Cancelar</button>
      </div>
    </form>
  </aside>`;
}
```

En `render()`, insertar `${renderPanel()}` como **hermano** de `<main>` dentro de `.shell` (nunca dentro de la grilla), y en `mount()` no tocar el anunciador.

CSS (panel lateral que **no** superpone las columnas: `.shell` pasa a 3 columnas cuando hay panel):

```css
#panel {
  grid-column: 3; align-self: start; background: var(--surface);
  border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 8px;
}
.shell[data-panel="on"] { grid-template-columns: 200px 1fr 320px; }
.shell[data-panel="on"] .mini { display: none; }   /* el panel ocupa el lugar del mes */
#panel h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
#panel label { font-size: 12px; color: var(--fg-dim); }
#panel input { background: var(--surface-2); border: 0; border-radius: 8px; padding: 8px 10px; font: inherit; color: var(--fg); width: 100%; }
#panel .p-hint { margin: -4px 0 0; font-size: 11px; color: var(--fg-faint); }
#panel fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
#panel .p-dur { background: var(--surface-2); border: 0; border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12px; color: var(--fg-dim); cursor: pointer; min-height: 24px; }
#panel .p-dur.on { background: var(--accent); color: #fff; }
#panel .p-acciones { display: flex; gap: 6px; margin-top: 6px; }
```

Y en `render()`, agregar el atributo al shell: `data-panel="${PANEL ? "on" : "off"}"`.

- [ ] **Step 4: Escribir la guarda que falla**

El handler ya existe en `stage`; agregar la rama de Escape **antes** de las otras (si el foco está en el panel, Escape no debe llegar al picker):

```javascript
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && PANEL) { cerrarPanel(); e.preventDefault(); return; }
  // …lo que sigue igual
});
```

Y en el click delegado de `stage`:

```javascript
if (ev.target.closest("[data-cerrar-panel]")) { cerrarPanel(); return; }
```

- [ ] **Step 5: Implementar el handler y correr la guarda**

Run: `node -e "const h=require('fs').readFileSync('prototypes/agenda/index.html','utf8');new Function(h.split('<script>').slice(-1)[0].split('</script>')[0]);console.log('JS: OK')" && node scripts/audit-agenda-proto.mjs 2>&1 | tail -8`
Expected: `JS: OK` y `✓ panel no-modal · abre Nueva reunión … · foco entra true · Escape cierra true · foco vuelve true`

- [ ] **Step 6: Commit**

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): panel lateral no-modal con foco, Escape y devolucion de foco"
```

---

### Task 3: Crear con un solo puntero y por teclado (A1 · cierra 2.5.7 de crear)

**Files:**
- Modify: `prototypes/agenda/index.html` (`onDown`/`onUp`, `renderList()`, botón de toolbar)
- Test: `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Consumes: `abrirPanel()` de Task 2.
- Produces: `data-slot` en los huecos (para poder clickearlos sin ambigüedad) y el helper `slotDesdeClick(ev): { dia, min }`.
- Nota honesta (auditoría): **no se afirma paridad con el arrastre**. El click/Enter **sí** precarga el día y la hora; el arrastre actual no cambia de día (bug conocido) y siempre da 30 min. Se declara en el commit.

- [ ] **Step 1: Escribir la guarda que falla**

```javascript
// A1 por puntero sin arrastre: click en un hueco abre el panel con dia y hora precargados
await page.locator('[data-view="semana"]').click();
await page.waitForTimeout(400);
const antes = await page.evaluate(() => document.querySelectorAll(".ldia, #panel").length);
const col = await page.locator('.col[data-day="2"]').boundingBox();
const y = await page.evaluate(() => geom().yOf(11 * 60));
await page.mouse.click(col.x + col.width / 2, col.y + y + 6);
await page.waitForTimeout(400);
const creado = await page.evaluate(() => {
  const t = document.querySelector("#panel-titulo")?.textContent || "";
  return { abierto: !!document.querySelector("#panel"), texto: t.trim(), diceDia: /miércoles 17/.test(t), diceHora: /11:0\d/.test(t) };
});
const v = [];
if (!creado.abierto) v.push("el click en el hueco no abre el panel");
if (!creado.diceDia) v.push(`el panel no dice el dia: "${creado.texto}"`);
if (!creado.diceHora) v.push(`el panel no dice la hora: "${creado.texto}"`);
console.log((v.length ? "  ✗ " : "  ✓ ") + `A1 puntero sin arrastre · ${creado.texto}`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
await page.keyboard.press("Escape");
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -6`
Expected: `✗ el click en el hueco no abre el panel`

- [ ] **Step 3: Implementar el click y el Enter del hueco**

`abrirPanel` se llama desde `onUp` **solo si no hubo arrastre** (umbral de 4 px), y desde un botón de toolbar para el camino de teclado sin rediseñar el modelo de flechas de la grilla (las flechas hoy scrollean: el APG advierte que un cursor de celdas las consumiría y eso es un rediseño, no un arreglo).

```javascript
/* Un solo puntero, sin arrastrar: click en el hueco abre el panel con ese dia y hora.
   Si hubo desplazamiento (> 4 px) se trata como arrastre y el panel no se abre. */
const DRAG_UMBRAL = 4;
let downEn = null;

function slotDesdeClick(ev, col) {
  const r = col.getBoundingClientRect();
  const y = ev.clientY - r.top;
  const g = geom();
  const min = Math.round(((y / g.hourH) * 60 + START_H * 60) / 30) * 30;   // a la media hora
  return { dia: Number(col.dataset.day), min: Math.max(START_H * 60, Math.min(END_H * 60 - 30, min)) };
}
```

En `onUp`, al final, si `Math.abs(ev.clientY - downEn.y) < DRAG_UMBRAL && Math.abs(ev.clientX - downEn.x) < DRAG_UMBRAL` y el objetivo era un `.slot`:

```javascript
const { dia, min } = slotDesdeClick(ev, col);
abrirPanel({ dia, min, dur: 45 });       // 45 min por defecto (spec S2)
```

Y en la toolbar, un botón que es el camino de teclado sin cursor de celdas:

```javascript
<button class="btn" data-nueva title="Nueva reunión en la hora actual (N)">Nueva reunión</button>
```

```javascript
if (ev.target.closest("[data-nueva]")) {
  const dia = 1;                                  // la columna de hoy
  abrirPanel({ dia, min: NOW_MIN - (NOW_MIN % 30), dur: 45 });
  return;
}
```

En `renderList()`, un botón por día (S6):

```javascript
<button class="ldia-nueva btn" data-nueva-dia="${i}">Nueva reunión</button>
```

```javascript
const nd = ev.target.closest("[data-nueva-dia]");
if (nd) { abrirPanel({ dia: Number(nd.dataset.nuevaDia), min: 9 * 60, dur: 45 }); return; }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -8`
Expected: `✓ A1 puntero sin arrastre · Nueva reunión · miércoles 17, 11:00 – 11:45`

- [ ] **Step 5: Commit**

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): crear con un solo puntero (click en hueco) y por teclado (N y Nueva reunion)"
```

---

### Task 4: Guardar desde el panel (cierra el ciclo de A1)

**Files:**
- Modify: `prototypes/agenda/index.html` (submit del form)
- Test: `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Consumes: `PANEL`, `cerrarPanel()`, `announce()`.
- Produces: `guardarPanel(datos)` — crea o actualiza `EVENTS`, re-renderiza, **anuncia** y mueve el foco al elemento afectado.

- [ ] **Step 1: Escribir la guarda que falla**

```javascript
// guardar: crea la reunion, la anuncia, mueve el foco al elemento afectado y cierra el panel
await page.locator("#p-titulo").fill("Reunión de prueba");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const tras = await page.evaluate(() => {
  const evs = [...document.querySelectorAll(".ev")];
  const nuevo = evs.find((e) => (e.textContent || "").includes("Reunión de prueba"));
  return {
    creado: !!nuevo, panel: !!document.querySelector("#panel"),
    focoEnNuevo: nuevo ? document.activeElement === nuevo : false,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
const v = [];
if (!tras.creado) v.push("no se creo la reunion");
if (tras.panel) v.push("el panel no se cerro al guardar");
if (!tras.focoEnNuevo) v.push("el foco no quedo en la reunion creada");
if (!/Reunión de prueba/.test(tras.anuncio)) v.push(`no se anuncio: "${tras.anuncio}"`);
console.log((v.length ? "  ✗ " : "  ✓ ") + `guardar · creado ${tras.creado} · panel cerrado ${!tras.panel} · foco ${tras.focoEnNuevo} · anuncio "${tras.anuncio}"`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -6`
Expected: `✗ no se creo la reunion`

- [ ] **Step 3: Implementar**

```javascript
function guardarPanel(datos) {
  const { dia, min, dur, evento } = PANEL;
  if (evento) {
    evento.title = datos.titulo; evento.min = datos.min; evento.dur = datos.dur;
    cerrarPanel({ volverFoco: false });
    requestAnimationFrame(() => {
      const el = document.querySelector(`#grilla .ev[data-i="${EVENTS.indexOf(evento)}"]`);
      if (el) { el.focus(); announce(`Actualizada ${evento.title}, ${DIAS_LARGOS[dia]} de ${fmt(evento.min)} a ${fmt(evento.min + evento.dur)}`); }
    });
    return;
  }
  const nuevo = { day: dia, min: datos.min, dur: datos.dur, title: datos.titulo, cat: "consultora", origin: "CRM", sync: "ok" };
  EVENTS.push(nuevo);
  LAST_FIT = 0;
  cerrarPanel({ volverFoco: false });
  requestAnimationFrame(() => {
    const el = document.querySelector(`#grilla .ev[data-i="${EVENTS.length - 1}"]`);
    if (el) { el.focus(); announce(`Creada ${nuevo.title}, ${DIAS_LARGOS[dia]} de ${fmt(nuevo.min)} a ${fmt(nuevo.min + nuevo.dur)}`); }
  });
}
```

El submit:

```javascript
const form = document.getElementById("panel-form");
if (form) form.addEventListener("submit", (e) => {
  e.preventDefault();
  const titulo = form.titulo.value.trim() || "Reunión sin título";
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(form.inicio.value.trim());
  const min = m ? Math.max(0, Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]))) : PANEL.min;
  const dur = Number(document.querySelector("#panel .p-dur.on")?.dataset.dur || PANEL.dur);
  guardarPanel({ titulo, min, dur });
});
```

Y los botones de duración: `if (ev.target.closest(".p-dur")) { ...toggle .on y aria-pressed... return; }`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -8`
Expected: `✓ guardar · creado true · panel cerrado true · foco true · anuncio "Creada Reunión de prueba, …"`

- [ ] **Step 5: Commit**

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): guardar desde el panel, con anuncio y foco al elemento afectado"
```

---

### Task 5: Menú de la reunión (S3) — `Enter` con un único significado

**Files:**
- Modify: `prototypes/agenda/index.html` (`renderEvent`, handler de click, `keydown`)
- Test: `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Consumes: `abrirPanel()`, `announce()`.
- Produces: `abrirMenu(i)` / `cerrarMenu()` y `#menu` con `role="menu"` y 5 `role="menuitem"`.
- **`Enter`/`Space` sobre una reunión enfocada abre el menú.** No abre el panel: editar es el ítem "Editar".

- [ ] **Step 1: Escribir la guarda que falla**

```javascript
// el menu se abre con Enter y tiene las cinco acciones
await page.locator("#grilla .ev").first().focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const menu = await page.evaluate(() => {
  const m = document.querySelector("#menu");
  if (!m) return { falta: true };
  const items = [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim());
  return { rol: m.getAttribute("role"), items, focoEnPrimero: document.activeElement === m.querySelector('[role="menuitem"]') };
});
const esperados = ["Editar", "Mover a…", "Cambiar duración…", "Duplicar", "Eliminar"];
const v = [];
if (menu.falta) v.push("Enter no abre el menu");
else {
  if (menu.rol !== "menu") v.push(`role ${menu.rol}`);
  if (esperados.some((e) => !menu.items.includes(e))) v.push(`faltan items: ${esperados.filter((e) => !menu.items.includes(e)).join(", ")}`);
  if (!menu.focoEnPrimero) v.push("el foco no entra al menu");
}
console.log((v.length ? "  ✗ " : "  ✓ ") + `menu · items ${(menu.items || []).join(" | ")}`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
await page.keyboard.press("Escape");
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -6`
Expected: `✗ Enter no abre el menu`

- [ ] **Step 3: Implementar**

```javascript
/* Un solo menu para todas las acciones de una reunion. Enter abre el menu
   (un solo significado en todo el prototipo); "Editar" abre el panel. */
let MENU = null;   // { i } | null

const ACCIONES = [
  { id: "editar",   label: "Editar",              tecla: "E" },
  { id: "mover",    label: "Mover a…",            tecla: "M" },
  { id: "duracion", label: "Cambiar duración…",   tecla: "D" },
  { id: "duplicar", label: "Duplicar",            tecla: "" },
  { id: "eliminar", label: "Eliminar",            tecla: "Supr" },
];

function abrirMenu(i) { MENU = { i }; mount(current); requestAnimationFrame(() => document.querySelector('#menu [role="menuitem"]')?.focus()); }
function cerrarMenu({ volverFoco = true } = { const i = MENU?.i; MENU = null; mount(current); if (volverFoco) requestAnimationFrame(() => document.querySelector(`#grilla .ev[data-i="${i}"]`)?.focus()); });

function renderMenu() {
  if (!MENU) return "";
  const e = EVENTS[MENU.i];
  return `<div id="menu" role="menu" aria-labelledby="menu-titulo">
    <p id="menu-titulo" class="sr-only">Acciones para ${e.title}</p>
    ${ACCIONES.map((a) => `<button role="menuitem" data-accion="${a.id}">${a.label}${a.tecla ? `<span class="m-tecla">${a.tecla}</span>` : ""}</button>`).join("")}
  </div>`;
}
```

CSS: `#menu { position: absolute; z-index: 6; background: var(--surface-2); border-radius: 10px; padding: 4px; min-width: 200px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }` y cada `[role="menuitem"]` a `min-height: 24px`, ancho completo, alineado a la izquierda, con hover y foco visibles.

En `keydown`, **antes** del handler de scroll:

```javascript
if (MENU) {
  const items = [...document.querySelectorAll('#menu [role="menuitem"]')];
  const idx = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { items[(idx + 1) % items.length]?.focus(); e.preventDefault(); return; }
  if (e.key === "ArrowUp")   { items[(idx - 1 + items.length) % items.length]?.focus(); e.preventDefault(); return; }
  if (e.key === "Escape")    { cerrarMenu(); e.preventDefault(); return; }
  if (e.key === "Enter" || e.key === " ") { document.activeElement.click(); e.preventDefault(); return; }
}
if ((e.key === "Enter" || e.key === " ") && e.target.closest(".gridwrap") && e.target.classList.contains("ev")) {
  abrirMenu(EVENTS.indexOf(EVENTS[Number(e.target.dataset.i)])); e.preventDefault(); return;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -8`
Expected: `✓ menu · items Editar | Mover a… | Cambiar duración… | Duplicar | Eliminar`

- [ ] **Step 5: Commit**

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): menu de la reunion con cinco acciones; Enter abre el menu"
```

---

### Task 6: "Mover a…" (A2 · cierra 2.5.7 de mover)

**Files:**
- Modify: `prototypes/agenda/index.html`
- Test: `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Consumes: `MENU`, `EVENTS`, `announce()`.
- Produces: `#mover-dialog` con pasos `data-paso="-60|-15|+15|+60"`, destino de día y Aplicar.

- [ ] **Step 1 a 3: guarda que falla, verificación de falla, implementación**

La guarda verifica que **el camino de puntero sin arrastre cambia el evento**, que es lo que exige 2.5.7:

```javascript
const antesDeMover = await page.evaluate(() => ({ min: EVENTS[0].min, dia: EVENTS[0].day, titulo: EVENTS[0].title }));
await page.locator("#grilla .ev").first().click();
await page.waitForTimeout(300);
await page.locator('[data-accion="mover"]').click();
await page.waitForTimeout(300);
await page.locator('#mover-dialog [data-paso="+15"]').click();
await page.waitForTimeout(200);
await page.locator("#mover-aplicar").click();
await page.waitForTimeout(400);
const trasMover = await page.evaluate(() => ({ min: EVENTS[0].min, dia: EVENTS[0].day, anuncio: (document.querySelector("#announcer")?.textContent || "").trim() }));
const v = [];
if (trasMover.min !== antesDeMover.min + 15) v.push(`no movio 15 min: ${antesDeMover.min} -> ${trasMover.min}`);
if (!/Movida/.test(trasMover.anuncio)) v.push(`no anuncio: "${trasMover.anuncio}"`);
console.log((v.length ? "  ✗ " : "  ✓ ") + `A2 "Mover a…" · ${antesDeMover.min} -> ${trasMover.min} · anuncio "${trasMover.anuncio}"`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
```

Implementación: el diálogo guarda un borrador (`let MOVER = { i, dia, min }`) y Aplicar escribe al evento, cierra el menú y anuncia (`Movida ${title} a ${fmt(min)}`). Los pasos y los botones de día tienen `min-height: 24px`. **Escape cancela sin escribir.**

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -8`
Expected: `✓ A2 "Mover a…" · 510 -> 525 · anuncio "Movida … a las 09:15"`

- [ ] **Step 5: Commit**

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): mover una reunion sin arrastrar, con dialogo, pasos de 15 min y anuncio"
```

---

### Task 7: "Cambiar duración…" (A3 · cierra 2.5.7 de redimensionar)

**Files:** igual que Task 6.
**Interfaces:** `#dur-dialog` con presets (15/30/45/60/90/120) y pasos ±15; Aplicar escribe `e.dur`.

- [ ] **Guarda:** tras aplicar "+15", `EVENTS[0].dur` sube 15 y el anuncio dice "ahora N minutos" (o el rango nuevo). Elige un evento cuyo `min + dur` siga siendo válido.
- [ ] **Implementación:** mismo patrón que Task 6 (borrador + Aplicar + Escape cancela). Los presets y los pasos tienen `min-height: 24px`.
- [ ] **Commit:** `feat(agenda): cambiar la duracion sin arrastrar, con presets y pasos de 15 min`

---

### Task 8: Duplicar y Eliminar (A5 y borrado, ambos caminos)

**Files:** igual que Task 6.
**Interfaces:** `duplicarEvento(i)` y `eliminarEvento(i)` con confirmación en línea (no en un modal anidado).

- [ ] **Guarda 1 — duplicar por puntero y por teclado:** tras "Duplicar", `EVENTS.length` sube 1, la copia está en el mismo día/hora, el foco queda en la copia y se anuncia.
- [ ] **Guarda 2 — eliminar pide confirmación y no borra al primer Enter:** tras "Eliminar" aparece `#confirmar-eliminar`; `Escape` cancela y `EVENTS.length` no cambió. Recién el segundo Enter borra y anuncia.
- [ ] **Implementación:** la confirmación es un bloque dentro del menú (`role="group"` con `aria-label="Confirmar eliminación"`), con "Sí, eliminar" y "Cancelar". **No** es un modal anidado.
- [ ] **Commit:** `feat(agenda): duplicar y eliminar con confirmacion, por puntero y por teclado`

---

### Task 9: Nudge por teclado y atajos acotados al foco (A2/A3 por teclado · 2.1.4)

**Files:** `prototypes/agenda/index.html` (`keydown`), `scripts/audit-agenda-proto.mjs`

**Interfaces:**
- Consumes: `EVENTS`, `announce()`, `mount()`.
- Produces: `moverEvento(i, deltaMin)`, `moverEventoDia(i, deltaDias)`, `cambiarDuracion(i, deltaMin)` — las tres **anuncian** y **scrollean** para mantener el evento a la vista.

- [ ] **Step 1: La guarda que falla (y la verificación de colisión, que es lo crítico)**

Antes de aceptar `Alt`+flechas hay que **verificar en los 3 motores**: en Windows/Linux es Atrás/Adelante y el W3C documenta que el navegador *puede ignorar* `preventDefault`.

```javascript
// nudge por teclado con Alt: mueve 15 min sin usar el mouse
const antesNudge = await page.evaluate(() => EVENTS[0].min);
await page.locator("#grilla .ev").first().focus();
await page.keyboard.down("Alt"); await page.keyboard.press("ArrowDown"); await page.keyboard.up("Alt");
await page.waitForTimeout(300);
const trasNudge = await page.evaluate(() => EVENTS[0].min);
const v = [];
if (trasNudge !== antesNudge + 15) v.push(`Alt+ArrowDown no movio 15 min: ${antesNudge} -> ${trasNudge}`);
console.log((v.length ? "  ✗ " : "  ✓ ") + `A2 por teclado · ${antesNudge} -> ${trasNudge}`);
if (v.length) console.log("    violaciones: " + v.join(" | "));
```

**Y la guarda de 2.1.4** — un atajo de una tecla no debe dispararse sin foco en el componente:

```javascript
// 2.1.4: con el foco en un campo de texto, las teclas sueltas no deben disparar acciones
await page.keyboard.press("Escape");
await page.locator("[data-nueva]").click();
await page.waitForTimeout(300);
await page.locator("#p-titulo").focus();
const antes2 = await page.evaluate(() => EVENTS.length);
await page.keyboard.type("hdr1");          // h, d, r, 1: todos eran atajos globales
await page.waitForTimeout(300);
const tras2 = await page.evaluate(() => ({ n: EVENTS.length, valor: document.querySelector("#p-titulo").value }));
const v2 = [];
if (tras2.n !== antes2) v2.push("una tecla suelta disparo una accion con el foco en el campo");
if (tras2.valor !== "hdr1") v2.push(`el campo no recibio el texto: "${tras2.valor}"`);
console.log((v2.length ? "  ✗ " : "  ✓ ") + `2.1.4 atajos acotados al foco · campo "${tras2.valor}" · eventos ${tras2.n}`);
if (v2.length) console.log("    violaciones: " + v2.join(" | "));
await page.keyboard.press("Escape");
```

- [ ] **Step 2: Correr y verificar que fallan**

Expected: `✗ Alt+ArrowDown no movio 15 min` y probablemente `✗ 2.1.4 …` (hoy `h`, `r`, `1/2/3` son globales).

- [ ] **Step 3: Implementar**

```javascript
/* Atajos de una tecla: SOLO con el foco dentro de la grilla o del menu (SC 2.1.4).
   Fuera de ahi, las teclas son texto. */
const EN_GRILLA = () => document.activeElement?.closest("#grilla, #menu, .hoy-btn, [data-view]");

function moverEvento(i, deltaMin) {
  const e = EVENTS[i];
  const nuevo = e.min + deltaMin;
  if (nuevo < START_H * 60 || nuevo + e.dur > END_H * 60) { announce("No entra en el horario visible"); return; }
  e.min = nuevo; LAST_FIT = 0; mount(current);
  requestAnimationFrame(() => {
    const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
    if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }); }
    announce(`${e.title} movida a las ${fmt(e.min)}`);
  });
}
```

En `keydown`, gatear TODO atajo de una tecla con `EN_GRILLA()`:

```javascript
if (!EN_GRILLA()) return;          // primera linea, antes de cualquier atajo suelto
const i = Number(document.activeElement?.dataset?.i ?? -1);
if (i >= 0 && e.altKey && e.key === "ArrowDown") { moverEvento(i, 15); e.preventDefault(); return; }
if (i >= 0 && e.altKey && e.key === "ArrowUp")   { moverEvento(i, -15); e.preventDefault(); return; }
if (i >= 0 && e.altKey && e.key === "ArrowRight"){ moverEventoDia(i, 1); e.preventDefault(); return; }
if (i >= 0 && e.altKey && e.key === "ArrowLeft") { moverEventoDia(i, -1); e.preventDefault(); return; }
if (i >= 0 && e.shiftKey && e.key === "ArrowDown") { cambiarDuracion(i, 15); e.preventDefault(); return; }
if (i >= 0 && e.shiftKey && e.key === "ArrowUp")   { cambiarDuracion(i, -15); e.preventDefault(); return; }
```

- [ ] **Step 4: Verificar la colisión en los 3 motores**

Run (con el arnés apuntando a cada motor):
```bash
node -e "const {chromium,firefox,webkit}=require('playwright');(async()=>{for(const [n,b] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){const br=await b.launch();const p=await br.newPage();await p.setContent('<button id=b>x</button>');await p.focus('#b');await p.keyboard.down('Alt');await p.keyboard.press('ArrowLeft');await p.keyboard.up('Alt');console.log(n, 'url sigue igual:', p.url().startsWith('about:'));await br.close();}})()"
```
Expected: los tres imprimen `true` (el `preventDefault` se respeta). **Si alguno imprime `false`, cambiar el acorde a `Ctrl+Alt`+flechas y registrar el cambio en el spec §9.**

- [ ] **Step 5: Correr el arnés completo y commitear**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -10`
Expected: las dos guardas nuevas `✓`.

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "feat(agenda): nudge por teclado con Alt/Shift y atajos sueltos acotados al foco (2.1.4)"
```

---

### Task 10: Guardas de conformidad, cancelación y tamaño

**Files:** `prototypes/agenda/index.html` (`onDown`/`onMove`/`onUp`, CSS), `scripts/audit-agenda-proto.mjs`

**Interfaces:** ninguna nueva. Es la tarea de cierre: mide que lo anterior sea cierto.

- [ ] **Step 1: Las guardas que faltan**

```javascript
// matriz de conformidad: cada accion tiene sus dos caminos
const matriz = await page.evaluate(() => {
  const antes = JSON.parse(JSON.stringify(EVENTS));
  return { ok: true };   // se completa con las tres comprobaciones de abajo
});

// cancelacion de puntero (SC 2.5.2): Escape durante el arrastre no crea ni mueve
const n0 = await page.evaluate(() => EVENTS.length);
const col = await page.locator('.col[data-day="0"]').boundingBox();
await page.mouse.move(col.x + 40, col.y + 200); await page.mouse.down();
await page.mouse.move(col.x + 40, col.y + 280); await page.keyboard.press("Escape"); await page.mouse.up();
await page.waitForTimeout(300);
const n1 = await page.evaluate(() => EVENTS.length);
if (n1 !== n0) v.push(`Escape durante el arrastre creo ${n1 - n0} evento(s)`);

// tamano: todo objetivo de puntero >= 24x24 px, o excepcion declarada
const chicos = await page.evaluate(() => {
  const EXCEPCIONES = [".ev[data-tiny]", ".ev[data-compact]", ".mev"];   // excepcion "Essential": densidad necesaria
  const sel = "button, a, [role=menuitem], input, [data-dur], [data-paso]";
  return [...document.querySelectorAll(sel)].filter((el) => {
    if (EXCEPCIONES.some((e) => el.matches(e))) return false;
    if (el.closest("#announcer, .sr-only, .skip")) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && (b.width < 24 || b.height < 24);
  }).map((el) => `${el.className.split(" ")[0] || el.tagName}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
});
if (chicos.length) v.push(`objetivos < 24x24 sin excepcion: ${chicos.slice(0, 6).join(", ")}`);

// no-modos: no existe ningun estado del que haya que salir
const modos = await page.evaluate(() => ["[data-modo]", "[aria-grabbed]", "[aria-dropeffect]"].flatMap((s) => [...document.querySelectorAll(s)]).length);
if (modos) v.push(`${modos} elementos con estado de modo o atributos deprecados`);
```

- [ ] **Step 2: Correr y ver las violaciones reales**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -14`
Expected: aparecen los objetivos < 24 px reales (la auditoría predijo manijas de 8 px, `.zoomctl` ~22 px, chips de mes ~23 px). **Se arreglan en el CSS, no se declaran excepción.**

- [ ] **Step 3: Corregir el CSS hasta que la guarda pase**

```css
.zoomctl button, .seg button, .mmas, .bandfold { min-height: 24px; }
.grip { height: 24px; margin-top: -24px; background: transparent; }   /* area, no glifo */
.mev { min-height: 24px; margin-bottom: 6px; }                        /* 24 + 6 de separacion */
```

- [ ] **Step 4: Correr todo y commitear**

Run: `node scripts/audit-agenda-proto.mjs 2>&1 | tail -16`
Expected: **todo verde**, incluida la matriz de conformidad y las guardas nuevas.

```bash
git add prototypes/agenda/index.html scripts/audit-agenda-proto.mjs
git commit -m "test(agenda): guardas de conformidad, cancelacion de puntero y objetivos de 24px"
```

---

## Self-review

**1. Cobertura del spec.** Cada requisito con tarea:

| Spec | Task |
|---|---|
| §4/S1 panel no-modal | 2 |
| §4/S2 click y Enter en hueco | 3 |
| §4/S3 menú de 5 acciones | 5 |
| §4/S4 nudge + `E`/`M`/`D`/`Supr` + `⌘Z` | 9 |
| §4/S6 Lista "Nueva reunión" por día | 3 |
| §5 objetivos de 24 px (excepción *Essential*) | 10 |
| §6 cancelación de puntero | 10 |
| §7 anuncios y foco (sin doble anuncio) | 1, 4 |
| §8 confirmación de borrado | 8 |
| §11 guardas | 1–10 (una por tarea) |
| §12 fases F1, F2, F3, F5 | 2–4, 5–8, 9, 10 |
| §13 auditoría: 1.4.11 | ya corregido en el prototipo; guarda en 10 |

**2. Hueco declarado honestamente:** el spec §4/S2 dice *"`Enter` sobre una celda enfocada"* hace A1 por teclado. **Este plan no lo implementa como cursor de celdas** porque las flechas hoy scrollean la grilla y el APG advierte que un cursor de celdas las consumiría: es un rediseño del modelo de teclado, no un agregado. En su lugar, A1 por teclado entra por **el botón "Nueva reunión" de la toolbar** y **por día en la Lista**, que son caminos conformes. El cursor de celdas queda como **deuda declarada**, con su conflicto explícito, para un plan propio.

**3. Consistencia de nombres:** `announce` (T1) · `abrirPanel`/`cerrarPanel`/`renderPanel`/`guardarPanel` (T2, T4) · `slotDesdeClick` (T3) · `abrirMenu`/`cerrarMenu`/`renderMenu`/`ACCIONES` (T5) · `moverEvento`/`moverEventoDia`/`cambiarDuracion` (T9). `PANEL`, `MENU`, `DRAG_UMBRAL` se usan con el mismo nombre en todas las tareas.

**4. Falta una tarea que la auditoría pedía y este plan deja afuera:** `⌘Z` (deshacer). El spec lo promete en §8 y §4/S4, y **ninguna tarea lo implementa**. Se declara como deuda explícita, no se deja implícito: **mover y redimensionar anuncian pero no se pueden deshacer todavía**, y por eso la confirmación de borrado (Task 8) es obligatoria.

---

**Plan completo y guardado en `docs/superpowers/plans/2026-09-16-crm-agenda-operar-sin-mouse.md`. Dos opciones de ejecución:**

**1. Por subagentes (recomendada)** — despacho un subagente fresco por tarea, con revisión entre tareas e iteración rápida.

**2. En esta sesión** — ejecuto las tareas acá con checkpoints para revisar.

**¿Cuál preferís?**
