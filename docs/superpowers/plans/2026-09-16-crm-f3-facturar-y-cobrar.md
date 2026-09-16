# Facturar y cobrar (F3.1 + F3.2) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir un presupuesto aceptado en una factura emitida, y registrar cobros —parciales, completos, de varias facturas a la vez, y a cuenta— sabiendo siempre cuánto falta cobrar y qué está vencido.

**Architecture:** Dos DocTypes nuevos (`CRM Factura` con sus ítems, y `CRM Pago` con sus aplicaciones) sobre el patrón que F2 dejó probado. La matemática de cobranza (totales, estado derivado, reparto FIFO, aging) vive en `billing.py`, **pura**, para testearla sin base de datos. El estado de la factura **se deriva** de los montos y nunca se mantiene a mano; los campos denormalizados (`paid_amount`, `outstanding`) tienen **un solo punto de escritura** que recalcula leyendo las aplicaciones.

**Tech Stack:** Frappe v15 (DocTypes JSON + controllers), Python `Decimal`, pytest local (sin sitio) + `bench run-tests` sobre `crm-test`, React 18 + TypeScript (Vite), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-16-crm-facturacion-f3-design.md` (ya corregido por la auditoría adversarial — **leerlo antes de empezar**, en particular §5, §6 y §15)

## Correcciones de la auditoría que este plan aplica desde el arranque

El spec de F3 se auditó **antes** de planificar y salieron 13 correcciones. Las que tocan este plan,
y que **no se pueden "descubrir" después** porque cambian el modelo:

| Corrección | Dónde se aplica en este plan |
|---|---|
| El estado **se deriva** (no se mantiene a mano): se separan transiciones de usuario de recomputación automática | Task 1 (`invoice_status` puro) y Task 4 (el controller no setea `status` a mano) |
| `Pagada` exige `outstanding == 0` **y** `paid_amount > 0` (si no, una factura acreditada al 100% y nunca cobrada quedaría pagada) | Task 1, con test explícito |
| Los campos denormalizados tienen **un solo punto de escritura** que **lee** las aplicaciones, invocado desde `on_update`/`after_insert`/`on_trash` — no desde cada handler | Task 7 |
| Las aplicaciones **validan organización y moneda** (sin esto un pago en USD puede aplicarse a la factura en ARS de otro cliente) | Task 6 y Task 7 |
| `CRM Pago.kind` (`Cobro` / `Crédito` / `Devolución`): sin él, el excedente de una nota de crédito y la devolución de un sobrepago **no tienen representación** | Task 7 |
| **Los campos fiscales los crea este plan** (la versión anterior del spec afirmaba por error que F2 ya los había reservado) | Task 3 |
| **Sin `afip_cert` ni `afip_key` en F3**: una clave privada en un campo de texto plano es un riesgo, no un YAGNI | Task 2 (explícito en el DocType y en el comentario) |
| La leyenda AFIP **no** se extiende a las facturas: la "X" es de presupuestos, remitos y recibos | Task 2 (presupuesto) y Task 4 (factura sin CAE como documento **interno**) |
| El estado se computa **en lectura** para no mostrar `Vencida` un día de más | Task 1 (función pura) + Task 5 (la lista la usa) |

## Alcance de este plan

| Plan | Fase | Qué agrega |
|---|---|---|
| **este** | **F3.1 + F3.2** | **Facturar y cobrar** |
| F3.3 | Notas de crédito | `is_return` + `return_against`, reversión, cascada |
| F3.4 | Informes | Dashboard de cobranzas, aging, DSO en pantalla |

**F3.1 y F3.2 van juntas** porque emitir facturas sin poder cobrarlas deja la mitad de los estados
inalcanzables y no se puede verificar el ciclo. F3.3 (notas de crédito) sí es un incremento aparte:
sin ella se factura y se cobra; con ella se **corrige** una factura ya emitida.

## Global Constraints

- **Todo texto visible al usuario en español (Argentina)**, incluidos los mensajes de error de la API.
- **Dinero en `Decimal`, nunca `float`.** Se redondea a 2 decimales al cerrar cada importe, no en
  pasos intermedios. Toda la matemática de cobranza vive en `billing.py` (pura, sin Frappe).
- **El estado de la factura se deriva**: `billing.invoice_status(...)`. Ningún controller ni endpoint
  escribe `status` a mano (salvo `Anulada` e `Incobrable`, que son marcas explícitas del usuario).
- **`outstanding` nunca puede ser negativo.**
- **Una factura emitida no se edita.** Excepción: `due_date` (editable a mano).
- **Un pago aplicado no se edita ni se borra: se anula.** Y las facturas afectadas recalculan.
- **Las aplicaciones validan organización y moneda.** Un pago solo se aplica a facturas del mismo
  cliente y la misma moneda.
- **La numeración interna (`F-.YYYY.-.####`) no es la fiscal.** `point_of_sale`, `fiscal_number`,
  `cae` y `comprobante_code` existen **vacíos** y no se completan hasta F6.
- **Nunca guardar secretos en campos de DocType** (certificado ni clave privada de AFIP).
- **Íconos**: sólo SVG propios de `apps/web/src/icons.tsx`. Todo overlay con React portal a
  `document.body` (lección de F1).
- **Los totales que se muestran son los del servidor.** El navegador no calcula dinero.
- **Verificación antes de cada commit:** los tests de la tarea en verde. Frontend:
  `cd apps/web && npm run typecheck && npm run build` (el build regenera
  `apps/crm_core/crm_core/www/hoy.html`: commitearlo).
- **Tests:** los puros se corren local con `cd apps/crm_core && python3 -m pytest -q`. Los de
  integración **sólo** contra el sitio de prueba `crm-test` (`bench --site crm-test run-tests
  --module crm_core.tests.<módulo>`); **nunca** contra producción.
- **Deploy:** `bash scripts/deploy-crm.sh <N> [--migrate]` desde el VPS. **Nunca** `docker build` a
  mano ni encadenar con `| tail`. **Push antes de deploy** (`git log origin/main..HEAD` debe estar
  vacío: los subagentes commitean, el coordinador pushea).
- **DocTypes nuevos ⇒ `--migrate`.** En Frappe, un DocType existe en la base recién después del
  migrate; sin él la app arranca pero el DocType no está.
- **E2E** con API key temporal (`scripts/tmp_admin_key.py`), borrada **siempre** al terminar.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/crm_core/crm_core/billing.py` | **Se amplía**: `invoice_totals`, `invoice_status`, `reparto_fifo`, `aging_buckets` (todo puro) |
| `.../mbcrm/doctype/crm_factura/` | **Nuevo**: la factura, su estado derivado y sus transiciones |
| `.../mbcrm/doctype/crm_factura_item/` | **Nuevo**: ítem con tipo de cobro y período |
| `.../mbcrm/doctype/crm_pago/` | **Nuevo**: el movimiento (cobro / crédito / devolución) |
| `.../mbcrm/doctype/crm_pago_aplicacion/` | **Nuevo**: a qué factura y cuánto |
| `.../mbcrm/doctype/crm_punto_de_venta/` | **Nuevo**: numeración fiscal futura |
| `.../mbcrm/doctype/crm_emisor/` | **Nuevo**: datos fiscales informativos |
| `apps/crm_core/crm_core/documents.py` | **Se amplía**: `invoice_context`, `render_invoice_pdf`; **se corrige** la leyenda del presupuesto |
| `apps/crm_core/crm_core/templates/quote.html` | **Se corrige**: leyenda legal AFIP |
| `apps/crm_core/crm_core/templates/invoice.html` | **Nuevo**: la factura |
| `apps/crm_core/crm_core/api.py` | Endpoints de facturación y cobros |
| `apps/crm_core/tests/test_billing_factura.py` | **Nuevo**: matemática pura de facturación |
| `apps/crm_core/crm_core/tests/test_factura_api.py` | **Nuevo**: integración de facturas |
| `apps/crm_core/crm_core/tests/test_pago_api.py` | **Nuevo**: integración de cobros |
| `apps/web/src/{api.ts,Billing.tsx,InvoiceDrawer.tsx,PaymentDrawer.tsx,App.tsx}` | Vista Facturación y sus drawers |

---

### Task 1: `billing.py` — la matemática de facturación (pura)

Es la base de todo y lo más fácil de romper en silencio. Va como funciones puras para poder testearlas
sin sitio, sin red y sin Docker.

**Files:**
- Modify: `apps/crm_core/crm_core/billing.py` (agregar al final)
- Create: `apps/crm_core/tests/test_billing_factura.py`

**Interfaces:**
- Consumes: `dec`, `money`, `line_amounts`, `quote_totals` (ya existen en `billing.py`).
- Produces:
  - `invoice_totals(items, iva_mode="sumar", iva_rate=IVA_RATE) -> dict`
  - `invoice_status(total, paid_amount, credit_total, due_date, today=None, is_return=False, is_voided=False, is_uncollectible=False) -> str`
  - `outstanding_of(total, paid_amount, credit_total) -> Decimal`
  Los consumen Task 4 (controller), Task 6 (API) y Task 11 (recálculo).

- [ ] **Step 1: Escribir los tests que fallan**

`apps/crm_core/tests/test_billing_factura.py`:

```python
"""Matemática pura de facturación. Sin Frappe, sin base, sin red."""
from datetime import date
from decimal import Decimal

from crm_core.billing import (
    invoice_status,
    invoice_totals,
    outstanding_of,
)


def item(qty, rate, discount=0, billing_type="Único"):
    return {
        "qty": qty,
        "rate": rate,
        "discount_percentage": discount,
        "billing_type": billing_type,
    }


# ── Totales ────────────────────────────────────────────────────────────
def test_totales_de_una_factura_simple():
    t = invoice_totals([item(1, "850000")], iva_mode="sumar")
    assert t["subtotal"] == Decimal("850000.00")
    assert t["iva_amount"] == Decimal("178500.00")
    assert t["total"] == Decimal("1028500.00")


def test_la_factura_no_separa_bases_de_tiempo_como_el_presupuesto():
    """En una factura, TODOS los ítems están en la misma base: es un cargo puntual.

    Un ítem 'Mensual' facturado ES el cargo de ese período; no hay que normalizarlo
    a mensual como en el presupuesto (donde el abono se compara contra la inversión).
    """
    t = invoice_totals([item(1, "210000", 0, "Mensual")], iva_mode="sumar")
    assert t["subtotal"] == Decimal("210000.00")
    assert t["total"] == Decimal("254100.00")


def test_descuento_por_linea():
    t = invoice_totals([item(3, "145000", 10)], iva_mode="sumar")
    assert t["subtotal"] == Decimal("391500.00")
    assert t["discount_total"] == Decimal("43500.00")


def test_iva_incluido_y_exento():
    incl = invoice_totals([item(1, "121000")], iva_mode="incluido")
    assert incl["total"] == Decimal("121000.00")
    assert incl["iva_amount"] == Decimal("21000.00")
    exento = invoice_totals([item(1, "100000")], iva_mode="exento")
    assert exento["iva_amount"] == Decimal("0.00")
    assert exento["total"] == Decimal("100000.00")


# ── Saldo ──────────────────────────────────────────────────────────────
def test_outstanding_descuenta_pagos_y_creditos():
    assert outstanding_of("1000", "300", "100") == Decimal("600.00")


def test_outstanding_nunca_es_negativo():
    """El tope se aplica en la NC (§5.2 del spec), pero la funcion no puede mentir:
    un saldo negativo es un dato corrupto, no un saldo a favor."""
    assert outstanding_of("1000", "1200", "0") == Decimal("0.00")
    assert outstanding_of("1000", "1000", "500") == Decimal("0.00")


# ── Estado derivado ────────────────────────────────────────────────────
HOY = date(2026, 9, 16)


def test_sin_pagos_y_sin_vencer_es_emitida():
    assert invoice_status("1000", "0", "0", date(2026, 10, 1), HOY) == "Emitida"


def test_sin_pagos_con_vencimiento_pasado_es_vencida():
    assert invoice_status("1000", "0", "0", date(2026, 9, 1), HOY) == "Vencida"


def test_pago_parcial_es_parcial_aunque_este_vencida():
    """Parcial gana sobre Vencida: si ya entro plata, el estado util es cuanto falta."""
    assert invoice_status("1000", "400", "0", date(2026, 9, 1), HOY) == "Parcial"


def test_pago_total_es_pagada():
    assert invoice_status("1000", "1000", "0", date(2026, 9, 1), HOY) == "Pagada"


def test_acreditada_al_ciento_por_ciento_y_sin_cobrar_NO_es_pagada():
    """Hallazgo de la auditoria: sin esta regla, una factura emitida por error,
    acreditada 100% y nunca cobrada quedaba 'Pagada', que es mentir."""
    assert invoice_status("1000", "0", "1000", date(2026, 10, 1), HOY) == "Emitida"


