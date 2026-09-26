import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, type Route, type TestInfo } from "@playwright/test";
import { NEGOCIO_CON_PRESUPUESTO, DETALLE_NEGOCIO } from "./fixtures-negocio";

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
 * Los ÚNICOS métodos que la agenda puede pedir al backend. Es una lista cerrada a
 * propósito: el mock anterior devolvía `200 {"message":{}}` para cualquier método
 * que no reconociera, así que si el backend renombraba `get_agenda` o cambiaba la
 * forma del payload, la app recibía `{}`, no renderizaba nada, y el test de captura
 * igual pasaba (o fallaba por píxeles, sin decir por qué). Un método desconocido
 * ahora hace FALLAR el test: la ruptura de contrato frontend↔backend es la clase de
 * bug más cara y era estructuralmente invisible.
 *
 * Cubre lo que la agenda y sus hijos (`EventPanel`, `EventMenu`) llaman de verdad.
 * Agregar un método nuevo acá es el costo de que el contrato se pueda romper en
 * silencio: si la app empieza a llamar algo que no está en la lista, el test dice
 * exactamente qué método falta.
 */
export const METODOS_CONOCIDOS = [
  "crm_core.api.get_agenda",
  "crm_core.api.get_reminders",
  "crm_core.api.get_hoy",
  "crm_core.api.create_event",
  "crm_core.api.update_meeting",
  "crm_core.api.duplicate_meeting",
  "crm_core.api.delete_meeting",
  "frappe.client.set_value",
  "frappe.client.get_value",
] as const;

/** Respuesta de un método: el `message` que se devuelve, o un error HTTP. */
export type RespuestaMock =
  | { ok: true; message: unknown }
  | { ok: false; status: number; body: string };

export type LlamadaMock = { metodo: string; body: Record<string, unknown> };

export type MockApi = {
  /** Cambia la respuesta de un método conocido (para exercitar un path de error). */
  set(method: string, r: RespuestaMock): void;
  /** Los métodos que el backend pidió y el mock no conoce. */
  readonly desconocido: string[];
  /** Toda llamada POST, en orden, con el body que la app mandó. Permite afirmar
   *  sobre lo que SALIÓ hacia el backend, no solo sobre lo que se ve en pantalla. */
  readonly llamadas: LlamadaMock[];
};

/** Respuesta por defecto de cada método conocido. Los de escritura devuelven lo
 *  mínimo que la UI necesita para seguir: un `name` y el `ok`. */
const RESPUESTAS_POR_DEFECTO: Record<string, RespuestaMock> = {
  "crm_core.api.get_reminders": {
    ok: true,
    message: { meetings: [], overdue: 0, now: "2025-09-16 15:42:00" },
  },
  "crm_core.api.get_hoy": {
    ok: true,
    message: { today: "2025-09-16", overdue: [], tasks_today: [], events_today: [], count: 0 },
  },
  "crm_core.api.create_event": { ok: true, message: { name: "NUEVA-0001", subject: "" } },
  "crm_core.api.update_meeting": { ok: true, message: { name: "", subject: "" } },
  "crm_core.api.duplicate_meeting": { ok: true, message: { name: "COPIA-0001", subject: "" } },
  "crm_core.api.delete_meeting": { ok: true, message: { ok: true } },
  "frappe.client.set_value": { ok: true, message: { name: "" } },
  "frappe.client.get_value": { ok: true, message: { description: "" } },

  // ── Negocios y presupuestos ──
  // El mock de la agenda no conocía ninguno de estos, así que la pestaña
  // Presupuesto del Negocio era inalcanzable para un test. Se siembra UN negocio
  // con presupuesto en borrador, que es el estado en el que se edita.
  "crm_core.api.get_deals": {
    ok: true,
    message: {
      deals: [NEGOCIO_CON_PRESUPUESTO],
      stages: ["Analisis", "Estrategia", "Implementacion", "Won", "Lost"],
      leads: [],
      verticals: ["Consultora Estrategica", "Software"],
    },
  },
  "crm_core.api.get_deal": { ok: true, message: DETALLE_NEGOCIO },
  "crm_core.api.save_quote": {
    ok: true,
    message: { name: "P-2026-00001", version: 1, status: "Borrador" },
  },
  "crm_core.api.send_quote": { ok: true, message: { ok: true, status: "Enviado" } },
  "crm_core.api.accept_quote": { ok: true, message: { ok: true, status: "Aceptado" } },
  "crm_core.api.reject_quote": { ok: true, message: { ok: true, status: "Rechazado" } },
  "crm_core.api.new_quote_version": {
    ok: true,
    message: { name: "P-2026-00002", version: 2 },
  },
};

