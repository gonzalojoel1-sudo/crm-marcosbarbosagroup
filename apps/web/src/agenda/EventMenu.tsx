import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgendaEvent } from "./types";
import { placeFloating, type Anchor } from "./floating";

export type MenuAction = "editar" | "mover" | "duracion" | "duplicar" | "eliminar";

interface EventMenuProps {
  event: AgendaEvent;
  anchor: Anchor;
  onEditar: () => void;
  onMover: () => void;
  onDuracion: () => void;
  onDuplicar: () => void;
  onEliminar: () => void;
  onClose: (returnFocus: boolean) => void;
  /** Supr abre directo la confirmación de borrado (spec S4). */
  initialConfirm?: boolean;
}

/**
 * Menú de la reunión (spec S3). Se abre con Enter/Space o con un click sin
 * arrastre; el foco entra al primer ítem, las flechas ciclan, Escape cierra y
 * devuelve el foco a la reunión. "Eliminar" pide confirmación EN LÍNEA, en el
 * mismo menú, nunca en un modal anidado.
 *
 * No se muestran atajos de una letra: los del prototipo (E/M/D/Supr) pertenecen
 * al nudge por teclado, que no está en esta fase. Un hint de una tecla que no
 * hace nada es una promesa falsa.
 */
export default function EventMenu({
  event,
  anchor,
  onEditar,
  onMover,
  onDuracion,
  onDuplicar,
  onEliminar,
  onClose,
  initialConfirm = false,
}: EventMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const siRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(initialConfirm);

  // El foco entra al menú ya: si una flecha llega en el mismo frame, el menú ya
  // tiene el foco. Mover el foco ES el anuncio: abrir nunca escribe la región viva.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    placeFloating(el, anchor);
    const onResize = () => placeFloating(el, anchor);
    window.addEventListener("resize", onResize);
    itemRefs.current[0]?.focus();
    return () => window.removeEventListener("resize", onResize);
  }, [anchor]);

  useLayoutEffect(() => {
    if (confirm) siRef.current?.focus();
  }, [confirm]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (confirm) {
      const ctr = [siRef.current, noRef.current].filter(Boolean) as HTMLButtonElement[];
      const idx = ctr.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        return;
      }
      if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        const dir = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
        ctr[(idx + dir + ctr.length) % ctr.length]?.focus();
        e.preventDefault();
      }
      return;
    }

    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      items[(idx + 1) % items.length]?.focus();
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp") {
      items[(idx - 1 + items.length) % items.length]?.focus();
      e.preventDefault();
      return;
    }
    // Tab también cierra: si no, el foco saldría y el menú quedaría huérfano.
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose(true);
    }
  }

  // Las teclas mostradas son reales (F4.4 las implementa y las acota al foco):
  // antes el menú no las mostraba porque un hint de una tecla muerta es una
  // promesa falsa.
  const acciones: Array<{ id: MenuAction; label: string; tecla?: string; run: () => void }> = [
    { id: "editar", label: "Editar", tecla: "E", run: onEditar },
    { id: "mover", label: "Mover a…", tecla: "M", run: onMover },
    { id: "duracion", label: "Cambiar duración…", tecla: "D", run: onDuracion },
    { id: "duplicar", label: "Duplicar", run: onDuplicar },
    {
      id: "eliminar",
      label: "Eliminar",
      tecla: "Supr",
      run: () => setConfirm(true),
    },
  ];

  return (
    <div
      className="agx-menu"
      role="menu"
      aria-label={`Acciones para ${event.subject}`}
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={{ left: anchor.x, top: anchor.y }}
    >
      {confirm ? (
        <div className="agx-confirm" role="group" aria-label={`Confirmar eliminación de ${event.subject}`}>
          <p className="agx-confirm-p">¿Eliminar {event.subject}?</p>
          <button ref={siRef} type="button" className="agx-confirm-si" onClick={onEliminar}>
            Sí, eliminar
          </button>
          <button ref={noRef} type="button" className="agx-confirm-no" onClick={() => onClose(true)}>
            Cancelar
          </button>
        </div>
      ) : (
        acciones.map((a, i) => (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            data-accion={a.id}
            className="agx-menu-item"
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            onClick={a.run}
          >
            <span className="agx-menu-label">{a.label}</span>
            {a.tecla ? (
              <span className="agx-menu-tecla" aria-hidden="true">
                {a.tecla}
              </span>
            ) : null}
          </button>
        ))
      )}
    </div>
  );
}
