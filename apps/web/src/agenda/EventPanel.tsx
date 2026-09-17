import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { dayLong, dayShort, fmtMin, ymd } from "./date";

// El panel es la ÚNICA superficie de creación y edición (spec S1). No es modal:
// la grilla queda visible y operable detrás; no atrapa el foco (se puede tabular
// afuera) y Escape cierra sin guardar devolviendo el foco a donde estaba.
export interface PanelContext {
  mode: "crear" | "editar";
  day: Date;
  startMin: number;
  durMin: number;
  name?: string;
  subject?: string;
  returnFocus: HTMLElement | null;
}

export interface SavedInfo {
  name: string;
  announcement: string;
}

const DURACIONES = [15, 30, 45, 60, 90];
const HINT_ID = "agx-p-inicio-ayuda";

// Acepta 09:00, 9:00 y 9.30 (el prototipo documenta esos formatos). null si no
// es una hora real: el panel muestra el error y no llama a la API.
function parseHora(raw: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

interface EventPanelProps {
  ctx: PanelContext;
  onClose: () => void;
  onSaved: (s: SavedInfo) => void;
}

export default function EventPanel({ ctx, onClose, onSaved }: EventPanelProps) {
  const editando = ctx.mode === "editar";
  const [titulo, setTitulo] = useState(ctx.subject ?? "");
  const [inicio, setInicio] = useState(fmtMin(ctx.startMin));
  const [dur, setDur] = useState(ctx.durMin);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const tituloRef = useRef<HTMLInputElement>(null);
  const notasOriginales = useRef("");

  // Foco al primer campo al abrir (spec S1). Mover el foco ES el anuncio: su
  // nombre accesible trae día, hora y título, así que no se escribe la región viva.
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  // Las notas viven en `Event.description`, que el DTO de la agenda no trae: se
  // leen al abrir la edición. Si la lectura falla, el campo arranca vacío y no
  // se toca la descripción al guardar.
  useEffect(() => {
    if (!editando || !ctx.name) return;
    let vivo = true;
    api
      .getEventDescription(ctx.name)
      .then((d) => {
        if (vivo) {
          const v = d?.description ?? "";
          notasOriginales.current = v;
          setNotas(v);
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [editando, ctx.name]);

  // Escape cierra sin guardar y devuelve el foco (lo hace el shell con returnFocus).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const min = useMemo(() => parseHora(inicio), [inicio]);
  const minEfectivo = min ?? ctx.startMin;
  const rango = `${fmtMin(minEfectivo)} – ${fmtMin(minEfectivo + dur)}`;
  const encabezado = editando
    ? `Editar · ${titulo || ctx.subject || "Reunión"} · ${dayShort(ctx.day)}, ${rango}`
    : `Nueva reunión · ${dayShort(ctx.day)}, ${rango}`;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    const t = titulo.trim() || "Reunión sin título";
    const minVal = parseHora(inicio);
    if (minVal === null) {
      setError("Poné una hora válida, por ejemplo 09:30.");
      return;
    }
    if (minVal + dur > 24 * 60) {
      setError("La reunión no puede terminar después de las 23:59.");
      return;
    }
    setError(null);
    const inicioDT = `${ymd(ctx.day)} ${fmtMin(minVal)}:00`;
    const finDT = `${ymd(ctx.day)} ${fmtMin(minVal + dur)}:00`;
    setGuardando(true);
    try {
      if (editando && ctx.name) {
        await api.updateMeeting(ctx.name, inicioDT, finDT);
        const campos: { subject?: string; description?: string } = {};
        if (t !== ctx.subject) campos.subject = t;
        if (notas !== notasOriginales.current) campos.description = notas;
        if (Object.keys(campos).length) await api.setEventFields(ctx.name, campos);
        onSaved({
          name: ctx.name,
          announcement: `Actualizada ${t}, ${dayLong(ctx.day)} de ${fmtMin(minVal)} a ${fmtMin(
            minVal + dur,
          )}`,
        });
      } else {
        const r = await api.createEvent(t, inicioDT, finDT);
        if (notas.trim()) await api.setEventFields(r.name, { description: notas.trim() });
        onSaved({
          name: r.name,
          announcement: `Creada ${t}, ${dayLong(ctx.day)} de ${fmtMin(minVal)} a ${fmtMin(
            minVal + dur,
          )}`,
        });
      }
    } catch {
      setGuardando(false);
      setError("No se pudo guardar. Probá de nuevo.");
    }
  }

  return (
    <aside
      className="agx-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="agx-panel-titulo"
    >
      <h2 className="agx-panel-title" id="agx-panel-titulo">
        {encabezado}
      </h2>
      <form className="agx-panel-form" onSubmit={guardar} noValidate>
        <label htmlFor="agx-p-titulo">Título</label>
        <input
          id="agx-p-titulo"
          ref={tituloRef}
          autoComplete="off"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />

        <label htmlFor="agx-p-inicio">Hora de inicio</label>
        <p className="agx-panel-hint" id={HINT_ID}>
          Formato 24 h, por ejemplo 09:30
        </p>
        <input
          id="agx-p-inicio"
          inputMode="numeric"
          value={inicio}
          aria-describedby={HINT_ID}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setInicio(e.target.value)}
        />

        <fieldset className="agx-panel-dur">
          <legend>Duración</legend>
          {DURACIONES.map((d) => (
            <button
              key={d}
              type="button"
              className={d === dur ? "on" : ""}
              aria-pressed={d === dur}
              onClick={() => setDur(d)}
            >
              {d} min
            </button>
          ))}
        </fieldset>

        <label htmlFor="agx-p-notas">Notas</label>
        <textarea
          id="agx-p-notas"
          rows={3}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />

        {error ? (
          <p className="agx-panel-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="agx-panel-acciones">
          <button type="submit" className="agx-panel-save" disabled={guardando}>
            Guardar
          </button>
          <button type="button" className="agx-panel-cancel" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
        </div>
      </form>
    </aside>
  );
}