/**
 * Siembra el fixture: la app carga las MISMAS reuniones que el prototipo por un
 * mock de la API (`page.route`). Sembrar datos reales de producción está fuera
 * de discusión, y el bundle del port ya se sirve inline (no desde blob), así que
 * la ruta intercepta.
 */
async function mockApi(page: Page, info: TestInfo, fixture: string): Promise<MockApi> {
  const agenda = jsonFixture<Record<string, unknown>>(info, fixture);
  const tabla = new Map<string, RespuestaMock>([
    ["crm_core.api.get_agenda", { ok: true, message: agenda }],
    ...Object.entries(RESPUESTAS_POR_DEFECTO),
  ]);
  const desconocido: string[] = [];
  const llamadas: LlamadaMock[] = [];

  // La agenda vive en memoria y las escrituras la MODIFICAN, como el backend. Sin
  // esto los tests de comportamiento no pueden afirmar nada sobre el resultado de
  // crear o arrastrar: la app escribe, vuelve a pedir `get_agenda` ( Agenda.tsx,
  // `escribirYEnfocar` y `handleSaved`) y un mock que devuelve el fixture intacto
  // hace que la reunión vuelva saltando a su lugar original. El test pasaba sin
  // haber probado nada, que es peor que no probarlo.
  type Evento = Record<string, unknown>;
  const eventos = (agenda.events ?? []) as Evento[];
  agenda.events = eventos;
  let correlativo = 0;
  const nuevoNombre = (prefijo: string) => `${prefijo}-${String(++correlativo).padStart(4, "0")}`;

  const aplicar = (metodo: string, body: Record<string, unknown>): RespuestaMock | null => {
    const b = body as {
      name?: string;
      subject?: string;
      starts_on?: string;
      ends_on?: string;
      categoria?: string;
    };
    switch (metodo) {
      case "crm_core.api.create_event": {
        const nombre = nuevoNombre("NUEVA");
        eventos.push({
          name: nombre,
          subject: b.subject ?? "",
          starts_on: b.starts_on ?? "",
          ends_on: b.ends_on ?? b.starts_on ?? "",
          all_day: false,
          categoria: b.categoria ?? "Trabajo",
          origin: "CRM",
          busy: false,
          sync: "pend",
          sub: null,
        });
        return { ok: true, message: { name: nombre, subject: b.subject ?? "" } };
      }
      case "crm_core.api.update_meeting": {
        const ev = eventos.find((e) => e.name === b.name);
        if (ev) {
          if (b.starts_on) ev.starts_on = b.starts_on;
          if (b.ends_on) ev.ends_on = b.ends_on;
          if (b.categoria) ev.categoria = b.categoria;
          // El push a Google quedó en cola: es lo que hace el backend real y es lo
          // que hace que el contador "sin sincronizar" cambie después de editar.
          ev.sync = "pend";
        }
        return { ok: true, message: { name: b.name ?? "", subject: (ev?.subject as string) ?? "" } };
      }
      case "crm_core.api.duplicate_meeting": {
        const ev = eventos.find((e) => e.name === b.name);
        if (ev) {
          const copia = { ...ev, name: nuevoNombre("COPIA"), subject: `${ev.subject} (copia)` };
          eventos.push(copia);
          return { ok: true, message: { name: copia.name as string, subject: copia.subject as string } };
        }
        return { ok: true, message: { name: "", subject: "" } };
      }
      case "crm_core.api.delete_meeting": {
        const i = eventos.findIndex((e) => e.name === b.name);
        if (i >= 0) eventos.splice(i, 1);
        return { ok: true, message: { ok: true } };
      }
      case "frappe.client.set_value":
        // El body real es {doctype, name, fieldname, value} y lo que el caller
        // necesita de vuelta es el `name` del documento, no el doctype.
        return { ok: true, message: { name: (b.name as string) ?? "" } };
      default:
        return null;
    }
  };

  const handler = async (route: Route) => {
    const url = route.request().url();
    const metodo = decodeURIComponent(url.split("/api/method/")[1]?.split("?")[0] ?? "");
    const r = tabla.get(metodo);
    if (!r) {
      if (!desconocido.includes(metodo)) desconocido.push(metodo);
      // 501 + mensaje: la UI ve un error real en vez de un `{}` silencioso, y el
      // test falla con el nombre del método, que es justo lo que hay que arreglar.
      return route.fulfill({
        status: 501,
        contentType: "application/json",
        body: JSON.stringify({ exc_type: "MockDesconocido", message: `mockApi no conoce ${metodo}` }),
      });
    }
    if (!r.ok) {
      return route.fulfill({ status: r.status, contentType: "text/plain", body: r.body });
    }
    // Una escritura que el test no sobreescribió se aplica sobre la agenda en
    // memoria; si el test la sobreescribió (para probar un error), gana el override.
    const sobreescrito = r !== RESPUESTAS_POR_DEFECTO[metodo];
    let message = r.message;
    if (route.request().method() === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        body = {};
      }
      llamadas.push({ metodo, body });
      if (!sobreescrito) {
        const aplicado = aplicar(metodo, body);
        // `aplicar` devuelve `RespuestaMock | null`, que es una unión: la
        // comprobación de verdad no la angosta a la variante `ok`. Sin este
        // `in`, TypeScript no puede garantizar que exista `.message`.
        if (aplicado && aplicado.ok) message = aplicado.message;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message }),
    });
  };
  await page.route("**/api/method/**", handler);
  return {
    set: (method, respuesta) => void tabla.set(method, respuesta),
    desconocido,
    llamadas,
  };
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

