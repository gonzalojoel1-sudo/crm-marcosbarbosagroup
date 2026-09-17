import { useMemo } from "react";
import { accessibleName, addDays, dayLong, fmtMin, sameDay, startOfWeek, ymd } from "./date";
import { eventMinutes } from "./geometry";
import type { AgendaEvent } from "./types";

const WEEKDAY_COLS = ["lunes", "martes", "miércoles", "jueves", "viernes"];

interface MonthViewProps {
  anchor: Date;
  events: AgendaEvent[];
  now: Date;
  label: string;
  onShowList: () => void;
}

/**
 * Un mes ES dato tabular: tabla nativa (semanas como filas, días de semana como
 * <th scope="col">). Nada de role="grid". Se muestran sólo los días hábiles,
 * igual que la grilla. Las operaciones sobre eventos en Mes están fuera de
 * alcance: los chips nombran el evento, no ofrecen una acción.
 */
export default function MonthView({ anchor, events, now, label, onShowList }: MonthViewProps) {
  const rows = useMemo(() => {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const last = new Date(year, month + 1, 0);
    const out: Array<Array<Date | null>> = [];
    let cursor = startOfWeek(new Date(year, month, 1));
    while (cursor <= last) {
      const week: Array<Date | null> = [];
      for (let i = 0; i < 5; i++) {
        const d = addDays(cursor, i);
        week.push(d.getMonth() === month ? d : null);
      }
      if (week.some((d) => d !== null)) out.push(week);
      cursor = addDays(cursor, 7);
    }
    return out;
  }, [anchor]);

  const eventsOf = (date: Date) =>
    events
      .filter((e) => sameDay(e.start, date))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div className="agx-meswrap">
      <table className="agx-mes">
        <caption className="sr-only">{label}. Se muestran los días de lunes a viernes.</caption>
        <thead>
          <tr>
            {WEEKDAY_COLS.map((c) => (
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
                  return <td className="agx-mcell empty" aria-hidden="true" key={ci} />;
                }
                const today = sameDay(date, now);
                const dayEvents = eventsOf(date);
                return (
                  <td
                    className={`agx-mcell${today ? " hoy" : ""}`}
                    aria-current={today ? "date" : undefined}
                    key={ymd(date)}
                  >
                    <span className="agx-mnum">{date.getDate()}</span>
                    {dayEvents.slice(0, 3).map((e) => {
                      const { startMin, endMin } = eventMinutes(e);
                      const time = e.allDay ? "Todo el día" : fmtMin(startMin);
                      return (
                        <span className="agx-mev" key={e.name} title={`${e.subject} · ${time}`}>
                          <span className="agx-mev-d" aria-hidden="true" />
                          <span className="sr-only">
                            {accessibleName(dayLong(date), startMin, endMin, e.subject, e.allDay, e.category)}
                          </span>
                          <span className="agx-mev-h" aria-hidden="true">
                            {time}
                          </span>
                          <span className="agx-mev-t" aria-hidden="true">
                            {e.subject}
                          </span>
                        </span>
                      );
                    })}
                    {dayEvents.length > 3 ? (
                      <button type="button" className="agx-mmas" onClick={onShowList}>
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
