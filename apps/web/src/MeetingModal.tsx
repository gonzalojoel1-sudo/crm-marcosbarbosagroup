import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type MeetingDetail } from "./api";
import { IconCheck, IconClock, IconMail, IconNotes, IconPhone, IconPlus, IconUser, IconX } from "./icons";

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const STATUSES = ["New", "Contacted", "Qualified", "Nurture", "Unqualified", "Junk", "Converted"];

function EditableMeta({
  icon,
  value,
  placeholder,
  onSave,
}: {
  icon: ReactNode;
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);

  if (editing) {
    return (
      <div className="meta-row editing">
        {icon}
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(v);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setV(value);
              setEditing(false);
            }
          }}
          onBlur={() => {
            onSave(v);
            setEditing(false);
          }}
        />
      </div>
    );
  }
  return (
    <button className="meta-row" onClick={() => setEditing(true)}>
      {icon}
      <span className={value ? "" : "muted"}>{value || placeholder}</span>
    </button>
  );
}

function fmtDT(s: string | null): string {
  if (!s) return "Sin fecha";
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function relWhen(s: string): string {
  const d = new Date(s.replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())} ${MON[d.getMonth()]} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MeetingDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setM(null);
    api.getMeeting(name).then(setM);
  }, [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const c = await api.addNote(name, text);
      setM((prev) => (prev ? { ...prev, comments: [c, ...prev.comments] } : prev));
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  async function toggle(t: { name: string; status: string }) {
    const r = await api.toggleTask(t.name);
    setM((prev) =>
      prev
        ? { ...prev, tasks: prev.tasks.map((x) => (x.name === t.name ? { ...x, status: r.status } : x)) }
        : prev,
    );
  }

  async function addTask() {
    const title = newTask.trim();
    if (!title || addingTask || !m) return;
    setAddingTask(true);
    try {
      const t = await api.addTask(title, m.name);
      setM((prev) =>
        prev ? { ...prev, tasks: [...prev.tasks, { ...t, priority: "Medium", due_date: null }] } : prev,
      );
      setNewTask("");
    } finally {
      setAddingTask(false);
    }
  }

  async function saveField(field: "email" | "mobile_no" | "organization" | "status", value: string) {
    if (!m) return;
    setM({ ...m, [field]: value });
    await api.updateLead(m.name, { [field]: value });
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detalle de reunión">
        {!m ? (
          <div className="drawer-loading">Cargando…</div>
        ) : (
          <>
            <header className="drawer-head">
              <div className="dh-row">
                <span className="eyebrow">Reunión</span>
                <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
                  <IconX />
                </button>
              </div>
              <h2>{m.subject}</h2>
              <div className="dh-when">
                <IconClock width={14} height={14} />
                {fmtDT(m.meeting)}
                {m.source ? <span className="dh-src">{m.source}</span> : null}
              </div>
            </header>

            <div className="drawer-body">
              <div className="actions">
                {m.mobile_no ? (
                  <a className="act" href={`tel:${m.mobile_no.replace(/\s/g, "")}`}>
                    <IconPhone width={15} height={15} />
                    Llamar
                  </a>
                ) : null}
                {m.email ? (
                  <a className="act" href={`mailto:${m.email}`}>
                    <IconMail width={15} height={15} />
                    Email
                  </a>
                ) : null}
                <button className="act" onClick={() => commentRef.current?.focus()}>
                  <IconNotes width={15} height={15} />
                  Nota
                </button>
              </div>

              <div className="meta">
                {m.who ? (
                  <div className="meta-row static">
                    <IconUser width={16} height={16} />
                    <span>{m.who}</span>
                  </div>
                ) : null}
                <EditableMeta
                  icon={<IconMail width={16} height={16} />}
                  value={m.email}
                  placeholder="Agregar email"
                  onSave={(v) => saveField("email", v)}
                />
                <EditableMeta
                  icon={<IconPhone width={16} height={16} />}
                  value={m.mobile_no}
                  placeholder="Agregar teléfono"
                  onSave={(v) => saveField("mobile_no", v)}
                />
                <EditableMeta
                  icon={<IconUser width={16} height={16} />}
                  value={m.organization}
                  placeholder="Agregar empresa"
                  onSave={(v) => saveField("organization", v)}
                />
                <div className="meta-row static">
                  <IconCheck width={16} height={16} />
                  <select
                    className="status-select"
                    value={m.status}
                    onChange={(e) => saveField("status", e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {m.description ? (
                <section className="blk">
                  <h4>Sobre</h4>
                  <p className="body-text">{m.description}</p>
                </section>
              ) : null}

              <section className="blk">
                <h4>Tareas</h4>
                {m.tasks.length > 0 ? (
                  <ul className="dtasks">
                    {m.tasks.map((t) => (
                      <li key={t.name} className={t.status === "Done" ? "done" : ""}>
                        <button className="dcheck" onClick={() => toggle(t)} aria-label="alternar">
                          {t.status === "Done" ? <IconCheck width={12} height={12} /> : null}
                        </button>
                        <span className="subject">{t.title}</span>
                        {t.due_date ? <span className="when">{t.due_date.slice(0, 10)}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Sin tareas todavía.</p>
                )}
                <div className="task-add">
                  <input
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTask();
                    }}
                    placeholder="Nueva tarea para este contacto…"
                  />
                  <button
                    className="add-btn"
                    onClick={addTask}
                    disabled={!newTask.trim() || addingTask}
                    aria-label="Agregar tarea"
                  >
                    <IconPlus width={16} height={16} />
                  </button>
                </div>
              </section>

              <section className="blk">
                <h4>Comentarios</h4>
                {m.comments.length > 0 ? (
                  <ul className="comments">
                    {m.comments.map((c) => (
                      <li key={c.name}>
                        <p className="ctext">{c.content}</p>
                        <div className="cmeta">
                          {c.by} · {relWhen(c.when)}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Todavía no hay comentarios. Escribí el primero abajo.</p>
                )}
              </section>
            </div>

            <footer className="drawer-foot">
              <textarea
                ref={commentRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                placeholder="Escribir un comentario…"
                rows={2}
              />
              <button className="btn-primary" onClick={send} disabled={!draft.trim() || sending}>
                {sending ? "Enviando…" : "Comentar"}
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
