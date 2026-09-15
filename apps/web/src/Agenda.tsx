import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AgendaData, type EventDTO, type TaskDTO } from "./api";
import { IconChevronLeft, IconChevronRight, IconPlus } from "./icons";

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
  return addDays(x, -((x.getDay() + 6) % 7));
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

const DOW = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DOW_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function rangeTitle(start: Date, end: Date, mode: "week" | "day"): string {
  if (mode === "day") {
    const s = `${DOW[(start.getDay() + 6) % 7]} ${start.getDate()} de ${MON[start.getMonth()]}`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth();
  const a = `${start.getDate()} de ${MON[start.getMonth()]}`;
  const b = sameMonth ? `${last.getDate()}` : `${last.getDate()} de ${MON[last.getMonth()]}`;
  return `${a} – ${b}`;
}

export default function Agenda({ onOpenMeeting }: { onOpenMeeting: (name: string) => void }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<"week" | "day">(() =>
    typeof window !== "undefined" && window.innerWidth < 760 ? "day" : "week",
  );
  const [data, setData] = useState<AgendaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<{ day: Date; hour: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const createRef = useRef<HTMLInputElement>(null);

  const start = mode === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const days = mode === "week" ? 7 : 1;
  const end = addDays(start, days);
  const startKey = ymd(start);

  async function reload() {
    setData(await api.getAgenda(startKey, ymd(end)));
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, mode]);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  const { h0, h1 } = useMemo(() => {
    let lo = 7;
    let hi = 21;
    for (const e of data?.events ?? []) {
      lo = Math.min(lo, Math.floor(minutesOfDay(e.starts_on) / 60));
      hi = Math.max(hi, Math.ceil(minutesOfDay(e.ends_on) / 60));
    }
    for (const t of data?.tasks ?? []) {
      if (!t.due_datetime) continue;
      const s = Math.floor(minutesOfDay(t.due_datetime) / 60);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s + 1);
    }
    return { h0: Math.max(0, lo), h1: Math.min(23, Math.max(hi, lo + 4)) };
  }, [data]);

  const hours: number[] = [];
  for (let h = h0; h <= h1; h++) hours.push(h);
  const gridH = (h1 - h0) * HOUR_H;
  const now = new Date();
  const offsetFor = (min: number) => ((min - h0 * 60) / 60) * HOUR_H;
  const daysArr = Array.from({ length: days }, (_, i) => addDays(start, i));

  function eventsFor(day: Date): EventDTO[] {
    return (data?.events ?? []).filter((e) => sameDay(parseDT(e.starts_on), day));
  }
  function tasksFor(day: Date): TaskDTO[] {
    return (data?.tasks ?? []).filter((t) => t.due_datetime && sameDay(parseDT(t.due_datetime), day));
  }

  async function submitCreate() {
    if (!creating || !draft.trim() || saving) return;
    setSaving(true);
    const p = (n: number) => String(n).padStart(2, "0");
    const starts = `${ymd(creating.day)} ${p(creating.hour)}:00:00`;
    const ends = `${ymd(creating.day)} ${p(Math.min(creating.hour + 1, 23))}:00:00`;
    try {
      await api.createEvent(draft.trim(), starts, ends);
      setCreating(null);
      setDraft("");
      await reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ag">
      <div className="ag-bar">
        <div className="ag-left">
          <h1 className="ag-range">{rangeTitle(start, end, mode)}</h1>
          <button className="ghost" onClick={() => setAnchor(new Date())}>
            Hoy
          </button>
        </div>
        <div className="ag-actions">
          <div className="seg" role="tablist" aria-label="Vista">
            <button className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>
              Día
            </button>
            <button className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>
              Semana
            </button>
          </div>
          <div className="pager">
            <button
              className="pager-btn"
              aria-label="Anterior"
              onClick={() => setAnchor(addDays(anchor, mode === "week" ? -7 : -1))}
            >
              <IconChevronLeft />
            </button>
            <button
              className="pager-btn"
              aria-label="Siguiente"
              onClick={() => setAnchor(addDays(anchor, mode === "week" ? 7 : 1))}
            >
              <IconChevronRight />
            </button>
          </div>
        </div>
      </div>

      <div className="ag-scroll">
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
          const isCreating = creating && sameDay(creating.day, day);
          return (
            <div className="ag-col" key={ymd(day)}>
              <div className={`ag-dayhead${isToday ? " today" : ""}`}>
                <span className="dow">{DOW_SHORT[(day.getDay() + 6) % 7]}</span>
                <span className="dom">{day.getDate()}</span>
              </div>
              <div className="ag-body" style={{ height: gridH }}>
                {hours.map((h) => (
                  <div className="ag-line" key={h} style={{ top: offsetFor(h * 60) }} />
                ))}
                <div className="ag-slots">
                  {hours.map((h) => (
                    <button
                      className="ag-slot"
                      key={h}
                      style={{ top: offsetFor(h * 60), height: HOUR_H }}
                      aria-label={`Crear evento ${String(h).padStart(2, "0")}:00`}
                      onClick={() => {
                        setDraft("");
                        setCreating({ day, hour: h });
                      }}
                    >
                      <span className="ag-slot-plus">
                        <IconPlus width={13} height={13} />
                      </span>
                    </button>
                  ))}
                </div>

                {isCreating ? (
                  <input
                    ref={createRef}
                    className="ag-create"
                    style={{ top: offsetFor(creating!.hour * 60), height: HOUR_H - 2 }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitCreate();
                      if (e.key === "Escape") setCreating(null);
                    }}
                    onBlur={() => setCreating(null)}
                    placeholder="Título del evento…"
                  />
                ) : null}

                {evs.map((e) => {
                  const top = offsetFor(minutesOfDay(e.starts_on));
                  const bottom = offsetFor(minutesOfDay(e.ends_on));
                  const height = Math.max(26, bottom - top);
                  return (
                    <button
                      className="ag-event"
                      key={e.name}
                      style={{ top, height }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpenMeeting(e.name);
                      }}
                    >
                      <span className="ev-time">{hhmm(e.starts_on)}</span>
                      <span className="ev-title">{e.subject}</span>
                    </button>
                  );
                })}

                {tks.map((t) => (
                  <div
                    className="ag-task"
                    key={t.name}
                    style={{ top: offsetFor(minutesOfDay(t.due_datetime!)) }}
                  >
                    <span className="dot" />
                    <span className="t">{t.subject}</span>
                  </div>
                ))}

                {isToday ? (
                  <div
                    className="ag-now"
                    style={{ top: offsetFor(now.getHours() * 60 + now.getMinutes()) }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {!loading && (data?.events.length ?? 0) === 0 ? (
        <p className="ag-hint">
          Las reservas de tu Google Calendar aparecen acá automáticamente. Para cargar una a mano,
          hacé click en cualquier franja horaria.
        </p>
      ) : null}
    </div>
  );
}
