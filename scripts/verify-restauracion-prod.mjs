// Verificación READ-ONLY de la restauración del diseño en /hoy (prod real).
//
// Uso: KEY=... SEC=... node scripts/verify-restauracion-prod.mjs
//
// No escribe ni crea nada: sólo lee el DOM y el CSS computado. La verificación de
// alta/borrado vive en `e2e_agenda.mjs` y NO se corre acá (regla de seguridad:
// no tocar la base de producción más allá del deploy).
//
// `pageerror` es ASERCIÓN (I2): un bundle roto devuelve HTTP 200 igual, así que
// el health check no lo ve; esto sí.
import { chromium } from "playwright";

const KEY = process.env.KEY;
const SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";
if (!KEY || !SEC) {
  console.error("faltan KEY/SEC (API key temporal de Administrator)");
  process.exit(2);
}

const CATEGORIAS = ["Trabajo", "Ministerial", "Personal", "Consultora", "Software"];
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const fallos = [];
const assert = (nombre, cond, detalle = "") => {
  if (!cond) fallos.push(`${nombre}${detalle ? ` (${detalle})` : ""}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` },
  // >= 1560 px: el mini-mes se pliega por debajo (`MiniMonth.module.css`).
  viewport: { width: 1680, height: 1000 },
  deviceScaleFactor: 1,
});
// El token va en un header `Authorization`, y ese header rompe el preflight de
// Google Fonts (fonts.gstatic.com no lo permite: CORS). Es el artefacto que la
// autenticación del E2E introduce y que en producción (con cookie) no existe.
// Acá se saca el header SÓLO para las fuentes, para medir lo que ve un usuario.
await context.route("https://fonts.gstatic.com/**", (route) => {
  const headers = { ...route.request().headers() };
  delete headers["authorization"];
  route.continue({ headers });
});
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".agx", { timeout: 30000 });
  await page.waitForSelector(".agx-gridwrap", { timeout: 20000 });
  // El shell pinta ANTES de que llegue `get_agenda`; esperar a que los datos
  // reales estén en el DOM (si no, se mide el estado "0 reuniones" inicial).
  await page.waitForSelector("button.agx-ev[data-ev]", { timeout: 25000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  console.log("title:", await page.title());

  // ── 1. Tipografía por FUENTE COMPUTADA (el fallo que esta spec mata) ──
  const fuentes = await page.evaluate(() => {
    const t = document.querySelector(".agx-title");
    const h = document.querySelector(".agx-hourlab");
    return {
      titulo: t ? getComputedStyle(t).fontFamily : null,
      hora: h ? getComputedStyle(h).fontFamily : null,
      okTitulo: document.fonts.check("400 23px Fraunces"),
      okMono: document.fonts.check("400 11px 'JetBrains Mono'"),
    };
  });
  console.log("  .agx-title font-family:  ", fuentes.titulo);
  console.log("  .agx-hourlab font-family:", fuentes.hora);
  console.log("  fonts.check Fraunces:", fuentes.okTitulo, "· JetBrains Mono:", fuentes.okMono);
  assert("el título de la semana computa Fraunces", /Fraunces/i.test(fuentes.titulo || ""), fuentes.titulo || "null");
  assert("un horario computa JetBrains Mono", /JetBrains Mono/i.test(fuentes.hora || ""), fuentes.hora || "null");
  assert("Fraunces realmente descargada (fonts.check)", fuentes.okTitulo === true);
  assert("JetBrains Mono realmente descargada (fonts.check)", fuentes.okMono === true);

  // ── 2. Paleta cálida COMPUTADA sobre la agenda ───────────────────────
  const paleta = await page.evaluate(() => {
    const raiz = document.querySelector("[data-agenda].agx") || document.querySelector("[data-agenda]");
    const pintado = document.querySelector(".agx-heads") || raiz;
    const cs = getComputedStyle(raiz);
    return {
      bg: getComputedStyle(pintado).backgroundColor,
      bgVar: cs.getPropertyValue("--bg").trim(),
      accent: cs.getPropertyValue("--accent").trim(),
      fg: cs.getPropertyValue("--fg").trim(),
    };
  });
  console.log("  fondo pintado (.agx-heads):", paleta.bg, "· --bg:", paleta.bgVar, "· --accent:", paleta.accent);
  assert("la agenda computa la paleta cálida (--bg #100f0d)", paleta.bgVar === "#100f0d", paleta.bgVar);
  assert("el acento es el naranja de marca (--accent #fe4100)", paleta.accent === "#fe4100", paleta.accent);
  assert("el fondo computado es el cálido rgb(16,15,13)", paleta.bg === "rgb(16, 15, 13)", paleta.bg);

  // ── 3. Sidebar: Agendas con contadores, Origen, Buscador ─────────────
  const side = await page.evaluate(() => {
    const aside = document.querySelector(".agx-side");
    return {
      visible: !!aside && getComputedStyle(aside).display !== "none",
      titulos: [...document.querySelectorAll(".agx-side .agx-block-title")].map((e) => e.textContent.trim()),
      cats: [...document.querySelectorAll(".agx-side .agx-cal[data-cat]")].map((b) => ({
        cat: b.dataset.cat,
        count: b.querySelector(".agx-count")?.textContent.trim(),
        off: b.hasAttribute("data-off"),
      })),
      origenes: [...document.querySelectorAll(".agx-side .agx-cal[data-origin]")].map((b) => ({
        origen: b.dataset.origin,
        count: b.querySelector(".agx-count")?.textContent.trim(),
      })),
      buscador: !!document.querySelector(".agx-side .agx-buscador"),
    };
  });
  console.log("  sidebar títulos:", JSON.stringify(side.titulos));
  console.log("  agendas:", JSON.stringify(side.cats));
  console.log("  orígenes:", JSON.stringify(side.origenes));
  assert("la sidebar renderiza", side.visible);
  assert("sidebar: bloque Agendas/Origen/Buscador", ["Agendas", "Origen", "Buscador"].every((t) => side.titulos.includes(t)), side.titulos.join(" | "));
  assert("sidebar: 5 agendas con contador", side.cats.length === 5 && side.cats.every((c) => c.count !== undefined));
  assert("sidebar: Origen con al menos CRM/Google", side.origenes.length >= 2, side.origenes.map((o) => o.origen).join(", "));
  assert("sidebar: el Buscador está", side.buscador);

  // ── 4. Mini-mes con la leyenda "Cómo se lee" ─────────────────────────
  const mini = await page.evaluate(() => {
    const m = document.querySelector(".agx-mini");
    const legend = m?.querySelector(".agx-legend")?.textContent || "";
    return {
      visible: !!m && getComputedStyle(m).display !== "none",
      titulos: [...(m?.querySelectorAll(".agx-block-title") || [])].map((e) => e.textContent.trim()),
      celdas: m?.querySelectorAll(".agx-mgrid span").length || 0,
      inrange: m?.querySelectorAll(".agx-mgrid span.agx-inrange").length || 0,
      legend,
    };
  });
  console.log("  mini-mes títulos:", JSON.stringify(mini.titulos), "· celdas:", mini.celdas, "· inrange:", mini.inrange);
  console.log("  leyenda:", JSON.stringify(mini.legend.trim()));
  assert("el mini-mes renderiza (viewport amplio)", mini.visible);
  assert("mini-mes: título de mes y 'Cómo se lee'", mini.titulos.some((t) => /Cómo se lee/.test(t)) && mini.titulos.length >= 2, mini.titulos.join(" | "));
  assert("mini-mes: grilla con celdas", mini.celdas >= 28, String(mini.celdas));
  assert("leyenda incluye 'Ocupado (de Google)'", /Ocupado \(de Google\)/.test(mini.legend));

  // ── 5. El toggle de agenda FILTRA de verdad ──────────────────────────
  const contar = () => page.locator("button.agx-ev[data-ev]").count();
  const conDatos = side.cats.find((c) => Number(c.count) > 0);
  if (conDatos) {
    const antes = await contar();
    await page.locator(`.agx-side .agx-cal[data-cat="${conDatos.cat}"]`).click();
    await page.waitForTimeout(350);
    const despues = await contar();
    const apagada = await page.locator(`.agx-side .agx-cal[data-cat="${conDatos.cat}"][data-off]`).count();
    console.log(`  apagué "${conDatos.cat}" (contador ${conDatos.count}): eventos ${antes} -> ${despues}`);
    assert("apagar una agenda filtra los eventos de la grilla", despues < antes, `${antes} -> ${despues}`);
    assert("la agenda apagada queda marcada (data-off)", apagada === 1);
    await page.locator(`.agx-side .agx-cal[data-cat="${conDatos.cat}"]`).click();
    await page.waitForTimeout(350);
    const restaurado = await contar();
    assert("volver a encenderla restaura los eventos", restaurado === antes, `${restaurado} vs ${antes}`);
  } else {
    assert("hay alguna agenda con reuniones para probar el filtro", false, "todos los contadores en 0");
  }

  // ── 6. Las tres vistas cambian y la densidad por defecto es Amplio ───
  const urlView = () => page.evaluate(() => new URLSearchParams(window.location.search).get("view"));
  assert("vista por defecto = semana", (await page.locator(".agx-gridwrap").count()) === 1);
  await page.locator(".agx-seg button", { hasText: "Lista" }).click();
  await page.waitForSelector(".agx-lista", { timeout: 10000 });
  assert("cambia a Lista (?view=lista)", (await urlView()) === "lista");
  await page.locator(".agx-seg button", { hasText: "Mes" }).click();
  await page.waitForSelector("table.agx-mes", { timeout: 10000 });
  assert("cambia a Mes (?view=mes)", (await urlView()) === "mes");
  await page.locator(".agx-seg button", { hasText: "Semana" }).click();
  await page.waitForSelector(".agx-gridwrap", { timeout: 10000 });
  // Al volver a Semana `get_agenda` se dispara de nuevo: esperar los datos antes
  // de contarlos (mismo race que al arranque).
  await page.waitForSelector("button.agx-ev[data-ev]", { timeout: 20000 });
  assert("vuelve a Semana (?view=semana)", (await urlView()) === "semana");
  const densidad = (await page.locator(".agx-zoom button.on").textContent())?.trim();
  assert("densidad por defecto = Amplio", densidad === "Amplio", densidad);

  // ── 7. Reuniones reales en sus días, con color de categoría ──────────
  const evs = await page.evaluate(() =>
    [...document.querySelectorAll("button.agx-ev[data-ev]")].map((e) => ({
      name: e.dataset.ev,
      color: getComputedStyle(e).getPropertyValue("--agx-ev-color").trim(),
      background: getComputedStyle(e).backgroundColor,
      label: e.getAttribute("aria-label") || "",
    })),
  );
  console.log("  reuniones en la semana:", evs.length);
  for (const e of evs.slice(0, 3)) console.log(`    ${e.name} · ${e.label}`);
  assert("hay reuniones reales en la semana", evs.length > 0, String(evs.length));
  assert("todas tienen color de categoría", evs.length > 0 && evs.every((e) => e.color.length > 0));
  const conDia = evs.filter((e) => DIAS.some((d) => e.label.includes(d)));
  const conCat = evs.filter((e) => CATEGORIAS.some((c) => e.label.trim().endsWith(c)));
  assert("cada reunión cae en un día real", evs.length > 0 && conDia.length === evs.length, `${conDia.length}/${evs.length}`);
  assert("cada reunión trae su categoría", evs.length > 0 && conCat.length === evs.length, `${conCat.length}/${evs.length}`);

  // ── 8. I2: cero pageerror ────────────────────────────────────────────
  assert("cero pageerror", pageErrors.length === 0, pageErrors.length ? pageErrors[0] : "0");
  console.log("console errors:", consoleErrors.length ? consoleErrors : "(none)");

  await page.screenshot({ path: "agenda-prod.png", fullPage: true });
  console.log("screenshot -> agenda-prod.png");
} catch (e) {
  fallos.push(`excepción: ${e?.message || e}`);
} finally {
  await browser.close();
}

if (pageErrors.length) console.error("\nPAGEERRORS:\n" + pageErrors.join("\n"));
if (fallos.length) {
  console.error(`\nFALLÓ (${fallos.length}):\n- ` + fallos.join("\n- "));
  process.exit(1);
}
console.log("\nVERIFICACIÓN OK");
