// E2E de la Agenda con navegador real. Uso: KEY=... SEC=... node scripts/e2e_agenda.mjs
import { chromium } from "playwright";

const KEY = process.env.KEY;
const SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` },
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector(".ag", { timeout: 15000 });

console.log("title:", await page.title());
console.log("range:", (await page.locator(".ag-range").textContent())?.trim());
console.log("day columns:", await page.locator(".ag-col").count());
console.log("events:", await page.locator(".ag-event").count());
console.log("tasks:", await page.locator(".ag-task").count());
console.log("pageerrors:", errors.length ? errors : "(none)");

await page.screenshot({ path: "agenda.png", fullPage: true });
console.log("screenshot -> agenda.png");

if (process.env.MODAL === "1") {
  await page.locator(".ag-slot").nth(20).click();
  await page.waitForSelector(".modal", { timeout: 5000 });
  console.log("modal visible:", await page.locator(".modal").isVisible());
  console.log("modal title:", (await page.locator(".modal h3").textContent())?.trim());
  await page.screenshot({ path: "modal.png", fullPage: false });
  console.log("screenshot -> modal.png");
}

if (process.env.DETAIL === "1") {
  await page.locator(".ag-event").first().click();
  await page.waitForSelector(".modal.detail", { timeout: 8000 });
  await page.waitForSelector(".detail-meta", { timeout: 8000 });
  console.log("detail subject:", (await page.locator(".detail-head h3").textContent())?.trim());
  console.log("comments:", await page.locator(".comments li").count());
  console.log("tasks in detail:", await page.locator(".dtasks li").count());
  await page.screenshot({ path: "detail.png", fullPage: false });
  console.log("screenshot -> detail.png");
}

await browser.close();
