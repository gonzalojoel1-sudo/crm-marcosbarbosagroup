import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { DOW_SHORT, dayLong, fmtMin, weekdayIndex, ymd } from "./date";
import { END_H, START_H } from "./geometry";
import type { AgendaEvent } from "./types";
import { placeFloating, type Anchor } from "./floating";
import styles from "./Dialog.module.css";

interface MoveDialogProps {
  event: AgendaEvent;
  days: Date[];
  dayIndex: number;
  startMin: number;
  durMin: number;
  anchor: Anchor;
  onApply: (day: Date, startMin: number) => void;
  onClose: () => void;
}

const PASOS = [-60, -15, 15, 60] as const;

function pasoLabel(p: number): string {
  if (p === -60) return "−1 h";
  if (p === -15) return "−15 min";
  if (p === 60) return "+1 h";
  return "+15 min";
}

/**
 * "Mover a…" (spec S3): mover sin arrastrar. Es una superficie con BORRADOR:
 * nada toca el evento hasta Aplicar y Escape no escribe. Los controles son
 * <button>, así el camino de puntero y el de teclado son el mismo.
 *
 * Tab recorre los controles del diálogo y cicla en los extremos, saltando los
 * deshabilitados: NO cierra (el defecto del prototipo dejaba a un usuario de
 * teclado sin poder llegar nunca a Aplicar). Escape es la única salida.
 */
export default function MoveDialog({
  event,
  days,
  dayIndex,
  startMin,
  durMin,
  anchor,
  onApply,
  onClose,
}: MoveDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dia, setDia] = useState(dayIndex);
  const [min, setMin] = useState(startMin);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    placeFloating(el, anchor);
    const onResize = () => placeFloating(el, anchor);
    window.addEventListener("resize", onResize);
    const primero = el.querySelector<HTMLButtonElement>("button[data-paso]:not(:disabled)");
    (primero ?? el.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
    return () => window.removeEventListener("resize", onResize);
  }, [anchor]);

  const pasoOk = (delta: number) =>
    min + delta >= START_H * 60 && min + delta + durMin <= END_H * 60;

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
      className={styles.agxModal}
      role="dialog"
      aria-modal="false"
      aria-labelledby="agx-mover-titulo"
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={{ left: anchor.x, top: anchor.y }}
    >
      <h2 className={styles.agxModalTitle} id="agx-mover-titulo">
        Mover · {event.subject}
      </h2>
      <p className={styles.agxModalSub} id="agx-mover-hora">
        {dayLong(days[dia])}, {fmtMin(min)} – {fmtMin(min + durMin)}
      </p>

      <span className={styles.agxModalLab} id="agx-mover-pasos-lab">
        Ajustar hora
      </span>
      <div className={styles.agxModalGroup} role="group" aria-labelledby="agx-mover-pasos-lab">
        {PASOS.map((p) => {
          const ok = pasoOk(p);
          return (
            <button
              key={p}
              type="button"
              data-paso={p}
              aria-label={pasoLabel(p)}
              aria-disabled={!ok}
              disabled={!ok}
              onClick={() => setMin((m) => m + p)}
            >
              {pasoLabel(p)}
            </button>
          );
        })}
      </div>

      <span className={styles.agxModalLab} id="agx-mover-dia-lab">
        Mover al día
      </span>
      <div className={styles.agxModalGroup} role="group" aria-labelledby="agx-mover-dia-lab">
        {days.map((d, i) => (
          <button
            key={ymd(d)}
            type="button"
            data-dia={i}
            className={i === dia ? styles.on : ""}
            aria-pressed={i === dia}
            aria-label={dayLong(d)}
            onClick={() => setDia(i)}
          >
            {DOW_SHORT[weekdayIndex(d)]} {d.getDate()}
          </button>
        ))}
      </div>

      <div className={styles.agxModalAcciones}>
        <button
          type="button"
          className={styles.agxModalAplicar}
          onClick={() => {
            const d = days[dia];
            if (d) onApply(d, min);
          }}
        >
          Aplicar
        </button>
        <button type="button" className={styles.agxModalCancelar} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
