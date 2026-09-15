// E2E de /hoy con navegador real (render en cliente de React).
// Uso: KEY=... SEC=... node scripts/e2e_hoy.mjs
import { chromium } from "playwright";

const KEY = process.env.KEY;
const SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` },
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
// La app abre en Agenda; ir a la pestaña Hoy.
await page.getByRole("button", { name: "Hoy", exact: true }).click();
await page.waitForSelector(".wrap", { timeout: 15000 });

console.log("title:", await page.title());
console.log("h1:", (await page.locator("h1").first().textContent())?.trim());
console.log("date:", (await page.locator(".date").first().textContent())?.trim());
console.log("pill:", (await page.locator(".pill").first().textContent())?.trim());
console.log("tasks:", await page.locator(".task").count());
console.log("events:", await page.locator(".event").count());
console.log("empty states:", await page.locator(".empty").count());
console.log("console errors:", errors.length ? errors : "(none)");

// Prueba de alta rápida (no persiste: crea y se puede borrar luego)
if (process.env.ADD_TEST === "1") {
  await page.fill("#quick", "__e2e_react");
  await page.press("#quick", "Enter");
  await page.waitForTimeout(1500);
  console.log("after add, tasks:", await page.locator(".task").count());
}

await page.screenshot({ path: "hoy.png", fullPage: true });
console.log("screenshot -> hoy.png");

await browser.close();
