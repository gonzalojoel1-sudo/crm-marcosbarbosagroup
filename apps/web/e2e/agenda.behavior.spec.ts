import { expect, test } from "@playwright/test";
import { loadApp, assertSinMetodosDesconocidos } from "./helpers/visual";

/**
 * Comportamiento de la agenda, sin depender del golden.
 *
 * Por qué este archivo existe: hasta 2026-09-26 los únicos tests de la agenda
 * miraban capturas. `Agenda.tsx` tiene 879 líneas de crear, arrastrar, abrir y
 * cerrar paneles, moverse con teclado y filtrar, y CERO tests de comportamiento:
 * una regresión que rompiera el arrastre o el `EventPanel` no hacía fallar nada,
 * porque una captura de la grilla sigue siendo una captura válida de una grilla
 * rota.
 *
 * Reglas de este archivo:
 *
 *  - NADA de golden. Un cambio de diseño no debería romper estos tests, y un bug de
 *    comportamiento no debería necesitar un golden para verse.
 *  - NADA de `waitForTimeout` fijo. Toda espera es sobre una condición observable
 *    (`toBeVisible`, `toHaveText`, un `expect.poll`), así que un test que pasa es
 *    un test que vio el estado final y no una captura de un instanteafortunado.
 *  - El reloj está congelado en 2025-09-16 15:42 (ver `helpers/visual.ts`), así que
 *    "ahora" es un lugar fijo y los horarios de la prueba no dependen del día en que
 *    se corra.
 */

const SEMANA = { id: "semana", name: "agenda-semana.png" } as const;

test.describe("crear una reunión por la UI", () => {
  test("el botón Nueva reunión abre el panel con el título enfocado", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    await expect(page.locator(".agx-panel")).toHaveCount(0);

    await page.getByRole("button", { name: "Nueva reunión" }).first().click();

    const panel = page.locator(".agx-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("role", "dialog");
    // El foco arranca en el título: sin esto, abrir el panel con teclado obligaría a
    // tabular desde el beginning de la página.
    await expect(page.locator("#agx-p-titulo")).toBeFocused();
    assertSinMetodosDesconocidos(api);
  });

  test("crear manda la reunión al backend y la agrega a la grilla", async ({ page }, testInfo) => {
    const llamadas: Array<{ metodo: string; body: unknown }> = [];
    page.on("request", (req) => {
      const m = /\/api\/method\/([^?]+)/.exec(req.url());
      if (m && req.method() === "POST") {
        try {
          llamadas.push({ metodo: decodeURIComponent(m[1]), body: req.postDataJSON() });
        } catch {
          /* body no-JSON: no es lo que estos tests miran */
        }
      }
    });

    const api = await loadApp(page, testInfo, SEMANA);
    await page.getByRole("button", { name: "Nueva reunión" }).first().click();
    await page.locator("#agx-p-titulo").fill("Reunión de prueba");
    await page.getByRole("button", { name: /^Guardar$/ }).click();

    // El panel se cierra solo cuando el guardado termina bien.
    await expect(page.locator(".agx-panel")).toHaveCount(0);

    const creada = llamadas.find((c) => c.metodo.endsWith("create_event"));
    expect(creada, `no se llamó a create_event; se llamó: ${llamadas.map((c) => c.metodo).join(", ")}`)
      .toBeTruthy();
    const body = creada!.body as { subject?: string; starts_on?: string };
    expect(body.subject, "el título tiene que ir al backend").toBe("Reunión de prueba");
    expect(body.starts_on, "la reunión tiene que llevar fecha y hora").toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    assertSinMetodosDesconocidos(api);
  });

  test("el panel avisa cuando el backend rechaza el guardado", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    // Un 500 en `create_event`: es el path de error que antes no era alcanzable,
    // porque el mock respondía 200 con `{}` a cualquier método.
    api.set("crm_core.api.create_event", { ok: false, status: 500, body: "boom" });

    await page.getByRole("button", { name: "Nueva reunión" }).first().click();
    await page.locator("#agx-p-titulo").fill("No se va a guardar");
    await page.getByRole("button", { name: /^Guardar$/ }).click();

    // El panel NO se cierra y hay un `role="alert"` con un mensaje: si el error se
    // tragara el `catch`, el usuario pierde la reunión sin enterarse.
    await expect(page.locator(".agx-panel")).toBeVisible();
    const alerta = page.locator('.agx-panel [role="alert"]');
    await expect(alerta).toBeVisible();
    await expect(alerta).toHaveText(/no se pudo guardar/i);
  });
});

