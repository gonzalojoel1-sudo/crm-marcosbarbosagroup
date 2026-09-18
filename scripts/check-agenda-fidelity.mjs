// Guarda de fidelidad del diseño del /hoy contra el prototipo aprobado.
//
// Falla (exit 1) por lo que ya se rompió una vez:
//   (a) los tokens derivaron del prototipo  -> los re-extrae el propio extractor
//   (b) las fuentes de marca no se cargan    -> fallback silencioso que ninguna captura ve
//   (c) una categoria se re-derivo           -> el color tiene que aparecer byte por byte
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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

// (b) las fuentes de marca tienen que estar DECLARADAS y cargadas.
// No alcanza con que el CSS las pida: el fallo real fue que el shell nunca las
// cargaba y todo caia a Outfit / a la mono del sistema, sin ningun aviso.
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
for (const [archivo, etiqueta] of [
  ["apps/web/gen-shell.mjs", "el shell"],
  ["apps/web/index.html", "el dev server"],
]) {
  let txt = "";
  try {
    txt = readFileSync(archivo, "utf8");
  } catch {
    mal(`no puedo leer ${archivo}`);
    continue;
  }
  for (const familia of ["Fraunces", "JetBrains+Mono"]) {
    if (!txt.includes(familia)) mal(`${etiqueta} (${archivo}) no carga ${familia} — fallback silencioso`);
    else bien(`${etiqueta} carga ${familia}`);
  }
}

// (c) la paleta de categorias, byte por byte contra el CATS del prototipo.
seccion("(c) la paleta de categorias");
const proto = readFileSync("prototypes/agenda/index.html", "utf8");
const cats = readFileSync("apps/web/src/agenda/categories.ts", "utf8");
const bloqueCats = /const\s+CATS\s*=\s*\{([\s\S]*?)\};/.exec(proto)?.[1] || "";
const coloresProto = [...bloqueCats.matchAll(/color:\s*"([^"]+)"/g)].map((m) => m[1]);
const coloresCats = [...cats.matchAll(/color:\s*"(oklch\([^"]+\))"/g)].map((m) => m[1]);
const reDerivados = coloresCats.filter((c) => !coloresProto.includes(c));
const perdidos = coloresProto.filter((c) => !coloresCats.includes(c));
if (reDerivados.length) mal(`categorias re-derivadas (no estan en el CATS del prototipo): ${reDerivados.join(", ")}`);
if (perdidos.length) mal(`categorias del prototipo que faltan en categories.ts: ${perdidos.join(", ")}`);
if (!reDerivados.length && !perdidos.length)
  bien(`las ${coloresProto.length} categorias coinciden byte por byte con el prototipo`);

log(fallos ? `\nFIDELIDAD: ${fallos} problema(s). Corregir lo marcado ✗ y volver a correr.` : "\nFIDELIDAD: OK");
process.exit(fallos ? 1 : 0);
