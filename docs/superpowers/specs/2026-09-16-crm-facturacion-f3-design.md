# Spec — Facturación y cobranzas (F3)

**Fecha:** 2026-09-16
**Estado:** propuesto (pendiente de auditoría adversarial)
**Depende de:** F2 cerrada (`CRM Presupuesto` con estados y versiones, `documents.py`, `billing.py`)
**Reemplaza parcialmente a:** `docs/superpowers/specs/2026-09-15-crm-facturacion-a2-design.md` §4.5–4.7, §5.3–5.4

---

## 1. Contexto y objetivo

F2 dejó el presupuesto como documento propio con estados (borrador → enviado → aceptado /
rechazado / vencido) y dos bases de tiempo (inversión inicial y abono). Falta **convertir un
presupuesto aceptado en un cobro**: emitir la factura, registrar lo que entra, saber qué falta
cobrar y cuánto está vencido.

**Objetivo:** cerrar el ciclo **aceptado → factura → cobro → saldo**, con pagos parciales,
cobros que cubren varias facturas, notas de crédito, y la puerta AFIP preparada **de verdad**
(no un campo suelto).

**Éxito =** poder responder en segundos: *¿qué facturé este mes?, ¿qué cobré?, ¿quién me debe y
desde cuándo?, ¿qué pagos no pude asignar todavía?*, sin planillas aparte.

---

## 2. Investigación que fundamenta este spec (2026-09-16)

Cada decisión de acá abajo sale de una fuente verificable, no de una opinión. **Lo que se copia y
lo que no se copia está explícito**, porque saber qué no tomar es parte del criterio.

| Fuente | Qué verifiqué | Decisión que fundamenta |
|---|---|---|
| **Frappe / ERPNext — `Payment Entry`** | Un pago se asigna a **una o varias** facturas con una tabla de referencias (`Type` / `Name` / `Total Amount` / `Outstanding` / **`Allocated`**), y el sobrante queda **`Unallocated`** para aplicar después ("Get Outstanding Invoices") | **Cambia el modelo de F3: `CRM Pago` NO va atado a una factura.** Va a la organización, con una tabla `CRM Pago Aplicacion` (factura + monto asignado). Es el hueco más grande del spec A2 |
| **Frappe / ERPNext — `Sales Invoice`** | Campos `advances`, `payments`, `total_advance`, `outstanding_amount`, `payment_terms_template`, `payment_schedule`; y **anticipos** que se cobran antes de la factura y se asignan después | Anticipos y **plazos en cuotas** son de primera clase, no un extra |
| **Frappe / ERPNext — estados** | `Draft, Unpaid, Overdue, Partly Paid, Paid, Credit Note Issued, Return, Cancelled` | Separa **Unpaid de Overdue** (nuestro "Emitida" + "Vencida" ya lo hacía) y **trata la nota de crédito como estado alcanzable** |
| **Stripe — lifecycle** | `draft → finalize → open → paid \| void \| uncollectible`; **un pago se puede desasignar** (`detach_payment`) y una factura pagada **vuelve a `open`**; `amount_overpaid` se registra en vez de rechazarse | Dos cambios: (1) **deshacer un pago debe estar previsto** (anular, no editar); (2) **el sobrepago no se rechaza sin más** — se registra como crédito a favor |
| **Stripe — notas de crédito** | `Credit note` reduce una factura **finalizada** sin anularla; sirve para `open`, `paid` o `uncollectible` | **Entran en F3** (el spec A2 las había dejado afuera). Es la única forma limpia de corregir una factura ya emitida |
| **Stripe — timestamps de transición** | `finalized_at`, `paid_at`, `voided_at`, `marked_uncollectible_at` | Cada transición deja **su** marca temporal, no una sola fecha |
| **ARCA/AFIP — situaciones especiales** (fuente oficial) | *"Las notas de pedido, órdenes de trabajo, **presupuestos** y/o documentos de análogas características se identificarán con la letra **"X"** y con la leyenda **"DOCUMENTO NO VÁLIDO COMO FACTURA"**, ambas ubicadas en forma destacada en el centro del espacio superior"*, y conservarse 2 años | **Nuestro PDF de presupuesto hoy NO la lleva.** Es un requisito concreto y verificable: hay que agregarlo (Task de deuda en F3) |
| **ARCA/AFIP — RG 4290, tipos de comprobante** | Códigos: `001 FACTURA A`, `006 FACTURA B`, `011 FACTURA C`, `003/008/013 NOTA DE CRÉDITO A/B/C`, `051 FACTURA A "OPERACIÓN SUJETA A RETENCIÓN"` | El modelo fiscal guarda **código de comprobante** (no un texto libre) y la **clase** A/B/C |
| **ARCA/AFIP — puntos de venta** | *"Los documentos electrónicos correspondientes a cada punto de venta deberán observar la **correlatividad en su numeración**"*, por punto de venta, por clase y por tipo | La numeración interna **no puede** ser la fiscal: la fiscal es correlativa sin huecos por punto de venta y clase. Nuestro `fiscal_number` + `point_of_sale` reservados son correctos, y la serie interna sigue aparte |

