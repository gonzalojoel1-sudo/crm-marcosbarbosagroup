import { chromium } from "playwright";
const KEY = process.env.KEY, SEC = process.env.SEC;
const browser = await chromium.launch();
const ctx = await browser.newContext({ extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` }, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror", e=>errs.push(String(e)));
await page.goto("https://crm.marcosbarbosagroup.com/hoy", { waitUntil: "networkidle" });
await page.locator(".tabs button", { hasText: "Pipeline" }).click();
await page.waitForSelector(".deal, .empty");
console.log("stages:", await page.locator(".stage").count(), "deals:", await page.locator(".deal").count());
await page.screenshot({ path: "shot-pipe.png", fullPage: true });
if ((await page.locator(".deal-more").count()) > 0) {
  await page.locator(".deal-more").first().click();
  await page.waitForSelector(".pipe-menu");
  console.log("menu items:", await page.locator(".pipe-menu button").count());
  await page.screenshot({ path: "shot-pipe-menu.png" });
}
console.log("pageerrors:", errs.length?errs:"(none)");
await browser.close(); console.log("done");
