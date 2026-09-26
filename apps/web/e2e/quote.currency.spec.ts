import { expect, test, type Page } from "@playwright/test";
import { assertSinMetodosDesconocidos, loadApp } from "./helpers/visual";

/**
 * El presupuesto dentro del Negocio: la moneda.
 *
 * Por qué este archivo: el backend y el PDF ya soportaban USD y ARS desde antes
 * (`billing.fmt_money` saca `US$`/`$` y `quote_context` rotula "Dólares
 * estadounidenses (USD)"), y `save_quote` ya aceptaba el parámetro `currency`.
 * Lo que no existía era el control en la UI: `QuotePanel.tsx` no tenía ni una
 * mención a la moneda y su `money()` imprimía siempre "$". O sea, se podía
 * guardar un presupuesto en USD y el panel lo mostraba con el signo del peso.
 *
 * Estos tests miden lo que el usuario ve y lo que sale por la API. No usan
 * golden: un cambio de diseño no debería romperlos.
 */

const SEMANA = { id: "semana", name: "agenda-semana.png" } as const;

test.describe("la moneda del presupuesto", () => {
  test("el panel ofrece un selector con ARS y USD", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA, undefined, { chrome: false });
    await abrirPresupuesto(page);

    const moneda = page.getByLabel("Moneda");
    await expect(moneda).toBeVisible();
    await expect(moneda.locator("option")).toHaveText([
      "Pesos argentinos (ARS)",
      "Dólares (USD)",
    ]);
    await assertSinMetodosDesconocidos(api);
  });

  test("guardar manda la moneda elegida", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA, undefined, { chrome: false });
    await abrirPresupuesto(page);

    await page.getByLabel("Descripción del ítem 1").fill("Auditoría");
    await page.getByLabel("Precio del ítem 1").fill("2500");
    await page.getByLabel("Moneda").selectOption("USD");

    await page.getByRole("button", { name: "Guardar presupuesto" }).click();
    await expect(page.getByText(/guardado/i)).toBeVisible();

    const guardadas = api.llamadas.filter((c) => c.metodo === "crm_core.api.save_quote");
    expect(guardadas.length, "no llegó ningún save_quote").toBeGreaterThan(0);
    const body = guardadas[guardadas.length - 1]!.body as Record<string, unknown>;
    expect(body.currency, "la moneda elegida tiene que viajar a save_quote").toBe("USD");
  });

  test("el símbolo del importe acompaña a la moneda", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA, undefined, { chrome: false });
    await abrirPresupuesto(page);

    await page.getByLabel("Descripción del ítem 1").fill("Auditoría");
    await page.getByLabel("Precio del ítem 1").fill("2500");

    // Con ARS el signo es el de siempre…
    await expect(page.locator(".quote-amt").first()).toContainText("$");
    await expect(page.locator(".quote-amt").first()).not.toContainText("US$");

    // …y al cambiar a USD tiene que cambiar, no solo el dato guardado.
    await page.getByLabel("Moneda").selectOption("USD");
    await expect(page.locator(".quote-amt").first()).toContainText("US$");
    await assertSinMetodosDesconocidos(api);
  });

  test("con USD, el panel avisa del IVA en vez de cambiarlo solo", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA, undefined, { chrome: false });
    await abrirPresupuesto(page);

    await page.getByLabel("Descripción del ítem 1").fill("Auditoría");
    await page.getByLabel("Precio del ítem 1").fill("2500");
    await page.getByLabel("Moneda").selectOption("USD");

    // El IVA NO se cambia solo. Es plata e impuestos: decidirlo por la persona
    // es peor que avisarle. El aviso ofrece el atajo, la persona lo aprieta.
    const aviso = page.getByText(/IVA|impuesto/i).first();
    await expect(aviso).toBeVisible();
    const modoAntes = await modoIva(page);
    await expect(modoAntes, "elegir USD no debería tocar el modo de IVA").toBe(IVA_SUMAR);

    // `exact` porque el aviso ofrece "pasarlo a Exento" y el segmented control
    // ofrece "Exento": los dos son legítimos y sólo uno es el control.
    const exento = page.getByRole("button", { name: IVA_EXENTO, exact: true });
    await exento.click();
    expect(await modoIva(page)).toBe(IVA_EXENTO);
    await assertSinMetodosDesconocidos(api);
  });
});

/**
 * La etiqueta del modo de IVA activo, leído del segmented control (la clase `on`).
 * Se compara contra la etiqueta y no contra una clave porque el control no
 * expone la clave: el texto es lo que la persona lee, y un test que mira lo que
 * la persona ve no depende de una representación interna.
 */
async function modoIva(page: Page): Promise<string> {
  return page.evaluate(() => {
    const seg = document.querySelector(".quote-iva .seg");
    const on = seg && Array.from(seg.querySelectorAll("button")).find((b) => b.className === "on");
    return (on?.textContent ?? "").trim();
  });
}

const IVA_SUMAR = "Sumar 21%";
const IVA_EXENTO = "Exento";

/** Abre Negocios → primer negocio → pestaña Presupuesto. */
async function abrirPresupuesto(page: Page) {
  await page.getByRole("button", { name: "Negocios" }).click();
  await page.locator(".deal").first().click();
  // El drawer usa tablist/tab, no botones: el selector correcto importa.
  await page.getByRole("tab", { name: "Presupuesto" }).click();
  await expect(page.getByRole("button", { name: "Agregar ítem" })).toBeVisible();
}