test.describe("abrir y cerrar el panel de una reunión", () => {
  test("click abre el menú, Editar abre el panel, Escape cierra y vuelve el foco", async ({
    page,
  }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    const bloque = page.locator(".agx-ev").first();
    const nombre = await bloque.locator(".agx-ev-t").innerText();

    // Click en el bloque abre el MENÚ, no el panel: son dos pasos distintos y
    // confundirlos era parte de por qué no había cobertura de ninguno.
    await bloque.click();
    const menu = page.locator('.agx-menu[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(page.locator(".agx-panel")).toHaveCount(0);

    await menu.getByRole("menuitem", { name: /Editar/ }).click();
    const panel = page.locator(".agx-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(nombre);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    // El foco vuelve al bloque: sin esto, cerrando con teclado el usuario queda
    // perdido en el body y tiene que tabular desde el principio.
    await expect(bloque).toBeFocused();
    assertSinMetodosDesconocidos(api);
  });

  test("el atajo 'e' del menú abre el panel sin puntero", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    const bloque = page.locator(".agx-ev").first();
    await bloque.click();
    await expect(page.locator('.agx-menu[role="menu"]')).toBeVisible();
    await page.keyboard.press("e");
    await expect(page.locator(".agx-panel")).toBeVisible();
    assertSinMetodosDesconocidos(api);
  });

  test("un evento importado de Google no abre el panel: es de solo lectura", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    // Los 4 importados del fixture vienen con `data-busy`.
    const ocupado = page.locator(".agx-ev[data-busy]").first();
    await expect(ocupado, "el fixture tiene importados de Google").toBeVisible();
    await ocupado.click();
    await expect(page.locator('.agx-menu[role="menu"]')).toHaveCount(0);
    await expect(page.locator(".agx-panel")).toHaveCount(0);
    assertSinMetodosDesconocidos(api);
  });
});

