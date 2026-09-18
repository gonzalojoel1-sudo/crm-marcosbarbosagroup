import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page, Route, TestInfo } from "@playwright/test";

/**
 * "Ahora" del prototipo: `NOW_MIN = 15*60+42` (=15:42) y la semana Lun 15–Vie 19
 * de septiembre. El prototipo NO usa el reloj real; la app sí. Congelamos el
 * reloj de la app en este instante para que la línea de "ahora" caiga donde el
 * prototipo la dibuja. Sin esto el diff mide la hora, no el diseño.
 */
export const FROZEN_TIME = new Date("2025-09-16T15:42:00-03:00");

/** Las tres vistas que fija la task. El nombre es la baseline compartida. */
export const VIEWS = [
  { id: "semana", name: "agenda-semana.png" },
  { id: "lista", name: "agenda-lista.png" },
  { id: "mes", name: "agenda-mes.png" },
] as const;

export type ViewCase = (typeof VIEWS)[number];

// La variante "zoom" del prototipo (`?v=3`) es la que porta la densidad que la
// app reproduce (Amplio = ZOOM_MULT 1.32, el default). "Franja"/"Pliegue" son
// otras presentaciones, no lo que la app implementa.
const PROTO_VARIANT = "3";

/**
 * El chrome que NO es diseño se apaga para comparar el subárbol común, sin
 * tocar la geometría que cada página mide por su cuenta:
 *  - prototipo: se oculta el selector de variantes (fixed, no afecta layout).
 *  - app: el nav del CRM y el glow son chrome; se conserva exactamente la
 *    franja de 62px que el prototipo reserva con `#stage{padding-top:62px}`
 *    para que las dos agendas arranquen a la misma altura y midan igual. El
 *    alto real del nav (53px, medido) queda como hallazgo aparte.
 * La app lo recibe ANTES de montar (se inyecta en el HTML servido, ver
 * `injectAppChrome`): si se cambiara después, la agenda conservaría el alto
 * medido con el nav visible y el diff compararía dos ventanas distintas.
 */
export const PROTO_CHROME_CSS = `.proto-picker,#announcer{display:none !important}`;
export const APP_INIT_CSS = `.nav{height:62px !important;visibility:hidden !important}.glow{display:none !important}`;

// `rootDir` apunta al testDir; la raíz del repo sale del archivo de config.
function repoRoot(info: TestInfo): string {
  const configFile = info.config.configFile;
  if (!configFile) throw new Error("playwright: no hay configFile");
  return path.dirname(configFile);
}

export function protoUrl(info: TestInfo, view: string): string {
  const file = path.join(repoRoot(info), "prototypes", "agenda", "index.html");
  const url = new URL(pathToFileURL(file).href);
  url.searchParams.set("v", PROTO_VARIANT);
  url.searchParams.set("view", view);
  return url.href;
}

function jsonFixture<T>(info: TestInfo, rel: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot(info), rel), "utf8")) as T;
}

/**
 * Siembra el fixture: la app carga las MISMAS reuniones que el prototipo por un
 * mock de la API (`page.route`). Sembrar datos reales de producción está fuera
 * de discusión, y el bundle del port ya se sirve inline (no desde blob), así que
 * la ruta intercepta.
 */
async function mockApi(page: Page, info: TestInfo): Promise<void> {
  const agenda = jsonFixture<Record<string, unknown>>(info, "apps/web/e2e/fixtures/agenda.json");
  const handler = async (route: Route) => {
    const url = route.request().url();
    let message: unknown = {};
    if (url.includes("get_agenda")) message = agenda;
    else if (url.includes("get_reminders"))
      message = { meetings: [], overdue: 0, now: "2025-09-16 15:42:00" };
    else if (url.includes("get_hoy"))
      message = { today: "2025-09-16", overdue: [], tasks_today: [], events_today: [], count: 0 };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message }),
    });
  };
  await page.route("**/api/method/**", handler);
}

/** Deja el prototipo listo para capturar (chrome apagado, fuentes cargadas). */
export async function loadPrototype(page: Page, info: TestInfo, view: ViewCase): Promise<void> {
  await page.clock.setFixedTime(FROZEN_TIME);
  await page.goto(protoUrl(info, view.id));
  await page.waitForSelector(".shell");
  // Las fuentes son el punto de todo este plan: una captura antes de que carguen
  // compararía el fallback, no el diseño.
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: PROTO_CHROME_CSS });
  await page.waitForTimeout(600);
}

/**
 * Inyecta el CSS del chrome en el `<head>` del HTML servido, antes de que
 * corran los scripts. `addInitScript` no sirve acá: el parser puede descartar
 * un `<style>` creado cuando todavía no existe el `<head>`.
 */
async function injectAppChrome(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith("/assets/crm_core/web/"),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</head>",
        `<style>${APP_INIT_CSS}</style></head>`,
      );
      await route.fulfill({ response, body });
    },
  );
}

/** Deja la app con el fixture sembrado, el reloj congelado y las fuentes listas. */
export async function loadApp(page: Page, info: TestInfo, view: ViewCase): Promise<void> {
  await mockApi(page, info);
  // El chrome se oculta ANTES de montar, para que la agenda mida su alto real.
  await injectAppChrome(page);
  await page.clock.setFixedTime(FROZEN_TIME);
  await page.goto(`/assets/crm_core/web/?view=${view.id}`);
  await page.waitForSelector("[data-agenda]");
  await page.evaluate(() => document.fonts.ready);
  // Deja asentar el scroll a "ahora" y la medición de alto de hora.
  await page.waitForTimeout(800);
}
