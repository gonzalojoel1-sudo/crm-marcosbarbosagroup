// Capturas de verificación: agenda (desktop), drawer de reunión, y mobile.
import { chromium } from "playwright";

const KEY = process.env.KEY;
const SEC = process.env.SEC;
const URL = process.env.URL || "https://crm.marcosbarbosagroup.com/hoy";
const auth = { Authorization: `token ${KEY}:${SEC}` };

const browser = await chromium.launch();

// 1) Desktop: agenda
const ctx = await browser.newContext({
  extraHTTPHeaders: auth,
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".ag-grid");
console.log("agenda events:", await page.locator(".ag-event").count());
await page.screenshot({ path: "shot-agenda.png", fullPage: true });

// 2) Drawer: click en el evento
if ((await page.locator(".ag-event").count()) > 0) {
  await page.locator(".ag-event").first().click();
  await page.waitForSelector(".drawer-head h2");
  console.log("drawer:", (await page.locator(".drawer-head h2").textContent())?.trim());
  await page.screenshot({ path: "shot-drawer.png" });
}

// 3) Mobile
const mctx = await browser.newContext({
  extraHTTPHeaders: auth,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const mp = await mctx.newPage();
await mp.goto(URL, { waitUntil: "networkidle" });
await mp.waitForSelector(".ag-grid");
await mp.screenshot({ path: "shot-mobile.png" });

await browser.close();
console.log("done");
