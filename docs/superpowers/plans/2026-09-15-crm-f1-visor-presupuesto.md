# Visor previo de presupuesto (F1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder ver el PDF del presupuesto a pantalla completa dentro del CRM, antes de descargarlo, con la hoja tal cual la va a recibir el cliente.

**Architecture:** Componente React nuevo (`PdfViewer`) montado como overlay `position: fixed`, que pide el PDF al endpoint existente `crm_core.api.quote_pdf` (que devuelve bytes), lo envuelve en un `blob:` URL y lo muestra en un `<iframe>`. Cero dependencias nuevas: el visor nativo del navegador ya trae zoom, scroll y buscar. Se monta desde el drawer del negocio (pestaña Presupuesto). No toca el modelo de datos: F1 es independiente de F2.

**Tech Stack:** React 18 + TypeScript + Vite (`apps/web`), CSS plano en `styles.css`, Playwright para E2E, API whitelisted de Frappe v15.

**Spec:** `docs/superpowers/specs/2026-09-15-crm-facturacion-a2-design.md` (§8.2 Visor previo)

## Alcance de este plan

Este plan implementa **solo F1** del spec. Las fases siguientes llevan su propio plan
(cada una produce software usable y testeable por sí sola):

| Plan | Fase | Qué agrega |
|---|---|---|
| **este** | **F1** | **Visor previo del PDF** |
| F2 | Modelo propio | `CRM Vertical`, `CRM Presupuesto` + ítems con tipo de cobro, versiones, estados; limpieza de los presupuestos de prueba actuales |
| F3 | Facturación | `CRM Factura`, ítems, `CRM Pago`, estados y PDF de factura |
| F4 | Recurrencia | `CRM Suscripcion`, bandeja **Por facturar**, job diario |
| F5 | Números | Dashboard, Informes, CSV |

**Por qué F1 primero:** es lo único de todo el spec que no depende de nada, el riesgo
es mínimo (no toca datos ni migra nada) y el valor se ve al instante.

## Global Constraints

- **Todo el texto de UI va en español** (Argentina). Nada de etiquetas en inglés.
- **Date/numero:** moneda y números con `toLocaleString("es-AR")`; usar
  `font-variant-numeric: tabular-nums` en cualquier columna de números.
- **Íconos:** siempre SVG propios de `src/icons.tsx`. Prohibido glifos unicode (`✕`, `›`) y emoji.
- **Overlays:** siempre `position: fixed` con su propio `z-index`. Nunca dejar un overlay
  dentro de un ancestro con `overflow` (lo recorta). El drawer existente usa
  `.drawer-overlay` con `z-index` alto: el visor va **por encima**.
- **`border-left` / `border-right` de más de 1px: prohibido** (se ve pesado).
- **El bundle va embebido en base64** dentro de `apps/crm_core/crm_core/www/hoy.html`,
  que es **generado**: se regenera con `npm run build` (Vite + `gen-shell.mjs`).
  Nunca editar `www/hoy.html` a mano. `gen-shell.mjs` falla a propósito si el HTML
  contiene `.__` (Frappe rechaza esa secuencia en plantillas).
- **Verificación obligatoria antes de cada commit:** `npm run typecheck` y `npm run build`
  (desde `apps/web`), ambos en verde.
- **Deploy:** `bash scripts/deploy-crm.sh <N>` desde el VPS. **Nunca** `docker build` a mano
  y **nunca** encadenar un build con `| tail` (enmascara el exit code y ya provocó una caída).
- **E2E:** Playwright contra el sitio productivo con una API key temporal de Administrator.
  La key se crea con `scripts/tmp_admin_key.py` (`MODE=create`) y **se borra siempre**
  (`MODE=remove`) al terminar, incluso si el test falla.
- **No hay SMTP** en el servidor: ningún aviso puede depender de email.
- **TDD en serio donde hay runner:** el frontend no tiene runner de unit tests
  (solo `typecheck` + `build` + Playwright E2E). El test de esta fase **es** el E2E:
  se escribe primero y se lo ve fallar contra lo desplegado, antes de implementar.

---

### Task 1: Script E2E del visor (rojo)

El test se escribe **antes** que el componente y se corre contra lo que está
desplegado hoy (que no tiene visor) para verlo fallar. Es autosuficiente: crea su
propio negocio con ítems y lo borra al final, así no depende de datos de nadie.

**Files:**
- Create: `scripts/e2e-pdf-viewer.mjs`

**Interfaces:**
- Consumes: API existente — `crm_core.api.create_deal({title})` → `{name}`,
  `crm_core.api.save_quote(name, items)` → `{ok}`, `crm_core.api.delete_deal(name)`.
- Produces: nada que consuman otras tareas; es el test de aceptación de F1.

- [ ] **Step 1: Escribir el script E2E**

