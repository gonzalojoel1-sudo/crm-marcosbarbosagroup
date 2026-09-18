import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built assets are served by Frappe from
// apps/crm_core/crm_core/public/web  ->  /assets/crm_core/web/
export default defineConfig({
  base: "/assets/crm_core/web/",
  plugins: [react()],
  build: {
    outDir: "dist",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "[name].js",
        assetFileNames: "index.[ext]",
      },
    },
  },
  css: {
    modules: {
      // Se conservan los nombres `agx-*` SIN hashear: la guarda de fidelidad y los
      // E2E consultan esas clases semánticas. OJO: por eso esto NO encapsula — una
      // regla global `.agx-*` igual matchea el elemento; `[data-agenda]` solo le
      // sube la especificidad a las reglas de la agenda. La garantía real es que
      // `styles.css` no tenga reglas `.agx` (la verifica check-agenda-fidelity.mjs).
      generateScopedName: "[local]",
      localsConvention: "dashes",
    },
  },
});
