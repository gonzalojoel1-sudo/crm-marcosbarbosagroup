import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type AgendaData, type EventDTO } from "./api";
import {
  MON_FULL,
  addDays,
  capitalize,
  dayLong,
  fmtMin,
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
import EventMenu from "./agenda/EventMenu";
import MoveDialog from "./agenda/MoveDialog";
import DurationDialog from "./agenda/DurationDialog";
import type { Anchor } from "./agenda/floating";
import Toolbar from "./agenda/Toolbar";
import WeekView from "./agenda/WeekView";
import ListView from "./agenda/ListView";
import MonthView from "./agenda/MonthView";

// Duración real del evento en minutos, con el piso de 15 que usan los diálogos.
function durDe(ev: AgendaEvent): number {
  return Math.max(15, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000));
}

export default function Agenda(_props: { onOpenMeeting: (name: string) => void }) {
  const [view, setView] = useViewParam();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [zoom, setZoom] = useState<DensityStep>(ZOOM_STEPS[2]); // Zoom-Amplio por defecto
  const [data, setData] = useState<AgendaData | null>(null);
  const [now] = useState(() => new Date());
  const [panel, setPanel] = useState<PanelContext | null>(null);
  const [menu, setMenu] = useState<{ event: AgendaEvent; anchor: Anchor } | null>(null);
  const [modal, setModal] = useState<{
    kind: "mover" | "duracion";
    event: AgendaEvent;
    anchor: Anchor;
  } | null>(null);
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

  const openPanel = useCallback(
    (ctx: Omit<PanelContext, "returnFocus">, returnFocus?: HTMLElement | null) => {
      // El disparador puede no ser el elemento con foco (p. ej. "Editar" del menú,
      // que enfoca un ítem que se desmonta): ahí el llamador pasa el evento como
      // destino explícito. Sin override, se captura el foco actual.
      let rf: HTMLElement | null;
      if (returnFocus !== undefined) {
        rf = returnFocus;
      } else {
        const active = document.activeElement;
        rf =
          active instanceof HTMLElement &&
          active !== document.body &&
          active !== document.documentElement
            ? active
            : null;
      }
      setPanel({ ...ctx, returnFocus: rf });
    },
    [],
  );

  const closePanel = useCallback(() => {
    const back = panel?.returnFocus ?? null;
    setPanel(null);
    requestAnimationFrame(() => {
      if (back && back.isConnected) back.focus();
      else rootRef.current?.querySelector<HTMLElement>(".agx-gridwrap, .agx-lista, .agx-new")?.focus();
    });
  }, [panel]);

  const focusEventByName = useCallback((name: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-ev="${CSS.escape(name)}"]`);
    if (!el) return false;
    el.focus();
    return true;
  }, []);

  // Cerrar con un click afuera NO re-renderiza la grilla ni re-lee la ventana:
  // sólo baja el estado del menú/diálogo. Así el control bajo el puntero
  // sobrevive y su click llega (en el prototipo el cierre lo desmontaba y el
  // primer click "se comía" sin hacer nada).
  useEffect(() => {
    if (!menu && !modal) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Element | null;
      if (!t) return;
      if (menu && !t.closest(".agx-menu")) setMenu(null);
      // El diálogo cerrado por click afuera no devuelve el foco: la misma salida
      // que Escape, sin robarle el foco al control que el usuario está clickeando.
      if (modal && !t.closest(".agx-modal")) setModal(null);
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menu, modal]);

  const openMenu = useCallback((ev: AgendaEvent, trigger: HTMLElement) => {
    const r = trigger.getBoundingClientRect();
    setMenu({ event: ev, anchor: { x: r.left, y: r.bottom + 4 } });
  }, []);

  // Cerrar el menú devolviendo el foco a la reunión también ES el anuncio:
  // cerrar nunca escribe la región viva.
  const closeMenu = useCallback(
    (returnFocus: boolean) => {
      const name = menu?.event.name;
      setMenu(null);
      if (returnFocus && name) requestAnimationFrame(() => focusEventByName(name));
    },
    [menu, focusEventByName],
  );

  const closeModal = useCallback(() => {
    const name = modal?.event.name;
    setModal(null);
    if (name) requestAnimationFrame(() => focusEventByName(name));
  }, [modal, focusEventByName]);

  // "Editar": el panel reemplaza al menú y el foco pasa al panel (no se anuncia).
  // El destino de retorno es el bloque de la reunión, no el ítem del menú que se
  // desmonta.
  function menuEditar() {
    const ev = menu?.event;
    if (!ev) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-ev="${CSS.escape(ev.name)}"]`) ?? null;
    setMenu(null);
    openPanel(
      {
        mode: "editar",
        day: startOfDay(ev.start),
        startMin: minutesOfDay(ev.start),
        durMin: durDe(ev),
        name: ev.name,
        subject: ev.subject,
      },
      el,
    );
  }

  function abrirModal(kind: "mover" | "duracion") {
    const m = menu;
    if (!m) return;
    setMenu(null);
    setModal({ kind, event: m.event, anchor: m.anchor });
  }

  // Aplicar es el único punto que escribe. Después el foco vuelve al evento
  // afectado, cuyo nombre accesible ya trae la hora/día nuevos: mover el foco ES
  // el anuncio, así que no se escribe además la región viva (alternancia).
  async function aplicarMover(day: Date, startMin: number) {
    const ev = modal?.event;
    if (!ev) return;
    setModal(null);
    const durMin = durDe(ev);
    try {
      await api.updateMeeting(
        ev.name,
        `${ymd(day)} ${fmtMin(startMin)}:00`,
        `${ymd(day)} ${fmtMin(startMin + durMin)}:00`,
      );
      const d = await api.getAgenda(ymd(rangeStart), ymd(rangeEnd));
      flushSync(() => setData(d));
      if (!focusEventByName(ev.name)) {
        announce(`Movida ${ev.subject}, ${dayLong(day)} a las ${fmtMin(startMin)}`);
      }
    } catch {
      announce("No se pudo mover la reunión. Probá de nuevo.");
    }
  }

  async function aplicarDuracion(durMin: number) {
    const ev = modal?.event;
    if (!ev) return;
    setModal(null);
    const startMin = minutesOfDay(ev.start);
    try {
      await api.updateMeeting(
        ev.name,
        `${ymd(ev.start)} ${fmtMin(startMin)}:00`,
        `${ymd(ev.start)} ${fmtMin(startMin + durMin)}:00`,
      );
      const d = await api.getAgenda(ymd(rangeStart), ymd(rangeEnd));
      flushSync(() => setData(d));
      if (!focusEventByName(ev.name)) {
        announce(`Cambiada la duración de ${ev.subject} a ${durMin} minutos`);
      }
    } catch {
      announce("No se pudo cambiar la duración. Probá de nuevo.");
    }
  }

  // Duplicar es inmediato y NO anuncia: el foco pasa a la copia y su nombre
  // accesible ya lo dice. Sólo si la copia no se puede enfocar se anuncia.
  async function duplicarEvento() {
    const ev = menu?.event;
    if (!ev) return;
    setMenu(null);
    try {
      const copia = await api.duplicateMeeting(ev.name);
      const d = await api.getAgenda(ymd(rangeStart), ymd(rangeEnd));
      flushSync(() => setData(d));
      if (!focusEventByName(copia.name)) announce(`Duplicada ${ev.subject}`);
    } catch {
      announce("No se pudo duplicar la reunión. Probá de nuevo.");
    }
  }

  // Borrar es la excepción documentada de la regla del anuncio: el foco cae en
  // OTRO objeto (un vecino del mismo día, o el contenedor de la vista), así que
  // el lector no leería la eliminación. Por eso acá SÍ se anuncia.
  async function eliminarEvento() {
    const ev = menu?.event;
    if (!ev) return;
    const day = startOfDay(ev.start);
    const startMin = minutesOfDay(ev.start);
    setMenu(null);
    try {
      await api.deleteMeeting(ev.name);
      const d = await api.getAgenda(ymd(rangeStart), ymd(rangeEnd));
      flushSync(() => setData(d));
      announce(`Eliminada ${ev.subject}, ${dayLong(day)} a las ${fmtMin(startMin)}`);
      const restantes = d.events
        .filter((e) => e.name !== ev.name)
        .map((e) => ({ name: e.name, start: parseDT(e.starts_on) }))
        .filter((e) => sameDay(e.start, day))
        .sort(
          (a, b) =>
            Math.abs(minutesOfDay(a.start) - startMin) -
            Math.abs(minutesOfDay(b.start) - startMin),
        );
      const vecino = restantes[0];
      if (vecino) focusEventByName(vecino.name);
      else rootRef.current?.querySelector<HTMLElement>(".agx-gridwrap, .agx-lista")?.focus();
    } catch {
      announce("No se pudo eliminar la reunión. Probá de nuevo.");
    }
  }

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
              onOpenMenu={openMenu}
              expandedName={menu?.event.name ?? null}
            />
          ) : view === "lista" ? (
            <ListView
              days={days}
              events={events}
              now={now}
              onNewDay={crearEnDia}
              onOpenMenu={openMenu}
              expandedName={menu?.event.name ?? null}
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

      {menu ? (
        <EventMenu
          event={menu.event}
          anchor={menu.anchor}
          onEditar={menuEditar}
          onMover={() => abrirModal("mover")}
          onDuracion={() => abrirModal("duracion")}
          onDuplicar={duplicarEvento}
          onEliminar={eliminarEvento}
          onClose={closeMenu}
        />
      ) : null}

      {modal?.kind === "mover" ? (
        <MoveDialog
          event={modal.event}
          days={days}
          dayIndex={Math.max(0, days.findIndex((d) => sameDay(d, modal.event.start)))}
          startMin={minutesOfDay(modal.event.start)}
          durMin={durDe(modal.event)}
          anchor={modal.anchor}
          onApply={aplicarMover}
          onClose={closeModal}
        />
      ) : null}

      {modal?.kind === "duracion" ? (
        <DurationDialog
          event={modal.event}
          day={startOfDay(modal.event.start)}
          startMin={minutesOfDay(modal.event.start)}
          durMin={durDe(modal.event)}
          anchor={modal.anchor}
          onApply={aplicarDuracion}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}
