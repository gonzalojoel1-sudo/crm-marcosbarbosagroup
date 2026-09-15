import { useEffect, useRef, useState } from "react";
import { api, type DealDTO } from "./api";
import { IconPlus } from "./icons";

export default function Pipeline() {
  const [deals, setDeals] = useState<DealDTO[] | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const dragName = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const r = await api.getDeals();
    setDeals(r.deals);
    setStages(r.stages);
  }

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);
  useEffect(() => {
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function create() {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    setCreating(false);
    await api.createDeal(t);
    await load();
  }

  async function move(name: string, status: string) {
    setMenu(null);
    setDeals((d) => (d ? d.map((x) => (x.name === name ? { ...x, status } : x)) : d));
    await api.moveDeal(name, status);
  }

  const byStage = (s: string) => (deals ?? []).filter((d) => d.status === s);

  return (
    <div className="pipe">
      <div className="pipe-bar">
        <h1 className="ag-range">Pipeline</h1>
        {creating ? (
          <input
            ref={inputRef}
            className="pipe-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            onBlur={() => setCreating(false)}
            placeholder="Nombre del negocio…"
          />
        ) : (
          <button className="ghost" onClick={() => setCreating(true)}>
            <IconPlus width={15} height={15} /> Nuevo negocio
          </button>
        )}
      </div>

      {!deals ? (
        <div className="skeleton">
          <div className="sk" />
        </div>
      ) : (
        <div className="pipe-board">
          {stages.map((s) => {
            const items = byStage(s);
            const won = s === "Won";
            const lost = s === "Lost";
            return (
              <section
                className={`pipe-col${dragOver === s ? " over" : ""}${won ? " won" : lost ? " lost" : ""}`}
                key={s}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(s);
                }}
                onDragLeave={() => setDragOver((v) => (v === s ? null : v))}
                onDrop={() => {
                  setDragOver(null);
                  if (dragName.current) move(dragName.current, s);
                }}
              >
                <header className="pipe-col-head">
                  <span className="pipe-col-name">{s}</span>
                  <span className="pipe-count">{items.length}</span>
                </header>
                <div className="pipe-col-body">
                  {items.map((d) => (
                    <div
                      className="pipe-card"
                      key={d.name}
                      draggable
                      onDragStart={() => (dragName.current = d.name)}
                      onDragEnd={() => (dragName.current = null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu((m) => (m === d.name ? null : d.name));
                      }}
                    >
                      <span className="pipe-card-title">{d.title}</span>
                      {d.org && d.org !== d.title ? <span className="pipe-card-sub">{d.org}</span> : null}
                      {menu === d.name ? (
                        <div className="pipe-menu" onClick={(e) => e.stopPropagation()}>
                          {stages
                            .filter((x) => x !== d.status)
                            .map((x) => (
                              <button key={x} onClick={() => move(d.name, x)}>
                                {x}
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {items.length === 0 ? <p className="pipe-empty">—</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