def test_acreditada_parcialmente_sigue_emitida():
    assert invoice_status("1000", "0", "300", date(2026, 10, 1), HOY) == "Emitida"


def test_pago_mas_credito_que_cubre_el_total_es_pagada_si_hubo_pago():
    assert invoice_status("1000", "400", "600", date(2026, 10, 1), HOY) == "Pagada"


def test_las_marcas_explicitas_ganan_sobre_lo_derivado():
    assert invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_voided=True) == "Anulada"
    assert (
        invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_uncollectible=True)
        == "Incobrable"
    )


def test_una_nota_de_credito_emitida_se_reporta_como_emitida():
    """`is_return` no tiene estados de cobro: es un comprobante que corrige."""
    assert (
        invoice_status("1000", "0", "0", date(2026, 9, 1), HOY, is_return=True) == "Emitida"
    )
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd apps/crm_core && python3 -m pytest tests/test_billing_factura.py -v`
Expected: FAIL con `ImportError: cannot import name 'invoice_status'`

- [ ] **Step 3: Implementar en `billing.py`**

Agregar al final de `apps/crm_core/crm_core/billing.py`:

```python
# ── Facturación ────────────────────────────────────────────────────────

def invoice_totals(items, iva_mode: str = "sumar", iva_rate: Decimal = IVA_RATE) -> dict:
    """Totales de una factura a partir de sus ítems.

    A diferencia del presupuesto, acá NO se separan bases de tiempo: una factura es un
    cargo puntual. Un ítem 'Mensual' facturado ES el cargo de ese período, no un abono a
    normalizar. Sumar todos los netos es correcto.
    """
    subtotal = Decimal("0")
    discount_total = Decimal("0")

    for it in items:
        gross, net = line_amounts(
            it.get("qty"), it.get("rate"), it.get("discount_percentage")
        )
        discount_total += gross - net
        subtotal += net

    subtotal = money(subtotal)
    iva, total = _apply_iva(subtotal, iva_mode, iva_rate)

    return {
        "subtotal": subtotal,
        "discount_total": money(discount_total),
        "iva_amount": iva,
        "total": total,
    }


def outstanding_of(total, paid_amount, credit_total) -> Decimal:
    """Saldo pendiente. Nunca negativo: un saldo negativo es un dato corrupto.

    El tope real del crédito se aplica al emitir la nota de crédito (§5.2 del spec);
    acá se garantiza que el número que se muestra nunca mienta.
    """
    saldo = dec(total) - dec(paid_amount) - dec(credit_total)
    return money(saldo) if saldo > 0 else Decimal("0.00")


def invoice_status(
    total,
    paid_amount,
    credit_total,
    due_date,
    today=None,
    is_return: bool = False,
    is_voided: bool = False,
    is_uncollectible: bool = False,
) -> str:
    """Estado DERIVADO de la factura. La única fuente de verdad del estado.

    Reglas, en orden:
      1. Las marcas explícitas del usuario ganan (Anulada, Incobrable).
      2. Una nota de crédito emitida no tiene ciclo de cobro: es un comprobante.
      3. Pagada exige saldo 0 **y** que haya entrado plata: una factura acreditada al
         100% y nunca cobrada NO está pagada (hallazgo de la auditoría).
      4. Parcial gana sobre Vencida: si ya entró plata, lo útil es cuánto falta.
      5. Sin pagos: Vencida si el vencimiento pasó, Emitida si no.
    """
    if is_voided:
        return "Anulada"
    if is_uncollectible:
        return "Incobrable"
    if is_return:
        return "Emitida"

    paid = dec(paid_amount)
    saldo = outstanding_of(total, paid_amount, credit_total)
    hoy = today or datetime.date.today()

    if saldo == 0:
        return "Pagada" if paid > 0 else "Emitida"
    if paid > 0:
        return "Parcial"
    if due_date and str(due_date) < str(hoy):
        return "Vencida"
    return "Emitida"
```

Y agregar `import datetime` arriba, junto a `from decimal import ROUND_HALF_UP, Decimal`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd apps/crm_core && python3 -m pytest tests/test_billing_factura.py -v`
Expected: PASS (14 tests)

- [ ] **Step 5: Verificar que no se rompió lo de F2**

Run: `cd apps/crm_core && python3 -m pytest -q`
Expected: PASS (los 54 que ya había + los 14 nuevos)

- [ ] **Step 6: Commit**

```bash
git add apps/crm_core/crm_core/billing.py apps/crm_core/tests/test_billing_factura.py
git commit -m "feat(facturacion): matematica pura de facturas (totales, saldo y estado derivado)"
```

---

### Task 2: La leyenda legal de AFIP y los datos fiscales base

Dos cosas chicas y muy concretas: **corregir un incumplimiento real** en el PDF que ya está en
producción, y crear los dos DocTypes fiscales **sin secretos**.

**Files:**
- Modify: `apps/crm_core/crm_core/templates/quote.html`
- Create: `.../mbcrm/doctype/crm_punto_de_venta/{__init__.py,crm_punto_de_venta.json,crm_punto_de_venta.py}`
- Create: `.../mbcrm/doctype/crm_emisor/{__init__.py,crm_emisor.json,crm_emisor.py}`

**Interfaces:**
- Consumes: nada.
- Produces: `CRM Punto de Venta` y `CRM Emisor` (los consume Task 3 como Link y Task 5 para el PDF).

- [ ] **Step 1: La leyenda legal en el presupuesto**

La auditoría verificó contra la fuente oficial (RG 3803/1994 art. 9) que **los presupuestos** se
identifican con la letra **"X"** y la leyenda **"DOCUMENTO NO VÁLIDO COMO FACTURA"**, destacadas
arriba al centro. **Nuestro PDF no la lleva.**

En `apps/crm_core/crm_core/templates/quote.html`, dentro del bloque de título (junto a
`<h1>Presupuesto</h1>`), agregar la marca y la leyenda:

```html
      <h1>Presupuesto</h1>
      <div class="legal-mark">
        <span class="legal-x">X</span>
        <span class="legal-legend">DOCUMENTO NO VÁLIDO COMO FACTURA</span>
      </div>
      <div class="quote-no">N° <b>{{ quote_no }}</b></div>
```

y los estilos, junto a los del título:

```css
.legal-mark { display: flex; align-items: center; gap: 7px; margin-top: 4px; }
.legal-x {
  font-size: 13pt; font-weight: 700; color: #17171a;
  border: 1.5px solid #17171a; border-radius: 3px;
  padding: 0 5px; line-height: 1.25;
}
.legal-legend { font-size: 8.4pt; font-weight: 600; letter-spacing: 0.08em; color: #17171a; }
```

Verificar la maqueta con el harness que ya existe (no hace falta desplegar):

```bash
python3 scripts/quote-preview.py && node scripts/quote-shot.mjs
```
Expected: **1 página** y en `quote-preview.png` se ve la "X" y la leyenda arriba, sin desbordes.

- [ ] **Step 2: `CRM Punto de Venta`**

`crm_punto_de_venta.json` — molde: `apps/crm_core/crm_core/mbcrm/doctype/crm_vertical/crm_vertical.json`
(mismas claves raíz, `module: "MbCRM"`, permisos `System Manager` + `All`).

```json
{
  "autoname": "field:numero",
  "field_order": ["numero", "nombre", "activo"],
  "fields": [
    {"fieldname": "numero", "fieldtype": "Int", "label": "Número", "reqd": 1, "unique": 1, "in_list_view": 1},
    {"fieldname": "nombre", "fieldtype": "Data", "label": "Nombre", "in_list_view": 1},
    {"fieldname": "activo", "fieldtype": "Check", "label": "Activo", "default": "1", "in_list_view": 1}
  ],
  "module": "MbCRM",
  "name": "CRM Punto de Venta",
  "sort_field": "numero",
  "sort_order": "ASC"
}
```

`crm_punto_de_venta.py`:
```python
from frappe.model.document import Document


class CRMPuntoDeVenta(Document):
    pass
```

**Ojo con el nombre de la clase** — Frappe lo deriva quitando los espacios: "CRM Punto de Venta" →
`CRMPuntoDeVenta`. Verificalo contra un DocType existente (`CRM Vertical` → `CRMVertical`) antes de
commitear: si el nombre está mal, el controller no se encuentra.

- [ ] **Step 3: `CRM Emisor` — sin secretos**

`crm_emisor.json` — **single** (`"issingle": 1`), sin permisos de lista:

```json
{
  "field_order": ["razon_social", "cuit", "iva_condition", "address", "phone", "email", "cbu_alias"],
  "fields": [
    {"fieldname": "razon_social", "fieldtype": "Data", "label": "Razón social"},
    {"fieldname": "cuit", "fieldtype": "Data", "label": "CUIT"},
    {"fieldname": "iva_condition", "fieldtype": "Select", "label": "Condición frente al IVA",
     "options": "\nResponsable Inscripto\nMonotributo\nExento"},
    {"fieldname": "address", "fieldtype": "Small Text", "label": "Domicilio"},
    {"fieldname": "phone", "fieldtype": "Data", "label": "Teléfono"},
    {"fieldname": "email", "fieldtype": "Data", "label": "Email", "options": "Email"},
    {"fieldname": "cbu_alias", "fieldtype": "Data", "label": "CBU / Alias"}
  ],
  "issingle": 1,
  "module": "MbCRM",
  "name": "CRM Emisor"
}
```

**Regla de seguridad (del spec §4.5, hallazgo de la auditoría):** este DocType **no lleva
`afip_cert` ni `afip_key`**. Guardar un certificado y una clave privada como campos de texto plano es
un riesgo real, no un "ya lo vamos a necesitar". Cuando F6 integre el webservice, esos secretos van
con almacenamiento cifrado y roles propios. Dejar el comentario en el controller para que el próximo
no lo "complete":

```python
from frappe.model.document import Document


class CRMEmsor(Document):
    """Datos fiscales INFORMATIVOS del emisor.

    A proposito NO guarda el certificado ni la clave privada de AFIP: son secretos y van
    con almacenamiento cifrado y roles propios cuando F6 integre el webservice.
    """
    pass
```

(Hmm: verificá el nombre de la clase — "CRM Emisor" → `CRMEmsor` según la regla de Frappe. Si el
smoke test del Dockerfile falla con `cannot import name`, el nombre correcto está en el error:
probá `CRMEmsor` y si no `CRMEmitter`.)

- [ ] **Step 4: Validación offline (la red que evita romper el `migrate`)**

Run: `cd apps/crm_core && python3 -m pytest tests/test_doctypes_offline.py -v`
Expected: PASS, con **2 DocTypes más** en la colección. Si falla por un Link desconocido, agregá el
destino al conjunto `externos` del test (es la lista de DocTypes de Frappe u otros apps).

- [ ] **Step 5: Commit**

```bash
git add apps/crm_core/crm_core/templates/quote.html \
        apps/crm_core/crm_core/mbcrm/doctype/crm_punto_de_venta \
        apps/crm_core/crm_core/mbcrm/doctype/crm_emisor \
        apps/crm_core/crm_core/www/hoy.html
git commit -m "feat(facturacion): leyenda legal AFIP en el presupuesto + Punto de Venta y Emisor sin secretos"
```
---

### Task 3: `CRM Factura` y `CRM Factura Item`

Los dos DocTypes centrales. **Acá se crean los campos fiscales** que la versión anterior del spec
afirmaba (por error) que F2 ya había reservado: verificado, `crm_presupuesto.json` no tiene ninguno.

**Files:**
- Create: `.../mbcrm/doctype/crm_factura_item/{__init__.py,crm_factura_item.json,crm_factura_item.py}`
- Create: `.../mbcrm/doctype/crm_factura/{__init__.py,crm_factura.json,crm_factura.py}`

**Interfaces:**
- Consumes: `billing.invoice_totals`, `billing.invoice_status`, `billing.outstanding_of` (Task 1);
  `CRM Punto de Venta`, `CRM Emisor` (Task 2).
- Produces: el DocType `CRM Factura` con los campos que consumen Task 5 (PDF), Task 6 (API) y
  Task 13 (UI). **La clase se llama `CRMFactura`** y la del ítem `CRMFacturaItem`.
  Métodos: `calculate_totals()`, `guard_frozen()`, `refresh_status()`, `issue()`, `mark_sent()`,
  `void()`, `mark_uncollectible()`. **No hay `set_interval_months`**: en una factura no hay base de
  tiempo que normalizar (ver Task 1).

- [ ] **Step 1: `CRM Factura Item`**

Molde: `crm_presupuesto_item.json` (child table: `"istable": 1`, `"editable_grid": 1`, sin
`autoname`, `"permissions": []`).