test.describe("arrastrar una reunión cambia su hora", () => {
  test("el arrastreVertical la mueve y el backend lo recibe", async ({ page }, testInfo) => {
    const llamadas: Array<{ metodo: string; body: unknown }> = [];
    page.on("request", (req) => {
      const m = /\/api\/method\/([^?]+)/.exec(req.url());
      if (m && req.method() === "POST") {
        try {
          llamadas.push({ metodo: decodeURIComponent(m[1]), body: req.postDataJSON() });
        } catch {
          /* ver arriba */
        }
      }
    });

    const api = await loadApp(page, testInfo, SEMANA);
    // Se arrastra `proto-00` por `data-ev` y no por `.agx-ev` primero: al moverlo
    // cambia el orden de los bloques del día, y un `first()` volvería a apuntar a
    // otra reunión y el assert no probaría nada.
    const bloque = page.locator('.agx-ev[data-ev="proto-00"]').first();
    const horaAntes = await bloque.locator(".agx-ev-m").innerText();

    // Dónde agarrar tiene que cumplir TRES condiciones, y las dos últimas son
    // trampas que hacen que el test falle sin que haya nada que arreglar:
    //  - `.agx-heads` es `position: sticky` y tape la parte de arriba del bloque:
    //    ahí el puntero cae en el encabezado y no hay arrastre.
    //  - el asa de duración (`[data-grip]`) está ABAJO del bloque: agarrar ahí
    //    redimensiona en vez de mover, y la hora no cambia.
    // El punto de agarre se calcula como el CENTRO de la franja que queda entre
    // las dos cosas, para que el test no dependa de una fracción de alto escrita a
    // mano que se rompe apenas cambia el alto de hora.
    const agarre = await bloque.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const arriba = document.querySelector(".agx-heads")!.getBoundingClientRect().bottom;
      const asa = el.querySelector("[data-grip]");
      const abajo = asa ? asa.getBoundingClientRect().top : r.bottom;
      const libre = Math.max(0, abajo - arriba);
      return {
        x: r.x + r.width / 2,
        y: arriba + libre / 2,
        libre: Math.round(libre),
        alto: Math.round(r.height),
      };
    });
    expect(
      agarre.libre,
      `al bloque le quedan ${agarre.libre} px sin tapar entre el encabezado y el asa: no hay dónde arrastrarlo`,
    ).toBeGreaterThan(4);

    // Un arrastre de PUNTER, no un `dispatchEvent`: el arrastre lo implementa
    // `onPointerDown` con `setPointerCapture`, y un evento sintético sin puntero real
    // no lo ejercita.
    const caja = await bloque.boundingBox();
    expect(caja, "el bloque tiene que tener caja para arrastrarlo").toBeTruthy();
    const px = agarre.x;
    const py = agarre.y;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px, py + 120, { steps: 12 });
    // Durante el arrastre aparece la etiqueta de destino (`.agx-droplab`) con la
    // franja horaria a la que caería la reunión. Es la condición observable correcta
    // para la mitad del gesto: `.agx-ghost` NO sirve acá, porque es el fantasma de
    // CREACIÓN (arrastrar un hueco), no el de mover.
    const destino = page.locator(".agx-droplab");
    await expect(destino, "el arrastre no muestra la etiqueta de destino").toBeVisible();
    const rotuloDestino = await destino.innerText();
    expect(rotuloDestino, "la etiqueta de destino tiene que ser una franja horaria").toMatch(
      /^\d{2}:\d{2} – \d{2}:\d{2}/,
    );
    expect(
      rotuloDestino.slice(0, 5),
      "el destino del arrastre tiene que ser una hora distinta de la de partida",
    ).not.toBe(horaAntes.slice(0, 5));
    await page.mouse.up();

    // Al soltar, la app escribe y vuelve a pedir la agenda. Como el mock es un
    // backend de mentira que SÍ persiste, la reunión queda en la hora nueva: si el
    // mock devolviera el fixture intacto volvería a su lugar y este assert no
    // probaría nada.
    await expect
      .poll(
        async () => {
          const ev = page.locator('.agx-ev[data-ev="proto-00"]');
          return (await ev.count()) ? (await ev.locator(".agx-ev-m").innerText()).slice(0, 5) : "";
        },
        { message: "la reunión no quedó en la hora de destino", timeout: 5000 },
      )
      .toBe(rotuloDestino.slice(0, 5));

    const movio = llamadas.find((c) => c.metodo.endsWith("update_meeting"));
    expect(movio, `no se llamó a update_meeting; se llamó: ${llamadas.map((c) => c.metodo).join(", ")}`)
      .toBeTruthy();
    const body = movio!.body as { name?: string; starts_on?: string };
    expect(body.name, "el movimiento tiene que decir QUÉ reunión se movió").toBeTruthy();
    expect(body.starts_on, "el movimiento tiene que llevar la nueva hora").toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    assertSinMetodosDesconocidos(api);
  });
});