### Lo que NO se copia (y por qué)

| Fuente | Qué no tomamos | Motivo |
|---|---|---|
| ERPNext | Contabilidad de doble partida, asientos, `Debit To`, cuentas contables, `Write Off` contable | El objetivo es **control comercial**, no contabilidad. Meter el mayor duplica el proyecto y no lo pidió el negocio |
| ERPNext | `Payment Reconciliation` automática contra banco | Conciliación bancaria está fuera de alcance |
| Stripe | Cobro automático con tarjeta, `PaymentIntent`, dunning con reintentos | No hay pasarela ni SMTP; el cobro es manual (transferencia/efectivo) |
| Stripe | `invoice previews` (factura futura estimada) | Es una función de suscripciones; llega (si llega) con F4 |
| Zuora/Chargebee | Prorrateo, revenue recognition (ASC 606 / IFRS 15), ingreso diferido | Fuera de alcance declarado; se informa **facturado y cobrado**, no devengado |
| AFIP | Emisión fiscal real (CAE, QR, código de barras, `AfipIssuer`) | F6. Acá se **prepara el modelo**, no se emite |

---

## 3. Alcance

### Dentro
- `CRM Factura` + `CRM Factura Item` con estados y **marcas de tiempo por transición**.
- **`CRM Pago` a nivel organización**, con tabla **`CRM Pago Aplicacion`** (un pago → N facturas) y
  manejo de **monto no asignado** (a cuenta).
- **Notas de crédito** con el patrón de ERPNext (`is_return` + `return_against` sobre el mismo
  DocType), que reducen una factura emitida sin anularla.
- **Vencimiento editable a mano** (decisión ya tomada en F2) y **plazos en cuotas** opcionales.
- PDF de factura, y **corrección del PDF de presupuesto** con la leyenda legal de AFIP.
- **Preparación fiscal real**: `comprobante_code`, `comprobante_clase` (A/B/C/M/E), `point_of_sale`,
  `fiscal_number` y `cae`, todos vacíos y documentados, detrás de la interfaz `InvoiceIssuer`.
- Vista **Facturación** (Por facturar / Facturas / Cobros) e informes de **aging** y **DSO**.

### Fuera (explícito)
- Emisión fiscal con CAE (F6) y todo lo que exige el webservice.
- Doble partida, asientos contables, conciliación bancaria, `write off` contable.
- Prorrateo e ingreso diferido.
- Impuestos además de IVA (IIBB, retenciones, percepciones) — **salvo** el campo de clase de
  comprobante y la leyenda de retención, que se preparan.
- Conversión de moneda (se informa **por moneda**, como en F2).
- Pasarela de pago / cobro automático / dunning con reintentos.

---

## 4. Modelo de dominio

```
CRM Organization
  └─ CRM Deal
       └─ CRM Presupuesto (v1, v2…)          ← F2, cerrado
            └─ CRM Factura                    ← NUEVO (se emite desde un presupuesto aceptado,
                 │                                o suelta, sin presupuesto)
                 ├─ CRM Factura Item
                 └─ (return_against / is_return)  ← nota de crédito = misma DocType
  └─ CRM Pago                                 ← NUEVO: a nivel ORGANIZACIÓN, no de factura
       └─ CRM Pago Aplicacion                 ← NUEVO: a qué facturas se aplicó y cuánto

CRM Emisor (single)   ← datos fiscales; en F3 sólo informativo
CRM Punto de Venta    ← NUEVO: la numeración fiscal es por punto de venta y clase
```

