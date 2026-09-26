export type AgendaView = "semana" | "lista" | "mes";

/**
 * Estado de la escritura en Google Calendar, en el vocabulario de tres estados
 * del prototipo (`index.html:561`). Viene de `custom_sync_estado` por
 * `_sync_del_dto` (api.py): "ok" = llegó, "pend" = en cola, "fail" = no llegó.
 * `null` NO es "sincronizado": es "no hay nada que sincronizar" (lo importado de
 * Google, o un `Event` anterior al Custom Field). La UI cuenta sólo lo que tiene
 * estado y no es "ok".
 */
export type SyncEstado = "ok" | "pend" | "fail" | null;

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
  // Estado del push a Google. Opcional porque un backend anterior a este campo no
  // lo manda, y en ese caso el conteo "sin sincronizar" es 0 en vez de inventar.
  sync?: SyncEstado;
  // Subtítulo del prototipo (`sub` en `EVENTS`). Opcional: el DTO no lo expone
  // todavía; está en la fixture para que el espejo con el prototipo sea completo.
  sub?: string | null;
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
