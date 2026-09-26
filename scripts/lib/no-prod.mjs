// Guard de producción para los scripts de `scripts/`.
//
// Por qué existe: los E2E y los de smoke apuntaban a
// `https://crm.marcosbarbosagroup.com` POR DEFECTO. Un script que siembra datos de
// prueba con un default de producción es un script que siembra datos de prueba en
// producción tarde o temprano —y `smoke_prod.py` se titula, sin ironyía, "CRUD
// test on PROD (creates + deletes, no residue)". Que el default sea producción no
// es un，力争 de estilo: es el default que hace que un `node scripts/e2e_hoy.mjs`
// sin pensar escriba en el CRM de un cliente.
//
// La regla: un script que ESCRIBE no corre contra un host de producción salvo que
// se pida explícitamente con `ALLOW_PROD=1`. Un script que sólo LEE puede correr
// contra producción (ver `ESCRITURA`), porque no siembra nada.
// Un default de producción en un script que escribe es la causa raíz de que se
// hayan sembrado datos de prueba en el CRM de un cliente.

/** Hosts que se consideran producción. Ampliable con `CRM_PROD_HOSTS`. */
const PRODUCCION_POR_DEFECTO = [
  "crm.marcosbarbosagroup.com",
  "www.marcosbarbosagroup.com",
  "marcosbarbosagroup.com",
];

/** El host de una URL, sin traer `node:url` (su `hostname` no es export con nombre). */
function hostDe(url) {
  const conProtocolo = url.includes("://") ? url : `https://${url}`;
  const despues = conProtocolo.split("://")[1] ?? "";
  return despues.split("/")[0].split(":")[0].toLowerCase();
}

function esProduccion(url) {
  const h = hostDe(url);
  const extra = (process.env.CRM_PROD_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Coincidencia EXACTA, no "cualquier subdominio del ápex": el sitio de pruebas es
  // `crm-test.marcosbarbosagroup.com` y un match por sufijo lo tomaría por
  // producción, que es el error inverso y peor (te bloquea el sitio de pruebas). Para
  // cubrir un dominio entero hay que pedirlo explícito con `*.dominio.com` en
  // `CRM_PROD_HOSTS`.
  for (const patron of [...PRODUCCION_POR_DEFECTO, ...extra].map((s) => s.toLowerCase())) {
    if (patron.startsWith("*.")) {
      const sufijo = patron.slice(1); // ".dominio.com"
      if (h.endsWith(sufijo)) return true;
    } else if (h === patron) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica que `url` no sea de producción. `escritura` marca si el script modifica
 * datos: los de lectura se pueden pasar sin más, los de escritura requieren
 * `ALLOW_PROD=1`.
 *
 * @param {string} url       La URL contra la que va a correr el script.
 * @param {object} [op]
 * @param {boolean} [op.escritura=true]  Si el script escribe datos.
 * @param {string}  [op.script]          Nombre, para el mensaje de error.
 * @param {string}  [op.queHace]         Qué hace, para el mensaje de error.
 * @returns {string} La URL, por convenience.
 */
export function sinProduccion(url, op = {}) {
  const {
    escritura = true,
    script = "este script",
    queHace = "modificar datos",
  } = op;
  if (!esProduccion(url)) return url;
  if (!escritura) {
    process.stderr.write(
      `[${script}] OJO: corre contra ${url}. Sólo lee, no siembra nada.\n`,
    );
    return url;
  }
  if (process.env.ALLOW_PROD === "1") {
    process.stderr.write(
      `[${script}] ALLOW_PROD=1: se permite escribir en PRODUCCIÓN (${url}).\n` +
        `[${script}] Verificá después que no quedó residuo.\n`,
    );
    return url;
  }
  process.stderr.write(
    `\n[${script}] RECHAZADO: ${url} es producción y este script va a ${queHace}.\n\n` +
      `  Para correr contra un sitio de pruebas, pasá la URL:\n` +
      `      URL=https://crm-test.marcosbarbosagroup.com/hoy ${process.argv[1] ?? ""}\n\n` +
      `  Si de verdad querés tocar producción, asumilo explícitamente:\n` +
      `      ALLOW_PROD=1 ${process.argv[1] ?? ""}\n\n` +
      `  Un default de producción en un script que escribe es la causa raíz de que\n` +
      `  se hayan sembrado datos de prueba en el CRM de un cliente.\n\n`,
  );
  process.exit(2);
}

export { esProduccion };
