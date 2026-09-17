import { useCallback, useState } from "react";
import type { AgendaView } from "./types";

const VIEWS: AgendaView[] = ["semana", "lista", "mes"];

function readView(): AgendaView {
  if (typeof window === "undefined") return "semana";
  const v = new URLSearchParams(window.location.search).get("view");
  return VIEWS.includes(v as AgendaView) ? (v as AgendaView) : "semana";
}

/** La vista vive en `?view=` y se lee al cargar (el prototipo hace lo mismo). */
export function useViewParam(): [AgendaView, (v: AgendaView) => void] {
  const [view, setView] = useState<AgendaView>(readView);
  const set = useCallback((next: AgendaView) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }, []);
  return [view, set];
}
