import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  DOW_SHORT,
  accessibleName,
  dayLong,
  fmtMin,
  minutesOfDay,
  sameDay,
  weekdayIndex,
  ymd,
} from "./date";
import { categoryOf } from "./categories";
import { accessibleTaskName } from "./tasks";
import { IconCheck } from "../icons";
import {
  END_H,
  HOURS,
  START_H,
  blockDensity,
  blockHeight,
  eventMinutes,
  fitHourHeight,
  layoutLanes,
  minutesToY,
  yToMinutes,
  type Placed,
} from "./geometry";
import type { AgendaEvent, AgendaTask, DensityStep } from "./types";
import styles from "./WeekView.module.css";
import taskStyles from "./Task.module.css";

const HOUR_LIST = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

interface WeekViewProps {
  days: Date[];
  events: AgendaEvent[];
  zoom: DensityStep;
  now: Date;
  weekLabel: string;
  onCreateSlot: (dayIndex: number, startMin: number, durMin: number) => void;
  onMoveEvent: (event: AgendaEvent, dayIndex: number, startMin: number, durMin: number) => void;
  onResizeEvent: (event: AgendaEvent, durMin: number) => void;
  onOpenMenu: (event: AgendaEvent, trigger: HTMLElement) => void;
  expandedName: string | null;
  tasksByDay: AgendaTask[][];
  onCompleteTask: (task: AgendaTask) => void;
}

const DRAG_UMBRAL = 4; // menos de 4 px de movimiento es un click, no un arrastre
const MIN_DUR = 15;

type DragBase = { downX: number; downY: number; moved: boolean; x: number; y: number };

/**
 * El arrastre es un acelerador, nunca el único camino (spec §1.1): crear,
 * mover y redimensionar tienen su equivalente sin arrastre en el panel y el
 * menú. La confirmación ocurre SIEMPRE en `pointerup`; Escape y soltar fuera
 * de la grilla cancelan sin escribir (SC 2.5.2).
 */
type Drag =
  | (DragBase & {
      kind: "create";
      day: number;
      anchorMin: number;
      min: number;
      dur: number;
    })
  | (DragBase & {
      kind: "move";
      event: AgendaEvent;
      trigger: HTMLElement;
      origStartMin: number;
      durMin: number;
      grabMin: number;
      day: number;
      startMin: number;
    })
  | (DragBase & {
      kind: "resize";
      event: AgendaEvent;
      day: number;
      startMin: number;
      durMin: number;
    });

