/**
 * apps/web — type smoke entry. Sin UI todavía (esa llega en T4-T5).
 * Existe solo para que tsc tenga inputs y para evidenciar la integración
 * end-to-end @crm/web → @crm/types. Si esto compila, el scaffod está conectado.
 */
import type { HoyItem } from "@crm/types";

/** Shape-NOT-runtime type check: este string no aparece en producción. */
export const _TYPES_LIVE_HERE: HoyItem[] = [];

export {}; // verbatimModule-syntax friendly
