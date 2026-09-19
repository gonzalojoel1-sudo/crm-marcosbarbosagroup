import { useMemo } from "react";
import { accessibleName, addDays, dayLong, fmtMin, sameDay, startOfWeek, ymd } from "./date";
import { eventMinutes } from "./geometry";
import { categoryOf } from "./categories";
import type { AgendaEvent } from "./types";
import styles from "./MonthView.module.css";

const WEEKDAY_COLS = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];

interface MonthViewProps {
  anchor: Date;
  events: AgendaEvent[];
  now: Date;
  label: string;
  /** El fin de semana se muestra por defecto; el toggle de la sidebar lo esconde. */
  showWeekend: boolean;
  onShowList: () => void;
}

/**
 * Un mes ES dato tabular: tabla nativa (semanas como filas, días de semana como
 * <th scope="col">). Nada de role="grid". Se muestran los siete días; con el
 * toggle de la sidebar, sólo los hábiles. Las operaciones sobre eventos en Mes
 * están fuera de alcance: los chips nombran el evento, no ofrecen una acción.
 */
export default function MonthView({
  anchor,
  events,
  now,
  label,
  showWeekend,
  onShowList,
}: MonthViewProps) {
  const cols = showWeekend ? WEEKDAY_COLS : WEEKDAY_COLS.slice(0, 5);
  const rows = useMemo(() => {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const last = new Date(year, month + 1, 0);
    const out: Array<Array<Date | null>> = [];
    let cursor = startOfWeek(new Date(year, month, 1));
    while (cursor <= last) {
      const week: Array<Date | null> = [];
      for (let i = 0; i < cols.length; i++) {
        const d = addDays(cursor, i);
        week.push(d.getMonth() === month ? d : null);
      }
      if (week.some((d) => d !== null)) out.push(week);
      cursor = addDays(cursor, 7);
    }
    return out;
  }, [anchor, cols.length]);

  const eventsOf = (date: Date) =>
    events
      .filter((e) => sameDay(e.start, date))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div className={styles.agxMeswrap}>
      <table className={styles.agxMes}>
        <caption className="sr-only">
          {label}. Se muestran los días de lunes a {showWeekend ? "domingo" : "viernes"}.
        </caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th scope="col" key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, ci) => {
                if (!date) {
                  return <td className={styles.agxMcell} aria-hidden="true" key={ci} />;
                }
                const today = sameDay(date, now);
                const dayEvents = eventsOf(date);
                return (
                  <td
                    className={`${styles.agxMcell}${today ? ` ${styles.hoy}` : ""}`}
                    aria-current={today ? "date" : undefined}
                    key={ymd(date)}
                  >
                    <span className={styles.agxMnum}>{date.getDate()}</span>
                    {dayEvents.slice(0, 3).map((e) => {
                      const { startMin, endMin } = eventMinutes(e);
                      const time = e.allDay ? "Todo el día" : fmtMin(startMin);
                      return (
                        <span
                          className={`${styles.agxMev}${e.busy ? ` ${styles.busy}` : ""}`}
                          key={e.name}
                          title={`${e.subject} · ${time}`}
                        >
                          <span
                            className={styles.agxMevD}
                            style={{
                              background: e.busy ? "var(--fg-faint)" : categoryOf(e.category).color,
                            }}
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            {`${accessibleName(
                              dayLong(date),
                              startMin,
                              endMin,
                              e.subject,
                              e.allDay,
                              e.busy ? undefined : e.category,
                            )}${e.busy ? ", importado de Google" : ""}`}
                          </span>
                          <span className={styles.agxMevH} aria-hidden="true">
                            {time}
                          </span>
                          <span className={styles.agxMevT} aria-hidden="true">
                            {e.subject}
                          </span>
                        </span>
                      );
                    })}
                    {dayEvents.length > 3 ? (
                      <button type="button" className={styles.agxMmas} onClick={onShowList}>
                        +{dayEvents.length - 3} más
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
