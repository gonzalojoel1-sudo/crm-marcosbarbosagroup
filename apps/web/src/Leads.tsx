import { useEffect, useMemo, useState } from "react";
import { api, type LeadDTO } from "./api";
import { IconChevronRight, IconPlus, IconUser } from "./icons";
import NewLead from "./NewLead";

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function initials(who: string): string {
  const parts = who.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}
function fmtMeeting(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("convert") || s.includes("won")) return "on-ok";
  if (s.includes("lost") || s.includes("unqual")) return "on-danger";
  return "";
}

export default function Leads({ onOpen }: { onOpen: (name: string) => void }) {
  const [all, setAll] = useState<LeadDTO[] | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.getLeads().then((r) => setAll(r.leads));
  }, []);

  function load() {
    api.getLeads().then((r) => setAll(r.leads));
  }

  const leads = useMemo(() => {
    const list = all ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((l) =>
      [l.who, l.email, l.mobile_no, l.organization, l.source].join(" ").toLowerCase().includes(t),
    );
  }, [all, q]);

  return (
    <main className="wrap leads-wrap">
      <header className="head">
        <div>
          <h1>Contactos</h1>
          <p className="date">
            {all ? `${all.length} contacto${all.length === 1 ? "" : "s"}` : "\u00a0"}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <IconPlus width={16} height={16} />
          Nuevo
        </button>
      </header>

      <div className="quick search">
        <IconUser width={17} height={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, email o teléfono…"
          autoComplete="off"
        />
      </div>

      {!all ? (
        <div className="skeleton">
          <div className="sk" />
          <div className="sk" />
          <div className="sk" />
        </div>
      ) : leads.length === 0 ? (
        <div className="empty">
          <IconUser className="empty-ico" />
          {q ? "Ningún contacto coincide con la búsqueda" : "Todavía no hay contactos"}
        </div>
      ) : (
        <ul className="list leads">
          {leads.map((l) => (
            <li className="lead" key={l.name} onClick={() => onOpen(l.name)}>
              <span className="avatar">{initials(l.who)}</span>
              <div className="lead-main">
                <span className="lead-who">{l.who}</span>
                <span className="lead-sub">{l.email || l.mobile_no || l.organization || "—"}</span>
              </div>
              {l.meeting ? <span className="lead-meet">{fmtMeeting(l.meeting)}</span> : null}
              {l.status ? (
                <span className={`tag ${statusClass(l.status)}`}>{l.status}</span>
              ) : null}
              <IconChevronRight className="lead-go" width={16} height={16} />
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <NewLead
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            load();
            onOpen(name);
          }}
        />
      ) : null}
    </main>
  );
}