/** Fixture por defecto: el que usa la comparación visual contra el prototipo. */
export const FIXTURE_BASE = "apps/web/e2e/fixtures/agenda.json";

/** Fixture de la regresión 750b144: con tareas y con un evento de todo el día. */
export const FIXTURE_TAREAS = "apps/web/e2e/fixtures/agenda-tareas.json";

/**
 * Deja la app con el fixture sembrado, el reloj congelado y las fuentes listas.
 * `fixture` permite sembrar otras formas de la semana (con tareas, con un
 * evento de todo el día): el fixture por defecto no tiene ninguna de las dos, que
 * es justo lo que dejó pasar la regresión del grid (ver agenda.layout.spec.ts).
 *
 * Devuelve el handle del mock para poder inyectar errores. Cuando la app pide un
 * método que el mock no conoce, el handle lo reporta en `desconocido`: el assert
 * se hace al final del test, así el fallo dice QUÉ método se rompió en vez de
 * dejar un `{}` silencioso en la página.
 */
export async function loadApp(
  page: Page,
  info: TestInfo,
  view: ViewCase,
  fixture: string = FIXTURE_BASE,
  opciones: { chrome?: boolean } = {},
): Promise<MockApi> {
  const api = await mockApi(page, info, fixture);
  // El chrome se oculta ANTES de montar, para que la agenda mida su alto real.
  //
  // `chrome: false` lo saltea, y hace falta: `APP_INIT_CSS` deja el nav con
  // `visibility: hidden`, así que con el chrome puesto los botones de la barra
  // ("Negocios") no son accionables y un test que navegue por la app no puede
  // hacer clic. La ocultación existe para comparar el subárbol de la agenda
  // contra el prototipo; un test de comportamiento no compite contra píxeles y
  // quiere la app entera.
  if (opciones.chrome !== false) await injectAppChrome(page);
  await page.clock.setFixedTime(FROZEN_TIME);
  await page.goto(`/assets/crm_core/web/?view=${view.id}`);
  await page.waitForSelector("[data-agenda]");
  await page.evaluate(() => document.fonts.ready);
  // Deja asentar el scroll a "ahora" y la medición de alto de hora.
  await page.waitForTimeout(800);
  return api;
}

/** Falla el test si la app pidió un método que el mock no conoce. */
export function assertSinMetodosDesconocidos(api: MockApi): void {
  expect(api.desconocido, "la app pidió un método que el mock no conoce").toEqual([]);
}

