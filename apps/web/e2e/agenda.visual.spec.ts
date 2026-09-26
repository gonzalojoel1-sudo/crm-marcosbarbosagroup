import { expect, test } from "@playwright/test";
import { EXCEPCIONES, VIEWS, loadApp, neutralizar, type ViewCase } from "./helpers/visual";

/**
 * La app contra el golden del prototipo.
 *
 * ── Por qué este spec está estructurado así ──────────────────────────────────
 *
 * Antes comparaba la captura entera con `maxDiffPixels: 0` y fallaba siempre: 3 de
 * 8 tests en rojo, con un número y nada más. La causa era que el golden se
 * regeneró DESPUÉS de que la app tuviera el pager, así que el baseline incluía un
 * control que el prototipo no tiene. Un gate que no puede pasar deja de leerse, y
 * mientras nadie lo leía entraron bugs de verdad: el token `--bg` declarado y nunca
 * aplicado, y el "· N sin sincronizar" que el comentario de `Agenda.tsx` describía y
 * el código no implementaba. Peor: el número no decía cuáles.
 *
 * Ahora hay dos diferencias aceptadas, NOMBRADAS y con su contraparte sin píxeles:
 *
 *  1. `pager` (`EXCEPCIONES` en el helper) → la única diferencia de la barra. Se
 *     neutraliza apagando el control, así que la barra se sigue comparando entera
 *     y con tolerancia cero. El control en sí se testea en
 *     `agenda.behavior.spec.ts` y está documentado en `Toolbar.tsx`.
 *  2. `grilla-vertical` (sólo `semana`) → el alto de hora. Ver abajo: el golden no
 *     es reproducible ni en el propio prototipo, así que no hay nada honesto
 *     contra qué comparar la fila. La fila no se compara por píxeles y en su lugar
 *     `agenda.fidelity.spec.ts` mide, con tolerancia cero, el alto de hora, la
 *     columna (x) y el color exacto de los 17 bloques, más que el alto de hora
 *     siga a la ventana.
 *
 * ── El alto de hora: por qué la fila de la semana no se compara por píxeles ──
 *
 * Las DOS implementaciones derivan el alto de hora del alto disponible
 * (`geometry.ts:15` y `index.html:655`); en el prototipo `HOUR_H` es el valor de
 * RESGUARD, no una constante. O sea que la grilla se adapta a la ventana en los
 * dos, y un golden de alto fijo no puede valer en más de un tamaño.
 *
 * Y además hay algo que no es un trade-off: el golden capturó una geometría VIEJA.
 * Medido hoy con viewport 1320×900:
 *
 *   prototipo  `.days` scrollHeight 930  →  58.13 px/hora
 *   app        `.agx-days` scrollHeight 939  →  58.69 px/hora
 *
 * Al cambiar el tamaño de ventana el prototipo NO se actualiza: a 700 px de alto
 * sigue reportando 930, y al volver a 900 reporta 714 — el grid se achica y deja de
 * scrollear. Es el caché `LAST_FIT` (`index.html:653`), que se calcula una vez y no
 * se invalida. La app sí re-deriva (939 → 675).
 *
 * O sea: la geometría vertical del golden no es un número que la app pueda
 * reproducir sin copiar un bug del prototipo. Por eso la fila de la semana se
 * compara por REGIONES (todo lo que no depende de la altura de hora) y su interior
 * queda a cargo de las aserciones geométricas, que son más finas que los píxeles.
 */

/**
 * Regiones que sí se comparan píxel a píxel en cada vista. La página entera cuando
 * no hay geometría de hora (lista, mes) y por partes en la semanal.
 *
 * `recorteInfPx` es lo que se saca por ABAJO de la región, y hay una sola razón:
 * el borde inferior de `.heads` es la costura con el contenido scrolleable, así que
 * su última fila de píxeles es el borde superior del primer bloque de reunión. Con
 * la deriva vertical de la grilla (ver la nota de arriba) esa fila no puede
 * coincidir y no tiene nada que ver con el encabezado: sin recortarla, la región
 * daba 45 píxeles de diferencia que no eran del encabezado.
 */
interface Region {
  nombre: string;
  proto: string;
  app: string;
  recorteInfPx?: number;
}

