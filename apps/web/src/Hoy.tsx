import { useEffect, useRef, useState } from "react";
import { api, type EventDTO, type HoyData, type TaskDTO } from "./api";

function fmtLongDate(iso: string): string {
  try {
    const d = new Date(`${iso}T12:00:00`);
    const s = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return iso;
  }
}
function hhmm(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : "";
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
      {task.due_datetime ? <span className="when">{hhmm(task.due_datetime)}</span> : null}
    </li>
  );
}

export default function Hoy() {
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
              <svg className="empty-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8.5 12.4l2.3 2.3L15.6 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
              {events.map((e: EventDTO) => (
                <li className="event" key={e.name}>
                  <span className="when">{hhmm(e.starts_on)}</span>
                  <span className="subject">{e.subject}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <svg className="empty-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 7.5v5l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
  );
}
