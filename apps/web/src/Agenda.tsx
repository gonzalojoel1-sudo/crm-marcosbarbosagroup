import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type AgendaData, type EventDTO, type TaskDTO } from "./api";
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
import { END_H, START_H } from "./agenda/geometry";
import { ZOOM_STEPS, type AgendaEvent, type AgendaTask, type DensityStep } from "./agenda/types";
import { useViewParam } from "./agenda/useViewParam";
import { announce } from "./agenda/announcer";
// El CSS del shell se importa PRIMERO: `[data-agenda].agx :focus-visible` tiene
// que quedar antes que los módulos de los componentes, como el `.agx` global
// original, para que los empates de especificidad resuelvan igual.
import styles from "./agenda/Agenda.module.css";
import EventPanel, { type PanelContext, type SavedInfo } from "./agenda/EventPanel";
import EventMenu from "./agenda/EventMenu";
import MoveDialog from "./agenda/MoveDialog";
import DurationDialog from "./agenda/DurationDialog";
import type { Anchor } from "./agenda/floating";
import Toolbar from "./agenda/Toolbar";
import WeekView from "./agenda/WeekView";
import ListView from "./agenda/ListView";
import MonthView from "./agenda/MonthView";
import Sidebar from "./agenda/Sidebar";
import MiniMonth from "./agenda/MiniMonth";
import { CATEGORY_ORDER, ORIGINS } from "./agenda/categories";

// Duración real del evento en minutos, con el piso de 15 que usan los diálogos.
function durDe(ev: AgendaEvent): number {
  return Math.max(15, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000));
}

