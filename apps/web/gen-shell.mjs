// Genera el template Frappe (www/hoy.html) con el bundle embebido como base64.
//
// Por qué base64 y no assets:
//  - Los contenedores no comparten sites/assets (verificado), así que /assets
//    no se puede usar de forma confiable.
//  - Frappe rechaza templates que contengan ".__" ("Illegal template"), y el
//    bundle minificado de React lo contiene. Base64 no tiene "." → pasa.
//  - El bundle se ejecuta vía Blob + import() dinámico (ESM self-contained).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const outFile = resolve(here, "../crm_core/crm_core/www/hoy.html");

const js = readFileSync(resolve(dist, "index.js"), "utf8");
const css = readFileSync(resolve(dist, "index.css"), "utf8");
const b64 = Buffer.from(js, "utf8").toString("base64");

const shell = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Hoy · MB CRM</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.CSRF = "{{ csrf }}";</script>
<script>
(function () {
  var code = atob("${b64}");
  var blob = new Blob([code], { type: "text/javascript" });
  import(URL.createObjectURL(blob));
})();
</script>
</body>
</html>
`;

if (shell.includes(".__")) {
  throw new Error("template contains '.__' -> Frappe would reject it as Illegal template");
}

writeFileSync(outFile, shell);
console.log(`wrote ${outFile} (${shell.length} bytes)`);
