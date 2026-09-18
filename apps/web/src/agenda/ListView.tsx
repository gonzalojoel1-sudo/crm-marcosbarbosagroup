import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { accessibleName, dayLong, fmtMin, minutesOfDay, sameDay, ymd } from "./date";
import { eventMinutes } from "./geometry";
import { categoryOf } from "./categories";
import { accessibleTaskName } from "./tasks";
import { IconCheck } from "../icons";
import type { AgendaEvent, AgendaTask } from "./types";
import styles from "./ListView.module.css";
import taskStyles from "./Task.module.css";

interface ListViewProps {
  days: Date[];
  events: AgendaEvent[];
  now: Date;
  onNewDay: (dayIndex: number) => void;
  onOpenMenu: (event: AgendaEvent, trigger: HTMLElement) => void;
  expandedName: string | null;
  tasksByDay: AgendaTask[][];
  onCompleteTask: (task: AgendaTask) => void;
}

function countLabel(n: number): string {
  if (n === 0) return "sin reuniones";
  return n === 1 ? "1 reunión" : `${n} reuniones`;
}

/**
 * La Lista es un compuesto APG: un único tab stop (roving tabindex), flechas
 * adentro y cada fila es un <button> real. Enter/Space y el click abren el
 * MISMO menú que un bloque de la grilla (S3/S6): la Lista no tiene acciones
 * propias ni reimplementa nada.
 */
export default function ListView({
  days,
  events,
  now,
  onNewDay,
  onOpenMenu,
  expandedName,
  tasksByDay,
  onCompleteTask,
}: ListViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [roving, setRoving] = useState<string | null>(null);

  const groups = useMemo(
    () =>
      days.map((date) => ({
        date,
        events: events
          .filter((e) => sameDay(e.start, date))
          .sort((a, b) => a.start.getTime() - b.start.getTime()),
      })),
    [days, events],
  );

  const flatNames = groups.flatMap((g) => g.events.map((e) => e.name));
  const effective = roving && flatNames.includes(roving) ? roving : (flatNames[0] ?? null);

  function rows(): HTMLButtonElement[] {
    return Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>("button.agx-lev") ?? []);
  }

  function focusRow(el: HTMLButtonElement | undefined) {
    if (!el) return;
    const name = el.dataset.ev ?? null;
    setRoving(name);
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = rows();
    const current = document.activeElement as HTMLButtonElement | null;
    const idx = current ? all.indexOf(current) : -1;
    if (idx < 0) return;

    // Con modificador (Ctrl+Alt o Shift) las flechas son del nudge (S4), no de
    // la navegación de la Lista: sin este guard el compuesto se las come.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(all[Math.min(idx + 1, all.length - 1)]);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(all[Math.max(idx - 1, 0)]);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusRow(all[0]);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusRow(all[all.length - 1]);
      return;
    }
    // ←/→ saltan al primer evento del día anterior/siguiente que tenga filas.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const day = Number(current?.dataset.day);
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const candidatos = all
        .map((el) => Number(el.dataset.day))
        .filter((d) => (dir > 0 ? d > day : d < day));
      if (!candidatos.length) return;
      const destino = dir > 0 ? Math.min(...candidatos) : Math.max(...candidatos);
      e.preventDefault();
      focusRow(all.find((el) => Number(el.dataset.day) === destino));
    }
  }

  return (
    <div
      className={styles.agxLista}
      role="region"
      aria-label="Lista de reuniones de la semana"
      ref={containerRef}
      onKeyDown={onKeyDown}
    >
      {groups.map((g, i) => {
        const id = `agx-ldia-${i}`;
        const today = sameDay(g.date, now);
        return (
          <section
            className={`${styles.agxLdia}${today ? ` ${styles.today}` : ""}`}
            aria-labelledby={id}
            aria-current={today ? "date" : undefined}
            key={ymd(g.date)}
          >
            <h3 className={styles.agxLdiaH} id={id}>
              <span className={styles.agxLdiaN}>{dayLong(g.date)}</span>
              <span className={styles.agxLdiaC}>{countLabel(g.events.length)}</span>
            </h3>
            <div className={styles.agxLdiaBody}>
              <button
                type="button"
                className={styles.agxLdiaNueva}
                onClick={() => onNewDay(i)}
              >
                Nueva reunión
              </button>
              {g.events.length ? (
                <ul className={styles.agxLevs}>
                  {g.events.map((e) => {
                    const { startMin, endMin } = eventMinutes(e);
                    const time = e.allDay ? "Todo el día" : `${fmtMin(startMin)} – ${fmtMin(endMin)}`;
                    return (
                      <li key={`${e.name}#${startMin}#${endMin}`}>
                        <button
                          type="button"
                          className={styles.agxLev}
                          data-ev={e.name}
                          data-day={i}
                          tabIndex={effective === e.name ? 0 : -1}
                          onFocus={() => setRoving(e.name)}
                          aria-haspopup="menu"
                          aria-expanded={expandedName === e.name}
                          onClick={(ev) => onOpenMenu(e, ev.currentTarget)}
                          title={`${e.subject} · ${time}`}
                          aria-label={accessibleName(
                            dayLong(g.date),
                            startMin,
                            endMin,
                            e.subject,
                            e.allDay,
                            e.category,
                          )}
                        >
                          <span className={styles.agxLevH}>{time}</span>
                          <span className={styles.agxLevT}>{e.subject}</span>
                          {e.category ? (
                            <span className={styles.agxLevC}>
                              <i
                                className={styles.agxLevDot}
                                style={{ background: categoryOf(e.category).color }}
                                aria-hidden="true"
                              />
                              {categoryOf(e.category).label}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.agxLvy}>Sin reuniones</p>
              )}
              {tasksByDay[i].length ? (
                <ul className={taskStyles.agxLtasks} aria-label="Tareas del día">
                  {tasksByDay[i].map((t) => {
                    const dueMin = t.due ? minutesOfDay(t.due) : 0;
                    return (
                      <li key={t.name}>
                        <button
                          type="button"
                          className={taskStyles.agxTask}
                          onClick={() => onCompleteTask(t)}
                          title={`Tarea: ${t.subject} · ${fmtMin(dueMin)} · marcar como hecha`}
                          aria-label={accessibleTaskName(
                            dayLong(g.date),
                            dueMin,
                            t.subject,
                            t.priority,
                          )}
                        >
                          <IconCheck className={taskStyles.agxTaskIco} />
                          <span className={taskStyles.agxTaskT} aria-hidden="true">
                            {t.subject}
                          </span>
                          <span className={taskStyles.agxTaskH} aria-hidden="true">
                            {fmtMin(dueMin)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
