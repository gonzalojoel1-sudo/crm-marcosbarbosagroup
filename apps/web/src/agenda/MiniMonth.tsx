import { useMemo } from "react";
import { CATEGORIES, CATEGORY_ORDER } from "./categories";
import { MON_FULL, capitalize, sameDay, weekdayIndex, ymd } from "./date";
import styles from "./MiniMonth.module.css";

const WEEKDAY_HEADS = ["L", "M", "M", "J", "V", "S", "D"];

interface MiniMonthProps {
  anchor: Date;
  rangeDays: Date[];
  today: Date;
  eventDays: Set<string>;
}

/**
 * El panel derecho del prototipo (`index.html:1565-1584`): el mini-mes con los
 * puntos de días con eventos, los estados `inrange`/`today`, y la leyenda
 * "Cómo se lee". El mini-mes de 7 columnas y los estados son los del prototipo;
 * los días se calculan del `anchor` real en vez de hardcodear Septiembre.
 */
export default function MiniMonth({ anchor, rangeDays, today, eventDays }: MiniMonthProps) {
  const { cells, label } = useMemo(() => {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = weekdayIndex(first);
    const total = Math.ceil((lead + daysInMonth) / 7) * 7;
    const out: Array<{ n: number | null; key: string }> = [];
    for (let i = 0; i < total; i++) {
      const n = i - lead + 1;
      out.push({ n: n < 1 || n > daysInMonth ? null : n, key: `c${i}` });
    }
    return { cells: out, label: capitalize(MON_FULL[month]) };
  }, [anchor]);

  const rangeKeys = useMemo(() => new Set(rangeDays.map(ymd)), [rangeDays]);

  return (
    <aside className={styles.agxMini}>
      <div>
        <h2 className={styles.agxBlockTitle}>{label}</h2>
        <div className={styles.agxMgrid} aria-hidden="true">
          {WEEKDAY_HEADS.map((h, i) => (
            <span className={styles.agxH} key={`h${i}`}>
              {h}
            </span>
          ))}
          {cells.map((c) => {
            if (c.n === null) return <span key={c.key} />;
            const date = new Date(anchor.getFullYear(), anchor.getMonth(), c.n);
            const inRange = rangeKeys.has(ymd(date));
            const isToday = sameDay(date, today);
            const hasEv = eventDays.has(ymd(date));
            const cls = [
              inRange ? styles.agxInrange : "",
              isToday ? styles.agxToday : "",
              hasEv ? styles.agxHasEv : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <span className={cls} key={c.key}>
                {c.n}
              </span>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className={styles.agxBlockTitle}>Cómo se lee</h2>
        <div className={styles.agxLegend}>
          {CATEGORY_ORDER.map((key) => (
            <div key={key}>
              <i style={{ background: CATEGORIES[key].color }} aria-hidden="true" />
              {CATEGORIES[key].label}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
