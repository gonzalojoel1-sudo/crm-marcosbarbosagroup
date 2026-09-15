import { chromium } from "playwright";
const KEY = process.env.KEY, SEC = process.env.SEC;
const browser = await chromium.launch();
const ctx = await browser.newContext({ extraHTTPHeaders: { Authorization: `token ${KEY}:${SEC}` }, viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("https://crm.marcosbarbosagroup.com/hoy", { waitUntil: "networkidle" });
await page.waitForSelector(".ag-grid");
await page.waitForTimeout(1500);
console.log("reminder visible:", await page.locator(".reminder").count());
if (await page.locator(".reminder").count()) {
  console.log("when:", (await page.locator(".rem-when").textContent())?.trim());
  console.log("title:", (await page.locator(".rem-title").textContent())?.trim());
}
await page.screenshot({ path: "shot-reminder.png" });
console.log("pageerrors:", errs.length ? errs : "(none)");
await browser.close(); console.log("done");