```json
{
  "field_order": ["description", "billing_type", "period_start", "period_end", "qty", "rate", "discount_percentage", "amount", "net_amount", "presupuesto_item"],
  "fields": [
    {"fieldname": "description", "fieldtype": "Small Text", "label": "Descripción", "reqd": 1, "in_list_view": 1},
    {"fieldname": "billing_type", "fieldtype": "Select", "label": "Tipo de cobro", "options": "Único\nMensual\nTrimestral\nAnual", "default": "Único", "in_list_view": 1},
    {"fieldname": "period_start", "fieldtype": "Date", "label": "Período desde"},
    {"fieldname": "period_end", "fieldtype": "Date", "label": "Período hasta"},
    {"fieldname": "qty", "fieldtype": "Float", "label": "Cantidad", "default": "1", "in_list_view": 1},
    {"fieldname": "rate", "fieldtype": "Currency", "label": "Precio unitario", "options": "currency", "in_list_view": 1},
    {"fieldname": "discount_percentage", "fieldtype": "Percent", "label": "Descuento %"},
    {"fieldname": "amount", "fieldtype": "Currency", "label": "Importe", "options": "currency", "read_only": 1},
    {"fieldname": "net_amount", "fieldtype": "Currency", "label": "Importe neto", "options": "currency", "read_only": 1},
    {"fieldname": "presupuesto_item", "fieldtype": "Data", "label": "Ítem del presupuesto", "read_only": 1}
  ],
  "istable": 1,
  "editable_grid": 1,
  "module": "MbCRM",
  "name": "CRM Factura Item"
}
```

`crm_factura_item.py`:
```python
from frappe.model.document import Document


class CRMFacturaItem(Document):
    pass
```

- [ ] **Step 2: `CRM Factura`**

Molde: `crm_presupuesto.json`. Valores que **no** se pueden deducir y hay que copiar tal cual:

```json
{
  "autoname": "naming_series:",
  "field_order": [
    "naming_series", "status", "is_return", "return_against",
    "deal", "organization", "vertical", "presupuesto",
    "sb_fechas", "issue_date", "due_date", "period_start", "period_end",
    "sent_on", "paid_on", "voided_on", "marked_uncollectible_on",
    "sb_cobro", "currency", "iva_mode",
    "sb_items", "items",
    "sb_totales", "subtotal", "discount_total", "iva_amount", "total",
    "credit_total", "paid_amount", "outstanding",
    "sb_fiscal", "comprobante_clase", "comprobante_code", "point_of_sale",
    "fiscal_number", "cae", "cae_due", "fiscal_status", "fiscal_response",
    "sb_condiciones", "conditions", "notes", "snapshot_hash"
  ],
  "fields": [
    {"fieldname": "naming_series", "fieldtype": "Select", "label": "Serie", "options": "F-.YYYY.-.####", "default": "F-.YYYY.-.####", "reqd": 1, "hidden": 1},
    {"fieldname": "status", "fieldtype": "Select", "label": "Estado", "options": "Borrador\nEmitida\nParcial\nPagada\nVencida\nIncobrable\nAnulada", "default": "Borrador", "read_only": 1, "in_list_view": 1, "in_standard_filter": 1},
    {"fieldname": "is_return", "fieldtype": "Check", "label": "Es nota de crédito", "read_only": 1},
    {"fieldname": "return_against", "fieldtype": "Link", "label": "Corrige a", "options": "CRM Factura", "read_only": 1},
    {"fieldname": "deal", "fieldtype": "Link", "label": "Negocio", "options": "CRM Deal", "in_standard_filter": 1},
    {"fieldname": "organization", "fieldtype": "Link", "label": "Organización", "options": "CRM Organization", "reqd": 1, "in_standard_filter": 1},
    {"fieldname": "vertical", "fieldtype": "Link", "label": "Vertical", "options": "CRM Vertical", "in_standard_filter": 1},
    {"fieldname": "presupuesto", "fieldtype": "Link", "label": "Presupuesto", "options": "CRM Presupuesto"},
    {"fieldname": "sb_fechas", "fieldtype": "Section Break", "label": "Fechas"},
    {"fieldname": "issue_date", "fieldtype": "Date", "label": "Fecha de emisión"},
    {"fieldname": "due_date", "fieldtype": "Date", "label": "Vencimiento"},
    {"fieldname": "period_start", "fieldtype": "Date", "label": "Período desde"},
    {"fieldname": "period_end", "fieldtype": "Date", "label": "Período hasta"},
    {"fieldname": "sent_on", "fieldtype": "Datetime", "label": "Enviada el", "read_only": 1},
    {"fieldname": "paid_on", "fieldtype": "Datetime", "label": "Pagada el", "read_only": 1},
    {"fieldname": "voided_on", "fieldtype": "Datetime", "label": "Anulada el", "read_only": 1},
    {"fieldname": "marked_uncollectible_on", "fieldtype": "Datetime", "label": "Incobrable desde", "read_only": 1},
    {"fieldname": "sb_cobro", "fieldtype": "Section Break", "label": "Cobro"},
    {"fieldname": "currency", "fieldtype": "Link", "label": "Moneda", "options": "Currency"},
    {"fieldname": "iva_mode", "fieldtype": "Select", "label": "IVA", "options": "sumar\nincluido\nexento", "default": "sumar", "reqd": 1},
    {"fieldname": "sb_items", "fieldtype": "Section Break", "label": "Ítems"},
    {"fieldname": "items", "fieldtype": "Table", "label": "Ítems", "options": "CRM Factura Item", "reqd": 1},
    {"fieldname": "sb_totales", "fieldtype": "Section Break", "label": "Totales"},
    {"fieldname": "subtotal", "fieldtype": "Currency", "label": "Subtotal", "options": "currency", "read_only": 1},
    {"fieldname": "discount_total", "fieldtype": "Currency", "label": "Descuentos", "options": "currency", "read_only": 1},
    {"fieldname": "iva_amount", "fieldtype": "Currency", "label": "IVA", "options": "currency", "read_only": 1},
    {"fieldname": "total", "fieldtype": "Currency", "label": "Total", "options": "currency", "read_only": 1},
    {"fieldname": "credit_total", "fieldtype": "Currency", "label": "Acreditado", "options": "currency", "read_only": 1},
    {"fieldname": "paid_amount", "fieldtype": "Currency", "label": "Cobrado", "options": "currency", "read_only": 1},
    {"fieldname": "outstanding", "fieldtype": "Currency", "label": "Saldo", "options": "currency", "read_only": 1},
    {"fieldname": "sb_fiscal", "fieldtype": "Section Break", "label": "Fiscal (se completa en F6)", "collapsible": 1},
    {"fieldname": "comprobante_clase", "fieldtype": "Select", "label": "Clase de comprobante", "options": "\nA\nB\nC\nM\nE", "read_only": 1},
    {"fieldname": "comprobante_code", "fieldtype": "Data", "label": "Código AFIP", "read_only": 1, "description": "001 Factura A · 006 B · 011 C · 003/008/013 nota de crédito (RG 4290)"},
    {"fieldname": "point_of_sale", "fieldtype": "Link", "label": "Punto de venta", "options": "CRM Punto de Venta", "read_only": 1},
    {"fieldname": "fiscal_number", "fieldtype": "Data", "label": "Número fiscal", "read_only": 1},
    {"fieldname": "cae", "fieldtype": "Data", "label": "CAE", "read_only": 1},
    {"fieldname": "cae_due", "fieldtype": "Date", "label": "Vencimiento del CAE", "read_only": 1},
    {"fieldname": "fiscal_status", "fieldtype": "Select", "label": "Estado fiscal", "options": "No aplica\nPendiente\nEmitida\nError", "default": "No aplica", "read_only": 1},
    {"fieldname": "fiscal_response", "fieldtype": "Long Text", "label": "Respuesta AFIP", "read_only": 1},
    {"fieldname": "sb_condiciones", "fieldtype": "Section Break", "label": "Condiciones"},
    {"fieldname": "conditions", "fieldtype": "Small Text", "label": "Condiciones"},
    {"fieldname": "notes", "fieldtype": "Text", "label": "Notas"},
    {"fieldname": "snapshot_hash", "fieldtype": "Data", "label": "Hash del contenido emitido", "read_only": 1}
  ],
  "module": "MbCRM",
  "name": "CRM Factura",
  "search_fields": "organization,deal",
  "sort_field": "modified",
  "sort_order": "DESC"
}
```
Permisos: copiar los de `crm_presupuesto.json`.

**`status` es `read_only`**: lo escribe **sólo** `refresh_status()` (Task 4). Si alguien lo puede
editar a mano, la derivación se rompe.

- [ ] **Step 3: El controller**

`crm_factura.py`:
```python
import hashlib
import json

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, now, nowdate

from crm_core import billing

# Estados en los que una factura NO se edita (excepción: `due_date`, que el usuario
# pidió poder ajustar a mano).
FROZEN_STATUSES = ("Emitida", "Parcial", "Pagada", "Vencida", "Incobrable")

DEFAULT_DUE_DAYS = 15


class CRMFactura(Document):
    def validate(self):
        self.calculate_totals()
        self.guard_frozen()
        self.refresh_status()

    # ── Contenido ──────────────────────────────────────────────────────
    # (No hay `set_interval_months` como en el presupuesto: acá `billing_type` es
    # informativo —qué tipo de cargo es— y NO se normaliza a mensual, porque todos los
    # ítems de una factura están en la misma base de tiempo. Ver Task 1.)

    def calculate_totals(self):
        """Los totales SIEMPRE se recalculan: nunca se aceptan de afuera."""
        totals = billing.invoice_totals(
            [
                {
                    "qty": it.qty,
                    "rate": it.rate,
                    "discount_percentage": it.discount_percentage,
                    "billing_type": it.billing_type,
                }
                for it in (self.items or [])
            ],
            iva_mode=self.iva_mode or "sumar",
        )
        for key, value in totals.items():
            setattr(self, key, value)
        for it in self.items or []:
            gross, net = billing.line_amounts(it.qty, it.rate, it.discount_percentage)
            it.amount = gross
            it.net_amount = net

    def guard_frozen(self):
        """Una factura emitida no se edita: se corrige con una nota de crédito.

        Se comparan HUELLAS (valores), no los objetos: comparar listas de Document con
        `!=` compara identidad y da siempre distinto (aprendido en F2).
        """
        if self.is_new():
            return
        before = self.get_doc_before_save()
        if not before or before.status not in FROZEN_STATUSES:
            return
        if self.status == "Borrador":
            frappe.throw("Una factura emitida no vuelve a borrador.")
        antes = (
            billing.items_fingerprint(before.items),
            before.iva_mode,
            before.currency,
            str(before.issue_date or ""),
        )
        ahora = (
            billing.items_fingerprint(self.items),
            self.iva_mode,
            self.currency,
            str(self.issue_date or ""),
        )
        if ahora != antes:
            frappe.throw(
                "Esta factura ya fue emitida y no se puede editar. "
                "Emití una nota de crédito para corregirla."
            )

    # ── Estado derivado ────────────────────────────────────────────────
    def refresh_status(self):
        """El ESTADO lo calcula `billing.invoice_status`. Nunca se setea a mano.

        Se llama en cada save: así, cobrar, acreditar o anular un pago deja el estado
        correcto sin que ningún handler tenga que acordarse de actualizarlo.
        """
        if self.status == "Anulada":
            return
        self.status = billing.invoice_status(
            self.total,
            self.paid_amount,
            self.credit_total,
            self.due_date,
            today=None,
            is_return=bool(self.is_return),
            is_voided=self.status == "Anulada",
            is_uncollectible=self.status == "Incobrable",
        )
        if self.status == "Pagada" and not self.paid_on:
            self.paid_on = now()

    # ── Transiciones (la única vía de cambio de estado) ────────────────
    def _assert_status(self, *allowed):
        if self.status not in allowed:
            frappe.throw(f"No se puede hacer esa acción desde el estado «{self.status}».")

    def issue(self):
        self._assert_status("Borrador")
        if not (self.items or []):
            frappe.throw("La factura no tiene ítems.")
        self.issue_date = self.issue_date or nowdate()
        self.due_date = self.due_date or add_days(self.issue_date, DEFAULT_DUE_DAYS)
        self.status = "Emitida"
        self.snapshot_hash = self._snapshot()
        self.save()

    def mark_sent(self):
        self._assert_status("Emitida", "Parcial", "Vencida")
        self.sent_on = now()
        self.save()

    def void(self):
        self._assert_status("Borrador", "Emitida", "Parcial", "Vencida", "Incobrable")
        if billing.dec(self.paid_amount) > 0 or billing.dec(self.credit_total) > 0:
            frappe.throw(
                "No se puede anular una factura con cobros o créditos aplicados: "
                "liberá los pagos primero."
            )
        self.status = "Anulada"
        self.voided_on = now()
        self.save()

    def mark_uncollectible(self):
        self._assert_status("Emitida", "Parcial", "Vencida")
        self.status = "Incobrable"
        self.marked_uncollectible_on = now()
        self.save()

    def _snapshot(self):
        payload = json.dumps(
            {
                "organization": self.organization,
                "iva_mode": self.iva_mode,
                "currency": self.currency,
                "items": [
                    [it.description, it.billing_type, it.qty, it.rate, it.discount_percentage]
                    for it in (self.items or [])
                ],
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Validación offline**

Run: `cd apps/crm_core && python3 -m pytest tests/test_doctypes_offline.py -v`
Expected: PASS con **2 DocTypes más**. Si el test de Links se queja de `CRM Factura` (usado por
`return_against`), agregalo a `propios`… pero ojo: es el mismo DocType, así que el test ya lo cubre.

- [ ] **Step 5: Commit**

```bash
git add apps/crm_core/crm_core/mbcrm/doctype/crm_factura \
        apps/crm_core/crm_core/mbcrm/doctype/crm_factura_item
