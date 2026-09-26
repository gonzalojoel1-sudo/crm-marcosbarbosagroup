import { expect, test } from "@playwright/test";
import { FIXTURE_TAREAS, VIEWS, loadApp, type ViewCase } from "./helpers/visual";

/**
 * Regresión de la agenda: el contenido de la vista conserva el ANCHO.
 *
 * 2026-09-25 (750b144). En producción el encabezado decía "8 reuniones" y la barra
 * lateral contaba 8, pero la grilla se veía vacía. Los 8 botones de evento estaban
 * en el DOM desde el principio: se renderizaban con 0 px de ancho.
 *
 * Causa: `WeekView` devolvía un FRAGMENTO con hasta cuatro hijos (banda de todo el
 * día, banda de tareas, grilla, etiqueta de arrastre) y todos se volvían hijos
 * directos de `.agx-content`, que es `display:flex; flex-direction:row` porque ahí
 * convive la vista con el `EventPanel` lateral. Con tareas en la semana, la banda
 * de tareas (`flex:none`, pistas `52px repeat(7,1fr)`) medía 2322 px de ancho
 * intrínseco, se comía la fila y la grilla (`flex:1`, base 0) quedaba en 0 px de
 * ancho y 774 px de alto: un rectángulo vacío.
 *
 * Por qué la suite visual no lo veía: el fixture por defecto tiene `tasks: []` y
 * ningún evento `all_day`, o sea que el fragmento aporta un solo hijo, la grilla,
 * que sí llena la fila. La comparación contra el golden del prototipo (que no tiene
 * banda de tareas) daba 0 píxeles de diferencia con la app rota.
 *
 * ── Por qué estos tests miden geometría y no píxeles ────────────────────────
 *
 * El ancho de la grilla no depende del golden, y por eso atrapan el bug aunque el
 * golden no cambie. Y valen para CUALQUIER ventana: no dependen del alto de hora,
 * que sí es derivado (ver `agenda.fidelity.spec.ts`).
 *
 * ── Por qué las TRES vistas ─────────────────────────────────────────────────
 *
 * El bug estaba en la semana, pero la causa es la regla que comparten las tres
 * vistas — `.agx-content` es `display:flex; flex-direction:row` porque ahí convive
 * el `EventPanel`—. El mismo colapso de flex en lista o mes pasaba inadvertido: sólo
 * se miraba la semanal. Y el fixture con tareas y con un `all_day` es el que
 * reproduce la condición; por eso los tests corren sobre las tres.
 */

/** La caja de la vista, que es lo que no puede colapsar. */
const CAJA_VISTA: Record<ViewCase["id"], string> = {
  semana: ".agx-gridwrap",
  lista: ".agx-lista",
  mes: ".agx-meswrap",
};

/** Los bloques con hora, que son los que se veían "vacíos". */
const BLOQUES: Record<ViewCase["id"], string> = {
  semana: ".agx-gridwrap .agx-ev",
  lista: ".agx-lista .agx-lev",
  mes: ".agx-meswrap .agx-mev",
};

test.describe("el contenido de la vista conserva el ancho", () => {
  for (const view of VIEWS) {
    test(`con tareas y un evento de todo el día · ${view.id}`, async ({ page }, testInfo) => {
      await loadApp(page, testInfo, view, FIXTURE_TAREAS);

      const caja = page.locator(CAJA_VISTA[view.id]);
      await expect(caja, `la vista ${view.id} no está en el DOM`).toBeVisible();
      const ancho = await caja.evaluate((el) => el.clientWidth);
      expect(ancho, `la vista ${view.id} no puede medir 0 px de ancho`).toBeGreaterThan(400);

      // El contenido tiene que CABER en la vista: si un hijo se pasa, lo que se
      // ve es una barra horizontal y la vista útil se estrecha sola.
      const desborde = await caja.evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      expect(
        desborde,
        `la vista ${view.id} desborda su propia caja: scrollWidth - clientWidth = ${desborde}`,
      ).toBeLessThanOrEqual(1);

      // Y cada bloque de reunión tiene ancho y alto: es lo que se ve "vacío" sin
      // ellos. En el mes el chip es de alto fijo; en lista y semana, derivado.
      const bloques = page.locator(BLOQUES[view.id]);
      const total = await bloques.count();
      expect(total, "el fixture tiene reuniones que dibujar").toBeGreaterThan(0);
      const medidas = await bloques.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        }),
      );
      for (const [i, m] of medidas.entries()) {
        expect(m.w, `el bloque ${i} de ${view.id} tiene 0 px de ancho: no se ve`).toBeGreaterThan(20);
        expect(m.h, `el bloque ${i} de ${view.id} tiene 0 px de alto: no se ve`).toBeGreaterThan(10);
      }
    });
  }
});

