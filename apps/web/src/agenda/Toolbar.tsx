import { IconChevronLeft, IconChevronRight } from "../icons";
import { ZOOM_STEPS, type AgendaView, type DensityStep } from "./types";
import styles from "./Toolbar.module.css";

const VIEW_OPTIONS: Array<{ id: AgendaView; label: string }> = [
  { id: "semana", label: "Semana" },
  { id: "lista", label: "Lista" },
  { id: "mes", label: "Mes" },
];

interface ToolbarProps {
  view: AgendaView;
  onView: (v: AgendaView) => void;
  density: DensityStep;
  onDensity: (d: DensityStep) => void;
  title: string;
  count: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNew: () => void;
}

export default function Toolbar({
  view,
  onView,
  density,
  onDensity,
  title,
  count,
  onPrev,
  onNext,
  onToday,
  onNew,
}: ToolbarProps) {
  return (
    <div className={styles.agxBar}>
      <div className={styles.agxBarLeft}>
        <h1 className={styles.agxTitle}>{title}</h1>
        <span className={styles.agxCount}>{count}</span>
      </div>
      <div className={styles.agxBarRight}>
        <div className={styles.agxSeg} role="group" aria-label="Vista">
          {VIEW_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={view === o.id ? styles.on : ""}
              aria-pressed={view === o.id}
              onClick={() => onView(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {view === "semana" ? (
          <div className={styles.agxZoom} role="group" aria-label="Densidad del calendario">
            {ZOOM_STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={density.id === s.id ? styles.on : ""}
                aria-pressed={density.id === s.id}
                onClick={() => onDensity(s)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.agxPager}>
          <button type="button" className={styles.agxPagerBtn} aria-label="Período anterior" onClick={onPrev}>
            <IconChevronLeft />
          </button>
          <button type="button" className={styles.agxPagerBtn} aria-label="Período siguiente" onClick={onNext}>
            <IconChevronRight />
          </button>
        </div>
        <button type="button" className={styles.agxToday} onClick={onToday}>
          Hoy
        </button>
        <button type="button" className={styles.agxNew} onClick={onNew}>
          Nueva reunión
        </button>
      </div>
    </div>
  );
}