git commit -m "feat(facturacion): DocTypes CRM Factura y sus items con estado derivado"
```

---

### Task 4: El PDF de la factura

**Files:**
- Create: `apps/crm_core/crm_core/templates/invoice.html`
- Modify: `apps/crm_core/crm_core/documents.py`
- Modify: `scripts/quote-preview.py` (para poder previsualizar también la factura)

**Interfaces:**
- Consumes: `CRM Factura` (Task 3), `billing.fmt_money` (existente).
- Produces: `documents.invoice_context(factura_name) -> dict` y
  `documents.render_invoice_pdf(factura_name) -> bytes`. Los consume Task 6.

- [ ] **Step 1: El contexto**

En `documents.py`, agregar (reusando `_font_b64`, `_html_to_pdf` y `EMPRESA` que ya existen):

```python
def invoice_context(factura_name):
    """Contexto del PDF de una factura.

    Sin CAE, una factura NO es un comprobante fiscal: el PDF se rotula como documento
    INTERNO. La leyenda "X" + "DOCUMENTO NO VÁLIDO COMO FACTURA" es para presupuestos,
    remitos y recibos (RG 3803/94 art. 9); no se le pone "X" a una factura.
    """
    f = frappe.get_doc("CRM Factura", factura_name)
    items = [it for it in (f.items or []) if (it.description or "").strip()]
    if not items:
        frappe.throw("La factura no tiene ítems cargados.")

    currency = f.currency or "ARS"
    symbol = "US$" if currency == "USD" else "$"

    org_name, org_tax_id = "", ""
    if f.organization:
        org = frappe.db.get_value(
            "CRM Organization", f.organization, ["organization_name"], as_dict=True
        ) or {}
        org_name = org.get("organization_name") or f.organization

    sin_cae = (f.fiscal_status or "No aplica") != "Emitida"

    return {
        "font_b64": _font_b64(),
        "company": EMPRESA,
        "emisor": {
            "razon_social": "Marcos Barbosa Group",
            "cuit": frappe.db.get_single_value("CRM Emisor", "cuit") or "",
            "address": frappe.db.get_single_value("CRM Emisor", "address") or "",
            "cbu_alias": frappe.db.get_single_value("CRM Emisor", "cbu_alias") or "",
        },
        "invoice_no": f.name,
        "issue_date": getdate(f.issue_date).strftime("%d/%m/%Y") if f.issue_date else "",
        "due_date": getdate(f.due_date).strftime("%d/%m/%Y") if f.due_date else "",
        "period": _period_label(f),
        "currency": currency,
        "client": {"company": org_name or "Cliente", "tax_id": org_tax_id},
        "items": [
            {
                "description": it.description,
                "qty_fmt": f"{flt(it.qty):g}",
                "rate_fmt": billing.fmt_money(it.rate, ""),
                "discount_fmt": f"{flt(it.discount_percentage):g}%" if it.discount_percentage else "—",
                "net_fmt": billing.fmt_money(it.net_amount, ""),
                "billing_label": it.billing_type if it.billing_type != "Único" else "",
            }
            for it in items
        ],
        "tot": {
            "subtotal": billing.fmt_money(f.subtotal, symbol),
            "discount": billing.fmt_money(f.discount_total, symbol),
            "has_discount": flt(f.discount_total) > 0.005,
            "iva": billing.fmt_money(f.iva_amount, symbol),
            "show_iva": (f.iva_mode or "sumar") != "exento",
            "total": billing.fmt_money(f.total, symbol),
            "paid": billing.fmt_money(f.paid_amount, symbol),
            "credit": billing.fmt_money(f.credit_total, symbol),
            "outstanding": billing.fmt_money(f.outstanding, symbol),
            "show_balance": flt(f.outstanding) > 0.005 and flt(f.paid_amount) > 0,
        },
        "sin_cae": sin_cae,
        "conditions": f.conditions or "",
        "notes": f.notes or "",
        "status": f.status,
    }


def _period_label(f):
    if f.period_start and f.period_end:
        return f"{getdate(f.period_start).strftime('%d/%m/%Y')} al {getdate(f.period_end).strftime('%d/%m/%Y')}"
    return ""


def render_invoice_pdf(factura_name):
    ctx = invoice_context(factura_name)
    with open(os.path.join(TEMPLATES, "invoice.html"), encoding="utf-8") as fh:
        html = frappe.render_template(fh.read(), ctx)
    return _html_to_pdf(html)
```

- [ ] **Step 2: La plantilla**

`templates/invoice.html`: copiar `quote.html` como base (mismo membrete, misma fuente embebida, mismo
A4) y cambiar: el título a **"Factura"**, el bloque de metadatos (emisión, vencimiento, período), los
datos del cliente con **CUIT** y condición frente al IVA, y el bloque de totales (uno solo, con
**Cobrado / Saldo** cuando `tot.show_balance`). Agregar:

```html
      {% if sin_cae %}
      <div class="legal-mark">
        <span class="legal-legend">DOCUMENTO NO VÁLIDO COMO FACTURA</span>
      </div>
      {% endif %}
      {% if invoice_no %}<div class="quote-no">N° <b>{{ invoice_no }}</b></div>{% endif %}
```

**Sin la "X"**: una factura no la lleva (corrección de la auditoría). El rótulo es el aviso de que
todavía no es un comprobante fiscal.

- [ ] **Step 3: Verificar la maqueta localmente**

En `scripts/quote-preview.py`, agregar un modo `--factura` que arme el contexto de una factura con
datos de ejemplo y escriba `/tmp/invoice-preview.html`; y en `scripts/quote-shot.mjs` un flag para
apuntar a ese archivo. Verificación:

```bash
python3 scripts/quote-preview.py --factura && node scripts/quote-shot.mjs --factura
```
Expected: **1 página**, con el membrete, la leyenda, el bloque de totales y **Cobrado / Saldo**.
Revisar el PNG a ojo (leerlo como imagen) y ajustar márgenes si algo queda huérfano.

- [ ] **Step 4: Commit**

```bash
git add apps/crm_core/crm_core/templates/invoice.html apps/crm_core/crm_core/documents.py scripts/quote-preview.py scripts/quote-shot.mjs
git commit -m "feat(facturacion): PDF de factura con cobrado/saldo y rotulo de documento interno sin CAE"
```
---

### Task 5: API de facturas + tests de integración

**Files:**
- Modify: `apps/crm_core/crm_core/api.py`
- Create: `apps/crm_core/crm_core/tests/test_factura_api.py`

**Interfaces:**
- Consumes: `CRMFactura` (Task 3), `documents` (Task 4), `billing.invoice_status` (Task 1).
- Produces: `create_invoice_from_quote(presupuesto)`, `create_invoice(organization, items, …)`,
  `issue_invoice(name)`, `void_invoice(name)`, `mark_invoice_uncollectible(name)`,
  `get_invoices(filtros)`, `get_invoice(name)`, `invoice_pdf(name)`. Los consumen Task 9 y 10.

- [ ] **Step 1: Endpoints**

En `api.py`, agregar:

```python
def _invoice_or_throw(name):
    if not frappe.db.exists("CRM Factura", name):
        frappe.throw("La factura no existe.")
    return frappe.get_doc("CRM Factura", name)


def _invoice_dto(f):
    return {
        "name": f.name,
        "status": f.status,
        "is_return": bool(f.is_return),
        "return_against": f.return_against or "",
        "organization": f.organization or "",
        "org": frappe.db.get_value("CRM Organization", f.organization, "organization_name") or "",
        "deal": f.deal or "",
        "vertical": f.vertical or "",
        "presupuesto": f.presupuesto or "",
        "issue_date": str(f.issue_date) if f.issue_date else "",
        "due_date": str(f.due_date) if f.due_date else "",
        "period_start": str(f.period_start) if f.period_start else "",
        "period_end": str(f.period_end) if f.period_end else "",
        "currency": f.currency or "",
        "iva_mode": f.iva_mode or "sumar",
        "subtotal": float(f.subtotal or 0),
        "discount_total": float(f.discount_total or 0),
        "iva_amount": float(f.iva_amount or 0),
        "total": float(f.total or 0),
        "credit_total": float(f.credit_total or 0),
        "paid_amount": float(f.paid_amount or 0),
        "outstanding": float(f.outstanding or 0),
        "fiscal_status": f.fiscal_status or "No aplica",
        "sin_cae": (f.fiscal_status or "No aplica") != "Emitida",
        "conditions": f.conditions or "",
        "items": [
            {
                "description": it.description,
                "billing_type": it.billing_type,
                "qty": it.qty,
                "rate": it.rate,
                "discount_percentage": it.discount_percentage,
                "net_amount": it.net_amount,
                "period_start": str(it.period_start) if it.period_start else "",
                "period_end": str(it.period_end) if it.period_end else "",
            }
            for it in (f.items or [])
        ],
        # Derivado, para que la UI no lo invente (mismo criterio que `is_editable` en F2)
        "dias_para_vencer": _dias_para_vencer(f),
        "is_editable": f.status == "Borrador",
    }


def _dias_para_vencer(f):
    """Días al vencimiento (negativo si ya venció). La UI no calcula fechas."""
    from frappe.utils import date_diff, nowdate

    if not f.due_date or f.status in ("Pagada", "Anulada"):
        return None
    return date_diff(f.due_date, nowdate())


@frappe.whitelist()
def create_invoice_from_quote(presupuesto, issue_date=None, due_date=None):
    """Emite una factura desde un presupuesto ACEPTADO. Los ítems se copian tal cual."""
    p = frappe.get_doc("CRM Presupuesto", presupuesto)
    if p.status != "Aceptado":
        frappe.throw("Sólo se puede facturar un presupuesto aceptado.")
    if frappe.db.exists("CRM Factura", {"presupuesto": presupuesto, "is_return": 0, "status": ["!=", "Anulada"]}):
        frappe.throw("Ese presupuesto ya tiene una factura vigente.")

    doc = frappe.new_doc("CRM Factura")
    doc.organization = p.organization
    doc.vertical = p.get("vertical")
    doc.deal = p.deal
    doc.presupuesto = presupuesto
    doc.currency = p.currency
    doc.iva_mode = p.iva_mode
    doc.issue_date = issue_date or None
    doc.due_date = due_date or None
    doc.conditions = p.conditions
    for it in p.items or []:
        doc.append(
            "items",
            {
                "description": it.description,
                "billing_type": it.billing_type,
                "qty": it.qty,
                "rate": it.rate,
                "discount_percentage": it.discount_percentage,
                "presupuesto_item": it.name,
            },
        )
    doc.insert(ignore_permissions=True)  # queda en Borrador
    return _invoice_dto(doc)


@frappe.whitelist()
def create_invoice(organization, items, iva_mode="sumar", currency=None, issue_date=None, due_date=None, deal=None):
    """Factura suelta, sin presupuesto (el spec lo permite y la API no lo tenía)."""
    rows = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    rows = [r for r in rows if str(r.get("description") or "").strip()]
    if not rows:
        frappe.throw("Agregá al menos un ítem a la factura.")

    doc = frappe.new_doc("CRM Factura")
    doc.organization = organization
    doc.deal = deal or None
    doc.currency = currency or frappe.db.get_value("CRM Organization", organization, "currency") or "ARS"
    doc.iva_mode = iva_mode or "sumar"
    doc.issue_date = issue_date or None
    doc.due_date = due_date or None
    for r in rows:
        doc.append(
            "items",
            {
                "description": str(r.get("description")).strip(),
                "billing_type": r.get("billing_type") or "Único",
                "qty": r.get("qty") if r.get("qty") is not None else 1,
                "rate": r.get("rate") if r.get("rate") is not None else 0,
                "discount_percentage": r.get("discount_percentage") if r.get("discount_percentage") is not None else 0,
            },
        )
    doc.insert(ignore_permissions=True)
    return _invoice_dto(doc)


@frappe.whitelist()
def issue_invoice(name):
    doc = _invoice_or_throw(name)
    doc.issue()
    return {"ok": True, "status": doc.status, "name": doc.name}


