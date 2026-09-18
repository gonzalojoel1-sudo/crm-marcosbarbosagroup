import { expect, test } from "@playwright/test";
import { VIEWS, loadPrototype } from "./helpers/visual";

// La GOLDEN sale del prototipo, no de la app: es el diseño aprobado (D3).
// Correr con `npm run fidelity:visual:golden` (--update-snapshots sobre ESTE
// archivo). No se corre junto al spec de la app porque ambos escriben la misma
// baseline compartida y la app la pisaría.
test.describe("golden del prototipo (autoridad del diseno)", () => {
  for (const view of VIEWS) {
    test(`golden · ${view.id}`, async ({ page }, testInfo) => {
      await loadPrototype(page, testInfo, view);
      await expect(page).toHaveScreenshot(view.name);
    });
  }
});