### 4.1 CRM Factura
Copia el patrón que ya funcionó en `CRM Presupuesto` (F2), con lo que el estudio sumó:

| Grupo | Campos |
|---|---|
| Identidad | `naming_series` (`F-.YYYY.-.####`), `deal`, `organization`, `vertical`, `presupuesto` |
| Fechas | `issue_date` (reqd), `due_date` (**editable a mano**), `period_start` / `period_end` (para las de suscripción) |
| Transiciones | `sent_on`, `paid_on`, `voided_on`, `marked_uncollectible_on`, `cancelled_on` — **una marca por transición**, como Stripe |
| Cobro | `currency`, `iva_mode` |
| Ítems | `items` → `CRM Factura Item` |
| Totales | `subtotal`, `discount_total`, `iva_amount`, `total`, `paid_amount`, `outstanding`, `overpaid` |
| Estado | `status` (ver §5.3) |
| Nota de crédito | `is_return` (Check), `return_against` (Link), `credit_reason` |
| Fiscal (vacío, preparado) | `comprobante_code` (Data, ej `011`), `comprobante_clase` (Select A/B/C/M/E), `point_of_sale`, `fiscal_number`, `cae`, `cae_due`, `fiscal_status`, `fiscal_response` |
| Integridad | `snapshot_hash` (hash del contenido emitido, mismo criterio que F2) |

**`is_return` en la misma DocType** (patrón ERPNext) en vez de un DocType aparte: una nota de
crédito *es* un comprobante con los mismos campos, signo negativo y una referencia a la factura
que corrige. Un DocType aparte duplicaría todo el modelo y obligaría a duplicar cada informe.

### 4.2 CRM Factura Item
`description`, `qty`, `rate`, `discount_percentage`, `amount`, `net_amount`, `billing_type`
(Único/Mensual/Trimestral/Anual, heredado del ítem del presupuesto), `period_start` / `period_end`
(período cubierto, para las recurrentes), y `presupuesto_item` (trazabilidad línea por línea,
como el `so_detail` / `billed_amt` de ERPNext).

### 4.3 CRM Pago — a nivel organización
**Éste es el cambio de modelo más importante de F3** y sale de ERPNext: un pago **no** pertenece a
una factura.

| Campo | Tipo | Notas |
|---|---|---|
| `naming_series` | Series | `C-.YYYY.-.####` |
| `organization` | Link CRM Organization | **reqd** — el pago es del cliente, no de la factura |
| `payment_date` | Date | reqd |
| `amount` | Currency | reqd — lo que entró |
| `applied_amount` | Currency | **derivado**: suma de las aplicaciones |
| `unapplied_amount` | Currency | **derivado**: `amount − applied_amount` (a cuenta) |
| `currency` | Link Currency | |
| `method` | Select | Transferencia · Efectivo · Tarjeta · MercadoPago · Cheque · Otro |
| `reference` | Data | nº de operación / cheque |
| `proof` | Attach | comprobante |
| `applications` | Table → CRM Pago Aplicacion | a qué facturas se aplicó |
| `status` | Select | Registrado · Anulado |

### 4.4 CRM Pago Aplicacion (child)
`factura` (Link, reqd) · `applied_amount` (Currency, reqd) · `invoice_total` (Currency, read-only) ·
`outstanding_before` (Currency, read-only).

### 4.5 CRM Punto de Venta y CRM Emisor
`CRM Punto de Venta`: `numero` (Int, ej 1 → `0001`), `nombre`, `activo`, y por ahora nada fiscal.
`CRM Emisor`: se crea vacío en F3 con los campos de AFIP (`cuit`, `razon_social`, `iva_condition`,
`afip_cert`, `afip_key`) para que F6 sólo los complete.
---

## 5. Máquinas de estado

### 5.1 Factura

