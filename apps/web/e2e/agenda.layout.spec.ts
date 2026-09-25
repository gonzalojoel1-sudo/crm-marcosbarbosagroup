import { expect, test } from "@playwright/test";
import { loadApp } from "./helpers/visual";

/**
 * Regresión de la agenda: la grilla semanal tiene ANCHO.
 *
 * 2026-09-25. En producción el encabezado decía "8 reuniones" y la barra lateral
 * contaba 8, pero la grilla se veía vacía. Los 8 botones de evento estaban en el
 * DOM desde el principio: se renderizaban con 0 px de ancho.
 *
 * Causa: `WeekView` devolvía un FRAGMENTO con hasta cuatro hijos (banda de todo
 * el día, banda de tareas, grilla, etiqueta de arrastre) y todos se volvían
 * hijos directos de `.agx-content`, que es `display:flex; flex-direction:row`
 * porque ahí convive la vista con el `EventPanel` lateral. Con tareas en la
 * semana, la banda de tareas (`flex:none`, pistas `52px repeat(7,1fr)`) medía
 * 2322 px de ancho intrínseco, se comía la fila y la grilla (`flex:1`, base 0)
 * quedaba en 0 px de ancho y 774 px de alto: un rectángulo vacío.
 *
 * Por qué la suite visual no lo veía: el fixture por defecto tiene `tasks: []` y
 * ningún evento `all_day`, o sea que el fragmento aporta un solo hijo, la grilla,
 * que sí llena la fila. La comparación contra el golden del prototipo (que no
 * tiene banda de tareas) daba 0 píxeles de diferencia con la app rota.
 *
 * Estos tests miden geometría, no píxeles: el ancho de la grilla no depende del
 * golden y por eso atrapan el bug aunque el golden no cambie.
 */
const FIXTURE_CON_TAREAS = "apps/web/e2e/fixtures/agenda-tareas.json";

test.describe("la grilla semanal conserva el ancho", () => {
  test("con tareas y un evento de todo el día en la semana", async ({ page }, testInfo) => {
    await loadApp(page, testInfo, { id: "semana", name: "agenda-semana.png" }, FIXTURE_CON_TAREAS);

    const wrap = page.locator(".agx-gridwrap");
    const evs = page.locator(".agx-ev");

    // La grilla tiene que ocupar el ancho disponible, no colapsar a 0.
    const anchoGrilla = await wrap.evaluate((el) => el.clientWidth);
    expect(anchoGrilla, "la grilla no puede medir 0 px de ancho").toBeGreaterThan(400);

    // La banda de tareas es una banda ARRIBA de la grilla, no al lado: no puede
    // ser más ancha que la grilla ni desbordar el contenido.
    const banda = page.locator(".agx-tasks");
    await expect(banda).toBeVisible();
    const anchoBanda = await banda.evaluate((el) => el.clientWidth);
    expect(anchoBanda, "la banda de tareas se pasa del ancho de la grilla").toBeLessThanOrEqual(
      anchoGrilla + 1,
    );

    // Y cada bloque de reunión tiene ancho y alto: es lo que se ve "vacío" sin él.
    const total = await evs.count();
    expect(total, "el fixture tiene reuniones con hora").toBeGreaterThan(0);
    const medidas = await evs.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    for (const [i, m] of medidas.entries()) {
      expect(m.w, `el bloque ${i} tiene 0 px de ancho: no se ve`).toBeGreaterThan(20);
      expect(m.h, `el bloque ${i} tiene 0 px de alto: no se ve`).toBeGreaterThan(20);
    }
  });

  test("la banda de tareas se apila sobre la grilla, no al lado", async ({ page }, testInfo) => {
    await loadApp(page, testInfo, { id: "semana", name: "agenda-semana.png" }, FIXTURE_CON_TAREAS);

    const caja = await page.evaluate(() => {
      const b = document.querySelector(".agx-tasks")!.getBoundingClientRect();
      const g = document.querySelector(".agx-gridwrap")!.getBoundingClientRect();
      return { bBottom: b.bottom, bTop: b.top, gTop: g.top, bLeft: b.left, gLeft: g.left };
    });

    // Apiladas: la banda termina donde empieza la grilla (misma columna).
    expect(caja.bLeft).toBeCloseTo(caja.gLeft, 0);
    expect(caja.bBottom).toBeLessThanOrEqual(caja.gTop + 1);
  });
});
