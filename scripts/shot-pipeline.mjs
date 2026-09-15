import { chromium } from "playwright";
const KEY = process.env.KEY, SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` },
  viewport: { width: 1440, height: 820 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".tabs button", { hasText: "Pipeline" }).click();
await page.waitForSelector(".pipe-card, .pipe-empty");
console.log("col:", await page.locator(".pipe-col").count(), "cards:", await page.locator(".pipe-card").count());
await page.screenshot({ path: "shot-pipeline.png", fullPage: true });
console.log("pageerrors:", errs.length ? errs : "(none)");
await browser.close();
console.log("done");
