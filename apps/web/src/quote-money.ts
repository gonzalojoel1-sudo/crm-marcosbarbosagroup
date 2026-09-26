import { type QuoteCurrency } from "./api";

/**
 * La moneda del presupuesto.
 *
 * Vive en su propio módulo y no en `QuotePanel.tsx` por una razón concreta: un
 * archivo que exporta componentes Y constantes hace que el fast refresh de Vite
 * de toda la página en vez de parcheear el módulo. `QuotePanel` ya exportaba
 * `EMPTY_ROW` e `itemsFromRows` por necesidad de los tests, así que las
 * constantes de moneda se van acá y el panel queda exporting solo componentes
 * más lo que ya estaba.
 */

/** Opciones del selector. Los rótulos son los que usa el PDF para "Moneda". */
export const MONEDAS: { value: QuoteCurrency; label: string }[] = [
  { value: "ARS", label: "Pesos argentinos (ARS)" },
  { value: "USD", label: "Dólares (USD)" },
];

/**
 * Símbolo. Un presupuesto en USD mostrado con "$" es una cifra engañosa: el
 * mismo error en pantalla y en el PDF hace que uno piense que se leveled mal.
 * La regla replica `billing.fmt_money` (crm_core/billing.py) para que pantalla
 * e impresión digan exactamente lo mismo.
 */
export const simboloDe = (c: string) => (c === "USD" ? "US$" : "$");

/** `$ 1.234,56` / `US$ 1.234,56` — es-AR, como en el PDF. */
export const fmtQuoteMoney = (v: number, currency: string) =>
  simboloDe(currency) +
  v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
