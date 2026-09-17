import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { DOW_SHORT, accessibleName, dayLong, fmtMin, sameDay, weekdayIndex, ymd } from "./date";
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
  type Placed,
  yToMinutes,
} from "./geometry";
import type { AgendaEvent, DensityStep } from "./types";

const HOUR_LIST = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

interface WeekViewProps {
  days: Date[];
  events: AgendaEvent[];
  zoom: DensityStep;
  now: Date;
  weekLabel: string;
  onCreateSlot: (dayIndex: number, startMin: number) => void;
  onOpenMenu: (event: AgendaEvent, trigger: HTMLElement) => void;
  expandedName: string | null;
}

const DRAG_UMBRAL = 4; // menos de 4 px de movimiento es un click, no un arrastre

export default function WeekView({
  days,
  events,
  zoom,
  now,
  weekLabel,
  onCreateSlot,
  onOpenMenu,
  expandedName,
}: WeekViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const prevHourH = useRef<number | null>(null);
  const jumped = useRef(false);
  const downRef = useRef<{ x: number; y: number; day: number } | null>(null);

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

  const columns = useMemo<Placed[][]>(
    () =>
      days.map((date) => {
        const todays = events.filter((e) => !e.allDay && sameDay(e.start, date));
        const items = todays.map((e) => {
          const { startMin, endMin } = eventMinutes(e);
          return { event: e, startMin, endMin };
        });
        const lanes = layoutLanes(items);
        return items.map((it) => ({ ...it, ...(lanes.get(it) ?? { lane: 0, lanes: 1 }) }));
      }),
    [days, events],
  );

  const allDayByDay = useMemo(
    () => days.map((date) => events.filter((e) => e.allDay && sameDay(e.start, date))),
    [days, events],
  );
  const hasAllDay = allDayByDay.some((list) => list.length > 0);

  // SC 2.5.7: un solo puntero, sin arrastrar. El click en un hueco vacío abre el
  // panel con el día y la media hora MÁS CERCANA al click; si el puntero se movió
  // más de 4 px no es un click (el arrastre llega en otra fase).
  function onColPointerDown(e: PointerEvent<HTMLDivElement>, dayIdx: number) {
    if ((e.target as Element).closest(".agx-ev")) return;
    downRef.current = { x: e.clientX, y: e.clientY, day: dayIdx };
  }

  function onColPointerUp(e: PointerEvent<HTMLDivElement>, dayIdx: number) {
    const d = downRef.current;
    downRef.current = null;
    if (!d || d.day !== dayIdx) return;
    if ((e.target as Element).closest(".agx-ev")) return;
    if (Math.abs(e.clientX - d.x) > DRAG_UMBRAL || Math.abs(e.clientY - d.y) > DRAG_UMBRAL) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const snapped = Math.round(yToMinutes(e.clientY - rect.top, hourH) / 30) * 30;
    const startMin = Math.max(START_H * 60, Math.min(END_H * 60 - 30, snapped));
    onCreateSlot(dayIdx, startMin);
  }

  return (
    <>
      {hasAllDay ? (
        <div className="agx-allday" role="group" aria-label="Reuniones de todo el día">
          <div className="agx-allday-lab" aria-hidden="true">
            Todo el día
          </div>
          {days.map((date, i) => (
            <div className="agx-allday-cell" key={ymd(date)}>
              {allDayByDay[i].map((e) => (
                <span className="agx-allday-ev" key={e.name} title={e.subject}>
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

      <div
        className="agx-gridwrap"
        ref={wrapRef}
        tabIndex={0}
        role="region"
        aria-label={`Agenda de la semana del ${weekLabel}`}
      >
        <div className="agx-heads" ref={headsRef}>
          <div className="agx-colhead gutter" aria-hidden="true" />
          {days.map((date) => {
            const today = sameDay(date, now);
            return (
              <div className={`agx-colhead${today ? " today" : ""}`} key={ymd(date)}>
                <span className="agx-dow">{DOW_SHORT[weekdayIndex(date)]}</span>
                <span className="agx-dom">{date.getDate()}</span>
              </div>
            );
          })}
        </div>

        <div className="agx-days" style={{ height: gridH }}>
          <div className="agx-gutter" aria-hidden="true" style={{ height: gridH }}>
            {HOUR_LIST.map((h) => {
              const transform =
                h === START_H ? "translateY(0)" : h === END_H ? "translateY(-100%)" : "translateY(-50%)";
              return (
                <span
                  className="agx-hourlab"
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
                className={`agx-col${today ? " today" : ""}`}
                key={ymd(date)}
                onPointerDown={(e) => onColPointerDown(e, dayIdx)}
                onPointerUp={(e) => onColPointerUp(e, dayIdx)}
              >
                {HOUR_LIST.map((h) => (
                  <div
                    className="agx-hl"
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
                      className="agx-ev"
                      key={p.event.name}
                      data-ev={p.event.name}
                      data-compact={density === "compact" ? "" : undefined}
                      data-tiny={density === "tiny" ? "" : undefined}
                      data-narrow={narrow ? "" : undefined}
                      aria-haspopup="menu"
                      aria-expanded={expandedName === p.event.name}
                      onClick={(e) => onOpenMenu(p.event, e.currentTarget)}
                      style={
                        {
                          top,
                          height,
                          "--lane": p.lane,
                          "--lanes": p.lanes,
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
                      <span className="agx-ev-m">
                        {fmtMin(p.startMin)}
                        <span className="to"> – {fmtMin(p.endMin)}</span>
                      </span>
                      <span className="agx-ev-t">{p.event.subject}</span>
                    </button>
                  );
                })}

                {today ? (
                  <div
                    className="agx-now"
                    aria-hidden="true"
                    style={{ top: minutesToY(nowMin, hourH) }}
                  >
                    <span className="agx-now-knob" />
                    <span className="agx-now-bar" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
