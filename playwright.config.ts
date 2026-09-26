import { defineConfig } from "@playwright/test";

// Comparación visual prototipo vs app (D3). Correr A DEMANDA, no en CI: para un
// solo usuario una suite permanente con baselines vivos es sobre-ingeniería
// (research 2026-09-18-visual-regression-prototipo-vs-react.md §5.3).
//
// El golden se genera DESDE EL PROTOTIPO y la app se compara contra ESE archivo.
// El `snapshotPathTemplate` compartido —solo depende de `{arg}`— hace que el
// golden spec y el visual spec resuelvan al mismo PNG aunque vivan en archivos
// distintos. Por eso NO corremos ambos con --update-snapshots: ver package.json.
// La app se sirve bajo `/assets/crm_core/web/`; el helper navega a esa ruta
// absoluta para que la inyección del chrome matchee el documento (y no el
// fallback de `/`). El `baseURL` es el origen, no el base path.
//
// ── Los DOS proyectos, y por qué la suite está partida ──────────────────────
//
//  · `hermetico` (lo que corre `npm run test` y, por lo tanto, CI): geometría de
//    la agenda y comportamiento. No depende de la red ni del golden, así que da
//    el mismo resultado en cualquier máquina y en cualquier sistema operativo.
//
//  · `visual` (a demanda, `npm run fidelity:visual`): el golden del prototipo, la
//    comparación de la app contra él y la fidelidad medida. NO puede ir a CI por
//    dos razones concretas, ambas verificables:
//
//    1. Las tres fuentes de marca (Fraunces, Outfit, JetBrains Mono) se sirven de
//       `fonts.googleapis.com` por `<link>`, sin self-host. Sin red caen a las de
//       reserva y TODA la métrica de texto cambia: la alineación de línea base de
//       la barra —de la que depende el alto de hora— y el ancho de las filas de la
//       lista —que es shrink-to-fit— son distintos. El golden no valdría.
//    2. El `snapshotPathTemplate` no lleva la plataforma, así que un golden
//       generado en Linux se compara contra uno de macOS y el diff es ruido del
//       rasterizador. `agenda.fidelity.spec.ts` tiene un test que falla con un
//       mensaje que dice la verdad si se corre en otra plataforma.
//
// O sea: `hermetico` es el gate que puede ser verde de verdad, y `visual` es el
// gate de fidelidad que se corre cuando se toca el diseño. Ambos están en el
// mismo `npx playwright test` sin argumentos.
const ORIGEN = "http://localhost:4173";
const APORTE = `${ORIGEN}/assets/crm_core/web/`;

/**
 * Los specs de cada proyecto. El patrón se aplica al NOMBRE del archivo, así que
 * un spec nuevo tiene que decidir en cuál de los dos entra; no hay default.
 */
const VISUAL = /agenda\.(golden|visual|fidelity)\.spec\.ts$/;

export default defineConfig({
  testDir: "./apps/web/e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  projects: [
    { name: "hermetico", testIgnore: VISUAL },
    { name: "visual", testMatch: VISUAL },
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  expect: {
    toHaveScreenshot: {
      // Defaults explícitos (la task los pide): sin movimiento ni caret.
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Cero tolerancia: cada píxel distinto es una diferencia que hay que
      // mirar, no algo que se esconde subiendo el umbral. `threshold` queda en
      // el default 0.2 (diferencia de color percibida en YIQ) para no contar
      // antialiasing sub-perceptual como regresión.
      maxDiffPixels: 0,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: ORIGEN,
    // Viewport donde el ancho de la app (max-width 1320) coincide con el del
    // prototipo: así las dos capturas tienen las mismas dimensiones y el diff
    // mide el diseño, no un recorte. A 1320 ambas interfaces pliegan el mini-mes
    // por su media query de 1559px.
    viewport: { width: 1320, height: 900 },
    deviceScaleFactor: 2,
    timezoneId: "America/Argentina/Buenos_Aires",
    // Estabiliza el scroll a "ahora" del prototipo (smooth -> instantáneo).
    reducedMotion: "reduce",
    colorScheme: "dark",
  },
  webServer: {
    command: "npm --prefix apps/web run preview -- --port 4173 --strictPort",
    url: APORTE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
