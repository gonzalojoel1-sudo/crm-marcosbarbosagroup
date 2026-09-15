import { chromium } from "playwright";
const KEY = process.env.KEY, SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` },
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".tabs button", { hasText: "Contactos" }).click();
await page.waitForSelector(".lead, .empty");
console.log("leads:", await page.locator(".lead").count());
await page.screenshot({ path: "shot-contacts.png", fullPage: true });
// abrir el primero
if ((await page.locator(".lead").count()) > 0) {
  await page.locator(".lead").first().click();
  await page.waitForSelector(".drawer-head h2");
  console.log("drawer:", (await page.locator(".drawer-head h2").textContent())?.trim());
  await page.screenshot({ path: "shot-lead.png" });
}
await browser.close();
console.log("done");
