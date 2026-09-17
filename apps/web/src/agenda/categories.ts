/**
 * Las cinco categorías de la agenda: ÚNICA fuente de verdad de la etiqueta y el
 * color. El mapa lo consumen el bloque de la grilla, el punto de la Lista y el
 * del Mes, y el nombre accesible. Los valores `oklch` son los del prototipo y no
 * se ajustan a ojo: un solo croma (0.155) y la luminosidad de cada matiz la fija
 * el contraste con texto blanco sobre el relleno sólido (medido ≥ 4.6:1).
 */
export interface Category {
  label: string;
  color: string;
}

export const CATEGORIES: Record<string, Category> = {
  Trabajo: { label: "Trabajo", color: "oklch(0.574 0.155 285)" },
  Ministerial: { label: "Ministerial", color: "oklch(0.558 0.155 245)" },
  Personal: { label: "Personal", color: "oklch(0.54 0.155 155)" },
  Consultora: { label: "Consultora", color: "oklch(0.576 0.155 45)" },
  Software: { label: "Software", color: "oklch(0.58 0.155 330)" },
};

// La API nunca manda vacío (cae a "Trabajo"), pero el tipo es opcional: sin valor
// se usa un gris neutro que también pasa 4.5:1 con texto blanco.
const FALLBACK: Category = { label: "", color: "#6b7280" };

export function categoryOf(value: string | null | undefined): Category {
  if (!value) return FALLBACK;
  return CATEGORIES[value] ?? FALLBACK;
}
