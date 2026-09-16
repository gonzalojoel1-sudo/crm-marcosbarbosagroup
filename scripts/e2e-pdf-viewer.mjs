// E2E del visor previo de presupuesto (F1).
// Autosuficiente: crea su negocio con ítems, verifica y lo borra.
// Requiere TOKEN="api_key:api_secret" de Administrator.
import { chromium } from "playwright";

const BASE = "https://crm.marcosbarbosagroup.com";
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error("Falta TOKEN=api_key:api_secret");

async function call(method, body) {
  const r = await fetch(`${BASE}/api/method/crm_core.api.${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${TOKEN}`,
      "X-Frappe-CSRF-Token": "x",
    },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t).message;
}

let dealName = null;
let failed = false;
const check = (label, cond) => {
  if (!cond) failed = true;
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
};

const browser = await chromium.launch();
try {
  dealName = (
    await call("create_deal", { title: "ZZ Visor Prueba", contact: "Test Visor" })
  ).name;
  await call("save_quote", {
    name: dealName,
    items: [{ description: "Servicio de prueba", qty: 1, rate: 100000, discount_percentage: 0 }],
  });

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { Authorization: `token ${TOKEN}` },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/hoy`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Negocios" }).click();
  await page.waitForTimeout(1800);

  await page.getByText("ZZ Visor Prueba").first().click();
  await page.waitForTimeout(1000);
  await page.locator('[role=tab]').nth(1).click(); // pestaña Presupuesto
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: /Ver presupuesto/i }).click();
  await page.waitForSelector(".pdfview", { timeout: 20000 });
  check("se abre el visor", (await page.locator(".pdfview").count()) === 1);

  // El iframe recien existe cuando termino de llegar el blob. Sin esta espera
  // explicita el test falla por carrera, no por diseno.
  await page.waitForSelector(".pdfview-frame", { timeout: 30000 });
  const src = await page.locator(".pdfview-frame").getAttribute("src");
  check("iframe apunta a un blob del PDF", Boolean(src && src.startsWith("blob:")));

  check(
    "hay acción Descargar",
    (await page.getByRole("button", { name: /Descargar/i }).count()) === 1,
  );
  check(
    "hay acción Abrir",
    (await page.getByRole("link", { name: /Abrir/i }).count()) === 1,
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape cierra el visor", (await page.locator(".pdfview").count()) === 0);
  // Regresión: el drawer tiene su propio listener de Escape y NO debe cerrarse
  // cuando el visor está arriba. Si esto falla, se pierde el negocio entero.
  check("Escape NO cierra el drawer de abajo", (await page.locator(".drawer").count()) === 1);

  await ctx.close();
} catch (e) {
  failed = true;
  console.error("ERROR:", String(e).slice(0, 500));
} finally {
  if (dealName) {
    try {
      await call("delete_deal", { name: dealName });
      console.log("limpieza: negocio borrado");
    } catch (e) {
      console.error("No se pudo borrar", dealName, String(e).slice(0, 200));
    }
  }
  await browser.close();
}
process.exit(failed ? 1 : 0);
