// Genera el template Frappe (www/hoy.html) con el JS y el CSS inline.
//
// Por qué inline y no assets:
//  - Los contenedores no comparten sites/assets (verificado), así que /assets
//    no se puede usar de forma confiable: el HTML tiene que ser un archivo
//    único y autocontenido.
//  - Antes el bundle iba en base64 para esquivar el guard de Frappe contra
//    ".__" ("Illegal template"). Ese guard se apaga con `safe_render = False`
//    en www/hoy.py, así que el bundle puede ir crudo.
//  - El template igual pasa por Jinja antes de servirse (hay un `{{ csrf }}`),
//    así que el bundle no puede contener sintaxis de Jinja ni cierres de tag.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const outFile = resolve(here, "../crm_core/crm_core/www/hoy.html");

const js = readFileSync(resolve(dist, "index.js"), "utf8");
const css = readFileSync(resolve(dist, "index.css"), "utf8");

// Fallar en el build es mejor que romper la página en runtime: Jinja
// interpretaría {{ / {% / {# y un cierre de tag terminaría el bloque antes.
for (const seq of ["{{", "{%", "{#"]) {
  if (js.includes(seq) || css.includes(seq)) {
    throw new Error(`el bundle contiene sintaxis Jinja (${seq})`);
  }
}
if (js.includes("</script")) {
  throw new Error("el bundle contiene '</script'");
}
if (css.includes("</style")) {
  throw new Error("el CSS contiene '</style'");
}

const shell = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>CRM · Marcos Barbosa Group</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.CSRF = "{{ csrf }}";</script>
<script type="module">${js}</script>
</body>
</html>
`;

writeFileSync(outFile, shell);
console.log(`wrote ${outFile} (${shell.length} bytes)`);
