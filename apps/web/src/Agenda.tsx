import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type AgendaData, type EventDTO } from "./api";
import {
  MON_FULL,
  addDays,
  capitalize,
  minutesOfDay,
  parseDT,
  rangeTitle,
  sameDay,
  startOfDay,
  startOfWeek,
  ymd,
} from "./agenda/date";
import { ZOOM_STEPS, type AgendaEvent, type DensityStep } from "./agenda/types";
import { useViewParam } from "./agenda/useViewParam";
import { announce } from "./agenda/announcer";
import EventPanel, { type PanelContext, type SavedInfo } from "./agenda/EventPanel";
import Toolbar from "./agenda/Toolbar";
import WeekView from "./agenda/WeekView";
import ListView from "./agenda/ListView";
import MonthView from "./agenda/MonthView";

export default function Agenda(_props: { onOpenMeeting: (name: string) => void }) {
  const [view, setView] = useViewParam();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [zoom, setZoom] = useState<DensityStep>(ZOOM_STEPS[2]); // Zoom-Amplio por defecto
  const [data, setData] = useState<AgendaData | null>(null);
  const [now] = useState(() => new Date());
  const [panel, setPanel] = useState<PanelContext | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerHeight : 800,
  );

  // La agenda ocupa el alto disponible debajo del nav: la página no scrollea.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setHeight(window.innerHeight - root.getBoundingClientRect().top);
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const rangeStart = view === "mes" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : weekStart;
  const rangeEnd =
    view === "mes"
      ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
      : addDays(weekStart, 5);
  const rangeKey = `${ymd(rangeStart)}|${ymd(rangeEnd)}`;

  useEffect(() => {
    let alive = true;
    setData(null);
    api
      .getAgenda(ymd(rangeStart), ymd(rangeEnd))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData({ start: "", end: "", events: [], tasks: [] });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const events = useMemo<AgendaEvent[]>(
    () =>
      (data?.events ?? []).map((e: EventDTO) => ({
        name: e.name,
        subject: e.subject,
        start: parseDT(e.starts_on),
        end: parseDT(e.ends_on),
        allDay: Boolean(e.all_day),
      })),
    [data],
  );

  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const weekLabel = `${days[0].getDate()} al ${days[4].getDate()} de ${MON_FULL[days[0].getMonth()]}`;
  const title =
    view === "mes"
      ? `${capitalize(MON_FULL[anchor.getMonth()])} de ${anchor.getFullYear()}`
      : rangeTitle(days[0], days[4]);

  const n = events.length;
  const allDayCount = events.filter((e) => e.allDay).length;
  const count = `${n} ${n === 1 ? "reunión" : "reuniones"}${
    allDayCount ? ` · ${allDayCount} de todo el día` : ""
  }`;

  function move(delta: number) {
    if (view === "mes") setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
    else setAnchor(addDays(anchor, delta * 7));
  }

  const openPanel = useCallback((ctx: Omit<PanelContext, "returnFocus">) => {
    const active = document.activeElement;
    // Cuando el panel se abre desde un click en un hueco no hay foco real (body):
    // en ese caso `closePanel` devuelve el foco a un control estable de la vista.
    const returnFocus =
      active instanceof HTMLElement && active !== document.body && active !== document.documentElement
        ? active
        : null;
    setPanel({ ...ctx, returnFocus });
  }, []);

  const closePanel = useCallback(() => {
    const back = panel?.returnFocus ?? null;
    setPanel(null);
    requestAnimationFrame(() => {
      if (back && back.isConnected) back.focus();
      else rootRef.current?.querySelector<HTMLElement>(".agx-gridwrap, .agx-lista, .agx-new")?.focus();
    });
  }, [panel]);

  // Guardar cierra el ciclo: persiste, re-lee la ventana y deja el foco en el
  // elemento afectado. Regla del anuncio: si el foco se mueve al evento, NO se
  // escribe la región viva (su nombre accesible ya lo anuncia). Sólo cuando el
  // evento no se pintó (p. ej. vista Mes, chips no focusables) se anuncia.
  const handleSaved = useCallback(
    (s: SavedInfo) => {
      setPanel(null);
      api
        .getAgenda(ymd(rangeStart), ymd(rangeEnd))
        .then((d) => {
          flushSync(() => setData(d));
          const el = rootRef.current?.querySelector<HTMLElement>(
            `[data-ev="${CSS.escape(s.name)}"]`,
          );
          if (el) el.focus();
          else announce(s.announcement);
        })
        .catch(() => {
          announce(s.announcement);
        });
    },
    [rangeStart, rangeEnd],
  );

  function crearDesdeBoton() {
    const hoy = new Date();
    const idx = days.findIndex((d) => sameDay(d, hoy));
    if (idx >= 0) {
      const min = Math.floor((hoy.getHours() * 60 + hoy.getMinutes()) / 30) * 30;
      openPanel({ mode: "crear", day: days[idx], startMin: min, durMin: 45 });
    } else {
      openPanel({ mode: "crear", day: days[0], startMin: 9 * 60, durMin: 45 });
    }
  }

  function crearEnDia(dayIdx: number) {
    const day = days[dayIdx];
    if (!day) return;
    openPanel({ mode: "crear", day, startMin: 9 * 60, durMin: 45 });
  }

  function editarEvento(ev: AgendaEvent) {
    openPanel({
      mode: "editar",
      day: startOfDay(ev.start),
      startMin: minutesOfDay(ev.start),
      durMin: Math.max(15, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000)),
      name: ev.name,
      subject: ev.subject,
    });
  }

  return (
    <div className="agx" ref={rootRef} style={{ height }}>
      <Toolbar
        view={view}
        onView={setView}
        density={zoom}
        onDensity={setZoom}
        title={title}
        count={count}
        onPrev={() => move(-1)}
        onNext={() => move(1)}
        onToday={() => setAnchor(new Date())}
        onNew={crearDesdeBoton}
      />

      <div className="agx-body">
        <div className="agx-main">
          {view === "semana" ? (
            <WeekView
              days={days}
              events={events}
              zoom={zoom}
              now={now}
              weekLabel={weekLabel}
              onCreateSlot={(dayIdx, startMin) =>
                openPanel({ mode: "crear", day: days[dayIdx], startMin, durMin: 45 })
              }
              onEdit={editarEvento}
            />
          ) : view === "lista" ? (
            <ListView
              days={days}
              events={events}
              now={now}
              onNewDay={crearEnDia}
              onEdit={editarEvento}
            />
          ) : (
            <MonthView
              anchor={anchor}
              events={events}
              now={now}
              label={title}
              onShowList={() => setView("lista")}
            />
          )}
        </div>

        {panel ? <EventPanel ctx={panel} onClose={closePanel} onSaved={handleSaved} /> : null}
      </div>
    </div>
  );
}