@frappe.whitelist()
def void_invoice(name):
    doc = _invoice_or_throw(name)
    doc.void()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def mark_invoice_uncollectible(name):
    doc = _invoice_or_throw(name)
    doc.mark_uncollectible()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def get_invoices(status=None, organization=None, solo_impagas=False, limit=100):
    """Lista de facturas. El estado se **computa en lectura** para no mostrar 'Emitida'
    un día de más si el job diario todavía no corrió."""
    filtros = {"is_return": 0}
    if status:
        filtros["status"] = status
    if organization:
        filtros["organization"] = organization
    rows = frappe.get_all(
        "CRM Factura",
        filters=filtros,
        fields=["name"],
        order_by="issue_date desc, name desc",
        limit_page_length=int(limit),
    )
    out = []
    for r in rows:
        dto = _invoice_dto(frappe.get_doc("CRM Factura", r.name))
        if solo_impagas and dto["outstanding"] <= 0:
            continue
        out.append(dto)
    return {"facturas": out}


@frappe.whitelist()
def get_invoice(name):
    return _invoice_dto(_invoice_or_throw(name))


@frappe.whitelist()
def invoice_pdf(name):
    from crm_core.documents import invoice_context, render_invoice_pdf

    doc = _invoice_or_throw(name)
    ctx = invoice_context(name)
    pdf = render_invoice_pdf(name)
    fname = f"{'Nota de credito' if doc.is_return else 'Factura'} {doc.name} - {ctx['client']['company']}.pdf"
    frappe.local.response.filename = re.sub(r'[\\/:*?"<>|]', "-", fname)
    frappe.local.response.filecontent = pdf
    frappe.local.response.type = "download"
```

- [ ] **Step 2: Tests de integración**

`apps/crm_core/crm_core/tests/test_factura_api.py` — `FrappeTestCase`, con helpers que **reusan** la
organización (aprendido en F2: `CRM Organization` se autonombra por nombre y colisiona entre tests):

```python
import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from crm_core import api