```
Borrador ──emitir──▶ Emitida ──pago total──▶ Pagada
   │                    │  ▲                    │
   │                    │  └──desasignar pago────┘   (Stripe: paid → open al soltar pagos)
   │                    ├──pago parcial──▶ Parcial ──pago total──▶ Pagada
   │                    ├──(job diario) due_date pasada──▶ Vencida ──pago total──▶ Pagada
   │                    ├──marcar incobrable──▶ Incobrable ──▶ Anulada | Pagada
   │                    └──anular──▶ Anulada
   └──anular──▶ Anulada
```

| Estado | Origen permitido | Acciones | Sale a |
|---|---|---|---|
| `Borrador` | — | Editar todo, **Emitir**, Anular | `Emitida`, `Anulada` |
| `Emitida` | `Borrador` | **Enviar**, **Registrar pago**, **Nota de crédito**, Anular, Marcar incobrable | `Parcial`, `Pagada`, `Vencida`, `Anulada`, `Incobrable` |
| `Parcial` | `Emitida`, `Vencida` | Registrar pago, Nota de crédito, Anular | `Pagada`, `Vencida`, `Anulada` |
| `Pagada` | `Emitida`, `Parcial`, `Vencida`, `Incobrable` | **Nota de crédito**, **desasignar un pago** | `Emitida`/`Parcial` (si se suelta el pago) |
| `Vencida` | `Emitida`, `Parcial` (por el job diario) | Registrar pago, Nota de crédito, Anular, Incobrable | `Pagada`, `Anulada` |
| `Incobrable` | `Emitida`, `Vencida` | Nota de crédito, Anular, Marcar pagada | `Pagada`, `Anulada` |
| `Anulada` | `Borrador`, `Emitida`, `Parcial`, `Incobrable` | **ninguna** | — |

**Reglas duras** (todas con test):
1. `Anulada` exige **`paid_amount == 0`**: para anular algo cobrado hay que **desasignar los pagos
   primero**. (F2 tenía esta regla para el presupuesto; acá se hereda `paid_amount`.)
2. `Pagada` requiere `outstanding == 0`.
3. `Emitida`/`Parcial`/`Vencida` con `due_date` pasada ⇒ el **job diario** las pasa a `Vencida`.
4. **Un pago aplicado no se edita ni se borra: se anula** (y sus aplicaciones se deshacen, dejando a
   las facturas recalcular su estado). Es la lección de Stripe (`detach_payment`) y de F2.
5. **Una factura emitida no se edita.** Para corregirla: **nota de crédito**. (Excepción acotada:
   `due_date`, que el usuario pidió editable a mano.)
6. `Incobrable` **no** es "anulada": la deuda sigue existiendo, se dejó de esperar el cobro
   (es el `uncollectible` de Stripe, que existe para el registro de incobrables).

### 5.2 Nota de crédito (mismo DocType, `is_return = 1`)

```
Borrador ──emitir──▶ Emitida   (monto NEGATIVO, return_against = F-2026-0007)
```
- Requiere `return_against` y una factura de origen **emisible** (`Emitida`, `Parcial`, `Pagada`,
  `Vencida`, `Incobrable`) — no se puede acreditar un borrador ni una anulada.
- **Tope**: la suma acreditada contra una factura **no puede superar** su `total` (regla de Stripe
  y de AFIP: una nota de crédito no puede exceder el comprobante que corrige).
- Al emitirse, la factura de origen **recalcula**: `paid_amount` baja (si estaba cobrada) y
  `outstanding` baja. Si la factura tenía pagos, el excedente se convierte en **saldo a favor**.
- **`Credit Note Issued`** no es un estado aparte: la factura de origen lo expone como hecho
  derivado (mismo criterio que "Facturado" en el presupuesto de F2), y se ve como badge.

### 5.3 Pago
```
Registrado → Anulado
```
- `Pago Aplicacion`: la suma de las aplicaciones **no puede superar** `amount` (si no, el pago
  quedaría sobreaplicado contra varias facturas, que es un fraude de datos).
- `applied_amount > amount` ⇒ `throw`. `applied_amount < amount` ⇒ el resto es **a cuenta**
  (`unapplied_amount`), disponible para aplicar después.
- Al **anular** un pago: sus aplicaciones se deshacen y **cada factura afectada recalcula** estado y
  saldo.
- **No se edita un pago registrado**: se anula y se carga de nuevo (igual que F2).

