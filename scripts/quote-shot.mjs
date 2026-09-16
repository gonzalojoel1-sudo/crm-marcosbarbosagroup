// Renderiza el preview a A4, mide la altura y genera PNG + PDF para inspección.
// El ancho del viewport debe ser la CAJA IMPRIMIBLE (210mm - 15mm - 15mm = 180mm),
// que es lo que Chromium usa al paginar con los márgenes de @page.
import { chromium } from "playwright";

const MM = 96 / 25.4; // px por mm a 96dpi
const CONTENT_W = Math.round((210 - 15 - 15) * MM);
const CONTENT_H = Math.round((297 - 13 - 12) * MM); // caja imprimible en px

// --factura mide el preview de factura; sin flag, el del presupuesto.
const factura = process.argv.includes("--factura");
const src = factura ? "/tmp/invoice-preview.html" : "/tmp/quote-preview.html";
const png = factura ? "invoice-preview.png" : "quote-preview.png";
const pdf = factura ? "invoice-preview.pdf" : "quote-preview.pdf";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Math.round(210 * MM), height: 1123 },
  deviceScaleFactor: 2,
});
await page.emulateMedia({ media: "print" });
await page.goto(`file://${src}`, { waitUntil: "networkidle" });
// Simula los márgenes de @page para que el PNG se vea como la hoja real.
await page.addStyleTag({ content: "body { padding: 13mm 15mm 12mm; background: #fff; }" });
await page.waitForTimeout(400);

const doc = await page.evaluate(() => {
  const d = document.querySelector(".doc");
  return { doc: d.getBoundingClientRect().height, body: document.body.scrollHeight };
});

const pages = Math.max(1, Math.ceil((doc.doc - 8) / CONTENT_H));
console.log(
  `ancho caja: ${CONTENT_W}px (${(CONTENT_W / MM).toFixed(0)}mm) · ` +
    `alto doc: ${doc.doc.toFixed(0)}px (${(doc.doc / MM).toFixed(1)}mm) · ` +
    `caja alta: ${CONTENT_H}px (${(CONTENT_H / MM).toFixed(1)}mm) · páginas: ${pages}`,
);

await page.screenshot({ path: png, fullPage: true });
await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
await browser.close();
