import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { DOW_SHORT, capitalize, dayLong, dayShort, fmtMin, sameDay, weekdayIndex, ymd } from "./date";
import { CATEGORIES, CATEGORY_ORDER } from "./categories";
import styles from "./EventPanel.module.css";

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
  // Categoría actual al editar; en creación arranca en "Consultora" (el default
  // del prototipo, `index.html:969`).
  category?: string;
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
  days: Date[];
  onClose: () => void;
  onSaved: (s: SavedInfo) => void;
}

export default function EventPanel({ ctx, days, onClose, onSaved }: EventPanelProps) {
  const editando = ctx.mode === "editar";
  const [titulo, setTitulo] = useState(ctx.subject ?? "");
  const [categoria, setCategoria] = useState(ctx.category ?? CATEGORY_ORDER[0]);
  const [dia, setDia] = useState(() => {
    const i = days.findIndex((d) => sameDay(d, ctx.day));
    return i >= 0 ? i : 0;
  });
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
  // El Día elegido manda: el encabezado, el guardado y el anuncio lo usan.
  const day = days[dia] ?? ctx.day;
  const encabezado = editando
    ? `Editar · ${titulo || ctx.subject || "Reunión"} · ${dayShort(day)}, ${rango}`
    : `Nueva reunión · ${dayShort(day)}, ${rango}`;

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
    const inicioDT = `${ymd(day)} ${fmtMin(minVal)}:00`;
    const finDT = `${ymd(day)} ${fmtMin(minVal + dur)}:00`;
    setGuardando(true);
    try {
      if (editando && ctx.name) {
        // La categoría viaja en `update_meeting`; `_categoria` la valida en el
        // backend (fuera de la lista = error, no una corrección silenciosa).
        await api.updateMeeting(ctx.name, inicioDT, finDT, categoria);
        const campos: { subject?: string; description?: string } = {};
        if (t !== ctx.subject) campos.subject = t;
        if (notas !== notasOriginales.current) campos.description = notas;
        if (Object.keys(campos).length) await api.setEventFields(ctx.name, campos);
        onSaved({
          name: ctx.name,
          announcement: `Actualizada ${t}, ${dayLong(day)} de ${fmtMin(minVal)} a ${fmtMin(
            minVal + dur,
          )}`,
        });
      } else {
        const r = await api.createEvent(t, inicioDT, finDT, categoria);
        if (notas.trim()) await api.setEventFields(r.name, { description: notas.trim() });
        onSaved({
          name: r.name,
          announcement: `Creada ${t}, ${dayLong(day)} de ${fmtMin(minVal)} a ${fmtMin(
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
      className={styles.agxPanel}
      role="dialog"
      aria-modal="false"
      aria-labelledby="agx-panel-titulo"
    >
      <h2 className={styles.agxPanelTitle} id="agx-panel-titulo">
        {encabezado}
      </h2>
      <form className={styles.agxPanelForm} onSubmit={guardar} noValidate>
        <label htmlFor="agx-p-titulo">Título</label>
        <input
          id="agx-p-titulo"
          ref={tituloRef}
          autoComplete="off"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />

        <label htmlFor="agx-p-cat">Agenda</label>
        <select
          id="agx-p-cat"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          {CATEGORY_ORDER.map((k) => (
            <option key={k} value={k}>
              {CATEGORIES[k].label}
            </option>
          ))}
        </select>

        <label htmlFor="agx-p-dia">Día</label>
        <select id="agx-p-dia" value={dia} onChange={(e) => setDia(Number(e.target.value))}>
          {days.map((d, i) => (
            <option key={ymd(d)} value={i}>
              {`${capitalize(DOW_SHORT[weekdayIndex(d)])} ${d.getDate()}`}
            </option>
          ))}
        </select>

        <label htmlFor="agx-p-inicio">Hora de inicio</label>
        <p className={styles.agxPanelHint} id={HINT_ID}>
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

        <fieldset className={styles.agxPanelDur}>
          <legend>Duración</legend>
          {DURACIONES.map((d) => (
            <button
              key={d}
              type="button"
              className={d === dur ? styles.on : ""}
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
          <p className={styles.agxPanelError} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.agxPanelAcciones}>
          <button type="submit" className={styles.agxPanelSave} disabled={guardando}>
            Guardar
          </button>
          <button type="button" className={styles.agxPanelCancel} onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
        </div>
      </form>
    </aside>
  );
}
