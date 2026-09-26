// El arreglo `EVENTS` del prototipo es la FUENTE de la agenda: la app lo reproduce
// y el fixture de los E2E tiene que ser su espejo. Este módulo extrae ese arreglo
// del HTML (no una copia mantenida a mano) y lo normaliza a la forma del DTO que
// la app consume, para que "la fixture es el espejo" sea una INVARIANTE que se
// verifica y no una afirmación en un docstring.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

/** Etiqueta de cada categoría del prototipo (`CATS`, `index.html:543`). */
export const CATEGORIAS_PROTO = {
  consultora: "Consultora",
  ministerial: "Ministerial",
  personal: "Personal",
  trabajo: "Trabajo",
  software: "Software",
};

/**
 * Divergencia DECLARADA (spec de agenda §2/D5): el origen "Reserva" del prototipo
 * no tiene campo que lo distinga en el modelo, así que la app lo nombra "Reserva
 * web" y todos los no-Google nacen en el CRM. Sin esta tabla el chequeo daría
 * falso rojo por una diferencia que es de vocabulario, no de dato.
 */
export const ORIGENES_PROTO = { Reserva: "Reserva web", CRM: "CRM", Google: "Google" };

/** Lunes 15 de septiembre de 2025: el `day` del prototipo es índice de DAYS. */
export const SEMANA_PROTO = "2025-09-15";

/** Corta el arreglo literal `EVENTS` del HTML del prototipo. */
export function extraerEvents(html) {
  const m = /let\s+EVENTS\s*=\s*(\[[\s\S]*?\n\];)/.exec(html);
  if (!m) throw new Error("no se encontró el arreglo `EVENTS` en el prototipo");
  // `runInNewContext` sobre un contexto sin prototipos: evalúa SOLO el literal de
  // datos (claves sin comillas, `null`, comas finales) sin darle acceso al módulo.
  return runInNewContext(`(${m[1].replace(/;$/, "")})`, Object.create(null), {
    timeout: 1000,
  });
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * Normaliza un evento del prototipo a la fila que la fixture debe tener.
 * `day` es índice de `DAYS` (Lun 15 … Dom 21) y se resuelve a una fecha; `min` y
 * `dur` a una ventana "YYYY-MM-DD HH:MM:SS".
 */
export function normalizarEvento(e) {
  const dia = new Date(`${SEMANA_PROTO}T00:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + e.day);
  const fecha = `${dia.getUTCFullYear()}-${pad(dia.getUTCMonth() + 1)}-${pad(dia.getUTCDate())}`;
  const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
  return {
    starts_on: `${fecha} ${hhmm(e.min)}`,
    ends_on: `${fecha} ${hhmm(e.min + e.dur)}`,
    subject: e.title,
    // `cat: null` es lo que el prototipo usa para lo importado de Google: sin
    // categoría y `busy`. La app manda "" en el DTO (la API nunca manda vacío).
    categoria: e.cat ? CATEGORIAS_PROTO[e.cat] : "",
    origin: ORIGENES_PROTO[e.origin],
    // `busy` es opcional en el prototipo: ausente = false.
    busy: e.busy === true,
    // `sync` y `sub` son parte del dato del prototipo. Se normalizan a `null`
    // cuando no están para que la fixture los declare siempre de forma explícita.
    sync: e.sync ?? null,
    sub: e.sub ?? null,
  };
}

/** La lista completa que la fixture debe contener, ordenada como la fixture. */
export function esperadoDelPrototipo(html) {
  return extraerEvents(html)
    .map(normalizarEvento)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.subject.localeCompare(b.subject));
}

/** Las mismas filas, ordenadas como la fixture, para comparar sin depender del orden. */
export function ordenarFixture(fixture) {
  return (fixture.events ?? [])
    .map((e) => ({
      starts_on: e.starts_on,
      ends_on: e.ends_on,
      subject: e.subject,
      categoria: e.categoria ?? "",
      origin: e.origin,
      busy: e.busy === true,
      sync: e.sync ?? null,
      sub: e.sub ?? null,
    }))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.subject.localeCompare(b.subject));
}

/**
 * Compara campo por campo y devuelve una lista de diferencias legibles. Compara
 * el CONTENIDO como conjunto ordenado, no el orden de las filas: la fixture
 * ordena por fecha (que es como la consumes) y el prototipo agrupa por día de
 * trabajo, así que el orden no es parte del contrato.
 *
 * `permitidos` son las reuniones que la fixture AGREGA a propósito (la de la
 * regresión de tareas suma un evento de todo el día). tienen que estar declaradas
 * en el campo `_extiende` de la fixture: un evento que aparece sin declararse es
 * diferencia, porque es dato que el prototipo no tiene y nadie puede explicar.
 */
export function diferencias(esperado, actual, permitidos = []) {
  const out = [];
  const clave = (e) => `${e.starts_on} ${e.subject}`;
  const permitidas = new Set(permitidos);
  const propios = actual.filter((e) => !permitidas.has(clave(e)));
  if (esperado.length !== propios.length) {
    out.push(
      `cantidad de reuniones del prototipo: ${esperado.length}, la fixture tiene ${propios.length} (sin contar ${permitidos.length} declaradas en _extiende)`,
    );
  }
  const porClave = new Map(propios.map((e) => [clave(e), e]));
  const campos = ["starts_on", "ends_on", "subject", "categoria", "origin", "busy", "sync", "sub"];
  for (const exp of esperado) {
    const act = porClave.get(clave(exp));
    if (!act) {
      out.push(`falta en la fixture: ${clave(exp)} (sync=${exp.sync}, sub=${exp.sub})`);
      continue;
    }
    for (const c of campos) {
      if (exp[c] !== act[c])
        out.push(
          `${clave(exp)} · ${c}: prototipo ${JSON.stringify(exp[c])} vs fixture ${JSON.stringify(act[c])}`,
        );
    }
  }
  for (const act of propios) {
    if (!esperado.some((e) => clave(e) === clave(act)))
      out.push(`sobra en la fixture sin declarar en _extiende: ${clave(act)}`);
  }
  return out;
}

/** atajo: lee el HTML del prototipo y devuelve el set esperado. */
export function esperadoDesdeRepo(raiz) {
  return esperadoDelPrototipo(
    readFileSync(resolve(raiz, "prototypes/agenda/index.html"), "utf8"),
  );
}

/**
 * Las reuniones que una fixture AGREGA a propósito, declaradas en su campo
 * `_extiende`. Cada una lleva un `porqué` obligatorio: sin razón, es dato que el
 * prototipo no tiene y nadie puede explicar.
 */
export function clavesDe(extiende) {
  return (extiende ?? []).map((e) => `${e.starts_on} ${e.subject}`);
}
