import { fmtMin } from "./date";

const PRIORIDADES: Record<string, string> = {
  Low: "baja",
  Medium: "media",
  High: "alta",
};

export function priorityLabel(priority: string): string {
  return PRIORIDADES[priority] ?? priority.toLowerCase();
}

/**
 * Nombre accesible de una tarea. Dice "tarea" y "vence" para que la tecnología
 * asistiva no la confunda con una reunión: una tarea tiene VENCIMIENTO, no una
 * franja horaria, y por eso nunca vive en la grilla temporal. Cierra con la
 * acción del botón, que es real (marcarla como hecha).
 */
export function accessibleTaskName(
  dayLabel: string,
  dueMin: number,
  subject: string,
  priority: string,
): string {
  return `Tarea: ${subject}, vence ${dayLabel} a las ${fmtMin(dueMin)}, prioridad ${priorityLabel(
    priority,
  )}. Marcar como hecha`;
}