---

## 6. Asignación de pagos (el corazón de F3)

Tres operaciones, todas explícitas en la API para que el frontend no invente reglas:

1. **`add_payment(organization, amount, date, method, applications=[...])`** — registra el pago y lo
   aplica a las facturas indicadas. Si no se indica ninguna, queda **a cuenta**.
2. **`apply_payment(pago, aplicaciones)`** — aplica **saldo a cuenta** a facturas (une el pago con
   deuda emitida después). Es el `Get Outstanding Invoices` de ERPNext.
3. **`void_payment(pago, reason)`** — anula el pago y deshace sus aplicaciones.

**Regla de reparto (una sola vez, en `billing.py`, pura y testeable):**
```
aplicado = 0
for f in facturas_por_vencimiento_asc:
    cupo = f.outstanding
    monto = min(cupo, amount - aplicado)
    aplicado += monto
    yield (f, monto)
```
Se aplica **primero a lo más viejo** (FIFO por vencimiento), que es la práctica contable estándar y
lo que evita que la deuda vieja quede abierta para siempre. El usuario puede **sobreescribir** el
reparto a mano si quiere imputar distinto.

**`outstanding` de una factura** = `total − paid_amount − credit_notes_total`. Se mantiene
**denormalizado** y se recalcula en un solo lugar (`billing.recalculate_invoice`), nunca a mano en
varios handlers — la lección de `has_quote` en F2, donde un campo derivado quedó desactualizado en
silencio.

---

## 7. Numeración y preparación AFIP

- Serie **interna** por año: `F-.YYYY.-.####`, independiente de la fiscal. La UI muestra ambas.
- La **fiscal** es correlativa **sin huecos, por punto de venta, por clase y por tipo**
  (RG 4290, verificado). Por eso:
  - `fiscal_number` y `point_of_sale` existen **vacíos** desde el día 1 (ya reservados en F2 para el
    presupuesto, acá se completan para la factura).
  - El punto de venta es un DocType (`CRM Punto de Venta`), no un número suelto.
- `comprobante_code` guarda el **código AFIP** (`011` = Factura C), no un texto libre; y
  `comprobante_clase` la letra. La clase depende de la condición frente al IVA del emisor **y** del
  receptor, así que se guarda en el documento, no se deriva al imprimir.
- La emisión queda detrás de `InvoiceIssuer` (contrato: `issue(factura) -> {cae, cae_due,
  fiscal_number, raw}`). Hoy `InternalIssuer` no hace nada. `AfipIssuer` es F6.
- **`fiscal_status`**: `No aplica` · `Pendiente` · `Emitida` · `Error`. Hoy siempre `No aplica`.

---

## 8. Documentos (PDF)

### 8.1 Factura
Reusa `documents.py` (mismo membrete, Outfit embebida, Chromium headless, A4) y agrega:
- Número interno **y** el bloque fiscal (punto de venta, comprobante, CAE) cuando exista.
- Período cubierto cuando es de suscripción y **vencimiento**.
- **Datos del cliente**: razón social, CUIT/DNI, condición frente al IVA, dirección.
- IVA discriminado, subtotal, descuentos, total, y **cobrado / saldo** si está parcialmente paga.
- Bloque de **condiciones y datos de pago** (CBU/alias) — placeholder hasta que el usuario los pase.

### 8.2 Leyenda legal en los documentos NO fiscales (nuevo, sale de la investigación)

**Auditoría contra ARCA/AFIP:** los presupuestos y los recibos deben identificarse con la letra
**"X"** y la leyenda **"DOCUMENTO NO VÁLIDO COMO FACTURA"**, destacadas arriba al centro. Nuestro
PDF de presupuesto (F1/F2) **no la lleva**: es un incumplimiento concreto.

- **Presupuesto**: agregar la "X" y la leyenda. (Task de corrección en F3, es una línea de plantilla.)
- **Factura mientras no haya CAE**: la leyenda correcta en ese caso es **"DOCUMENTO NO VÁLIDO COMO
  FACTURA"** también, porque una factura sin CAE no es un comprobante fiscal. Se muestra mientras
  `fiscal_status = No aplica`; al integrar AFIP se reemplaza por el bloque fiscal.
