// Genera el template Frappe (www/hoy.html) con el CSS y el JS inline.
// Así la página es auto-contenida y no depende de /assets (que no se sirve).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const outFile = resolve(here, "../crm_core/crm_core/www/hoy.html");

let js = readFileSync(resolve(dist, "index.js"), "utf8");
const css = readFileSync(resolve(dist, "index.css"), "utf8");

// Evita romper el <script> inline si el bundle trae "</script>".
js = js.replace(/<\/script>/g, "<\\/script>");

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
  <script>window.__CSRF__ = "{{ csrf }}";</script>
  <script type="module">{% raw %}${js}{% endraw %}</script>
</body>
</html>
`;

writeFileSync(outFile, shell);
console.log(`wrote ${outFile} (${shell.length} bytes)`);
