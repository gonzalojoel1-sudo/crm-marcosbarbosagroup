import { useEffect, useRef, useState } from "react";
import { api, type MeetingDetail } from "./api";

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtDT(s: string | null): string {
  if (!s) return "";
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

export default function MeetingModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getMeeting(name).then(setM);
  }, [name]);

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
      prev ? { ...prev, tasks: prev.tasks.map((x) => (x.name === t.name ? { ...x, status: r.status } : x)) } : prev,
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        {!m ? (
          <div className="detail-loading">Cargando…</div>
        ) : (
          <>
            <div className="detail-head">
              <div>
                <h3>{m.subject}</h3>
                <p className="modal-when">
                  {m.meeting ? fmtDT(m.meeting) : "Sin fecha"}
                  {m.source ? ` · ${m.source}` : ""}
                </p>
              </div>
              <button className="icon" onClick={onClose} title="Cerrar">
                ✕
              </button>
            </div>

            <div className="detail-meta">
              {m.who ? <div><span className="k">Contacto</span><span>{m.who}</span></div> : null}
              {m.email ? (
                <div>
                  <span className="k">Email</span>
                  <a href={`mailto:${m.email}`}>{m.email}</a>
                </div>
              ) : null}
              {m.mobile_no ? (
                <div>
                  <span className="k">Teléfono</span>
                  <a href={`tel:${m.mobile_no.replace(/\s/g, "")}`}>{m.mobile_no}</a>
                </div>
              ) : null}
              {m.status ? <div><span className="k">Estado</span><span>{m.status}</span></div> : null}
            </div>

            {m.description ? (
              <div className="detail-block">
                <h4>Sobre</h4>
                <p>{m.description}</p>
              </div>
            ) : null}

            {m.tasks.length > 0 ? (
              <div className="detail-block">
                <h4>Tareas</h4>
                <ul className="dtasks">
                  {m.tasks.map((t) => (
                    <li key={t.name} className={t.status === "Done" ? "done" : ""}>
                      <button className="dcheck" onClick={() => toggle(t)} aria-label="alternar">
                        {t.status === "Done" ? "✓" : ""}
                      </button>
                      <span className="subject">{t.title}</span>
                      {t.due_date ? <span className="when">{t.due_date.slice(0, 10)}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="detail-block">
              <h4>Comentarios</h4>
              {m.comments.length > 0 ? (
                <ul className="comments">
                  {m.comments.map((c) => (
                    <li key={c.name}>
                      <div className="ctext">{c.content}</div>
                      <div className="cmeta">
                        {c.by} · {relWhen(c.when)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Sin comentarios todavía.</p>
              )}

              <div className="comment-box">
                <textarea
                  ref={boxRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                  }}
                  placeholder="Escribir un comentario…  (⌘+Enter para enviar)"
                  rows={2}
                />
                <button className="btn-primary" onClick={send} disabled={!draft.trim() || sending}>
                  {sending ? "Enviando…" : "Comentar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
