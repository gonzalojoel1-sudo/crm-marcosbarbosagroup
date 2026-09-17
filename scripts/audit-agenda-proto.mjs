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
  window.__stageChildRef = document.querySelector("#stage")?.firstElementChild;   // para probar que el re-render pasó
  return { rol: a.getAttribute("role"), live: a.getAttribute("aria-live"), atomic: a.getAttribute("aria-atomic"), dentro };
});
await ap.locator('[data-view="lista"]').click();
await ap.waitForTimeout(400);
const sobrevive = await ap.evaluate(() => ({
  ann: document.querySelector("#announcer") === window.__annRef,
  rerender: document.querySelector("#stage")?.firstElementChild !== window.__stageChildRef,
}));
await ap.close();
{
  const v = [];
  if (ann.falta) v.push("no existe #announcer");
  else {
    if (ann.dentro) v.push("#announcer esta dentro de #stage (se destruye al re-renderizar)");
    if (!sobrevive.rerender) v.push("no se detecto re-render de #stage (la guarda pasaria en vano)");
    if (!sobrevive.ann) v.push("#announcer no sobrevivio al re-render");
    if (ann.rol !== "status" || ann.live !== "polite" || ann.atomic !== "true") v.push(`atributos ${ann.rol}/${ann.live}/${ann.atomic}`);
  }
  console.log((v.length ? "  ✗ " : "  ✓ ") + `anunciador persistente · fuera de #stage ${!ann.dentro} · re-render ${sobrevive.rerender} · sobrevive ${sobrevive.ann}`);
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
    contrastes: ["#panel-titulo", "#panel label", "#panel .p-hint", "#panel select", "#panel textarea"].map(contraste),
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
// "n" es un atajo de producto de UNA tecla: exige foco DENTRO de un componente del
// producto (SC 2.1.4). Sin ningún control enfocado (body) NO dispara.
const nAntes = await kp.evaluate(() => EVENTS.length);
await kp.keyboard.press("n");
await kp.waitForTimeout(300);
const nSinFoco = await kp.evaluate(() => ({
  panel: !!document.querySelector("#panel"),
  titulo: (document.querySelector("#panel-titulo")?.textContent || "").trim(),
  n: EVENTS.length,
}));
// con el foco en la grilla, "n" sí abre la nueva reunión en la hora actual
await kp.locator("#grilla").focus();
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
  if (nSinFoco.panel) v.push(`sin foco de componente, "n" abrio el panel: "${nSinFoco.titulo}"`);
  if (nSinFoco.n !== nAntes) v.push(`sin foco de componente, "n" cambio EVENTS: ${nAntes} -> ${nSinFoco.n}`);
  if (!/^Nueva reunión · martes 16, 15:30 – 16:15$/.test(porTecla)) v.push(`con foco en la grilla, "n" no abrio la hora actual: "${porTecla}"`);
  if (!/^Nueva reunión · jueves 18, 09:00 – 09:45$/.test(porDia)) v.push(`boton por dia sin contexto: "${porDia}"`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A1 puntero sin arrastre · ${creado.texto} · arrastre crea ${drag.ev > evAntes} sin panel ${!drag.panel} · "n" sin foco sin panel ${!nSinFoco.panel} · con foco en grilla "${porTecla}" · por dia "${porDia}"`);
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
// los bloques ocupados de Google (ingesta solo lectura) no abren menú ni panel
await mu.evaluate(() => {
  document.querySelector('#grilla .ev[data-busy]').focus();
  document.querySelector("#announcer").textContent = "";
});
await mu.keyboard.press("Enter");
await mu.waitForTimeout(250);
const porBusy = await mu.evaluate(() => ({
  menu: !!document.querySelector("#menu"),
  panel: !!document.querySelector("#panel"),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
// la lista esperada se deriva del marcador de lo implementado, no se hardcodea
const esperados = await mu.evaluate(() => ACCIONES.filter((a) => ACCIONES_HECHAS.has(a.id)).map((a) => a.label));
const iEv = await mu.evaluate(() => {
  const e = document.querySelector("#grilla .ev");
  e.focus();
  document.querySelector("#announcer").textContent = "";
  return Number(e.dataset.i);
});
await mu.keyboard.press("Enter");
await mu.waitForTimeout(300);
const porEnter = await mu.evaluate((i) => {
  const m = document.querySelector("#menu");
  const trg = document.querySelector(`#grilla .ev[data-i="${i}"]`);
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
    haspopup: trg?.getAttribute("aria-haspopup"),
    expanded: trg?.getAttribute("aria-expanded"),
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, iEv);
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
    expanded: el?.getAttribute("aria-expanded"),
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, iEv);
// Tab cierra el menú y NO deja un huérfano que se coma el atajo N (hallazgo 1)
await mu.evaluate(() => document.querySelector("#grilla .ev").focus());
await mu.keyboard.press("Enter");
await mu.waitForTimeout(200);
await mu.keyboard.press("Tab");
await mu.waitForTimeout(250);
const porTab = await mu.evaluate(() => ({
  hayMenu: !!document.querySelector("#menu"),
  focoFueraDelMenu: !document.querySelector("#menu")?.contains(document.activeElement),
}));
await mu.keyboard.press("n");
await mu.waitForTimeout(300);
const trasTabN = await mu.evaluate(() => /Nueva reunión/.test(document.querySelector("#panel-titulo")?.textContent || ""));
await mu.keyboard.press("Escape");
await mu.waitForTimeout(250);
// con el menú abierto, un click en un calendario lo cierra Y activa el toggle (hallazgo 2)
await mu.evaluate(() => document.querySelector("#grilla .ev").focus());
await mu.keyboard.press("Enter");
await mu.waitForTimeout(200);
await mu.locator('.cal[data-cat="software"]').click();
await mu.waitForTimeout(300);
const porCal = await mu.evaluate(() => ({
  menu: !!document.querySelector("#menu"),
  off: document.querySelector('.cal[data-cat="software"]').hasAttribute("data-off"),
}));
await mu.locator('.cal[data-cat="software"]').click();   // restaurar
await mu.waitForTimeout(200);
// "Editar" del menú abre el panel de ESA reunión, sin anunciar
const iEditMenu = await mu.evaluate(() => {
  const e = document.querySelector("#grilla .ev");
  e.focus();
  document.querySelector("#announcer").textContent = "";
  return Number(e.dataset.i);
});
await mu.keyboard.press("Enter");
await mu.waitForTimeout(200);
await mu.keyboard.press("Enter");
await mu.waitForTimeout(350);
const porEditar = await mu.evaluate((i) => {
  const t = (document.querySelector("#panel-titulo")?.textContent || "").trim();
  return {
    panel: !!document.querySelector("#panel"),
    diceReunion: t.includes(EVENTS[i].title),
    focoEnInput: /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || ""),
    menu: !!document.querySelector("#menu"),
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, iEditMenu);
await mu.keyboard.press("Escape");
await mu.waitForTimeout(250);
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
// ── El menú se da vuelta si el bloque está pegado al borde inferior (hallazgo 4) ──
const flp = await browser.newPage({ viewport: { width: 1440, height: 600 } });
await flp.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await flp.waitForTimeout(500);
const iFlip = await flp.evaluate(() => {
  const w = document.querySelector(".gridwrap");
  const heads = document.querySelector(".heads").getBoundingClientRect().height;
  const evs = [...document.querySelectorAll("#grilla .ev:not([data-busy])")];
  // el más bajo de la grilla, para poder llevarlo contra el borde inferior
  const e = evs.reduce((a, b) =>
    (parseFloat(b.style.top) + parseFloat(b.style.height)) > (parseFloat(a.style.top) + parseFloat(a.style.height)) ? b : a);
  // dejar el borde inferior del bloque a ras del fondo de la grilla
  w.scrollTop = heads + parseFloat(e.style.top) + parseFloat(e.style.height) - w.clientHeight;
  e.focus();
  return Number(e.dataset.i);
});
await flp.keyboard.press("Enter");
await flp.waitForTimeout(300);
const porFlip = await flp.evaluate((i) => {
  const m = document.querySelector("#menu");
  if (!m) return { falta: true };
  const eb = document.querySelector(`#grilla .ev[data-i="${i}"]`).getBoundingClientRect();
  const mb = m.getBoundingClientRect();
  return {
    dioVuelta: mb.top < eb.top,   // pasó de estar debajo del bloque a estar arriba
    dentro: mb.top >= -1 && mb.bottom <= innerHeight + 1,
    evBottom: Math.round(eb.bottom), mbTop: Math.round(mb.top), mbBottom: Math.round(mb.bottom), inner: innerHeight,
  };
}, iFlip);
await flp.close();
{
  const v = [];
  if (porEnter.falta) v.push("Enter no abre el menu");
  else {
    if (porEnter.rol !== "menu") v.push(`role ${porEnter.rol}`);
    if (!porEnter.nombre) v.push("el menu no tiene nombre accesible");
    if (JSON.stringify(porEnter.items) !== JSON.stringify(esperados)) v.push(`items ${porEnter.items.join(" | ")} (esperado ${esperados.join(" | ")})`);
    if (!porEnter.focoEnPrimero) v.push("el foco no entra al primer item");
    if (!porEnter.tamano) v.push("hay items menores a 24x24");
    if (!porEnter.dentro) v.push("el menu se sale de la ventana");
    if (porEnter.contTabStop) v.push("el contenedor del menu es tab stop");
    if (porEnter.haspopup !== "menu") v.push(`aria-haspopup ${porEnter.haspopup}`);
    if (porEnter.expanded !== "true") v.push(`aria-expanded al abrir: ${porEnter.expanded}`);
    if (porEnter.anuncio) v.push(`se anuncio al abrir: "${porEnter.anuncio}"`);
  }
  if (!focoCicla) v.push("ArrowDown no cicla el foco");
  if (porEscape.hayMenu) v.push("Escape no cierra el menu");
  if (!porEscape.focoVuelve) v.push("Escape no devuelve el foco a la reunion");
  if (porEscape.expanded !== "false") v.push(`aria-expanded al cerrar: ${porEscape.expanded}`);
  if (porEscape.anuncio) v.push(`se anuncio al cerrar: "${porEscape.anuncio}"`);
  if (porTab.hayMenu) v.push("Tab no cierra el menu");
  if (!trasTabN) v.push("tras Tab, la tecla N quedo tragada por un menu huerfano");
  if (porCal.menu) v.push("el click en un calendario no cerro el menu");
  if (!porCal.off) v.push("el click en un calendario no activo el toggle (el cierre se comio el click)");
  if (porBusy.menu) v.push("un bloque ocupado abrio el menu");
  if (porBusy.panel) v.push("un bloque ocupado abrio el panel");
  if (porBusy.anuncio) v.push(`un bloque ocupado anuncio: "${porBusy.anuncio}"`);
  if (!porEditar.panel) v.push("Editar no abre el panel");
  if (!porEditar.diceReunion) v.push("el panel de Editar no es el de la reunion");
  if (!porEditar.focoEnInput) v.push("Editar no mueve el foco al panel");
  if (porEditar.menu) v.push("Editar dejo el menu abierto");
  if (porEditar.anuncio) v.push(`Editar anuncio: "${porEditar.anuncio}"`);
  if (!porClick.hayMenu) v.push("el click sobre la reunion no abre el menu");
  if (!porClick.focoEnPrimero) v.push("el click no enfoca el primer item");
  if (porClick.anuncio) v.push(`el click anuncio: "${porClick.anuncio}"`);
  if (!(despuesDrag.min > antesMin)) v.push(`el arrastre no movio la reunion (${antesMin}->${despuesDrag.min})`);
  if (despuesDrag.menu) v.push("el arrastre (>4 px) abrio el menu");
  if (porFlip.falta) v.push("no se pudo abrir el menu para el flip");
  else {
    if (!porFlip.dioVuelta) v.push(`el menu no se dio vuelta (top ${porFlip.mbTop}, bloque bottom ${porFlip.evBottom}, ventana ${porFlip.inner})`);
    if (!porFlip.dentro) v.push("el menu se sale de la ventana al dar vuelta");
  }
  console.log((v.length ? "  ✗ " : "  ✓ ") + `menu · items ${(porEnter.items || []).join(" | ") || "-"} · foco primer item ${porEnter.focoEnPrimero} · dentro ${porEnter.dentro} · haspopup/expanded ${porEnter.haspopup}/${porEnter.expanded}->${porEscape.expanded} · Escape cierra ${!porEscape.hayMenu} y vuelve el foco ${porEscape.focoVuelve} · Tab cierra ${!porTab.hayMenu} y N sigue ${trasTabN} · click abre ${porClick.hayMenu} · cal togglea ${porCal.off} · ocupado abre menu/panel ${porBusy.menu}/${porBusy.panel} · Editar panel ${porEditar.panel} · arrastre mueve ${despuesDrag.min > antesMin} · flip ${porFlip.dioVuelta} (bloque bottom ${porFlip.evBottom} → menu ${porFlip.mbTop}-${porFlip.mbBottom}, ventana ${porFlip.inner}) dentro ${porFlip.dentro} · anuncios "${porEnter.anuncio}"/"${porEscape.anuncio}"/"${porClick.anuncio}"/"${porEditar.anuncio}"`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── "Mover a…" (S4 · SC 2.5.7): viaje real por el menú que mueve hora y día sin arrastrar ──
// Abre el menú con un click, elige "Mover a…", ajusta un paso y Aplicar. Verifica que el
// evento cambie EXACTAMENTE lo pedido, que se anuncie, que Escape no escriba y que abrir no anuncie.
const fmt2 = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
const mvp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mvp.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await mvp.waitForTimeout(400);

// siempre la misma reunión (la primera del día lunes), se mueva al día que se mueva
const abrirMenuReunion0 = async () => {
  await mvp.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
  await mvp.waitForTimeout(80);
  await mvp.locator('#grilla .ev[data-i="0"]').click();
  await mvp.waitForTimeout(250);
};

// 1) puntero: abrir menú → "Mover a…" → +15 min → Aplicar
await abrirMenuReunion0();
const enMenu = await mvp.evaluate(() => ({
  hayMenu: !!document.querySelector("#menu"),
  hayMover: !!document.querySelector('[data-accion="mover"]'),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
await mvp.locator('[data-accion="mover"]').click();
await mvp.waitForTimeout(250);
const mvAbierto = await mvp.evaluate(() => {
  const d = document.querySelector("#mover-dialog");
  if (!d) return { falta: true };
  const pasos = [...d.querySelectorAll("[data-paso]")];
  const dias = [...d.querySelectorAll("[data-dia]")];
  const ctr = [...pasos, ...dias, d.querySelector("#mover-aplicar"), d.querySelector("#mover-cancelar")];
  return {
    rol: d.getAttribute("role"), modal: d.getAttribute("aria-modal"),
    etiquetado: !!d.querySelector("#mover-titulo"),
    pasos: pasos.map((b) => b.dataset.paso),
    dias: dias.map((b) => b.textContent.trim()),
    diasEnVentana: dias.length === DAYS.length && dias.every((b) => !b.disabled && b.getAttribute("aria-disabled") === "false"),
    diaActual: dias.findIndex((b) => b.getAttribute("aria-pressed") === "true"),
    horaReal: /(lunes|martes|miércoles|jueves|viernes) \d+ de septiembre/.test(d.querySelector("#mover-hora")?.textContent || ""),
    tamano: ctr.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }),
    prohibido: !!d.querySelector('[role="grid"], [aria-grabbed], [aria-dropeffect]'),
    menu: !!document.querySelector("#menu"),
    focoAdentro: d.contains(document.activeElement),
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
const antesMv = await mvp.evaluate(() => ({ min: EVENTS[0].min, dia: EVENTS[0].day, titulo: EVENTS[0].title }));
await mvp.locator('#mover-dialog [data-paso="+15"]').click();
await mvp.waitForTimeout(150);
await mvp.locator("#mover-aplicar").click();
await mvp.waitForTimeout(400);
const trasPaso = await mvp.evaluate(() => ({
  min: EVENTS[0].min, dia: EVENTS[0].day,
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  dialogo: !!document.querySelector("#mover-dialog"),
  focoEnEvento: document.activeElement === document.querySelector('#grilla .ev[data-i="0"]'),
}));

// 2) día: abrir menú → "Mover a…" → botón de día (jueves) → Aplicar
await abrirMenuReunion0();
await mvp.locator('[data-accion="mover"]').click();
await mvp.waitForTimeout(200);
await mvp.locator('#mover-dialog [data-dia="3"]').click();
await mvp.waitForTimeout(150);
await mvp.locator("#mover-aplicar").click();
await mvp.waitForTimeout(400);
const trasDia = await mvp.evaluate(() => ({
  min: EVENTS[0].min, dia: EVENTS[0].day,
  diaLargo: DIAS_LARGOS[EVENTS[0].day],
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));

// 3) Escape: el borrador no debe tocar el evento ni anunciar (se compara el objeto EVENTO completo)
const antesEscape = await mvp.evaluate(() => JSON.stringify(EVENTS[0]));
await abrirMenuReunion0();
await mvp.locator('[data-accion="mover"]').click();
await mvp.waitForTimeout(200);
await mvp.locator('#mover-dialog [data-paso="+15"]').click();
await mvp.waitForTimeout(120);
await mvp.keyboard.press("Escape");
await mvp.waitForTimeout(300);
const trasEscape = await mvp.evaluate(() => ({
  objeto: JSON.stringify(EVENTS[0]),
  dialogo: !!document.querySelector("#mover-dialog"),
  focoEnEvento: document.activeElement === document.querySelector('#grilla .ev[data-i="0"]'),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));

// 4) borde: los pasos que saldrían del rango se deshabilitan (no se recortan en silencio)
await abrirMenuReunion0();
await mvp.locator('[data-accion="mover"]').click();
await mvp.waitForTimeout(200);
const borde = await mvp.evaluate(() => {
  const d = document.querySelector("#mover-dialog");
  let guard = 0;
  while (guard++ < 60) {
    const b = d.querySelector('[data-paso="-15"]');
    if (!b || b.disabled) break;
    b.click();
  }
  const m15 = d.querySelector('[data-paso="-15"]');
  const m60 = d.querySelector('[data-paso="-60"]');
  const p15 = d.querySelector('[data-paso="+15"]');
  const minBorrador = MOVER ? MOVER.min : null;
  d.querySelector("#mover-cancelar")?.click();
  return {
    minBorrador, minEvento: EVENTS[0].min, piso: START_H * 60,
    m15: m15.disabled, m60: m60.disabled, m15aria: m15.getAttribute("aria-disabled"),
    p15: p15.disabled,   // el corte es del borde, no un apagón general
  };
});
await mvp.waitForTimeout(200);
await mvp.close();

// 5) teclado de punta a punta: Enter abre el menú, ArrowDown a "Mover a…", Enter abre el diálogo,
//    Tab recorre SUS controles (no cierra), Enter en el paso y Enter en Aplicar
const kbd = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await kbd.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await kbd.waitForTimeout(400);
const antesKbd = await kbd.evaluate(() => ({ min: EVENTS[0].min, dia: EVENTS[0].day, titulo: EVENTS[0].title }));
await kbd.evaluate(() => {
  const a = document.querySelector("#announcer"); if (a) a.textContent = "";
  document.querySelector('#grilla .ev[data-i="0"]').focus();
});
await kbd.waitForTimeout(80);
await kbd.keyboard.press("Enter");                 // abre el menú (foco: primer ítem "Editar")
await kbd.waitForTimeout(200);
const kbdMenu = await kbd.evaluate(() => ({
  menu: !!document.querySelector("#menu"),
  foco: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
await kbd.keyboard.press("ArrowDown");             // "Editar" -> "Mover a…"
await kbd.waitForTimeout(80);
await kbd.keyboard.press("Enter");                 // abre el diálogo
await kbd.waitForTimeout(200);
const kbdAbierto = await kbd.evaluate(() => {
  const d = document.querySelector("#mover-dialog");
  const foco = document.activeElement;
  return {
    dialogo: !!d,
    focoPaso: foco?.dataset?.paso || null,
    enDialogo: d ? d.contains(foco) : false,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
await kbd.keyboard.press("Tab");                   // -1 h -> -15 min
await kbd.keyboard.press("Tab");                   // -15 min -> +15 min
const kbdFocoPaso = await kbd.evaluate(() => ({
  paso: document.activeElement?.dataset?.paso || null,
  dialogo: !!document.querySelector("#mover-dialog"),
}));
await kbd.keyboard.press("Enter");                 // aplica +15 min AL BORRADOR
await kbd.waitForTimeout(120);
const kbdDraft = await kbd.evaluate(() => (document.querySelector("#mover-hora")?.textContent || "").trim());
// seguir con Tab hasta Aplicar y activarlo con Enter
let kbdTabs = 0, kbdFoco = null;
while (kbdTabs++ < 12) {
  kbdFoco = await kbd.evaluate(() => document.activeElement?.id
    || document.activeElement?.dataset?.paso
    || document.activeElement?.dataset?.dia
    || (document.activeElement?.textContent || "").trim());
  if (kbdFoco === "mover-aplicar") break;
  await kbd.keyboard.press("Tab");
}
await kbd.keyboard.press("Enter");                 // Aplicar
await kbd.waitForTimeout(400);
const trasKbd = await kbd.evaluate(() => ({
  min: EVENTS[0].min, dia: EVENTS[0].day,
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  dialogo: !!document.querySelector("#mover-dialog"),
  focoEnEvento: document.activeElement === document.querySelector('#grilla .ev[data-i="0"]'),
}));
await kbd.close();

// 6) zoom: mover NO resetea el scroll de la grilla (la regresión de mount(), SC de continuidad)
const zp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await zp.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await zp.waitForTimeout(500);
const idxScroll = await zp.evaluate(() => EVENTS.findIndex((e) => e.title === "Block: trabajo profundo"));
const scrollAntes = await zp.evaluate((i) => {
  const w = document.querySelector(".gridwrap");
  const heads = document.querySelector(".heads").getBoundingClientRect().height;
  const e = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  const top = parseFloat(e.style.top), h = parseFloat(e.style.height);
  w.scrollTop = Math.max(0, Math.round(heads + top + h / 2 - w.clientHeight / 2));
  return w.scrollTop;
}, idxScroll);
const minScrollAntes = await zp.evaluate((i) => EVENTS[i].min, idxScroll);
await zp.waitForTimeout(120);
await zp.locator(`#grilla .ev[data-i="${idxScroll}"]`).click();
await zp.waitForTimeout(250);
await zp.locator('[data-accion="mover"]').click();
await zp.waitForTimeout(200);
await zp.locator('#mover-dialog [data-paso="+15"]').click();
await zp.waitForTimeout(120);
await zp.locator("#mover-aplicar").click();
await zp.waitForTimeout(400);
const trasScroll = await zp.evaluate((i) => ({
  scrollTop: document.querySelector(".gridwrap").scrollTop,
  min: EVENTS[i].min,
}), idxScroll);
await zp.close();
{
  const v = [];
  const minEsperado = antesMv.min + 15;
  if (!enMenu.hayMenu) v.push("el click en la reunion no abrio el menu");
  if (!enMenu.hayMover) v.push('el menu no ofrece "Mover a…"');
  if (enMenu.anuncio) v.push(`se anuncio al abrir el menu: "${enMenu.anuncio}"`);
  if (mvAbierto.falta) v.push("no se abre #mover-dialog");
  else {
    if (mvAbierto.rol !== "dialog") v.push(`role ${mvAbierto.rol}`);
    if (mvAbierto.modal !== "false") v.push(`aria-modal ${mvAbierto.modal}`);
    if (!mvAbierto.etiquetado) v.push("sin titulo que lo nombre");
    if (JSON.stringify(mvAbierto.pasos) !== JSON.stringify(["-60", "-15", "+15", "+60"])) v.push(`pasos ${mvAbierto.pasos.join(",")}`);
    if (mvAbierto.dias.length !== 5) v.push(`dias ${mvAbierto.dias.length} (esperado 5)`);
    if (!mvAbierto.diasEnVentana) v.push("algún destino de día queda fuera de la ventana Lun-Vie o deshabilitado");
    if (mvAbierto.diaActual !== antesMv.dia) v.push(`no marca el dia actual (${mvAbierto.diaActual} != ${antesMv.dia})`);
    if (!mvAbierto.horaReal) v.push("el destino no nombra el dia real de la semana");
    if (!mvAbierto.tamano) v.push("hay controles menores a 24x24");
    if (mvAbierto.prohibido) v.push("usa role=grid/aria-grabbed/aria-dropeffect");
    if (mvAbierto.menu) v.push("el menu quedo abierto detras del dialogo");
    if (!mvAbierto.focoAdentro) v.push("el foco no entra al dialogo");
    if (mvAbierto.anuncio) v.push(`se anuncio al abrir el dialogo: "${mvAbierto.anuncio}"`);
  }
  if (trasPaso.min !== minEsperado) v.push(`el paso +15 no movio 15 min: ${antesMv.min} -> ${trasPaso.min}`);
  // Aplicar reenfoca el evento; su nombre accesible ya trae la hora nueva, así que
  // la live region debe quedar vacía (misma alternancia que el nudge de A6).
  if (trasPaso.anuncio) v.push(`Aplicar anuncio ademas de re-enfocar (doble lectura): "${trasPaso.anuncio}"`);
  if (!trasPaso.aria.includes(fmt2(minEsperado))) v.push(`el nombre accesible enfocado no trae la hora nueva (${fmt2(minEsperado)}): "${trasPaso.aria}"`);
  if (trasPaso.dialogo) v.push("Aplicar no cerro el dialogo");
  if (!trasPaso.focoEnEvento) v.push("Aplicar no devolvio el foco a la reunion");
  if (trasDia.dia !== 3) v.push(`el boton de dia no movio a jueves: ${antesMv.dia} -> ${trasDia.dia}`);
  if (trasDia.min !== minEsperado) v.push(`el boton de dia cambio la hora: ${minEsperado} -> ${trasDia.min}`);
  if (trasDia.anuncio) v.push(`el movimiento de dia anuncio ademas de re-enfocar (doble lectura): "${trasDia.anuncio}"`);
  if (!trasDia.aria.includes(trasDia.diaLargo)) v.push(`el nombre accesible enfocado no trae el dia nuevo (${trasDia.diaLargo}): "${trasDia.aria}"`);
  if (trasEscape.objeto !== antesEscape) v.push("Escape si escribio el evento (objeto distinto)");
  if (trasEscape.dialogo) v.push("Escape no cerro el dialogo");
  if (trasEscape.anuncio) v.push(`Escape anuncio: "${trasEscape.anuncio}"`);
  if (!trasEscape.focoEnEvento) v.push("Escape no devolvio el foco");
  if (borde.minEvento !== minEsperado) v.push(`los pasos del borde escribieron el evento: min ${borde.minEvento}`);
  if (!borde.m15 || !borde.m60 || borde.m15aria !== "true") v.push(`en el piso del rango los pasos negativos no se deshabilitan (${borde.m15}/${borde.m60}/${borde.m15aria})`);
  if (borde.p15) v.push("en el piso del rango tambien se deshabilito un paso valido (+15)");
  if (borde.minBorrador !== null && borde.minBorrador < borde.piso) v.push(`el borrador paso el piso: ${borde.minBorrador} < ${borde.piso}`);
  // teclado de punta a punta
  if (!kbdMenu.menu) v.push("Enter no abrio el menu para el viaje de teclado");
  if (kbdMenu.anuncio) v.push(`se anuncio al abrir el menu por teclado: "${kbdMenu.anuncio}"`);
  if (!kbdAbierto.dialogo) v.push("el atajo del menu no abrio el dialogo por teclado");
  if (kbdAbierto.focoPaso !== "-60") v.push(`el foco al abrir no quedo en el primer paso: ${kbdAbierto.focoPaso}`);
  if (!kbdAbierto.enDialogo) v.push("el foco no entra al dialogo por teclado");
  if (kbdAbierto.anuncio) v.push(`se anuncio al abrir el dialogo por teclado: "${kbdAbierto.anuncio}"`);
  if (!kbdFocoPaso.dialogo) v.push("Tab cerro el dialogo en vez de recorrer sus controles");
  if (kbdFocoPaso.paso !== "+15") v.push(`Tab no alcanzo el paso +15: ${kbdFocoPaso.paso}`);
  if (!/08:45/.test(kbdDraft)) v.push(`Enter en el paso no ajusto el borrador: "${kbdDraft}"`);
  if (kbdFoco !== "mover-aplicar") v.push(`Tab no llego a Aplicar: ${kbdFoco}`);
  if (trasKbd.min !== antesKbd.min + 15) v.push(`Enter en Aplicar no movio 15 min: ${antesKbd.min} -> ${trasKbd.min}`);
  if (trasKbd.anuncio) v.push(`Aplicar por teclado anuncio ademas de re-enfocar (doble lectura): "${trasKbd.anuncio}"`);
  if (!trasKbd.aria.includes(fmt2(antesKbd.min + 15))) v.push(`el nombre accesible enfocado no trae la hora nueva (${fmt2(antesKbd.min + 15)}): "${trasKbd.aria}"`);
  if (trasKbd.dialogo) v.push("Aplicar por teclado no cerro el dialogo");
  if (!trasKbd.focoEnEvento) v.push("Aplicar por teclado no devolvio el foco");
  // scroll de la variante zoom
  if (!(scrollAntes > 0)) v.push(`no se pudo fijar un scroll no nulo para probar (${scrollAntes})`);
  if (trasScroll.min !== minScrollAntes + 15) v.push(`el viaje de scroll no movio la reunion: ${minScrollAntes} -> ${trasScroll.min}`);
  if (trasScroll.scrollTop !== scrollAntes) v.push(`mover reseteo el scroll: ${scrollAntes} -> ${trasScroll.scrollTop}`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A2 "Mover a…" · ${antesMv.min} -> ${trasPaso.min} · dia ${antesMv.dia} -> ${trasDia.dia} · anuncio "${trasPaso.anuncio}" · sin anuncio al abrir ${!enMenu.anuncio && !mvAbierto.anuncio} · Escape no escribe ${trasEscape.objeto === antesEscape} · borde disabled ${borde.m15}/${borde.m60} (+15 ok ${!borde.p15}) · teclado foco ${kbdAbierto.focoPaso}→Tab×2 ${kbdFocoPaso.paso}→Aplicar ${kbdFoco} · min ${antesKbd.min} -> ${trasKbd.min} · scroll ${scrollAntes} -> ${trasScroll.scrollTop}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── "Cambiar duración…" (S5 · SC 2.5.7): redimensionar sin arrastrar ──
// Viaje real por el menú que cambia la duración con presets y pasos. Verifica que
// el evento cambie EXACTAMENTE lo pedido, que se anuncie SOLO al aplicar, que
// Escape no escriba y que abrir no anuncie. Incluye viaje completo por teclado y
// que la variante zoom conserve el scroll (nada de mount()).
const dup = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await dup.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await dup.waitForTimeout(400);
const durTitulo = await dup.evaluate(() => EVENTS[0].title);
const abrirMenuReunion0Dur = async () => {
  await dup.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
  await dup.waitForTimeout(80);
  await dup.locator('#grilla .ev[data-i="0"]').click();
  await dup.waitForTimeout(250);
};

// 1) puntero: abrir menú → "Cambiar duración…" → preset 90 → Aplicar
await abrirMenuReunion0Dur();
const enMenuDur = await dup.evaluate(() => ({
  hayMenu: !!document.querySelector("#menu"),
  hayDuracion: !!document.querySelector('[data-accion="duracion"]'),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
await dup.locator('[data-accion="duracion"]').click();
await dup.waitForTimeout(250);
const durAbierto = await dup.evaluate(() => {
  const d = document.querySelector("#dur-dialog");
  if (!d) return { falta: true };
  const presets = [...d.querySelectorAll("[data-dpreset]")];
  const pasos = [...d.querySelectorAll("[data-dpaso]")];
  const ctr = [...presets, ...pasos, d.querySelector("#dur-aplicar"), d.querySelector("#dur-cancelar")];
  return {
    rol: d.getAttribute("role"), modal: d.getAttribute("aria-modal"),
    etiquetado: !!d.querySelector("#dur-titulo"),
    presets: presets.map((b) => b.dataset.dpreset),
    pasos: pasos.map((b) => b.dataset.dpaso),
    presetActual: presets.find((b) => b.getAttribute("aria-pressed") === "true")?.dataset.dpreset || null,
    tamano: ctr.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }),
    prohibido: !!d.querySelector('[role="grid"], [aria-grabbed], [aria-dropeffect]'),
    menu: !!document.querySelector("#menu"),
    focoAdentro: d.contains(document.activeElement),
    focoPreset: document.activeElement?.dataset?.dpreset || null,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
await dup.locator('#dur-dialog [data-dpreset="90"]').click();
await dup.waitForTimeout(150);
const draftPreset = await dup.evaluate(() => ({
  hora: (document.querySelector("#dur-hora")?.textContent || "").trim(),
  evento: EVENTS[0].dur,
}));
await dup.locator("#dur-aplicar").click();
await dup.waitForTimeout(400);
const trasPreset = await dup.evaluate(() => ({
  dur: EVENTS[0].dur, min: EVENTS[0].min,
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  dialogo: !!document.querySelector("#dur-dialog"),
  focoEnEvento: document.activeElement === document.querySelector('#grilla .ev[data-i="0"]'),
}));

// 2) Escape: el borrador no debe tocar el evento ni anunciar (se compara el EVENTO completo)
const antesEscapeDur = await dup.evaluate(() => JSON.stringify(EVENTS[0]));
await abrirMenuReunion0Dur();
await dup.locator('[data-accion="duracion"]').click();
await dup.waitForTimeout(200);
await dup.locator('#dur-dialog [data-dpaso="+15"]').click();
await dup.waitForTimeout(120);
await dup.keyboard.press("Escape");
await dup.waitForTimeout(300);
const trasEscapeDur = await dup.evaluate(() => ({
  objeto: JSON.stringify(EVENTS[0]),
  dialogo: !!document.querySelector("#dur-dialog"),
  focoEnEvento: document.activeElement === document.querySelector('#grilla .ev[data-i="0"]'),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));

// 3) borde: un evento tarde (17:00) se agranda con +15 hasta el fin del rango; ahí el
//    control se deshabilita y NO se escribe el evento (el corte es del borde, no un apagón)
const idxBorde = await dup.evaluate(() => EVENTS.findIndex((e) => e.title === "Jonatan · Plan 3"));
await dup.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await dup.locator(`#grilla .ev[data-i="${idxBorde}"]`).click();
await dup.waitForTimeout(250);
await dup.locator('[data-accion="duracion"]').click();
await dup.waitForTimeout(200);
const bordeDur = await dup.evaluate(() => {
  const d = document.querySelector("#dur-dialog");
  let guard = 0;
  while (guard++ < 40) {
    const b = d.querySelector('[data-dpaso="+15"]');
    if (!b || b.disabled) break;
    b.click();
  }
  const p15 = d.querySelector('[data-dpaso="+15"]');
  const m15 = d.querySelector('[data-dpaso="-15"]');
  const preset15 = d.querySelector('[data-dpreset="15"]');
  const i = EVENTS.findIndex((e) => e.title === "Jonatan · Plan 3");
  const res = {
    draft: DUR ? DUR.dur : null,
    min: EVENTS[i].min, tope: END_H * 60,
    p15: p15.disabled, p15aria: p15.getAttribute("aria-disabled"),
    m15: m15.disabled, preset15: preset15.disabled,
    durBorrador: DUR ? DUR.dur : null,
  };
  d.querySelector("#dur-cancelar")?.click();
  res.durEvento = EVENTS[i].dur;
  return res;
});
await dup.waitForTimeout(200);
await dup.close();

// 4) teclado de punta a punta: Enter abre el menú, ArrowDown×2 a "Cambiar duración…",
//    Enter abre el diálogo, Tab a un preset y a +15, Enter en cada uno, Tab a Aplicar y Enter
const kbdDur = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await kbdDur.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await kbdDur.waitForTimeout(400);
const durKbdAntes = await kbdDur.evaluate(() => ({ dur: EVENTS[0].dur, min: EVENTS[0].min, titulo: EVENTS[0].title }));
await kbdDur.evaluate(() => {
  const a = document.querySelector("#announcer"); if (a) a.textContent = "";
  document.querySelector('#grilla .ev[data-i="0"]').focus();
});
await kbdDur.waitForTimeout(80);
await kbdDur.keyboard.press("Enter");                 // menú (foco: primer ítem "Editar")
await kbdDur.waitForTimeout(200);
await kbdDur.keyboard.press("ArrowDown");             // "Mover a…"
await kbdDur.keyboard.press("ArrowDown");             // "Cambiar duración…"
await kbdDur.keyboard.press("Enter");                 // abre el diálogo
await kbdDur.waitForTimeout(200);
const kbdDurAbierto = await kbdDur.evaluate(() => {
  const d = document.querySelector("#dur-dialog");
  const foco = document.activeElement;
  return {
    dialogo: !!d,
    focoPreset: foco?.dataset?.dpreset || null,
    enDialogo: d ? d.contains(foco) : false,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
let kdTabs = 0;
while (kdTabs++ < 12 && (await kbdDur.evaluate(() => document.activeElement?.dataset?.dpreset || null)) !== "60") {
  await kbdDur.keyboard.press("Tab");
}
const kbdDurFocoPreset = await kbdDur.evaluate(() => document.activeElement?.dataset?.dpreset || null);
await kbdDur.keyboard.press("Enter");                 // preset 60 (borrador)
await kbdDur.waitForTimeout(120);
kdTabs = 0;
while (kdTabs++ < 12 && (await kbdDur.evaluate(() => document.activeElement?.dataset?.dpaso || null)) !== "+15") {
  await kbdDur.keyboard.press("Tab");
}
const kbdFocoPasoDur = await kbdDur.evaluate(() => document.activeElement?.dataset?.dpaso || null);
await kbdDur.keyboard.press("Enter");                 // +15 min (borrador)
await kbdDur.waitForTimeout(120);
const kbdDraftDur = await kbdDur.evaluate(() => (document.querySelector("#dur-hora")?.textContent || "").trim());
let kbdFocoDur = null, kdGuard = 0;
while (kdGuard++ < 12) {
  kbdFocoDur = await kbdDur.evaluate(() => document.activeElement?.id || null);
  if (kbdFocoDur === "dur-aplicar") break;
  await kbdDur.keyboard.press("Tab");
}
await kbdDur.keyboard.press("Enter");                 // Aplicar
await kbdDur.waitForTimeout(400);
const trasKbdDur = await kbdDur.evaluate(() => ({
  dur: EVENTS[0].dur, min: EVENTS[0].min,
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  dialogo: !!document.querySelector("#dur-dialog"),
  focoEnEvento: document.activeElement === document.querySelector('#grilla .ev[data-i="0"]'),
}));
await kbdDur.close();

// 5) zoom: cambiar la duración NO resetea el scroll de la grilla (nada de mount())
const zdur = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await zdur.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await zdur.waitForTimeout(500);
const idxScrollDur = await zdur.evaluate(() => EVENTS.findIndex((e) => e.title === "Block: trabajo profundo"));
const scrollAntesDur = await zdur.evaluate((i) => {
  const w = document.querySelector(".gridwrap");
  const heads = document.querySelector(".heads").getBoundingClientRect().height;
  const e = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  w.scrollTop = Math.max(0, Math.round(heads + parseFloat(e.style.top) + parseFloat(e.style.height) / 2 - w.clientHeight / 2));
  return w.scrollTop;
}, idxScrollDur);
const durScrollAntes = await zdur.evaluate((i) => EVENTS[i].dur, idxScrollDur);
await zdur.waitForTimeout(120);
await zdur.locator(`#grilla .ev[data-i="${idxScrollDur}"]`).click();
await zdur.waitForTimeout(250);
await zdur.locator('[data-accion="duracion"]').click();
await zdur.waitForTimeout(200);
await zdur.locator('#dur-dialog [data-dpaso="+15"]').click();
await zdur.waitForTimeout(120);
await zdur.locator("#dur-aplicar").click();
await zdur.waitForTimeout(400);
const trasScrollDur = await zdur.evaluate((i) => ({
  scrollTop: document.querySelector(".gridwrap").scrollTop,
  dur: EVENTS[i].dur,
}), idxScrollDur);
await zdur.close();
{
  const v = [];
  if (!enMenuDur.hayMenu) v.push("el click en la reunion no abrio el menu");
  if (!enMenuDur.hayDuracion) v.push('el menu no ofrece "Cambiar duración…"');
  if (enMenuDur.anuncio) v.push(`se anuncio al abrir el menu: "${enMenuDur.anuncio}"`);
  if (durAbierto.falta) v.push("no se abre #dur-dialog");
  else {
    if (durAbierto.rol !== "dialog") v.push(`role ${durAbierto.rol}`);
    if (durAbierto.modal !== "false") v.push(`aria-modal ${durAbierto.modal}`);
    if (!durAbierto.etiquetado) v.push("sin titulo que lo nombre");
    if (JSON.stringify(durAbierto.presets) !== JSON.stringify(["15", "30", "45", "60", "90", "120"])) v.push(`presets ${durAbierto.presets.join(",")}`);
    if (JSON.stringify(durAbierto.pasos) !== JSON.stringify(["-15", "+15"])) v.push(`pasos ${durAbierto.pasos.join(",")}`);
    if (durAbierto.presetActual !== "45") v.push(`no marca el preset de la duración actual (${durAbierto.presetActual})`);
    if (!durAbierto.tamano) v.push("hay controles menores a 24x24");
    if (durAbierto.prohibido) v.push("usa role=grid/aria-grabbed/aria-dropeffect");
    if (durAbierto.menu) v.push("el menu quedo abierto detras del dialogo");
    if (!durAbierto.focoAdentro) v.push("el foco no entra al dialogo");
    if (durAbierto.focoPreset !== "15") v.push(`el foco al abrir no quedo en el primer preset: ${durAbierto.focoPreset}`);
    if (durAbierto.anuncio) v.push(`se anuncio al abrir el dialogo: "${durAbierto.anuncio}"`);
  }
  if (!/10:00/.test(draftPreset.hora)) v.push(`el preset no refleja el borrador en el rango: "${draftPreset.hora}"`);
  if (draftPreset.evento !== 45) v.push(`el preset escribio el evento antes de Aplicar: dur ${draftPreset.evento}`);
  if (trasPreset.dur !== 90) v.push(`el preset 90 no dejo dur en 90: ${trasPreset.dur}`);
  if (trasPreset.min !== durKbdAntes.min) v.push(`cambiar la duración movio el inicio: ${durKbdAntes.min} -> ${trasPreset.min}`);
  // Aplicar reenfoca el evento; su nombre accesible ya trae el fin nuevo, así que
  // la live region debe quedar vacía (misma alternancia que el nudge de A6).
  if (trasPreset.anuncio) v.push(`Aplicar anuncio ademas de re-enfocar (doble lectura): "${trasPreset.anuncio}"`);
  if (!trasPreset.aria.includes(`a ${fmt2(trasPreset.min + trasPreset.dur)}`)) v.push(`el nombre accesible enfocado no trae el fin nuevo (${fmt2(trasPreset.min + trasPreset.dur)}): "${trasPreset.aria}"`);
  if (trasPreset.dialogo) v.push("Aplicar no cerro el dialogo");
  if (!trasPreset.focoEnEvento) v.push("Aplicar no devolvio el foco a la reunion");
  if (trasEscapeDur.objeto !== antesEscapeDur) v.push("Escape si escribio el evento (objeto distinto)");
  if (trasEscapeDur.dialogo) v.push("Escape no cerro el dialogo");
  if (trasEscapeDur.anuncio) v.push(`Escape anuncio: "${trasEscapeDur.anuncio}"`);
  if (!trasEscapeDur.focoEnEvento) v.push("Escape no devolvio el foco");
  if (bordeDur.draft !== bordeDur.tope - bordeDur.min) v.push(`el borrador no llego al borde exacto: ${bordeDur.draft} (esperado ${bordeDur.tope - bordeDur.min})`);
  if (!bordeDur.p15 || bordeDur.p15aria !== "true") v.push(`en el borde el paso +15 no se deshabilita (${bordeDur.p15}/${bordeDur.p15aria})`);
  if (bordeDur.m15) v.push("en el borde tambien se deshabilito un paso valido (-15)");
  if (bordeDur.preset15) v.push("en el borde tambien se deshabilito un preset valido (15)");
  if (bordeDur.durEvento !== 60) v.push(`los pasos del borde escribieron el evento: dur ${bordeDur.durEvento}`);
  // teclado de punta a punta
  if (!kbdDurAbierto.dialogo) v.push("el atajo del menu no abrio el dialogo por teclado");
  if (kbdDurAbierto.focoPreset !== "15") v.push(`el foco al abrir por teclado no quedo en el primer preset: ${kbdDurAbierto.focoPreset}`);
  if (!kbdDurAbierto.enDialogo) v.push("el foco no entra al dialogo por teclado");
  if (kbdDurAbierto.anuncio) v.push(`se anuncio al abrir el dialogo por teclado: "${kbdDurAbierto.anuncio}"`);
  if (kbdDurFocoPreset !== "60") v.push(`Tab no alcanzo el preset 60: ${kbdDurFocoPreset}`);
  if (kbdFocoPasoDur !== "+15") v.push(`Tab no alcanzo el paso +15: ${kbdFocoPasoDur}`);
  if (!/09:45/.test(kbdDraftDur)) v.push(`los Enter de teclado no ajustaron el borrador a 60+15: "${kbdDraftDur}"`);
  if (kbdFocoDur !== "dur-aplicar") v.push(`Tab no llego a Aplicar: ${kbdFocoDur}`);
  if (trasKbdDur.dur !== durKbdAntes.dur + 30) v.push(`el viaje de teclado no aplico 60+15 (45 -> ${trasKbdDur.dur})`);
  if (trasKbdDur.anuncio) v.push(`Aplicar por teclado anuncio ademas de re-enfocar (doble lectura): "${trasKbdDur.anuncio}"`);
  if (!trasKbdDur.aria.includes(`a ${fmt2(trasKbdDur.min + trasKbdDur.dur)}`)) v.push(`el nombre accesible enfocado no trae el fin nuevo (${fmt2(trasKbdDur.min + trasKbdDur.dur)}): "${trasKbdDur.aria}"`);
  if (trasKbdDur.dialogo) v.push("Aplicar por teclado no cerro el dialogo");
  if (!trasKbdDur.focoEnEvento) v.push("Aplicar por teclado no devolvio el foco");
  // scroll de la variante zoom
  if (!(scrollAntesDur > 0)) v.push(`no se pudo fijar un scroll no nulo para probar (${scrollAntesDur})`);
  if (trasScrollDur.dur !== durScrollAntes + 15) v.push(`el viaje de scroll no cambio la duración: ${durScrollAntes} -> ${trasScrollDur.dur}`);
  if (trasScrollDur.scrollTop !== scrollAntesDur) v.push(`cambiar la duración reseteo el scroll: ${scrollAntesDur} -> ${trasScrollDur.scrollTop}`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A3 "Cambiar duración…" · preset 45 -> ${trasPreset.dur} · anuncio "${trasPreset.anuncio}" · sin anuncio al abrir ${!enMenuDur.anuncio && !durAbierto.anuncio} · Escape no escribe ${trasEscapeDur.objeto === antesEscapeDur} · borde +15 disabled ${bordeDur.p15} en ${bordeDur.draft} (+15 del preset ok ${!bordeDur.preset15}) · teclado foco ${kbdDurAbierto.focoPreset}→preset ${kbdDurFocoPreset}→paso ${kbdFocoPasoDur}→Aplicar ${kbdFocoDur} · dur ${durKbdAntes.dur} -> ${trasKbdDur.dur} · scroll ${scrollAntesDur} -> ${trasScrollDur.scrollTop}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

// ── "Duplicar" y "Eliminar" (S6 · A5 + borrado): acciones del menú, por puntero y teclado ──
// Duplicar es inmediato y NO anuncia (el foco pasa a la copia, cuyo nombre accesible
// ES el anuncio; alternancia). Eliminar pide confirmación EN LÍNEA dentro del menú: el
// primer Enter no borra, Cancelar/Escape no escriben y no anuncian (el foco vuelve al
// MISMO evento), y recién "Sí, eliminar" quita el evento y SÍ anuncia (el foco cae en
// otro objeto: un vecino o la grilla). Ambos viajes de teclado corren en la variante
// zoom con scroll no nulo para probar que no se usa mount().
const setScroll = async (page, i) => page.evaluate((idx) => {
  const w = document.querySelector(".gridwrap");
  const heads = document.querySelector(".heads").getBoundingClientRect().height;
  const el = document.querySelector(`#grilla .ev[data-i="${idx}"]`);
  w.scrollTop = Math.max(0, Math.round(heads + parseFloat(el.style.top) + parseFloat(el.style.height) / 2 - w.clientHeight / 2));
  return w.scrollTop;
}, i);

// 1) Duplicar por puntero
const pDup = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pDup.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await pDup.waitForTimeout(400);
const pDupAntes = await pDup.evaluate(() => ({ n: EVENTS.length, e: { ...EVENTS[0] } }));
await pDup.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await pDup.locator('#grilla .ev[data-i="0"]').click();
await pDup.waitForTimeout(250);
const pDupMenu = await pDup.evaluate(() => ({
  menu: !!document.querySelector("#menu"),
  hayDuplicar: !!document.querySelector('[data-accion="duplicar"]'),
  hayEliminar: !!document.querySelector('[data-accion="eliminar"]'),
  tamano: [...document.querySelectorAll('#menu [role="menuitem"]')].every((b) => { const r = b.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
await pDup.locator('[data-accion="duplicar"]').click();
await pDup.waitForTimeout(350);
const pDupTras = await pDup.evaluate((n) => {
  const c = EVENTS[n];
  return {
    n: EVENTS.length,
    copia: { day: c?.day, min: c?.min, dur: c?.dur, title: c?.title, cat: c?.cat, origin: c?.origin, sync: c?.sync },
    focoEnCopia: document.activeElement === document.querySelector(`#grilla .ev[data-i="${n}"]`),
    menu: !!document.querySelector("#menu"),
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, pDupAntes.n);
await pDup.close();

// 2) Eliminar por puntero: confirmación, Cancelar (no escribe) y "Sí, eliminar"
const pDel = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pDel.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await pDel.waitForTimeout(400);
const pDelIdx = await pDel.evaluate(() => EVENTS.findIndex((e) => e.title === "Revisión de propuesta"));
const pDelInfo = await pDel.evaluate((i) => ({ n: EVENTS.length, objeto: JSON.stringify(EVENTS[i]), titulo: EVENTS[i].title, dia: EVENTS[i].day, min: EVENTS[i].min }), pDelIdx);
await pDel.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await pDel.locator(`#grilla .ev[data-i="${pDelIdx}"]`).click();
await pDel.waitForTimeout(250);
await pDel.locator('[data-accion="eliminar"]').click();
await pDel.waitForTimeout(250);
const pDelConfirm = await pDel.evaluate((i) => {
  const g = document.querySelector("#confirmar-eliminar");
  const ctr = g ? [...g.querySelectorAll("button")] : [];
  return {
    confirm: !!g,
    rol: g?.getAttribute("role"),
    nombre: g?.getAttribute("aria-label") || "",
    botones: ctr.map((b) => (b.textContent || "").trim()),
    tamano: ctr.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }),
    focoEnSi: document.activeElement?.id || null,
    prohibido: !!g?.querySelector('[role="grid"], [aria-grabbed], [aria-dropeffect]'),
    vivo: !!EVENTS[i],
    n: EVENTS.length,
  };
}, pDelIdx);
await pDel.locator("#eliminar-no").click();
await pDel.waitForTimeout(300);
const pDelCancel = await pDel.evaluate((i) => ({
  objeto: JSON.stringify(EVENTS[i]),
  n: EVENTS.length,
  confirm: !!document.querySelector("#confirmar-eliminar"),
  focoEnEvento: document.activeElement === document.querySelector(`#grilla .ev[data-i="${i}"]`),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), pDelIdx);
await pDel.locator(`#grilla .ev[data-i="${pDelIdx}"]`).click();
await pDel.waitForTimeout(200);
await pDel.locator('[data-accion="eliminar"]').click();
await pDel.waitForTimeout(200);
await pDel.locator("#eliminar-si").click();
await pDel.waitForTimeout(350);
const pDelTras = await pDel.evaluate(({ titulo, dia, min }) => {
  const idx = document.activeElement?.dataset?.i;
  const ev = idx != null ? EVENTS[Number(idx)] : null;
  const anuncio = (document.querySelector("#announcer")?.textContent || "").trim();
  return {
    n: EVENTS.length,
    existe: EVENTS.some((e) => e.title === titulo),
    focoEsEvento: !!document.activeElement?.classList?.contains("ev"),
    vecinoDia: ev ? ev.day : null,
    focoEnGrilla: document.activeElement?.id === "grilla",
    anuncio,
    esperado: `Eliminada ${titulo}, ${DIAS_LARGOS[dia]} a las ${fmt(min)}`,
  };
}, { titulo: pDelInfo.titulo, dia: pDelInfo.dia, min: pDelInfo.min });
await pDel.close();

// 3) Duplicar por teclado (zoom, scroll no nulo): Enter → ArrowDown×3 → Enter
const kDup = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await kDup.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await kDup.waitForTimeout(500);
const kDupIdx = await kDup.evaluate(() => EVENTS.findIndex((e) => e.title === "Block: trabajo profundo"));
const kDupAntes = await kDup.evaluate((i) => ({ n: EVENTS.length, e: { ...EVENTS[i] } }), kDupIdx);
const kDupScroll = await setScroll(kDup, kDupIdx);
await kDup.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await kDup.evaluate((i) => document.querySelector(`#grilla .ev[data-i="${i}"]`)?.focus(), kDupIdx);
await kDup.waitForTimeout(80);
await kDup.keyboard.press("Enter");        // menú → foco en "Editar"
await kDup.keyboard.press("ArrowDown");    // "Mover a…"
await kDup.keyboard.press("ArrowDown");    // "Cambiar duración…"
await kDup.keyboard.press("ArrowDown");    // "Duplicar"
await kDup.waitForTimeout(100);
const kDupFoco = await kDup.evaluate(() => document.activeElement?.dataset?.accion || null);
await kDup.keyboard.press("Enter");        // duplicar
await kDup.waitForTimeout(350);
const kDupTras = await kDup.evaluate((n) => {
  const c = EVENTS[n];
  return {
    n: EVENTS.length,
    copia: { day: c?.day, min: c?.min, dur: c?.dur, title: c?.title, cat: c?.cat, origin: c?.origin, sync: c?.sync },
    focoEnCopia: document.activeElement === document.querySelector(`#grilla .ev[data-i="${n}"]`),
    menu: !!document.querySelector("#menu"),
    scrollTop: document.querySelector(".gridwrap").scrollTop,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, kDupAntes.n);
await kDup.close();

// 4) Eliminar por teclado (zoom, scroll no nulo): confirmar sin borrar → Escape → confirmar
const kDel = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await kDel.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await kDel.waitForTimeout(500);
const kDelIdx = await kDel.evaluate(() => EVENTS.findIndex((e) => e.title === "Revisión de propuesta"));
const kDelAntes = await kDel.evaluate((i) => ({ n: EVENTS.length, objeto: JSON.stringify(EVENTS[i]), titulo: EVENTS[i].title, dia: EVENTS[i].day, min: EVENTS[i].min }), kDelIdx);
const kDelScroll = await setScroll(kDel, kDelIdx);
await kDel.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await kDel.evaluate((i) => document.querySelector(`#grilla .ev[data-i="${i}"]`)?.focus(), kDelIdx);
await kDel.waitForTimeout(80);
const abrirEliminarKbd = async () => {
  await kDel.keyboard.press("Enter");        // menú
  await kDel.keyboard.press("ArrowDown");    // "Mover a…"
  await kDel.keyboard.press("ArrowDown");    // "Cambiar duración…"
  await kDel.keyboard.press("ArrowDown");    // "Duplicar"
  await kDel.keyboard.press("ArrowDown");    // "Eliminar"
  await kDel.keyboard.press("Enter");        // abre la confirmación
  await kDel.waitForTimeout(150);
};
await abrirEliminarKbd();
const kDelConfirm = await kDel.evaluate((i) => ({
  confirm: !!document.querySelector("#confirmar-eliminar"),
  foco: document.activeElement?.id || null,
  n: EVENTS.length,
  vivo: !!EVENTS[i],
}), kDelIdx);
await kDel.keyboard.press("Escape");
await kDel.waitForTimeout(250);
const kDelEscape = await kDel.evaluate((i) => ({
  objeto: JSON.stringify(EVENTS[i]),
  confirm: !!document.querySelector("#confirmar-eliminar"),
  menu: !!document.querySelector("#menu"),
  focoEnEvento: document.activeElement === document.querySelector(`#grilla .ev[data-i="${i}"]`),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), kDelIdx);
await abrirEliminarKbd();                    // reabrir: foco vuelve al evento tras Escape
await kDel.keyboard.press("Enter");          // "Sí, eliminar" ya tiene el foco → segundo Enter borra
await kDel.waitForTimeout(400);
const kDelTras = await kDel.evaluate(({ titulo, dia, min }) => {
  const idx = document.activeElement?.dataset?.i;
  const ev = idx != null ? EVENTS[Number(idx)] : null;
  const anuncio = (document.querySelector("#announcer")?.textContent || "").trim();
  return {
    n: EVENTS.length,
    existe: EVENTS.some((e) => e.title === titulo),
    focoEsEvento: !!document.activeElement?.classList?.contains("ev"),
    vecinoDia: ev ? ev.day : null,
    focoEnGrilla: document.activeElement?.id === "grilla",
    scrollTop: document.querySelector(".gridwrap").scrollTop,
    anuncio,
    esperado: `Eliminada ${titulo}, ${DIAS_LARGOS[dia]} a las ${fmt(min)}`,
  };
}, { titulo: kDelAntes.titulo, dia: kDelAntes.dia, min: kDelAntes.min });
await kDel.close();

{
  const v = [];
  const orig = pDupAntes.e;
  const tituloCopia = `${orig.title} (copia)`;
  if (!pDupMenu.menu) v.push("el click en la reunion no abrio el menu (duplicar)");
  if (!pDupMenu.hayDuplicar) v.push('el menu no ofrece "Duplicar"');
  if (!pDupMenu.hayEliminar) v.push('el menu no ofrece "Eliminar"');
  if (!pDupMenu.tamano) v.push("hay items de menu menores a 24x24");
  if (pDupMenu.anuncio) v.push(`se anuncio al abrir el menu (duplicar): "${pDupMenu.anuncio}"`);
  if (pDupTras.n !== pDupAntes.n + 1) v.push(`duplicar por puntero no agrego 1 (${pDupAntes.n} -> ${pDupTras.n})`);
  if (pDupTras.copia.day !== orig.day || pDupTras.copia.min !== orig.min || pDupTras.copia.dur !== orig.dur) v.push("la copia no quedo en el mismo dia/hora/duracion");
  if (pDupTras.copia.cat !== orig.cat || pDupTras.copia.origin !== orig.origin || pDupTras.copia.sync !== orig.sync) v.push("la copia no conserva categoria/origen/sync");
  if (pDupTras.copia.title !== tituloCopia) v.push(`titulo de la copia "${pDupTras.copia.title}" (esperado "${tituloCopia}")`);
  if (!pDupTras.focoEnCopia) v.push("duplicar por puntero no dejo el foco en la copia");
  if (pDupTras.menu) v.push("duplicar dejo el menu abierto");
  if (pDupTras.anuncio) v.push(`duplicar anuncio: "${pDupTras.anuncio}" (debe ser vacio)`);
  const copiaKbd = `${kDupAntes.e.title} (copia)`;
  if (kDupFoco !== "duplicar") v.push(`ArrowDown×3 no llego a "Duplicar": ${kDupFoco}`);
  if (kDupTras.n !== kDupAntes.n + 1) v.push(`duplicar por teclado no agrego 1 (${kDupAntes.n} -> ${kDupTras.n})`);
  if (kDupTras.copia.title !== copiaKbd) v.push(`copia de teclado "${kDupTras.copia.title}" (esperado "${copiaKbd}")`);
  if (kDupTras.copia.day !== kDupAntes.e.day || kDupTras.copia.min !== kDupAntes.e.min || kDupTras.copia.dur !== kDupAntes.e.dur) v.push("la copia de teclado no quedo en el mismo dia/hora");
  if (!kDupTras.focoEnCopia) v.push("el viaje de teclado no dejo el foco en la copia");
  if (kDupTras.anuncio) v.push(`duplicar por teclado anuncio: "${kDupTras.anuncio}" (debe ser vacio)`);
  if (!(kDupScroll > 0)) v.push(`no se pudo fijar scroll de zoom para duplicar (${kDupScroll})`);
  if (kDupTras.scrollTop !== kDupScroll) v.push(`duplicar reseteo el scroll: ${kDupScroll} -> ${kDupTras.scrollTop}`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A4 "Duplicar" · puntero ${pDupAntes.n} -> ${pDupTras.n} copia "${pDupTras.copia.title}" misma hora ${pDupTras.copia.day === orig.day && pDupTras.copia.min === orig.min} foco ${pDupTras.focoEnCopia} sin anuncio ${!pDupTras.anuncio} · teclado ${kDupAntes.n} -> ${kDupTras.n} foco ${kDupTras.focoEnCopia} sin anuncio ${!kDupTras.anuncio} · scroll ${kDupScroll} -> ${kDupTras.scrollTop}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

{
  const v = [];
  if (!pDelConfirm.confirm) v.push("el primer click en Eliminar no abrio #confirmar-eliminar");
  else {
    if (pDelConfirm.rol !== "group") v.push(`role de la confirmacion ${pDelConfirm.rol}`);
    if (!/Confirmar eliminación/.test(pDelConfirm.nombre)) v.push(`la confirmacion no tiene rotulo: "${pDelConfirm.nombre}"`);
    if (JSON.stringify(pDelConfirm.botones) !== JSON.stringify(["Sí, eliminar", "Cancelar"])) v.push(`botones ${pDelConfirm.botones.join(",")}`);
    if (!pDelConfirm.tamano) v.push("hay controles de confirmacion menores a 24x24");
    if (pDelConfirm.prohibido) v.push("usa role=grid/aria-grabbed/aria-dropeffect");
    if (pDelConfirm.focoEnSi !== "eliminar-si") v.push(`el foco al confirmar no quedo en "Sí, eliminar": ${pDelConfirm.focoEnSi}`);
  }
  if (!pDelConfirm.vivo) v.push("el primer click en Eliminar ya borro el evento");
  if (pDelConfirm.n !== pDelInfo.n) v.push(`el primer click en Eliminar cambio EVENTS.length: ${pDelInfo.n} -> ${pDelConfirm.n}`);
  if (pDelCancel.objeto !== pDelInfo.objeto) v.push("Cancelar si escribio el evento (objeto distinto)");
  if (pDelCancel.confirm) v.push("Cancelar no cerro la confirmacion");
  if (!pDelCancel.focoEnEvento) v.push("Cancelar no devolvio el foco a la reunion");
  if (pDelCancel.anuncio) v.push(`Cancelar anuncio: "${pDelCancel.anuncio}"`);
  if (pDelTras.n !== pDelInfo.n - 1) v.push(`confirmar no quito 1 evento: ${pDelInfo.n} -> ${pDelTras.n}`);
  if (pDelTras.existe) v.push("confirmar no borro el evento");
  if (!pDelTras.focoEsEvento && !pDelTras.focoEnGrilla) v.push("tras borrar el foco no quedo en un vecino ni en #grilla");
  if (pDelTras.focoEsEvento && pDelTras.vecinoDia !== pDelInfo.dia) v.push(`el vecino enfocado no es del mismo dia (${pDelTras.vecinoDia})`);
  if (pDelTras.anuncio !== pDelTras.esperado) v.push(`anuncio de borrado "${pDelTras.anuncio}" (esperado "${pDelTras.esperado}")`);
  if (!kDelConfirm.confirm) v.push("ArrowDown×4/Enter no abrio la confirmacion por teclado");
  if (!kDelConfirm.vivo) v.push("la confirmacion por teclado ya borro el evento");
  if (kDelConfirm.n !== kDelAntes.n) v.push(`la confirmacion cambio EVENTS.length: ${kDelAntes.n} -> ${kDelConfirm.n}`);
  if (kDelConfirm.foco !== "eliminar-si") v.push(`el foco de la confirmacion por teclado no quedo en "Sí, eliminar": ${kDelConfirm.foco}`);
  if (kDelEscape.objeto !== kDelAntes.objeto) v.push("Escape en la confirmacion escribio el evento");
  if (kDelEscape.confirm || kDelEscape.menu) v.push("Escape no cerro la confirmacion");
  if (!kDelEscape.focoEnEvento) v.push("Escape no devolvio el foco a la reunion");
  if (kDelEscape.anuncio) v.push(`Escape en la confirmacion anuncio: "${kDelEscape.anuncio}"`);
  if (kDelTras.n !== kDelAntes.n - 1) v.push(`el segundo Enter no borro: ${kDelAntes.n} -> ${kDelTras.n}`);
  if (kDelTras.existe) v.push("el segundo Enter no borro el evento");
  if (!kDelTras.focoEsEvento && !kDelTras.focoEnGrilla) v.push("tras borrar por teclado el foco no quedo en un vecino ni en #grilla");
  if (kDelTras.focoEsEvento && kDelTras.vecinoDia !== kDelAntes.dia) v.push(`el vecino enfocado no es del mismo dia (${kDelTras.vecinoDia})`);
  if (kDelTras.anuncio !== kDelTras.esperado) v.push(`anuncio de borrado por teclado "${kDelTras.anuncio}" (esperado "${kDelTras.esperado}")`);
  if (!(kDelScroll > 0)) v.push(`no se pudo fijar scroll de zoom para eliminar (${kDelScroll})`);
  if (kDelTras.scrollTop !== kDelScroll) v.push(`eliminar reseteo el scroll: ${kDelScroll} -> ${kDelTras.scrollTop}`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A5 "Eliminar" · confirmacion ${pDelConfirm.confirm} sin borrar ${pDelConfirm.vivo} foco ${pDelConfirm.focoEnSi} · Cancelar no escribe ${pDelCancel.objeto === pDelInfo.objeto} foco vuelve ${pDelCancel.focoEnEvento} sin anuncio ${!pDelCancel.anuncio} · confirmar ${pDelInfo.n} -> ${pDelTras.n} vecino dia ${pDelTras.vecinoDia} anuncio "${pDelTras.anuncio}" · teclado confirm ${kDelConfirm.confirm} Escape no escribe ${kDelEscape.objeto === kDelAntes.objeto} foco vuelve ${kDelEscape.focoEnEvento} sin anuncio ${!kDelEscape.anuncio} · segundo Enter ${kDelAntes.n} -> ${kDelTras.n} vecino dia ${kDelTras.vecinoDia} anuncio "${kDelTras.anuncio}" · scroll ${kDelScroll} -> ${kDelTras.scrollTop}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── Nudge por teclado (S7 · A2/A3 por teclado) y atajos acotados al foco (SC 2.1.4) ──
// Con una reunión enfocada: Alt+flechas mueve 15 min o 1 día, Shift+flechas cambia la
// duración. Se anuncia (el foco no cambia) y el scroll de la grilla se conserva. Contra
// el borde no se mueve y se dice por qué. Aparte: con el foco en un campo de texto —o en
// un control ajeno al producto— una tecla suelta no dispara acciones (2.1.4), y "Supr"
// llega a la confirmación de borrado (R1), tanto desde el menú como sobre la reunión.
const nudge = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await nudge.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await nudge.waitForTimeout(500);
// una reunión baja, para que la grilla tenga scroll real que conservar
const nudgeIdx = await nudge.evaluate(() => EVENTS.findIndex((e) => e.title === "Block: trabajo profundo"));
const nudgeAntes = await nudge.evaluate((idx) => {
  const w = document.querySelector(".gridwrap");
  const heads = document.querySelector(".heads").getBoundingClientRect().height;
  const el = document.querySelector(`#grilla .ev[data-i="${idx}"]`);
  w.scrollTop = Math.max(0, Math.round(heads + parseFloat(el.style.top) + parseFloat(el.style.height) / 2 - w.clientHeight / 2));
  el.focus();
  const a = document.querySelector("#announcer"); if (a) a.textContent = "";
  return { min: EVENTS[idx].min, dur: EVENTS[idx].dur, day: EVENTS[idx].day, titulo: EVENTS[idx].title, scroll: w.scrollTop };
}, nudgeIdx);
await nudge.waitForTimeout(120);
const nudgeKey = async (mods, key) => {
  const ms = Array.isArray(mods) ? mods : [mods];
  for (const m of ms) await nudge.keyboard.down(m);
  await nudge.keyboard.press(key);
  for (const m of [...ms].reverse()) await nudge.keyboard.up(m);
  await nudge.waitForTimeout(250);
};
// El acorde VIEJO (Alt solo) ya no debe mover nada: es Atrás/Adelante en Windows/Linux
// y el navegador puede ignorar preventDefault. Si todavía moviera, el cambio no sería real.
const viejoMin = await nudge.evaluate((idx) => EVENTS[idx].min, nudgeIdx);
await nudgeKey("Alt", "ArrowDown");
const nViejo = await nudge.evaluate((idx) => ({
  min: EVENTS[idx].min,
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), nudgeIdx);
// El acorde NUEVO (Ctrl+Alt), no reservado por ningún motor.
await nudgeKey(["Control", "Alt"], "ArrowDown");
const nMin = await nudge.evaluate((idx) => ({
  min: EVENTS[idx].min,
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  foco: document.activeElement === document.querySelector(`#grilla .ev[data-i="${idx}"]`),
  scroll: document.querySelector(".gridwrap").scrollTop,
}), nudgeIdx);
await nudgeKey(["Control", "Alt"], "ArrowRight");
const nDia = await nudge.evaluate((idx) => ({
  day: EVENTS[idx].day,
  min: EVENTS[idx].min,
  diaLargo: DIAS_LARGOS[EVENTS[idx].day],
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), nudgeIdx);
await nudgeKey("Shift", "ArrowDown");
const nDur = await nudge.evaluate((idx) => ({
  dur: EVENTS[idx].dur,
  min: EVENTS[idx].min,
  fin: EVENTS[idx].min + EVENTS[idx].dur,
  aria: document.activeElement?.getAttribute("aria-label") || "",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  foco: document.activeElement === document.querySelector(`#grilla .ev[data-i="${idx}"]`),
}), nudgeIdx);
// contra el piso del rango: no se mueve y lo dice
await nudge.evaluate((idx) => {
  EVENTS[idx].min = START_H * 60;
  paint();
  document.querySelector(`#grilla .ev[data-i="${idx}"]`).focus();
  const a = document.querySelector("#announcer"); if (a) a.textContent = "";
}, nudgeIdx);
await nudgeKey(["Control", "Alt"], "ArrowUp");
const nPiso = await nudge.evaluate((idx) => ({ min: EVENTS[idx].min, piso: START_H * 60, anuncio: (document.querySelector("#announcer")?.textContent || "").trim() }), nudgeIdx);
// contra el tope por duración: no se estira y lo dice
await nudge.evaluate((idx) => {
  EVENTS[idx].dur = 60;
  EVENTS[idx].min = END_H * 60 - 60;
  paint();
  document.querySelector(`#grilla .ev[data-i="${idx}"]`).focus();
  const a = document.querySelector("#announcer"); if (a) a.textContent = "";
}, nudgeIdx);
await nudgeKey("Shift", "ArrowDown");
const nTope = await nudge.evaluate((idx) => ({ dur: EVENTS[idx].dur, min: EVENTS[idx].min, tope: END_H * 60, anuncio: (document.querySelector("#announcer")?.textContent || "").trim() }), nudgeIdx);
await nudge.close();

// 2.1.4: con el foco en un campo de texto, las teclas sueltas son texto, no acciones
const s214 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await s214.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await s214.waitForTimeout(400);
await s214.locator("[data-nueva]").click();
await s214.waitForTimeout(300);
await s214.locator("#p-titulo").focus();
const antes214 = await s214.evaluate(() => {
  const a = document.querySelector("#announcer"); if (a) a.textContent = "";
  return { n: EVENTS.length, view: VIEW };
});
await s214.keyboard.type("hndmr12");
await s214.waitForTimeout(400);
const tras214 = await s214.evaluate(() => ({
  n: EVENTS.length,
  valor: document.querySelector("#p-titulo")?.value || "",
  panel: !!document.querySelector("#panel"),
  menu: !!document.querySelector("#menu"),
  view: VIEW,
}));
// con el foco en un control AJENO al producto, una tecla suelta tampoco dispara acciones
await s214.keyboard.press("Escape");
await s214.waitForTimeout(250);
await s214.locator('.cal[data-cat="software"]').focus();
const antesAjeno = await s214.evaluate(() => ({ n: EVENTS.length, panel: !!document.querySelector("#panel") }));
await s214.keyboard.press("n");
await s214.waitForTimeout(300);
const trasAjeno = await s214.evaluate(() => ({ n: EVENTS.length, panel: !!document.querySelector("#panel"), titulo: (document.querySelector("#panel-titulo")?.textContent || "").trim() }));
await s214.close();

// R1: "Supr" hace lo que el menú promete, desde el menú y sobre la reunión enfocada
const supr = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await supr.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await supr.waitForTimeout(400);
const iSupr = await supr.evaluate(() => EVENTS.findIndex((e) => !e.busy));
const suprInfo = await supr.evaluate((i) => ({ n: EVENTS.length }), iSupr);
await supr.evaluate((i) => document.querySelector(`#grilla .ev[data-i="${i}"]`)?.focus(), iSupr);
await supr.keyboard.press("Enter");
await supr.waitForTimeout(250);
const suprHint = await supr.evaluate(() => {
  const b = document.querySelector('[data-accion="eliminar"]');
  return { hayEliminar: !!b, hint: (b?.querySelector(".m-tecla")?.textContent || "").trim() };
});
await supr.keyboard.press("Delete");
await supr.waitForTimeout(300);
const suprConfirm = await supr.evaluate((i) => ({
  confirm: !!document.querySelector("#confirmar-eliminar"),
  foco: document.activeElement?.id || null,
  n: EVENTS.length,
  vivo: !!EVENTS[i],
}), iSupr);
await supr.keyboard.press("Escape");
await supr.waitForTimeout(250);
await supr.evaluate((i) => document.querySelector(`#grilla .ev[data-i="${i}"]`)?.focus(), iSupr);
await supr.keyboard.press("Delete");
await supr.waitForTimeout(300);
const suprDirecto = await supr.evaluate((i) => ({
  confirm: !!document.querySelector("#confirmar-eliminar"),
  foco: document.activeElement?.id || null,
  n: EVENTS.length,
  vivo: !!EVENTS[i],
}), iSupr);
await supr.keyboard.press("Escape");
await supr.waitForTimeout(200);
await supr.close();

{
  const v = [];
  // nudge
  if (nViejo.min !== viejoMin) v.push(`el acorde viejo (Alt solo) todavia mueve la reunion: ${viejoMin} -> ${nViejo.min}`);
  if (nViejo.anuncio) v.push(`el acorde viejo (Alt solo) anuncio: "${nViejo.anuncio}"`);
  if (nMin.min !== nudgeAntes.min + 15) v.push(`Ctrl+Alt+ArrowDown no movio 15 min: ${nudgeAntes.min} -> ${nMin.min}`);
  // el repintado reemplaza el nodo y su nombre accesible ya trae la hora nueva:
  // enfocar ESO es el anuncio, así que la live region debe quedar vacía (alternancia).
  if (!nMin.aria.includes(fmt2(nudgeAntes.min + 15))) v.push(`el nombre accesible enfocado no trae la hora nueva: "${nMin.aria}"`);
  if (nMin.anuncio) v.push(`el nudge anuncio ademas de re-enfocar (doble lectura): "${nMin.anuncio}"`);
  if (!nMin.foco) v.push("tras el nudge el foco no sigue en la reunion");
  if (!(nudgeAntes.scroll > 0)) v.push(`no se pudo fijar un scroll no nulo para probar (${nudgeAntes.scroll})`);
  if (nMin.scroll !== nudgeAntes.scroll) v.push(`el nudge reseteo el scroll: ${nudgeAntes.scroll} -> ${nMin.scroll}`);
  if (nDia.day !== nudgeAntes.day + 1) v.push(`Ctrl+Alt+ArrowRight no movio 1 dia: ${nudgeAntes.day} -> ${nDia.day}`);
  if (nDia.min !== nMin.min) v.push(`el nudge de dia cambio la hora: ${nMin.min} -> ${nDia.min}`);
  if (!nDia.aria.includes(nDia.diaLargo)) v.push(`el nombre accesible enfocado no trae el dia nuevo (${nDia.diaLargo}): "${nDia.aria}"`);
  if (nDia.anuncio) v.push(`el nudge de dia anuncio ademas de re-enfocar: "${nDia.anuncio}"`);
  if (nDur.dur !== nudgeAntes.dur + 15) v.push(`Shift+ArrowDown no cambio 15 min de duracion: ${nudgeAntes.dur} -> ${nDur.dur}`);
  if (!nDur.aria.includes(`a ${fmt2(nDur.fin)}`)) v.push(`el nombre accesible enfocado no trae el fin nuevo (${fmt2(nDur.fin)}): "${nDur.aria}"`);
  if (nDur.anuncio) v.push(`el nudge de duracion anuncio ademas de re-enfocar: "${nDur.anuncio}"`);
  if (!nDur.foco) v.push("tras el nudge de duracion el foco no sigue en la reunion");
  // contra un borde NO hay repintado ni cambio de foco: ahi sí debe anunciarse el rechazo
  if (nPiso.min !== nPiso.piso) v.push(`contra el piso el nudge movio la reunion: ${nPiso.min}`);
  if (!nPiso.anuncio) v.push("contra el piso el nudge no dijo nada");
  if (nTope.dur !== 60 || nTope.min + nTope.dur !== nTope.tope) v.push(`contra el tope el nudge estiro la reunion: dur ${nTope.dur} (min+tope ${nTope.min + nTope.dur} vs ${nTope.tope})`);
  if (!nTope.anuncio) v.push("contra el tope el nudge no dijo nada");
  // 2.1.4
  if (tras214.valor !== "hndmr12") v.push(`el campo no recibio el texto: "${tras214.valor}"`);
  if (tras214.n !== antes214.n) v.push(`una tecla suelta disparo una accion con el foco en el campo: ${antes214.n} -> ${tras214.n}`);
  if (tras214.menu) v.push("se abrio el menu con el foco en el campo");
  if (tras214.view !== antes214.view) v.push(`se cambio la vista con el foco en el campo: ${antes214.view} -> ${tras214.view}`);
  if (!tras214.panel) v.push("el panel se cerro con el foco en el campo");
  if (trasAjeno.panel) v.push(`con el foco en un control ajeno, "n" abrio el panel: "${trasAjeno.titulo}"`);
  if (trasAjeno.n !== antesAjeno.n) v.push(`con el foco en un control ajeno, "n" cambio EVENTS: ${antesAjeno.n} -> ${trasAjeno.n}`);
  // R1
  if (!suprHint.hayEliminar) v.push('el menu no ofrece "Eliminar"');
  if (suprHint.hint !== "Supr") v.push(`el item Eliminar no muestra la tecla Supr: "${suprHint.hint}"`);
  if (!suprConfirm.confirm) v.push("Supr en el menu no abrio la confirmacion de borrado");
  if (suprConfirm.foco !== "eliminar-si") v.push(`tras Supr el foco no quedo en "Sí, eliminar": ${suprConfirm.foco}`);
  if (!suprConfirm.vivo || suprConfirm.n !== suprInfo.n) v.push("Supr borro antes de confirmar");
  if (!suprDirecto.confirm) v.push("Supr sobre la reunion enfocada no abrio la confirmacion");
  if (!suprDirecto.vivo || suprDirecto.n !== suprInfo.n) v.push("Supr directo borro antes de confirmar");
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A6 nudge por teclado · Alt solo inerte ${nViejo.min === viejoMin} · Ctrl+Alt+↓ ${nudgeAntes.min}->${nMin.min} nombre "${nMin.aria}" live "${nMin.anuncio || "(vacia)"}" scroll ${nudgeAntes.scroll}->${nMin.scroll} · Ctrl+Alt+→ dia ${nudgeAntes.day}->${nDia.day} nombre trae "${nDia.diaLargo}" live "${nDia.anuncio || "(vacia)"}" · Shift+↓ dur ${nudgeAntes.dur}->${nDur.dur} fin ${fmt2(nDur.fin)} live "${nDur.anuncio || "(vacia)"}" · piso ${nPiso.min} anuncio "${nPiso.anuncio}" · tope dur ${nTope.dur} anuncio "${nTope.anuncio}" · 2.1.4 campo "${tras214.valor}" eventos ${tras214.n} vista ${tras214.view} · ajeno panel ${trasAjeno.panel} · Supr hint "${suprHint.hint}" confirm ${suprConfirm.confirm} foco ${suprConfirm.foco} · directo ${suprDirecto.confirm} foco ${suprDirecto.foco}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

// ── A7 · Objetivos de puntero (SC 2.5.8) y contraste de todo control con relleno ──
// Hasta acá el arnés solo medía el texto DENTRO de los bloques de evento: por eso
// el defecto de #fff sobre --accent (3.52:1) vivió escondido en .btn.primary. Esta
// guarda MIDE cada objetivo (botones, links, inputs, items de menú y el asa de
// redimensionar). La única excepción es la "Essential" de 2.5.8 para bloques de
// evento cortos —datos cuya densidad es necesaria—, marcados con data-densa en
// renderEvent: la excepción es explícita y revisable, y NO tapa un arreglo posible.
// Corre en las 3 variantes × 3 densidades (en franja/pliegue el alto se ajusta solo,
// pero se recorren las 3 multiplicidades) + las vistas Lista y Mes.
const medirObjetivos = () => {
  const q = (s) => [...document.querySelectorAll(s)];
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const set = (c) => { cx.fillStyle = Array.isArray(c) ? `rgb(${c[0]},${c[1]},${c[2]})` : c; };
  const pixel = (bg, fg) => { cx.clearRect(0, 0, 1, 1); set(bg); cx.fillRect(0, 0, 1, 1); if (fg) { set(fg); cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const rel = (rgb) => { const f = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const la = rel(a), lb = rel(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  // el texto de un control puede vivir en un hijo (.mev-h, .lev-p, .m-tecla): se miden todos
  const textos = (el) => { const out = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { if (c.textContent.trim()) out.push(n); } else if (c.nodeType === 1) walk(c); } }; walk(el); return out; };
  const EXCEPCIONES = { "[data-densa]": "bloque de evento corto: densidad necesaria (Essential, 2.5.8)" };
  const SEL = 'button, a[href], [role="menuitem"], input, select, textarea, .grip';
  const chicos = [], contraste = [], excepcionados = [];
  for (const el of q(SEL).filter(vis)) {
    if (el.closest("#announcer, .sr-only, .skip")) continue;
    const b = el.getBoundingClientRect();
    const cls = (el.className || "").toString().split(" ")[0] || el.tagName;
    const exceptuado = Object.keys(EXCEPCIONES).find((sel) => el.matches(sel) || el.closest(sel));
    if (b.width < 24 || b.height < 24) {
      const m = `${cls}:${Math.round(b.width)}x${Math.round(b.height)}`;
      if (exceptuado) excepcionados.push(m); else chicos.push(m);
    }
    if (el.classList.contains("ev")) continue;   // el texto de los bloques lo mide su propia guarda
    const propio = getComputedStyle(el).backgroundColor;
    if (propio === "rgba(0, 0, 0, 0)" || propio === "transparent") continue;   // sin relleno propio: no es el caso de 1.4.3 que se cierra acá
    const relleno = pixel(bgOf(el.parentElement || el), propio);
    const tns = textos(el);
    if (!tns.length && el.tagName === "INPUT" && el.value.trim()) tns.push(el);
    for (const tn of tns) {
      const r = ratio(relleno, pixel(relleno, getComputedStyle(tn).color));
      if (r < 4.5) contraste.push(`${cls}${el.classList.contains("on") ? ".on" : ""} ${r.toFixed(2)}:1 "${(el.value || el.textContent).trim().slice(0, 14)}"`);
    }
  }
  return { chicos: [...new Set(chicos)], contraste: [...new Set(contraste)], excepcionados: [...new Set(excepcionados)] };
};
// mide el contraste del texto (actual y con #fff) sobre cualquier relleno == --accent
const medirAcento = () => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const set = (c) => { cx.fillStyle = Array.isArray(c) ? `rgb(${c[0]},${c[1]},${c[2]})` : c; };
  const pixel = (bg, fg) => { cx.clearRect(0, 0, 1, 1); set(bg); cx.fillRect(0, 0, 1, 1); if (fg) { set(fg); cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const rel = (rgb) => { const f = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const la = rel(a), lb = rel(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const ACC = [254, 65, 0];
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], input')) {
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
    const cs = getComputedStyle(el);
    const comp = pixel(bgOf(el.parentElement || el), cs.backgroundColor);
    if (comp.join(",") !== ACC.join(",")) continue;
    out.push({ el: (el.className || el.tagName).toString().split(" ")[0], texto: (el.value || el.textContent || "").trim().slice(0, 16), actual: +ratio(comp, pixel(comp, cs.color)).toFixed(2), blanco: +ratio(comp, pixel(comp, "#fff")).toFixed(2) });
  }
  return [...new Map(out.map((o) => [`${o.el}|${o.texto}`, o])).values()];
};
const DENSIDADES = [0.72, 1, 1.32];
const obj = { chicos: [], contraste: [], excepcionados: [] };
const acumular = (m) => { obj.chicos.push(...m.chicos); obj.contraste.push(...m.contraste); obj.excepcionados.push(...m.excepcionados); };
for (const va of VARIANTS) {
  for (const z of DENSIDADES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${FILE}?v=${va.v}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(340);
    await page.evaluate((zz) => { ZOOM_MULT = zz; mount(current); }, z);
    await page.waitForTimeout(340);
    acumular(await page.evaluate(medirObjetivos));
    await page.evaluate(() => abrirPanel({ dia: 1, min: 9 * 60, dur: 45 }));   // trae .p-dur.on
    await page.waitForTimeout(240);
    acumular(await page.evaluate(medirObjetivos));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.evaluate(() => abrirMenu(EVENTS.findIndex((e) => !e.busy)));
    await page.waitForTimeout(220);
    acumular(await page.evaluate(medirObjetivos));
    await page.locator('[data-accion="mover"]').click();                       // trae [data-dia].on
    await page.waitForTimeout(220);
    acumular(await page.evaluate(medirObjetivos));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(180);
    await page.evaluate(() => abrirMenu(EVENTS.findIndex((e) => !e.busy)));
    await page.waitForTimeout(180);
    await page.locator('[data-accion="duracion"]').click();                    // trae [data-dpreset].on
    await page.waitForTimeout(220);
    acumular(await page.evaluate(medirObjetivos));
    await page.close();
  }
}
for (const view of ["lista", "mes"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${FILE}?v=3&view=${view}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(380);
  acumular(await page.evaluate(medirObjetivos));
  await page.close();
}
obj.chicos = [...new Set(obj.chicos)];
obj.contraste = [...new Set(obj.contraste)];
obj.excepcionados = [...new Set(obj.excepcionados)];

// evidencia del defecto cerrado: texto sobre el acento, con el color actual y con
// blanco (el valor anterior). Todas las muestras deben dar >= 4.5 con el actual.
const acP = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await acP.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await acP.waitForTimeout(380);
const acento = [];
await acP.evaluate(() => abrirPanel({ dia: 1, min: 9 * 60, dur: 45 }));
await acP.waitForTimeout(240);
acento.push(...await acP.evaluate(medirAcento));
await acP.keyboard.press("Escape");
await acP.waitForTimeout(180);
await acP.evaluate(() => abrirMenu(EVENTS.findIndex((e) => !e.busy)));
await acP.waitForTimeout(180);
await acP.locator('[data-accion="mover"]').click();
await acP.waitForTimeout(220);
acento.push(...await acP.evaluate(medirAcento));
await acP.keyboard.press("Escape");
await acP.waitForTimeout(180);
await acP.evaluate(() => abrirMenu(EVENTS.findIndex((e) => !e.busy)));
await acP.waitForTimeout(180);
await acP.locator('[data-accion="duracion"]').click();
await acP.waitForTimeout(220);
acento.push(...await acP.evaluate(medirAcento));
await acP.close();
const acentoU = [...new Map(acento.map((o) => [`${o.el}|${o.texto}`, o])).values()];

{
  const v = [];
  if (obj.chicos.length) v.push(`objetivos < 24x24 sin excepción: ${obj.chicos.slice(0, 8).join(", ")}`);
  if (obj.contraste.length) v.push(`contraste < 4.5:1 en controles con relleno: ${obj.contraste.slice(0, 8).join(", ")}`);
  for (const a of acentoU) if (a.actual < 4.5) v.push(`texto sobre el acento ${a.actual}:1 en ${a.el} "${a.texto}"`);
  const peor = acentoU.reduce((m, a) => Math.min(m, a.actual), 99);
  const peorBlanco = acentoU.reduce((m, a) => Math.min(m, a.blanco), 99);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A7 objetivos ≥24px y contraste de controles · 3 variantes × 3 densidades + Lista/Mes · chicos ${obj.chicos.length} · contraste <4.5 ${obj.contraste.length} · excepción ${Object.keys({ "[data-densa]": 1 })[0]} (bloque corto, Essential) en ${obj.excepcionados.length} objetivos · texto sobre --accent: con #fff medido ${peorBlanco}:1 (defecto cerrado) ahora peor ${peor}:1 en ${acentoU.length} controles`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

// ── A8 · Arrastre: crear, mover y cancelación de puntero (SC 2.5.2) ──
// El arrastre es la interacción más vieja del prototipo y hasta ahora no se medía:
// por eso un TypeError (minOf inexistente) sobrevivió. Acá se mide el camino feliz
// —día de la columna y minuto derivado de la POSICIÓN del puntero vía geom().minOf,
// sin números mágicos— y las dos salidas que exige 2.5.2: Escape durante el gesto y
// soltar fuera de la grilla. Ninguna escribe. Mover no abre menú ni panel.
const dg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await dg.goto(`${FILE}?v=1`, { waitUntil: "networkidle" });
await dg.waitForTimeout(420);
// 1) crear arrastrando (viernes, 15:00: hueco libre)
const planCrear = await dg.evaluate(() => {
  const col = document.querySelector('.col[data-day="4"]');
  const r = col.getBoundingClientRect(), g = geom();
  const yRel = g.yOf(15 * 60);
  return { x: r.left + r.width / 2, y: r.top + yRel, esperado: Math.round(g.minOf(yRel) / 15) * 15, n: EVENTS.length };
});
await dg.mouse.move(planCrear.x, planCrear.y);
await dg.mouse.down();
await dg.mouse.move(planCrear.x, planCrear.y + 40, { steps: 6 });
await dg.mouse.up();
await dg.waitForTimeout(400);
const trasCrear = await dg.evaluate((n) => {
  const e = EVENTS[n];
  return { n: EVENTS.length, dia: e?.day, min: e?.min, dur: e?.dur,
    panel: !!document.querySelector("#panel"), fantasma: !!document.querySelector("#ghost") };
}, planCrear.n);
// 2) Escape durante un arrastre de creación: no crea
const nPre = await dg.evaluate(() => EVENTS.length);
const planEsc = await dg.evaluate(() => {
  const col = document.querySelector('.col[data-day="3"]');
  const r = col.getBoundingClientRect(), g = geom();
  return { x: r.left + r.width / 2, y: r.top + g.yOf(15 * 60) };
});
await dg.mouse.move(planEsc.x, planEsc.y);
await dg.mouse.down();
await dg.mouse.move(planEsc.x, planEsc.y + 50, { steps: 5 });
await dg.keyboard.press("Escape");
await dg.mouse.up();
await dg.waitForTimeout(320);
const trasEsc = await dg.evaluate(() => ({
  n: EVENTS.length, panel: !!document.querySelector("#panel"),
  fantasma: !!document.querySelector("#ghost"),
  etiqueta: document.querySelector(".droplab")?.style.display || "",
}));
// 3) Escape durante un arrastre de MOVER: restaura el evento
const planEscMv = await dg.evaluate(() => {
  const i = EVENTS.findIndex((e) => e.title === "Reunión de equipo");
  const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  const r = el.getBoundingClientRect();
  return { i, x: r.left + r.width / 2, y: r.top + r.height / 2, antes: { min: EVENTS[i].min, dur: EVENTS[i].dur, day: EVENTS[i].day } };
});
await dg.mouse.move(planEscMv.x, planEscMv.y);
await dg.mouse.down();
await dg.mouse.move(planEscMv.x, planEscMv.y + 60, { steps: 6 });
await dg.keyboard.press("Escape");
await dg.mouse.up();
await dg.waitForTimeout(320);
const trasEscMv = await dg.evaluate((i) => ({ min: EVENTS[i].min, dur: EVENTS[i].dur, day: EVENTS[i].day, menu: !!document.querySelector("#menu") }), planEscMv.i);
// 4) soltar FUERA de la grilla: no crea
const nFuera = await dg.evaluate(() => EVENTS.length);
const planFuera = await dg.evaluate(() => {
  const col = document.querySelector('.col[data-day="3"]');
  const r = col.getBoundingClientRect(), g = geom();
  const side = document.querySelector(".side").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + g.yOf(16 * 60), outX: side.left + side.width / 2, outY: side.top + 40 };
});
await dg.mouse.move(planFuera.x, planFuera.y);
await dg.mouse.down();
await dg.mouse.move(planFuera.outX, planFuera.outY, { steps: 8 });
await dg.mouse.up();
await dg.waitForTimeout(320);
const trasFuera = await dg.evaluate(() => ({ n: EVENTS.length, panel: !!document.querySelector("#panel") }));
// 5) arrastrar una reunión existente: la mueve, no abre menú ni panel
const planMover = await dg.evaluate(() => {
  const i = EVENTS.findIndex((e) => e.title === "Reunión de equipo");
  const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  const r = el.getBoundingClientRect();
  return { i, x: r.left + r.width / 2, y: r.top + r.height / 2, antes: { min: EVENTS[i].min, dur: EVENTS[i].dur, day: EVENTS[i].day }, n: EVENTS.length };
});
await dg.mouse.move(planMover.x, planMover.y);
await dg.mouse.down();
await dg.mouse.move(planMover.x, planMover.y + 45, { steps: 6 });
await dg.mouse.up();
await dg.waitForTimeout(380);
const trasMover = await dg.evaluate((i) => ({
  min: EVENTS[i].min, dur: EVENTS[i].dur, day: EVENTS[i].day, n: EVENTS.length,
  menu: !!document.querySelector("#menu"), panel: !!document.querySelector("#panel"), fantasma: !!document.querySelector("#ghost"),
}), planMover.i);
await dg.close();
{
  const v = [];
  if (trasCrear.n !== planCrear.n + 1) v.push(`crear arrastrando no sumó exactamente 1 (${planCrear.n} -> ${trasCrear.n})`);
  if (trasCrear.dia !== 4) v.push(`el evento creado cayó en el día ${trasCrear.dia} (esperado 4)`);
  if (trasCrear.min !== planCrear.esperado) v.push(`el evento creado cayó en ${trasCrear.min} (derivado del puntero: ${planCrear.esperado})`);
  if (trasCrear.panel) v.push("crear arrastrando abrió el panel");
  if (trasCrear.fantasma) v.push("el fantasma del arrastre quedó en el DOM");
  if (trasEsc.n !== nPre) v.push(`Escape durante el arrastre creó ${trasEsc.n - nPre} evento(s)`);
  if (trasEsc.panel) v.push("Escape durante el arrastre abrió el panel");
  if (trasEsc.fantasma) v.push("Escape durante el arrastre dejó el fantasma");
  if (trasEsc.etiqueta && trasEsc.etiqueta !== "none") v.push(`Escape durante el arrastre dejó la etiqueta visible (${trasEsc.etiqueta})`);
  if (trasEscMv.min !== planEscMv.antes.min || trasEscMv.day !== planEscMv.antes.day) v.push(`Escape no restauró la reunión movida (${planEscMv.antes.min} -> ${trasEscMv.min})`);
  if (trasEscMv.dur !== planEscMv.antes.dur) v.push(`Escape durante el mover cambió la duración (${planEscMv.antes.dur} -> ${trasEscMv.dur})`);
  if (trasEscMv.menu) v.push("Escape durante el arrastre abrió el menú");
  if (trasFuera.n !== nFuera) v.push(`soltar fuera de la grilla creó ${trasFuera.n - nFuera} evento(s)`);
  if (trasFuera.panel) v.push("soltar fuera de la grilla abrió el panel");
  if (!(trasMover.min > planMover.antes.min)) v.push(`arrastrar no movió la reunión (${planMover.antes.min} -> ${trasMover.min})`);
  if (trasMover.day !== planMover.antes.day) v.push(`arrastrar cambió el día (${planMover.antes.day} -> ${trasMover.day})`);
  if (trasMover.dur !== planMover.antes.dur) v.push(`arrastrar cambió la duración (${planMover.antes.dur} -> ${trasMover.dur})`);
  if (trasMover.n !== planMover.n) v.push(`arrastrar cambió la cantidad de eventos (${planMover.n} -> ${trasMover.n})`);
  if (trasMover.menu) v.push("arrastrar una reunión abrió el menú");
  if (trasMover.panel) v.push("arrastrar una reunión abrió el panel");
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A8 arrastre · crear ${planCrear.n} -> ${trasCrear.n} día ${trasCrear.dia} min ${trasCrear.min} (puntero ${planCrear.esperado}) sin panel ${!trasCrear.panel} · Escape no crea ${trasEsc.n === nPre} · Escape restaura mover ${trasEscMv.min === planEscMv.antes.min && trasEscMv.dur === planEscMv.antes.dur} · soltar fuera no crea ${trasFuera.n === nFuera} · mover ${planMover.antes.min} -> ${trasMover.min} sin menú ${!trasMover.menu} ni panel ${!trasMover.panel}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

// ── A9 · Sin modos, sin atributos deprecados y sin controles muertos en el menú ──
// R4: no hay estado de "modo" ni aria-grabbed/aria-dropeffect/role=grid en ninguna parte.
// R5: la lista esperada se DERIVA de ACCIONES_HECHAS y además se verifica que cada item
// renderizado tenga un handler REAL (click → efecto observable). Un id agregado al
// marcador sin cablear hace fallar esta guarda, no la deja pasar.
const modp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await modp.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await modp.waitForTimeout(420);
const prohibidos = await modp.evaluate(() => ({
  modo: document.querySelectorAll("[data-modo]").length,
  grabbed: document.querySelectorAll("[aria-grabbed]").length,
  dropeffect: document.querySelectorAll("[aria-dropeffect]").length,
  grid: document.querySelectorAll('[role="grid"]').length,
}));
const marcador = await modp.evaluate(() => ({
  ids: [...ACCIONES_HECHAS],
  sinAccion: [...ACCIONES_HECHAS].filter((id) => !ACCIONES.some((a) => a.id === id)),
}));
const EFECTO = {
  editar: (o) => o.panel,
  mover: (o) => o.mover,
  duracion: (o) => o.dur,
  duplicar: (o) => o.n > o.n0,
  eliminar: (o) => o.confirm,
};
const sinMapa = [], sinEfecto = [], noRenderizados = [];
const renderizados = new Set();
for (const id of marcador.ids) {
  await modp.reload({ waitUntil: "networkidle" });
  await modp.waitForTimeout(380);
  await modp.evaluate(() => abrirMenu(EVENTS.findIndex((e) => !e.busy)));
  await modp.waitForTimeout(220);
  const set = await modp.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"]')].map((b) => b.dataset.accion));
  for (const s of set) renderizados.add(s);
  if (!set.includes(id)) { noRenderizados.push(id); continue; }
  const n0 = await modp.evaluate(() => EVENTS.length);
  await modp.locator(`[data-accion="${id}"]`).click();
  await modp.waitForTimeout(280);
  const obs = await modp.evaluate(() => ({
    panel: !!document.querySelector("#panel"), mover: !!document.querySelector("#mover-dialog"),
    dur: !!document.querySelector("#dur-dialog"), confirm: !!document.querySelector("#confirmar-eliminar"),
    n: EVENTS.length,
  }));
  obs.n0 = n0;
  if (!EFECTO[id]) sinMapa.push(id);
  else if (!EFECTO[id](obs)) sinEfecto.push(id);
}
await modp.close();
{
  const v = [];
  if (prohibidos.modo) v.push(`${prohibidos.modo} elementos con [data-modo]`);
  if (prohibidos.grabbed) v.push(`${prohibidos.grabbed} elementos con aria-grabbed`);
  if (prohibidos.dropeffect) v.push(`${prohibidos.dropeffect} elementos con aria-dropeffect`);
  if (prohibidos.grid) v.push(`${prohibidos.grid} elementos con role=grid`);
  if (marcador.sinAccion.length) v.push(`ACCIONES_HECHAS tiene ids sin acción en ACCIONES: ${marcador.sinAccion.join(", ")}`);
  if (sinMapa.length) v.push(`sin efecto esperado declarado (handler no verificable): ${sinMapa.join(", ")}`);
  if (sinEfecto.length) v.push(`items del menú sin handler cableado: ${sinEfecto.join(", ")}`);
  if (noRenderizados.length) v.push(`ids del marcador que no se renderizan: ${noRenderizados.join(", ")}`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A9 sin modos ni deprecados · [data-modo] ${prohibidos.modo} · aria-grabbed ${prohibidos.grabbed} · aria-dropeffect ${prohibidos.dropeffect} · role=grid ${prohibidos.grid} · marcador {${marcador.ids.join(", ")}} · renderizados {${[...renderizados].join(", ")}} · handlers verificados ${marcador.ids.length - sinMapa.length - sinEfecto.length - noRenderizados.length}/${marcador.ids.length}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
// ── A10 · La Lista opera las reuniones reusando el menú de la grilla ──
// La Lista es la alternativa accesible declarada, pero sus filas eran botones inertes.
// Acá se prueba, con viajes REALES de teclado desde la Lista, que: es UN solo tab stop
// (roving tabindex), las flechas/Home/End mueven el foco adentro, Enter abre el MISMO
// menú anclado a esa fila, y cada acción existente (Mover / Cambiar duración / Duplicar
// / Eliminar) opera el evento. El borrado implementa la regla de APG: el foco cae en la
// fila SIGUIENTE (o la anterior si era la última; o el primer evento del día siguiente
// si el día quedó vacío; o el contenedor si no queda ninguna). Abrir el menú NO anuncia
// (el foco entra al menú); borrar SÍ (el foco va a otro objeto).
const abrirLista = async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${FILE}?v=3&view=lista`, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  return p;
};
const focoFila = async (p, i) => {
  await p.evaluate((x) => document.querySelector(`#grilla .lev[data-i="${x}"]`)?.focus(), i);
  await p.waitForTimeout(70);
};
const abrirMenuLista = async (p, i) => { await focoFila(p, i); await p.keyboard.press("Enter"); await p.waitForTimeout(180); };
const menuBajarA = async (p, n) => { for (let k = 0; k < n; k++) { await p.keyboard.press("ArrowDown"); await p.waitForTimeout(70); } };
const borrarFila = async (p, i) => {
  await abrirMenuLista(p, i);                    // menú (foco: Editar)
  await menuBajarA(p, 4);                        // → Eliminar
  await p.keyboard.press("Enter");               // confirmación (foco: Sí, eliminar)
  await p.waitForTimeout(160);
  await p.keyboard.press("Enter");               // confirma
  await p.waitForTimeout(350);
};

// 1) Compuesto: roving, flechas, un solo tab stop y menú anclado (sin anunciar)
const lc = await abrirLista();
const comp = await lc.evaluate(() => {
  const filas = [...document.querySelectorAll("#grilla .lev")];
  return {
    filas: filas.length,
    filaPrimera: Number(filas[0]?.dataset?.i),
    filaUltima: Number(filas[filas.length - 1]?.dataset?.i),
    filaTabbable: Number(filas.find((f) => f.getAttribute("tabindex") === "0")?.dataset?.i),
    tabbables: filas.filter((f) => f.getAttribute("tabindex") === "0").length,
    conIndice: filas.every((f) => /^\d+$/.test(f.dataset.i || "")),
    noBusy: filas.filter((f) => !f.hasAttribute("data-busy")).length,
    conMenu: filas.filter((f) => !f.hasAttribute("data-busy") && f.getAttribute("aria-haspopup") === "menu").length,
    busyConExpanded: filas.filter((f) => f.hasAttribute("data-busy") && f.hasAttribute("aria-expanded")).length,
    region: document.querySelector("#grilla")?.getAttribute("role"),
    alcanzables: filas.filter((f) => { const b = f.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length,
    inalcanzables: filas.filter((f) => f.closest('[inert], [aria-hidden="true"]')).length,
    prohibido: !!document.querySelector('[role="grid"], [aria-grabbed], [aria-dropeffect]'),
  };
});
await focoFila(lc, comp.filaPrimera);
const k0 = await lc.evaluate(() => Number(document.activeElement?.dataset?.i));
await lc.keyboard.press("ArrowDown"); await lc.waitForTimeout(90);
const kDown = await lc.evaluate(() => Number(document.activeElement?.dataset?.i));
await lc.keyboard.press("ArrowUp"); await lc.waitForTimeout(90);
const kUp = await lc.evaluate(() => Number(document.activeElement?.dataset?.i));
await lc.keyboard.press("End"); await lc.waitForTimeout(90);
const kEnd = await lc.evaluate(() => Number(document.activeElement?.dataset?.i));
await lc.keyboard.press("Home"); await lc.waitForTimeout(90);
const kHome = await lc.evaluate(() => Number(document.activeElement?.dataset?.i));
await lc.keyboard.press("ArrowRight"); await lc.waitForTimeout(90);
const kRight = await lc.evaluate(() => ({ i: Number(document.activeElement?.dataset?.i), day: EVENTS[Number(document.activeElement?.dataset?.i)]?.day }));
await lc.keyboard.press("ArrowLeft"); await lc.waitForTimeout(90);
const kLeft = await lc.evaluate(() => Number(document.activeElement?.dataset?.i));
// un solo tab stop: Nueva reunión (día 0) → Tab → fila roving → Tab → control siguiente
await lc.evaluate(() => document.querySelector('[data-nueva-dia="0"]')?.focus());
await lc.waitForTimeout(60);
await lc.keyboard.press("Tab"); await lc.waitForTimeout(90);
const tab1 = await lc.evaluate(() => ({ esFila: !!document.activeElement?.classList?.contains("lev"), i: Number(document.activeElement?.dataset?.i) }));
await lc.keyboard.press("Tab"); await lc.waitForTimeout(90);
const tab2 = await lc.evaluate(() => ({ esFila: !!document.activeElement?.classList?.contains("lev"), nueva: document.activeElement?.dataset?.nuevaDia ?? null }));
await focoFila(lc, comp.filaPrimera);
await lc.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await lc.keyboard.press("Enter"); await lc.waitForTimeout(200);
const menuAncla = await lc.evaluate(() => {
  const m = document.querySelector("#menu");
  const fila = document.querySelector(`#grilla .lev[data-i="${MENU?.i}"]`);
  const rb = fila.getBoundingClientRect(), mb = m.getBoundingClientRect();
  return {
    hay: !!m, indice: MENU?.i ?? null, fila: Number(fila.dataset.i),
    items: [...m.querySelectorAll('[role="menuitem"]')].map((b) => b.dataset.accion),
    ancla: Math.abs(mb.top - (rb.bottom + 4)) < 90 || mb.bottom <= rb.top + 1,
    dentro: mb.left >= -1 && mb.top >= -1 && mb.right <= innerWidth + 1 && mb.bottom <= innerHeight + 1,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
await lc.close();

// 2) Mover desde la Lista: el diálogo existente cambia día y minuto
const lm = await abrirLista();
const iMv = await lm.evaluate(() => EVENTS.findIndex((e) => !e.busy));
const antesMvL = await lm.evaluate((i) => ({ min: EVENTS[i].min, day: EVENTS[i].day }), iMv);
const diaDestino = (antesMvL.day + 2) % 5;
await lm.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await abrirMenuLista(lm, iMv);
await menuBajarA(lm, 1);
await lm.keyboard.press("Enter"); await lm.waitForTimeout(200);
const mvAbiertoLista = await lm.evaluate(() => ({
  hay: !!document.querySelector("#mover-dialog"),
  focoEnPaso: document.activeElement?.dataset?.paso || null,
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
let tPaso = 0;
while (tPaso++ < 8) { const p2 = await lm.evaluate(() => document.activeElement?.dataset?.paso || null); if (p2 === "+15") break; await lm.keyboard.press("Tab"); await lm.waitForTimeout(50); }
await lm.keyboard.press("Enter"); await lm.waitForTimeout(90);
await lm.locator(`#mover-dialog [data-dia="${diaDestino}"]`).click();
await lm.waitForTimeout(90);
let tMv = 0, focoMv = null;
while (tMv++ < 14) { focoMv = await lm.evaluate(() => document.activeElement?.id || null); if (focoMv === "mover-aplicar") break; await lm.keyboard.press("Tab"); await lm.waitForTimeout(50); }
await lm.keyboard.press("Enter"); await lm.waitForTimeout(350);
const trasMvL = await lm.evaluate((i) => ({
  min: EVENTS[i].min, day: EVENTS[i].day,
  focoFila: !!document.activeElement?.classList?.contains("lev"),
  focoI: Number(document.activeElement?.dataset?.i),
  dialogo: !!document.querySelector("#mover-dialog"),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), iMv);
await lm.close();

// 3) Cambiar duración desde la Lista: el diálogo existente cambia dur
const ld = await abrirLista();
const iDur = await ld.evaluate(() => EVENTS.findIndex((e) => !e.busy));
const antesDurL = await ld.evaluate((i) => ({ dur: EVENTS[i].dur, min: EVENTS[i].min }), iDur);
await ld.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await abrirMenuLista(ld, iDur);
await menuBajarA(ld, 2);
await ld.keyboard.press("Enter"); await ld.waitForTimeout(200);
const durAbiertoL = await ld.evaluate(() => ({
  hay: !!document.querySelector("#dur-dialog"),
  foco: document.activeElement?.dataset?.dpreset || null,
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
let tPre = 0;
while (tPre++ < 12) { const v = await ld.evaluate(() => document.activeElement?.dataset?.dpreset || null); if (v === "90") break; await ld.keyboard.press("Tab"); await ld.waitForTimeout(50); }
await ld.keyboard.press("Enter"); await ld.waitForTimeout(100);
let tDur = 0, focoD = null;
while (tDur++ < 14) { focoD = await ld.evaluate(() => document.activeElement?.id || null); if (focoD === "dur-aplicar") break; await ld.keyboard.press("Tab"); await ld.waitForTimeout(50); }
await ld.keyboard.press("Enter"); await ld.waitForTimeout(350);
const trasDurL = await ld.evaluate((i) => ({
  dur: EVENTS[i].dur, min: EVENTS[i].min,
  focoFila: !!document.activeElement?.classList?.contains("lev"),
  focoI: Number(document.activeElement?.dataset?.i),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), iDur);
await ld.close();

// 4) Duplicar desde la Lista: crece EVENTS y el foco pasa a la copia, sin anunciar
const lu = await abrirLista();
const nDupL = await lu.evaluate(() => EVENTS.length);
const iDup = await lu.evaluate(() => EVENTS.findIndex((e) => !e.busy));
const baseDup = await lu.evaluate((i) => ({ title: EVENTS[i].title, min: EVENTS[i].min, day: EVENTS[i].day }), iDup);
await lu.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await abrirMenuLista(lu, iDup);
await menuBajarA(lu, 3);
await lu.keyboard.press("Enter"); await lu.waitForTimeout(350);
const trasDupL = await lu.evaluate((n) => ({
  n: EVENTS.length,
  copia: EVENTS[n] ? { title: EVENTS[n].title, min: EVENTS[n].min, day: EVENTS[n].day } : null,
  focoFila: !!document.activeElement?.classList?.contains("lev"),
  focoI: Number(document.activeElement?.dataset?.i),
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}), nDupL);
await lu.close();

// 5) Eliminar desde la Lista: la fila siguiente recibe el foco (regla APG)
const lx = await abrirLista();
const iDel = await lx.evaluate(() => EVENTS.findIndex((e) => e.title === "Revisión de propuesta"));
const delInfo = await lx.evaluate((i) => {
  const f = [...document.querySelectorAll("#grilla .lev")];
  const j = f.findIndex((x) => Number(x.dataset.i) === i);
  return { titulo: EVENTS[i].title, day: EVENTS[i].day, min: EVENTS[i].min, n: EVENTS.length, nextTitle: EVENTS[Number(f[j + 1].dataset.i)].title };
}, iDel);
await lx.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await borrarFila(lx, iDel);
const trasDelL = await lx.evaluate(({ titulo, day, min }) => ({
  n: EVENTS.length,
  existe: EVENTS.some((e) => e.title === titulo),
  focoFila: !!document.activeElement?.classList?.contains("lev"),
  focoTitulo: (() => { const i = document.activeElement?.dataset?.i; return i != null ? EVENTS[Number(i)]?.title : null; })(),
  focoGrilla: document.activeElement?.id === "grilla",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  esperado: `Eliminada ${titulo}, ${DIAS_LARGOS[day]} a las ${fmt(min)}`,
}), { titulo: delInfo.titulo, day: delInfo.day, min: delInfo.min });
await lx.close();

// 6) Última fila: el foco cae en la anterior (se oculta la agenda Ministerial, cuyo
//    ocupado de Google es de solo lectura y no se puede borrar, para que la última
//    fila visible sea borrable)
const ll = await abrirLista();
await ll.locator('.cal[data-cat="ministerial"]').click();
await ll.waitForTimeout(350);
const lastInfo = await ll.evaluate(() => {
  const f = [...document.querySelectorAll("#grilla .lev")];
  const iLast = Number(f[f.length - 1].dataset.i), iPrev = Number(f[f.length - 2].dataset.i);
  return { iLast, titulo: EVENTS[iLast].title, prev: EVENTS[iPrev].title };
});
await ll.evaluate(() => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; });
await borrarFila(ll, lastInfo.iLast);
const trasLast = await ll.evaluate(({ titulo }) => ({
  existe: EVENTS.some((e) => e.title === titulo),
  focoFila: !!document.activeElement?.classList?.contains("lev"),
  focoTitulo: (() => { const i = document.activeElement?.dataset?.i; return i != null ? EVENTS[Number(i)]?.title : null; })(),
}), lastInfo);
await ll.close();

// 7) Día que queda vacío: el foco cae en el primer evento del día siguiente
//    (el jueves 18 tiene dos eventos borrables: se vacía y cae en el viernes 19)
const le = await abrirLista();
let finDia = null, guardDia = 0;
while (guardDia++ < 6) {
  const objetivo = await le.evaluate(() => {
    const f = [...document.querySelectorAll("#grilla .lev")].filter((x) => EVENTS[Number(x.dataset.i)].day === 3);
    return f.length ? Number(f[0].dataset.i) : null;
  });
  if (objetivo === null) break;
  await borrarFila(le, objetivo);
  finDia = await le.evaluate(() => {
    const primero4 = [...document.querySelectorAll("#grilla .lev")].find((x) => EVENTS[Number(x.dataset.i)].day === 4);
    const i = document.activeElement?.dataset?.i;
    const ev = i != null ? EVENTS[Number(i)] : null;
    return {
      day3: EVENTS.filter((e) => e.day === 3).length,
      focoDia: ev ? ev.day : null,
      focoTitulo: ev ? ev.title : null,
      primer4: primero4 ? EVENTS[Number(primero4.dataset.i)]?.title : null,
      focoGrilla: document.activeElement?.id === "grilla",
    };
  });
}
await le.close();

// 8) Lista sin filas: el foco cae en el contenedor (setUp: se deja una sola reunión;
//    el borrado en sí es un viaje real de teclado)
const lz = await abrirLista();
await lz.evaluate(() => {
  const keep = EVENTS.find((e) => !e.busy);
  EVENTS = EVENTS.filter((e) => e === keep);
  paint();
});
await lz.waitForTimeout(150);
await borrarFila(lz, 0);
const trasZ = await lz.evaluate(() => ({
  n: EVENTS.length,
  filas: document.querySelectorAll("#grilla .lev").length,
  focoGrilla: document.activeElement?.id === "grilla",
  anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
}));
await lz.close();

{
  const v = [];
  // compuesto
  if (!comp.filas) v.push("la Lista no tiene filas .lev");
  if (comp.tabbables !== 1) v.push(`la Lista no es UN tab stop: ${comp.tabbables} filas tabbables`);
  if (!comp.conIndice) v.push("hay filas sin data-i");
  if (comp.conMenu !== comp.noBusy) v.push(`filas accionables sin aria-haspopup=menu: ${comp.noBusy - comp.conMenu}`);
  if (comp.busyConExpanded) v.push(`${comp.busyConExpanded} filas ocupadas con aria-expanded`);
  if (comp.region !== "region") v.push(`#grilla no es region: ${comp.region}`);
  if (comp.alcanzables !== comp.filas) v.push(`filas sin caja visible: ${comp.filas - comp.alcanzables}`);
  if (comp.inalcanzables) v.push(`${comp.inalcanzables} filas dentro de [inert]/[aria-hidden]`);
  if (comp.prohibido) v.push("usa role=grid/aria-grabbed/aria-dropeffect");
  if (kDown === k0) v.push(`ArrowDown no movio de fila (${k0})`);
  if (kUp !== k0) v.push(`ArrowUp no volvio a la fila previa (${kUp})`);
  if (kEnd !== comp.filaUltima) v.push(`End no fue a la ultima fila (${kEnd} != ${comp.filaUltima})`);
  if (kHome !== comp.filaPrimera) v.push(`Home no fue a la primera fila (${kHome} != ${comp.filaPrimera})`);
  if (!(kRight.day > 0)) v.push(`ArrowRight no salto de dia (dia ${kRight.day})`);
  if (kLeft !== kHome) v.push(`ArrowLeft no volvio al primer evento del dia anterior (${kLeft})`);
  if (!tab1.esFila) v.push("Tab tras Nueva reunion no cayo en la fila roving");
  if (tab1.i !== comp.filaTabbable) v.push(`Tab cayo en la fila ${tab1.i}, no en la tabbable ${comp.filaTabbable}`);
  if (tab2.esFila) v.push("un segundo Tab siguio dentro de las filas: la Lista no es un solo tab stop");
  if (!menuAncla.hay) v.push("Enter sobre una fila no abrio el menu");
  if (menuAncla.indice !== menuAncla.fila) v.push(`el menu se anclo a otra fila (${menuAncla.indice} != ${menuAncla.fila})`);
  if (!menuAncla.ancla) v.push("el menu no quedo anclado a la fila");
  if (!menuAncla.dentro) v.push("el menu se sale de la ventana");
  if (JSON.stringify(menuAncla.items) !== JSON.stringify(["editar", "mover", "duracion", "duplicar", "eliminar"])) v.push(`items ${menuAncla.items.join(",")}`);
  if (menuAncla.anuncio) v.push(`se anuncio al abrir el menu desde la Lista: "${menuAncla.anuncio}"`);
  // mover
  if (!mvAbiertoLista.hay) v.push("Mover a… no abrio desde la Lista");
  if (mvAbiertoLista.anuncio) v.push(`se anuncio al abrir Mover desde la Lista: "${mvAbiertoLista.anuncio}"`);
  if (trasMvL.min !== antesMvL.min + 15) v.push(`Mover desde la Lista no movio 15 min: ${antesMvL.min} -> ${trasMvL.min}`);
  if (trasMvL.day !== diaDestino) v.push(`Mover desde la Lista no cambio al dia ${diaDestino}: ${trasMvL.day}`);
  if (!trasMvL.focoFila || trasMvL.focoI !== iMv) v.push(`Aplicar Mover no devolvio el foco a la fila ${iMv}: ${trasMvL.focoI}`);
  if (trasMvL.dialogo) v.push("Mover desde la Lista dejo el dialogo abierto");
  if (trasMvL.anuncio) v.push(`Mover desde la Lista anuncio ademas de re-enfocar: "${trasMvL.anuncio}"`);
  // duracion
  if (!durAbiertoL.hay) v.push("Cambiar duración no abrio desde la Lista");
  if (durAbiertoL.anuncio) v.push(`se anuncio al abrir duración desde la Lista: "${durAbiertoL.anuncio}"`);
  if (trasDurL.dur !== 90) v.push(`Cambiar duración desde la Lista no dejo dur 90: ${trasDurL.dur}`);
  if (trasDurL.min !== antesDurL.min) v.push(`Cambiar duración desde la Lista movio el inicio: ${antesDurL.min} -> ${trasDurL.min}`);
  if (!trasDurL.focoFila || trasDurL.focoI !== iDur) v.push(`Aplicar duración no devolvio el foco a la fila ${iDur}: ${trasDurL.focoI}`);
  if (trasDurL.anuncio) v.push(`Cambiar duración desde la Lista anuncio ademas de re-enfocar: "${trasDurL.anuncio}"`);
  // duplicar
  if (trasDupL.n !== nDupL + 1) v.push(`Duplicar desde la Lista no sumo 1 (${nDupL} -> ${trasDupL.n})`);
  if (!trasDupL.copia) v.push("Duplicar desde la Lista no creo la copia");
  else {
    if (trasDupL.copia.title !== `${baseDup.title} (copia)`) v.push(`titulo de la copia "${trasDupL.copia.title}"`);
    if (trasDupL.copia.min !== baseDup.min || trasDupL.copia.day !== baseDup.day) v.push("la copia no quedo en el mismo dia/minuto");
  }
  if (!trasDupL.focoFila || trasDupL.focoI !== nDupL) v.push(`Duplicar no dejo el foco en la copia (fila ${nDupL}): ${trasDupL.focoI}`);
  if (trasDupL.anuncio) v.push(`Duplicar desde la Lista anuncio: "${trasDupL.anuncio}"`);
  // eliminar: siguiente fila
  if (trasDelL.n !== delInfo.n - 1) v.push(`Eliminar desde la Lista no quito 1 (${delInfo.n} -> ${trasDelL.n})`);
  if (trasDelL.existe) v.push("Eliminar desde la Lista no borro el evento");
  if (!trasDelL.focoFila || trasDelL.focoGrilla) v.push("tras borrar el foco no quedo en una fila");
  if (trasDelL.focoTitulo !== delInfo.nextTitle) v.push(`el foco no fue a la fila siguiente "${delInfo.nextTitle}": "${trasDelL.focoTitulo}"`);
  if (trasDelL.anuncio !== trasDelL.esperado) v.push(`anuncio de borrado "${trasDelL.anuncio}" (esperado "${trasDelL.esperado}")`);
  // eliminar: ultima fila → anterior
  if (trasLast.existe) v.push("borrar la ultima fila no la elimino");
  if (!trasLast.focoFila) v.push("tras borrar la ultima fila el foco no quedo en una fila");
  if (trasLast.focoTitulo !== lastInfo.prev) v.push(`tras borrar la ultima el foco no fue a la anterior "${lastInfo.prev}": "${trasLast.focoTitulo}"`);
  // eliminar: dia vacio → primer evento del dia siguiente
  if (!finDia) v.push("no se pudo vaciar el dia 3 para probar el fallback");
  else {
    if (finDia.day3 !== 0) v.push(`el dia 3 no quedo vacio: ${finDia.day3} eventos`);
    if (finDia.focoDia !== 4) v.push(`al vaciar el dia el foco no paso al dia siguiente (dia ${finDia.focoDia})`);
    if (finDia.focoTitulo !== finDia.primer4) v.push(`al vaciar el dia el foco no fue al primer evento del dia 4: "${finDia.focoTitulo}" vs "${finDia.primer4}"`);
  }
  // eliminar: lista sin filas → contenedor
  if (trasZ.n !== 0 || trasZ.filas !== 0) v.push(`la lista no quedo sin filas (${trasZ.n} eventos, ${trasZ.filas} filas)`);
  if (!trasZ.focoGrilla) v.push("sin filas el foco no quedo en el contenedor de la Lista");
  if (!/Eliminada/.test(trasZ.anuncio)) v.push(`el borrado que vacia la Lista no anuncio: "${trasZ.anuncio}"`);
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A10 Lista operable (compuesto APG) · filas ${comp.filas} con data-i ${comp.conIndice} · tab stops ${comp.tabbables} (roving ${comp.filaTabbable}) · flechas ${k0}→↓${kDown}→↑${kUp}→End ${kEnd}→Home ${kHome}→→dia ${kRight.day}→←${kLeft} · Tab Nueva→fila ${tab1.esFila}(${tab1.i})→fuera ${!tab2.esFila} · menú anclado a fila ${menuAncla.fila}=${menuAncla.indice} dentro ${menuAncla.dentro} sin anuncio ${!menuAncla.anuncio} · Mover ${antesMvL.min}→${trasMvL.min} dia ${trasMvL.day} foco fila ${trasMvL.focoI} · Duración ${antesDurL.dur}→${trasDurL.dur} foco fila ${trasDurL.focoI} · Duplicar ${nDupL}→${trasDupL.n} foco copia ${trasDupL.focoI} sin anuncio ${!trasDupL.anuncio} · Eliminar ${delInfo.n}→${trasDelL.n} foco siguiente "${trasDelL.focoTitulo}" anuncio "${trasDelL.anuncio}" · última→anterior "${trasLast.focoTitulo}" · día vacío→día ${finDia?.focoDia} "${finDia?.focoTitulo}" · lista vacía→contenedor ${trasZ.focoGrilla}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}

// ── A11 · Panel completo (A4): agenda (categoría), notas y día ──
// El panel solo tenía título / hora / duración. Se suman agenda, notas y día, y las
// tres se persisten al crear y al editar. La agenda define color y nombre accesible
// (se ve al instante); el día mueve la reunión en la grilla Y en la Lista; las notas
// se guardan pero NO entran al nombre accesible (lo inflarían). La guarda MIDE el
// contraste de los controles nuevos, no lo asume.
const a4p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await a4p.goto(`${FILE}?v=3`, { waitUntil: "networkidle" });
await a4p.waitForTimeout(450);

await a4p.evaluate(() => abrirPanel({ dia: 1, min: 9 * 60, dur: 45 }));
await a4p.waitForTimeout(300);
const campos = await a4p.evaluate(() => {
  const panel = document.querySelector("#panel");
  if (!panel) return { falta: true };
  const catEl = panel.querySelector("#p-cat");
  const diaEl = panel.querySelector("#p-dia");
  const notasEl = panel.querySelector("#p-notas");
  const asociado = (el) => !!el && !!panel.querySelector(`label[for="${el.id}"]`);
  const tamano = (el) => { const b = el.getBoundingClientRect(); return b.width >= 24 && b.height >= 24; };
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const pixel = (bg, fg) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = bg; cx.fillRect(0, 0, 1, 1);
    if (fg) { cx.fillStyle = fg; cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const rel = (rgb) => { const f = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const la = rel(a), lb = rel(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const contraste = (el) => el ? Math.round(ratio(pixel(bgOf(el), null), pixel(bgOf(el), getComputedStyle(el).color)) * 100) / 100 : null;
  return {
    hayCat: !!catEl, hayDia: !!diaEl, hayNotas: !!notasEl,
    labelCat: asociado(catEl), labelDia: asociado(diaEl), labelNotas: asociado(notasEl),
    cats: catEl ? [...catEl.options].map((o) => o.value) : null,
    catsLabel: catEl ? [...catEl.options].map((o) => o.textContent.trim()) : null,
    dias: diaEl ? [...diaEl.options].map((o) => o.value) : null,
    diasLabel: diaEl ? [...diaEl.options].map((o) => o.textContent.trim()) : null,
    diasFuente: DAYS.slice(),
    esperados: Object.keys(CATS),
    labels: Object.values(CATS).map((v) => v.label),
    tamano: [catEl, diaEl, notasEl].every((el) => el && tamano(el)),
    contrasteCat: contraste(catEl), contrasteDia: contraste(diaEl), contrasteNotas: contraste(notasEl),
    prohibido: !!panel.querySelector('[role="grid"], [aria-grabbed], [aria-dropeffect]'),
  };
});
await a4p.keyboard.press("Escape");
await a4p.waitForTimeout(250);

// 1) Editar la AGENDA: cambia cat, color y nombre accesible; y las NOTAS se guardan sin entrar al nombre
const iEdit = await a4p.evaluate(() => EVENTS.findIndex((e) => e.title === "Fernando Bustos · Plan 1"));
const antesEdit = await a4p.evaluate((i) => ({
  cat: EVENTS[i].cat,
  color: getComputedStyle(document.querySelector(`#grilla .ev[data-i="${i}"]`)).getPropertyValue("--c").trim(),
}), iEdit);
await a4p.evaluate((i) => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; }, iEdit);
await a4p.evaluate((i) => abrirPanel({ dia: EVENTS[i].day, min: EVENTS[i].min, dur: EVENTS[i].dur, evento: EVENTS[i] }), iEdit);
await a4p.waitForTimeout(300);
await a4p.locator("#p-cat").selectOption("personal");
await a4p.locator("#p-notas").fill("Llevar propuesta impresa");
// Enter envía el formulario desde un input (en el textarea insertaría un salto): sigue siendo teclado
await a4p.locator("#p-titulo").focus();
await a4p.keyboard.press("Enter");
await a4p.waitForTimeout(450);
const trasEdit = await a4p.evaluate((i) => {
  const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  return {
    cat: EVENTS[i].cat,
    notes: EVENTS[i].notes,
    color: el ? getComputedStyle(el).getPropertyValue("--c").trim() : null,
    colorEsperado: CATS.personal.color,
    label: CATS.personal.label,
    aria: el?.getAttribute("aria-label") || "",
    panel: !!document.querySelector("#panel"),
    focoEnEl: document.activeElement === el,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, iEdit);

// 2) Cambiar el DÍA: mueve la reunión en la grilla y en la Lista, y el foco aterriza en ella
const diaIns = await a4p.evaluate((i) => EVENTS[i].day, iEdit);
const diaDestino2 = (diaIns + 3) % 5;
await a4p.evaluate((i) => { const a = document.querySelector("#announcer"); if (a) a.textContent = ""; }, iEdit);
await a4p.evaluate((i) => abrirPanel({ dia: EVENTS[i].day, min: EVENTS[i].min, dur: EVENTS[i].dur, evento: EVENTS[i] }), iEdit);
await a4p.waitForTimeout(300);
await a4p.locator("#p-dia").selectOption(String(diaDestino2));
await a4p.locator("#p-titulo").focus();
await a4p.keyboard.press("Enter");
await a4p.waitForTimeout(450);
const trasDia2 = await a4p.evaluate((i) => {
  const el = document.querySelector(`#grilla .ev[data-i="${i}"]`);
  return {
    day: EVENTS[i].day,
    colDia: el ? Number(el.closest(".col").dataset.day) : null,
    focoEnEl: document.activeElement === el,
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
}, iEdit);
await a4p.locator('[data-view="lista"]').click();
await a4p.waitForTimeout(500);
const trasDiaLista = await a4p.evaluate((i) => {
  const fila = document.querySelector(`#grilla .lev[data-i="${i}"]`);
  const sec = fila ? fila.closest(".ldia") : null;
  return {
    existe: !!fila,
    seccion: sec ? [...document.querySelectorAll("#grilla .ldia")].indexOf(sec) : null,
    dia: EVENTS[i].day,
  };
}, iEdit);

// 3) Crear con TODOS los campos: forma idéntica a las entradas existentes
await a4p.locator('[data-view="semana"]').click();
await a4p.waitForTimeout(500);
await a4p.evaluate(() => abrirPanel({ dia: 1, min: 10 * 60, dur: 30 }));
await a4p.waitForTimeout(300);
await a4p.locator("#p-titulo").fill("Reunión completa");
await a4p.locator("#p-cat").selectOption("software");
await a4p.locator("#p-dia").selectOption("3");
await a4p.locator("#p-inicio").fill("14:15");
await a4p.locator('#panel .p-dur[data-dur="60"]').click();
await a4p.locator("#p-notas").fill("Notas de la reunión");
await a4p.locator("#p-titulo").focus();
await a4p.keyboard.press("Enter");
await a4p.waitForTimeout(450);
const creadoCompleto = await a4p.evaluate(() => {
  const idx = EVENTS.findIndex((e) => e.title === "Reunión completa");
  const e = idx >= 0 ? EVENTS[idx] : null;
  const ref = EVENTS.find((x) => x.title === "Reunión de equipo");
  const RUNTIME = new Set(["lane", "laneCount"]);
  const claves = (o) => Object.keys(o).filter((k) => !RUNTIME.has(k)).sort();
  const el = document.querySelector(`#grilla .ev[data-i="${idx}"]`);
  return {
    idx,
    objeto: e ? { day: e.day, min: e.min, dur: e.dur, title: e.title, cat: e.cat, origin: e.origin, sync: e.sync, notes: e.notes } : null,
    claves: e ? claves(e) : null,
    clavesRef: ref ? claves(ref) : null,
    focoEnEl: el ? document.activeElement === el : false,
    panel: !!document.querySelector("#panel"),
    anuncio: (document.querySelector("#announcer")?.textContent || "").trim(),
  };
});
await a4p.close();

{
  const v = [];
  if (campos.falta) v.push("no se abre el panel");
  else {
    if (!campos.hayCat || !campos.hayDia || !campos.hayNotas) v.push(`faltan campos: cat ${campos.hayCat} / dia ${campos.hayDia} / notas ${campos.hayNotas}`);
    if (!campos.labelCat || !campos.labelDia || !campos.labelNotas) v.push("hay campos sin label asociada por for/id");
    if (JSON.stringify(campos.cats) !== JSON.stringify(campos.esperados)) v.push(`agenda no lista CATS: ${(campos.cats || []).join(",")}`);
    if (JSON.stringify(campos.catsLabel) !== JSON.stringify(campos.labels)) v.push(`agenda no usa los labels de CATS: ${(campos.catsLabel || []).join(",")}`);
    if (JSON.stringify(campos.dias) !== JSON.stringify(["0", "1", "2", "3", "4"])) v.push(`dia no lista los 5 dias habiles: ${(campos.dias || []).join(",")}`);
    if (JSON.stringify(campos.diasLabel) !== JSON.stringify(campos.diasFuente)) v.push(`dia no usa los labels de DAYS: ${(campos.diasLabel || []).join(",")}`);
    if (!campos.tamano) v.push("hay controles nuevos menores a 24x24");
    for (const [k, r] of [["agenda", campos.contrasteCat], ["día", campos.contrasteDia], ["notas", campos.contrasteNotas]]) {
      if (r === null) v.push(`no se pudo medir el contraste de ${k}`);
      else if (r < 4.5) v.push(`contraste ${r}:1 en ${k} (minimo 4.5)`);
    }
    if (campos.prohibido) v.push("usa role=grid/aria-grabbed/aria-dropeffect");
  }
  // agenda
  if (trasEdit.cat !== "personal") v.push(`editar la agenda no persistio cat: ${trasEdit.cat} (era ${antesEdit.cat})`);
  if (trasEdit.color !== trasEdit.colorEsperado) v.push(`el color no siguio a la agenda: ${trasEdit.color} (esperado ${trasEdit.colorEsperado})`);
  if (!trasEdit.aria.includes(trasEdit.label)) v.push(`el nombre accesible no trae la agenda nueva "${trasEdit.label}": "${trasEdit.aria}"`);
  // notas
  if (trasEdit.notes !== "Llevar propuesta impresa") v.push(`editar las notas no las persistio: "${trasEdit.notes}"`);
  if (trasEdit.aria.includes("Llevar propuesta impresa")) v.push(`las notas entraron al nombre accesible: "${trasEdit.aria}"`);
  if (trasEdit.panel) v.push("el panel no se cerro al editar");
  if (!trasEdit.focoEnEl) v.push("editar no dejo el foco en la reunion");
  if (trasEdit.anuncio) v.push(`editar anuncio ademas de re-enfocar: "${trasEdit.anuncio}"`);
  // dia
  if (trasDia2.day !== diaDestino2) v.push(`cambiar el dia no movio la reunion: ${diaIns} -> ${trasDia2.day} (esperado ${diaDestino2})`);
  if (trasDia2.colDia !== diaDestino2) v.push(`la grilla no re-renderizo el evento en la columna ${diaDestino2}: ${trasDia2.colDia}`);
  if (!trasDia2.focoEnEl) v.push("cambiar el dia no dejo el foco en la reunion movida");
  if (trasDia2.anuncio) v.push(`cambiar el dia anuncio ademas de re-enfocar: "${trasDia2.anuncio}"`);
  if (!trasDiaLista.existe) v.push("la Lista no re-renderizo el evento movido");
  else if (trasDiaLista.seccion !== diaDestino2) v.push(`la Lista dejo el evento en la seccion ${trasDiaLista.seccion} (esperado ${diaDestino2})`);
  // crear
  const o = creadoCompleto.objeto;
  if (!o) v.push("crear con todos los campos no agrego el evento");
  else {
    if (o.day !== 3) v.push(`crear: day ${o.day} (esperado 3)`);
    if (o.min !== 14 * 60 + 15) v.push(`crear: min ${o.min} (esperado 855)`);
    if (o.dur !== 60) v.push(`crear: dur ${o.dur} (esperado 60)`);
    if (o.title !== "Reunión completa") v.push(`crear: title "${o.title}"`);
    if (o.cat !== "software") v.push(`crear: cat ${o.cat} (esperado software)`);
    if (o.notes !== "Notas de la reunión") v.push(`crear: notes "${o.notes}"`);
    if (o.origin !== "CRM" || o.sync !== "ok") v.push(`crear: origin/sync ${o.origin}/${o.sync}`);
    if (JSON.stringify(creadoCompleto.claves) !== JSON.stringify(creadoCompleto.clavesRef)) v.push(`crear: forma ${JSON.stringify(creadoCompleto.claves)} != existente ${JSON.stringify(creadoCompleto.clavesRef)}`);
  }
  if (creadoCompleto.panel) v.push("crear no cerro el panel");
  if (!creadoCompleto.focoEnEl) v.push("crear no dejo el foco en la reunion nueva");
  if (creadoCompleto.anuncio) v.push(`crear anuncio ademas de re-enfocar: "${creadoCompleto.anuncio}"`);
  const mejorContraste = Math.min(...[campos.contrasteCat, campos.contrasteDia, campos.contrasteNotas].map((r) => r ?? 99));
  console.log((v.length ? "  ✗ " : "  ✓ ") + `A11 panel completo · campos agenda/día/notas ${campos.hayCat && campos.hayDia && campos.hayNotas} labels ${campos.labelCat && campos.labelDia && campos.labelNotas} ≥24px ${campos.tamano} contraste ${mejorContraste}:1 · cat ${antesEdit.cat}→${trasEdit.cat} color ${trasEdit.color === trasEdit.colorEsperado} nombre trae "${trasEdit.label}" ${trasEdit.aria.includes(trasEdit.label)} · notas persistidas ${trasEdit.notes === "Llevar propuesta impresa"} fuera del nombre ${!trasEdit.aria.includes("Llevar propuesta impresa")} · día ${diaIns}→${trasDia2.day} grilla col ${trasDia2.colDia} Lista sección ${trasDiaLista.seccion} foco ${trasDia2.focoEnEl} · crear ${JSON.stringify(creadoCompleto.objeto)} forma ${JSON.stringify(creadoCompleto.claves) === JSON.stringify(creadoCompleto.clavesRef)} foco ${creadoCompleto.focoEnEl}`);
  if (v.length) console.log("    violaciones: " + v.join(" | "));
}
await browser.close();
