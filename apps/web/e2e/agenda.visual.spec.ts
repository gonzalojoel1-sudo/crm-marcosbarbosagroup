import { expect, test } from "@playwright/test";
import { VIEWS, loadApp } from "./helpers/visual";

// La app (built, servida local) contra la golden del prototipo. Si difiere, ESE
// es el hallazgo: se reportan los píxeles, no se sube la tolerancia.
// Requiere la baseline: `npm run fidelity:visual:golden` una vez.
test.describe("la app contra la golden del prototipo", () => {
  for (const view of VIEWS) {
    test(`app · ${view.id}`, async ({ page }, testInfo) => {
      await loadApp(page, testInfo, view);
      await expect(page).toHaveScreenshot(view.name);
    });
  }
});