export default function Agenda(_props: { onOpenMeeting: (name: string) => void }) {
  const [view, setView] = useViewParam();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [zoom, setZoom] = useState<DensityStep>(ZOOM_STEPS[2]); // Zoom-Amplio por defecto
  const [data, setData] = useState<AgendaData | null>(null);
  // La hora del botón "Hoy · HH:MM" y de la línea de ahora tiene que ser la real,
  // no la del montaje: se refresca por minuto mientras la agenda está viva.
  const [now, setNow] = useState(() => new Date());
  // Sidebar: agendas (categorías) y orígenes apagados. El prototipo los guarda en
  // dos Set (`HIDDEN` / `HIDDEN_ORIGIN`, `index.html:617-618`).
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(() => new Set());
  const [hiddenOrigins, setHiddenOrigins] = useState<Set<string>>(() => new Set());
  // El botón Panel del encabezado pliega el mini-mes (arranca visible).
  const [miniOpen, setMiniOpen] = useState(true);
  const [panel, setPanel] = useState<PanelContext | null>(null);
  const [menu, setMenu] = useState<{
    event: AgendaEvent;
    anchor: Anchor;
    confirm?: boolean;
  } | null>(null);
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

  // Un tick por minuto mantiene alineados el botón "Hoy · HH:MM" y la línea de
  // ahora. No hay transición: es un repintado, no movimiento.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
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
        category: e.categoria,
        // El DTO todavía no expone `origin`; si el backend lo agrega, viaja acá
        // sin tocar nada más y el filtro de Origen empieza a discriminar.
        origin: (e as EventDTO & { origin?: string }).origin,
      })),
    [data],
  );

  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // El predicado del prototipo (`index.html:620`): un evento se oculta por su
  // agenda; si no tiene agenda (importado), por su origen. Acá la categoría
  // siempre llega (la API usa default), así que el origen aplica a lo que el
  // backend marque sin categoría. Filtra las TRES vistas.
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          !(e.category ? hiddenCategories.has(e.category) : hiddenOrigins.has(e.origin ?? "")),
      ),
    [events, hiddenCategories, hiddenOrigins],
  );

  // Los contadores de la sidebar salen de TODOS los eventos, como el prototipo.
  const categoryCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const key of CATEGORY_ORDER) out[key] = events.filter((e) => e.category === key).length;
    return out;
  }, [events]);
  const originCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const origin of ORIGINS) {
      const prefijo = origin.split(" ")[0];
      out[origin] = events.filter((e) => (e.origin ?? "").startsWith(prefijo)).length;
    }
    return out;
  }, [events]);
  const eventDays = useMemo(() => new Set(events.map((e) => ymd(e.start))), [events]);

  function toggleCategory(key: string) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleOrigin(origin: string) {
    setHiddenOrigins((prev) => {
      const next = new Set(prev);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  }

  // Las tareas tienen vencimiento, no duración: no entran a la grilla temporal.
  // `get_agenda` sólo devuelve las que tienen fecha, así que `due` nunca es null;
  // el tipo lo permite y la agrupación lo filtra por las dudas.
  const tasks = useMemo<AgendaTask[]>(
    () =>
      (data?.tasks ?? []).map((t: TaskDTO) => ({
        name: t.name,
        subject: t.subject,
        due: t.due_datetime ? parseDT(t.due_datetime) : null,
        priority: t.priority,
      })),
    [data],
  );
  const tasksByDay = useMemo(
    () => days.map((date) => tasks.filter((t) => t.due && sameDay(t.due, date))),
    [days, tasks],
  );

  const weekLabel = `${days[0].getDate()} al ${days[4].getDate()} de ${MON_FULL[days[0].getMonth()]}`;
  const title =
    view === "mes"
      ? `${capitalize(MON_FULL[anchor.getMonth()])} de ${anchor.getFullYear()}`
      : rangeTitle(days[0], days[4]);

  const n = visibleEvents.length;
  // El chip del prototipo dice la ventana visible (`index.html:1493-1498,1526`).
  // La app no pliega franjas, así que la ventana es siempre la grilla completa.
  // El pendiente de sync no se puede expresar todavía: el DTO de `get_agenda` no
  // expone `sync`, así que se renderiza sólo lo real (sin inventar un número).
  const windowChip = `${fmtMin(START_H * 60)} – ${fmtMin(END_H * 60)}`;
  const count = `${view === "mes" ? "" : `${windowChip} · `}${n} ${
    n === 1 ? "reunión" : "reuniones"
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

  // Escribe mover/redimensionar y deja el foco en el evento afectado. El
  // repintado monta un nodo NUEVO (la key del bloque incluye su posición) y su
  // nombre accesible ya trae día/hora/duración nuevos: enfocarlo ES el anuncio,
  // así que NO se escribe la región viva. Devuelve si pudo enfocar.
  async function escribirYEnfocar(
    ev: AgendaEvent,
    day: Date,
    startMin: number,
    durMin: number,
  ): Promise<boolean> {
    await api.updateMeeting(
      ev.name,
      `${ymd(day)} ${fmtMin(startMin)}:00`,
      `${ymd(day)} ${fmtMin(startMin + durMin)}:00`,
    );
    const d = await api.getAgenda(ymd(rangeStart), ymd(rangeEnd));
    flushSync(() => setData(d));
    return focusEventByName(ev.name);
  }

  async function moverConArrastre(ev: AgendaEvent, dayIdx: number, startMin: number, durMin: number) {
    const day = days[dayIdx];
    if (!day) return;
    try {
      if (!(await escribirYEnfocar(ev, day, startMin, durMin))) {
        announce(`Movida ${ev.subject}, ${dayLong(day)} a las ${fmtMin(startMin)}`);
      }
    } catch {
      announce("No se pudo mover la reunión. Probá de nuevo.");
    }
  }

  async function redimensionarConArrastre(ev: AgendaEvent, durMin: number) {
    try {
      if (!(await escribirYEnfocar(ev, startOfDay(ev.start), minutesOfDay(ev.start), durMin))) {
        announce(`Cambiada la duración de ${ev.subject} a ${durMin} minutos`);
      }
    } catch {
      announce("No se pudo cambiar la duración. Probá de nuevo.");
    }
  }

  // Nudge (S4): complemento rápido del menú, nunca su reemplazo. Ctrl+Alt+↑/↓
  // mueve ±15 min, Ctrl+Alt+←/→ mueve ±1 día, Shift+↑/↓ cambia ±15 min de
  // duración. El acorde es Ctrl+Alt a propósito: Alt+←/→ es Atrás/Adelante en
  // Windows/Linux y el navegador puede ignorar preventDefault.
  function nudge(ev: AgendaEvent, delta: { min?: number; dias?: number; dur?: number }) {
    const durMin = durDe(ev);
    const startMin = minutesOfDay(ev.start);
    const dayIdx = days.findIndex((d) => sameDay(d, ev.start));

    if (delta.dias != null) {
      const target = dayIdx + delta.dias;
      if (target < 0 || target >= days.length) {
        announce(`${ev.subject} ya está en el borde de la semana`);
        return;
      }
      aplicarNudge(
        ev,
        days[target],
        startMin,
        durMin,
        `Movida ${ev.subject}, ${dayLong(days[target])} a las ${fmtMin(startMin)}`,
      );
      return;
    }
    if (delta.min != null) {
      const nuevo = startMin + delta.min;
      if (nuevo < START_H * 60 || nuevo + durMin > END_H * 60) {
        announce(`${ev.subject} no entra en el horario visible`);
        return;
      }
      aplicarNudge(ev, startOfDay(ev.start), nuevo, durMin, `Movida ${ev.subject} a las ${fmtMin(nuevo)}`);
      return;
    }
    if (delta.dur != null) {
      const nueva = durMin + delta.dur;
      if (nueva < 15 || startMin + nueva > END_H * 60) {
        announce(`${ev.subject} no puede tener esa duración en el horario visible`);
        return;
      }
      aplicarNudge(
        ev,
        startOfDay(ev.start),
        startMin,
        nueva,
        `Cambiada la duración de ${ev.subject} a ${nueva} minutos`,
      );
    }
  }

  // El éxito mueve el foco (silencio); el rechazo contra un borde ya anunció y
  // no llega acá. Si el evento no se repinta, se anuncia para no dejar mudo el
  // cambio (regla del anuncio, las dos direcciones).
  async function aplicarNudge(
    ev: AgendaEvent,
    day: Date,
    startMin: number,
    durMin: number,
    mensajeExito: string,
  ) {
    try {
      if (!(await escribirYEnfocar(ev, day, startMin, durMin))) announce(mensajeExito);
    } catch {
      announce("No se pudo mover la reunión. Probá de nuevo.");
    }
  }

  // Acciones directas sobre una reunión enfocada: las comparten los atajos de
  // una tecla (E/M/D) y el Supr de S4, sin pasar por el menú ya abierto.
  function editarDe(ev: AgendaEvent, el: HTMLElement | null) {
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

  function abrirModalDe(kind: "mover" | "duracion", ev: AgendaEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setMenu(null);
    setModal({ kind, event: ev, anchor: { x: r.left, y: r.bottom + 4 } });
  }

  function abrirMenuConConfirm(ev: AgendaEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setMenu({ event: ev, anchor: { x: r.left, y: r.bottom + 4 }, confirm: true });
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

  // Completar saca la tarea de la ventana (`get_agenda` filtra `status != Done`),
  // así que el foco cae en OTRO objeto: igual que al eliminar, acá SÍ se anuncia
  // además de mover el foco. La acción es real: no hay control que no haga nada.
  async function completarTarea(task: AgendaTask) {
    // El contenedor del día sobrevive al repintado (misma `key`): así el foco cae
    // en la tarea siguiente DEL MISMO DÍA y no salta a otra parte del calendario.
    const activo = document.activeElement as HTMLElement | null;
    const contenedor = activo?.closest<HTMLElement>(".agx-tasks-cell, .agx-ldia-body") ?? null;
    try {
      await api.complete(task.name);
      const d = await api.getAgenda(ymd(rangeStart), ymd(rangeEnd));
      flushSync(() => setData(d));
      const siguiente =
        contenedor?.querySelector<HTMLElement>(".agx-task") ??
        rootRef.current?.querySelector<HTMLElement>(".agx-task") ??
        null;
      if (siguiente) siguiente.focus();
      else rootRef.current?.querySelector<HTMLElement>(".agx-gridwrap, .agx-lista")?.focus();
      announce(`Tarea completada: ${task.subject}`);
    } catch {
      announce("No se pudo completar la tarea. Probá de nuevo.");
    }
  }

  // SC 2.1.4: los atajos de UNA tecla (N, E, M, D, Supr) valen sólo con el foco
  // DENTRO del componente (grilla, lista, menú o barra). Con el foco en `body`
  // no hay componente enfocado; con el foco en un campo del panel la tecla es
  // TEXTO, nunca una acción. El defecto revisado del prototipo era exactamente
  // una `n` global: acá no existe sin foco.
  useEffect(() => {
    function esCampo(el: HTMLElement) {
      const t = el.tagName;
      return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
    }
    function enAlcance(el: HTMLElement) {
      if (el === document.body || el === document.documentElement) return false;
      if (esCampo(el)) return false;
      return !!el.closest(".agx-gridwrap, .agx-lista, .agx-menu, .agx-bar");
    }
    function onKey(e: KeyboardEvent) {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return;

      // Con el menú abierto, las letras operan sus ítems; ninguna otra tecla
      // pasa al resto de la página.
      const menuEl = a.closest<HTMLElement>(".agx-menu");
      if (menuEl) {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const atajos: Record<string, string> = { e: "editar", m: "mover", d: "duracion" };
        const accion = atajos[e.key.toLowerCase()];
        if (accion) {
          e.preventDefault();
          menuEl.querySelector<HTMLButtonElement>(`[data-accion="${accion}"]`)?.click();
          return;
        }
        if (e.key === "Delete" || e.key === "Del") {
          e.preventDefault();
          menuEl.querySelector<HTMLButtonElement>('[data-accion="eliminar"]')?.click();
        }
        return;
      }

      const evEl = a.closest<HTMLElement>("[data-ev]");
      if (evEl) {
        const ev = events.find((x) => x.name === evEl.dataset.ev);
        if (ev) {
          if (e.ctrlKey && e.altKey && !e.metaKey) {
            if (e.key === "ArrowDown") { e.preventDefault(); nudge(ev, { min: 15 }); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); nudge(ev, { min: -15 }); return; }
            if (e.key === "ArrowRight") { e.preventDefault(); nudge(ev, { dias: 1 }); return; }
            if (e.key === "ArrowLeft") { e.preventDefault(); nudge(ev, { dias: -1 }); return; }
          }
          if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
            if (e.key === "ArrowDown") { e.preventDefault(); nudge(ev, { dur: 15 }); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); nudge(ev, { dur: -15 }); return; }
          }
          if (!e.ctrlKey && !e.altKey && !e.metaKey) {
            const k = e.key.toLowerCase();
            if (k === "e") { e.preventDefault(); editarDe(ev, evEl); return; }
            if (k === "m") { e.preventDefault(); abrirModalDe("mover", ev, evEl); return; }
            if (k === "d") { e.preventDefault(); abrirModalDe("duracion", ev, evEl); return; }
            if (e.key === "Delete" || e.key === "Del") {
              e.preventDefault();
              abrirMenuConConfirm(ev, evEl);
              return;
            }
          }
        }
      }

      if (!enAlcance(a)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        crearDesdeBoton();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [events, days, rangeKey]);

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
    <div
      className={styles.agx}
      data-agenda
      data-mini={miniOpen ? undefined : "off"}
      ref={rootRef}
      style={{ height }}
    >
      <div className={styles.agxBody}>
        <Sidebar
          categoryCounts={categoryCounts}
          originCounts={originCounts}
          hiddenCategories={hiddenCategories}
          hiddenOrigins={hiddenOrigins}
          onToggleCategory={toggleCategory}
          onToggleOrigin={toggleOrigin}
        />

        <div className={styles.agxMain}>
          <Toolbar
            view={view}
            onView={setView}
            density={zoom}
            onDensity={setZoom}
            title={title}
            count={count}
            now={now}
            onPrev={() => move(-1)}
            onNext={() => move(1)}
            onToday={() => setAnchor(new Date())}
            onNew={crearDesdeBoton}
            panelOpen={miniOpen}
            onTogglePanel={() => setMiniOpen((v) => !v)}
          />

          <div className={styles.agxContent}>
            {view === "semana" ? (
              <WeekView
                days={days}
                events={visibleEvents}
                zoom={zoom}
                now={now}
                weekLabel={weekLabel}
                onCreateSlot={(dayIdx, startMin, durMin) =>
                  openPanel({ mode: "crear", day: days[dayIdx], startMin, durMin })
                }
                onNew={crearDesdeBoton}
                onMoveEvent={moverConArrastre}
                onResizeEvent={redimensionarConArrastre}
                onOpenMenu={openMenu}
                expandedName={menu?.event.name ?? null}
                tasksByDay={tasksByDay}
                onCompleteTask={completarTarea}
              />
            ) : view === "lista" ? (
              <ListView
                days={days}
                events={visibleEvents}
                now={now}
                onNewDay={crearEnDia}
                onOpenMenu={openMenu}
                expandedName={menu?.event.name ?? null}
                tasksByDay={tasksByDay}
                onCompleteTask={completarTarea}
              />
            ) : (
              <MonthView
                anchor={anchor}
                events={visibleEvents}
                now={now}
                label={title}
                onShowList={() => setView("lista")}
              />
            )}

            {panel ? <EventPanel ctx={panel} onClose={closePanel} onSaved={handleSaved} /> : null}
          </div>
        </div>

        <MiniMonth anchor={anchor} rangeDays={days} today={now} eventDays={eventDays} />
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
          initialConfirm={menu.confirm}
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
