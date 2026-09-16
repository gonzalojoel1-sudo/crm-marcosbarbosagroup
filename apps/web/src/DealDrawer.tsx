import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DealInput } from "./api";
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

type Row = { description: string; qty: string; rate: string; discount: string };
type Tab = "detalle" | "presupuesto";

const EMPTY_ROW: Row = { description: "", qty: "1", rate: "", discount: "" };

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
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(name));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [ivaMode, setIvaMode] = useState<"sumar" | "incluido" | "exento">("sumar");
  const [viewer, setViewer] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

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
      setRows(
        d.items.map((i) => ({
          description: i.description,
          qty: String(i.qty),
          rate: String(i.rate),
          discount: i.discount_percentage ? String(i.discount_percentage) : "",
        })),
      );
      setLoading(false);
    });
  }, [name]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (i: number, k: keyof Row, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const addRow = () => setRows((r) => [...r, { ...EMPTY_ROW }]);
  const delRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const rowNet = (r: Row) => num(r.qty) * num(r.rate) * (1 - num(r.discount) / 100);
  const total = useMemo(() => rows.reduce((a, r) => a + rowNet(r), 0), [rows]);
  const filledRows = rows.filter((r) => r.description.trim());
  const canSaveDetalle = Boolean(dealName) || Boolean(title.trim());

  const iva = ivaMode === "exento" ? 0 : ivaMode === "incluido" ? total - total / 1.21 : total * 0.21;
  const grand = ivaMode === "incluido" ? total : total + iva;

  const quoteItems = () =>
    filledRows.map((r) => ({
      description: r.description.trim(),
      qty: num(r.qty),
      rate: num(r.rate),
      discount_percentage: num(r.discount),
      amount: 0,
      net_amount: 0,
    }));

  async function saveDetalle() {
    if (!canSaveDetalle || saving) return;
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
      if (dealName) {
        await api.updateDeal(dealName, fields);
        onClose();
      } else {
        const r = await api.createDeal({ title: title.trim(), ...fields });
        setDealName(r.name);
        setTab("presupuesto");
        setFlash("Negocio creado. Ahora armá el presupuesto.");
        setSaving(false);
      }
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  async function saveQuote() {
    if (!dealName || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveQuote(dealName, quoteItems());
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  const primary = () => {
    if (tab === "detalle")
      return (
        <button
          className="btn-primary"
          onClick={saveDetalle}
          disabled={!canSaveDetalle || saving || loading}
        >
          {saving ? "Guardando…" : dealName ? "Guardar" : "Crear negocio"}
        </button>
      );
    return (
      <>
        <button
          className="ghost"
          onClick={async () => {
            if (!dealName || saving) return;
            if (filledRows.length === 0) {
              setError("Agregá al menos un ítem para ver el presupuesto.");
              return;
            }
            setSaving(true);
            setError(null);
            try {
              await api.saveQuote(dealName, quoteItems());
              setViewer(true);
            } catch (e) {
              setError(String(e));
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || loading || filledRows.length === 0}
        >
          <IconReceipt width={15} height={15} /> Ver presupuesto
        </button>
        <button className="btn-primary" onClick={saveQuote} disabled={saving || loading}>
          {saving ? "Guardando…" : "Guardar presupuesto"}
        </button>
      </>
    );
  };

  return (
    <>
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
              {error ? <p className="error">{error}</p> : null}
            </div>
          </div>
        ) : !dealName ? (
          <div className="drawer-body">
            <div className="empty soft">
              <IconReceipt className="empty-ico" />
              <p>Guardá los datos del negocio para armar el presupuesto.</p>
              <button className="btn-primary" onClick={saveDetalle} disabled={!canSaveDetalle || saving}>
                {saving ? "Guardando…" : "Guardar y continuar"}
              </button>
            </div>
            {error ? <p className="error">{error}</p> : null}
          </div>
        ) : (
          <div className="drawer-body">
            {flash ? <p className="flash">{flash}</p> : null}
            <div className="quote">
              <div className="quote-head">
                <span>Descripción</span>
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
                  />
                  <input
                    value={r.qty}
                    onChange={(e) => setRow(i, "qty", e.target.value)}
                    inputMode="decimal"
                  />
                  <input
                    value={r.rate}
                    onChange={(e) => setRow(i, "rate", e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                  />
                  <input
                    value={r.discount}
                    onChange={(e) => setRow(i, "discount", e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                  />
                  <span className="quote-amt">{money(rowNet(r))}</span>
                  <button className="icon-btn danger" onClick={() => delRow(i)} aria-label="Quitar ítem">
                    <IconTrash width={14} height={14} />
                  </button>
                </div>
              ))}
              <button className="quote-add" onClick={addRow}>
                <IconPlus width={15} height={15} /> Agregar ítem
              </button>
              <div className="quote-iva">
                <span className="quote-iva-lbl">IVA</span>
                <div className="seg">
                  {(["sumar", "incluido", "exento"] as const).map((m) => (
                    <button key={m} className={ivaMode === m ? "on" : ""} onClick={() => setIvaMode(m)}>
                      {m === "sumar" ? "Sumar 21%" : m === "incluido" ? "Incluido" : "Exento"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="quote-sum">
                <div className="qs-row">
                  <span>Subtotal</span>
                  <span>{money(total)}</span>
                </div>
                {ivaMode !== "exento" ? (
                  <div className="qs-row">
                    <span>IVA 21%{ivaMode === "incluido" ? " (incluido)" : ""}</span>
                    <span>{money(iva)}</span>
                  </div>
                ) : null}
                <div className="qs-total">
                  <span>Total</span>
                  <strong>{money(grand)}</strong>
                </div>
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
            {primary()}
          </div>
        </footer>
      </aside>
      </div>

      {viewer && dealName ? (
        <PdfViewer
          name={dealName}
          title={title || dealName}
          ivaMode={ivaMode}
          onClose={() => setViewer(false)}
        />
      ) : null}
    </>
  );
}