```javascript
// E2E del visor previo de presupuesto (F1).
// Autosuficiente: crea su negocio con ítems, verifica y lo borra.
// Requiere TOKEN="api_key:api_secret" de Administrator.
import { chromium } from "playwright";

const BASE = "https://crm.marcosbarbosagroup.com";
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error("Falta TOKEN=api_key:api_secret");

async function call(method, body) {
  const r = await fetch(`${BASE}/api/method/crm_core.api.${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${TOKEN}`,
      "X-Frappe-CSRF-Token": "x",
    },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t).message;
}

let dealName = null;
let failed = false;
const check = (label, cond) => {
  if (!cond) failed = true;
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
};

const browser = await chromium.launch();
try {
  dealName = (
    await call("create_deal", { title: "ZZ Visor Prueba", contact: "Test Visor" })
  ).name;
  await call("save_quote", {
    name: dealName,
    items: [{ description: "Servicio de prueba", qty: 1, rate: 100000, discount_percentage: 0 }],
  });

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { Authorization: `token ${TOKEN}` },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/hoy`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Negocios" }).click();
  await page.waitForTimeout(1800);

  await page.getByText("ZZ Visor Prueba").first().click();
  await page.waitForTimeout(1000);
  await page.locator('[role=tab]').nth(1).click(); // pestaña Presupuesto
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: /Ver presupuesto/i }).click();
  await page.waitForSelector(".pdfview", { timeout: 20000 });
  check("se abre el visor", (await page.locator(".pdfview").count()) === 1);

  const src = await page.locator(".pdfview-frame").getAttribute("src");
  check("iframe apunta a un blob del PDF", Boolean(src && src.startsWith("blob:")));

  check(
    "hay acción Descargar",
    (await page.getByRole("button", { name: /Descargar/i }).count()) === 1,
  );
  check(
    "hay acción Abrir",
    (await page.getByRole("link", { name: /Abrir/i }).count()) === 1,
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape cierra el visor", (await page.locator(".pdfview").count()) === 0);

  await ctx.close();
} catch (e) {
  failed = true;
  console.error("ERROR:", String(e).slice(0, 500));
} finally {
  if (dealName) {
    try {
      await call("delete_deal", { name: dealName });
      console.log("limpieza: negocio borrado");
    } catch (e) {
      console.error("No se pudo borrar", dealName, String(e).slice(0, 200));
    }
  }
  await browser.close();
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Correr el test y verificar que FALLA**

Crear la key temporal:

```bash
ssh root@2.28.121.92 'BE=$(docker ps -qf name=crm_backend.1); docker cp /opt/crm-marcosbarbosagroup/scripts/tmp_admin_key.py "$BE":/home/frappe/k.py; docker exec "$BE" bash -c "cd /home/frappe/frappe-bench && MODE=create FRAPPE_SITE=crm.marcosbarbosagroup.com ./env/bin/python /home/frappe/k.py 2>&1 | tail -2"'
```

Correr el E2E (con la key y secret que devolvió el comando anterior):

```bash
cd /Users/joelpacheco/PROYECTOS/crm-marcosbarbosagroup
TOKEN="<KEY>:<SECRET>" node scripts/e2e-pdf-viewer.mjs
```

Expected: **FALLA** en `se abre el visor` con un timeout esperando `.pdfview`
(el visor todavía no existe), y la limpieza borra el negocio igual.

- [ ] **Step 3: Commit del test en rojo**

```bash
git add scripts/e2e-pdf-viewer.mjs
git commit -m "test(e2e): visor previo de presupuesto (rojo)"
```

---

### Task 2: Ícono `IconExternal`

**Files:**
- Modify: `apps/web/src/icons.tsx` (agregar al final del archivo)

**Interfaces:**
- Consumes: el helper `Base` ya definido en `icons.tsx`.
- Produces: `IconExternal`, usado por `PdfViewer` en Task 3.

- [ ] **Step 1: Agregar el ícono**

Al final de `apps/web/src/icons.tsx`:

```tsx
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-8 8" />
    <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
  </Base>
);
```

- [ ] **Step 2: Verificar tipos**

Run: `cd apps/web && npm run typecheck`
Expected: PASS (sin errores)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/icons.tsx
git commit -m "feat(ui): ícono IconExternal"
```

---

### Task 3: Componente `PdfViewer`

**Files:**
- Create: `apps/web/src/PdfViewer.tsx`
- Modify: `apps/web/src/styles.css` (agregar al final, antes del bloque `@media (max-width: 820px)`)

**Interfaces:**
- Consumes: `api.quotePdf(name, ivaMode): Promise<Blob>` (ya existe en `src/api.ts`),
  `IconDownload`, `IconExternal`, `IconReceipt`, `IconX` de `src/icons.tsx`.
- Produces: `export default function PdfViewer(props: { name: string; title: string;
  quoteNo?: string; ivaMode: string; onClose: () => void })` — consumido en Task 4.

- [ ] **Step 1: Crear el componente**

`apps/web/src/PdfViewer.tsx`:

```tsx
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
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
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
```

- [ ] **Step 2: Agregar los estilos**

En `apps/web/src/styles.css`, al final (antes de los `@media` existentes):

```css
/* `pop` no estaba definido: lo referenciaban .pipe-menu y .reminder, así que esas
   dos animaciones no hacían nada (falla silenciosa). Se define acá y quedan
   funcionando las tres. */
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.985) translateY(2px);
  }
}

