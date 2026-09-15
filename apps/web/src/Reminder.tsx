import { useEffect, useState } from "react";
import { api, type EventDTO } from "./api";
import { IconClock, IconX } from "./icons";

function minutesUntil(iso: string, now: Date): number {
  const d = new Date(iso.replace(" ", "T"));
  return Math.round((d.getTime() - now.getTime()) / 60000);
}

export default function Reminder({ onOpen }: { onOpen: (name: string) => void }) {
  const [next, setNext] = useState<EventDTO | null>(null);
  const [mins, setMins] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let timer: number;
    async function tick() {
      try {
        const r = await api.getReminders();
        const now = new Date(r.now.replace(" ", "T"));
        const soon = r.meetings.find((m) => {
          const d = minutesUntil(m.starts_on, now);
          return d <= 30;
        });
        if (soon) {
          setNext(soon);
          setMins(minutesUntil(soon.starts_on, now));
        } else {
          setNext(null);
        }
      } catch {
        /* silencioso: el aviso no debe romper la app */
      }
      timer = window.setTimeout(tick, 60000);
    }
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  if (!next || dismissed === next.name) return null;

  const label = mins <= 0 ? "Ahora" : `En ${mins} min`;
  return (
    <div className="reminder" role="status">
      <span className="rem-clock">
        <IconClock width={16} height={16} />
      </span>
      <span className="rem-when">{label}</span>
      <span className="rem-title">{next.subject}</span>
      <button className="rem-open" onClick={() => onOpen(next.name)}>
        Ver
      </button>
      <button className="rem-x" onClick={() => setDismissed(next.name)} aria-label="Descartar">
        <IconX width={14} height={14} />
      </button>
    </div>
  );
}
