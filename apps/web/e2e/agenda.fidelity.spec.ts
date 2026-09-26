import { expect, test } from "@playwright/test";
import {
  CONTENIDO_POR_VISTA,
  VIEWS,
  ZOOM_AMPLIO,
  assertSinMetodosDesconocidos,
  loadApp,
  loadPrototype,
  medirAltoHora,
  medirBloques,
  medirConteo,
  medirFondoRaiz,
  medirGeometria,
} from "./helpers/visual";

/**
 * Fidelidad de la agenda, medida y con nombre.
 *
 * Por qué hay tres specs de fidelidad y no uno:
 *
 *  - `agenda.golden.spec.ts` congela el DISEÑO: captura el prototipo. Detecta que
 *    el prototipo cambió.
 *  - `agenda.visual.spec.ts` compara la app contra ese golden píxel a píxel. Detecta
 *    que la app se alejó, pero sólo puede decir un NÚMERO ("28.914 píxeles").
 *  - ESTE mide las mismas dos páginas con nombre. Cuando la barra se baja 2 px, dice
 *    "barra"; cuando el token `--bg` no se aplica, dice "--bg".
 *
 * La razón de que este exista: el golden de la app NUNCA dio verde. Se regeneró
 * DESPUÉS de que la app tuviera el pager (que el prototipo no tiene), así que el
 * baseline incluía algo que la autoridad del diseño no tiene, y la comparación no
 * podía pasar ni una vez. Un gate que no puede pasar deja de leerse, y mientras
 * nadie lo leía entraron bugs de verdad: el token `--bg` declarado y nunca
 * aplicado, y el "· N sin sincronizar" que el comentario de Agenda.tsx describía y
 * el código no implementaba.
 *
 * Tolerancia: se comparan longitudes con una tolerancia EXPRESA en píxeles
 * (`TOLERANCIA_PX`) y no con `toBeCloseTo`, que redondea a decimales y hacía
 * creer que la tolerancia era 0.5 px cuando el assert era 0.05. 0.5 px es
 * sub-perceptual a `deviceScaleFactor: 2` y NO esconde un error de layout: el alto
 * de hora se amplifica 16× a lo largo de la grilla, así que medio píxel de alto de
 * hora se verían como 8 px de arrastre en el último bloque, y el assert de bloques
 * lo caza.
 *
 * Lo que queda dentro de la tolerancia y por qué: la barra queda 0.31 px más alta
 * (35.703 contra 35.391). Es redondeo de punto flotante del `align-items: baseline`
 * — las dos interfaces aritan la línea base por rutas distintas — y arrastra 0.31 px
 * a todo lo que está debajo, o sea 0.02 px por hora de grilla. Antes de arreglar
 * `align-items` la diferencia era de 2.05 px, que sí se veía.
 *
 * Este spec es del proyecto `visual`: necesita las tres fuentes de marca, que se
 * sirven de Google Fonts por red, y la alineación de línea base de la barra depende
 * de sus métricas. Ver la nota de CI en `playwright.config.ts`.
 */
const TOLERANCIA_PX = 0.5;

function cerca(recibido: number, esperado: number, que: string): void {
  expect(
    Math.abs(recibido - esperado),
    `${que}: la app da ${recibido.toFixed(3)} px y el prototipo ${esperado.toFixed(3)} px (tolerancia ${TOLERANCIA_PX} px)`,
  ).toBeLessThanOrEqual(TOLERANCIA_PX);
}

