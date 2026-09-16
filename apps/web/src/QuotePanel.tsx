import { useState } from "react";
import { type BillingType, type IvaMode, type QuoteDTO } from "./api";
import { IconPlus, IconReceipt, IconTrash } from "./icons";

const BILLING_TYPES: BillingType[] = ["Único", "Mensual", "Trimestral", "Anual"];
const IVA_MODES: IvaMode[] = ["sumar", "incluido", "exento"];

export type Row = {
  description: string;
  billing_type: BillingType;
  qty: string;
  rate: string;
  discount: string;
  // Sólo cuando el presupuesto está congelado: el importe que devolvió el servidor.
  net_amount?: number;
};
export type EditableKey = "description" | "billing_type" | "qty" | "rate" | "discount";

export const EMPTY_ROW: Row = { description: "", billing_type: "Único", qty: "1", rate: "", discount: "" };

const money = (v: number) =>
  "$" + v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v: string) => {
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
};

const rowNet = (r: Row) => num(r.qty) * num(r.rate) * (1 - num(r.discount) / 100);

export function itemsFromRows(rows: Row[]) {
  return rows
    .filter((r) => r.description.trim())
    .map((r) => ({
      description: r.description.trim(),
      billing_type: r.billing_type,
      qty: num(r.qty),
      rate: num(r.rate),
      discount_percentage: num(r.discount),
    }));
}

export interface QuotePanelProps {
  quote: QuoteDTO | null;
  rows: Row[];
  editable: boolean;
  ivaMode: IvaMode;
  vertical: string;
  verticals: string[];
  busy: string | null;
  loading: boolean;
  error: string | null;
  flash: string | null;
  onRowChange: (i: number, k: EditableKey, v: string) => void;
  onAddRow: () => void;
  onDelRow: (i: number) => void;
  onIvaChange: (m: IvaMode) => void;
  onVerticalChange: (v: string) => void;
  onClearError: () => void;
  onView: () => void;
  onSave: () => void;
  onSend: () => void;
  onAccept: () => void;
  onReject: (reason: string) => Promise<boolean>;
  onNewVersion: () => void;
  onClose: () => void;
}

export default function QuotePanel({
  quote,
  rows,
  editable,
  ivaMode,
  vertical,
  verticals,
  busy,
  loading,
  error,
  flash,
  onRowChange,
  onAddRow,
  onDelRow,
  onIvaChange,
  onVerticalChange,
  onClearError,
  onView,
  onSave,
  onSend,
  onAccept,
  onReject,
  onNewVersion,
  onClose,
}: QuotePanelProps) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const saving = busy !== null;
  const status = quote?.status ?? "Borrador";
  const totals = quote?.totals;
  const hasItems = rows.some((r) => r.description.trim());
  const verticalOptions =
    vertical && !verticals.includes(vertical) ? [vertical, ...verticals] : verticals;

  function startReject() {
    setRejecting(true);
    setRejectReason("");
    onClearError();
  }

  function cancelReject() {
    setRejecting(false);
    setRejectReason("");
    onClearError();
  }

  async function confirmReject() {
    const reason = rejectReason.trim();
    if (!reason || saving) return;
    const ok = await onReject(reason);
    if (ok) {
      setRejecting(false);
      setRejectReason("");
    }
  }

  function actions() {
    if (status === "Borrador") {
      const noItems = !hasItems;
      return (
        <>
          <button className="ghost" onClick={onView} disabled={saving || loading || noItems}>
            <IconReceipt width={15} height={15} /> {busy === "view" ? "Generando…" : "Ver presupuesto"}
          </button>
          <button className="ghost" onClick={onSend} disabled={saving || loading || noItems}>
            {busy === "send" ? "Enviando…" : "Enviar"}
          </button>
          <button className="btn-primary" onClick={onSave} disabled={saving || loading || noItems}>
            {busy === "quote" ? "Guardando…" : "Guardar presupuesto"}
          </button>
        </>
      );
    }
    if (status === "Enviado") {
      return (
        <>
          <button className="ghost" onClick={onView} disabled={saving || loading}>
            <IconReceipt width={15} height={15} /> Ver presupuesto
          </button>
          <button className="ghost danger" onClick={startReject} disabled={saving || loading}>
            Rechazar
          </button>
          <button className="btn-primary" onClick={onAccept} disabled={saving || loading}>
            {busy === "accept" ? "Aceptando…" : "Aceptar"}
          </button>
        </>
      );
    }
    return (
      <>
        <button className="ghost" onClick={onView} disabled={saving || loading}>
          <IconReceipt width={15} height={15} /> Ver presupuesto
        </button>
        <button className="btn-primary" onClick={onNewVersion} disabled={saving || loading}>
          {busy === "version" ? "Creando…" : "Crear versión nueva"}
        </button>
      </>
    );
  }

  return (
    <>
      <div className="drawer-body">
        {flash ? <p className="flash">{flash}</p> : null}
        {quote && !editable ? (
          <div className="quote-frozen">
            Este presupuesto está {quote.status.toLowerCase()} y quedó congelado. Para cambiarlo, creá
            una versión nueva.
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
                  onChange={(e) => onRowChange(i, "description", e.target.value)}
                  placeholder="Servicio o producto"
                  disabled={!editable}
                />
                <select
                  value={r.billing_type}
                  onChange={(e) => onRowChange(i, "billing_type", e.target.value)}
                  disabled={!editable}
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
                  onChange={(e) => onRowChange(i, "qty", e.target.value)}
                  inputMode="decimal"
                  disabled={!editable}
                />
                <input
                  value={r.rate}
                  onChange={(e) => onRowChange(i, "rate", e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  disabled={!editable}
                />
                <input
                  value={r.discount}
                  onChange={(e) => onRowChange(i, "discount", e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  disabled={!editable}
                />
                <span className="quote-amt">
                  {money(editable ? rowNet(r) : (r.net_amount ?? rowNet(r)))}
                </span>
                <button
                  className="icon-btn danger"
                  onClick={() => onDelRow(i)}
                  aria-label="Quitar ítem"
                  disabled={!editable}
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
            ))}
          </div>
          {editable && !hasItems ? (
            <p className="quote-hint">
              Un presupuesto sin ítems es un borrador: agregá el primero para empezar.
            </p>
          ) : null}
          {editable ? (
            <button className="quote-add" onClick={onAddRow}>
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
                  onClick={() => onIvaChange(m)}
                  disabled={!editable}
                >
                  {m === "sumar" ? "Sumar 21%" : m === "incluido" ? "Incluido" : "Exento"}
                </button>
              ))}
            </div>
            <span className="quote-iva-lbl quote-vert-lbl">Vertical</span>
            <select
              className="quote-vert"
              value={vertical}
              onChange={(e) => onVerticalChange(e.target.value)}
              disabled={!editable}
              aria-label="Vertical"
            >
              <option value="">Sin asignar</option>
              {verticalOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
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
                <div className="quote-discount">
                  Descuentos aplicados (sobre ambos totales): {money(totals.discount)}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="quote-hint">Los totales se calculan al guardar el presupuesto.</p>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>

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
              <button className="btn-danger" onClick={confirmReject} disabled={saving || !rejectReason.trim()}>
                {busy === "reject" ? "Rechazando…" : "Confirmar rechazo"}
              </button>
            </div>
          </>
        ) : (
          <div className="foot-actions">
            <button className="ghost" onClick={onClose}>
              Cerrar
            </button>
            {actions()}
          </div>
        )}
      </footer>
    </>
  );
}
