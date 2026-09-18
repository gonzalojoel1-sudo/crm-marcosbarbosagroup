export type AgendaView = "semana" | "lista" | "mes";

// Reunión ya normalizada: fechas naive en la zona del sitio (nunca toISOString).
export interface AgendaEvent {
  name: string;
  subject: string;
  start: Date;
  end: Date;
  allDay: boolean;
  category?: string;
  // Origen del evento ("CRM" | "Reserva web" | "Google"). El DTO de `get_agenda`
  // todavía no lo expone; el predicado del prototipo lo usa sólo para los eventos
  // SIN categoría (importados). Ausente ⇒ queda `undefined` y no se inventa.
  origin?: string;
}

// Tarea ya normalizada. `due` es el vencimiento (nunca una duración): una tarea
// no ocupa una franja de la grilla, se muestra fuera del tiempo.
export interface AgendaTask {
  name: string;
  subject: string;
  due: Date | null;
  priority: string;
}

export interface DensityStep {
  id: "compacto" | "comodo" | "amplio";
  label: string;
  mult: number;
}

// Zoom-Amplio es la densidad por defecto (spec de interacción, §4).
export const ZOOM_STEPS: readonly DensityStep[] = [
  { id: "compacto", label: "Compacto", mult: 0.72 },
  { id: "comodo", label: "Cómodo", mult: 1 },
  { id: "amplio", label: "Amplio", mult: 1.32 },
];
