// El `:root` del prototipo es la fuente; tokens.css es la copia.
//
// Por qué un script y no copiar a mano: mientras los valores se puedan re-escribir
// a mano, van a volver a derivar (fue exactamente el error del port). El prototipo
// tiene DOS bloques `:root` (el segundo define --focus) y las familias --display /
// --mono viven en un bloque `body`, no en `:root`: hay que juntar los tres lados.
import { readFileSync, writeFileSync } from "node:fs";

const PROTO = "prototypes/agenda/index.html";
const SALIDA = "apps/web/src/agenda/tokens.css";

const cabecera = `/* GENERADO — NO EDITAR A MANO.
   Lo escribe scripts/extract-agenda-tokens.mjs a partir de prototypes/agenda/index.html.
   Si falta un valor, se agrega ALLI (al prototipo) y se vuelve a correr el script. */
`;

// Saca el contenido del <style> para no confundir un `:root` que aparezca en el JS.
function extraerEstilo(html) {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  if (!m) {
    console.error(`no encontre <style> en ${PROTO}`);
    process.exit(1);
  }
  // Los comentarios se ignoran: un `:root` comentado no es una fuente de tokens.
  return m[1].replace(/\/\*[\s\S]*?\*\//g, "");
}

// Devuelve el cuerpo interno de cada bloque `selector { ... }`, con matching de
// llaves (no un regex no-greedy: un bloque puede contener llaves en valores o anidar).
function bloquesDe(css, selector) {
  const out = [];
  const re = new RegExp(`(?<![\\w-])${selector}\\s*\\{`, "g");
  let m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length;
    const desde = i;
    let nivel = 1;
    while (i < css.length && nivel > 0) {
      if (css[i] === "{") nivel++;
      else if (css[i] === "}") nivel--;
      i++;
    }
    out.push(css.slice(desde, i - 1));
    re.lastIndex = i;
  }
  return out;
}

// Un valor CSS no lleva `;` sin escapar, asi que este parseo simple es seguro.
function declaraciones(texto) {
  return [...texto.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, nombre, valor]) => ({
    nombre,
    valor: valor.trim(),
  }));
}

// Lista ordenada de tokens: los `:root` (todos) primero, despues las familias del body.
function tokensDelPrototipo(html) {
  const css = extraerEstilo(html);
  const raiz = bloquesDe(css, ":root").flatMap(declaraciones);
  if (!raiz.length) {
    console.error(`no encontre tokens en el :root de ${PROTO}`);
    process.exit(1);
  }
  const cuerpo = bloquesDe(css, "body").flatMap(declaraciones);
  const familias = ["--display", "--mono"]
    .map((nombre) => {
      const token = cuerpo.find((d) => d.nombre === nombre);
      if (!token) console.error(`aviso: el prototipo no define ${nombre} en body`);
      return token;
    })
    .filter(Boolean);

  const vistos = new Set();
  return [...raiz, ...familias].filter((d) => {
    if (vistos.has(d.nombre)) return false;
    vistos.add(d.nombre);
    return true;
  });
}

function construirContenido(tokens) {
  const cuerpo = tokens.map((t) => `  ${t.nombre}: ${t.valor};`).join("\n");
  return `${cabecera}:root {\n${cuerpo}\n}\n`;
}

const normalizar = (v) => v.replace(/\s+/g, " ").trim();
const mapa = (tokens) => new Map(tokens.map((t) => [t.nombre, normalizar(t.valor)]));

function comparar(esperado, actual) {
  const difs = [];
  for (const [nombre, valor] of esperado) {
    if (!actual.has(nombre)) difs.push(`${nombre}: FALTA en tokens.css (el prototipo dice "${valor}")`);
    else if (actual.get(nombre) !== valor)
      difs.push(`${nombre}: tokens.css="${actual.get(nombre)}" ≠ prototipo="${valor}"`);
  }
  for (const [nombre, valor] of actual) {
    if (!esperado.has(nombre)) difs.push(`${nombre}: SOBRA en tokens.css ("${valor}") y no esta en el prototipo`);
  }
  return difs;
}

const html = readFileSync(PROTO, "utf8");
const esperados = tokensDelPrototipo(html);

if (process.argv.includes("--check")) {
  let actualTxt;
  try {
    actualTxt = readFileSync(SALIDA, "utf8");
  } catch {
    console.error(`FALTA ${SALIDA}. Correr: node scripts/extract-agenda-tokens.mjs`);
    process.exit(1);
  }
  // `declaraciones` solo mira `--token: valor;`, asi que sirve igual sobre el CSS generado.
  const difs = comparar(mapa(esperados), mapa(declaraciones(actualTxt)));
  if (difs.length) {
    console.error(`${SALIDA} NO coincide con el prototipo (${difs.length} token/s):`);
    for (const d of difs) console.error(`  - ${d}`);
    console.error("Corregir: node scripts/extract-agenda-tokens.mjs (no editar tokens.css a mano)");
    process.exit(1);
  }
  console.log(`${SALIDA} al dia contra el prototipo`);
  process.exit(0);
}

writeFileSync(SALIDA, construirContenido(esperados));
console.log(`escrito ${SALIDA} (${esperados.length} tokens)`);
