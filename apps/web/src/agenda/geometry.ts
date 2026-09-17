import { minutesOfDay } from "./date";
import type { AgendaEvent } from "./types";

// Ventana visible de la grilla, como el prototipo: 05:00 a 21:00 (16 h).
export const START_H = 5;
export const END_H = 21;
export const HOURS = END_H - START_H;
export const MIN_BLOCK_H = 22;

/**
 * El alto de hora se DERIVA del alto disponible, nunca es una constante.
 * Con Amplio (mult 1.32) el resultado es más alto que el contenedor y la
 * grilla scrollea adentro; con Compacto entra en pantalla.
 */
export function fitHourHeight(avail: number): number {
  if (!avail || avail < 80) return 44;
  return Math.max(22, avail / HOURS);
}

export function minutesToY(min: number, hourH: number): number {
  return ((min - START_H * 60) / 60) * hourH;
}

export function yToMinutes(y: number, hourH: number): number {
  return START_H * 60 + (y / hourH) * 60;
}

export function blockHeight(durMin: number, hourH: number): number {
  return Math.max((durMin / 60) * hourH - 2, MIN_BLOCK_H);
}

export type BlockDensity = "full" | "compact" | "tiny";

// La regla del prototipo: rango completo si hay lugar, sólo la hora de inicio
// si el bloque es corto, y el título SIEMPRE.
export function blockDensity(h: number): BlockDensity {
  if (h < 26) return "tiny";
  if (h < 46) return "compact";
  return "full";
}

export interface Placed {
  event: AgendaEvent;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/** Minutos de un evento acotados a la ventana visible (los multi-día se recortan). */
export function eventMinutes(e: AgendaEvent): { startMin: number; endMin: number } {
  const startMin = Math.max(0, Math.min(24 * 60, minutesOfDay(e.start)));
  const rawEnd = minutesOfDay(e.end);
  // Un fin en 00:00 es un evento que termina a medianoche o cruza de día: se
  // recorta a la ventana en vez de fabricar una altura negativa.
  const endMin = Math.min(24 * 60, Math.max(startMin + 15, rawEnd > startMin ? rawEnd : startMin + 15));
  return { startMin, endMin };
}

/**
 * Carriles de solapamiento: los eventos que se tocan se agrupan y se reparten
 * en 1/n del ancho, como Google Calendar y FullCalendar (algoritmo del prototipo).
 */
export function layoutLanes(
  items: Array<{ startMin: number; endMin: number }>,
): Map<{ startMin: number; endMin: number }, { lane: number; lanes: number }> {
  const sorted = items
    .slice()
    .sort(
      (a, b) => a.startMin - b.startMin || b.endMin - b.startMin - (a.endMin - a.startMin),
    );
  const groups: Array<typeof sorted> = [];
  let group: typeof sorted = [];
  let groupEnd = -1;
  for (const e of sorted) {
    if (group.length && e.startMin >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(e);
    groupEnd = Math.max(groupEnd, e.endMin);
  }
  if (group.length) groups.push(group);

  const out = new Map<{ startMin: number; endMin: number }, { lane: number; lanes: number }>();
  for (const g of groups) {
    const laneEnds: number[] = [];
    const assign = new Map<{ startMin: number; endMin: number }, number>();
    for (const e of g) {
      let l = 0;
      while (l < laneEnds.length && laneEnds[l] > e.startMin) l++;
      laneEnds[l] = e.endMin;
      assign.set(e, l);
    }
    for (const e of g) out.set(e, { lane: assign.get(e) ?? 0, lanes: laneEnds.length });
  }
  return out;
}