/* ── Visor previo de presupuesto ─────────────────────── */
.pdfview-overlay {
  position: fixed;
  inset: 0;
  z-index: 120; /* por encima del drawer (z-index 100) */
  background: rgba(6, 6, 8, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  animation: fade 0.16s var(--ease);
}
.pdfview {
  width: min(920px, 100%);
  height: min(94vh, 100%);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  animation: pop 0.18s var(--ease);
}
.pdfview-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.pdfview-id {
  min-width: 0;
  flex: 1;
}
.pdfview-id .eyebrow {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-faint);
  font-weight: 600;
}
.pdfview-id h2 {
  margin: 3px 0 0;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pdfview-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
}
.pdfview-actions .ghost,
.pdfview-actions .ghost:visited {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}
.pdfview-actions .ghost.is-off {
  opacity: 0.45;
  pointer-events: none;
}
.pdfview-body {
  flex: 1;
  min-height: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pdfview-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

@media (max-width: 720px) {
  .pdfview-overlay {
    padding: 0;
  }
  .pdfview {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;
  }
  .pdfview-bar {
    flex-wrap: wrap;
    padding: 10px 12px;
  }
  .pdfview-id {
    order: 1;
    flex: 1 0 100%;
  }
  .pdfview-actions {
    order: 2;
    width: 100%;
    justify-content: flex-end;
  }
}
```

- [ ] **Step 3: Verificar tipos y build**

Run: `cd apps/web && npm run typecheck && npm run build`
Expected: ambos PASS. El build escribe `apps/crm_core/crm_core/www/hoy.html`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/PdfViewer.tsx apps/web/src/styles.css apps/crm_core/crm_core/www/hoy.html
git commit -m "feat(presupuesto): componente visor previo del PDF"
```

---

### Task 4: Montar el visor desde el drawer del negocio

Hoy `DealDrawer` tiene un botón "PDF" que descarga directo. Pasa a tener **"Ver
presupuesto"** (abre el visor) y **"Guardar presupuesto"**. La descarga vive dentro
del visor, en un solo lugar.

**Files:**
- Modify: `apps/web/src/DealDrawer.tsx` (import, estado, botón del footer, render)

**Interfaces:**
- Consumes: `PdfViewer` de Task 3.
- Produces: nada; cierra el flujo de F1.

- [ ] **Step 1: Importar el visor**

En `apps/web/src/DealDrawer.tsx`, sumar al bloque de imports:

```tsx
import PdfViewer from "./PdfViewer";
```

- [ ] **Step 2: Agregar el estado del visor**

Junto a los demás `useState` del componente:

```tsx
const [viewer, setViewer] = useState(false);
```

- [ ] **Step 3: Reemplazar el botón del footer**

En la función `primary()`, en la rama del presupuesto, cambiar el botón "PDF" por
uno que abra el visor (y que antes guarde lo que hay en pantalla, para que la
preview muestre exactamente lo cargado):

```tsx
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
```

Borrar también la función `downloadPdf` (quedó sin uso: la descarga la maneja el
visor) y el import de `IconDownload` si ya no se usa en el archivo.

- [ ] **Step 4: Renderizar el visor**

Justo antes del cierre del `return`, después del `</div>` del overlay del drawer
(nivel del fragmento raíz, hermano del `.drawer-overlay`):

```tsx
      {viewer && dealName ? (
        <PdfViewer
          name={dealName}
          title={title || dealName}
          ivaMode={ivaMode}
          onClose={() => setViewer(false)}
        />
      ) : null}
```

- [ ] **Step 5: Verificar tipos y build**

Run: `cd apps/web && npm run typecheck && npm run build`
Expected: ambos PASS, sin warnings de imports sin usar.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/DealDrawer.tsx apps/crm_core/crm_core/www/hoy.html
git commit -m "feat(presupuesto): abrir el visor previo desde el drawer del negocio"
```

---

### Task 5: Deploy y E2E en verde

**Files:**
- Modify: ninguno (se despliega y se verifica)

**Interfaces:**
- Consumes: `scripts/deploy-crm.sh` (ya existe), `scripts/e2e-pdf-viewer.mjs` (Task 1).

- [ ] **Step 1: Desplegar**

```bash
ssh root@2.28.121.92
cd /opt/crm-marcosbarbosagroup
bash scripts/deploy-crm.sh 56
```

Expected: termina con `DEPLOY OK: crm-mb:56` y los 5 servicios en `1/1`.

- [ ] **Step 2: Correr el E2E**

```bash
cd /Users/joelpacheco/PROYECTOS/crm-marcosbarbosagroup
TOKEN="<KEY>:<SECRET>" node scripts/e2e-pdf-viewer.mjs
```

Expected: **5 OK** — `se abre el visor`, `iframe apunta a un blob del PDF`,
`hay acción Descargar`, `hay acción Abrir`, `Escape cierra el visor`. Exit code 0.

Si falla `iframe apunta a un blob del PDF`, revisar que el endpoint devuelva
`application/pdf` (no un JSON de error): el error más probable es que el negocio de
prueba haya quedado sin ítems.

- [ ] **Step 3: Verificación visual**

Con la key temporal, sacar una captura del visor abierto:

```bash
cd /Users/joelpacheco/PROYECTOS/crm-marcosbarbosagroup
TOKEN="<KEY>:<SECRET>" node scripts/e2e-pdf-viewer.mjs  # dejarlo abierto no aplica: usar el shot
```

Expected: revisar a ojo que la hoja se lea nítida, que la barra superior no se
desborde, y que en 390px de ancho (mobile) el visor ocupe toda la pantalla con las
acciones abajo a la derecha. Si algo se ve mal, corregir estilos y volver a Task 3.

- [ ] **Step 4: Borrar la key temporal**

```bash
ssh root@2.28.121.92 'BE=$(docker ps -qf name=crm_backend.1); docker exec "$BE" bash -c "cd /home/frappe/frappe-bench && MODE=remove FRAPPE_SITE=crm.marcosbarbosagroup.com ./env/bin/python /home/frappe/k.py 2>&1 | tail -1"'
```

Expected: `REMOVED`.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore: F1 visor previo verificado en producción" --allow-empty
```

---

## Self-Review

**1. Cobertura del spec**
- §8.2 Visor previo: overlay a pantalla completa ✓ (Task 3), PDF embebido vía `blob:` ✓,
  barra superior con número y título ✓, acciones Descargar / Abrir ✓, se abre desde el
  drawer del negocio ✓, estados loading/error ✓.
- §8.2 menciona además "Enviar · Aceptar · Rechazar": **dependen de los estados del
  presupuesto (F2)** y por eso están explícitamente fuera de F1. Correcto.
- §8.3 Congelamiento (`snapshot_hash`): depende de "Enviar", también F2.
- §9.2 "acceso al PDF" desde el negocio: cubierto por Task 4.

**2. Placeholders:** no hay `TBD`/`TODO`/`implement later`. Cada step de código trae el
código completo. Los `<KEY>:<SECRET>` son valores que devuelve el comando del Step 1 de
Task 1 y de Task 5, no incógnitas de diseño.

**3. Consistencia de tipos:** `api.quotePdf(name: string, ivaMode: string): Promise<Blob>`
— ya existe con esa firma en `src/api.ts`. `PdfViewer` declara
`{ name, title, quoteNo?, ivaMode, onClose }` y Task 4 lo invoca con `name`, `title`,
`ivaMode`, `onClose` (sin `quoteNo`: queda opcional y el eyebrow lo omite). Coincide.

**4. Riesgo residual detectado:** en iOS Safari los `<iframe>` muestran solo la primera
página de un PDF. La mitigación ya está en el diseño: la acción **Abrir** usa el visor
nativo en pestaña nueva, que en iOS es la forma correcta. No se agrega detección de
plataforma: sería complejidad sin beneficio.

**5. Defecto preexistente que este plan arregla:** `@keyframes pop` estaba referenciado
por `.pipe-menu` (línea ~1403) y `.reminder` (línea ~1462) pero **nunca fue definido**,
así que esas dos animaciones no se ejecutaban. Task 3 lo define, y con eso el visor y las
dos pantallas existentes animan. Verificado por grep antes de escribir el plan.

---

## Roadmap de los planes siguientes

Cuando F1 esté en producción y verificado, el plan de **F2** cubre: `CRM Vertical`
(seed de las 7), `CRM Presupuesto` + `CRM Presupuesto Item` con `billing_type`,
totales separados (inversión inicial vs abono mensual), versiones, máquina de estados
con congelamiento, PDF con los dos totales, y la **limpieza de los presupuestos de
prueba actuales** (`CRM Deal.products`), que el usuario ya autorizó. Ahí se resuelven
también las dos decisiones que quedaron: vencimiento editable a mano y moneda por
cliente (el campo `currency` ya existe en `CRM Organization`).
