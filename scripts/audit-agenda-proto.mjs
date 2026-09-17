// Instrumentación del prototipo: mide INVARIANTES y reporta violaciones.
// No arregla nada. Solo evidencia. Uso: node scripts/audit-agenda-proto.mjs
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const FILE = pathToFileURL(path.resolve("prototypes/agenda/index.html")).href;
const VIEWPORTS = [
  { w: 1440, h: 900, label: "1440x900" },
  { w: 1280, h: 800, label: "1280x800" },
  { w: 1920, h: 1080, label: "1920x1080" },
];
const VARIANTS = [
  { v: 1, name: "franja" },
  { v: 2, name: "pliegue" },
  { v: 3, name: "zoom" },
];

const browser = await chromium.launch();
const all = [];

for (const vp of VIEWPORTS) {
  for (const va of VARIANTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto(`${FILE}?v=${va.v}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);

    const r = await page.evaluate(() => {
      const q = (s) => [...document.querySelectorAll(s)];
      const vis = (el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const out = { viol: [] };

      // 1. titulos truncados a algo inutil
      const evs = q(".ev").filter(vis);
      const info = evs.map((e) => {
        const t = e.querySelector(".t");
        if (!t) return { full: true, vis: 99, txt: "" };
        const cut = t.scrollWidth > t.clientWidth + 1;
        const vis = cut ? Math.floor((t.textContent.length * t.clientWidth) / t.scrollWidth) : t.textContent.length;
        return { full: !cut, vis, txt: t.textContent.trim(), el: e };
      });
      out.events = evs.length;
      out.titlesFull = info.filter((i) => i.full).length;
      // Un bloque que comparte columna (varios carriles) es angosto por definicion:
      // ahi el titulo completo NO puede entrar y ninguna referencia lo resuelve
      // (Google trunca, FullCalendar deja tapar hasta la mitad). Lo exigible es que
      // el titulo completo sea RECUPERABLE (atributo title / detalle al hacer click).
      const angostos = new Set([...document.querySelectorAll(".ev[data-narrow]")]);
      const recuperable = (e) => (e.getAttribute("title") || "").length > 0;
      const irrecuperables = [...angostos].filter((e) => !recuperable(e));
      if (irrecuperables.length) out.viol.push(`${irrecuperables.length} bloques angostos sin titulo recuperable`);

      // fuera de los angostos, el titulo debe ser identificable (menos de 10 caracteres visibles)
      out.titlesUnreadable = info.filter((i) => !i.full && i.vis < 10 && !angostos.has(i.el)).map((i) => `${i.txt.slice(0, 18)}(${i.vis})`);
      if (out.titlesUnreadable.length) out.viol.push(`titulos ilegibles: ${out.titlesUnreadable.length}/${out.events}`);

      // 2. tiempo ausente o no visible
      const noTime = evs.filter((e) => {
        const m = e.querySelector(".m");
        return !m || !m.textContent.trim() || m.scrollWidth > m.clientWidth + 1;
      });
      out.noTime = noTime.length;
      if (noTime.length) out.viol.push(`sin rango horario legible: ${noTime.length}`);

      // 2b. TODO texto debe tener caja real (un ancho 0 pasa cualquier chequeo de scroll)
      const colapsados = q(".ev .t, .ev .m, .cal .name, .hourlab, .rangetitle, .rangecount")
        .filter(vis).filter((el) => {
          const b = el.getBoundingClientRect();
          return (el.textContent || "").trim() && b.width < 6;
        });
      if (colapsados.length) out.viol.push(`texto con ancho 0: ${colapsados.map((e) => e.className.split(" ")[0]).join(",")}`);

      // 2c. el sidebar debe mostrar NOMBRES, no solo puntos y numeros
      const nombres = q(".cal .name").filter(vis).filter((el) => el.getBoundingClientRect().width > 10);
      const cals = q(".cal").filter(vis);
      if (nombres.length !== cals.length) out.viol.push(`agendas sin nombre visible: ${cals.length - nombres.length}/${cals.length}`);

      // 2d. paneles en su columna (el mes no debe caer debajo del sidebar)
      const mini = document.querySelector(".mini");
      const side = document.querySelector(".side");
      if (mini && side && vis(mini)) {
        const mb = mini.getBoundingClientRect(), sb = side.getBoundingClientRect();
        if (mb.top > sb.bottom - 4) out.viol.push("el panel del mes quedo debajo del sidebar");
      }
      if (innerWidth <= 1559 && mini && vis(mini)) out.viol.push(`panel del mes visible a ${innerWidth}px (deberia plegarse)`);

      // 3. sidebar: calendario apagado pero con eventos dibujados
      const off = q(".cal[data-off]").map((c) => (c.querySelector(".name")?.textContent || "").trim());
      out.offCalendars = off;
      out.renderedCats = [...new Set(evs.map((e) => getComputedStyle(e).getPropertyValue("--c").trim()))].length;

      // 4. conteo del sidebar vs realidad
      const counts = q(".cal").map((c) => ({
        name: (c.querySelector(".name")?.textContent || "").trim(),
        says: Number((c.querySelector(".count")?.textContent || "0").trim()),
      }));

      // 5. "sin sincronizar" declarado vs real
      const said = (document.querySelector(".rangecount")?.textContent || "").match(/(\d+)\s+sin sincronizar/);
      out.syncSaid = said ? Number(said[1]) : null;

      // 6. overflow horizontal de cualquier nodo visible
      const over = [];
      for (const el of q(".ev, .bandfold, .bandlab, .rangecount, .rangetitle, .zoomctl, .seg, .btn, .cal, .legend *")) {
        if (!vis(el)) continue;
        const p = el.parentElement;
        if (!p) continue;
        const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
        if (a.right > b.right + 2 || a.left < b.left - 2) {
          over.push(`${el.className.split(" ")[0]}:${Math.round(a.right - b.right)}px`);
        }
      }
      out.overflow = [...new Set(over)];
      if (out.overflow.length) out.viol.push(`desborda el contenedor: ${out.overflow.length}`);

      // 7. tamano de fuente minimo usado en texto real
      const sizes = q(".ev .t, .ev .m, .hourlab, .rangecount, .legend div, .cal .name")
        .filter(vis).map((e) => parseFloat(getComputedStyle(e).fontSize));
      out.minFont = sizes.length ? Math.min(...sizes) : null;
      if (out.minFont && out.minFont < 10) out.viol.push(`fuente < 10px: ${out.minFont}px`);

      // 8. la pagina no scrollea; y en densidad por defecto la grilla tampoco scrollea adentro
      out.pageScroll = document.documentElement.scrollHeight > window.innerHeight + 2;
      const wrap = document.querySelector(".gridwrap");
      out.innerScroll = wrap ? wrap.scrollHeight - wrap.clientHeight : 0;
      const zoomDefault = !document.querySelector(".zoomctl button.on:not([data-z='1'])");
      if (out.innerScroll > 2 && zoomDefault) out.viol.push(`la grilla scrollea ${out.innerScroll}px en densidad por defecto`);
      if (getComputedStyle(document.documentElement).colorScheme !== "dark") out.viol.push("falta color-scheme: dark");
      const sk = document.querySelector(".skip");
      if (!sk) out.viol.push("falta skip link");
      else { const b = sk.getBoundingClientRect(); if (b.height > 4 && b.top > -50) out.viol.push("el skip link esta visible sin foco"); }

      // 9. choque del control con contenido de la app
      const pk = document.querySelector(".proto-picker");
      if (pk) {
        const pb = pk.getBoundingClientRect();
        const hit = q(".topbar *, .heads *").find((el) => {
          if (!vis(el)) return false;
          const b = el.getBoundingClientRect();
          return !(b.bottom < pb.top || b.top > pb.bottom || b.right < pb.left || b.left > pb.right);
        });
        out.pickerHit = hit ? hit.className.split(" ")[0] : null;
        if (hit) out.viol.push(`el picker tapa: ${out.pickerHit}`);
      }

      // 9b. contraste WCAG del texto de cada bloque contra su propio fondo,
      //     componiendo el alfa tal como se ve en pantalla
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      const pixel = (bg, fg) => { cx.clearRect(0,0,1,1); cx.fillStyle = bg; cx.fillRect(0,0,1,1);
        if (fg) { cx.fillStyle = fg; cx.fillRect(0,0,1,1); } const d = cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
      const rel = (rgb) => { const f = rgb.map((v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }); return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]; };
      const ratio = (a1, b1) => { const la = rel(a1), lb = rel(b1); const hi = Math.max(la,lb), lo = Math.min(la,lb); return (hi+0.05)/(lo+0.05); };
      let peor = 99, peorTxt = "";
      for (const e of evs) {
        const cs = getComputedStyle(e);
        const fondo = pixel(cs.backgroundColor, null);
        for (const sel of [".t", ".m"]) {
          const n2 = e.querySelector(sel);
          if (!n2) continue;
          const cs2 = getComputedStyle(n2);
          const visible = pixel(cs.backgroundColor, cs2.color);
          const r2 = ratio(fondo, visible);
          if (r2 < peor) { peor = r2; peorTxt = `${sel}:${(n2.textContent||"").trim().slice(0,14)}`; }
        }
      }
      out.contrast = evs.length ? Math.round(peor * 100) / 100 : null;
      out.contrastWorst = peorTxt;
      if (evs.length && peor < 4.5) out.viol.push(`contraste ${peor.toFixed(2)}:1 en ${peorTxt} (minimo 4.5)`);

      // 9c. las lineas de la grilla deben ser perceptibles (~1.3:1) y el titulo nunca desaparecer
      const lineContrast = (sel, prop) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const m = (cs[prop] || "").match(/[\d.]+/g);
        if (!m) return null;
        const [r2, g2, b2, a2 = 1] = m.map(Number);
        const fondo = pixel(getComputedStyle(document.body).backgroundColor, null);
        const linea = pixel(getComputedStyle(document.body).backgroundColor, `rgba(${r2},${g2},${b2},${a2})`);
        return Math.round(ratio(fondo, linea) * 1000) / 1000;
      };
      const ch = lineContrast(".hourline", "borderTopColor");
      const cc = lineContrast(".col", "borderRightColor");
      out.lineH = ch; out.lineC = cc;
      if (ch && ch < 1.3) out.viol.push(`linea de hora imperceptible (${ch}:1)`);
      if (cc && cc < 1.2) out.viol.push(`separador de columna imperceptible (${cc}:1)`);
      const sinTitulo = q(".ev").filter(vis).filter((e) => {
        const t = e.querySelector(".t");
        return t && getComputedStyle(t).display === "none" && !e.hasAttribute("data-busy");
      });
      if (sinTitulo.length) out.viol.push(`${sinTitulo.length} bloques sin titulo visible`);

      // 9d. ningun par de bloques de la misma columna puede superponerse en area
      let choques = 0;
      for (const col of q(".col")) {
        const es = [...col.querySelectorAll(".ev")].map((e) => e.getBoundingClientRect())
          .filter((b) => b.width > 0 && b.height > 0);
        for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
          const A = es[i], B = es[j];
          if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) choques++;
        }
      }
      out.overlaps = choques;
      if (choques) out.viol.push(`${choques} pares de bloques superpuestos en la misma columna`);

      // 9e. nada de bordes por defecto del navegador en bloques (sombra O borde, no ambos)
      const conBorde = q(".ev").filter(vis).filter((e) => parseFloat(getComputedStyle(e).borderTopWidth) > 0);
      if (conBorde.length) out.viol.push(`${conBorde.length} bloques con borde del navegador`);

      // 9f. accesibilidad de los eventos: nombre autosuficiente + eje decorativo oculto + live region
      const sinNombre = q(".ev").filter(vis).filter((e) => {
        const al = e.getAttribute("aria-label") || "";
        const t2 = (e.querySelector(".t")?.textContent || "").trim();
        const hora = (e.querySelector(".m")?.textContent || "").trim();
        return !al || (t2 && !al.includes(t2.slice(0, 8))) || !/[0-9]{2}:[0-9]{2} a [0-9]{2}:[0-9]{2}/.test(al) || !hora;
      });
      if (sinNombre.length) out.viol.push(`${sinNombre.length} eventos sin nombre accesible completo (dia+hora+titulo)`);
      const decorativos = [document.querySelector(".gutter"), ...q(".hourline")];
      const malDecorado = decorativos.filter((e) => e && e.getAttribute("aria-hidden") !== "true");
      if (malDecorado.length) out.viol.push(`${malDecorado.length} elementos decorativos sin aria-hidden (eje o lineas)`);
      const nombreSucio = q(".ev").filter(vis).filter((e) => /,\s*,|,\s*$/.test(e.getAttribute("aria-label") || ""));
      if (nombreSucio.length) out.viol.push(`${nombreSucio.length} nombres accesibles con campos vacios`);
      if (!document.querySelector('[role="status"][aria-live="polite"]')) out.viol.push("falta region aria-live para cambios de estado");

      // 9g. el indicador de foco debe ser perceptible: SC 1.4.11 exige >= 3:1
      const foco = (() => {
        const el = document.querySelector(".ev"); if (!el) return null;
        const cv2 = document.createElement("canvas"); cv2.width = cv2.height = 1;
        const cx2 = cv2.getContext("2d", { willReadFrequently: true });
        const p2 = (bg, fg) => { cx2.clearRect(0,0,1,1); cx2.fillStyle = bg; cx2.fillRect(0,0,1,1);
          if (fg) { cx2.fillStyle = fg; cx2.fillRect(0,0,1,1); } const d = cx2.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
        el.focus();
        const cs = getComputedStyle(el);
        if (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) < 2) return 0;
        const fondo = p2(getComputedStyle(document.body).backgroundColor, null);
        return Math.round(ratio(fondo, p2(getComputedStyle(document.body).backgroundColor, cs.outlineColor)) * 100) / 100;
      })();
      out.focus = foco;
      if (foco !== null && foco < 3) out.viol.push(`indicador de foco ${foco}:1 (SC 1.4.11 exige 3:1)`);

      // 10. estados interactivos declarados
      out.hasHoverRules = [...document.styleSheets].some((sh) => {
        try { return [...sh.cssRules].some((r) => r.selectorText && r.selectorText.includes(":hover")); }
        catch { return false; }
      });

      out.counts = counts;
      return out;
    });

    // interacciones: apagar un calendario debe quitar sus eventos; el toggle del mes debe cambiar el ancho
    if (vp.label === "1440x900") {
      const before = await page.evaluate(() => document.querySelectorAll(".ev").length);
      await page.locator('.cal[data-cat="software"]').click();
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.querySelectorAll(".ev").length);
      const off = await page.evaluate(() => document.querySelector('.cal[data-cat="software"]').hasAttribute("data-off"));
      if (after >= before) r.viol.push(`apagar un calendario no quito eventos (${before}->${after}, off=${off})`);
      await page.locator('.cal[data-cat="software"]').click();
      await page.waitForTimeout(250);
      const restored = await page.evaluate(() => document.querySelectorAll(".ev").length);
      if (restored !== before) r.viol.push(`volver a encender no restauro (${before}->${restored})`);

      // apagar TODO (agendas + origenes) debe vaciar la grilla y mostrar el estado vacio
      for (const c of ["trabajo", "ministerial", "personal", "consultora", "software"]) {
        await page.locator(`.cal[data-cat="${c}"]`).click();
        await page.waitForTimeout(120);
      }
      await page.locator('.cal[data-origin="Google"]').click();
      await page.waitForTimeout(300);
      const vacio = await page.evaluate(() => ({
        ev: document.querySelectorAll(".ev").length,
        empty: !!document.querySelector(".grid-empty"),
      }));
      if (vacio.ev !== 0) r.viol.push(`apagar todo deja ${vacio.ev} eventos dibujados`);
      if (!vacio.empty) r.viol.push("apagar todo no muestra estado vacio");
    }
    all.push({ vp: vp.label, variant: va.name, ...r });
    await page.close();
  }
}
// ── Vista Lista: la alternativa accesible ──
const lp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await lp.goto(`${FILE}?v=3&view=lista`, { waitUntil: "networkidle" });
await lp.waitForTimeout(400);
const lista = await lp.evaluate(() => {
  const secs = [...document.querySelectorAll(".ldia")];
  const items = [...document.querySelectorAll(".lev")];
  return {
    secciones: secs.length,
    conHeading: secs.filter((s) => s.querySelector("h3")).length,
    items: items.length,
    grilla: !!document.querySelector(".gridwrap"),
    densidad: !!document.querySelector(".zoomctl"),
    nombresCompletos: items.filter((e) => /de septiembre, [0-9]{2}:[0-9]{2} a [0-9]{2}:[0-9]{2},/.test(e.getAttribute("aria-label") || "")).length,
    hoy: !!document.querySelector('.ldia[data-today]'),
    url: location.search,
  };
});
// volver a Semana desde la UI debe restaurar la grilla
await lp.locator('[data-view="semana"]').click();
await lp.waitForTimeout(500);
const volvio = await lp.evaluate(() => !!document.querySelector(".gridwrap") && !document.querySelector(".ldia"));
await lp.close();

for (const r of all) {
  const mark = r.viol.length ? "✗" : "✓";
  const pct = Math.round((r.titlesFull / r.events) * 100);
  console.log(`${mark} ${r.variant.padEnd(8)} ${r.vp.padEnd(10)} eventos ${String(r.events).padStart(2)}  titulos completos ${String(pct).padStart(3)}%  ilegibles ${String(r.titlesUnreadable.length).padStart(2)}  fuente ${r.minFont}px  contraste ${r.contrast}:1  lineas ${r.lineH}/${r.lineC}  foco ${r.focus}:1  scroll ${r.pageScroll ? "SÍ" : "no"}`);
  if (r.viol.length) console.log(`    violaciones: ${r.viol.join(" | ")}`);
}
console.log("════════ VISTA LISTA (alternativa accesible) ════════");
{
  const v = [];
  if (lista.secciones !== 5) v.push(`secciones ${lista.secciones} (esperado 5)`);
  if (lista.conHeading !== 5) v.push(`secciones con heading ${lista.conHeading}/5`);
  if (lista.grilla) v.push("la grilla sigue en el DOM");
  if (lista.densidad) v.push("control de densidad visible en la lista");
  if (lista.nombresCompletos !== lista.items) v.push(`nombres accesibles completos ${lista.nombresCompletos}/${lista.items}`);
  if (!lista.hoy) v.push("no marca el dia de hoy");
  if (!lista.url.includes("view=lista")) v.push("la URL no refleja la vista");
  if (!volvio) v.push("volver a Semana no restaura la grilla");
  console.log((v.length ? "  ✗ " : "  ✓ ") + `secciones ${lista.secciones} · items ${lista.items} · nombres completos ${lista.nombresCompletos}/${lista.items} · hoy ${lista.hoy} · url ${lista.url} · vuelve a Semana ${volvio}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

// ── Vista Mes: tabla nativa, dias alineados a su columna ──
const mp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mp.goto(`${FILE}?v=3&view=mes`, { waitUntil: "networkidle" });
await mp.waitForTimeout(400);
const mes = await mp.evaluate(() => {
  const t = document.querySelector(".mes");
  if (!t) return { falta: true };
  const cols = t.querySelectorAll("thead th").length;
  const filas = [...t.querySelectorAll("tbody tr")];
  // el dia 1 es lunes: debe caer en la primera columna
  const primeraFila = [...filas[0].querySelectorAll("td")];
  const dia1 = primeraFila.findIndex((c) => c.querySelector(".mnum")?.textContent.trim() === "1");
  const hoy = t.querySelector('[aria-current="date"]');
  return {
    cols, filas: filas.length,
    celdasPorFila: filas.map((f) => f.querySelectorAll("td").length),
    dia1EnColumna: dia1,
    hoy: hoy ? hoy.querySelector(".mnum").textContent.trim() : null,
    nombres: [...t.querySelectorAll(".mev")].filter((e) => /de septiembre, [0-9]{2}:[0-9]{2} a/.test(e.getAttribute("aria-label") || "")).length,
    eventos: t.querySelectorAll(".mev").length,
  };
});
await mp.close();

console.log("════════ VISTA MES (tabla nativa) ════════");
{
  const v = [];
  if (mes.falta) v.push("no renderiza la tabla");
  else {
    if (mes.cols !== 5) v.push(`columnas ${mes.cols} (esperado 5)`);
    if (mes.celdasPorFila.some((c) => c !== mes.cols)) v.push(`celdas por fila ${mes.celdasPorFila.join("/")} != ${mes.cols} columnas`);
    if (mes.dia1EnColumna !== 0) v.push(`el dia 1 cae en la columna ${mes.dia1EnColumna} (deberia ser 0 = lunes)`);
    if (mes.hoy !== "16") v.push(`hoy marcado como ${mes.hoy}`);
    if (mes.nombres !== mes.eventos) v.push(`nombres completos ${mes.nombres}/${mes.eventos}`);
  }
  console.log((v.length ? "  ✗ " : "  ✓ ") + `columnas ${mes.cols} · filas ${mes.filas} · celdas/fila ${(mes.celdasPorFila || []).join("/")} · dia 1 en columna ${mes.dia1EnColumna} · hoy ${mes.hoy} · eventos ${mes.eventos} · nombres completos ${mes.nombres}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
const zero = all[0];
console.log("calendarios apagados (data-off):", zero.offCalendars.join(", ") || "(ninguno)");
console.log("sidebar declara:", zero.counts.map((c) => `${c.name}=${c.says}`).join("  "));
console.log("'sin sincronizar' declara:", zero.syncSaid);

// ── Anunciador persistente: hermano de #stage y sobrevive al re-render ──
const ap = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await ap.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await ap.waitForTimeout(350);
const ann = await ap.evaluate(() => {
  const a = document.querySelector("#announcer");
  if (!a) return { falta: true };
  const dentro = document.querySelector("#stage").contains(a);
  window.__annRef = a;                       // referencia antes de re-renderizar
  return { rol: a.getAttribute("role"), live: a.getAttribute("aria-live"), atomic: a.getAttribute("aria-atomic"), dentro };
});
await ap.locator('[data-view="lista"]').click();
await ap.waitForTimeout(400);
const sobrevive = await ap.evaluate(() => document.querySelector("#announcer") === window.__annRef);
await ap.close();
{
  const v = [];
  if (ann.falta) v.push("no existe #announcer");
  else {
    if (ann.dentro) v.push("#announcer esta dentro de #stage (se destruye al re-renderizar)");
    if (!sobrevive) v.push("#announcer no sobrevivio al re-render");
    if (ann.rol !== "status" || ann.live !== "polite" || ann.atomic !== "true") v.push(`atributos ${ann.rol}/${ann.live}/${ann.atomic}`);
  }
  console.log((v.length ? "  ✗ " : "  ✓ ") + `anunciador persistente · fuera de #stage ${!ann.dentro} · sobrevive ${sobrevive}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Panel lateral no-modal: abre, enfoca, no tapa la grilla, Escape cierra y devuelve el foco ──
const pp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pp.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await pp.waitForTimeout(350);
const panelInicial = await pp.evaluate(() => !!document.querySelector("#panel"));
await pp.evaluate(() => abrirPanel({ dia: 1, min: 9 * 60, dur: 45 }));
await pp.waitForTimeout(300);
const abierto = await pp.evaluate(() => {
  const p = document.querySelector("#panel");
  if (!p) return { falta: true };
  const t = p.querySelector("#panel-titulo");
  const g = document.querySelector("#grilla");
  const gb = g ? g.getBoundingClientRect() : null;
  const pb = p.getBoundingClientRect();
  // el contrato real es NO superponerse a las columnas de días: que existan no alcanza
  const solapa = [...document.querySelectorAll(".col")].some((c) => {
    const b = c.getBoundingClientRect();
    return pb.left < b.right - 1 && b.left < pb.right - 1;
  });
  // contraste del texto del panel contra su fondo efectivo (sube por ancestros sin fondo)
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const pixel = (bg, fg) => { cx.clearRect(0,0,1,1); cx.fillStyle = bg; cx.fillRect(0,0,1,1);
    if (fg) { cx.fillStyle = fg; cx.fillRect(0,0,1,1); } const d = cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
  const rel = (rgb) => { const f = rgb.map((v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }); return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]; };
  const ratio = (a1, b1) => { const la = rel(a1), lb = rel(b1); const hi = Math.max(la,lb), lo = Math.min(la,lb); return (hi+0.05)/(lo+0.05); };
  const fondoEfectivo = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const contraste = (sel) => {
    const el = p.querySelector(sel);
    if (!el) return { sel, ratio: null };
    const cs = getComputedStyle(el);
    const r = ratio(pixel(fondoEfectivo(el), null), pixel(fondoEfectivo(el), cs.color));
    return { sel, ratio: Math.round(r * 100) / 100 };
  };
  return {
    rol: p.getAttribute("role"), modal: p.getAttribute("aria-modal"),
    etiquetado: p.getAttribute("aria-labelledby") === "panel-titulo" && !!t,
    focoEnTitulo: document.activeElement === p.querySelector("input, textarea, [tabindex]"),
    focoEnPanel: p.contains(document.activeElement),
    grillaOperable: document.querySelectorAll(".ev").length > 0,
    grillaVisible: !!gb && gb.width > 0 && gb.height > 0,
    solapa,
    shellPanel: document.querySelector(".shell")?.getAttribute("data-panel"),
    texto: (t?.textContent || "").trim(),
    contrastes: ["#panel-titulo", "#panel label", "#panel .p-hint"].map(contraste),
  };
});
await pp.keyboard.press("Escape");
await pp.waitForTimeout(300);
const cerrado = await pp.evaluate(() => ({
  hayPanel: !!document.querySelector("#panel"),
  focoEnStage: document.querySelector("#stage").contains(document.activeElement),
}));
// la rama de edición también declara día y hora en el título
await pp.evaluate(() => abrirPanel({ dia: 1, min: 9 * 60, dur: 60, evento: { title: "Reunión de socios" } }));
await pp.waitForTimeout(300);
const editar = await pp.evaluate(() => (document.querySelector("#panel-titulo")?.textContent || "").trim());
await pp.keyboard.press("Escape");
await pp.waitForTimeout(300);
await pp.close();
{
  const v = [];
  if (panelInicial) v.push("el panel ya estaba en el DOM antes de abrir");
  if (abierto.falta) v.push("no se abre #panel");
  else {
    if (abierto.rol !== "dialog") v.push(`role ${abierto.rol}`);
    if (abierto.modal !== "false") v.push(`aria-modal ${abierto.modal}`);
    if (!abierto.etiquetado) v.push("sin aria-labelledby correcto");
    if (!abierto.focoEnTitulo || !abierto.focoEnPanel) v.push("el foco no entra al panel");
    if (!abierto.grillaOperable || !abierto.grillaVisible) v.push("la grilla desaparecio (el panel no debe taparla)");
    if (abierto.solapa) v.push("el panel se superpone horizontalmente a las columnas");
    if (abierto.shellPanel !== "on") v.push(`shell data-panel ${abierto.shellPanel}`);
    if (!/^Nueva reunión · martes 16, 09:00 – 09:45$/.test(abierto.texto)) v.push(`titulo de creacion sin contexto: ${abierto.texto}`);
    for (const c of abierto.contrastes) {
      if (c.ratio === null) v.push(`no se pudo medir el contraste de ${c.sel}`);
      else if (c.ratio < 4.5) v.push(`contraste ${c.ratio}:1 en ${c.sel} (minimo 4.5)`);
    }
  }
  if (cerrado.hayPanel) v.push("Escape no cierra el panel");
  if (!cerrado.focoEnStage) v.push("Escape no devuelve el foco");
  if (!/^Editar · Reunión de socios · martes 16, 09:00 – 10:00$/.test(editar)) v.push(`titulo de edicion sin contexto: ${editar}`);
  const peor = abierto.falta ? null : Math.min(...abierto.contrastes.map((c) => c.ratio ?? 99));
  console.log((v.length ? "  ✗ " : "  ✓ ") + `panel no-modal · abre ${abierto.texto || "-"} · foco entra ${abierto.focoEnTitulo} · grilla visible ${abierto.grillaVisible} · solapa columnas ${abierto.solapa} · contraste panel ${peor}:1 · Escape cierra ${!cerrado.hayPanel} · foco vuelve ${cerrado.focoEnStage}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Crear con un solo puntero sin arrastre (A1) y por teclado ──
const cp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await cp.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await cp.waitForTimeout(400);
const col = await cp.locator('.col[data-day="2"]').boundingBox();
const y = await cp.evaluate(() => geom().yOf(11 * 60));
await cp.mouse.click(col.x + col.width / 2, col.y + y + 6);
await cp.waitForTimeout(400);
const creado = await cp.evaluate(() => {
  const t = document.querySelector("#panel-titulo")?.textContent || "";
  return { abierto: !!document.querySelector("#panel"), texto: t.trim(), diceDia: /miércoles 17/.test(t), diceHora: /11:0\d/.test(t) };
});
await cp.keyboard.press("Escape");
await cp.waitForTimeout(300);
// un arrastre (> 4 px) crea el evento de siempre y NO abre el panel
const evAntes = await cp.evaluate(() => document.querySelectorAll(".ev").length);
const colD = await cp.locator('.col[data-day="3"]').boundingBox();
const yD = await cp.evaluate(() => geom().yOf(16 * 60));
await cp.mouse.move(colD.x + colD.width / 2, colD.y + yD);
await cp.mouse.down();
await cp.mouse.move(colD.x + colD.width / 2, colD.y + yD + 45, { steps: 6 });
await cp.mouse.up();
await cp.waitForTimeout(400);
const drag = await cp.evaluate(() => ({ ev: document.querySelectorAll(".ev").length, panel: !!document.querySelector("#panel") }));
await cp.keyboard.press("Escape");
await cp.close();
// ── camino de teclado: atajo N y botón por día en la Lista ──
const kp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await kp.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await kp.waitForTimeout(400);
await kp.keyboard.press("n");
await kp.waitForTimeout(300);
const porTecla = await kp.evaluate(() => (document.querySelector("#panel-titulo")?.textContent || "").trim());
await kp.keyboard.press("Escape");
await kp.waitForTimeout(300);
await kp.locator('[data-view="lista"]').click();
await kp.waitForTimeout(500);
await kp.locator('[data-nueva-dia="3"]').click();
await kp.waitForTimeout(300);
const porDia = await kp.evaluate(() => (document.querySelector("#panel-titulo")?.textContent || "").trim());
await kp.keyboard.press("Escape");
await kp.close();
{
  const v = [];
  if (!creado.abierto) v.push("el click en el hueco no abre el panel");
  if (!creado.diceDia) v.push(`el panel no dice el dia: "${creado.texto}"`);
  if (!creado.diceHora) v.push(`el panel no dice la hora: "${creado.texto}"`);
  if (drag.ev <= evAntes) v.push(`el arrastre no creo evento (${evAntes}->${drag.ev})`);
  if (drag.panel) v.push("el arrastre (>4 px) abrio el panel");
  if (!/^Nueva reunión · martes 16, 15:30 – 16:15$/.test(porTecla)) v.push(`atajo N sin hora actual: "${porTecla}"`);
  if (!/^Nueva reunión · jueves 18, 09:00 – 09:45$/.test(porDia)) v.push(`boton por dia sin contexto: "${porDia}"`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A1 puntero sin arrastre · ${creado.texto} · arrastre crea ${drag.ev > evAntes} sin panel ${!drag.panel} · tecla N "${porTecla}" · por dia "${porDia}"`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Guardar desde el panel: crea el evento con lo elegido, cierra, enfoca y NO anuncia ──
// (el foco ES el anuncio: moverlo y anunciar son alternativas, nunca simultaneos)
const gp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await gp.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await gp.waitForTimeout(400);
await gp.evaluate(() => abrirPanel({ dia: 2, min: 11 * 60, dur: 45 }));
await gp.waitForTimeout(300);
await gp.locator('#panel .p-dur[data-dur="90"]').click();
await gp.locator("#p-inicio").fill("13:30");
await gp.locator("#p-titulo").fill("Reunión de prueba");
await gp.keyboard.press("Enter");
await gp.waitForTimeout(500);
const guardado = await gp.evaluate(() => {
  const nuevo = [...document.querySelectorAll(".ev")].find((e) => (e.textContent || "").includes("Reunión de prueba"));
  const idx = nuevo ? Number(nuevo.dataset.i) : -1;
  const ev = idx >= 0 ? EVENTS[idx] : null;
  return {
    creado: !!nuevo,
    panel: !!document.querySelector("#panel"),
    focoEnNuevo: nuevo ? document.activeElement === nuevo : false,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
    ev: ev ? { day: ev.day, min: ev.min, dur: ev.dur, title: ev.title, cat: ev.cat, origin: ev.origin, sync: ev.sync } : null,
  };
});
await gp.close();
{
  const v = [];
  const e = guardado.ev;
  if (!guardado.creado) v.push("no se creo la reunion");
  if (!e) v.push("el evento creado no esta en EVENTS");
  else {
    if (e.day !== 2) v.push(`dia ${e.day} (esperado 2)`);
    if (e.min !== 13 * 60 + 30) v.push(`hora ${e.min} (esperado 810)`);
    if (e.dur !== 90) v.push(`duracion ${e.dur} (esperado 90)`);
    if (e.cat !== "consultora" || e.origin !== "CRM" || e.sync !== "ok") v.push(`campos ${e.cat}/${e.origin}/${e.sync}`);
  }
  if (guardado.panel) v.push("el panel no se cerro al guardar");
  if (!guardado.focoEnNuevo) v.push("el foco no quedo en la reunion creada");
  if (guardado.anuncio) v.push(`se anuncio y ademas se movio el foco: "${guardado.anuncio}"`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `guardar · creado ${guardado.creado} · panel cerrado ${!guardado.panel} · foco ${guardado.focoEnNuevo} · anuncio "${guardado.anuncio}" · EVENTS ${JSON.stringify(e)}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Guardar fallbacks: titulo vacio y hora no parseable conservan los defaults ──
const fp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await fp.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await fp.waitForTimeout(400);
await fp.evaluate(() => abrirPanel({ dia: 2, min: 11 * 60, dur: 45 }));
await fp.waitForTimeout(300);
await fp.locator("#p-titulo").fill("");
await fp.locator("#p-inicio").fill("lalala");
await fp.keyboard.press("Enter");
await fp.waitForTimeout(500);
const fallback = await fp.evaluate(() => {
  const e = EVENTS[EVENTS.length - 1];
  return { title: e.title, min: e.min, panel: !!document.querySelector("#panel") };
});
await fp.close();
{
  const v = [];
  if (fallback.title !== "Reunión sin título") v.push(`titulo vacio guardo "${fallback.title}"`);
  if (fallback.min !== 11 * 60) v.push(`hora no parseable guardo ${fallback.min} (esperado ${11 * 60})`);
  if (fallback.panel) v.push("el panel no se cerro con fallbacks");
  console.log((v.length ? "  ✗ " : "  ✓ ") + `guardar fallbacks · titulo "${fallback.title}" · min ${fallback.min}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Edicion desde el panel: actualiza la reunion, cierra, enfoca el bloque y NO anuncia ──
const ep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await ep.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await ep.waitForTimeout(400);
const idxEdit = await ep.evaluate(() => EVENTS.findIndex((e) => e.title === "Llamada: Estudio Norte"));
await ep.evaluate((i) => abrirPanel({ dia: EVENTS[i].day, min: EVENTS[i].min, dur: EVENTS[i].dur, evento: EVENTS[i] }), idxEdit);
await ep.waitForTimeout(300);
await ep.locator("#p-titulo").fill("Llamada: Estudio Norte (editada)");
await ep.keyboard.press("Enter");
await ep.waitForTimeout(500);
const editado = await ep.evaluate((i) => {
  const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  return {
    titulo: EVENTS[i].title,
    panel: !!document.querySelector("#panel"),
    focoEnEditado: el ? document.activeElement === el : false,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, idxEdit);
await ep.close();
{
  const v = [];
  if (editado.titulo !== "Llamada: Estudio Norte (editada)") v.push(`no se actualizo el titulo: "${editado.titulo}"`);
  if (editado.panel) v.push("el panel no se cerro al editar");
  if (!editado.focoEnEditado) v.push("el foco no quedo en el elemento editado");
  if (editado.anuncio) v.push(`se anuncio y ademas se movio el foco: "${editado.anuncio}"`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `guardar edicion · titulo "${editado.titulo}" · panel cerrado ${!editado.panel} · foco ${editado.focoEnEditado} · anuncio "${editado.anuncio}"`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Si el bloque no se pinta (agenda oculta) no hay foco: guardar debe anunciar el resultado ──
const sp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await sp.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await sp.waitForTimeout(400);
await sp.locator('.cal[data-cat="consultora"]').click();   // oculta la agenda del evento nuevo
await sp.waitForTimeout(250);
await sp.evaluate(() => abrirPanel({ dia: 2, min: 11 * 60, dur: 45 }));
await sp.waitForTimeout(300);
await sp.locator("#p-titulo").fill("Reunión sin foco");
await sp.keyboard.press("Enter");
await sp.waitForTimeout(500);
const sinFoco = await sp.evaluate(() => ({
  creado: EVENTS.some((e) => e.title === "Reunión sin foco"),
  panel: !!document.querySelector("#panel"),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
await sp.close();
{
  const v = [];
  if (!sinFoco.creado) v.push("no se creo el evento con la agenda oculta");
  if (sinFoco.panel) v.push("el panel no se cerro");
  if (!/Creada Reunión sin foco, miércoles 17 de 11:00 a 11:45/.test(sinFoco.anuncio)) v.push(`no se anuncio el resultado: "${sinFoco.anuncio}"`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `guardar sin foco · creado ${sinFoco.creado} · anuncio "${sinFoco.anuncio}"`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Menú de la reunión (S3): Enter lo abre, el foco entra, Escape cierra y vuelve, sin anunciar ──
const mu = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mu.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await mu.waitForTimeout(400);
const iEv = await mu.evaluate(() => {
  const e = document.querySelector("#grilla .ev");
  e.focus();
  document.querySelector("#announcer").textContent = "";
  return Number(e.dataset.i);
});
await mu.keyboard.press("Enter");
await mu.waitForTimeout(300);
const porEnter = await mu.evaluate(() => {
  const m = document.querySelector("#menu");
  if (!m) return { falta: true };
  const items = [...m.querySelectorAll('[role="menuitem"]')];
  const b = m.getBoundingClientRect();
  return {
    rol: m.getAttribute("role"),
    nombre: (m.getAttribute("aria-label") || m.getAttribute("aria-labelledby") || "").trim(),
    items: items.map((i) => i.getAttribute("aria-label")),
    focoEnPrimero: document.activeElement === items[0],
    tamano: items.every((i) => { const r = i.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }),
    dentro: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1,
    contTabStop: m.tabIndex >= 0,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
await mu.keyboard.press("ArrowDown");
await mu.waitForTimeout(80);
const focoCicla = await mu.evaluate(() => document.activeElement?.getAttribute("role") === "menuitem");
await mu.keyboard.press("Escape");
await mu.waitForTimeout(300);
const porEscape = await mu.evaluate((i) => {
  const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  return {
    hayMenu: !!document.querySelector("#menu"),
    focoVuelve: el ? document.activeElement === el : false,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, iEv);
// click sin movimiento sobre una reunión: también abre el menú, sin anunciar
const cajaMenu = await mu.locator("#grilla .ev").first().boundingBox();
await mu.mouse.click(cajaMenu.x + cajaMenu.width / 2, cajaMenu.y + cajaMenu.height / 2);
await mu.waitForTimeout(300);
const porClick = await mu.evaluate(() => {
  const items = [...document.querySelectorAll('#menu [role="menuitem"]')];
  return {
    hayMenu: !!document.querySelector("#menu"),
    focoEnPrimero: items.length > 0 && document.activeElement === items[0],
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
await mu.keyboard.press("Escape");
await mu.waitForTimeout(200);
// un arrastre (> 4 px) sigue moviendo la reunión y NO abre el menú
const iDrag = await mu.evaluate(() => Number(document.querySelector("#grilla .ev").dataset.i));
const antesMin = await mu.evaluate((i) => EVENTS[i].min, iDrag);
const cajaDrag = await mu.locator(`#grilla .ev[data-i="${iDrag}"]`).boundingBox();
await mu.mouse.move(cajaDrag.x + cajaDrag.width / 2, cajaDrag.y + cajaDrag.height / 2);
await mu.mouse.down();
await mu.mouse.move(cajaDrag.x + cajaDrag.width / 2, cajaDrag.y + cajaDrag.height / 2 + 45, { steps: 6 });
await mu.mouse.up();
await mu.waitForTimeout(300);
const despuesDrag = await mu.evaluate((i) => ({ min: EVENTS[i].min, menu: !!document.querySelector("#menu") }), iDrag);
await mu.close();
{
  const v = [];
  const esperados = ["Editar"];   // hoy solo se renderizan las acciones implementadas
  if (porEnter.falta) v.push("Enter no abre el menu");
  else {
    if (porEnter.rol !== "menu") v.push(`role ${porEnter.rol}`);
    if (!porEnter.nombre) v.push("el menu no tiene nombre accesible");
    if (JSON.stringify(porEnter.items) !== JSON.stringify(esperados)) v.push(`items ${porEnter.items.join(" | ")} (esperado ${esperados.join(" | ")})`);
    if (!porEnter.focoEnPrimero) v.push("el foco no entra al primer item");
    if (!porEnter.tamano) v.push("hay items menores a 24x24");
    if (!porEnter.dentro) v.push("el menu se sale de la ventana");
    if (porEnter.contTabStop) v.push("el contenedor del menu es tab stop");
    if (porEnter.anuncio) v.push(`se anuncio al abrir: "${porEnter.anuncio}"`);
  }
  if (!focoCicla) v.push("ArrowDown no cicla el foco");
  if (porEscape.hayMenu) v.push("Escape no cierra el menu");
  if (!porEscape.focoVuelve) v.push("Escape no devuelve el foco a la reunion");
  if (porEscape.anuncio) v.push(`se anuncio al cerrar: "${porEscape.anuncio}"`);
  if (!porClick.hayMenu) v.push("el click sobre la reunion no abre el menu");
  if (!porClick.focoEnPrimero) v.push("el click no enfoca el primer item");
  if (porClick.anuncio) v.push(`el click anuncio: "${porClick.anuncio}"`);
  if (!(despuesDrag.min > antesMin)) v.push(`el arrastre no movio la reunion (${antesMin}->${despuesDrag.min})`);
  if (despuesDrag.menu) v.push("el arrastre (>4 px) abrio el menu");
  console.log((v.length ? "  ✗ " : "  ✓ ") + `menu · items ${(porEnter.items || []).join(" | ") || "-"} · foco primer item ${porEnter.focoEnPrimero} · dentro de ventana ${porEnter.dentro} · Escape cierra ${!porEscape.hayMenu} y vuelve el foco ${porEscape.focoVuelve} · click abre ${porClick.hayMenu} · arrastre mueve ${despuesDrag.min > antesMin} · anuncios "${porEnter.anuncio}"/"${porEscape.anuncio}"/"${porClick.anuncio}"`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
await browser.close();
