import { chromium } from "playwright";

const BASE = "https://crm.marcosbarbosagroup.com";
const TOKEN = process.env.TOKEN;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1100 },
  deviceScaleFactor: 2,
  extraHTTPHeaders: { Authorization: `token ${TOKEN}` },
});
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE ERR:", m.text()));

await page.goto(`${BASE}/hoy`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Negocios" }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: "shot-embudo.png", fullPage: true });
console.log("shot-embudo.png");

await page.getByText("ZZ Prueba Embudo").first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: "shot-negocio-detalle.png" });
console.log("shot-negocio-detalle.png");

await page.getByRole("tab", { name: /Presupuesto/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: "shot-negocio-presupuesto.png" });
console.log("shot-negocio-presupuesto.png");

await browser.close();