const REGIONES: Record<ViewCase["id"], Region[]> = {
  // La semana tiene la fila de hora, así que la página entera no es comparable. Se
  // comparan las tres regiones que no dependen del alto de hora: la barra (todo el
  // chrome de la agenda), la sidebar (los filtros) y el encabezado de días. Son las
  // tres donde un cambio de color, tipografía o espacío se vería.
  //
  // El MINI-MES no se compara: a 1320 px lo apaga la media query de 1559, queda en
  // 0×0, y una captura de un elemento sin área nunca se estabiliza.
  semana: [
    { nombre: "agenda-semana-barra.png", proto: ".topbar", app: ".agx-bar" },
    { nombre: "agenda-semana-side.png", proto: ".side", app: ".agx-side" },
    {
      nombre: "agenda-semana-heads.png",
      proto: ".heads",
      app: ".agx-heads",
      recorteInfPx: 2,
    },
  ],
  lista: [],
  mes: [],
};

/**
 * Presupuesto de píxeles para las comparaciones POR REGIÓN.
 *
 * Es `0` para la página entera (lista y mes) y un número chico y nombrado para las
 * regiones de la semana. La razón, medida: el botón "Hoy · 15:42" de la app mide
 * 81.4531 px contra 81.4375 del prototipo — 1/64 de px, que es la unidad de layout
 * de Chromium. El texto es idéntico (las dos páginas miden 57.43428 px con
 * `canvas.measureText` y cargan la misma Outfit), así que no es un cambio de
 * tipografía: es redondeo de `LayoutUnit`. Como la barra reparte con
 * `space-between`, ese 1/64 desplaza TODO el grupo derecho, y tres etiquetas
 * ("Semana", "Panel", "Amplio") caen en una fase sub-píxel distinta: 17 píxeles
 * antialiasados de 38.520 (0.04 %).
 *
 * No se "arregla" con CSS: para clavarlo habría que fijar un ancho en px, que es
 * justo el tipo de valor que hay que derivar del prototipo y no escribir a mano.
 * Y no se sube más de 24 porque cualquier cambio real de color, tipografía o
 * espacío en la barra mueve cientos de píxeles, no decenas.
 */
const PRESUPUESTO_REGION = 24;

test.describe("la app contra la golden del prototipo", () => {
  for (const view of VIEWS) {
    test(`app · ${view.id}`, async ({ page }, testInfo) => {
      const api = await loadApp(page, testInfo, view);
      await neutralizar(page);
      const regiones = REGIONES[view.id];

      if (regiones.length === 0) {
        // Página entera: tolerancia CERO. No hay geometría de hora en lista ni mes,
        // así que no hay nada que exceptuar y no hay por qué perdonar ni un píxel.
        await expect(page).toHaveScreenshot(view.name);
      } else {
        for (const r of regiones) {
          const enApp = page.locator(r.app);
          // El selector del PROTOTIPO no se comprueba acá: en este spec la única
          // página cargada es la app. Que exista en el prototipo lo verifica
          // `agenda.golden.spec.ts`, que sí lo carga.
          expect(await enApp.count(), `la app no tiene "${r.app}"`).toBe(1);
          // `clip` y no un locator: es lo único que deja recortar la región. Sin
          // `clip`, `page.toHaveScreenshot` captura la PÁGINA ENTERA.
          const caja = await enApp.boundingBox();
          if (!caja) throw new Error(`"${r.app}" no tiene caja`);
          await expect(page).toHaveScreenshot(r.nombre, {
            maxDiffPixels: PRESUPUESTO_REGION,
            clip: {
              x: caja.x,
              y: caja.y,
              width: caja.width,
              height: caja.height - (r.recorteInfPx ?? 0),
            },
          });
        }
      }

      // Si alguien saca el pager, la excepción queda neutralizando algo que no
      // existe y este assert avisa en vez de dejar una regla muerta.
      for (const e of EXCEPCIONES) {
        expect(await page.locator(e.sel).count(), `la excepción "${e.id}" ya no aplica`).toBe(1);
      }
      expect(
        api.desconocido,
        "la app pidió un método que el mock no conoce: se rompió el contrato con el backend",
      ).toEqual([]);
    });
  }
});
