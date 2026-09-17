// E2E de la agenda NUEVA (/hoy) contra el sitio real, con navegador real.
//
// Uso: KEY=... SEC=... [URL=...] node scripts/e2e_agenda.mjs
//
// I2 — `pageerror` es ASERCIÓN, no log. Antes este script capturaba los errores
// de página y sólo los imprimía: un bundle que revienta en el cliente igual
// devolvía HTTP 200 y el deploy "pasaba". Ahora cualquier `pageerror` (o error
// no capturado) hace salir con código != 0.
//
// Crea UNA reunión de prueba por la UI, la verifica y la borra (con limpieza por
// API como red en `finally`): nunca deja datos de prueba.
import { chromium } from "playwright";

const KEY = process.env.KEY;
const SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";
if (!KEY || !SEC) {
  console.error("faltan KEY/SEC (API key temporal de Administrator)");
  process.exit(2);
}

const CATEGORIAS = ["Trabajo", "Ministerial", "Personal", "Consultora", "Software"];
const fallos = [];
const ok = (nombre, valor, esperado) => {
  const bien = esperado === undefined ? Boolean(valor) : valor === esperado;
  if (!bien) fallos.push(`${nombre}: esperaba ${esperado ?? "true"}, obtuve ${JSON.stringify(valor)}`);
  console.log(`${bien ? "PASS" : "FAIL"} ${nombre}${esperado !== undefined ? ` = ${JSON.stringify(valor)}` : ""}`);
};
const assert = (nombre, cond, detalle = "") => {
  if (!cond) fallos.push(`${nombre}${detalle ? ` (${detalle})` : ""}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` },
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

// pageerror = aserción (I2). Consola de error se reporta, no tumba sola.
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

const creada = { name: null, deleted: false };
const api = (method, params, body) =>
  page.evaluate(
    async ([m, p, b]) => {
      const qs = p ? "?" + new URLSearchParams(p).toString() : "";
      const r = await fetch(`/api/method/${m}${qs}`, {
        method: b ? "POST" : "GET",
        credentials: "include",
        headers: b
          ? { "Content-Type": "application/json", "X-Frappe-CSRF-Token": window.CSRF || "" }
          : {},
        body: b ? JSON.stringify(b) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    [method, params, body],
  );

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".agx", { timeout: 30000 });
  await page.waitForSelector(".agx-gridwrap, .agx-lista, .agx-meswrap", { timeout: 20000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector(".agx-count");
      return c && c.textContent && c.textContent.trim().length > 0;
    },
    { timeout: 20000 },
  );

  console.log("title:", await page.title());

  // ── 1. Tres vistas y el estado en la URL ─────────────────────────────
  const urlView = () => page.evaluate(() => new URLSearchParams(window.location.search).get("view"));

  assert("vista por defecto = semana (grid visible)", (await page.locator(".agx-gridwrap").count()) === 1);
  await page.locator(".agx-seg button", { hasText: "Lista" }).click();
  await page.waitForSelector(".agx-lista", { timeout: 10000 });
  assert("vista Lista renderiza", (await page.locator(".agx-lista").count()) === 1);
  assert("URL ?view=lista", await urlView(), "lista");

  await page.locator(".agx-seg button", { hasText: "Mes" }).click();
  await page.waitForSelector("table.agx-mes", { timeout: 10000 });
  assert("vista Mes renderiza (tabla nativa)", (await page.locator("table.agx-mes").count()) === 1);
  assert("URL ?view=mes", await urlView(), "mes");

  await page.locator(".agx-seg button", { hasText: "Semana" }).click();
  await page.waitForSelector(".agx-gridwrap", { timeout: 10000 });
  assert("vista Semana vuelve a renderizar", (await page.locator(".agx-gridwrap").count()) === 1);
  assert("URL ?view=semana", await urlView(), "semana");

  // ── 2. Densidad: Zoom-Amplio por defecto y el control funciona ───────
  const densidadActiva = await page.locator(".agx-zoom button.on").textContent();
  assert("densidad por defecto = Amplio", densidadActiva?.trim(), "Amplio");
  const altoDias = () =>
    page.locator(".agx-days").evaluate((el) => el.getBoundingClientRect().height);
  const altoAmplio = await altoDias();
  await page.locator(".agx-zoom button", { hasText: "Compacto" }).click();
  await page.waitForTimeout(250);
  const altoCompacto = await altoDias();
  assert("Compacto achica la grilla", altoCompacto < altoAmplio, `${altoCompacto} < ${altoAmplio}`);
  await page.locator(".agx-zoom button", { hasText: "Amplio" }).click();
  await page.waitForTimeout(250);
  const altoAmplio2 = await altoDias();
  assert("Amplio agranda la grilla", altoAmplio2 > altoCompacto, `${altoAmplio2} > ${altoCompacto}`);

  // ── 3. Datos reales: la grilla coincide con la API y trae categoría ──
  // Rango de la ventana Semana = lunes..viernes de la semana en curso. El fin que
  // usa la app es el sábado (fin exclusivo), igual que `rangeEnd` de Agenda.tsx.
  const semana = await page.evaluate(() => {
    const d = new Date();
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sabado = new Date(lunes);
    sabado.setDate(lunes.getDate() + 5);
    const ymd = (x) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return { start: ymd(lunes), end: ymd(sabado) };
  });
  const server = await api("crm_core.api.get_agenda", { start: semana.start, end: semana.end });
  assert("get_agenda responde 200", server.status, 200);
  const apiEvents = server.json?.message?.events ?? [];
  const apiTasks = server.json?.message?.tasks ?? [];

  const domNames = (await page.locator("button.agx-ev[data-ev]").evaluateAll((els) =>
    els.map((e) => e.dataset.ev),
  )).sort();
  const apiNames = apiEvents.map((e) => e.name).sort();
  assert(
    "la grilla muestra TODAS las reuniones reales de la ventana",
    JSON.stringify(domNames) === JSON.stringify(apiNames),
    `dom=${domNames.length} api=${apiNames.length}`,
  );
  assert("hay reuniones reales en la ventana", apiEvents.length > 0, `${apiEvents.length} reuniones`);

  // Nombre accesible autosuficiente: día + horario + título + categoría.
  const etiquetas = await page
    .locator("button.agx-ev[data-ev]")
    .evaluateAll((els) => els.slice(0, 8).map((e) => e.getAttribute("aria-label") || ""));
  const conCategoria = etiquetas.filter((l) => CATEGORIAS.some((c) => l.endsWith(`, ${c}`)));
  assert(
    "nombres accesibles traen día + hora + título + categoría",
    etiquetas.length > 0 && conCategoria.length === etiquetas.length,
    `${conCategoria.length}/${etiquetas.length}`,
  );
  console.log("  ejemplo:", etiquetas[0]);

  // Colores por categoría: el bloque define su color en `--agx-ev-color`.
  const colores = await page
    .locator("button.agx-ev[data-ev]")
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue("--agx-ev-color").trim()));
  assert("cada bloque tiene color de categoría", colores.length > 0 && colores.every((c) => c.length > 0));

  // Tareas: las que devuelve la API para la ventana se ven en la grilla.
  const domTasks = await page.locator("button.agx-task").count();
  assert(
    "las tareas de la ventana son visibles",
    domTasks === apiTasks.length,
    `dom=${domTasks} api=${apiTasks.length}`,
  );

  // ── 4. Viaje por teclado: Lista → flecha → Enter (menú) → diálogo → Escape
  await page.locator(".agx-seg button", { hasText: "Lista" }).click();
  await page.waitForSelector(".agx-lista", { timeout: 10000 });
  const filas = page.locator("button.agx-lev");
  const nFilas = await filas.count();
  assert("la Lista tiene reuniones", nFilas > 0, `${nFilas} filas`);
  if (nFilas > 0) {
    await filas.first().focus();
    const antes = await page.evaluate(() => document.activeElement?.dataset?.ev ?? null);
    if (nFilas > 1) {
      await page.keyboard.press("ArrowDown");
      const despues = await page.evaluate(() => document.activeElement?.dataset?.ev ?? null);
      assert("ArrowDown mueve el foco dentro de la Lista", despues !== antes, `${antes} -> ${despues}`);
    }
    const actual = await page.evaluate(() => {
      const a = document.activeElement;
      return a?.dataset?.ev ?? null;
    });
    await page.keyboard.press("Enter");
    await page.waitForSelector(".agx-menu", { timeout: 8000 });
    assert("Enter abre el menú de la reunión", (await page.locator(".agx-menu").count()) === 1);
    await page.keyboard.press("m");
    await page.waitForSelector(".agx-modal", { timeout: 8000 });
    assert("se llega al diálogo Mover", (await page.locator(".agx-modal[role=dialog]").count()) === 1);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".agx-modal", { state: "detached", timeout: 8000 });
    assert("Escape cierra el diálogo", (await page.locator(".agx-modal").count()) === 0);
    // El foco vuelve en el próximo frame (rAF): esperar y después mirar, no al revés.
    const volvio = await page
      .waitForFunction((n) => document.activeElement?.dataset?.ev === n, actual, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    const foco = await page.evaluate(() => document.activeElement?.dataset?.ev ?? null);
    assert("Escape devuelve el foco a la reunión", volvio, `${actual} -> ${foco}`);
  }

  // ── 5. Alta por la UI + borrado (no deja datos de prueba) ────────────
  await page.locator(".agx-seg button", { hasText: "Semana" }).click();
  await page.waitForSelector(".agx-gridwrap", { timeout: 10000 });
  const titulo = `E2E F5 ${new Date().toISOString().slice(11, 19)}`;
  const evAntes = await page.locator("button.agx-ev[data-ev]").count();
  await page.locator(".agx-new").click();
  await page.waitForSelector(".agx-panel", { timeout: 8000 });
  const enfocoTitulo = await page
    .waitForFunction(() => document.activeElement?.id === "agx-p-titulo", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  assert("el panel de creación abre y enfoca el título", enfocoTitulo);
  await page.fill("#agx-p-titulo", titulo);
  await page.locator(".agx-panel-save").click();
  await page.waitForSelector(".agx-panel", { state: "detached", timeout: 15000 });
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll("button.agx-ev[data-ev]")).some((e) => (e.getAttribute("aria-label") || "").includes(t)),
    titulo,
    { timeout: 15000 },
  );
  const creado = page.locator(`button.agx-ev[aria-label*="${titulo}"]`).first();
  creada.name = await creado.getAttribute("data-ev");
  const label = await creado.getAttribute("aria-label");
  assert("la reunión creada existe en su día con nombre accesible completo", CATEGORIAS.some((c) => (label || "").endsWith(`, ${c}`)), label || "");
  assert("el alta suma exactamente una reunión", (await page.locator("button.agx-ev[data-ev]").count()) === evAntes + 1);
  console.log("  creada:", creada.name, "|", label);

  // Borrar por la UI: click en el bloque → menú → Eliminar → confirmar.
  await creado.click();
  await page.waitForSelector(".agx-menu", { timeout: 8000 });
  await page.locator('[data-accion="eliminar"]').click();
  await page.locator(".agx-confirm-si").click();
  await page.waitForFunction(
    (n) => !document.querySelector(`button.agx-ev[data-ev="${n}"]`),
    creada.name,
    { timeout: 15000 },
  );
  creada.deleted = true;
  assert("la reunión de prueba se borró", (await page.locator(`button.agx-ev[data-ev="${creada.name}"]`).count()) === 0);
  assert("el borrado deja el conteo original", (await page.locator("button.agx-ev[data-ev]").count()) === evAntes);

  // ── 6. Tareas reales en su semana (las de la ventana de hoy pueden ser 0) ──
  await page.locator('.agx-pager-btn[aria-label="Período anterior"]').click();
  await page.waitForTimeout(500);
  const semPrev = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sabado = new Date(lunes);
    sabado.setDate(lunes.getDate() + 5);
    const ymd = (x) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return { start: ymd(lunes), end: ymd(sabado) };
  });
  const srvPrev = await api("crm_core.api.get_agenda", { start: semPrev.start, end: semPrev.end });
  const apiTasksPrev = srvPrev.json?.message?.tasks ?? [];
  const domTasksPrev = await page.locator("button.agx-task").count();
  assert(
    "las tareas reales se ven en su semana y en su día",
    apiTasksPrev.length > 0 && domTasksPrev === apiTasksPrev.length,
    `dom=${domTasksPrev} api=${apiTasksPrev.length}`,
  );

  // ── 7. I2: sin `pageerror` ───────────────────────────────────────────
  assert("sin pageerror", pageErrors.length === 0, pageErrors.length ? pageErrors[0] : "0");
  console.log("console errors:", consoleErrors.length ? consoleErrors : "(none)");

  await page.screenshot({ path: "agenda.png", fullPage: true });
  console.log("screenshot -> agenda.png");
} catch (e) {
  fallos.push(`excepción: ${e?.message || e}`);
} finally {
  // Red de seguridad: si la reunión de prueba quedó en la base, se borra por API.
  if (creada.name && !creada.deleted) {
    try {
      await api("crm_core.api.delete_meeting", null, { name: creada.name });
      console.log("limpieza: borré por API la reunión de prueba", creada.name);
    } catch (e) {
      console.error("limpieza FALLÓ: quedó la reunión de prueba", creada.name, e?.message || e);
    }
  }
  await browser.close();
}

if (pageErrors.length) {
  console.error("\nPAGEERRORS:\n" + pageErrors.join("\n"));
}
if (fallos.length) {
  console.error(`\nFALLÓ (${fallos.length}):\n- ` + fallos.join("\n- "));
  process.exit(1);
}
console.log("\nE2E OK");