test.describe("la app reproduce la geometría del prototipo", () => {
  for (const view of VIEWS) {
    test(`· ${view.id}`, async ({ page }, testInfo) => {
      const contenido = CONTENIDO_POR_VISTA[view.id];
      await loadPrototype(page, testInfo, view);
      const proto = await medirGeometria(page, "proto", contenido);
      const protoFondo = await medirFondoRaiz(page, "proto");
      const protoConteo = await medirConteo(page, "proto");
      const protoAltoHora = (await medirAltoHora(page, "proto")) * ZOOM_AMPLIO;
      const protoBloques = await medirBloques(page, "proto");

      const api = await loadApp(page, testInfo, view);
      const app = await medirGeometria(page, "app", contenido);
      const appFondo = await medirFondoRaiz(page, "app");
      const appConteo = await medirConteo(page, "app");

      // 1. El fondo de la raíz. El token `--bg` estaba declarado en tokens.css y
      //    NUNCA se aplicaba: `[data-agenda].agx` no declaraba `background`, así que
      //    la raíz era transparente y se veía el fondo del shell del CRM
      //    (rgb 12,12,14) en vez de `--bg` (rgb 16,15,13).
      //    La comparación visual NO lo cazaba: la distancia YIQ entre los dos
      //    colores es 5.3 y el umbral de Playwright (`threshold: 0.2`) es 1408.6,
      //    o sea invisible por dos órdenes de magnitud. Por eso esto es un assert
      //    de estilo computado y no una captura.
      expect(appFondo, "la raíz de la agenda tiene que pintar el token --bg").toBe(protoFondo);

      // 2. El texto del conteo, palabra por palabra. El prototipo imprime
      //    "13 reuniones · 2 sin sincronizar"; la app imprimía "13 reuniones", con
      //    un espacio de sobra. El comentario en Agenda.tsx describía la feature y
      //    el código no la tenía.
      expect(appConteo, "el conteo de la barra tiene que ser el del prototipo").toBe(protoConteo);
      expect(appConteo, "el conteo tiene que avisar cuántas no llegaron a Google").toContain(
        "sin sincronizar",
      );

      // 3. La barra superior. `align-items: baseline` (prototipo) contra `center`
      //    (app) daba 35.39 px contra 33.34 px. No era cosmético: los 2.05 px que
      //    faltaban bajaban todo el contenido y agrandaban el `avail` del que sale
      //    el alto de hora, y de ahí venía el error de escala del punto 5.
      expect(proto.barra, "el prototipo no tiene .topbar: el mapeo del helper está mal").not.toBeNull();
      expect(app.barra, "la app no tiene .agx-bar: el mapeo del helper está mal").not.toBeNull();
      cerca(app.barra!.h, proto.barra!.h, "la barra superior tiene la misma altura");

      // 4. Todo el contenido arranca en el mismo punto. Si la barra mide distinto,
      //    esto se mueve: es el mismo defecto visto por el otro lado.
      cerca(app.raiz!.y, proto.raiz!.y, "la raíz arranca en el mismo punto");
      cerca(app.contenido!.y, proto.contenido!.y, "el contenido arranca en el mismo punto");
      cerca(
        app.contenido!.h,
        proto.contenido!.h,
        "el contenido tiene el mismo alto (de ahí sale el del alto de hora)",
      );

      // 5. El alto de hora. Las DOS implementaciones lo derivan del alto
      //    disponible (`geometry.ts:15` y `index.html:655`); `HOUR_H` en el
      //    prototipo y el `44` de la app son el mismo valor de RESGUARD, para
      //    cuando no hay contenedor. La diferencia medida era 58.87 contra 58.70
      //    px/hora (0.29 %) y venía del punto 3, no de un trade-off de diseño.
      //    Sólo la semanal tiene grilla horaria, así que el resto no aplica.
      if (view.id !== "semana") {
        assertSinMetodosDesconocidos(api);
        return;
      }
      cerca(app.heads!.h, proto.heads!.h, "el encabezado de días tiene la misma altura");
      const appAltoHora = (await medirAltoHora(page, "app")) * ZOOM_AMPLIO;
      cerca(appAltoHora, protoAltoHora, "el alto de hora");

      // 6. Los bloques: misma cantidad, misma columna (x) y mismo color exacto. El
      //    color importa más que la posición: si una categoría se re-tinte, el diff
      //    de píxeles lo reporta mezclado con el antialiasing de los bordes.
      expect(protoBloques.length, "el prototipo tiene 17 bloques con hora").toBe(17);
      const bloques = await medirBloques(page, "app");
      expect(bloques.length, "la app tiene que dibujar los mismos bloques que el prototipo").toBe(
        protoBloques.length,
      );
      for (const [i, pb] of protoBloques.entries()) {
        const ab = bloques[i];
        expect(ab.color, `bloque ${i}: mismo color de categoría`).toBe(pb.color);
        cerca(ab.x, pb.x, `bloque ${i}: misma columna`);
      }

      assertSinMetodosDesconocidos(api);
    });
  }
});

test.describe("el golden es de la plataforma que lo generó", () => {
  test("las capturas base son de darwin", () => {
    // `snapshotPathTemplate` es `{testDir}/__screenshots__/{arg}{ext}`: no lleva la
    // plataforma, así que un golden generado en Linux se compara contra uno de
    // macOS y el diff es ruido del rasterizador, no un cambio de diseño. Se elige
    // explícitamente "sólo vale en la plataforma que lo generó" en vez de agregar
    // la plataforma al path porque la alternativa obliga a versionar tres goldens
    // por sistema operativo sin que nadie los mire nunca.
    // Este test convierte un fallo invisible y sin explicación en un mensaje que
    // dice la verdad y dice qué hacer.
    expect(
      process.platform,
      "los goldens de la agenda sólo valen en la plataforma con que se generaron. " +
        "En otra: `npm --prefix apps/web run fidelity:visual:golden` en ESA plataforma.",
    ).toBe("darwin");
  });
});
