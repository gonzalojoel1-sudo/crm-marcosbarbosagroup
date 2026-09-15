import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { leadSourceLabel } from "./labels";
import { IconX } from "./icons";

const SOURCES = [
  "Website",
  "Referido",
  "LinkedIn",
  "WhatsApp",
  "Cold Calling",
  "Agenda Reunión",
];

export default function NewLead({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [source, setSource] = useState("Referido");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSave = (first.trim() || email.trim()) && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.createLead({
        first_name: first,
        last_name: last,
        email,
        mobile_no: phone,
        organization: org,
        source,
        notes,
      });
      onCreated(r.name);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Nuevo contacto">
        <header className="drawer-head">
          <div className="dh-row">
            <span className="eyebrow">Contacto</span>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <IconX />
            </button>
          </div>
          <h2>Nuevo contacto</h2>
        </header>

        <div className="drawer-body">
          <div className="form">
            <div className="row2">
              <label className="field">
                <span>Nombre</span>
                <input ref={firstRef} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Juan" />
              </label>
              <label className="field">
                <span>Apellido</span>
                <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Pérez" />
              </label>
            </div>
            <label className="field">
              <span>Correo</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="juan@empresa.com"
              />
            </label>
            <label className="field">
              <span>Teléfono</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+54 9 …" />
            </label>
            <label className="field">
              <span>Empresa</span>
              <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Empresa S.A." />
            </label>
            <label className="field">
              <span>Origen</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {leadSourceLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Nota</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="De qué se trata…"
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
          </div>
        </div>

        <footer className="drawer-foot">
          <div className="foot-actions">
            <button className="ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={save} disabled={!canSave}>
              {saving ? "Creando…" : "Crear contacto"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
