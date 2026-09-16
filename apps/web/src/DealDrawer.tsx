import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type DealDetail, type DealInput, type IvaMode, type QuoteDTO } from "./api";
import PdfViewer from "./PdfViewer";
import QuotePanel, { EMPTY_ROW, itemsFromRows, type EditableKey, type Row } from "./QuotePanel";
import { stageLabel } from "./labels";
import { IconReceipt, IconTarget, IconX } from "./icons";

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

type Tab = "detalle" | "presupuesto";

export default function DealDrawer({
  name,
  organization,
  verticals,
  onClose,
}: {
  name?: string;
  organization?: string;
  verticals: string[];
  onClose: () => void;
}) {
  const [dealName, setDealName] = useState<string | undefined>(name);
  const [tab, setTab] = useState<Tab>("detalle");
  const [title, setTitle] = useState(organization ?? "");
  const [form, setForm] = useState({
    contact: "",
    value: "",
    date: "",
    next_step: "",
    probability: "",
    status: "Qualification",
  });
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [vertical, setVertical] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(name));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [ivaMode, setIvaMode] = useState<IvaMode>("sumar");
  const [viewer, setViewer] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const saving = busy !== null;
  const isEditable = quote ? quote.is_editable : true;

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    if (viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, viewer]);

  useEffect(() => {
    if (!name) return;
    let alive = true;
    api
      .getDeal(name)
      .then((d) => {
        if (!alive) return;
        setTitle(d.title);
        setForm({
          contact: d.contact,
          value: d.value != null ? String(d.value) : "",
          date: d.date,
          next_step: d.next_step,
          probability: d.probability != null ? String(d.probability) : "",
          status: d.status || "Qualification",
        });
        applyQuote(d.quote);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [name]);

  function applyQuote(q: QuoteDTO | null) {
    setQuote(q);
    if (q) {
      setRows(
        q.items.map((i) => ({
          description: i.description,
          billing_type: i.billing_type,
          qty: String(i.qty),
          rate: String(i.rate),
          discount: i.discount_percentage ? String(i.discount_percentage) : "",
          net_amount: i.net_amount,
        })),
      );
      setIvaMode(q.iva_mode);
      setVertical(q.vertical || "");
    } else {
      setRows([{ ...EMPTY_ROW }]);
      setVertical("");
    }
  }

  async function reload() {
    if (!dealName) return;
    const d: DealDetail = await api.getDeal(dealName);
    applyQuote(d.quote);
  }

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (i: number, k: EditableKey, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const addRow = () => setRows((r) => [...r, { ...EMPTY_ROW }]);
  const delRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const filledRows = rows.filter((r) => r.description.trim());
  const canSaveDetalle = Boolean(dealName) || Boolean(title.trim());

  const persistQuote = () =>
    api.saveQuote(dealName as string, itemsFromRows(filledRows), { ivaMode, vertical });

  async function saveDetalle() {
    if (!canSaveDetalle || saving) return;
    setBusy("detalle");
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
      if (dealName) {
        await api.updateDeal(dealName, fields);
        onClose();
      } else {
        const r = await api.createDeal({ title: title.trim(), ...fields });
        setDealName(r.name);
        setTab("presupuesto");
        setFlash("Negocio creado. Ahora armá el presupuesto.");
        setBusy(null);
      }
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!dealName || saving) return;
    if (filledRows.length === 0) {
      setError("Agregá al menos un ítem para guardar el presupuesto.");
      return;
    }
    setBusy("quote");
    setError(null);
    try {
      await persistQuote();
      await reload();
      setFlash("Presupuesto guardado.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function viewQuote() {
    if (!dealName || saving) return;
    setError(null);
    if (!isEditable) {
      setViewer(true);
      return;
    }
    if (filledRows.length === 0) {
      setError("Agregá al menos un ítem para ver el presupuesto.");
      return;
    }
    setBusy("view");
    try {
      await persistQuote();
      await reload();
      setViewer(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendIt() {
    if (!dealName || saving) return;
    if (filledRows.length === 0) {
      setError("Agregá al menos un ítem antes de enviar.");
      return;
    }
    setBusy("send");
    setError(null);
    try {
      const target = isEditable ? (await persistQuote()).name : quote?.name;
      if (!target) throw new Error("El negocio no tiene un presupuesto cargado.");
      await api.sendQuote(target);
      await reload();
      setFlash("Presupuesto enviado.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function acceptIt() {
    if (!quote || saving) return;
    setBusy("accept");
    setError(null);
    try {
      await api.acceptQuote(quote.name);
      await reload();
      setFlash("Presupuesto aceptado.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function rejectIt(reason: string): Promise<boolean> {
    if (!quote || saving) return false;
    setBusy("reject");
    setError(null);
    try {
      await api.rejectQuote(quote.name, reason);
      await reload();
      setFlash("Presupuesto rechazado.");
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function makeVersion() {
    if (!dealName || saving) return;
    setBusy("version");
    setError(null);
    try {
      await api.newQuoteVersion(dealName);
      await reload();
      setFlash("Versión nueva en borrador. Ya podés editarla.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  // El pie vive fuera del cuerpo: se ve incluso mientras carga (acción deshabilitada).
  const drawerFooter = (
    <footer className="drawer-foot">
      <div className="foot-actions">
        <button className="ghost" onClick={onClose}>
          {tab === "presupuesto" ? "Cerrar" : "Cancelar"}
        </button>
        <button
          className="btn-primary"
          onClick={saveDetalle}
          disabled={!canSaveDetalle || saving || loading}
        >
          {busy === "detalle" ? "Guardando…" : dealName ? "Guardar" : "Crear negocio"}
        </button>
      </div>
    </footer>
  );

  const detalleForm = (
    <div className="form">
      {!dealName ? (
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
        <span>
          <IconTarget width={14} height={14} className="lbl-ico" /> Próxima acción
        </span>
        <input
          value={form.next_step}
          onChange={(e) => set("next_step", e.target.value)}
          placeholder="Enviar presupuesto"
        />
      </label>
      <div className="row2">
        <label className="field">
          <span>Etapa</span>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
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
  );

  const emptySoft = (
    <>
      <div className="empty soft">
        <IconReceipt className="empty-ico" />
        <p>Guardá los datos del negocio para armar el presupuesto.</p>
        <button className="btn-primary" onClick={saveDetalle} disabled={!canSaveDetalle || saving}>
          {busy === "detalle" ? "Guardando…" : "Guardar y continuar"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </>
  );

  return (
    <>
      {createPortal(
        <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Negocio">
        <header className="drawer-head">
          <div className="dh-row">
            <span className="eyebrow">Negocio</span>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <IconX />
            </button>
          </div>
          <h2>{dealName ? title : "Nuevo negocio"}</h2>
          <div className="tabs-inline" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "detalle"}
              className={tab === "detalle" ? "on" : ""}
              onClick={() => setTab("detalle")}
            >
              Detalle
            </button>
            <button
              role="tab"
              aria-selected={tab === "presupuesto"}
              className={tab === "presupuesto" ? "on" : ""}
              onClick={() => setTab("presupuesto")}
            >
              <IconReceipt width={15} height={15} /> Presupuesto
            </button>
          </div>
        </header>

        {loading ? (
          <>
            <div className="drawer-loading">Cargando…</div>
            {drawerFooter}
          </>
        ) : tab === "detalle" || !dealName ? (
          <>
            <div className="drawer-body">{tab === "detalle" ? detalleForm : emptySoft}</div>
            {drawerFooter}
          </>
        ) : (
          <QuotePanel
            quote={quote}
            rows={rows}
            editable={isEditable}
            ivaMode={ivaMode}
            vertical={vertical}
            verticals={verticals}
            busy={busy}
            loading={loading}
            error={error}
            flash={flash}
            onRowChange={setRow}
            onAddRow={addRow}
            onDelRow={delRow}
            onIvaChange={setIvaMode}
            onVerticalChange={setVertical}
            onClearError={() => setError(null)}
            onView={viewQuote}
            onSave={saveDraft}
            onSend={sendIt}
            onAccept={acceptIt}
            onReject={rejectIt}
            onNewVersion={makeVersion}
            onClose={onClose}
          />
        )}
      </aside>
        </div>,
        document.body,
      )}

      {viewer && quote ? (
        <PdfViewer
          quoteName={quote.name}
          title={title || dealName || ""}
          onClose={() => setViewer(false)}
        />
      ) : null}
    </>
  );
}