- **Recibo de pago** (si se imprime comprobante de cobro): misma leyenda.

Esto convierte un "detalle de diseño" en un requisito verificable contra una fuente oficial.
---

## 9. Pantallas (UI)

Se mantiene el lenguaje de F1/F2 (dark, Outfit, `#fe4100`, hairlines, drawer con portal a `body`,
números tabulares, íconos SVG propios, estados completos, vacío que enseña).

### 9.1 Negocio (drawer) — pasa a 5 pestañas
`Detalle · Presupuesto · Facturas · Cobros · Actividad`
- **Facturas**: cadena del negocio con estado, total, saldo y acceso al PDF.
- **Cobros**: pagos de la organización, con su aplicación (a qué facturas y cuánto) y el saldo **a
  cuenta** visible. Es el patrón que surge de ERPNext: el pago se ve **desde el cliente**, no desde
  la factura.

### 9.2 Facturación (vista nueva)
- Tabs: **Por facturar** · **Facturas** · **Cobros** · **Notas de crédito**.
- **Por facturar**: presupuestos **Aceptados** sin factura, y suscripciones cuyo período venció
  (F4). Agrupable por cliente, selección múltiple, "Facturar seleccionadas" (el *billing run*).
- **Facturas**: tabla densa (número, cliente, vertical, período, total, saldo, estado, vencimiento)
  con filtros y orden. **Aging** como columna/realce visual: 0–30 / 31–60 / 61–90 / +90.
