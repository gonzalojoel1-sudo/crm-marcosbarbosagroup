/**
 * Datos de un negocio con presupuesto en borrador, para los tests de la pestaña
 * Presupuesto. Vive acá y no en un fixture JSON porque es la forma del contrato
 * (`DealDetail` / `QuoteDTO`), no un espejo de datos externos: si el contrato
 * cambia, el typecheck lo dice.
 */

export const PRESUPUESTO_BORRADOR = {
  name: "P-2026-00001",
  version: 1,
  status: "Borrador",
  currency: "ARS",
  iva_mode: "sumar",
  vertical: "",
  valid_until: "2025-10-01",
  conditions: "",
  notes: "",
  recurring_summary: "",
  is_editable: true,
  totals: {
    one_time_net: 2500,
    one_time_iva: 525,
    one_time_gross: 3025,
    recurring_net: 0,
    recurring_iva: 0,
    recurring_gross: 0,
    discount: 0,
  },
  items: [
    {
      description: "Auditoría",
      billing_type: "Único",
      qty: 1,
      rate: 2500,
      discount_percentage: 0,
      amount: 2500,
      net_amount: 2500,
    },
  ],
};

export const NEGOCIO_CON_PRESUPUESTO = {
  name: "CRM-DEAL-2026-00001",
  title: "Constructora Kruger",
  org: "Kruger",
  contact: "Laura Racedo",
  value: 2500,
  currency: "ARS",
  date: "2025-09-20",
  next_step: "Enviar propuesta",
  probability: 40,
  status: "Analisis",
  owner: "Administrator",
  lead: "CRM-LEAD-2026-00021",
  has_quote: true,
};

export const DETALLE_NEGOCIO = {
  ...NEGOCIO_CON_PRESUPUESTO,
  quote: PRESUPUESTO_BORRADOR,
};