test.describe("la banda de tareas se apila sobre la grilla, no al lado", () => {
  // Sólo la semanal tiene banda de tareas: lista las muestra dentro del día y el
  // mes no las tiene. El bug original era de la banda, así que el test es de la
  // semana; la abrangencia por vista la cubre el de arriba.
  test("con tareas y un evento de todo el día en la semana", async ({ page }, testInfo) => {
    await loadApp(page, testInfo, { id: "semana", name: "agenda-semana.png" }, FIXTURE_TAREAS);

    const banda = page.locator(".agx-tasks");
    await expect(banda).toBeVisible();
    const caja = await page.evaluate(() => {
      const b = document.querySelector(".agx-tasks")!.getBoundingClientRect();
      const g = document.querySelector(".agx-gridwrap")!.getBoundingClientRect();
      return { bBottom: b.bottom, bTop: b.top, gTop: g.top, bLeft: b.left, gLeft: g.left };
    });

    // Apiladas: la banda termina donde empieza la grilla (misma columna).
    expect(caja.bLeft).toBeCloseTo(caja.gLeft, 0);
    expect(caja.bBottom).toBeLessThanOrEqual(caja.gTop + 1);
  });

  test("la banda no es más ancha que la grilla", async ({ page }, testInfo) => {
    await loadApp(page, testInfo, { id: "semana", name: "agenda-semana.png" }, FIXTURE_TAREAS);
    const anchoBanda = await page.locator(".agx-tasks").evaluate((el) => el.clientWidth);
    const anchoGrilla = await page.locator(".agx-gridwrap").evaluate((el) => el.clientWidth);
    expect(anchoBanda, "la banda de tareas se pasa del ancho de la grilla").toBeLessThanOrEqual(
      anchoGrilla + 1,
    );
  });
});

test.describe("el fixture que reproduce la regresión la tiene toda vista", () => {
  // Si el fixture dejara de tener tareas o el `all_day`, los tests de arriba
  // pasarían sin estar probando nada: es el mismo modo de falla que el del glob
  // vacío en `test_doctypes_offline.py`.
  //
  // El MES no muestra tareas, y no es un agujero del fixture: el prototipo no las
  // tiene en la vista mes (`renderMonth` no las consulta, `index.html:847`), y el
  // fixture de tareas existe para reproducir el bug de la banda, que es de la
  // semana. Que el mes NO las muestre es parte del contrato con el diseño, así que
  // se afirma en vez de dejarlo sin verificar.
  for (const view of VIEWS) {
    test(`· ${view.id}`, async ({ page }, testInfo) => {
      await loadApp(page, testInfo, view, FIXTURE_TAREAS);
      // La banda de la semana usa `.agx-task`; la lista las muestra por día con
      // `.agx-ltasks`. Son dosUCTURETuras distintas y el fixture tiene que alimentar
      // las dos.
      const tareas = await page
        .locator(view.id === "semana" ? ".agx-task" : ".agx-ltasks")
        .count();
      if (view.id === "mes") {
        expect(tareas, "el mes no muestra tareas, como el prototipo").toBe(0);
      } else {
        expect(
          tareas,
          "el fixture tiene que traer tareas: sin ellas no hay banda y el test no prueba nada",
        ).toBeGreaterThan(0);
      }
      if (view.id === "semana") {
        await expect(
          page.locator(".agx-allday"),
          "la banda de todo el día tiene que estar: es el otro hijo del fragmento",
        ).toBeVisible();
      }
      // El `all_day` se dibuja distinto en cada vista (banda arriba, texto "Todo el
      // día" en lista y mes), así que no hay un selector común: donde el prototipo
      // lo escribe literalmente se verifica el texto.
      if (view.id === "lista" || view.id === "mes") {
        await expect(
          page.getByText("Todo el día").first(),
          `el evento de todo el día tiene que rotular en ${view.id}`,
        ).toBeVisible();
      }
    });
  }
});
