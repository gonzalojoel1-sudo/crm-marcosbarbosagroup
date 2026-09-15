import { useEffect, useState } from "react";
import { api, type DealDTO, type LeadDTO } from "./api";
import { leadSourceLabel, stageLabel } from "./labels";
import {
  IconCalendar,
  IconChevronRight,
  IconPlus,
  IconReceipt,
  IconTarget,
  IconTrash,
  IconTrophy,
  IconUser,
} from "./icons";
import DealDrawer from "./DealDrawer";

const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const STAGE_COLOR: Record<string, string> = {
  Qualification: "#3b82f6",
  Diagnóstico: "#06b6d4",
  Análisis: "#8b5cf6",
  Estrategia: "#6366f1",
  Implementación: "#f59e0b",
  Seguimiento: "#fe4100",
  Escalamiento: "#ec4899",
  Won: "#22c55e",
  Lost: "#6b7280",
};

function color(s: string): string {
  return STAGE_COLOR[s] ?? "#fe4100";
}
function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
function fmtMoney(v: number | null, cur: string): string {
  if (v == null) return "";
  const sym = cur === "USD" ? "US$" : "$";
  return sym + v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}
function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

type MenuPos = { name: string; status: string; x: number; y: number };

export default function Pipeline() {
  const [deals, setDeals] = useState<DealDTO[] | null>(null);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [dealDrawer, setDealDrawer] = useState<{ name?: string; organization?: string } | null>(null);
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const r = await api.getDeals();
    setDeals(r.deals);
    setStages(r.stages);
    setLeads(r.leads);
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  async function move(name: string, status: string) {
    setMenu(null);
    setDeals((d) => (d ? d.map((x) => (x.name === name ? { ...x, status } : x)) : d));
    await api.moveDeal(name, status);
  }
  async function remove(name: string) {
    setMenu(null);
    setDeals((d) => (d ? d.filter((x) => x.name !== name) : d));
    await api.deleteDeal(name);
  }
  async function convert(l: LeadDTO) {
    setBusy(l.name);
    try {
      await api.convertLeadToDeal(l.name);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const byStage = (s: string) => (deals ?? []).filter((d) => d.status === s);
  const sum = (items: DealDTO[]) => items.reduce((a, d) => a + (d.value ?? 0), 0);

  return (
    <div className="pipe">
      <div className="pipe-bar">
        <h1 className="ag-range">Negocios</h1>
        <button className="ghost" onClick={() => setDealDrawer({})}>
          <IconPlus width={15} height={15} /> Nuevo negocio
        </button>
      </div>

      {!deals ? (
        <div className="skeleton">
          <div className="sk" style={{ height: 160 }} />
        </div>
      ) : (
        <>
          {leads.length > 0 ? (
            <section className="inbox">
              <header className="inbox-head">
                <IconTarget className="inbox-ico" width={16} height={16} />
                <h2>Sin negocio</h2>
                <span className="inbox-count">{leads.length}</span>
                <p className="inbox-sub">Contactos que todavía no están en el embudo.</p>
              </header>
              <div className="inbox-list">
                {leads.map((l) => (
                  <article className="lead-card" key={l.name}>
                    <span className="avatar sm">{initials(l.who)}</span>
                    <div className="lead-card-main">
                      <span className="lead-who">{l.who}</span>
                      <span className="lead-sub">
                        {[leadSourceLabel(l.source), l.organization || l.email || l.mobile_no]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                    <button className="lead-convert" onClick={() => convert(l)} disabled={busy === l.name}>
                      {busy === l.name ? "Creando…" : "Crear negocio"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {deals.length === 0 ? (
            <div className="empty">
              <IconPlus className="empty-ico" />
              {leads.length > 0
                ? "Pasá un contacto a negocio para arrancar el embudo."
                : "Todavía no hay negocios. Creá uno con “Nuevo negocio”."}
            </div>
          ) : (
            <div className="board">
              {stages.map((s) => {
                const items = byStage(s);
                if (items.length === 0) return null;
                const c = color(s);
                const won = s === "Won";
                return (
                  <section className="stage" key={s} style={{ ["--c" as string]: c }}>
                    <header className="stage-head">
                      <span className="stage-dot" />
                      <h2 className="stage-name">
                        {won ? <IconTrophy width={15} height={15} className="stage-ico" /> : null}
                        {stageLabel(s)}
                      </h2>
                      <span className="stage-count">{items.length}</span>
                      {sum(items) > 0 ? (
                        <span className="stage-total">{fmtMoney(sum(items), items[0]?.currency ?? "")}</span>
                      ) : null}
                    </header>
                    <div className="stage-cards">
                      {items.map((d) => (
                        <article
                          className="deal"
                          key={d.name}
                          onClick={() => setDealDrawer({ name: d.name })}
                        >
                          <div className="deal-top">
                            <span className="deal-org">{d.title}</span>
                            {d.value != null ? (
                              <span className="deal-value">{fmtMoney(d.value, d.currency)}</span>
                            ) : null}
                          </div>
                          {d.contact ? (
                            <span className="deal-line">
                              <IconUser width={13} height={13} />
                              {d.contact}
                            </span>
                          ) : null}
                          {d.next_step ? (
                            <span className="deal-line deal-next">
                              <IconTarget width={13} height={13} />
                              {d.next_step}
                            </span>
                          ) : null}
                          <footer className="deal-foot">
                            {d.has_quote ? (
                              <span className="deal-chip" title="Tiene presupuesto">
                                <IconReceipt width={12} height={12} /> Presupuesto
                              </span>
                            ) : null}
                            {d.date ? (
                              <span className="deal-date">
                                <IconCalendar width={13} height={13} />
                                {fmtDate(d.date)}
                              </span>
                            ) : null}
                            {d.owner ? (
                              <span className="deal-owner" title={d.owner}>
                                {initials(d.owner)}
                              </span>
                            ) : null}
                            <button
                              className="deal-more"
                              aria-label="Acciones"
                              onClick={(e) => {
                                e.stopPropagation();
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setMenu((m) =>
                                  m?.name === d.name
                                    ? null
                                    : { name: d.name, status: d.status, x: r.left - 150, y: r.bottom + 4 },
                                );
                              }}
                            >
                              ⋯
                            </button>
                          </footer>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {dealDrawer ? (
        <DealDrawer
          name={dealDrawer.name}
          organization={dealDrawer.organization}
          onClose={() => {
            setDealDrawer(null);
            load();
          }}
        />
      ) : null}

      {menu ? (
        <div
          className="pipe-menu"
          style={{ position: "fixed", left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="pipe-menu-label">Mover a</span>
          {stages
            .filter((x) => x !== menu.status)
            .map((x) => (
              <button key={x} onClick={() => move(menu.name, x)}>
                <span className="menu-dot" style={{ background: color(x) }} />
                {stageLabel(x)}
              </button>
            ))}
          <div className="pipe-menu-sep" />
          <button className="danger" onClick={() => remove(menu.name)}>
            <IconTrash width={14} height={14} /> Eliminar
          </button>
        </div>
      ) : null}
    </div>
  );
}
