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
});
