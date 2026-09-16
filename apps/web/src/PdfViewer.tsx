import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { IconDownload, IconExternal, IconReceipt, IconX } from "./icons";

export default function PdfViewer({
  name,
  title,
  quoteNo,
  ivaMode,
  onClose,
}: {
  name: string;
  title: string;
  quoteNo?: string;
  ivaMode: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .quotePdf(name, ivaMode)
      .then((blob) => {
        if (!alive) return;
        const u = URL.createObjectURL(blob);
        urlRef.current = u;
        setUrl(u);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [name, ivaMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const filename = `Presupuesto${quoteNo ? ` ${quoteNo}` : ""} - ${title}.pdf`;

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="pdfview-overlay" onClick={onClose}>
      <div
        className="pdfview"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Vista previa del presupuesto"
      >
        <header className="pdfview-bar">
          <div className="pdfview-id">
            <span className="eyebrow">Presupuesto{quoteNo ? ` ${quoteNo}` : ""}</span>
            <h2>{title}</h2>
          </div>
          <div className="pdfview-actions">
            <button className="ghost" onClick={download} disabled={!url}>
              <IconDownload width={15} height={15} /> Descargar
            </button>
            <a
              className={`ghost ${url ? "" : "is-off"}`}
              href={url ?? "#"}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!url}
              onClick={(e) => {
                if (!url) e.preventDefault();
              }}
            >
              <IconExternal width={15} height={15} /> Abrir
            </a>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar" autoFocus>
              <IconX />
            </button>
          </div>
        </header>

        <div className="pdfview-body">
          {loading ? (
            <div className="drawer-loading">Generando vista previa…</div>
          ) : error ? (
            <div className="empty soft">
              <IconReceipt className="empty-ico" />
              <p>{error}</p>
              <button className="ghost" onClick={onClose}>
                Cerrar
              </button>
            </div>
          ) : (
            <iframe className="pdfview-frame" src={url ?? ""} title={filename} />
          )}
        </div>
      </div>
    </div>
  );
}
