import { useEffect, useRef, useState } from "react";
import { api, type EventDTO, type HoyData, type TaskDTO } from "./api";
import "./styles.css";

function fmtLongDate(iso: string): string {
  try {
    const d = new Date(`${iso}T12:00:00`);
    const s = d.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return iso;
  }
}

function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(11, 16);
}

function relativeDue(iso: string | null | undefined): string {
  if (!iso) return "";
  return hhmm(iso);
}

function TaskRow({
  task,
  overdue,
  onComplete,
}: {
  task: TaskDTO;
  overdue?: boolean;
  onComplete: (t: TaskDTO) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <li
      className={`task${overdue ? " overdue" : ""}${leaving ? " leaving" : ""}`}
      onClick={() => {
        setLeaving(true);
        onComplete(task);
      }}
    >
      <span className="check" aria-hidden />
      <span className="subject">{task.subject}</span>
      {task.due_datetime ? <span className="when">{relativeDue(task.due_datetime)}</span> : null}
    </li>
  );
}

function EventRow({ event }: { event: EventDTO }) {
  return (
    <li className="event">
      <span className="when">{hhmm(event.starts_on)}</span>
      <span className="subject">{event.subject}</span>
    </li>
  );
}

export default function App() {
  const [data, setData] = useState<HoyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setData(await api.getHoy());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "n" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function addTask() {
    const subject = draft.trim();
    if (!subject || adding) return;
    setAdding(true);
    setDraft("");
    // optimistic: show it immediately in "today"
    const optimistic: TaskDTO = {
      name: `tmp-${Date.now()}`,
      subject,
      due_datetime: null,
      priority: "Medium",
    };
    setData((d) => (d ? { ...d, tasks_today: [optimistic, ...d.tasks_today], count: d.count + 1 } : d));
    try {
      await api.quickAdd(subject);
      await load();
    } catch {
      setData((d) =>
        d ? { ...d, tasks_today: d.tasks_today.filter((t) => t.name !== optimistic.name) } : d,
      );
      setDraft(subject);
    } finally {
      setAdding(false);
    }
  }

  async function completeTask(task: TaskDTO) {
    // optimistic removal
    setData((d) =>
      d
        ? {
            ...d,
            overdue: d.overdue.filter((t) => t.name !== task.name),
            tasks_today: d.tasks_today.filter((t) => t.name !== task.name),
            count: Math.max(0, d.count - 1),
          }
        : d,
    );
    try {
      await api.complete(task.name);
    } catch {
      await load();
    }
  }

  const overdue = data?.overdue ?? [];
  const today = data?.tasks_today ?? [];
  const events = data?.events_today ?? [];
  const count = data?.count ?? 0;

  return (
    <div className="app">
      <div className="glow" aria-hidden />
      <main className="wrap">
        <header className="head">
          <div>
            <h1>Hoy</h1>
            <p className="date">{data ? fmtLongDate(data.today) : "\u00a0"}</p>
          </div>
          <div className={`pill${count === 0 ? " zero" : ""}`}>
            {data ? (count === 0 ? "al día" : `${count} pendiente${count === 1 ? "" : "s"}`) : "…"}
          </div>
        </header>

        <div className="quick">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
            placeholder="Nueva tarea…"
            autoComplete="off"
            autoFocus
          />
          <kbd>N</kbd>
        </div>

        {error ? <div className="error">No se pudo cargar. {error}</div> : null}

        {!data && !error ? (
          <div className="skeleton">
            <div className="sk" />
            <div className="sk" />
            <div className="sk" />
          </div>
        ) : null}

        {data && overdue.length > 0 ? (
          <section>
            <h2>
              Vencidas <span className="badge danger">{overdue.length}</span>
            </h2>
            <ul className="list">
              {overdue.map((t) => (
                <TaskRow key={t.name} task={t} overdue onComplete={completeTask} />
              ))}
            </ul>
          </section>
        ) : null}

        {data ? (
          <section>
            <h2>Hoy</h2>
            {today.length > 0 ? (
              <ul className="list">
                {today.map((t) => (
                  <TaskRow key={t.name} task={t} onComplete={completeTask} />
                ))}
              </ul>
            ) : (
              <div className="empty">
                <span className="empty-emoji">✓</span>
                Nada pendiente para hoy
              </div>
            )}
          </section>
        ) : null}

        {data ? (
          <section>
            <h2>Eventos</h2>
            {events.length > 0 ? (
              <ul className="list">
                {events.map((e) => (
                  <EventRow key={e.name} event={e} />
                ))}
              </ul>
            ) : (
              <div className="empty">
                <span className="empty-emoji">◷</span>
                Sin eventos
              </div>
            )}
          </section>
        ) : null}

        <footer className="foot">
          <span className="kbd-hint">
            <kbd>N</kbd> nueva tarea · <kbd>Enter</kbd> guardar
          </span>
        </footer>
      </main>
    </div>
  );
}