// ── Medición comparable entre el prototipo y la app ────────────────────────
// El golden de píxeles no puede decir POR QUÉ difieren las dos interfaces: reporta
// un número. Estas medidas dan el diff con nombre. Cada entrada mapea un concepto
// a los DOS selectores, así que el valor que se compara es el mismo dato medido en
// los dos lados, no dos proxies que "deberían" ser iguales.
export interface Medida {
  /** Selector del prototipo. */
  proto: string;
  /** Selector de la app. */
  app: string;
}

/**
 * El concepto "contenido de la vista" cambia de elemento según la vista (la
 * semanal scrollea, la lista y el mes no), así que el selector se elige por vista.
 * El.prototype usa `#grilla` para lista y semana; el mes usa `.meswrap`.
 */
export const CONTENIDO_POR_VISTA: Record<string, Medida> = {
  semana: { proto: ".gridwrap", app: ".agx-gridwrap" },
  lista: { proto: "#grilla", app: ".agx-lista" },
  // El MES es el que hace fácil equivocarse: en el prototipo el scrolleable es
  // `.meswrap` y la tabla es `.mes`; en la app el scrolleable es `.agx-meswrap` y
  // la tabla es `.agx-mes`. Medir la tabla daba 585 px contra 762 px y parecía un
  // bug de layout cuando lo único que estaba mal era el selector.
  mes: { proto: ".meswrap", app: ".agx-meswrap" },
};

export const MEDIDAS: Record<string, Medida> = {
  // La barra superior (título + conteo + vistas + densidades + Hoy + Nueva).
  barra: { proto: ".topbar", app: ".agx-bar" },
  // El encabezado de días: fila de arriba de la grilla, dentro del área scrolleable.
  // Sólo existe en la vista semanal.
  heads: { proto: ".heads", app: ".agx-heads" },
  // El recuadro de la agenda, que es donde empieza el contenido. En el prototipo
  // es `.shell` (dentro de `#stage`, que reserva los 62 px del chrome) y en la app
  // es `[data-agenda]`, que ya arranca abajo del nav. Comparar `body` contra
  // `[data-agenda]` daba 0 contra 62 y no significaba nada.
  raiz: { proto: ".shell", app: "[data-agenda]" },
  // El texto del conteo ("05:00 – 21:00 · 13 reuniones · 2 sin sincronizar").
  // El selector de la app está ANCLADO a la barra a propósito: `.agx-count` también
  // lo usa la sidebar (los conteos por agenda y por origen), y `querySelector`
  // devolvía el de la sidebar — un "5" que no tiene nada que ver. La clase del
  // prototipo (`.rangecount`) sí es única, pero se ancla igual para simetría.
  conteo: { proto: ".topbar .rangecount", app: ".agx-bar .agx-count" },
  // La superficie que pinta el fondo de TODO el árbol. En el prototipo es `body`
  // (`index.html:47`, `background: var(--bg)`); en la app es la raíz de la agenda.
  // Son elementos distintos a propósito: el body del prototipo cumple el rol que en
  // la app cumple `[data-agenda]`.
  fondo: { proto: "body", app: "[data-agenda]" },
};

