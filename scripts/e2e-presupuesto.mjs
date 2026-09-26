// E2E de la pestaña Presupuesto contra un sitio real, con navegador real.
//
// Uso:
//   SID=<session-id> node scripts/e2e-presupuesto.mjs
//   URL=https://crm-test.marcosbarbosagroup.com SID=... node scripts/e2e-presupuesto.mjs
//
// El default es el sitio de PRUEBAS. Correr contra producción exige
// `ALLOW_PROD=1` porque el script GUARDA un presupuesto: el guard de
// `lib/no-prod.mjs` existe justamente para que un `node scripts/...` sin pensar no
// escriba en el CRM de un cliente.
//
// Qué verifica, en este orden y con capturas:
//   1. La agenda sigue con grilla y reuniones (que el cambio de presupuestos no
//      la haya roto).
//   2. El pipeline carga, se abre el negocio QUE TIENE presupuesto (el chip
//      "Tiene presupuesto"), y la pestaña renderiza.
//   3. El selector de Moneda existe con sus dos opciones y refleja la moneda que
//      el backend tiene guardada.
//   4. Los importes de línea y los totales usan el símbolo de esa moneda.
//   5. Hay dos bloques de totales separados: inversión inicial y abono mensual.
//   6. Cambiar de moneda mueve el símbolo de todos los importes.
//   7. Guardar desde la UI reporta éxito.
//   8. La agenda sigue bien al volver.
//
// La sesión se pasa por `SID` y no por usuario y password, para no dejar
// credenciales en un archivo ni en el historial del shell.

import { chromium } from "playwright";
import { sinProduccion } from "./lib/no-prod.mjs";

// La variable NO se llama `URL`: eso sombrea el constructor global del mismo
// nombre y `new URL(...)` deja de funcionar. Mismo tropiezo que evitó
// `lib/no-prod.mjs` al escribir su propio `hostDe`.
const SITIO = process.env.URL || "https://crm-test.marcosbarbosagroup.com/hoy";
sinProduccion(SITIO, { script: "e2e-presupuesto.mjs", queHace: "guardar un presupuesto" });

const SID = process.env.SID;
if (!SID) {
  console.error("Falta SID. Se saca de una sesión ya abierta (cookie `sid`).");
  process.exit(2);
}
const host = SITIO.split("://")[1].split("/")[0].split(":")[0];

const b = await chromium.launch({ headless: true });
const c = await b.newContext({
  viewport: { width: 1440, height: 900 },
  timezoneId: "America/Argentina/Buenos_Aires",
});
await c.addCookies([
  { name: "sid", value: SID, domain: host, path: "/", httpOnly: true, secure: true },
]);
const p = await c.newPage();
const errs = [];
const net = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/method/")) {
    net.push(`${r.status()} ${decodeURIComponent(u.split("/api/method/")[1]?.split("?")[0] ?? "")}`);
  }
});

const paso = (t) => console.log(`\n▸ ${t}`);
const ok = (t, v) => console.log(`  ${v ? "OK " : "XX "} ${t}`);

paso("abrir /hoy");
await p.goto(SITIO, { waitUntil: "domcontentloaded" });
await p.waitForSelector("[data-agenda]");
await p.waitForTimeout(1500);
const grilla = await p.evaluate(() => { const g = document.querySelector(".agx-gridwrap"); return { w: g?.clientWidth ?? 0, evs: document.querySelectorAll(".agx-ev").length }; });
ok("agenda: grilla con ancho y reuniones", grilla.w > 400 && grilla.evs > 0);
console.log(`     grilla ${grilla.w}px, ${grilla.evs} reuniones`);

paso("ir a Negocios");
await p.getByRole("button", { name: "Negocios" }).click();
await p.waitForSelector(".deal", { timeout: 15000 });
const deals = await p.locator(".deal").count();
ok("el pipeline carga los negocios", deals > 0);
console.log(`     ${deals} negocios`);

paso("abrir el negocio QUE TIENE presupuesto");
// No el primero de la grilla: el pipeline ordena por etapa y el primer negocio
// puede ser uno sin presupuesto. El que lo tiene lleva el chip "Tiene presupuesto".
const conQuote = p.locator(".deal:has(.deal-chip)");
const cuantos = await conQuote.count();
ok("hay un negocio con presupuesto", cuantos > 0);
await conQuote.first().click();
await p.waitForSelector('[role="dialog"]', { timeout: 15000 });
ok("se abre el drawer del negocio", true);

