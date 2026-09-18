import { CATEGORIES, CATEGORY_ORDER, ORIGINS } from "./categories";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  categoryCounts: Record<string, number>;
  originCounts: Record<string, number>;
  hiddenCategories: Set<string>;
  hiddenOrigins: Set<string>;
  onToggleCategory: (key: string) => void;
  onToggleOrigin: (origin: string) => void;
}

/**
 * La barra izquierda del prototipo (`index.html:1501-1521`): Agendas (las cinco
 * verticales con contador y toggle), Origen (CRM / Reserva web / Google) y el
 * stub de Buscador. Los contadores salen de TODOS los eventos; los toggles
 * filtran (el predicado vive en `Agenda.tsx`, igual que `oculto()`).
 */
export default function Sidebar({
  categoryCounts,
  originCounts,
  hiddenCategories,
  hiddenOrigins,
  onToggleCategory,
  onToggleOrigin,
}: SidebarProps) {
  return (
    <aside className={styles.agxSide}>
      <div>
        <h2 className={styles.agxBlockTitle}>Agendas</h2>
        {CATEGORY_ORDER.map((key) => {
          const cat = CATEGORIES[key];
          const off = hiddenCategories.has(key);
          return (
            <button
              key={key}
              type="button"
              className={styles.agxCal}
              data-cat={key}
              data-off={off || undefined}
              aria-pressed={!off}
              onClick={() => onToggleCategory(key)}
            >
              <span className={styles.agxDot} style={{ background: cat.color }} aria-hidden="true" />
              <span className={styles.agxName}>{cat.label}</span>
              <span className={styles.agxCount}>{categoryCounts[key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div>
        <h2 className={styles.agxBlockTitle}>Origen</h2>
        {ORIGINS.map((origin) => {
          const off = hiddenOrigins.has(origin);
          return (
            <button
              key={origin}
              type="button"
              className={styles.agxCal}
              data-origin={origin}
              data-off={off || undefined}
              aria-pressed={!off}
              onClick={() => onToggleOrigin(origin)}
            >
              <span
                className={styles.agxDot}
                style={{ background: "var(--fg-faint)" }}
                aria-hidden="true"
              />
              <span className={styles.agxName}>{origin}</span>
              <span className={styles.agxCount}>{originCounts[origin] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div>
        <h2 className={styles.agxBlockTitle}>Buscador</h2>
        <input
          className={styles.agxBuscador}
          value="Buscar…  ⌘ K"
          readOnly
          aria-label="Buscar reuniones"
          name="q"
          autoComplete="off"
        />
      </div>
    </aside>
  );
}