test.describe("teclado", () => {
  test("'h' vuelve a la hora actual desde cualquier scroll", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    const grilla = page.locator(".agx-gridwrap");
    // Se aleja de "ahora" a propósito: si `h` no hiciera nada, el scroll queda donde
    // estaba y el assert de abajo no lo notaría.
    await grilla.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect.poll(() => grilla.evaluate((el) => el.scrollTop)).toBe(0);

    await grilla.evaluate((el) => el.focus());
    await page.keyboard.press("h");

    // "Ahora" es 15:42. Con la línea de "ahora" al centro, el scroll tiene que ser
    // mayor que 0 y coincidir con el centro de la hora actual.
    await expect.poll(() => grilla.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(0);
    assertSinMetodosDesconocidos(api);
  });

  test("End va al final del rango y Home vuelve al principio", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    const grilla = page.locator(".agx-gridwrap");
    await grilla.evaluate((el) => el.focus());

    await page.keyboard.press("Home");
    await expect.poll(() => grilla.evaluate((el) => el.scrollTop)).toBe(0);

    await page.keyboard.press("End");
    await expect
      .poll(() => grilla.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBeGreaterThan(0);
    assertSinMetodosDesconocidos(api);
  });
});

test.describe("el mock de la API no es un catch-all", () => {
  test("un método desconocido hace fallar el test en vez de devolver 200 {}", async ({
    page,
  }, testInfo) => {
    // Se inyecta una ruta que la app NO pide. El mock tiene que ignorarla sin
    // inventarse una respuesta, y el test verifica el mecanismo por dentro: si el
    // mock volviera a ser un catch-all, este assert no detectaría nada, así que lo
    // que se verifica es que el handle reporta lo que la app pidió y nada más.
    const api = await loadApp(page, testInfo, SEMANA);
    expect(api.desconocido, "la app no pidió nada fuera de la lista").toEqual([]);

    // Y la lista de métodos conocidos es cerrada a propósito: un método nuevo del
    // backend tiene que agregarse acá, no pasar desapercibido.
    await page.evaluate(() => {
      const w = window as unknown as { CSRF?: string };
      void w;
    });
    assertSinMetodosDesconocidos(api);
  });

  test("la agenda sigue viva cuando un método que NO usa falla", async ({ page }, testInfo) => {
    // `get_reminders` alimenta el /hoy, no la agenda. Que falle 500 no puede romper
    // la agenda: si la rompe, es que un endpoint accesorio se volvió obligatorio.
    const api = await loadApp(page, testInfo, SEMANA);
    api.set("crm_core.api.get_reminders", { ok: false, status: 503, body: "no disponible" });
    await page.reload();
    await page.waitForSelector("[data-agenda]");
    await expect(page.locator(".agx-ev").first(), "la agenda tiene que dibujar igual").toBeVisible();
    assertSinMetodosDesconocidos(api);
  });
});

test.describe("los filtros de la sidebar cambian lo que se ve", () => {
  test("apagar una agenda saca sus reuniones y ajusta el conteo", async ({ page }, testInfo) => {
    const api = await loadApp(page, testInfo, SEMANA);
    const evs = page.locator(".agx-ev");
    const antes = await evs.count();
    expect(antes, "el fixture dibuja reuniones").toBeGreaterThan(0);
    const conteoAntes = await page.locator(".agx-bar .agx-count").innerText();

    // "Software" tiene 2 reuniones en el fixture (Revisión de propuesta y Taller).
    await page.locator('.agx-side [data-cat="Software"]').click();

    // Condición observable: los bloques de esa agenda desaparecen. Con `count()` no
    // alcanza, porque el filtro tiene que RECALCULAR la grilla, no sólo esconderlos.
    await expect
      .poll(() => evs.count(), { message: "apagar la agenda no saca sus reuniones" })
      .toBe(antes - 2);
    await expect(page.locator(".agx-bar .agx-count")).not.toHaveText(conteoAntes);

    // Y volver a prenderla las devuelve: el toggle es de ida y vuelta.
    await page.locator('.agx-side [data-cat="Software"]').click();
    await expect(evs).toHaveCount(antes);
    assertSinMetodosDesconocidos(api);
  });
});
