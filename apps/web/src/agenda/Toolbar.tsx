import { IconChevronLeft, IconChevronRight } from "../icons";
import { ZOOM_STEPS, type AgendaView, type DensityStep } from "./types";

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
}: ToolbarProps) {
  return (
    <div className="agx-bar">
      <div className="agx-bar-left">
        <h1 className="agx-title">{title}</h1>
        <span className="agx-count">{count}</span>
      </div>
      <div className="agx-bar-right">
        <div className="agx-seg" role="group" aria-label="Vista">
          {VIEW_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={view === o.id ? "on" : ""}
              aria-pressed={view === o.id}
              onClick={() => onView(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {view === "semana" ? (
          <div className="agx-zoom" role="group" aria-label="Densidad del calendario">
            {ZOOM_STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={density.id === s.id ? "on" : ""}
                aria-pressed={density.id === s.id}
                onClick={() => onDensity(s)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="agx-pager">
          <button type="button" className="agx-pager-btn" aria-label="Período anterior" onClick={onPrev}>
            <IconChevronLeft />
          </button>
          <button type="button" className="agx-pager-btn" aria-label="Período siguiente" onClick={onNext}>
            <IconChevronRight />
          </button>
        </div>
        <button type="button" className="agx-today" onClick={onToday}>
          Hoy
        </button>
      </div>
    </div>
  );
}
