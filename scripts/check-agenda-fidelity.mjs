// Guarda de fidelidad del diseño del /hoy contra el prototipo aprobado.
//
// Falla (exit 1) por lo que ya se rompió una vez:
//   (a) los tokens derivaron del prototipo  -> los re-extrae el propio extractor
//   (b) las fuentes de marca no se cargan    -> ESTA es la aserción que caza el
//       fallo real: mira el <link> del shell. `getComputedStyle` devuelve la
//       familia PEDIDA aunque la cara nunca se descargue, y `document.fonts.check`
//       da true cuando la familia NO está declarada; por eso (b) es la que manda.
//   (c) una categoria se re-derivo           -> el color tiene que aparecer byte por byte
//   (d) la fuente DECLARADA pero no descargada -> cubre ese caso; necesita Chromium
//       y red (fonts.googleapis.com), así que NO corre en cada build
//   (e) el CSS global volvió a tener reglas .agx -> el scope `[data-agenda]` NO
//       encapsula (una regla global `.agx-*` igual matchea): la garantía real de
//       D2 es que `styles.css` no defina nada de la agenda
//   (f) un archivo de la agenda importó `styles.css` (el CSS global)
//
// `--static` corre (a)(b)(c)(e)(f) sin navegador: es lo que invocan el build y el
// lint, así una fuga estructural falla en CI. El modo completo (con (d)) se corre
// a demanda con `npm run fidelity`.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Rutas relativas a la RAÍZ del repo, no al cwd: el build corre desde apps/web.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const ESTATICO = process.argv.includes("--static");

let fallos = 0;
// Todo por el mismo stream para que el orden de las secciones se vea bien al pipear.
const log = (s) => process.stdout.write(s + "\n");
const mal = (msg) => {
  log("  ✗ " + msg);
  fallos++;
};
const bien = (msg) => log("  ✓ " + msg);
const seccion = (t) => log(`\n${t}`);

// (a) los tokens tienen que estar al dia contra el prototipo.
seccion("(a) tokens contra el prototipo");
try {
  execFileSync(process.execPath, ["scripts/extract-agenda-tokens.mjs", "--check"], { stdio: "pipe" });
  bien("los tokens de tokens.css salen del prototipo");
} catch (e) {
  const detalle = ((e.stdout?.toString() || "") + (e.stderr?.toString() || "")).trim() || e.message;
  mal("los tokens derivaron del prototipo:\n" + detalle.split("\n").map((l) => "      " + l).join("\n"));
}

