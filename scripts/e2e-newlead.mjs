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
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".tabs button", { hasText: "Contactos" }).click();
await page.waitForSelector(".lead, .empty");

// 1) Nuevo contacto
await page.locator("button.btn-primary", { hasText: "Nuevo" }).click();
await page.waitForSelector(".drawer .form");
await page.fill('.field:has-text("Nombre") input', "ZZTest");
await page.fill('.field:has-text("Apellido") input', "Prueba");
await page.fill('.field:has-text("Email") input', "zztest@example.com");
await page.fill('.field:has-text("Teléfono") input', "+54 9 000");
await page.screenshot({ path: "shot-newlead.png" });
await page.locator("button.btn-primary", { hasText: "Crear contacto" }).click();
await page.waitForSelector(".drawer-head h2");
console.log("creado ->", (await page.locator(".drawer-head h2").textContent())?.trim());

// 2) Tarea en el contacto
await page.fill(".task-add input", "ZZ tarea de prueba");
await page.press(".task-add input", "Enter");
await page.waitForTimeout(800);
console.log("tareas en el drawer:", await page.locator(".dtasks li").count());
await page.screenshot({ path: "shot-lead-task.png" });

console.log("pageerrors:", errs.length ? errs : "(none)");
await browser.close();
console.log("done");
