import { useEffect, useMemo, useState } from "react";
import { api, type AgendaData, type EventDTO, type TaskDTO } from "./api";

const HOUR_H = 46;

function parseDT(s: string): Date {
  const [d, t] = s.split(" ");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = (t || "00:00:00").split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm, 0, 0);
}
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7; // Monday = 0
  return addDays(x, -shift);
}
function hhmm(s: string): string {
  return s.slice(11, 16);
}
function minutesOfDay(iso: string): number {
  const t = iso.split(" ")[1] || "00:00:00";
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MONTH_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic",
];

function rangeTitle(start: Date, end: Date, mode: "week" | "day"): string {
  if (mode === "day") {
    const s = `${DAY_NAMES[(start.getDay() + 6) % 7]} ${start.getDate()} de ${MONTH_SHORT[start.getMonth()]}`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth();
  const a = `${start.getDate()} de ${MONTH_SHORT[start.getMonth()]}`;
  const b = sameMonth ? `${last.getDate()}` : `${last.getDate()} de ${MONTH_SHORT[last.getMonth()]}`;
  return `${a} – ${b}`;
}

export default function Agenda({ onOpenMeeting }: { onOpenMeeting: (name: string) => void }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<"week" | "day">("week");
  const [data, setData] = useState<AgendaData | null>(null);
  const [loading, setLoading] = useState(true);

  const start = mode === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const days = mode === "week" ? 7 : 1;
  const end = addDays(start, days);
  const startKey = ymd(start);

  useEffect(() => {
    setLoading(true);
    api
      .getAgenda(startKey, ymd(end))
      .then(setData)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, mode]);

  // Rango horario visible: se adapta a los datos (7–21 por defecto).
  const { h0, h1 } = useMemo(() => {
    let lo = 7;
    let hi = 21;
    for (const e of data?.events ?? []) {
      const s = Math.floor(minutesOfDay(e.starts_on) / 60);
      const en = Math.ceil(minutesOfDay(e.ends_on) / 60);
      lo = Math.min(lo, s);
      hi = Math.max(hi, en);
    }
    for (const t of data?.tasks ?? []) {
      if (!t.due_datetime) continue;
      const s = Math.floor(minutesOfDay(t.due_datetime) / 60);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s + 1);
    }
    return { h0: Math.max(0, lo), h1: Math.min(23, Math.max(hi, lo + 4)) };
  }, [data]);

  const hours = [];
  for (let h = h0; h <= h1; h++) hours.push(h);
  const gridH = (h1 - h0) * HOUR_H;
  const now = new Date();
  const offsetFor = (min: number) => ((min - h0 * 60) / 60) * HOUR_H;

  const daysArr = Array.from({ length: days }, (_, i) => addDays(start, i));

  function eventsFor(day: Date): EventDTO[] {
    return (data?.events ?? []).filter((e) => sameDay(parseDT(e.starts_on), day));
  }
  function tasksFor(day: Date): TaskDTO[] {
    return (data?.tasks ?? []).filter(
      (t) => t.due_datetime && sameDay(parseDT(t.due_datetime), day),
    );
  }

  const [creating, setCreating] = useState<{ day: Date; hour: number } | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitEvent() {
    if (!creating || !title.trim() || saving) return;
    setSaving(true);
    const p = (n: number) => String(n).padStart(2, "0");
    const starts = `${ymd(creating.day)} ${p(creating.hour)}:00:00`;
    const ends = `${ymd(creating.day)} ${p(Math.min(creating.hour + 1, 23))}:00:00`;
    try {
      await api.createEvent(title.trim(), starts, ends);
      setData(await api.getAgenda(startKey, ymd(end)));
      setCreating(null);
      setTitle("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ag">
      <div className="ag-bar">
        <div className="ag-range">{rangeTitle(start, end, mode)}</div>
        <div className="ag-actions">
          <div className="seg">
            <button className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>
              Día
            </button>
            <button className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>
              Semana
            </button>
          </div>
          <button className="ghost" onClick={() => setAnchor(new Date())}>
            Hoy
          </button>
          <div className="pager">
            <button className="icon" onClick={() => setAnchor(addDays(anchor, mode === "week" ? -7 : -1))}>
              ‹
            </button>
            <button className="icon" onClick={() => setAnchor(addDays(anchor, mode === "week" ? 7 : 1))}>
              ›
            </button>
          </div>
        </div>
      </div>

      <div className={`ag-grid${mode === "day" ? " one" : ""}${loading ? " loading" : ""}`}>
        <div className="ag-gutter" style={{ height: gridH }}>
          {hours.map((h) => (
            <div className="ag-hourlabel" key={h} style={{ top: offsetFor(h * 60) }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {daysArr.map((day) => {
          const evs = eventsFor(day);
          const tks = tasksFor(day);
          const isToday = sameDay(day, now);
          return (
            <div className="ag-col" key={ymd(day)}>
              <div className={`ag-dayhead${isToday ? " today" : ""}`}>
                <span className="dow">{DAY_NAMES[(day.getDay() + 6) % 7].slice(0, 3)}</span>
                <span className="dom">{day.getDate()}</span>
              </div>
              <div className="ag-body" style={{ height: gridH }}>
                {hours.map((h) => (
                  <div className="ag-line" key={h} style={{ top: offsetFor(h * 60) }} />
                ))}
                <div className="ag-slots">
                  {hours.map((h) => (
                    <div
                      className="ag-slot"
                      key={h}
                      style={{ top: offsetFor(h * 60), height: HOUR_H }}
                      onClick={() => {
                        setTitle("");
                        setCreating({ day, hour: h });
                      }}
                    />
                  ))}
                </div>

                {evs.map((e) => {
                  const top = offsetFor(minutesOfDay(e.starts_on));
                  const bottom = offsetFor(minutesOfDay(e.ends_on));
                  const height = Math.max(22, bottom - top);
                  return (
                    <div
                      className="ag-event"
                      key={e.name}
                      style={{ top, height }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpenMeeting(e.name);
                      }}
                    >
                      <div className="ev-time">{hhmm(e.starts_on)}</div>
                      <div className="ev-title">{e.subject}</div>
                    </div>
                  );
                })}

                {tks.map((t) => (
                  <div
                    className="ag-task"
                    key={t.name}
                    style={{ top: offsetFor(minutesOfDay(t.due_datetime!)) }}
                    title={`Tarea: ${t.subject}`}
                  >
                    <span className="dot" />
                    <span className="t">{t.subject}</span>
                  </div>
                ))}

                {isToday ? (
                  <div className="ag-now" style={{ top: offsetFor(now.getHours() * 60 + now.getMinutes()) }} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {creating ? (
        <div className="overlay" onClick={() => setCreating(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nuevo evento</h3>
            <p className="modal-when">
              {DAY_NAMES[(creating.day.getDay() + 6) % 7]} {creating.day.getDate()} ·{" "}
              {String(creating.hour).padStart(2, "0")}:00–{String(Math.min(creating.hour + 1, 23)).padStart(2, "0")}:00
            </p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitEvent();
                if (e.key === "Escape") setCreating(null);
              }}
              placeholder="Título del evento…"
            />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setCreating(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={submitEvent} disabled={!title.trim() || saving}>
                {saving ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