export interface Geometria {
  [k: string]: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Mide las cajas de `MEDIDAS` más el contenedor de la vista en la página que sea
 * (prototipo o app). `contenido` entra en la misma medida para que el test pueda
 * compararlo sin conocer los nombres.
 */
export async function medirGeometria(
  page: Page,
  lado: "proto" | "app",
  contenido: Medida,
): Promise<Geometria> {
  const todos: Record<string, Medida> = { ...MEDIDAS, contenido };
  const pares = Object.entries(todos).map(([k, m]) => [k, lado === "proto" ? m.proto : m.app] as const);
  return page.evaluate((entradas: readonly (readonly [string, string])[]) => {
    const out: Record<string, { x: number; y: number; w: number; h: number } | null> = {};
    for (const [k, sel] of entradas) {
      const el = document.querySelector(sel);
      out[k] = el
        ? (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(
            el.getBoundingClientRect() as DOMRect,
          )
        : null;
    }
    return out;
  }, pares);
}

/** El color de fondo pintado EN la superficie que cubre el árbol (no el del shell). */
export async function medirFondoRaiz(page: Page, lado: "proto" | "app"): Promise<string> {
  const sel = MEDIDAS.fondo[lado];
  return page.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);
}

/** El texto del conteo, normalizado (sin espacios dobles). */
export async function medirConteo(page: Page, lado: "proto" | "app"): Promise<string> {
  const sel = MEDIDAS.conteo[lado];
  return page.evaluate(
    (s) => (document.querySelector(s)?.textContent ?? "").replace(/\s+/g, " ").trim(),
    sel,
  );
}

/**
 * El alto de HORA, derivado como lo derivan las dos implementaciones
 * (`fitHourHeight`): `avail / 16`, donde `avail` es el alto del contenedor
 * scrolleable menos el encabezado de días. Se mide sobre la grilla en vez de leer
 * una constante porque las dos lo derivan del layout (`geometry.ts:15` y
 * `index.html:655`): lo que se compara es el RESULTADO, que es lo que se ve.
 */
export async function medirAltoHora(page: Page, lado: "proto" | "app"): Promise<number> {
  const h = MEDIDAS.heads[lado];
  return page.evaluate(
    ({ gs, hs }) => {
      const wrap = document.querySelector(gs) as HTMLElement | null;
      const heads = document.querySelector(hs) as HTMLElement | null;
      if (!wrap) return NaN;
      const avail = wrap.clientHeight - (heads ? heads.getBoundingClientRect().height : 0) - 2;
      return avail / 16;
    },
    { gs: CONTENIDO_POR_VISTA.semana[lado], hs: h },
  );
}

/** El alto de HORA final, con el multiplicador de densidad (Amplio = 1.32). */
export const ZOOM_AMPLIO = 1.32;

/**
 * Las diferencias ACEPTADAS entre la app y el prototipo, y cómo se neutralizan
 * para poder comparar el resto con tolerancia cero.
 *
 * Se neutralizan con CSS y NO con `mask` de `toHaveScreenshot` a propósito: la
 * máscara se aplica sólo a la captura actual, así que el golden (que se genera sin
 * máscara) nunca coincidiría en la región tapada y el test daría un diff enorme
 * justamente donde no tiene que mirar. Apagando el control en la app, la región
 * queda como el prototipo la tiene — que es exactamente lo que hay que comparar.
 *
 * Cada excepción dice QUÉ es y POR QUÉ. Si se saca el control hay que sacar la
 * entrada: `agenda.visual.spec.ts` verifica que la región siga existiendo, así que
 * una entrada que ya no aplica se ve en vez de quedar muda.
 */
export const EXCEPCIONES: Array<{ id: string; sel: string; motivo: string }> = [
  {
    id: "pager",
    sel: ".agx-pager",
    motivo:
      "el prototipo NO tiene pager (`grep -c 'pager\\|chevron' prototypes/agenda/index.html` da 0): " +
      "sólo cambia de período con teclado. La app lo tiene porque con puntero no había " +
      "forma. Es una mejora deliberada, documentada también en `Toolbar.tsx`, y su " +
      "comportamiento está en `agenda.behavior.spec.ts`.",
  },
];

export const CSS_EXCEPCIONES = EXCEPCIONES.map((e) => `${e.sel}{display:none !important}`).join(
  "\n",
);

/** Aplica las neutralizaciones sobre una página ya cargada. */
export async function neutralizar(page: Page): Promise<void> {
  await page.addStyleTag({ content: CSS_EXCEPCIONES });
  await page.waitForTimeout(150);
}

/** Los bloques de reunión, en orden de lectura. */
export interface Bloque {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export async function medirBloques(page: Page, lado: "proto" | "app"): Promise<Bloque[]> {
  const sel = lado === "proto" ? ".gridwrap .ev" : ".agx-gridwrap .agx-ev";
  return page.evaluate((s) => {
    const out: { x: number; y: number; w: number; h: number; color: string }[] = [];
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      out.push({
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        color: getComputedStyle(el).backgroundColor,
      });
    }
    // Orden estable: por columna (x) y después por hora (y), que es el orden de
    // lectura de la semana y no el del DOM (que depende del render).
    return out.sort((a, b) => a.x - b.x || a.y - b.y);
  }, sel);
}
