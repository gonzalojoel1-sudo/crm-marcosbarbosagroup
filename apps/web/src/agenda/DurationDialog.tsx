import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { dayLong, fmtMin } from "./date";
import { END_H } from "./geometry";
import type { AgendaEvent } from "./types";
import { placeFloating, type Anchor } from "./floating";

interface DurationDialogProps {
  event: AgendaEvent;
  day: Date;
  startMin: number;
  durMin: number;
  anchor: Anchor;
  onApply: (durMin: number) => void;
  onClose: () => void;
}

const PRESETS = [15, 30, 45, 60, 90, 120] as const;
const DUR_MIN = 15;

/**
 * "Cambiar duración…" (spec S3): redimensionar sin arrastrar. Espeja "Mover a…":
 * borrador + Aplicar, Escape no escribe, y los presets/pasos son <button> para
 * que puntero y teclado usen lo mismo. El control que no puede cambiar la
 * duración se deshabilita (disabled + aria-disabled), no se recorta en silencio.
 *
 * Tab recorre los controles y cicla en los extremos, saltando los deshabilitados.
 */
export default function DurationDialog({
  event,
  day,
  startMin,
  durMin,
  anchor,
  onApply,
  onClose,
}: DurationDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dur, setDur] = useState(durMin);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    placeFloating(el, anchor);
    const onResize = () => placeFloating(el, anchor);
    window.addEventListener("resize", onResize);
    const primero = el.querySelector<HTMLButtonElement>("button[data-dpreset]:not(:disabled)");
    (primero ?? el.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
    return () => window.removeEventListener("resize", onResize);
  }, [anchor]);

  const presetOk = (v: number) => startMin + v <= END_H * 60;
  const pasoOk = (delta: number) =>
    dur + delta >= DUR_MIN && startMin + dur + delta <= END_H * 60;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const el = rootRef.current;
      if (!el) return;
      const ctr = Array.from(el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const idx = ctr.indexOf(document.activeElement as HTMLButtonElement);
      const dir = e.shiftKey ? -1 : 1;
      ctr[(idx + dir + ctr.length) % ctr.length]?.focus();
      e.preventDefault();
    }
  }

  return (
    <div
      className="agx-modal"
      role="dialog"
      aria-modal="false"
      aria-labelledby="agx-dur-titulo"
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={{ left: anchor.x, top: anchor.y }}
    >
      <h2 className="agx-modal-title" id="agx-dur-titulo">
        Cambiar duración · {event.subject}
      </h2>
      <p className="agx-modal-sub" id="agx-dur-hora">
        {dayLong(day)}, {fmtMin(startMin)} – {fmtMin(startMin + dur)}
      </p>

      <span className="agx-modal-lab" id="agx-dur-presets-lab">
        Duración
      </span>
      <div className="agx-modal-group" role="group" aria-labelledby="agx-dur-presets-lab">
        {PRESETS.map((v) => {
          const ok = presetOk(v);
          return (
            <button
              key={v}
              type="button"
              data-dpreset={v}
              className={v === dur ? "on" : ""}
              aria-pressed={v === dur}
              aria-label={`${v} minutos`}
              aria-disabled={!ok}
              disabled={!ok}
              onClick={() => setDur(v)}
            >
              {v} min
            </button>
          );
        })}
      </div>

      <span className="agx-modal-lab" id="agx-dur-pasos-lab">
        Ajustar
      </span>
      <div className="agx-modal-group" role="group" aria-labelledby="agx-dur-pasos-lab">
        {[-15, 15].map((delta) => {
          const ok = pasoOk(delta);
          const label = delta < 0 ? "−15 min" : "+15 min";
          return (
            <button
              key={delta}
              type="button"
              data-dpaso={delta}
              aria-label={label}
              aria-disabled={!ok}
              disabled={!ok}
              onClick={() => setDur((d) => d + delta)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="agx-modal-acciones">
        <button type="button" className="agx-modal-aplicar" onClick={() => onApply(dur)}>
          Aplicar
        </button>
        <button type="button" className="agx-modal-cancelar" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
