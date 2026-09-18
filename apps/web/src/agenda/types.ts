export type AgendaView = "semana" | "lista" | "mes";

// Reunión ya normalizada: fechas naive en la zona del sitio (nunca toISOString).
export interface AgendaEvent {
  name: string;
  subject: string;
  start: Date;
  end: Date;
  allDay: boolean;
  category?: string;
  // Origen real ("CRM" | "Google"). El DTO lo deriva de
  // `pulled_from_google_calendar`; "Reserva web" no tiene campo que lo distinga
  // hoy (divergencia declarada en la spec §2/D5).
  origin?: string;
  // Importado de Google ⇒ de solo lectura: no abre menú, no se arrastra ni edita.
  busy?: boolean;
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
