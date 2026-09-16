// Verifica el prototipo de la agenda: variantes + EL CONTROL (picker).
// Uso: VARIANT=bloque node scripts/verify-agenda-proto.mjs
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const FILE = path.resolve("prototypes/agenda/index.html");
const V = process.env.V || "2"; // 1=preciso 2=bloque 3=flujo
const URL = pathToFileURL(FILE).href + "?v=" + V;
const WANT = process.env.VARIANT || "bloque";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector("[data-variant]", { timeout: 10000 });
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const set = document.querySelectorAll("[data-variant]");
  const active = [...set].find((n) => n.dataset.active !== undefined || getComputedStyle(n).display !== "none") || set[0];
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : "(sin nodo)";
  };
  const hours = [...document.querySelectorAll(".hourlab")]
    .map((e) => e.textContent.trim()).filter(Boolean);
  return {
    variants: [...set].map((n) => n.dataset.variant),
    active: active?.dataset.variant,
    bodyFont: cs("body", "fontFamily"),
    rangetitleFont: cs(".rangetitle", "fontFamily"),
    hourFont: cs(".hourlab", "fontFamily"),
    firstHour: hours[0],
    lastHour: hours[hours.length - 1],
    events: document.querySelectorAll(".ev").length,
    busy: document.querySelectorAll(".ev[data-busy]").length,
  };
});

const picker = await page.evaluate(() => {
  const el = document.querySelector(".picker, .proto-picker, [data-picker], .proto-switch");
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  return {
    found: true,
    text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 80),
    inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    display: getComputedStyle(el).display,
  };
});

console.log("variantes:", info.variants.join(", "), "| activa:", info.active);
console.log("body:", info.bodyFont.slice(0, 40));
console.log("titulo de rango:", info.rangetitleFont.slice(0, 40));
console.log("hora (dato):", info.hourFont.slice(0, 40));
console.log("primera/ultima hora:", info.firstHour, "->", info.lastHour);
console.log("eventos:", info.events, "| ocupado:", info.busy);
console.log("picker:", picker.found ? JSON.stringify(picker) : "NO ENCONTRADO");
console.log("errores:", errors.length ? errors : "(ninguno)");

const shot = `proto-${WANT}.png`;
await page.screenshot({ path: shot });
console.log("captura ->", shot);
await browser.close();
