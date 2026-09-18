# Regresión visual para probar que el port de la agenda renderiza el diseño del prototipo

**Fecha:** 2026-09-18
**Alcance:** comparar píxel a píxel `prototypes/agenda/index.html` (referencia, HTML+JS vainilla) contra la app React 18 + TS + Vite servida en `/hoy`. Decidir si hace falta una herramienta de VRT o si alcanza Playwright, y cómo comparar dos páginas vivas sin baseline almacenada.
**Contexto del repo:** ya hay Playwright (`playwright@^1.63.0`, `package.json:20`), E2E crudo (`scripts/e2e_hoy.mjs`), y un arnés de medición propio (`scripts/audit-agenda-proto.mjs`) que mide contraste, foco, target size y líneas de grilla **cargando el prototipo, no la app**. No existe `playwright.config.*` ni `@playwright/test`.
**Regla:** cada afirmación técnica lleva URL de fuente. Lo que no pude verificar está marcado en §"Lo que no pude verificar".

---

## TL;DR (el veredicto en cinco líneas)

1. **Sí, Playwright puede sacarle screenshot al prototipo y a la app en el mismo viewport y diferenciarlas.** No hace falta ninguna herramienta de VRT de pago. El mecanismo documentado que más te sirve es **generar un baseline desde el prototipo y comparar la app contra ese archivo** con `expect(page).toHaveScreenshot('nombre.png')` (o `toMatchSnapshot(buffer)`), no comparar dos vivos "a mano" (Playwright no tiene un matcher A/B de dos páginas; ver §3).
2. **El requisito que hoy falta es `@playwright/test`.** `toHaveScreenshot` y `toMatchSnapshot` explicitan "solo funcionan con el test runner" ([docs](https://playwright.dev/docs/api/class-pageassertions)). Alternativa sin migrar: screenshot crudo + `pixelmatch` en tu script actual (§3).
3. **El problema real no va a ser el algoritmo de diff, va a ser el determinismo y los datos.** El prototipo tiene eventos hardcodeados y "hoy" fijo; la app carga eventos reales. Un diff de píxeles sobre contenido que no es el mismo falla siempre. Antes de comparar hay que **sembrar los mismos datos y congelar el reloj** (`page.clock.setFixedTime`, [docs](https://playwright.dev/docs/clock)).
4. **`animations: 'disabled'`, `caret: 'hide'` y `scale: 'css'` ya vienen por defecto** en `toHaveScreenshot`; `threshold` es `0.2`; `maxDiffPixels`/`maxDiffPixelRatio` vienen **sin setear**. Fuente: [PageAssertions](https://playwright.dev/docs/api/class-pageassertions).
5. **Chromatic/Percy/Lost Pixel sobran para este caso.** Lost Pixel está **archivado y descontinuado** (abril 2026, se une a Figma), Chromatic arranca en **$179/mes** y Percy en **$199/mes** ([Chromatic pricing](https://www.chromatic.com/pricing), [BrowserStack Percy](https://www.browserstack.com/pricing?product=percy)). Para un usuario y un repo que ya usa Playwright, la respuesta honesta es **Playwright local/on-demand**, no SaaS ni Storybook.

---

## 1. La técnica central: screenshot del prototipo + screenshot de la app + diff con Playwright

### 1.1 Cómo funcionan los baselines

`expect(page).toHaveScreenshot()` escribe un "golden file" la primera vez y en las siguientes corridas compara contra él. Espera hasta que **dos screenshots consecutivos sean iguales** y recién ahí compara el último contra la expectativa — eso es lo que la hace razonablemente estable frente a renders tardíos ([PageAssertions](https://playwright.dev/docs/api/class-pageassertions), [Visual comparisons](https://playwright.dev/docs/test-snapshots)).

- **Dónde viven:** junto al archivo de test, en una carpeta `<archivo>.spec.ts-snapshots/`. El nombre por defecto es `<nombre-auto>-<proyecto-o-browser>-<plataforma>.png` (p. ej. `example-test-1-chromium-darwin.png`). "You should commit this directory to your version control" ([Visual comparisons](https://playwright.dev/docs/test-snapshots)).
- **Actualizar:** `npx playwright test --update-snapshots` ([Visual comparisons](https://playwright.dev/docs/test-snapshots)).
- **`snapshotPathTemplate`:** controla nombre y ruta; se define en `playwright.config`, global o por proyecto. Tokens disponibles: `{testDir}`, `{testFileDir}`, `{testFileName}`, `{testFileBaseName}`, `{testFilePath}`, `{testName}`, `{arg}`, `{ext}`, `{snapshotDir}`, `{snapshotSuffix}`, `{projectName}`, `{platform}` ([docs](https://playwright.dev/docs/test-snapshots), [tests del propio Playwright](https://github.com/microsoft/playwright/blob/main/tests/playwright-test/snapshot-path-template.spec.ts)). El **default** es `{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}` — lo deduzco de que Microsoft lo describe como "exactly like the default path" al mostrar `...{arg}{-projectName}-linux{ext}` ([MS Learn](https://learn.microsoft.com/en-us/azure/app-testing/playwright-workspaces/how-to-configure-visual-comparisons)); no lo encontré escrito literal en la API de `TestConfig`, así que queda como **inferencia**, no cita textual.
- **Formato:** PNG por defecto; `.webp` es opcional y también lossless.
- **Motor de diff:** Playwright usa `pixelmatch` internamente ([Visual comparisons](https://playwright.dev/docs/test-snapshots)).

### 1.2 Las perillas, con sus defaults reales

| Opción | Qué hace | Default (verificado) | Fuente |
|---|---|---|---|
| `animations` | `"disabled"`: adelanta animaciones/transiciones finitas y cancela las infinitas al estado inicial | `"disabled"` | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `caret` | `"hide"`: oculta el cursor de texto | `"hide"` | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `scale` | `"css"`: 1 px por píxel CSS (no por device px). `"device"`: 1 px por device px | `"css"` | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `threshold` | Diferencia de color percibida en espacio YIQ, 0..1 | `0.2` | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `maxDiffPixels` | Nº de píxeles distintos tolerados | **sin setear** | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `maxDiffPixelRatio` | Proporción de píxeles distintos, 0..1 | **sin setear** | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `mask` | Lista de locators tapados con un recuadro `#FF00FF` | — | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `maskColor` | Color del recuadro del mask | `#FF00FF` | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `stylePath` | CSS inyectado solo durante el screenshot (oculta elementos volátiles, atraviesa Shadow DOM) | — | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `fullPage` | Captura todo el scroll, no solo el viewport | `false` | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `clip` | Recorta a un rectángulo | — | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| `timeout` | Reintentos de la aserción | `expect.timeout` (5 s) | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |

**Recomendación de valores sanos para este repo** (basada en el tipo de UI, no en un número mágico): dejar `threshold` en `0.2` (default), poner `maxDiffPixelRatio: 0.01` y `maxDiffPixels: 500` **solo después** de haber estabilizado el entorno; si necesitás tapar reloj/avatares usá `mask`, no subas el ratio. El ratio alto esconde regresiones reales.

### 1.3 Diferencias entre browsers y sistemas operativos (esto es lo que rompe los baselines)

La doc es explícita: *"Browser rendering can vary based on the host OS, version, settings, hardware, power source (battery vs. power adapter), headless mode, and other factors. For consistent screenshots, run tests in the same environment where the baseline screenshots were generated."* ([Visual comparisons](https://playwright.dev/docs/test-snapshots)). Por eso el nombre del golden incluye browser y plataforma: los snapshots **no son portables** entre OS ([Visual comparisons](https://playwright.dev/docs/test-snapshots)).

Cómo lo resuelven los equipos (documentado / mecánico):

- **Mismo entorno de generación y de comparación.** Si el baseline se generó en tu Mac con Node local, correlo en tu Mac. Si querés CI Linux, generá el baseline **en ese mismo contenedor**.
- **Contenedor oficial de Playwright**, versión pinneada: `mcr.microsoft.com/playwright:v1.63.0-noble`. *"It is recommended to always pin your Docker image to a specific version"* ([Docker](https://playwright.dev/docs/docker)). Elimina diferencias de fuentes del sistema entre máquinas.
- **La variación de fuentes/subpíxel AA es la causa dominante.** La mitigación real es (a) mismo OS/contenedor, (b) esperar a que la fuente cargue, y (c) no pelear con `threshold`. BackstopJS documenta el mismo problema con un ejemplo de texto renderizado distinto entre Linux y Mac, y lo resuelve con su flag `--docker` ([BackstopJS](https://github.com/garris/BackstopJS)).

### 1.4 Estabilidad: reloj, fuentes, DPR, regiones dinámicas

- **Fuentes:** esperar `document.fonts.ready`. Devuelve una promesa que se cumple cuando *"loading and layout operations of all used fonts are done"* (MDN, [Document.fonts](https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts)). Ojo con `font-display: swap`: la promesa puede cumplirse con una fuente de fallback y repintar después. Para VRT conviene usar `font-display: block` o embeber la fuente. `toHaveScreenshot` no espera fuentes por sí solo; sí mitiga con su chequeo de "dos screenshots consecutivos iguales", pero eso no reemplaza esperar `fonts.ready` y un `waitForSelector` del layout estable.
- **Reloj / "ahora":** la API `page.clock` controla `Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `performance` y `Event.timeStamp`. `setFixedTime(date)` fija `Date.now()` sin frenar los timers; `install({ time })` permite `pauseAt`/`fastForward`. ([Clock](https://playwright.dev/docs/clock)). Es la herramienta correcta para el indicador de "hora actual" y la línea de "ahora" de la agenda.
- **DPR (`deviceScaleFactor`):** se fija al crear el contexto (`browser.newContext({ deviceScaleFactor: 2 })`, como ya hacen `verify-agenda-proto.mjs:13` y `e2e_hoy.mjs:13`). Con `scale: 'css'` (default) el screenshot sale en píxeles CSS aunque el DPR sea 2; con `scale: 'device'` sale al doble. **Sea cual sea, fijalo idéntico en las dos capturas**; si no, las dimensiones no coinciden y `pixelmatch` falla por tamaño ([pixelmatch](https://github.com/mapbox/pixelmatch) exige dimensiones iguales).
- **Regiones dinámicas:** `mask` (recuadro sólido) o `stylePath` (CSS que las hace visibles/invisibles/transparentes) ([PageAssertions](https://playwright.dev/docs/api/class-pageassertions)). En la agenda: reloj, pill de sync, avatares, "sin sincronizar", cualquier `aria-live`.
- **Animaciones:** ya vienen deshabilitadas en `toHaveScreenshot`. Para un `page.screenshot()` crudo hay que setear `animations: 'disabled'` explícitamente (mismas opciones visuales que la aserción; ver nota de no-verificado).

### 1.5 La receta concreta: el prototipo como baseline, la app como "actual"

**El truco:** hacer que el screenshot del prototipo y el de la app resuelvan al **mismo archivo de snapshot**, usando un `snapshotPathTemplate` que solo dependa de `{arg}` y pasando un nombre explícito idéntico en las dos aserciones. Así generás el golden una vez desde el prototipo y todas las corridas comparan la app contra el diseño aprobado.

`playwright.config.ts` (ilustrativo):

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  // Misma ruta para ambos specs: el nombre del archivo decide el golden.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // Los defaults (animations/caret/scale) ya son los correctos.
      maxDiffPixelRatio: 0.01,
      maxDiffPixels: 500,
    },
  },
  use: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,          // fijo e idéntico en prototipo y app
    // reducedMotion también ayuda a estabilizar transiciones
    // (page.emulateMedia / use: { reducedMotion: 'reduce' })
  },
});
```

Spec que genera el golden **desde el prototipo** (correr una sola vez con `--update-snapshots`):

```ts
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';

test('golden: agenda del prototipo', async ({ page }) => {
  await page.goto(pathToFileURL('prototypes/agenda/index.html').href + '?v=1');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.gridwrap');
  // Congelar el reloj del prototipo, si lo usa.
  await page.clock.setFixedTime(new Date('2026-09-16T10:00:00'));
  // Tapar el chrome que solo existe en el prototipo (picker de variantes).
  await expect(page.locator('.shell')).toHaveScreenshot('agenda-semana.png', {
    mask: [page.locator('.proto-picker'), page.locator('.proto-switch')],
  });
});
```

Spec que **verifica la app** contra ese golden:

```ts
import { test, expect } from '@playwright/test';

test('la app /hoy renderiza el diseño del prototipo', async ({ page }) => {
  await page.goto('/hoy');                       // requiere baseURL + auth (storageState)
  await page.getByRole('button', { name: 'Hoy' }).click();
  await page.waitForSelector('.wrap');
  await page.evaluate(() => document.fonts.ready);
  await page.clock.setFixedTime(new Date('2026-09-16T10:00:00'));  // mismo instante
  await expect(page.locator('#app, .shell').first()).toHaveScreenshot('agenda-semana.png', {
    mask: [page.locator('.pill'), page.locator('.avatar')],
  });
});
```

Notas duras:

- Esto **requiere migrar a `@playwright/test`**. `toHaveScreenshot` no existe en la librería cruda ("only work with Playwright test runner", [PageAssertions](https://playwright.dev/docs/api/class-pageassertions)).
- La aserción **compara el contenido tal cual**. Si el prototipo tiene 8 eventos hardcodeados y `/hoy` tiene los eventos reales del día, el diff va a mostrar las zonas de eventos todas en rojo. Para que la comparación diga algo del **diseño** y no de los **datos**, hay que darle a la app el mismo fixture (ver §3.4).
- Si no querés migrar: usá el mismo truco pero con `page.screenshot()` crudo y `pixelmatch`/`odiff`; ver §3.5.

### 1.6 Alternativa de un solo archivo sin `@playwright/test` (pixelmatch)

`pixelmatch` es ISC, sin dependencias, y es el mismo motor que usa Playwright; acepta `threshold`, `includeAA`, `diffMask` y `windowSize` (máximo de píxeles distintos en una ventana N×N, para que el AA disperso no cuente como regresión) ([pixelmatch](https://github.com/mapbox/pixelmatch)). `odiff` es MIT, nativo SIMD, hasta ~6× más rápido en pantallas grandes, con `ignoreRegions` y binding `playwright-odiff` ([odiff](https://github.com/dmtrKovalenko/odiff)). Para un usuario y 3–6 screenshots por corrida, `pixelmatch` sobra.

---

## 2. Alternativas: ¿hace falta alguna?

| Opción | Qué agrega sobre Playwright puro | Qué cuesta | ¿Corre local sin SaaS? | Fuente |
|---|---|---|---|---|
| **Playwright `toHaveScreenshot`** | Baselines, diff, `mask`, `stylePath`, reporte HTML del runner | Cero (ya está la dep). Requiere `@playwright/test` y un baseline por browser/OS | **Sí** | [docs](https://playwright.dev/docs/test-snapshots) |
| **`pixelmatch` / `odiff`** | Motor de diff suelto, para A/B sin baseline o para tu script crudo | Cero | **Sí** | [pixelmatch](https://github.com/mapbox/pixelmatch), [odiff](https://github.com/dmtrKovalenko/odiff) |
| **BackstopJS** | Runner + reporte HTML con "aprobar/rechazar", Docker integrado, motor Playwright/Puppeteer, `referenceUrl` para comparar dos endpoints | Cero (MIT), pero es Otra Herramienta; **busca nuevo maintainer** | **Sí** | [BackstopJS](https://github.com/garris/BackstopJS) |
| **reg-viz / reg-cli** | Diff + reporte HTML/JUnit/JSON a partir de dos carpetas (`actual`/`expected`); API `compare()` usada por reg-suit | Cero (MIT). Es solo el comparador: vos generás las imágenes | **Sí** | [reg-cli](https://github.com/reg-viz/reg-cli) |
| **Lost Pixel** | OSS de VRT con integración Storybook/Ladle/pages/custom shots; modo OSS `generateOnly`+`failOnDifference` | MIT, pero **repo archivado (abr-2026), producto descontinuado**, equipo se va a Figma | Solo el modo OSS, sin soporte | [Lost Pixel](https://github.com/lost-pixel/lost-pixel) |
| **Storybook + Chromatic** | Baselines en la nube, cross-browser, UI de revisión, TurboSnap, tests de interacción/a11y | **Free: 5.000 snapshots (solo Chrome) · Starter $179/mes (35.000)** | **No**: la VRT de Storybook corre en la nube de Chromatic | [Storybook](https://storybook.js.org/docs/writing-tests/visual-testing), [Chromatic](https://www.chromatic.com/pricing) |
| **Percy (BrowserStack)** | Igual categoría SaaS, rendering propio cross-browser | **Free: 5.000 screenshots · $199/mes (10.000) · $599/mes (25.000)** | **No** | [BrowserStack pricing](https://www.browserstack.com/pricing?product=percy), [FAQ](https://www.browserstack.com/support/faq/plans-pricing/plans/what-is-included-in-percys-plans) |

### Recomendación §2

**Playwright puro, sin herramienta externa.** El repo ya usa Playwright, ya tiene un arnés de medición custom, y la comparación que querés es de **una sola pantalla contra una referencia conocida** — exactamente lo que `toHaveScreenshot` hace. Chromatic/Percy agregan colaboración, revisión por PR y cross-browser que **un usuario único no consume**, y meten un SaaS que ve el HTML del CRM (privacidad) más una dependencia que puede cambiar de precio. Storybook es una segunda app para mantener y no hace falta para comparar `/hoy` contra un HTML. **`pixelmatch` o `odiff` son el único complemento con sentido** si preferís no migrar a `@playwright/test`.

Tradeoff honesto: Playwright puro deja el riesgo de "baselines ruidosos" y hay que invertir en estabilizar (fuentes, reloj, máscaras), que es trabajo real. Chromatic resuelve eso y el review, pero a **$179/mes mínimo usable** y con la UI expuesta en la nube. Para un solo dueño, la balanza está clara.

---

## 3. Comparar dos páginas vivas sin baseline almacenada

### 3.1 ¿Es sólido? Sí, pero **no es el patrón que Playwright documenta**

No existe en Playwright un matcher nativo "compará esta página con esta otra". Sus dos aserciones visuales comparan **contra un archivo almacenado**: `toHaveScreenshot` contra un golden ([PageAssertions](https://playwright.dev/docs/api/class-pageassertions)), y `toMatchSnapshot(value)` contra un snapshot en disco ([SnapshotAssertions](https://playwright.dev/docs/api/class-snapshotassertions)). **No hay API de A/B entre dos páginas vivas.** Ese es el hallazgo, y conviene decirlo sin vueltas.

Sí podés comparar dos vivos, de dos formas:

- **Manual:** `pageA.screenshot()` y `pageB.screenshot()` a buffers, y pasarlos por `pixelmatch`/`odiff`. Es lo que hacen los ejemplos de la comunidad. No está en la doc oficial de Playwright; es un patrón de la comunidad ([ejemplo de "contract test" baseline-free](https://github.com/BiancaTap/visual-regression-suite) — repo de terceros, no fuente primaria).
- **Vía truco de baseline compartido:** el de §1.5 (el prototipo como golden, la app como actual). Es la versión documentada y reproducible de "comparar dos implementaciones".

**El patrón documentado más cercano que encontré es de BackstopJS:** `referenceUrl`. *"Comparing different endpoints (e.g. comparing staging and production)"*: definís `url` (test) y `referenceUrl` (referencia), `backstop reference` genera las imágenes de referencia y `backstop test` las compara ([BackstopJS](https://github.com/garris/BackstopJS)). Es un baseline de la referencia, no un A/B en memoria, pero es la respuesta oficial a "comparar dos implementaciones". Fuera de eso, **comparar dos apps vivas en la misma sesión es uncommon** y no encontré una receta primera-parte de Playwright.

### 3.2 Pitfalls de A/B en la misma sesión (los que te van a morder)

| Pitfall | Por qué rompe | Mitigación |
|---|---|---|
| **Fuentes distintas** | Si el prototipo carga una webfont que la app no (o viceversa), el texto difiere píxel a píxel y no significa nada | Comparar `getComputedStyle(el).fontFamily` de ambos; embeber la misma fuente o forzar fuentes del sistema |
| **DPR / escala distinta** | `pixelmatch` exige mismas dimensiones; imágenes de distinto tamaño fallan | Mismo `deviceScaleFactor` y mismo `scale` en ambas capturas |
| **Vista / ruta distinta** | El prototipo arranca en una variante; la app arranca en "Agenda" y hay que ir a "Hoy" | Fijar los mismos parámetros (`?v=1`, `?view=semana`) y navegar la app al mismo estado |
| **Contenido dinámico** | Reloj, "ahora", pill de sync, avatares | `page.clock.setFixedTime` ([Clock](https://playwright.dev/docs/clock)) + `mask` |
| **Chrome del prototipo** | El `.proto-picker`/`.proto-switch` de variantes no existe en la app | `mask` con el locator del picker, o `stylePath` que lo oculte |
| **Chrome de la app** | Las `.tabs` y el shell de Frappe no existen en el prototipo | Capturar solo el subárbol común (`.shell`/`#app`), no `fullPage` |
| **Layout asíncrono** | React monta después; el prototipo quizá es síncrono | `waitForSelector` de un nodo estable + `document.fonts.ready`; **no** `networkidle` (desaconsejado, ver research previa) |
| **Datos distintos (el peor)** | Prototipo = 8 reuniones ficticias; app = reuniones reales de la base | Sembrar el mismo fixture en la app / mockear la API, o comparar solo el "chrome" (grilla, sidebar, ejes) tapando los bloques de eventos |

### 3.3 El límite conceptual: ¿qué prueba un diff píxel a píxel?

Un diff contra el prototipo prueba que **el chrome y la geometría** (topbar, sidebar, grilla, densidad, tipografías, colores, líneas) coinciden. No prueba que la **interacción** funcione — eso lo cubre el E2E — ni que los datos se vean bien con longitudes arbitrarias. La comparación honesta es *"el armazón visual renderiza como el diseño aprobado"*, y para eso conviene **una captura por vista** (Semana, Lista, Mes) y por densidad, con los eventos tapados o con un fixture idéntico.

### 3.4 Cómo sembrar el mismo contenido (la decisión que habilita todo)

Opciones, de mejor a peor:

1. **Mock de la API de la app con un fixture igual al prototipo.** `page.route('**/api/method/*get_agenda*', ...)` devolviendo los mismos eventos. **Ojo:** la research previa verificó que `page.route` **no intercepta `blob:`** en Chromium/Firefox ([interception.spec.ts](https://github.com/microsoft/playwright/blob/c0cc9802/tests/page/interception.spec.ts)). Si el bundle de `/hoy` sigue corriendo desde Blob/base64, esto no sirve; si ya se sirve inline (el port a `www/hoy.html` autocontenido), hay que **reprobar** que `page.route` sí intercepta. **No verificado en esta sesión.**
2. **Sembrar la base con las reuniones del prototipo** antes del test y limpiarlas después (el repo ya tiene el patrón INSERT→READ→DELETE en `scripts/smoke_prod.py:16-29`).
3. **Comparar solo el chrome** tapando `.ev`/`.mev` con `mask`. Pierde la validación de los bloques, pero sigue atrapando regresiones de layout/color/tipografía.

### 3.5 Receta A/B en un script (sin `@playwright/test`)

Para no reescribir todo el runner, un script con la librería cruda que hace lo mínimo:

```js
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

async function shot(url, prep) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.clock.setFixedTime(new Date('2026-09-16T10:00:00'));
  if (prep) await prep(page);
  const buf = await page.locator('.shell').screenshot({   // región común
    animations: 'disabled', caret: 'hide',
    mask: [page.locator('.proto-picker'), page.locator('.pill')],
  });
  await page.close();
  return buf;
}

const proto = PNG.sync.read(await shot(
  pathToFileURL('prototypes/agenda/index.html').href + '?v=1'));
const app = PNG.sync.read(await shot('https://crm.marcosbarbosagroup.com/hoy', async (p) => {
  await p.getByRole('button', { name: 'Hoy' }).click();
  await p.waitForSelector('.wrap');
}));

if (proto.width !== app.width || proto.height !== app.height)
  throw new Error(`dimensiones distintas ${proto.width}x${proto.height} vs ${app.width}x${app.height}`);

const diff = new PNG({ width: proto.width, height: proto.height });
const n = pixelmatch(proto.data, app.data, diff.data, proto.width, proto.height, {
  threshold: 0.2,
  windowSize: 16,     // ignora AA disperso, castiga cambios concentrados
});
console.log(`píxeles distintos: ${n}`);
if (n > 500) process.exit(1);
```

Esto no usa baseline, corre local, y es la forma más barata de empezar. Su debilidad es que no tiene reporte ni aprobación: solo un número y un `diff.png`.

---

## 4. Accesibilidad en la misma suite: axe-core

`@axe-core/playwright` es la forma soportada de correr axe dentro de Playwright: `new AxeBuilder({ page }).withTags([...]).include(...).analyze()`; se puede escanear después de **conducir estados interactivos** (abrir panel, menú, cambiar de vista) ([Playwright + axe](https://playwright.dev/docs/accessibility-testing)).

### Qué atrapa (verificado contra la tabla de reglas de axe-core)

- `color-contrast` de **texto** (1.4.3 AA) — con `incomplete` cuando no puede muestrear imagen/gradiente/overlay.
- Nombres accesibles: `button-name`, `link-name`, `aria-command-name`, `aria-dialog-name`, `label`, `select-name`.
- Validez de roles/atributos ARIA (`aria-roles`, `aria-required-attr`, `aria-valid-attr*`, `aria-hidden-focus`, `nested-interactive`).
- `html-has-lang`, `html-lang-valid`, `document-title`, `bypass` (skip link), `scrollable-region-focusable`.

Fuente: [axe-core rule descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md).

### Qué **no** atrapa (y por eso tu arnés sigue siendo la autoridad)

- **Contraste del indicador de foco** (1.4.11 / 2.4.11): no existe regla. La tabla de axe no tiene ninguna de "focus appearance".
- **Contraste de bordes/líneas de UI** (1.4.11): `color-contrast` es solo texto; no hay regla de bordes/grilla.
- **Existencia y persistencia de `aria-live`** (4.1.3): no hay regla.
- **Orden de foco** (2.4.3): solo `focus-order-semantics` **experimental**, y evalúa el rol apropiado, no el orden.
- **Operabilidad por teclado real**: requiere ejecutar la interacción, no un snapshot.

Exactamente los invariantes que mide `scripts/audit-agenda-proto.mjs` (`:229-243` foco, `:174-190` líneas, `:227`/`:374-404` aria-live). La investigación previa del repo llegó a la misma conclusión (`docs/superpowers/research/2026-09-17-shipping-verificacion-frontend-prod.md:126-143`).

### `target-size` — la afirmación, verificada

**Confirmado: está apagada por defecto.** La tabla de axe agrupa la sección **WCAG 2.2 Level A & AA Rules** con el texto: *"These rules are disabled by default, until WCAG 2.2 is more widely adopted and required."* y `target-size` (2.5.8) está en esa sección ([rule-descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)). Para habilitarla: `withTags([..., 'wcag22aa'])` o override de reglas.

### Recomendación §4

**Complementario, no redundante.** Agregá `@axe-core/playwright` con `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])`, hacelo **después** de abrir panel/menú y cambiar de vista, y dejá el arnés custom como autoridad de foco/líneas/aria-live/teclado. No apagues reglas sin registrar por qué; `exclude()` apaga **todas** las reglas sobre ese subárbol y sus descendientes ([Playwright + axe](https://playwright.dev/docs/accessibility-testing)). Reportá `incomplete` aparte (no es un pass).

---

## 5. CI y workflow local para una app de un solo usuario

### 5.1 El estado real del repo

- No hay `playwright.config.*` ni `@playwright/test` (solo `playwright@^1.63.0` en `package.json:20`).
- El E2E es un script crudo contra el sitio real, con token de API, que **captura pero no afirma** `pageerror` (`scripts/e2e_hoy.mjs:17-21, 63-65`).
- El deploy es un shell script desde un VPS; el health check solo mira `1/1` + HTTP ([research previa](2026-09-17-shipping-verificacion-frontend-prod.md:21-29)).
- La research previa ya recomendó `@playwright/test` + `storageState` + usuario de test y afirmar `pageerror` (§2.6 de ese doc).

### 5.2 Setup mínimo viable (para que **vos** veas la regresión antes que el dueño)

| Pieza | Decisión | Por qué | Fuente |
|---|---|---|---|
| **Runner** | Migrar a `@playwright/test` con `playwright.config.ts` | Es prerequisito de `toHaveScreenshot` y da reporte/trace | [PageAssertions](https://playwright.dev/docs/api/class-pageassertions) |
| **Baselines** | **En el repo**, en `__screenshots__/` | Playwright dice explícitamente commitear el directorio de snapshots | [Visual comparisons](https://playwright.dev/docs/test-snapshots) |
| **Entorno** | Baseline y comparación **en tu Mac** (o ambos en el mismo contenedor pinneado) | El render varía por OS/hardware; no son portables | [Visual comparisons](https://playwright.dev/docs/test-snapshots), [Docker](https://playwright.dev/docs/docker) |
| **Auth** | `storageState` de un usuario de test (no `Administrator` temporal) | Ya recomendado en la research previa; el token de admin efímero es un riesgo | [Playwright auth](https://playwright.dev/docs/auth) |
| **Gate** | **On-demand antes del deploy**, no en GitHub Actions | El E2E necesita red y credenciales de prod; el CI actual no corre E2E y tiene `continue-on-error` | research previa §2.2, `deploy-crm.sh` |
| **Ruido** | `mask` (reloj/pill/avatares) + `setFixedTime` + `fonts.ready` + `maxDiffPixelRatio: 0.01` | Ataca las tres fuentes reales de flakiness | §1.3–1.4 |

### 5.3 ¿Cuánto de esto es over-engineering?

Honesto: **una suite de VRT permanente con CI y mantenimiento de baselines es over-engineering para una app de un usuario.** El costo no es el código, es el ruido: cada baseline que falla por una fuente distinta o un dato que cambió obliga a revisar y regenerar. Para n=1, el retorno real está en **un momento concreto: probar que el port renderiza el diseño**, no en vigilar `/hoy` para siempre.

Recomendación por etapas:

1. **Ahora (el port):** un script/on-demand que compare prototipo vs `/hoy` en las 3 vistas, con el mismo fixture y reloj congelado. Esto es lo que responde tu pregunta y no necesita CI. El `diff.png` es el entregable.
2. **Después:** si querés proteger el diseño a futuro, dejá **un** test `toHaveScreenshot` por vista (baseline = prototipo) y correlo a mano antes de deployar. No lo pongas en Actions con `retries` y umbrales altos: eso es teatro.
3. **Lo que NO hagas:** Storybook + Chromatic, Percy, Lost Pixel. No compran nada a n=1, y Lost Pixel además está descontinuado ([Lost Pixel](https://github.com/lost-pixel/lost-pixel)).

---

## Lo que no pude verificar

- **El default textual de `snapshotPathTemplate`.** La deduje de que Microsoft lo describe como "exactly like the default path" ([MS Learn](https://learn.microsoft.com/en-us/azure/app-testing/playwright-workspaces/how-to-configure-visual-comparisons)); no la leí literal en la API de `TestConfig` en esta sesión.
- **Opciones de `page.screenshot()` crudo** (`animations`, `caret`, `mask`, `scale`): las vi documentadas en `toHaveScreenshot` ([PageAssertions](https://playwright.dev/docs/api/class-pageassertions)); no fetcheé `class-page#page-screenshot` para confirmarlas una por una. Reproducir antes de depender del script de §3.5.
- **Si `page.route` intercepta la API de `/hoy`** con la entrega actual del bundle (inline vs Blob). La research previa verificó que `blob:` no se intercepta ([interception.spec.ts](https://github.com/microsoft/playwright/blob/c0cc9802/tests/page/interception.spec.ts)); con el shell autocontenido hay que reprobarlo.
- **El HTML/estructura exactos del prototipo** (¿tiene reloj vivo? ¿qué fuentes carga? ¿qué selector es el contenedor común?). Leí los scripts que lo consumen (`verify-agenda-proto.mjs`, `audit-agenda-proto.mjs`) pero no el `prototypes/agenda/index.html` completo; los selectores de la receta (`.shell`, `.proto-picker`, `.pill`) salen de esos scripts y hay que ajustarlos.
- **Precios de Percy:** la página `percy.io/pricing` devolvió vacío y un tercero ([Argos](https://argos-ci.com/blog/visual-testing-pricing)) afirma que Percy ya no publica precios; usé la página viva de BrowserStack ([Desktop $199 / Desktop+Mobile $599](https://www.browserstack.com/pricing?product=percy)). Puede cambiar.
- **`aria-live` en axe:** la ausencia de regla se lee de la tabla de axe; el issue de Deque que la confirma (§3.3 de la research previa) no lo volví a fetchear en esta sesión.

---

## Fuentes (primarias)

**Playwright**
- Visual comparisons: https://playwright.dev/docs/test-snapshots
- PageAssertions (`toHaveScreenshot`, defaults): https://playwright.dev/docs/api/class-pageassertions
- SnapshotAssertions (`toMatchSnapshot(buffer)`): https://playwright.dev/docs/api/class-snapshotassertions
- Test configuration (`expect`, `snapshotPathTemplate`): https://playwright.dev/docs/test-configuration
- Accessibility testing (axe): https://playwright.dev/docs/accessibility-testing
- Clock / `setFixedTime`: https://playwright.dev/docs/clock
- Docker (contenedor pinneado): https://playwright.dev/docs/docker
- Test oficial de `snapshotPathTemplate`: https://github.com/microsoft/playwright/blob/main/tests/playwright-test/snapshot-path-template.spec.ts
- Default inferido, "exactly like the default path": https://learn.microsoft.com/en-us/azure/app-testing/playwright-workspaces/how-to-configure-visual-comparisons

**Navegador / fuentes**
- `document.fonts.ready` (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts

**Diff engines**
- pixelmatch: https://github.com/mapbox/pixelmatch
- odiff (+ `playwright-odiff`): https://github.com/dmtrKovalenko/odiff

**Herramientas de VRT**
- BackstopJS (`referenceUrl`, Docker): https://github.com/garris/BackstopJS
- reg-cli: https://github.com/reg-viz/reg-cli
- Lost Pixel (archivado/descontinuado): https://github.com/lost-pixel/lost-pixel
- Storybook visual testing: https://storybook.js.org/docs/writing-tests/visual-testing
- Chromatic pricing: https://www.chromatic.com/pricing
- BrowserStack Percy pricing: https://www.browserstack.com/pricing?product=percy
- Percy plans FAQ: https://www.browserstack.com/support/faq/plans-pricing/plans/what-is-included-in-percys-plans

**Accesibilidad**
- axe-core rule descriptions (`target-size` off por defecto): https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md

**Internas del repo**
- `scripts/audit-agenda-proto.mjs` (arnés de medición)
- `scripts/e2e_hoy.mjs`, `scripts/verify-agenda-proto.mjs`
- `docs/superpowers/specs/2026-09-17-agenda-port-a-prod-design.md`
- `docs/superpowers/research/2026-09-17-shipping-verificacion-frontend-prod.md`