- **Cobros**: alta de pago con **imputación asistida** — se elige el cliente, se escribe el monto y
  el sistema **propone el reparto FIFO** por vencimiento, que el usuario puede ajustar (el "Get
  Outstanding Invoices" de ERPNext, con la regla visible en vez de mágica).
- Detalle de factura: drawer con ítems, pagos aplicados, notas de crédito, saldo y acciones
  (**Emitir · Enviar · Registrar pago · Nota de crédito · Anular · Marcar incobrable · Ver PDF**).

### 9.3 Reglas de UI que salen de la investigación
- **La próxima acción se ve**: el primario del pie cambia según el estado (como en F2 y como hace
  Stripe al hacer explícito *finalize* → *send* → *pay*).
- **Deshacer es una acción, no una edición**: "Anular pago" (no editar el pago), y tras anular, las
  facturas vuelven a su estado correcto — el usuario tiene que **ver** ese recálculo.
- **El saldo a favor se muestra siempre** (a cuenta), porque es el caso que más confunde y el que
  Stripe/ERPNext hacen visible en vez de esconder.
- **La nota de crédito nunca se ofrece sobre un borrador** (no tiene sentido acreditar algo no
  emitido): la UI la esconde, no la deshabilita y deja que el backend falle.

---

## 10. Métricas (definiciones exactas)

Heredan las de F2 (§10 del spec A2) y agregan las de facturación:

| Métrica | Fórmula |
|---|---|
| **Facturado del período** | Σ `total` de facturas emitidas (no anuladas, no notas de crédito) con `issue_date` en el período |
| **Acreditado del período** | Σ `total` (absoluto) de notas de crédito emitidas en el período |
| **Neto facturado** | Facturado − Acreditado |
| **Cobrado del período** | Σ `applied_amount` de pagos `Registrado` con `payment_date` en el período |
| **A cuenta** | Σ `unapplied_amount` de pagos registrados (plata recibida sin imputar) |
| **Deuda (AR)** | Σ `outstanding` de facturas no anuladas |
| **Aging** | Tramos por días desde `due_date`: 0–30 / 31–60 / 61–90 / +90 |
| **DSO** | (Deuda / facturado de los últimos 90 días) × 90 |
| **Incobrable** | Σ `outstanding` de facturas en estado `Incobrable` |
| **Tasa de cobro** | Cobrado / Neto facturado del período |

**Moneda:** se informa **por moneda**, sin convertir (misma decisión que F2). Un total que mezcla
ARS y USD sin tipo de cambio es un número que no cierra contra la realidad.

---

## 11. Arquitectura técnica

- `billing.py` suma las funciones **puras** de F3 (testeables sin sitio):
  `reparto_fifo(amount, facturas) -> [(factura, monto)]`, `invoice_totals(...)`,
  `invoice_status(total, paid, credit, due_date, today) -> str`, `aging_buckets(facturas, today)`.
  **Regla:** toda la matemática de cobranza vive acá; los controllers y la API sólo la invocan.
- `mbcrm/doctype/{crm_factura, crm_factura_item, crm_pago, crm_pago_aplicacion, crm_punto_de_venta, crm_emisor}/`
- `documents.py` suma `invoice_context` / `render_invoice_pdf` y **corrige** `quote.html` con la
  leyenda legal.
- `tasks.py` (job diario): vencimientos de facturas (`Emitida`/`Parcial` → `Vencida`).
- `issuers.py`: `InternalIssuer` hoy; `AfipIssuer` en F6.
- API nueva: `get_billing_summary`, `get_invoices`, `get_invoice`, `create_invoice_from_quote`,
  `issue_invoice`, `void_invoice`, `mark_uncollectible`, `add_credit_note`, `add_payment`,
  `apply_payment`, `void_payment`, `invoice_pdf`.
- Índices: `CRM Factura(status, due_date)`, `CRM Factura(organization, issue_date)`,
  `CRM Pago(organization, payment_date)`, `CRM Pago Aplicacion(factura)`.

---

## 12. Fases de entrega

| Fase | Contenido | Resultado visible |
|---|---|---|
| **F3.1** | `CRM Factura` + ítems + estados + PDF + leyenda legal + emitir desde presupuesto aceptado | Facturar un presupuesto y ver la factura |
| **F3.2** | `CRM Pago` + aplicaciones + reparto FIFO + a cuenta + aging | Cobrar (parcial, total, varias facturas de una) |
| **F3.3** | Notas de crédito + incobrable + reversión de pagos | Corregir una factura emitida sin borrarla |
| **F3.4** | Vista Facturación + dashboard de cobranzas + informes | Los números de la cobranza |

Cada fase se despliega y se verifica en pantalla por separado.

---

## 13. Decisiones abiertas (para el usuario)

1. **¿La nota de crédito entra en F3 o se difiere?** El spec A2 las había dejado afuera; la
   investigación muestra que el mercado las trata como núcleo y AFIP las exige para revertir una
   factura. **Propuesta: entran, en F3.3.** (Si se difieren, "Anular" queda como única salida y una
   factura cobrada no se puede corregir.)
2. **¿Sobrepago se acepta como saldo a favor o se rechaza?** F2 rechazaba un pago mayor al saldo.
   Stripe lo registra en `amount_overpaid` y ERPNext lo deja `Unallocated`. **Propuesta: se acepta y
   queda a cuenta** (es plata que entró de verdad; rechazarla obliga a cargarla mal).
3. **¿Se manejan plazos en cuotas** (50% anticipo, saldo a 30 días) en F3, o una factura = un
   vencimiento? **Propuesta: una factura = un vencimiento** en F3.1–F3.2; las cuotas se evalúan
   después (ERPNext tiene `payment_schedule`, pero agrega una tabla y un motor de fechas que no
   pediste).
4. **¿Datos fiscales y de pago reales** (CUIT, condición IVA, CBU/alias, dirección) para el PDF? Hoy
   van como placeholder.
5. **¿Punto de venta real?** Si vas a emitir fiscalmente, hay que dar de alta el punto de venta en
   AFIP; mientras tanto el DocType queda con un registro informativo.

---

## 14. Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo de pagos multi-factura es más complejo que "pago → factura" | La matemática vive en `billing.py` pura, con tests; el reparto FIFO es UNA función |
| Campos derivados desactualizados (`outstanding`, `paid_amount`) | Recalculo en **un solo lugar** (`recalculate_invoice`), con test que lo fija. La lección de `has_quote` |
| Nota de crédito con signo negativo rompe informes | Los informes **excluyen** `is_return` del facturado y lo muestran como acreditado, explícitamente |
| La leyenda legal cambia el PDF ya validado en F2 | Cambio de una línea en la plantilla + verificación con el harness de preview |
| Migración: `CRM Presupuesto` ya está en producción con datos | F3 sólo **agrega** DocTypes; ninguna migración destructiva |
