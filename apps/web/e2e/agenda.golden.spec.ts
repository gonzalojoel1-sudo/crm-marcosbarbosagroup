import { expect, test } from "@playwright/test";
import { VIEWS, loadPrototype } from "./helpers/visual";

/**
 * La GOLDEN sale del prototipo, no de la app: es el diseño aprobado (D3).
 *
 * Dos Cosas se congelan acá:
 *
 *  - La PÁGINA ENTERA de cada vista. Es la autoridad del diseño y se captura sin
 *    neutralizar nada: si el prototipo cambia, esto tiene que cambiar.
 *  - Por REGIÓN, las partes que la agenda no puede comparar en una sola pieza. Hoy
 *    son las de la vista semanal (la barra, la sidebar y el encabezado de días): su
 *    alto de hora se deriva del alto de la ventana y el prototipo captura una geometría
 *    VIEJA (su caché `LAST_FIT` no se invalida al redimensionar), así que la
 *    página entera de la semana no es comparable píxel a píxel. La razón está
 *    escrita entera en `agenda.visual.spec.ts`.
 *
 * Correr con `npm --prefix apps/web run fidelity:visual:golden` (--update-snapshots
 * sobre ESTE archivo). No se corre junto al spec de la app porque ambos escriben las
 * mismas baselines compartidas y la app las pisaría.
 */

/** Las regiones por vista. Deben calzar con las de `agenda.visual.spec.ts`. */
const REGIONES: Record<string, Array<{ nombre: string; sel: string; recorteInfPx?: number }>> = {
  semana: [
    { nombre: "agenda-semana-barra.png", sel: ".topbar" },
    { nombre: "agenda-semana-side.png", sel: ".side" },
    // Sin los 2 px de abajo: son la costura con el contenido scrolleable, que en el
    // prototipo depende del `LAST_FIT` cacheado (ver `agenda.visual.spec.ts`).
    { nombre: "agenda-semana-heads.png", sel: ".heads", recorteInfPx: 2 },
  ],
  lista: [],
  mes: [],
};

test.describe("golden del prototipo (autoridad del diseno)", () => {
  for (const view of VIEWS) {
    test(`golden · ${view.id}`, async ({ page }, testInfo) => {
      await loadPrototype(page, testInfo, view);
      await expect(page).toHaveScreenshot(view.name);
    });
  }

  for (const view of VIEWS) {
    for (const r of REGIONES[view.id]) {
      test(`golden · ${view.id} · ${r.nombre}`, async ({ page }, testInfo) => {
        await loadPrototype(page, testInfo, view);
        const el = page.locator(r.sel);
        expect(await el.count(), `el prototipo no tiene "${r.sel}"`).toBe(1);
        const caja = await el.boundingBox();
        if (!caja) throw new Error(`"${r.sel}" no tiene caja`);
        await expect(page).toHaveScreenshot(r.nombre, {
          clip: {
            x: caja.x,
            y: caja.y,
            width: caja.width,
            height: caja.height - (r.recorteInfPx ?? 0),
          },
        });
      });
    }
  }
});