class TestFacturaApi(FrappeTestCase):
    def _org(self, nombre="Factura Test Org"):
        if not frappe.db.exists("CRM Organization", nombre):
            frappe.get_doc({"doctype": "CRM Organization", "organization_name": nombre}).insert(
                ignore_permissions=True
            )
        return nombre

    def _factura(self, estado="Emitida", rate=100000):
        org = self._org()
        doc = api.create_invoice(org, [{"description": "Servicio", "qty": 1, "rate": rate}])
        f = frappe.get_doc("CRM Factura", doc["name"])
        if estado != "Borrador":
            f.issue()
        return frappe.get_doc("CRM Factura", doc["name"])

    def test_nace_en_borrador_con_totales_calculados(self):
        d = api.create_invoice(self._org(), [{"description": "x", "qty": 1, "rate": 121000}])
        assert d["status"] == "Borrador"
        assert d["total"] == 121000.0
        assert d["iva_amount"] == 21000.0

    def test_emitir_fija_fechas_y_hash(self):
        f = self._factura("Borrador")
        f.issue()
        assert f.status == "Emitida"
        assert f.issue_date and f.due_date
        assert f.snapshot_hash

    def test_no_se_emite_sin_items(self):
        f = self._factura("Borrador")
        f.items = []
        with self.assertRaises(frappe.ValidationError):
            f.issue()

    def test_no_se_edita_una_emitida(self):
        f = self._factura()
        f.items[0].rate = 999999
        with self.assertRaises(frappe.ValidationError):
            f.save()

    def test_vencida_es_derivada_no_manual(self):
        org = self._org()
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue_date = add_days(nowdate(), -30)
        f.due_date = add_days(nowdate(), -5)
        f.issue()
        assert f.status == "Vencida"
        # y se computa en LECTURA aunque el job no haya corrido
        assert api.get_invoice(f.name)["status"] == "Vencida"

    def test_no_se_anula_con_cobros_aplicados(self):
        f = self._factura()
        f.paid_amount = 1000
        f.save(ignore_permissions=True)   # para simular cobro sin la API de pagos
        with self.assertRaises(frappe.ValidationError):
            f.void()

    def test_facturar_un_presupuesto_aceptado(self):
        # crear presupuesto aceptado y facturarlo
        org = self._org()
        p = frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": None,
                "organization": org,
                "iva_mode": "sumar",
                "items": [{"description": "Consultoría", "qty": 1, "rate": 500000}],
            }
        )
        # `deal` es reqd en el presupuesto: se crea uno
        deal = frappe.get_doc(
            {"doctype": "CRM Deal", "lead_name": "Factura Test", "status": "Qualification", "organization": org}
        ).insert(ignore_permissions=True)
        p.deal = deal.name
        p.insert(ignore_permissions=True)
        p.send()
        p.accept()

        d = api.create_invoice_from_quote(p.name)
        assert d["total"] == 605000.0
        assert d["presupuesto"] == p.name
        assert len(d["items"]) == 1

    def test_no_se_factura_dos_veces_el_mismo_presupuesto(self):
        org = self._org()
        deal = frappe.get_doc(
            {"doctype": "CRM Deal", "lead_name": "Factura Test 2", "status": "Qualification", "organization": org}
        ).insert(ignore_permissions=True)
        p = frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": deal.name,
                "organization": org,
                "iva_mode": "sumar",
                "items": [{"description": "x", "qty": 1, "rate": 1000}],
            }
        ).insert(ignore_permissions=True)
        p.send()
        p.accept()
        api.create_invoice_from_quote(p.name)
        with self.assertRaises(frappe.ValidationError):
            api.create_invoice_from_quote(p.name)

    def test_no_se_factura_un_presupuesto_no_aceptado(self):
        org = self._org()
        deal = frappe.get_doc(
            {"doctype": "CRM Deal", "lead_name": "Factura Test 3", "status": "Qualification", "organization": org}
        ).insert(ignore_permissions=True)
        p = frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": deal.name,
                "organization": org,
                "iva_mode": "sumar",
                "items": [{"description": "x", "qty": 1, "rate": 1000}],
            }
        ).insert(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            api.create_invoice_from_quote(p.name)
```

- [ ] **Step 3: Verificación local + commit**

```bash
python3 -m py_compile apps/crm_core/crm_core/api.py apps/crm_core/crm_core/tests/test_factura_api.py
cd apps/crm_core && python3 -m pytest -q     # los puros siguen verdes
git add apps/crm_core/crm_core/api.py apps/crm_core/crm_core/tests/test_factura_api.py
git commit -m "feat(facturacion): API de facturas y sus tests de integracion"
```
Los de integración los corre el coordinador sobre `crm-test`.

---

### Task 6: `billing.py` — la matemática de cobranza (pura)

**Files:**
- Modify: `apps/crm_core/crm_core/billing.py`
- Modify: `apps/crm_core/tests/test_billing_factura.py`

**Interfaces:**
- Consumes: `dec`, `money`, `outstanding_of` (Task 1).
- Produces:
  - `validar_aplicaciones(pago_amount, aplicaciones) -> None` (levanta `ValueError`)
  - `reparto_fifo(amount, facturas) -> list[tuple[str, Decimal]]`
  - `aging_buckets(facturas, today=None) -> dict[str, Decimal]`
  Los consumen Task 7 (controller), Task 8 (API) y Task 10 (UI).

- [ ] **Step 1: Tests que fallan**

Agregar a `apps/crm_core/tests/test_billing_factura.py`:

```python
from datetime import date

from crm_core.billing import aging_buckets, reparto_fifo, validar_aplicaciones


def factura(name, outstanding, due, org="ORG-1", currency="ARS"):
    return {
        "name": name,
        "outstanding": outstanding,
        "due_date": due,
        "organization": org,
        "currency": currency,
    }


def test_reparto_fifo_aplica_a_lo_mas_viejo_primero():
    fs = [factura("F3", "100", date(2026, 10, 1)), factura("F1", "100", date(2026, 8, 1)),
          factura("F2", "100", date(2026, 9, 1))]
    assert reparto_fifo("250", fs) == [("F1", Decimal("100.00")), ("F2", Decimal("100.00")),
                                       ("F3", Decimal("50.00"))]


def test_reparto_fifo_no_aplica_mas_que_el_saldo_de_cada_factura():
    fs = [factura("F1", "50", date(2026, 8, 1))]
    assert reparto_fifo("200", fs) == [("F1", Decimal("50.00"))]


def test_reparto_fifo_sin_monto_no_aplica_nada():
    assert reparto_fifo("0", [factura("F1", "100", date(2026, 8, 1))]) == []


def test_reparto_fifo_ignora_facturas_sin_saldo():
    fs = [factura("F1", "0", date(2026, 8, 1)), factura("F2", "100", date(2026, 9, 1))]
    assert reparto_fifo("100", fs) == [("F2", Decimal("100.00"))]


def test_aplicaciones_no_pueden_superar_el_pago():
    with pytest.raises(ValueError):
        validar_aplicaciones("100", [("F1", "150")])


def test_aplicaciones_pueden_dejar_saldo_a_cuenta():
    validar_aplicaciones("100", [("F1", "60")])   # no levanta: 40 queda a cuenta


def test_aging_por_tramos():
    hoy = date(2026, 9, 16)
    fs = [
        factura("F1", "100", date(2026, 9, 10)),   # 6 dias -> 0-30
        factura("F2", "200", date(2026, 8, 10)),   # 37 dias -> 31-60
        factura("F3", "300", date(2026, 7, 1)),    # 77 dias -> 61-90
        factura("F4", "400", date(2026, 5, 1)),    # +90
    ]
    b = aging_buckets(fs, hoy)
    assert b["0-30"] == Decimal("100.00")
    assert b["31-60"] == Decimal("200.00")
    assert b["61-90"] == Decimal("300.00")
    assert b["+90"] == Decimal("400.00")


def test_aging_ignora_lo_que_no_vencio():
    hoy = date(2026, 9, 16)
    b = aging_buckets([factura("F1", "100", date(2026, 10, 1))], hoy)
    assert b["0-30"] == Decimal("0.00")
    assert b["corriente"] == Decimal("100.00")
```

- [ ] **Step 2: Correr y ver que fallan** → Run: `cd apps/crm_core && python3 -m pytest tests/test_billing_factura.py -q` → FAIL (ImportError).

- [ ] **Step 3: Implementar**

Agregar a `billing.py`:

```python
# ── Cobranza ───────────────────────────────────────────────────────────

def validar_aplicaciones(pago_amount, aplicaciones) -> None:
    """La suma de las aplicaciones no puede superar el monto del pago.

    Dejar saldo sin aplicar es correcto (queda a cuenta); sobreaplicar es corrupción:
    el mismo peso cobraría dos deudas.
    """
    total = sum((dec(m) for _, m in aplicaciones), Decimal("0"))
    if money(total) > money(pago_amount):
        raise ValueError(
            f"Las aplicaciones ({money(total)}) no pueden superar el monto del pago ({money(pago_amount)})."
        )


def reparto_fifo(amount, facturas) -> list:
    """Reparte un monto entre facturas, de la más vieja a la más nueva.

    FIFO por vencimiento es la práctica contable estándar: evita que la deuda vieja
    quede abierta para siempre mientras se cobra la nueva.

    `facturas` debe venir YA filtrada por organización y moneda (la guarda vive en la
    capa que llama: esta función es pura y no sabe de clientes).
    Devuelve [(nombre_factura, monto_a_aplicar)].
    """
    restante = money(amount)
    aplicaciones = []
    for f in sorted(facturas, key=lambda x: (str(x.get("due_date") or ""), str(x.get("name")))):
        if restante <= 0:
            break
        cupo = outstanding_of(f.get("outstanding"), 0, 0)
        if cupo <= 0:
            continue
        monto = money(min(cupo, restante))
        aplicaciones.append((f["name"], monto))
        restante = money(restante - monto)
    return aplicaciones


AGING_TRAMOS = ("corriente", "0-30", "31-60", "61-90", "+90")


def aging_buckets(facturas, today=None) -> dict:
    """Antigüedad de la deuda, por tramos de días desde el vencimiento.

    Lo que todavía no venció va a `corriente` (no es deuda vencida y sumarlo al tramo
    0-30 infla la mora). Base: NetSuite / QuickBooks.
    """
    hoy = today or datetime.date.today()
    out = {t: Decimal("0") for t in AGING_TRAMOS}
    for f in facturas:
        saldo = outstanding_of(f.get("outstanding"), 0, 0)
        if saldo <= 0:
            continue
        if not f.get("due_date"):
            out["corriente"] += saldo
            continue
        dias = (hoy - f["due_date"]).days
        if dias <= 0:
            tramo = "corriente"
        elif dias <= 30:
            tramo = "0-30"
        elif dias <= 60:
            tramo = "31-60"
        elif dias <= 90:
            tramo = "61-90"
        else:
            tramo = "+90"
        out[tramo] += saldo
    return {k: money(v) for k, v in out.items()}
```
Y `import pytest` en el test (para `pytest.raises`).

- [ ] **Step 4: Verificar** → Run: `cd apps/crm_core && python3 -m pytest -q` → PASS (los previos + 8 nuevos).

- [ ] **Step 5: Commit**

```bash
git add apps/crm_core/crm_core/billing.py apps/crm_core/tests/test_billing_factura.py
git commit -m "feat(cobranzas): reparto FIFO, validacion de aplicaciones y aging (puros)"
```
---

### Task 7: `CRM Pago` + `CRM Pago Aplicacion`, y el punto único de recálculo

**Ésta es la tarea más delicada del plan.** El spec (corregido por la auditoría) exige que
`paid_amount`/`credit_total`/`outstanding` se escriban **en un solo lugar** y que ese lugar **lea** las
aplicaciones — no que reciba números. Si esto queda mal, los saldos mienten y no hay forma de
detectarlo salvo que un cliente reclame.

**Files:**
- Create: `.../mbcrm/doctype/crm_pago_aplicacion/{__init__.py,crm_pago_aplicacion.json,crm_pago_aplicacion.py}`
- Create: `.../mbcrm/doctype/crm_pago/{__init__.py,crm_pago.json,crm_pago.py}`

**Interfaces:**
- Consumes: `billing.validar_aplicaciones`, `billing.outstanding_of`, `billing.reparto_fifo` (Task 6);
  `CRM Factura.refresh_status` (Task 3).
- Produces: `CRMPago` (clase) con `aplicar_a(facturas)`, `void()`, y la función de módulo
  `recalcular_factura(nombre)`. Los consumen Task 8 y 10.

- [ ] **Step 1: `CRM Pago Aplicacion`**

Child table, molde `crm_presupuesto_item.json`. **Sin snapshots** (`invoice_total`,
`outstanding_before`): se desactualizan en cuanto entra una nota de crédito, y un dato que miente es
peor que un dato que falta (ruling del spec §4.4).

```json
{
  "field_order": ["factura", "applied_amount"],
  "fields": [
    {"fieldname": "factura", "fieldtype": "Link", "label": "Factura", "options": "CRM Factura", "reqd": 1, "in_list_view": 1},
    {"fieldname": "applied_amount", "fieldtype": "Currency", "label": "Monto aplicado", "options": "currency", "reqd": 1, "in_list_view": 1}
  ],
  "istable": 1,
  "editable_grid": 1,
  "module": "MbCRM",
  "name": "CRM Pago Aplicacion"
}
```
`crm_pago_aplicacion.py`: clase `CRMPagoAplicacion(Document)` vacía.

- [ ] **Step 2: `CRM Pago`**

```json
{
  "autoname": "naming_series:",
  "field_order": ["naming_series", "status", "kind", "organization", "payment_date", "amount", "applied_amount", "unapplied_amount", "sb_medio", "currency", "method", "reference", "proof", "sb_aplicaciones", "applications", "notes"],
  "fields": [
    {"fieldname": "naming_series", "fieldtype": "Select", "label": "Serie", "options": "C-.YYYY.-.####", "default": "C-.YYYY.-.####", "reqd": 1, "hidden": 1},
    {"fieldname": "status", "fieldtype": "Select", "label": "Estado", "options": "Registrado\nAnulado", "default": "Registrado", "read_only": 1, "in_list_view": 1, "in_standard_filter": 1},
    {"fieldname": "kind", "fieldtype": "Select", "label": "Tipo", "options": "Cobro\nCrédito\nDevolución", "default": "Cobro", "reqd": 1, "in_list_view": 1,
     "description": "Cobro = entró plata · Crédito = excedente de una nota de crédito · Devolución = se le devuelve plata al cliente"},
    {"fieldname": "organization", "fieldtype": "Link", "label": "Organización", "options": "CRM Organization", "reqd": 1, "in_standard_filter": 1},
    {"fieldname": "payment_date", "fieldtype": "Date", "label": "Fecha", "reqd": 1, "default": "Today"},
    {"fieldname": "amount", "fieldtype": "Currency", "label": "Monto", "options": "currency", "reqd": 1},
    {"fieldname": "applied_amount", "fieldtype": "Currency", "label": "Aplicado", "options": "currency", "read_only": 1},
    {"fieldname": "unapplied_amount", "fieldtype": "Currency", "label": "A cuenta", "options": "currency", "read_only": 1},
    {"fieldname": "sb_medio", "fieldtype": "Section Break", "label": "Medio"},
    {"fieldname": "currency", "fieldtype": "Link", "label": "Moneda", "options": "Currency"},
    {"fieldname": "method", "fieldtype": "Select", "label": "Medio", "options": "Transferencia\nEfectivo\nTarjeta\nMercadoPago\nCheque\nOtro"},
    {"fieldname": "reference", "fieldtype": "Data", "label": "Referencia", "description": "Nº de operación o cheque"},
    {"fieldname": "proof", "fieldtype": "Attach", "label": "Comprobante"},
    {"fieldname": "sb_aplicaciones", "fieldtype": "Section Break", "label": "Aplicaciones"},
    {"fieldname": "applications", "fieldtype": "Table", "label": "Aplicaciones", "options": "CRM Pago Aplicacion"},
    {"fieldname": "notes", "fieldtype": "Small Text", "label": "Notas"}
  ],
  "module": "MbCRM",
  "name": "CRM Pago",
  "sort_field": "payment_date",
  "sort_order": "DESC"
}
```
`status` es `read_only`: lo maneja el controller.

- [ ] **Step 3: El controller y el punto único de recálculo**

`crm_pago.py`:
```python
import frappe
from frappe.model.document import Document
from frappe.utils import now

from crm_core import billing


def recalcular_factura(factura_name):
    """ÚNICO lugar que escribe paid_amount / credit_total / outstanding de una factura.

    LEE las aplicaciones de los pagos registrados (no recibe montos): así ningún handler
    puede pasarle un número equivocado, y la única fuente de verdad son las aplicaciones.

    Lo llaman los hooks de CRM Pago, CRM Pago Aplicacion y (en F3.3) la nota de crédito.
    NUNCA se escribe `outstanding` a mano en un endpoint.
    """
    if not factura_name or not frappe.db.exists("CRM Factura", factura_name):
        return
    f = frappe.get_doc("CRM Factura", factura_name)

    pagado = frappe.db.sql(
        """
        select coalesce(sum(a.applied_amount), 0)
        from `tabCRM Pago Aplicacion` a
        join `tabCRM Pago` p on p.name = a.parent
        where a.factura = %s and p.status = 'Registrado' and p.kind = 'Cobro'
        """,
        factura_name,
    )[0][0]

    credito = frappe.db.sql(
        """
        select coalesce(sum(a.applied_amount), 0)
        from `tabCRM Pago Aplicacion` a
        join `tabCRM Pago` p on p.name = a.parent
        where a.factura = %s and p.status = 'Registrado' and p.kind = 'Crédito'
        """,
        factura_name,
    )[0][0]

    f.db_set("paid_amount", billing.money(pagado), update_modified=False)
    f.db_set("credit_total", billing.money(credito), update_modified=False)
    f.db_set(
        "outstanding",
        billing.outstanding_of(f.total, pagado, credito),
        update_modified=False,
    )
    f.reload()
    f.refresh_status()
    f.db_set("status", f.status, update_modified=False)
    f.db_set("paid_on", f.paid_on, update_modified=False)


class CRMPago(Document):
    def validate(self):
        self.validate_aplicaciones()
        self.calculate_derived()

    def validate_aplicaciones(self):
        """Guardas del spec §6: mismas organización y moneda, y no sobreaplicar."""
        facturas = []
        for ap in self.applications or []:
            if not ap.factura:
                continue
            f = frappe.db.get_value(
                "CRM Factura",
                ap.factura,
                ["organization", "currency", "status", "outstanding"],
                as_dict=True,
            )
            if not f:
                frappe.throw(f"La factura {ap.factura} no existe.")
            if f.organization != self.organization:
                frappe.throw("Sólo se puede aplicar un pago a facturas del mismo cliente.")
            if f.currency and self.currency and f.currency != self.currency:
                frappe.throw("Sólo se puede aplicar un pago a facturas de la misma moneda.")
            if f.status == "Anulada":
                frappe.throw(f"La factura {ap.factura} está anulada.")
            if f.status == "Borrador":
                # Una factura en borrador no se cobra: el estado `Borrador` no se deriva
                # (es una decisión explícita del documento), así que cobrarla la dejaría en
                # borrador CON saldo — un estado que miente. Hay que emitirla primero.
                frappe.throw(f"La factura {ap.factura} está en borrador: emitila antes de cobrarla.")
            facturas.append(ap.factura)

        try:
            billing.validar_aplicaciones(
                self.amount, [(a.factura, a.applied_amount) for a in (self.applications or [])]
            )
        except ValueError as e:
            frappe.throw(str(e))

    def calculate_derived(self):
        aplicado = billing.money(
            sum((billing.dec(a.applied_amount) for a in (self.applications or [])), billing.dec(0))
        )
        self.applied_amount = aplicado
        self.unapplied_amount = billing.money(billing.dec(self.amount) - aplicado)

    def on_update(self):
        self.recalcular_todas()

    def after_insert(self):
        self.recalcular_todas()

    def on_trash(self):
        self.recalcular_todas()

    def recalcular_todas(self):
        for ap in self.applications or []:
            recalcular_factura(ap.factura)

    def void(self):
        """Anular un pago deshace sus aplicaciones y las facturas vuelven a su estado."""
        if self.status == "Anulado":
            frappe.throw("Este pago ya está anulado.")
        facturas = [a.factura for a in (self.applications or [])]
        self.status = "Anulado"
        self.set("applications", [])
        self.applied_amount = 0
        self.unapplied_amount = billing.money(self.amount)
        self.save(ignore_permissions=True)
        for f in facturas:
            recalcular_factura(f)
```

**Hooks en `hooks.py`** (la auditoría fue explícita: el recálculo no puede depender de que cada
handler se acuerde):

```python
doc_events = {
    "CRM Pago Aplicacion": {
        "on_update": "crm_core.mbcrm.doctype.crm_pago.crm_pago.recalcular_desde_hijo",
    },
}
```
y en `crm_pago.py`:
```python
def recalcular_desde_hijo(doc, method=None):
    """El hijo no sabe de qué pago cuelga: se recalcula la factura y el padre."""
    if doc.factura:
        recalcular_factura(doc.factura)
```

- [ ] **Step 4: Validación offline + py_compile + commit**

```bash
cd apps/crm_core && python3 -m pytest tests/test_doctypes_offline.py -q && python3 -m py_compile crm_core/mbcrm/doctype/crm_pago/crm_pago.py crm_core/hooks.py
git add apps/crm_core/crm_core/mbcrm/doctype/crm_pago apps/crm_core/crm_core/mbcrm/doctype/crm_pago_aplicacion apps/crm_core/crm_core/hooks.py
git commit -m "feat(cobranzas): CRM Pago con aplicaciones, tipo de movimiento y recalculo en un solo lugar"
```

---

### Task 8: API de cobros + tests de integración

**Files:**
- Modify: `apps/crm_core/crm_core/api.py`
- Create: `apps/crm_core/crm_core/tests/test_pago_api.py`

**Interfaces:**
- Consumes: `CRMPago` (Task 7), `billing.reparto_fifo`/`aging_buckets` (Task 6).
- Produces: `add_payment(organization, amount, applications=None, auto_fifo=False, …)`,
  `propose_fifo(organization, amount)`, `apply_payment(pago, aplicaciones)`,
  `remove_application(pago, factura)`, `void_payment(pago)`, `get_payments(organization=None)`,
  `get_billing_summary()`. Los consumen Task 9 y 10.

- [ ] **Step 1: Endpoints**

```python
def _pago_dto(p):
    return {
        "name": p.name,
        "status": p.status,
        "kind": p.kind,
        "organization": p.organization or "",
        "org": frappe.db.get_value("CRM Organization", p.organization, "organization_name") or "",
        "payment_date": str(p.payment_date) if p.payment_date else "",
        "amount": float(p.amount or 0),
        "applied_amount": float(p.applied_amount or 0),
        "unapplied_amount": float(p.unapplied_amount or 0),
        "currency": p.currency or "",
        "method": p.method or "",
        "reference": p.reference or "",
        "applications": [
            {"factura": a.factura, "applied_amount": float(a.applied_amount or 0)}
            for a in (p.applications or [])
        ],
    }


@frappe.whitelist()
def propose_fifo(organization, amount, currency=None):
    """Propone a qué facturas aplicar un monto (FIFO por vencimiento).

    La UI **muestra** la propuesta y el usuario puede ajustarla: la regla se ve, no es
    magia. Es el "Get Outstanding Invoices" de ERPNext, explícito.
    """
    filtros = {"organization": organization, "is_return": 0, "status": ["not in", ["Anulada", "Pagada"]]}
    if currency:
        filtros["currency"] = currency
    facturas = frappe.get_all(
        "CRM Factura",
        filters=filtros,
        fields=["name", "outstanding", "due_date", "organization", "currency"],
        limit_page_length=0,
    )
    propuesta = billing.reparto_fifo(amount, facturas)
    return {
        "aplicaciones": [{"factura": n, "applied_amount": float(m)} for n, m in propuesta],
        "disponible": [{"factura": f["name"], "outstanding": float(f["outstanding"]), "due_date": str(f["due_date"] or "")} for f in facturas],
    }


@frappe.whitelist()
def add_payment(organization, amount, payment_date=None, method=None, reference=None,
                currency=None, kind="Cobro", applications=None, auto_fifo=False):
    """Registra un cobro. Sin aplicaciones (y sin `auto_fifo`) queda **a cuenta**."""
    aplicaciones = frappe.parse_json(applications) if isinstance(applications, str) else (applications or [])
    if not aplicaciones and auto_fifo and billing.dec(amount) > 0:
        aplicaciones = propose_fifo(organization, amount, currency)["aplicaciones"]

    doc = frappe.new_doc("CRM Pago")
    doc.organization = organization
    doc.amount = amount
    doc.payment_date = payment_date or nowdate()
    doc.method = method
    doc.reference = reference
    doc.kind = kind or "Cobro"
    doc.currency = currency or frappe.db.get_value("CRM Organization", organization, "currency") or "ARS"
    for a in aplicaciones:
        doc.append("applications", {"factura": a.get("factura"), "applied_amount": a.get("applied_amount")})
    doc.insert(ignore_permissions=True)
    return _pago_dto(doc)


@frappe.whitelist()
def apply_payment(pago, aplicaciones):
    """Aplica el saldo A CUENTA de un pago a facturas (deuda emitida después)."""
    doc = frappe.get_doc("CRM Pago", pago)
    if doc.status == "Anulado":
        frappe.throw("Ese pago está anulado.")
    nuevas = frappe.parse_json(aplicaciones) if isinstance(aplicaciones, str) else (aplicaciones or [])
    for a in nuevas:
        doc.append("applications", {"factura": a.get("factura"), "applied_amount": a.get("applied_amount")})
    # `guard_aplicaciones` (Task 7) impide AGREGAR filas a un pago guardado por edicion comun: esa
    # guarda existe para que nadie reescriba historia contable desde el desk. Una aplicacion
    # programatica y auditada (esta API) es la excepcion legitima, y se declara explicitamente.
    doc.flags.aplicaciones_programaticas = True
    doc.save(ignore_permissions=True)
    return _pago_dto(doc)


@frappe.whitelist()
def remove_application(pago, factura):
    """Desasigna UNA aplicación puntual (necesario para anular una factura cobrada)."""
    doc = frappe.get_doc("CRM Pago", pago)
    doc.set("applications", [a for a in (doc.applications or []) if a.factura != factura])
    doc.save(ignore_permissions=True)
    # `on_update` del pago recalcula las aplicaciones que QUEDAN. La factura que se acaba de
    # quitar no está en esa lista: hay que recalcularla aparte, o queda con el saldo viejo
    # (encontrado por la Task 7 al verificar: `recalcular_todas()` sólo mira las actuales).
    from crm_core.mbcrm.doctype.crm_pago.crm_pago import recalcular_factura

    recalcular_factura(factura)
    return _pago_dto(doc)


@frappe.whitelist()
def void_payment(pago):
    doc = frappe.get_doc("CRM Pago", pago)
    doc.void()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def get_payments(organization=None, limit=100):
    filtros = {}
    if organization:
        filtros["organization"] = organization
    rows = frappe.get_all("CRM Pago", filters=filtros, fields=["name"], order_by="payment_date desc", limit_page_length=int(limit))
    return {"pagos": [_pago_dto(frappe.get_doc("CRM Pago", r.name)) for r in rows]}


@frappe.whitelist()
def get_billing_summary():
    """Los números de la cobranza, en un solo llamado. Todo **por moneda** (sin convertir)."""
    facturas = frappe.get_all(
        "CRM Factura",
        filters={"is_return": 0, "status": ["!=", "Anulada"]},
        fields=["name", "outstanding", "due_date", "organization", "currency", "status", "is_return"],
        limit_page_length=0,
    )
    # El saldo que informa la deuda es el DERIVADO, no la columna: la columna es una cache.
    for f in facturas:
        f["outstanding"] = billing.outstanding_of(
            frappe.db.get_value("CRM Factura", f["name"], "total"),
            frappe.db.get_value("CRM Factura", f["name"], "paid_amount"),
            frappe.db.get_value("CRM Factura", f["name"], "credit_total"),
        )
    por_moneda = {}
    for f in facturas:
        m = por_moneda.setdefault(f.currency or "ARS", {"deuda": billing.dec(0), "facturas": []})
        m["deuda"] += billing.dec(f.outstanding)
        m["facturas"].append(f)

    salida = {}
    for moneda, datos in por_moneda.items():
        pendientes = [f for f in datos["facturas"] if billing.dec(f.outstanding) > 0]
        salida[moneda] = {
            "deuda": float(billing.money(datos["deuda"])),
            "aging": {k: float(v) for k, v in billing.aging_buckets(pendientes).items()},
            "sin_cobrar": len(pendientes),
        }
    a_cuenta = frappe.db.sql(
        "select currency, coalesce(sum(unapplied_amount), 0) from `tabCRM Pago` where status='Registrado' group by currency"
    )
    return {
        "por_moneda": salida,
        "a_cuenta": {c or "ARS": float(v) for c, v in a_cuenta},
    }
```

- [ ] **Step 2: Tests de integración**

`test_pago_api.py` — cubre el ciclo completo y **los tres casos que el spec justificó al cambiar el
modelo**:

```python
import frappe
from frappe.tests.utils import FrappeTestCase

from crm_core import api


class TestPagoApi(FrappeTestCase):
    def _org(self, nombre="Pago Test Org"):
        if not frappe.db.exists("CRM Organization", nombre):
            frappe.get_doc({"doctype": "CRM Organization", "organization_name": nombre}).insert(ignore_permissions=True)
        return nombre

    def _factura(self, rate=100000):
        d = api.create_invoice(self._org(), [{"description": "Servicio", "qty": 1, "rate": rate}])
        f = frappe.get_doc("CRM Factura", d["name"])
        f.issue()
        return frappe.get_doc("CRM Factura", d["name"])

    def test_pago_parcial_deja_saldo_y_estado_parcial(self):
        f = self._factura(100000)
        api.add_payment(self._org(), 40000, applications=[{"factura": f.name, "applied_amount": 40000}])
        f.reload()
        assert f.status == "Parcial"
        assert f.paid_amount == 40000.0
        assert f.outstanding == 81000.0   # 121000 - 40000

    def test_pago_total_deja_pagada(self):
        f = self._factura(100000)
        api.add_payment(self._org(), 121000, applications=[{"factura": f.name, "applied_amount": 121000}])
        f.reload()
        assert f.status == "Pagada"
        assert f.outstanding == 0.0

    def test_un_pago_cubre_varias_facturas(self):
        f1 = self._factura(50000)   # 60500
        f2 = self._factura(50000)   # 60500
        api.add_payment(self._org(), 121000, applications=[
            {"factura": f1.name, "applied_amount": 60500},
            {"factura": f2.name, "applied_amount": 60500},
        ])
        f1.reload(); f2.reload()
        assert f1.status == "Pagada" and f2.status == "Pagada"

    def test_anticipo_queda_a_cuenta_y_se_aplica_despues(self):
        """El caso que justifica el modelo: plata ANTES de la factura."""
        p = api.add_payment(self._org(), 50000)   # sin aplicaciones
        assert p["unapplied_amount"] == 50000.0
        f = self._factura(100000)
        api.apply_payment(p["name"], [{"factura": f.name, "applied_amount": 50000}])
        f.reload()
        assert f.paid_amount == 50000.0
        assert f.status == "Parcial"

    def test_no_se_sobreaplica_un_pago(self):
        f = self._factura(100000)
        with self.assertRaises(frappe.ValidationError):
            api.add_payment(self._org(), 1000, applications=[{"factura": f.name, "applied_amount": 5000}])

    def test_no_se_aplica_a_otra_organizacion(self):
        otra = self._org("Otra Org Distinta")
        f = self._factura(100000)
        with self.assertRaises(frappe.ValidationError):
            api.add_payment(otra, 50000, applications=[{"factura": f.name, "applied_amount": 50000}])

    def test_anular_un_pago_devuelve_el_saldo(self):
        f = self._factura(100000)
        p = api.add_payment(self._org(), 121000, applications=[{"factura": f.name, "applied_amount": 121000}])
        f.reload(); assert f.status == "Pagada"
        api.void_payment(p["name"])
        f.reload()
        assert f.status == "Emitida"
        assert f.outstanding == 121000.0

    def test_remove_application_libera_una_factura(self):
        f1 = self._factura(50000)
        f2 = self._factura(50000)
        p = api.add_payment(self._org(), 121000, applications=[
            {"factura": f1.name, "applied_amount": 60500},
            {"factura": f2.name, "applied_amount": 60500},
        ])
        api.remove_application(p["name"], f1.name)
        f1.reload()
        assert f1.outstanding == 60500.0
        assert f1.status == "Emitida"

    def test_no_se_aplica_a_una_factura_en_borrador(self):
        org = self._org()
        d = api.create_invoice(org, [{"description": "x", "qty": 1, "rate": 1000}])  # queda Borrador
        with self.assertRaises(frappe.ValidationError):
            api.add_payment(org, 50000, applications=[{"factura": d["name"], "applied_amount": 1210}])

    def test_no_se_aplica_a_una_factura_anulada(self):
        f = self._factura(100000)
        f.void()
        with self.assertRaises(frappe.ValidationError):
            api.add_payment(self._org(), 50000, applications=[{"factura": f.name, "applied_amount": 50000}])
```

- [ ] **Step 3: Verificación local + commit**

```bash
python3 -m py_compile apps/crm_core/crm_core/api.py apps/crm_core/crm_core/tests/test_pago_api.py
cd apps/crm_core && python3 -m pytest -q
git add apps/crm_core/crm_core/api.py apps/crm_core/crm_core/tests/test_pago_api.py
git commit -m "feat(cobranzas): API de cobros (parciales, multi-factura, anticipos y anulacion)"
```
---

### Task 9: Frontend — la vista Facturación y el detalle de factura

**Referencias investigadas (2026-09-16)** — las que aplican a esta pantalla:
- **Stripe Dashboard**: la lista de facturas muestra **estado, total, saldo y vencimiento** en la
  misma fila, y el estado se lee como píldora de color. La próxima acción se ve.
- **Odoo 19**: `Expiration` / `Payment Terms` en el documento, y el *smart button* con contador.
- **Chargebee**: la sección **"Unbilled Charges"** va **separada** de lo emitido — es el criterio
  para que "Por facturar" no se mezcle con "Facturas".
- **ERPNext**: el saldo (`outstanding`) es una columna de primera clase en la lista.

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx` (nueva vista en el nav)
- Create: `apps/web/src/Billing.tsx`
- Create: `apps/web/src/InvoiceDrawer.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: la API de Task 5 y 8.
- Produces: la vista `Billing` y el `InvoiceDrawer`. Los consume Task 11.

- [ ] **Step 1: Tipos y métodos en `api.ts`**

```ts
export type InvoiceStatus =
  | "Borrador" | "Emitida" | "Parcial" | "Pagada" | "Vencida" | "Incobrable" | "Anulada";

export interface InvoiceDTO {
  name: string;
  status: InvoiceStatus;
  is_return: boolean;
  organization: string;
  org: string;
  deal: string;
  presupuesto: string;
  issue_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  currency: string;
  iva_mode: IvaMode;
  subtotal: number;
  discount_total: number;
  iva_amount: number;
  total: number;
  credit_total: number;
  paid_amount: number;
  outstanding: number;
  sin_cae: boolean;
  conditions: string;
  items: QuoteItemDTO[];
  dias_para_vencer: number | null;
  is_editable: boolean;
}

export interface PaymentDTO {
  name: string;
  status: "Registrado" | "Anulado";
  kind: "Cobro" | "Crédito" | "Devolución";
  organization: string;
  org: string;
  payment_date: string;
  amount: number;
  applied_amount: number;
  unapplied_amount: number;
  currency: string;
  method: string;
  reference: string;
  applications: Array<{ factura: string; applied_amount: number }>;
}
```
(y los métodos: `getInvoices`, `getInvoice`, `createInvoiceFromQuote`, `createInvoice`,
`issueInvoice`, `voidInvoice`, `markInvoiceUncollectible`, `invoicePdf`, `getPayments`,
`addPayment`, `applyPayment`, `removeApplication`, `voidPayment`, `proposeFifo`, `getBillingSummary`.)

- [ ] **Step 2: La vista `Billing.tsx`**

Cuatro tabs: **Por facturar · Facturas · Cobros · (Notas de crédito — F3.3)** (la cuarta se oculta en
F3.1/F3.2 para no mostrar una pestaña vacía).

- **Por facturar**: presupuestos en estado `Aceptado` sin factura vigente. Un botón **"Facturar"**
  por fila y selección múltiple con "Facturar seleccionadas". Cada fila dice **desde cuándo** está
  aceptado (el equivalente al aging, pero del lado comercial).
- **Facturas**: tabla densa con **número · cliente · vertical · emisión · vencimiento · total ·
  saldo · estado**. Filtros por estado y por "sólo con saldo". **El saldo se realza** cuando está
  vencido (`dias_para_vencer < 0`), y `dias_para_vencer` **viene del servidor** (la UI no calcula
  fechas). Export CSV.
- **Cobros**: lista de movimientos con **tipo** (Cobro / Crédito / Devolución), monto, **aplicado** y
  **a cuenta**. El "a cuenta" se muestra siempre, porque es el dato que más confunde.

Reglas de UI: la próxima acción se ve (una factura `Borrador` ofrece **Emitir**; una `Emitida` con
saldo, **Registrar cobro**; una `Pagada`, sólo ver); y **nunca** se ofrece una acción inválida
(no se muestra "Anular" en una factura con cobros: el backend lo rechaza y la UI no debe mentir).

- [ ] **Step 3: El `InvoiceDrawer.tsx`**

Drawer (portal a `body`) con los ítems, los totales, la traza de estados (`issue_date`, `sent_on`...)
y las acciones del ciclo. En el encabezado, la píldora de estado y —cuando `sin_cae`— el aviso
**"Documento interno — no válido como factura"** (la UI tiene que ser honesta sobre lo mismo que el
PDF).

- [ ] **Step 4: typecheck + build + commit**

```bash
cd apps/web && npm run typecheck && npm run build
cd ../.. && git add apps/web/src apps/crm_core/crm_core/www/hoy.html
git commit -m "feat(facturacion): vista Facturacion con lista de facturas y detalle"
```

---

### Task 10: Frontend — el cobro con reparto asistido

**Referencias investigadas** — la pieza que hace la diferencia:
- **ERPNext (`Payment Entry`)**: el botón *Get Outstanding Invoices* **trae las facturas con saldo** y
  deja **ver y ajustar** el reparto, con la columna `Allocated` editable y el `Unallocated` al lado.
- **Stripe**: el pago muestra `amount` / **`amount_applied`** / **`amount_remaining`**, y el crédito a
  favor se ve como saldo disponible del cliente.

**Files:**
- Create: `apps/web/src/PaymentDrawer.tsx`
- Modify: `apps/web/src/Billing.tsx` (abre el drawer), `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `proposeFifo`, `addPayment` (Task 8).
- Produces: el flujo de cobro. Lo consume Task 11.

- [ ] **Step 1: El drawer de cobro**

Flujo, en este orden (es el que evita el error más común, cobrar sin imputar):
1. Se elige el **cliente** y se escribe el **monto**.
2. Al escribir el monto, la UI llama **`proposeFifo`** y muestra **la propuesta**: una lista de
   facturas con el monto sugerido, **editable fila por fila**, y la columna **"a cuenta"** calculada
   en vivo (monto − suma de asignaciones).
3. Si el usuario baja una asignación, **el remanente vuelve a "a cuenta"** (no se pierde ni se
   fuerza a asignarlo).
4. Se elige medio y referencia, y se confirma.

**La propuesta es visible y ajustable, no mágica**: es la traducción a UI del `Get Outstanding
Invoices` de ERPNext, y es lo que hace que el usuario confíe en el reparto FIFO en vez de sospechar.

- [ ] **Step 2: typecheck + build + commit**

```bash
cd apps/web && npm run typecheck && npm run build
cd ../.. && git add apps/web/src apps/crm_core/crm_core/www/hoy.html
git commit -m "feat(cobranzas): drawer de cobro con reparto FIFO propuesto y ajustable"
```

---

### Task 11: Deploy con migrate y verificación en pantalla

**Files:**
- Modify: `scripts/e2e-facturacion.mjs` (nuevo, ver abajo)
- Modify: `docs/runbook-crm-core.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la verificación de F3.1+F3.2.

- [ ] **Step 1: Desplegar con migrate**

**Los DocTypes nuevos no existen en la base hasta el migrate.** Antes de desplegar:

```bash
git log --oneline origin/main..HEAD   # DEBE estar vacío (push antes de deploy)
```

```bash
ssh root@2.28.121.92
cd /opt/crm-marcosbarbosagroup
bash scripts/deploy-crm.sh 63 --migrate
```
Expected: `DEPLOY OK: crm-mb:63`, los 5 servicios en `1/1`, el migrate sin errores y el conteo de
DocTypes de `MbCRM` subiendo de **10 a 16** (los 6 nuevos: Factura, Factura Item, Pago, Pago
Aplicacion, Punto de Venta, Emisor). El script ya hace **backup previo al migrate**.

- [ ] **Step 2: Verificar los DocTypes en producción**

```bash
BE=$(docker ps -qf name=crm_backend.1)
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm.marcosbarbosagroup.com execute frappe.client.get_count --kwargs '{\"doctype\":\"DocType\",\"filters\":{\"module\":\"MbCRM\"}}'"
```
Expected: 16.

- [ ] **Step 3: El E2E en pantalla (obligatorio)**

`scripts/e2e-facturacion.mjs` — mismo molde que los anteriores (crea sus datos, los borra en
`finally`, exit code por fallas). Debe verificar, **en navegador real**:
1. Un presupuesto aceptado aparece en **Por facturar** y se puede **facturar** desde ahí.
2. La factura nace en `Borrador`, se **emite**, y la lista muestra `Emitida` con el **saldo = total**.
3. **Registrar cobro parcial**: la factura pasa a **`Parcial`** con el saldo correcto.
4. **Registrar el resto**: pasa a **`Pagada`** con saldo 0.
5. **Anular el pago**: la factura **vuelve** a `Emitida` con el saldo completo (la reversión se ve).
6. **Un pago a cuenta** (sin imputar) muestra el "a cuenta" en la lista de cobros.
7. El PDF de la factura abre en el visor y dice **"DOCUMENTO NO VÁLIDO COMO FACTURA"**.

Correr **headed** (en headless Chrome no renderiza PDFs):
```bash
TOKEN="<KEY>:<SECRET>" node scripts/e2e-facturacion.mjs
```
Expected: todas las aserciones OK, exit 0. Revisar las capturas a ojo en desktop (1280) y mobile (390).

- [ ] **Step 4: Limpiar y cerrar**

Borrar los datos de prueba (facturas, pagos, presupuesto, negocio y organización del E2E), remover la
API key temporal, borrar los scripts de captura, y actualizar el runbook con: los 6 DocTypes nuevos,
el flag `--migrate`, y **la leyenda legal** (que ahora también está en el presupuesto en producción).

```bash
git add docs/runbook-crm-core.md scripts/e2e-facturacion.mjs
git commit -m "test(facturacion): E2E en pantalla del ciclo facturar-cobrar + runbook"
```

---

## Self-Review

**1. Cobertura del spec (F3.1 + F3.2)**
- §4.1 `CRM Factura` → Task 3. §4.2 `CRM Factura Item` → Task 3. §4.3 `CRM Pago` con `kind` → Task 7.
  §4.4 `CRM Pago Aplicacion` (sin snapshots) → Task 7. §4.5 Punto de Venta y Emisor **sin secretos** →
  Task 2.
- §5.1 estados derivados + transiciones de usuario → Task 1 (`invoice_status`) y Task 3
  (`refresh_status`); la regla "`Pagada` exige `paid_amount > 0`" tiene test explícito en Task 1.
- §5.3 pago (no se edita: se anula) → Task 7 (`void`) y Task 8 (`void_payment`) con test.
- §6 asignación multi-factura, guardas de organización y moneda, FIFO, `remove_application` → Task 6
  (puro, con tests) y Task 7 (las guardas en `validate_aplicaciones`). El **choke point** de
  recálculo → Task 7.
- §7 numeración y preparación fiscal (campos creados por **este** plan, no por F2) → Task 3.
- §8 PDF y leyenda legal (la "X" **sólo** en el presupuesto; la factura sin CAE se rotula como
  documento interno) → Task 2 y Task 4.
- §10 métricas: la Deuda excluye `is_return` y el aging separa lo **corriente** de lo vencido →
  Task 6 (`aging_buckets`) y Task 8 (`get_billing_summary`).
- §11 roles y concurrencia → **no** se implementan en este plan (hay un solo usuario); quedan
  anotados como deuda con el modelo listo. **Declarado, no olvidado.** El caso concreto que la
  revisión de la Task 7 dejó identificado: dos pagos **distintos** aplicados a la **misma factura** en
  simultáneo leen el mismo `outstanding` (TOCTOU) y el exceso se pierde por el clamp a 0; se cierra con
  lock de la **factura** (no sólo del pago) o re-verificando después de escribir.
- **Fuera de este plan y declarado:** F3.3 notas de crédito (`is_return` ya está en el DocType, las
  reglas en §5.2 del spec) y F3.4 informes.

**2. Placeholders:** no hay `TBD`/`TODO`. Las listas de campos van por tabla de valores más referencia
al molde de un DocType existente. Los `<KEY>:<SECRET>` salen del comando de la key temporal.

**3. Consistencia de tipos:** `invoice_totals` devuelve `subtotal`/`discount_total`/`iva_amount`/
`total`, que son exactamente los campos de `CRM Factura` (Task 3) y las claves de `_invoice_dto`
(Task 5). `invoice_status` recibe los mismos tres montos que escribe `recalcular_factura` (Task 7).
`billing.money`/`dec` se usan en toda la cadena. `InvoiceDTO` (Task 9) declara las claves que
`_invoice_dto` devuelve, una por una.

**4. Riesgo residual más alto:** el **punto único de recálculo**. Si algún camino escribe
`paid_amount` sin pasar por `recalcular_factura`, los saldos mienten en silencio. Mitigación: los
hooks `on_update`/`after_insert`/`on_trash`, el test de anulación que verifica que el estado vuelve,
y la nota explícita en el docstring de la función. Es lo primero que debe mirar la revisión de
Task 7.

## Roadmap

- **F3.3** — Notas de crédito: `is_return` + `return_against`, tope doble (`≤ total` legal y
  `≤ outstanding` real), el excedente como `CRM Pago.kind = Crédito`, exclusión de `is_return` en
  todos los agregados, anulación en cascada y `void_credit_note`. **El DocType ya queda preparado en
  este plan** (los campos existen); lo que falta es el flujo y su UI.
- **F3.4** — Informes: dashboard de cobranzas con aging y DSO en pantalla, y export.
- **F4** — Suscripciones: `CRM Suscripcion`, bandeja **Por facturar** de períodos vencidos, job diario.
- **F6** — AFIP: `AfipIssuer`, y el `CAE` que hoy está reservado y vacío.

---

## Hallazgos del pre-flight audit (2026-09-16) — no son parte del alcance, pero afectan la verificación

1. **El conteo de DocTypes que asumía el plan estaba mal.** Decía "15 → 21"; la base tiene **10**
   hoy, así que el objetivo es **16**. El error venía de contar los archivos del app (12) más los 3
   de F2, sin verificar contra la base. Corregido en Task 11. **Lección: los números de verificación
   se miden contra la base, no se deducen de los archivos.**

2. **Dos DocTypes declarados en el app nunca se crean: `GCal Connection` y `GCal Sync State`.**
   El `migrate` lo dice explícitamente: `Orphaned DocType(s) found: GCal Connection, GCal Sync State`.
   La causa es que **sus tablas quedaron de la Fase 0** (la tabla `tabGCal Connection` existe, el
   registro de DocType no), y Frappe **no recrea un DocType cuya tabla ya existe pero cuyo registro
   falta**. Verificado en producción **y** en `crm-test`: el migrate no los crea en ninguno de los dos.
   - **Impacto en F3:** **ninguno** (son DocTypes de un modelo abandonado; el sync de Google Calendar
     real usa un script externo y no los toca). El impacto es de **ruido**: un warning en cada
     migrate y dos tablas muertas.
   - **Opciones (necesita autorización del usuario porque toca la base):**
     (a) **Borrar los 2 archivos JSON** del app y **dropear las 2 tablas huérfanas** — son código
     muerto del mismo modelo abandonado que los 12 DocTypes que la auditoría de F2 ya marcó;
     (b) Dropear sólo las tablas y dejar que el migrate los recree (mantiene dos DocTypes que nadie
     usa, con 0 filas).
   - **Recomendación: (a).** Es coherente con el hallazgo 3 del audit de F2 y elimina el warning.

3. **Los "placeholders" del self-review son falsos positivos** del grep (`TODOS` contiene `TOD`).
   No hay `TBD`/`TODO`/`FIXME` reales en el plan.
