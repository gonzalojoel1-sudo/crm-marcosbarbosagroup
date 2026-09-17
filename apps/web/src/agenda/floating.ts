export interface Anchor {
  /** Borde izquierdo del disparador, en coordenadas de viewport. */
  x: number;
  /** Borde inferior del disparador + 4 px, en coordenadas de viewport. */
  y: number;
}

/**
 * Posiciona un flotante `position: fixed` anclado a un rect, clameado a la
 * ventana: si se saldría por abajo, se da vuelta arriba; si se sale por los
 * costados, se recorta al borde. Es la misma estrategia del menú del prototipo.
 */
export function placeFloating(el: HTMLElement, anchor: Anchor): void {
  const b = el.getBoundingClientRect();
  const x = Math.max(4, Math.min(anchor.x, window.innerWidth - b.width - 4));
  let y = anchor.y;
  if (y + b.height > window.innerHeight - 4) y = anchor.y - b.height - 8;
  y = Math.max(4, Math.min(y, window.innerHeight - b.height - 4));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
