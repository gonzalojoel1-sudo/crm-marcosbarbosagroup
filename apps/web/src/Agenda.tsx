import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type AgendaData, type EventDTO } from "./api";
import {
  MON_FULL,
  addDays,
  capitalize,
  parseDT,
  rangeTitle,
  startOfWeek,
  ymd,
} from "./agenda/date";
import { ZOOM_STEPS, type AgendaEvent, type DensityStep } from "./agenda/types";
import { useViewParam } from "./agenda/useViewParam";
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
      />

      <div className="agx-body">
        {view === "semana" ? (
          <WeekView days={days} events={events} zoom={zoom} now={now} weekLabel={weekLabel} />
        ) : view === "lista" ? (
          <ListView days={days} events={events} now={now} />
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

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
    </div>
  );
}
