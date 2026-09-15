import { useEffect, useRef, useState } from "react";
import { api, type DealInput } from "./api";
import { IconX } from "./icons";

const STAGES = [
  "Qualification",
  "Diagnóstico",
  "Análisis",
  "Estrategia",
  "Implementación",
  "Seguimiento",
  "Escalamiento",
  "Won",
  "Lost",
];

export default function DealDrawer({
  name,
  onClose,
  onSaved,
}: {
  name?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(name);
  const [title, setTitle] = useState("");
  const [form, setForm] = useState({
    contact: "",
    value: "",
    date: "",
    next_step: "",
    probability: "",
    status: "Qualification",
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!name) return;
    api.getDeal(name).then((d) => {
      setTitle(d.title);
      setForm({
        contact: d.contact,
        value: d.value != null ? String(d.value) : "",
        date: d.date,
        next_step: d.next_step,
        probability: d.probability != null ? String(d.probability) : "",
        status: d.status || "Qualification",
      });
      setLoading(false);
    });
  }, [name]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = editing || title.trim();

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    const fields: DealInput = {
      contact: form.contact,
      deal_value: form.value,
      expected_closure_date: form.date,
      next_step: form.next_step,
      probability: form.probability,
      status: form.status,
    };
    try {
      if (editing && name) await api.updateDeal(name, fields);
      else await api.createDeal({ title: title.trim(), ...fields });
      onSaved();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Negocio">
        <header className="drawer-head">
          <div className="dh-row">
            <span className="eyebrow">Negocio</span>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <IconX />
            </button>
          </div>
          <h2>{editing ? title : "Nuevo negocio"}</h2>
        </header>

        {loading ? (
          <div className="drawer-loading">Cargando…</div>
        ) : (
          <div className="drawer-body">
            <div className="form">
              {!editing ? (
                <label className="field">
                  <span>Empresa</span>
                  <input
                    ref={firstRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Constructora Del Sur"
                  />
                </label>
              ) : null}
              <label className="field">
                <span>Contacto</span>
                <input
                  value={form.contact}
                  onChange={(e) => set("contact", e.target.value)}
                  placeholder="Nombre del contacto"
                />
              </label>
              <div className="row2">
                <label className="field">
                  <span>Valor</span>
                  <input
                    value={form.value}
                    onChange={(e) => set("value", e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span>Cierre estimado</span>
                  <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>Próximo paso</span>
                <input
                  value={form.next_step}
                  onChange={(e) => set("next_step", e.target.value)}
                  placeholder="Enviar propuesta técnica"
                />
              </label>
              <div className="row2">
                <label className="field">
                  <span>Etapa</span>
                  <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Probabilidad %</span>
                  <input
                    value={form.probability}
                    onChange={(e) => set("probability", e.target.value)}
                    placeholder="50"
                    inputMode="numeric"
                  />
                </label>
              </div>
              {error ? <p className="error">{error}</p> : null}
            </div>
          </div>
        )}

        <footer className="drawer-foot">
          <div className="foot-actions">
            <button className="ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={save} disabled={!canSave || saving || loading}>
              {saving ? "Guardando…" : editing ? "Guardar" : "Crear negocio"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