const snap15 = (min: number) => Math.round(min / 15) * 15;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function WeekView({
  days,
  events,
  zoom,
  now,
  weekLabel,
  onCreateSlot,
  onMoveEvent,
  onResizeEvent,
  onOpenMenu,
  expandedName,
  tasksByDay,
  onCompleteTask,
}: WeekViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const prevHourH = useRef<number | null>(null);
  const jumped = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  // El gesto vive en un ref para que los listeners de window (montados una sola
  // vez) lean siempre el estado vigente sin re-suscribirse en cada move.
  const stateRef = useRef<{
    drag: Drag | null;
    hourH: number;
    cb: {
      onCreateSlot: WeekViewProps["onCreateSlot"];
      onMoveEvent: WeekViewProps["onMoveEvent"];
      onResizeEvent: WeekViewProps["onResizeEvent"];
      onOpenMenu: WeekViewProps["onOpenMenu"];
    } | null;
    cancelado: boolean;
  }>({ drag: null, hourH: 44, cb: null, cancelado: false });
  // Un click que sigue a un arrastre (o a una cancelación) no debe abrir el
  // panel ni el menú: el gesto y el click no se pisan (lanmina 3).
  const suppressClick = useRef(false);

  // El alto de hora se deriva del alto real disponible (prototipo fitHourHeight).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const heads = headsRef.current?.getBoundingClientRect().height ?? 0;
      setFit(fitHourHeight(wrap.clientHeight - heads - 2));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const hourH = (fit ?? 44) * zoom.mult;
  const gridH = HOURS * hourH;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  stateRef.current.hourH = hourH;
  stateRef.current.cb = { onCreateSlot, onMoveEvent, onResizeEvent, onOpenMenu };

  // Primera pintura: abrir en la hora actual. Al cambiar la densidad, conservar
  // el minuto que estaba en el centro del área visible (no resetear el scroll).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || fit == null) return;
    const prev = prevHourH.current;
    if (!jumped.current) {
      jumped.current = true;
      wrap.scrollTop = Math.max(0, minutesToY(nowMin, hourH) - wrap.clientHeight / 2);
    } else if (prev != null && prev !== hourH) {
      const center = yToMinutes(wrap.scrollTop + wrap.clientHeight / 2, prev);
      wrap.scrollTop = Math.max(0, minutesToY(center, hourH) - wrap.clientHeight / 2);
    }
    prevHourH.current = hourH;
  }, [fit, hourH, nowMin]);

  const columns = useMemo<Placed[][]>(() => {
    const mover = drag && drag.kind === "move" && drag.moved ? drag : null;
    const cambiar = drag && drag.kind === "resize" && drag.moved ? drag : null;
    return days.map((date, dayIdx) => {
      // El evento arrastrado se ubica en el día DESTINO, no en el de origen:
      // así el arrastre cruza de día en vivo (mejora deliberada sobre el prototipo).
      const todays = events.filter((e) => {
        if (e.allDay) return false;
        if (mover && e.name === mover.event.name) return dayIdx === mover.day;
        return sameDay(e.start, date);
      });
      const items = todays.map((e) => {
        if (mover && e.name === mover.event.name) {
          return { event: e, startMin: mover.startMin, endMin: mover.startMin + mover.durMin };
        }
        if (cambiar && e.name === cambiar.event.name) {
          return { event: e, startMin: cambiar.startMin, endMin: cambiar.startMin + cambiar.durMin };
        }
        const { startMin, endMin } = eventMinutes(e);
        return { event: e, startMin, endMin };
      });
      const lanes = layoutLanes(items);
      return items.map((it) => ({ ...it, ...(lanes.get(it) ?? { lane: 0, lanes: 1 }) }));
    });
  }, [days, events, drag]);

  const allDayByDay = useMemo(
    () => days.map((date) => events.filter((e) => e.allDay && sameDay(e.start, date))),
    [days, events],
  );
  const hasAllDay = allDayByDay.some((list) => list.length > 0);
  const hasTasks = tasksByDay.some((list) => list.length > 0);

  const swallowClick = useCallback(() => {
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }, []);

  const setDragBoth = useCallback((next: Drag | null) => {
    stateRef.current.drag = next;
    setDrag(next);
  }, []);

  const columnRect = (dayIdx: number): DOMRect | null =>
    wrapRef.current?.querySelector<HTMLElement>(`.agx-col[data-day="${dayIdx}"]`)?.getBoundingClientRect() ??
    null;

  const dayAt = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const col = el?.closest<HTMLElement>(".agx-col[data-day]");
    return col ? Number(col.dataset.day) : null;
  };

  const cancelDrag = useCallback(() => {
    if (!stateRef.current.drag) return;
    stateRef.current.cancelado = true;
    setDragBoth(null);
  }, [setDragBoth]);

  const updateDrag = useCallback(
    (e: globalThis.PointerEvent) => {
      const d = stateRef.current.drag;
      if (!d) return;
      const hh = stateRef.current.hourH;
      const moved =
        d.moved ||
        Math.abs(e.clientX - d.downX) > DRAG_UMBRAL ||
        Math.abs(e.clientY - d.downY) > DRAG_UMBRAL;

      if (d.kind === "create") {
        const day = dayAt(e.clientX, e.clientY) ?? d.day;
        const rect = columnRect(day);
        if (!rect) return;
        const cur = snap15(yToMinutes(e.clientY - rect.top, hh));
        const min = Math.max(START_H * 60, Math.min(d.anchorMin, cur));
        const rawDur = Math.max(MIN_DUR, Math.abs(cur - d.anchorMin) + (cur > d.anchorMin ? 0 : MIN_DUR));
        const dur = Math.max(MIN_DUR, Math.min(rawDur, END_H * 60 - min));
        setDragBoth({ ...d, moved, day, min, dur, x: e.clientX, y: e.clientY });
        return;
      }

      if (d.kind === "move") {
        const day = dayAt(e.clientX, e.clientY) ?? d.day;
        const rect = columnRect(day);
        if (!rect) return;
        const curMin = snap15(yToMinutes(e.clientY - rect.top, hh));
        const startMin = clamp(
          d.origStartMin + (curMin - d.grabMin),
          START_H * 60,
          END_H * 60 - d.durMin,
        );
        setDragBoth({ ...d, moved, day, startMin, x: e.clientX, y: e.clientY });
        return;
      }

      const rect = columnRect(d.day);
      if (!rect) return;
      const curEnd = snap15(yToMinutes(e.clientY - rect.top, hh));
      const durMin = clamp(curEnd - d.startMin, MIN_DUR, END_H * 60 - d.startMin);
      setDragBoth({ ...d, moved, durMin, x: e.clientX, y: e.clientY });
    },
    [setDragBoth],
  );

  const finishDrag = useCallback(
    (e: globalThis.PointerEvent) => {
      const d = stateRef.current.drag;
      if (!d) {
        if (stateRef.current.cancelado) {
          stateRef.current.cancelado = false;
          swallowClick();
        }
        return;
      }
      setDragBoth(null);

      // Soltar fuera de la grilla cancela (SC 2.5.2): no se crea ni se mueve nada.
      const inside = !!document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".agx-gridwrap");
      if (!inside) {
        swallowClick();
        return;
      }

      const cb = stateRef.current.cb;
      if (!cb) return;

      // Click sin desplazamiento (<4 px): gana el camino de click de F4.2/F4.3.
      if (!d.moved) {
        if (d.kind === "create") {
          const rect = columnRect(d.day);
          if (!rect) return;
          const snapped = Math.round(yToMinutes(e.clientY - rect.top, stateRef.current.hourH) / 30) * 30;
          const startMin = clamp(snapped, START_H * 60, END_H * 60 - 30);
          cb.onCreateSlot(d.day, startMin, 45);
        } else if (d.kind === "move") {
          swallowClick();
          cb.onOpenMenu(d.event, d.trigger);
        } else {
          swallowClick();
        }
        return;
      }

      // Arrastre real: el click posterior no debe abrir el panel ni el menú.
      swallowClick();
      if (d.kind === "create") cb.onCreateSlot(d.day, d.min, d.dur);
      else if (d.kind === "move") cb.onMoveEvent(d.event, d.day, d.startMin, d.durMin);
      else cb.onResizeEvent(d.event, d.durMin);
    },
    [setDragBoth, swallowClick],
  );

  // Listeners de window montados una vez: el gesto sobrevive a que el puntero
  // salga de la columna. Escape cancela a mitad del arrastre (SC 2.5.2).
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => updateDrag(e);
    const onUp = (e: globalThis.PointerEvent) => finishDrag(e);
    const onCancel = () => cancelDrag();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && stateRef.current.drag) {
        e.preventDefault();
        e.stopPropagation();
        cancelDrag();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [updateDrag, finishDrag, cancelDrag]);

  // SC 2.5.7: un solo puntero, sin arrastrar. El click en un hueco vacío abre el
  // panel a la media hora más cercana. Si el puntero se movió >4 px es un
  // arrastre (crear con la duración arrastrada), no un click.
  function onColPointerDown(e: PointerEvent<HTMLDivElement>, dayIdx: number) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest(".agx-ev")) return;
    // En táctil el gesto de crear arranca recién con long-press (spec §4/S5, otra
    // fase): acá el arrastre es de puntero fino y no le roba el scroll a la grilla.
    if (e.pointerType === "touch") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorMin = clamp(snap15(yToMinutes(e.clientY - rect.top, hourH)), START_H * 60, END_H * 60 - MIN_DUR);
    setDragBoth({
      kind: "create",
      day: dayIdx,
      anchorMin,
      min: anchorMin,
      dur: MIN_DUR,
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
      x: e.clientX,
      y: e.clientY,
    });
    e.preventDefault();
  }

  function onEventPointerDown(e: PointerEvent<HTMLButtonElement>, p: Placed, dayIdx: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const esResize = !!(e.target as Element).closest("[data-grip]");
    const rect = columnRect(dayIdx);
    if (!rect) return;
    const { startMin, endMin } = eventMinutes(p.event);
    if (esResize) {
      setDragBoth({
        kind: "resize",
        event: p.event,
        day: dayIdx,
        startMin,
        durMin: Math.max(MIN_DUR, endMin - startMin),
        downX: e.clientX,
        downY: e.clientY,
        moved: false,
        x: e.clientX,
        y: e.clientY,
      });
    } else {
      // En táctil, mover arranca con long-press (spec §4/S5): el primer toque
      // sigue siendo scroll. El asa de duración sí es explícita y arrastra.
      if (e.pointerType === "touch") return;
      const grabMin = snap15(yToMinutes(e.clientY - rect.top, hourH));
      setDragBoth({
        kind: "move",
        event: p.event,
        trigger: e.currentTarget,
        origStartMin: startMin,
        durMin: Math.max(MIN_DUR, endMin - startMin),
        grabMin,
        day: dayIdx,
        startMin,
        downX: e.clientX,
        downY: e.clientY,
        moved: false,
        x: e.clientX,
        y: e.clientY,
      });
    }
    e.preventDefault();
  }

  const dragCreate = drag && drag.kind === "create" && drag.moved ? drag : null;
  const dragLabel =
    drag && drag.moved
      ? drag.kind === "create"
        ? `${fmtMin(drag.min)} – ${fmtMin(drag.min + drag.dur)}`
        : drag.kind === "move"
          ? `${fmtMin(drag.startMin)} – ${fmtMin(drag.startMin + drag.durMin)}`
          : `${fmtMin(drag.startMin)} – ${fmtMin(drag.startMin + drag.durMin)}`
      : "";

  return (
    <>
      {hasAllDay ? (
        <div className={styles.agxAllday} role="group" aria-label="Reuniones de todo el día">
          <div className={styles.agxAlldayLab} aria-hidden="true">
            Todo el día
          </div>
          {days.map((date, i) => (
            <div className={styles.agxAlldayCell} key={ymd(date)}>
              {allDayByDay[i].map((e) => (
                <span className={styles.agxAlldayEv} key={e.name} title={e.subject}>
                  <span className="sr-only">
                    {accessibleName(dayLong(date), 0, 0, e.subject, true, e.category)}
                  </span>
                  <span aria-hidden="true">{e.subject}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {hasTasks ? (
        <div className={taskStyles.agxTasks} role="group" aria-label="Tareas de la semana">
          <div className={taskStyles.agxTasksLab} aria-hidden="true">
            Tareas
          </div>
          {days.map((date, i) => (
            <div className={taskStyles.agxTasksCell} key={ymd(date)}>
              {tasksByDay[i].map((t) => {
                const dueMin = t.due ? minutesOfDay(t.due) : 0;
                return (
                  <button
                    type="button"
                    className={taskStyles.agxTask}
                    key={t.name}
                    onClick={() => onCompleteTask(t)}
                    title={`Tarea: ${t.subject} · ${fmtMin(dueMin)} · marcar como hecha`}
                    aria-label={accessibleTaskName(dayLong(date), dueMin, t.subject, t.priority)}
                  >
                    <IconCheck className={taskStyles.agxTaskIco} />
                    <span className={taskStyles.agxTaskT} aria-hidden="true">
                      {t.subject}
                    </span>
                    <span className={taskStyles.agxTaskH} aria-hidden="true">
                      {fmtMin(dueMin)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={styles.agxGridwrap}
        ref={wrapRef}
        tabIndex={0}
        role="region"
        aria-label={`Agenda de la semana del ${weekLabel}`}
      >
        <div className={styles.agxHeads} ref={headsRef}>
          <div className={styles.agxColhead} aria-hidden="true" />
          {days.map((date) => {
            const today = sameDay(date, now);
            return (
              <div className={`${styles.agxColhead}${today ? ` ${styles.today}` : ""}`} key={ymd(date)}>
                <span className={styles.agxDow}>{DOW_SHORT[weekdayIndex(date)]}</span>
                <span className={styles.agxDom}>{date.getDate()}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.agxDays} style={{ height: gridH }}>
          <div className={styles.agxGutter} aria-hidden="true" style={{ height: gridH }}>
            {HOUR_LIST.map((h) => {
              const transform =
                h === START_H ? "translateY(0)" : h === END_H ? "translateY(-100%)" : "translateY(-50%)";
              return (
                <span
                  className={styles.agxHourlab}
                  key={h}
                  style={{ top: minutesToY(h * 60, hourH), transform }}
                >
                  {fmtMin(h * 60)}
                </span>
              );
            })}
          </div>

          {days.map((date, dayIdx) => {
            const today = sameDay(date, now);
            return (
              <div
                className={`${styles.agxCol}${today ? ` ${styles.today}` : ""}`}
                key={ymd(date)}
                data-day={dayIdx}
                onPointerDown={(e) => onColPointerDown(e, dayIdx)}
              >
                {HOUR_LIST.map((h) => (
                  <div
                    className={styles.agxHl}
                    aria-hidden="true"
                    key={h}
                    style={{ top: minutesToY(h * 60, hourH) }}
                  />
                ))}

                {columns[dayIdx].map((p) => {
                  const top = minutesToY(p.startMin, hourH);
                  const height = blockHeight(p.endMin - p.startMin, hourH);
                  const density = blockDensity(height);
                  const narrow = p.lanes > 1;
                  return (
                    <button
                      type="button"
                      className={styles.agxEv}
                      key={`${p.event.name}#${p.startMin}#${p.endMin}`}
                      data-ev={p.event.name}
                      data-compact={density === "compact" ? "" : undefined}
                      data-tiny={density === "tiny" ? "" : undefined}
                      data-narrow={narrow ? "" : undefined}
                      aria-haspopup="menu"
                      aria-expanded={expandedName === p.event.name}
                      onPointerDown={(e) => onEventPointerDown(e, p, dayIdx)}
                      onClick={(e) => {
                        if (suppressClick.current) return;
                        onOpenMenu(p.event, e.currentTarget);
                      }}
                      style={
                        {
                          top,
                          height,
                          "--lane": p.lane,
                          "--lanes": p.lanes,
                          "--agx-ev-color": categoryOf(p.event.category).color,
                        } as CSSProperties
                      }
                      title={`${p.event.subject} · ${fmtMin(p.startMin)} – ${fmtMin(p.endMin)}`}
                      aria-label={accessibleName(
                        dayLong(date),
                        p.startMin,
                        p.endMin,
                        p.event.subject,
                        false,
                        p.event.category,
                      )}
                    >
                      <span className={styles.agxEvIn}>
                        <span className={styles.agxEvM}>
                          {fmtMin(p.startMin)}
                          <span className={styles.to}> – {fmtMin(p.endMin)}</span>
                        </span>
                        <span className={styles.agxEvT}>{p.event.subject}</span>
                      </span>
                      <span className={styles.agxGrip} data-grip aria-hidden="true" />
                    </button>
                  );
                })}

                {dragCreate && dragCreate.day === dayIdx ? (
                  <div
                    className={styles.agxGhost}
                    aria-hidden="true"
                    style={{
                      top: minutesToY(dragCreate.min, hourH),
                      height: blockHeight(dragCreate.dur, hourH),
                    }}
                  >
                    <span className={styles.agxGhostM}>
                      {fmtMin(dragCreate.min)} – {fmtMin(dragCreate.min + dragCreate.dur)}
                    </span>
                  </div>
                ) : null}

                {today ? (
                  <div
                    className={styles.agxNow}
                    aria-hidden="true"
                    style={{ top: minutesToY(nowMin, hourH) }}
                  >
                    <span className={styles.agxNowKnob} />
                    <span className={styles.agxNowBar} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {dragLabel ? (
        <div className={styles.agxDroplab} aria-hidden="true" style={{ left: drag!.x + 14, top: drag!.y + 14 }}>
          <b>{dragLabel}</b>
        </div>
      ) : null}
    </>
  );
}