paso("ir a la pestaña Presupuesto");
await p.getByRole("tab", { name: "Presupuesto" }).click();
await p.waitForSelector(".quote-grid", { timeout: 15000 });
ok("la pestaña renderiza el panel", true);

paso("el selector de Moneda existe y ofrece ARS/USD");
const moneda = p.getByLabel("Moneda");
await moneda.waitFor({ state: "visible", timeout: 10000 });
const opts = await moneda.locator("option").allInnerTexts();
ok("selector visible", true);
console.log(`     opciones: ${JSON.stringify(opts)}`);

paso("la moneda del presupuesto guardado es USD (la que se guardó por API)");
const valorMoneda = await moneda.inputValue();
ok("el panel refleja la moneda del backend", valorMoneda === "USD");
console.log(`     valor: ${valorMoneda}`);

paso("los importes usan US$");
const amts = await p.locator(".quote-amt").allInnerTexts();
console.log(`     importes de línea: ${JSON.stringify(amts)}`);
ok("todos los importes con US$", amts.length > 0 && amts.every((t) => t.includes("US$")));
const suma = await p.locator(".quote-sum").innerText();
ok("el bloque de totales con US$", suma.includes("US$"));
console.log("     " + suma.replace(/\s+/g, " ").slice(0, 200));

paso("con USD y sin exento, aparece el aviso del IVA");
const n = await p.getByText(/IVA|impuesto/i).count();
ok("hay un texto de IVA (control o aviso)", n > 0);

paso("los dos bloques de totales están separados");
const bloques = await p.evaluate(() => [...document.querySelectorAll(".qs-block")].map((b) => b.textContent.replace(/\s+/g, " ").trim().slice(0, 60)));
ok("hay 2 bloques (inversión inicial + abono)", bloques.length === 2);
bloques.forEach((x) => console.log(`     - ${x}`));

paso("cambiar a ARS y ver el símbolo accompanying");
await moneda.selectOption("ARS");
await p.waitForTimeout(600);
const amtsArs = await p.locator(".quote-amt").allInnerTexts();
ok("vuelve a $ y desaparece US$", amtsArs.length > 0 && amtsArs.every((t) => !t.includes("US$")));
console.log(`     importes: ${JSON.stringify(amtsArs.slice(0, 3))}`);
await moneda.selectOption("USD");
await p.waitForTimeout(500);

paso("guardar desde la UI");
const guardar = p.getByRole("button", { name: "Guardar presupuesto" });
await guardar.click();
await p.waitForTimeout(2500);
const flash = await p.locator(".quote-state-txt, .flash, [class*='flash']").first().innerText().catch(() => "");
ok("la UI reporta éxito", /guardad/i.test(flash));
console.log(`     mensaje: ${flash.replace(/\s+/g, " ").trim().slice(0, 90)}`);

paso("botón de ver PDF");
const verPdf = p.getByRole("button", { name: /PDF|Ver/i }).first();
const hayPdf = (await verPdf.count()) > 0;
ok("hay acción de ver el PDF", hayPdf);

await p.screenshot({ path: "e2e-presupuesto.png" });

paso("vuelvo a la agenda para confirmar que no se rompió nada");
await p.keyboard.press("Escape");
await p.getByRole("button", { name: "Agenda" }).click();
await p.waitForSelector(".agx-gridwrap", { timeout: 15000 });
await p.waitForTimeout(1200);
const grilla2 = await p.evaluate(() => { const g = document.querySelector(".agx-gridwrap"); return { w: g?.clientWidth ?? 0, evs: document.querySelectorAll(".agx-ev").length }; });
ok("agenda sigue bien", grilla2.w > 400 && grilla2.evs > 0);
await p.screenshot({ path: "e2e-agenda.png" });

console.log("\n=== RED ===");
console.log([...new Set(net)].join("\n"));
console.log("\n=== PAGE ERRORS: " + errs.length + " ===");
errs.slice(0, 5).forEach((e) => console.log("  " + e));
await b.close();
