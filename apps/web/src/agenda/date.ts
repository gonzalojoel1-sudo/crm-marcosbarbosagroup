export const DOW = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

export const DOW_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export const MON_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

export const MON_FULL = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

// Frappe entrega datetimes naive ("2026-09-15 08:30:00") en la zona del sitio.
// Se parsean como hora de pared local; nunca se pasa por toISOString().
export function parseDT(s: string): Date {
  const [d, t] = s.split(" ");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = (t || "00:00:00").split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm, 0, 0);
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, -weekdayIndex(x));
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 0 = lunes … 6 = domingo (la agenda es una semana Lun–Vie). */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtMin(min: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(min / 60))}:${p(min % 60)}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "lunes 15 de septiembre" — la etiqueta de día del nombre accesible. */
export function dayLong(d: Date): string {
  return `${DOW[weekdayIndex(d)]} ${d.getDate()} de ${MON_FULL[d.getMonth()]}`;
}

/** "martes 16" — el día sin mes, como el encabezado del panel del prototipo. */
export function dayShort(d: Date): string {
  return `${DOW[weekdayIndex(d)]} ${d.getDate()}`;
}

/** Rango de la semana, como el prototipo: "15 – 19 de septiembre". */
export function rangeTitle(start: Date, end: Date): string {
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} de ${MON_FULL[start.getMonth()]}`;
  }
  return `${start.getDate()} de ${MON_SHORT[start.getMonth()]} – ${end.getDate()} de ${MON_FULL[end.getMonth()]}`;
}

/**
 * Nombre accesible autosuficiente: día + horario + título + agenda. Es el nombre
 * que el prototipo mide (arnés 9f). La categoría sólo se agrega si existe: hoy el
 * `Event` de Frappe no la expone en el DTO, y no se inventa.
 */
export function accessibleName(
  dayLabel: string,
  startMin: number,
  endMin: number,
  subject: string,
  allDay: boolean,
  category?: string,
): string {
  const when = allDay ? "todo el día" : `${fmtMin(startMin)} a ${fmtMin(endMin)}`;
  const parts = [dayLabel, when, subject];
  if (category) parts.push(category);
  return parts.join(", ");
}