// (b) las fuentes de marca tienen que estar DECLARADAS en el shell. Esta es la
// aserción load-bearing: el fallo que ocurrió fue que el shell nunca cargaba las
// fuentes y todo caía a Outfit / a la mono del sistema, sin ningún aviso. (d)
// cubre el caso más finito de "declarada pero nunca descargada".
seccion("(b) las fuentes de marca");
let app = "";
try {
  app = readFileSync("apps/web/src/agenda/tokens.css", "utf8");
} catch {
  mal("no existe apps/web/src/agenda/tokens.css: correr `node scripts/extract-agenda-tokens.mjs`");
}
if (app) {
  for (const [rol, familia] of [["--display", "Fraunces"], ["--mono", "JetBrains Mono"]]) {
    if (!new RegExp(`${rol}\\s*:[^;]*${familia}`, "i").test(app)) mal(`${rol} no apunta a ${familia} en tokens.css`);
    else bien(`${rol} -> ${familia}`);
  }
  const pilaMono = /--mono\s*:\s*([^;]+);/.exec(app)?.[1]?.trim() || "";
  if (!/^"?JetBrains Mono/.test(pilaMono))
    mal(`--mono empieza con "${pilaMono}" — "JetBrains Mono" tiene que ir PRIMERO o el shell no la usa`);
  else bien('--mono lista "JetBrains Mono" primero');
}
// Se mira el <link> real a Google Fonts, no un `includes` que tambien matchea un
// comentario. Y se verifica el shell GENERADO, no solo el script que lo produce:
// si no, el artefacto commiteado puede quedar viejo y la guarda seguir verde.
const requeridas = [
  { nombre: "Fraunces", re: /family=Fraunces[:&]/ },
  { nombre: "JetBrains Mono", re: /family=JetBrains\+Mono[:&]/ },
];
for (const [archivo, etiqueta] of [
  ["apps/web/gen-shell.mjs", "el shell"],
  ["apps/web/index.html", "el dev server"],
  ["apps/crm_core/crm_core/www/hoy.html", "el shell generado"],
]) {
  let txt = "";
  try {
    txt = readFileSync(archivo, "utf8");
  } catch {
    mal(`no puedo leer ${archivo}`);
    continue;
  }
  const hrefs = [...txt.matchAll(/<link[^>]+href="([^"]*fonts\.googleapis\.com[^"]*)"/g)].map((m) => m[1]);
  if (!hrefs.length) {
    mal(`${etiqueta} (${archivo}) no tiene ningun <link> a Google Fonts`);
    continue;
  }
  for (const { nombre, re } of requeridas) {
    if (!hrefs.some((h) => re.test(h))) mal(`${etiqueta} (${archivo}) no carga ${nombre} — fallback silencioso`);
    else bien(`${etiqueta} carga ${nombre}`);
  }
}

// (c) la paleta de categorias, byte por byte contra el CATS del prototipo.
seccion("(c) la paleta de categorias");
const PROTOTIPO = "prototypes/agenda/index.html";
const CATS_TS = "apps/web/src/agenda/categories.ts";
const leerTexto = (ruta) => {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    mal(`no puedo leer ${ruta}`);
    return null;
  }
};
// Matching de llaves: una categoria nueva no puede quedar afuera del bloque.
function bloqueDeMapa(texto, nombre) {
  const m = new RegExp(`const\\s+${nombre}\\b[^=]*=\\s*\\{`).exec(texto);
  if (!m) return null;
  let i = m.index + m[0].length;
  const desde = i;
  let nivel = 1;
  while (i < texto.length && nivel > 0) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}") nivel--;
    i++;
  }
  return texto.slice(desde, i - 1);
}
const proto = leerTexto(PROTOTIPO);
const cats = leerTexto(CATS_TS);
const bloqueProto = proto ? /const\s+CATS\s*=\s*\{([\s\S]*?)\};/.exec(proto)?.[1] : null;
const bloqueCats = cats ? bloqueDeMapa(cats, "CATEGORIES") : null;
if (proto && !bloqueProto) mal(`no encontre el CATS en ${PROTOTIPO}: no puedo verificar la paleta`);
if (cats && !bloqueCats) mal(`no encontre el CATEGORIES en ${CATS_TS}: no puedo verificar la paleta`);
const coloresProto = bloqueProto ? [...bloqueProto.matchAll(/color:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
// TODA categoria, en cualquier formato (oklch, hex, rgb, var…): mirar solo
// `oklch(...)` era la verificacion vacia que dejaba pasar un color re-derivado.
const coloresCats = bloqueCats ? [...bloqueCats.matchAll(/color:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
if (bloqueProto && !coloresProto.length) mal(`el CATS de ${PROTOTIPO} no tiene colores: la verificacion quedaria vacia`);
if (bloqueCats && !coloresCats.length) mal(`el CATEGORIES de ${CATS_TS} no tiene colores: la verificacion quedaria vacia`);
const reDerivados = coloresCats.filter((c) => !coloresProto.includes(c));
const perdidos = coloresProto.filter((c) => !coloresCats.includes(c));
for (const c of reDerivados)
  mal(
    `categoria re-derivada: "${c}" no esta en el CATS de ${PROTOTIPO}. ` +
      `El color tiene que salir de ahi byte por byte (no se re-deriva a mano).`,
  );
for (const c of perdidos) mal(`el prototipo define "${c}" y ${CATS_TS} no lo tiene: copiarlo tal cual`);
if (coloresProto.length && !reDerivados.length && !perdidos.length)
  bien(`las ${coloresProto.length} categorias coinciden byte por byte con el prototipo`);

// (d) las fuentes de marca, COMPUTADAS en un navegador contra el shell construido.
// `getComputedStyle` devuelve la familia PEDIDA aunque la cara nunca se descargue,
// y `document.fonts.check` da true si la familia ni siquiera está declarada: por
// eso (d) NO prueba por sí solo el fallback (eso lo hace (b)). Cubre el caso más
// finito: "declarada pero nunca descargada". Necesita Chromium + red; --static lo saltea.
if (!ESTATICO) {
seccion("(d) las fuentes computadas en el navegador");
const SHELL = "apps/crm_core/crm_core/www/hoy.html";
try {
  const html = readFileSync(SHELL, "utf8");
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("no puedo importar playwright (hace falta `npm i playwright`)");
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".agx-title", { timeout: 15000 });
    await page.waitForSelector(".agx-hourlab", { timeout: 15000 });
    // El swap de fuentes termina cuando document.fonts.ready resuelve.
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const obs = await page.evaluate(() => {
      const titulo = document.querySelector(".agx-title");
      const hora = document.querySelector(".agx-hourlab");
      return {
        tituloFam: titulo ? getComputedStyle(titulo).fontFamily : null,
        horaFam: hora ? getComputedStyle(hora).fontFamily : null,
        okTitulo: document.fonts.check("400 23px Fraunces"),
        okMono: document.fonts.check("400 11px 'JetBrains Mono'"),
      };
    });
    log(`      título computa: ${obs.tituloFam}`);
    log(`      hora computa:   ${obs.horaFam}`);
    log(`      fonts.check("400 23px Fraunces"): ${obs.okTitulo}`);
    log(`      fonts.check("400 11px 'JetBrains Mono'"): ${obs.okMono}`);
    if (!obs.tituloFam || !/Fraunces/i.test(obs.tituloFam))
      mal(`el título NO computa Fraunces (computa: ${obs.tituloFam ?? "sin .agx-title"})`);
    else bien("el título computa Fraunces");
    if (!obs.horaFam || !/JetBrains Mono/i.test(obs.horaFam))
      mal(`la hora NO computa JetBrains Mono (computa: ${obs.horaFam ?? "sin .agx-hourlab"})`);
    else bien("la hora computa JetBrains Mono");
    if (obs.okTitulo !== true)
      mal('document.fonts.check("400 23px Fraunces") dio false: Fraunces NO está disponible');
    else bien("Fraunces está realmente cargada (fonts.check)");
    if (obs.okMono !== true)
      mal("document.fonts.check(\"400 11px 'JetBrains Mono'\") dio false: JetBrains Mono NO está disponible");
    else bien("JetBrains Mono está realmente cargada (fonts.check)");
  } finally {
    await browser.close();
  }
} catch (e) {
  mal(
    "no pude medir las fuentes computadas:\n" +
      String(e.message || e)
        .split("\n")
        .map((l) => "      " + l)
        .join("\n"),
  );
}
}

// (e) el stylesheet global NO puede volver a definir la agenda. Esta es la
// garantía REAL de D2: `[data-agenda]` sube especificidad, pero no encapsula; lo
// que protege es que `styles.css` no tenga reglas de la agenda.
seccion("(e) el CSS global no tiene reglas de la agenda");
try {
  const css = readFileSync("apps/web/src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const reglas = [...css.matchAll(/\.agx[\w-]*/g)].map((m) => m[0]);
  if (reglas.length)
    mal(
      `styles.css define ${reglas.length} selector(es) de la agenda (${[...new Set(reglas)].join(", ")}). ` +
        `Los estilos van en apps/web/src/agenda/*.module.css con scope [data-agenda].`,
    );
  else bien("styles.css no define ningún selector .agx");
} catch {
  mal("no puedo leer apps/web/src/styles.css");
}

// (f) ningún archivo de la agenda importa el stylesheet global.
seccion("(f) ningún archivo de la agenda importa el CSS global");
try {
  const DIR = "apps/web/src/agenda";
  // Sin comentarios: acá sí se puede nombrar `styles.css` para explicar por qué no
  // se lo importa. Lo que no se permite es un import real.
  const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const archivos = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(?:tsx?|css)$/.test(d.name))
    .map((d) => `${DIR}/${d.name}`);
  const culpables = archivos.filter((f) => /styles\.css/.test(sinComentarios(readFileSync(f, "utf8"))));
  if (culpables.length) mal(`${culpables.join(", ")} importa(n) styles.css (el CSS global)`);
  else bien(`los ${archivos.length} archivos de la agenda no importan styles.css`);
} catch (e) {
  mal("no pude revisar apps/web/src/agenda: " + e.message);
}

log(
  fallos
    ? `\nFIDELIDAD: ${fallos} problema(s). Corregir lo marcado ✗ y volver a correr.`
    : `\nFIDELIDAD: OK${ESTATICO ? " (estático)" : ""}`,
);
process.exit(fallos ? 1 : 0);
