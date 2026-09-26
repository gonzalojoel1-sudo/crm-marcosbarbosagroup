import { IconChevronLeft, IconChevronRight } from "../icons";
import { fmtMin, minutesOfDay } from "./date";
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
  now: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNew: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export default function Toolbar({
  view,
  onView,
  density,
  onDensity,
  title,
  count,
  now,
  onPrev,
  onNext,
  onToday,
  onNew,
  panelOpen,
  onTogglePanel,
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
          <button
            type="button"
            className={styles.agxPanelToggle}
            title="Mostrar u ocultar el panel del mes"
            aria-pressed={!panelOpen}
            aria-label="Panel del mes"
            onClick={onTogglePanel}
          >
            Panel
          </button>
        ) : null}
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
        {/* EXCEPCIÓN CONOCIDA DE FIDELIDAD (2026-09-26): este pager NO existe en
            el prototipo. `grep -c "pager\|chevron" prototypes/agenda/index.html`
            da 0: el prototipo no tiene forma de cambiar de período salvo los
            atajos de teclado. Se conserva porque es una mejora deliberada — con
            teclado alcanza, con puntero no — y la lista de excepciones del spec de
            fidelidad lo nombra explícitamente en vez de dejarlo romper en silêncio.
            Si algún día se saca, el bloque de excepciones de
            `e2e/agenda.fidelity.spec.ts` (`EXCEPCIONES`) queda con una entrada de
            más y hay que borrarla ahí también. */}
        <div className={styles.agxPager}>
          <button type="button" className={styles.agxPagerBtn} aria-label="Período anterior" onClick={onPrev}>
            <IconChevronLeft />
          </button>
          <button type="button" className={styles.agxPagerBtn} aria-label="Período siguiente" onClick={onNext}>
            <IconChevronRight />
          </button>
        </div>
        <button
          type="button"
          className={styles.agxToday}
          title="Ir a la hora actual (H)"
          onClick={onToday}
        >
          Hoy · {fmtMin(minutesOfDay(now))}
        </button>
        <button type="button" className={styles.agxNew} onClick={onNew}>
          Nueva reunión
        </button>
      </div>
    </div>
  );
}
