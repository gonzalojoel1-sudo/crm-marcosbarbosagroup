import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type BillingType, type DealDetail, type DealInput, type IvaMode, type QuoteDTO } from "./api";
import PdfViewer from "./PdfViewer";
import { stageLabel } from "./labels";
import { IconPlus, IconReceipt, IconTarget, IconTrash, IconX } from "./icons";

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

const BILLING_TYPES: BillingType[] = ["Único", "Mensual", "Trimestral", "Anual"];
const IVA_MODES: IvaMode[] = ["sumar", "incluido", "exento"];

type Row = { description: string; billing_type: BillingType; qty: string; rate: string; discount: string };
type Tab = "detalle" | "presupuesto";

const EMPTY_ROW: Row = { description: "", billing_type: "Único", qty: "1", rate: "", discount: "" };

const money = (v: number) =>
  "$" + v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string) => {
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
};

export default function DealDrawer({
  name,
  organization,
  onClose,
}: {
  name?: string;
  organization?: string;
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
  const [verticals, setVerticals] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(name));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [ivaMode, setIvaMode] = useState<IvaMode>("sumar");
  const [viewer, setViewer] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const saving = busy !== null;

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
    api
      .getVerticals()
      .then((list) => setVerticals(list.map((v) => v.nombre || v.name)))
      .catch(() => setVerticals([]));
  }, []);

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
    api
      .getQuoteVertical(name)
      .then((v) => {
        if (alive) setVertical(v ?? "");
      })
      .catch(() => {});
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
        })),
      );
      setIvaMode(q.iva_mode);
    } else {
      setRows([{ ...EMPTY_ROW }]);
    }
  }

  async function reload() {
    if (!dealName) return;
    const d: DealDetail = await api.getDeal(dealName);
    applyQuote(d.quote);
  }

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (i: number, k: keyof Row, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const addRow = () => setRows((r) => [...r, { ...EMPTY_ROW }]);
  const delRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const rowNet = (r: Row) => num(r.qty) * num(r.rate) * (1 - num(r.discount) / 100);
  const filledRows = rows.filter((r) => r.description.trim());
  const canSaveDetalle = Boolean(dealName) || Boolean(title.trim());

  const quoteItems = () =>
    filledRows.map((r) => ({
      description: r.description.trim(),
      billing_type: r.billing_type,
      qty: num(r.qty),
      rate: num(r.rate),
      discount_percentage: num(r.discount),
    }));

  const persistQuote = () =>
    api.saveQuote(dealName as string, quoteItems(), { ivaMode, vertical: vertical || undefined });

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

  function startReject() {
    setRejecting(true);
    setRejectReason("");
    setError(null);
  }

  function cancelReject() {
    setRejecting(false);
    setRejectReason("");
    setError(null);
  }

  async function rejectIt() {
    if (!quote || saving) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setError("Escribí el motivo del rechazo.");
      return;
    }
    setBusy("reject");
    setError(null);
    try {
      await api.rejectQuote(quote.name, reason);
      setRejecting(false);
      setRejectReason("");
      await reload();
      setFlash("Presupuesto rechazado.");
    } catch (e) {
      setError(String(e));
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

  const isEditable = quote ? quote.is_editable : true;
  const status = quote?.status ?? "Borrador";
  const verticalOptions =
    vertical && !verticals.includes(vertical) ? [vertical, ...verticals] : verticals;

  function quoteActions() {
    if (status === "Borrador") {
      const noItems = filledRows.length === 0;
      return (
        <>
          <button className="ghost" onClick={viewQuote} disabled={saving || loading || noItems}>
            <IconReceipt width={15} height={15} /> {busy === "view" ? "Generando…" : "Ver presupuesto"}
          </button>
          <button className="ghost" onClick={sendIt} disabled={saving || loading || noItems}>
            {busy === "send" ? "Enviando…" : "Enviar"}
          </button>
          <button className="btn-primary" onClick={saveDraft} disabled={saving || loading || noItems}>
            {busy === "quote" ? "Guardando…" : "Guardar presupuesto"}
          </button>
        </>
      );
    }
    if (status === "Enviado") {
      return (
        <>
          <button className="ghost" onClick={viewQuote} disabled={saving || loading}>
            <IconReceipt width={15} height={15} /> Ver presupuesto
          </button>
          <button className="ghost danger" onClick={startReject} disabled={saving || loading}>
            Rechazar
          </button>
          <button className="btn-primary" onClick={acceptIt} disabled={saving || loading}>
            {busy === "accept" ? "Aceptando…" : "Aceptar"}
          </button>
        </>
      );
    }
    return (
      <>
        <button className="ghost" onClick={viewQuote} disabled={saving || loading}>
          <IconReceipt width={15} height={15} /> Ver presupuesto
        </button>
        <button className="btn-primary" onClick={makeVersion} disabled={saving || loading}>
          {busy === "version" ? "Creando…" : "Crear versión nueva"}
        </button>
      </>
    );
  }

  const primary = () => {
    if (tab === "detalle")
      return (
        <button
          className="btn-primary"
          onClick={saveDetalle}
          disabled={!canSaveDetalle || saving || loading}
        >
          {busy === "detalle" ? "Guardando…" : dealName ? "Guardar" : "Crear negocio"}
        </button>
      );
    return quoteActions();
  };

  const totals = quote?.totals;

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
          <div className="drawer-loading">Cargando…</div>
        ) : tab === "detalle" ? (
          <div className="drawer-body">
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
              <label className="field">
                <span>Vertical</span>
                <select
                  value={vertical}
                  onChange={(e) => setVertical(e.target.value)}
                  disabled={saving}
                >
                  <option value="">Sin asignar</option>
                  {verticalOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {error ? <p className="error">{error}</p> : null}
            </div>
          </div>
        ) : !dealName ? (
          <div className="drawer-body">
            <div className="empty soft">
              <IconReceipt className="empty-ico" />
              <p>Guardá los datos del negocio para armar el presupuesto.</p>
              <button className="btn-primary" onClick={saveDetalle} disabled={!canSaveDetalle || saving}>
                {busy === "detalle" ? "Guardando…" : "Guardar y continuar"}
              </button>
            </div>
            {error ? <p className="error">{error}</p> : null}
          </div>
        ) : (
          <div className="drawer-body">
            {flash ? <p className="flash">{flash}</p> : null}
            {quote && !isEditable ? (
              <div className="quote-frozen">
                Este presupuesto está {quote.status.toLowerCase()} y quedó congelado. Para cambiarlo,
                creá una versión nueva.
              </div>
            ) : null}
            <div className="quote">
              <div className="quote-state">
                <span className="quote-state-txt">
                  {quote ? `Presupuesto v${quote.version}` : "Presupuesto nuevo"}
                </span>
                <span className={`pill st-${status.toLowerCase()}`}>{status}</span>
                {quote ? <span className="quote-no">{quote.name}</span> : null}
              </div>
              <div className="quote-grid">
                <div className="quote-head">
                  <span>Descripción</span>
                  <span>Cobro</span>
                  <span>Cant.</span>
                  <span>Precio</span>
                  <span>Desc. %</span>
                  <span>Importe</span>
                  <span />
                </div>
                {rows.map((r, i) => (
                  <div className="quote-row" key={i}>
                    <input
                      value={r.description}
                      onChange={(e) => setRow(i, "description", e.target.value)}
                      placeholder="Servicio o producto"
                      disabled={!isEditable}
                    />
                    <select
                      value={r.billing_type}
                      onChange={(e) => setRow(i, "billing_type", e.target.value)}
                      disabled={!isEditable}
                      aria-label="Tipo de cobro"
                    >
                      {BILLING_TYPES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <input
                      value={r.qty}
                      onChange={(e) => setRow(i, "qty", e.target.value)}
                      inputMode="decimal"
                      disabled={!isEditable}
                    />
                    <input
                      value={r.rate}
                      onChange={(e) => setRow(i, "rate", e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      disabled={!isEditable}
                    />
                    <input
                      value={r.discount}
                      onChange={(e) => setRow(i, "discount", e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      disabled={!isEditable}
                    />
                    <span className="quote-amt">{money(rowNet(r))}</span>
                    <button
                      className="icon-btn danger"
                      onClick={() => delRow(i)}
                      aria-label="Quitar ítem"
                      disabled={!isEditable}
                    >
                      <IconTrash width={14} height={14} />
                    </button>
                  </div>
                ))}
              </div>
              {isEditable && filledRows.length === 0 ? (
                <p className="quote-hint">
                  Un presupuesto sin ítems es un borrador: agregá el primero para empezar.
                </p>
              ) : null}
              {isEditable ? (
                <button className="quote-add" onClick={addRow}>
                  <IconPlus width={15} height={15} /> Agregar ítem
                </button>
              ) : null}
              <div className="quote-iva">
                <span className="quote-iva-lbl">IVA</span>
                <div className="seg">
                  {IVA_MODES.map((m) => (
                    <button
                      key={m}
                      className={ivaMode === m ? "on" : ""}
                      onClick={() => setIvaMode(m)}
                      disabled={!isEditable}
                    >
                      {m === "sumar" ? "Sumar 21%" : m === "incluido" ? "Incluido" : "Exento"}
                    </button>
                  ))}
                </div>
              </div>
              {quote && totals ? (
                <div className="quote-sum">
                  {totals.recurring_net > 0 ? (
                    <div className="qs-block rec">
                      <div className="qs-row">
                        <span>Abono mensual (neto)</span>
                        <span>{money(totals.recurring_net)}</span>
                      </div>
                      {quote.iva_mode !== "exento" ? (
                        <div className="qs-row">
                          <span>IVA 21%{quote.iva_mode === "incluido" ? " (incluido)" : ""}</span>
                          <span>{money(totals.recurring_iva)}</span>
                        </div>
                      ) : null}
                      <div className="qs-total">
                        <span>Abono mensual</span>
                        <strong>{money(totals.recurring_gross)}</strong>
                      </div>
                      {quote.recurring_summary ? (
                        <div className="qs-sub">{quote.recurring_summary}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {totals.one_time_net > 0 ? (
                    <div className="qs-block once">
                      <div className="qs-row">
                        <span>Inversión inicial (neto)</span>
                        <span>{money(totals.one_time_net)}</span>
                      </div>
                      {quote.iva_mode !== "exento" ? (
                        <div className="qs-row">
                          <span>IVA 21%{quote.iva_mode === "incluido" ? " (incluido)" : ""}</span>
                          <span>{money(totals.one_time_iva)}</span>
                        </div>
                      ) : null}
                      <div className="qs-total">
                        <span>Inversión inicial</span>
                        <strong>{money(totals.one_time_gross)}</strong>
                      </div>
                    </div>
                  ) : null}
                  {totals.discount > 0 ? (
                    <div className="qs-sub">Descuentos aplicados: {money(totals.discount)}</div>
                  ) : null}
                </div>
              ) : (
                <p className="quote-hint">Los totales se calculan al guardar el presupuesto.</p>
              )}
              {error ? <p className="error">{error}</p> : null}
            </div>
          </div>
        )}

        <footer className="drawer-foot">
          {rejecting ? (
            <>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motivo del rechazo"
                aria-label="Motivo del rechazo"
                autoFocus
              />
              <div className="foot-actions">
                <button className="ghost" onClick={cancelReject} disabled={saving}>
                  Cancelar
                </button>
                <button
                  className="btn-danger"
                  onClick={rejectIt}
                  disabled={saving || !rejectReason.trim()}
                >
                  {busy === "reject" ? "Rechazando…" : "Confirmar rechazo"}
                </button>
              </div>
            </>
          ) : (
            <div className="foot-actions">
              <button className="ghost" onClick={onClose}>
                {tab === "presupuesto" ? "Cerrar" : "Cancelar"}
              </button>
              {primary()}
            </div>
          )}
        </footer>
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
