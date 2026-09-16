# Spec — Facturación, suscripciones e informes (A2)

**Fecha:** 2026-09-15
**Estado:** propuesto
**Depende de:** `crm_core` (app Frappe v15), UI React en `apps/web`, imagen `crm-mb:55`

---

## 1. Contexto y objetivo

Hoy el CRM cubre el frente comercial: contactos, agenda, embudo y un presupuesto
que vive **dentro** del negocio (`CRM Deal.products`) y se emite en PDF.

Falta todo lo que pasa **después** de que el cliente dice sí: si el presupuesto se
aceptó o se rechazó, qué se facturó, qué se cobró, qué está vencido, cuánto entra
por mes por abonos, y cómo se ve eso en números.

**Objetivo:** cerrar el ciclo **presupuesto → aceptación → factura → cobro →
informes**, con soporte para cobros únicos y recurrentes en el mismo presupuesto,
y con la puerta abierta para emitir comprobantes fiscales (AFIP/ARCA) sin rehacer
el modelo.

**Éxito =** poder responder en segundos, sin planillas aparte:
- ¿Qué presupuestos están sin responder y hace cuánto?
- ¿Cuánto facturé este mes y cuánto cobré?
- ¿Cuánto me deben y qué está vencido?
- ¿Cuánto entra por mes por suscripciones (MRR) y cuánto es ingreso único?
- ¿Qué suscripciones se renuevan en los próximos 30 días?

---

## 2. Alcance

### Dentro
- Presupuesto como documento propio, **versionado** y con estados.
- Ítems con **tipo de cobro**: único, mensual, trimestral, anual.
- Factura interna (no fiscal) con numeración propia, pagos parciales y estados.
- Suscripciones derivadas de presupuestos aceptados, con bandeja **Por facturar**.
- Visor previo del PDF antes de descargar/enviar.
- Dashboard e informes con métricas definidas.
- Etiqueta de **vertical** por negocio, para informar sin multiplicar razones sociales.

### Fuera (explícito, para no inflar)
- Emisión fiscal AFIP/ARCA con CAE (se **prepara la interfaz**, no se implementa).
- Varias razones sociales / emisores simultáneos (se deja el DocType `CRM Emisor`).
- Notas de crédito y débito.
- Impuestos además de IVA (IIBB, retenciones, percepciones).
- Conversión de moneda / tipo de cambio contable (se informa **por moneda**).
- Prorrateo por cancelación a mitad de período (se alinea al fin de período).
- Revenue recognition formal (ASC 606 / IFRS 15). Se informa **facturado y cobrado**;
  el ingreso diferido queda como línea futura.
- Conciliación bancaria automática, firma electrónica, portal del cliente.

---

## 3. Patrones de referencia

No son adornos: cada uno fija una decisión.

| Referencia | Qué tomamos | Dónde impacta |
|---|---|---|
| **Quote-to-Cash** (SAP, NetSuite, Oracle) | El ciclo como una cadena de documentos trazable, no como pantallas sueltas | §4 modelo, §9 pantallas |
| **Document flow / Belegfluss** (SAP) | Desde un negocio se navega la cadena completa: presupuesto → suscripción → factura → pago | §9 pestañas del negocio |
| **Salesforce CPQ** | Versiones de presupuesto y **congelamiento al enviar**: para cambiar, se emite una versión nueva (auditoría) | §4.2, §5.1 |
| **Stripe Billing** | Separación `Subscription` / `Invoice` / `Invoice Line` / `Payment`; estados de factura `draft → open → paid \| void \| uncollectible` | §4.3–4.6, §5.3 |
| **Zuora / Chargebee** | *Billing run*: el sistema arma el lote de cargos del período y una persona lo aprueba. Y **MRR/ARR** como métrica central de recurrencia | §6.3, §10 |
| **NetSuite / QuickBooks** | *AR aging* por tramos y **DSO** para medir cobranza | §10.2 |
| **ASC 606 / IFRS 15** | Nombrar el problema del ingreso diferido sin resolverlo en v1 | §2 fuera de alcance |
| **Linear / Stripe Dashboard** | Lenguaje visual: densidad, números tabulares, cero *chartjunk* | §9, §10.4 |

---

## 4. Modelo de dominio

DocTypes nuevos en `crm_core`, módulo `MbCRM`, siguiendo el patrón existente
(`crm_core/mbcrm/doctype/<nombre>/`). Todos linkean al negocio y a la organización.

```
CRM Organization
  └─ CRM Deal (la oportunidad comercial)
       ├─ CRM Presupuesto  (v1, v2, v3…)  ── PDF
       │    └─ CRM Presupuesto Item  (billing_type: Único|Mensual|Trimestral|Anual)
       │         └─ al aceptar → CRM Suscripcion  (por cada ítem recurrente)
       ├─ CRM Factura   (única, de suscripción o mixta)
       │    ├─ CRM Factura Item
       │    └─ CRM Pago  (uno o varios, parciales)
       └─ vertical (Link CRM Vertical)

CRM Emisor (single)      ← datos fiscales, hoy informativo; mañana certificado AFIP
```

### 4.1 CRM Vertical
DocType simple: `name`, `nombre`, `activo`, `color`, `orden`, `email_contacto`.
Seed con las 7 del sitio: Consultora Estratégica, Cuerpo de Cristo, Servicios,
Software y Aplicaciones, Legendarios, Los 1000 Socios, Formate con Nosotros.

**Por qué Link y no Select:** permite agregar metadatos por vertical (color para
el dashboard, casilla de contacto, orden en los informes) sin migrar el campo.
Es el patrón de "dimensión" de los ERP: la vertical es una **dimensión analítica**.

### 4.2 CRM Presupuesto
| Campo | Tipo | Notas |
|---|---|---|
| `naming_series` | Series | `P-.YYYY.-.####` |
| `deal` | Link CRM Deal | reqd |
| `organization` | Link CRM Organization | reqd (denormalizado para informar) |
| `vertical` | Link CRM Vertical | copiada del negocio |
| `version` | Int | 1, 2, 3… por negocio |
| `is_current` | Check | solo una versión vigente por negocio |
| `status` | Select | Borrador · Enviado · Aceptado · Rechazado · Vencido · Anulado |
| `currency` | Link Currency | ARS / USD |
| `iva_mode` | Select | Sumar · Incluido · Exento |
| `valid_until` | Date | emisión + 15 días (configurable) |
| `sent_on` / `accepted_on` / `rejected_on` | Datetime | trazas del ciclo |
| `rejected_reason` | Small Text | |
| `items` | Table → CRM Presupuesto Item | reqd, ≥1 |
| `total_one_time` | Currency | Σ ítems `Único`, **neto** |
| `total_one_time_iva` | Currency | IVA según `iva_mode` sobre el anterior |
| `total_one_time_gross` | Currency | **Inversión inicial** (lo que ve el cliente) |
| `total_recurring_monthly` | Currency | Σ (`net` / `interval_months`), **neto**. Es el único agregado comparable entre intervalos distintos |
| `total_recurring_monthly_iva` / `total_recurring_monthly_gross` | Currency | IVA y total del abono mensual equivalente |
| `recurring_summary` | Small Text | derivado, **solo para mostrar**: agrupa por intervalo — "Mensual $210.000 · Anual $1.200.000" |
| `discount_total` | Currency | neto |
| `conditions` | Small Text | validez, forma de pago, plazo |
| `notes` | Text | |
| `snapshot_hash` | Data | SHA-256 del contenido comercial al enviar (§8.3) |
| `emisor` | Link CRM Emisor | default |

**Un presupuesto tiene DOS totales, no uno.** Sumar una inversión inicial con un
abono mensual es sumar peras con manzanas: no significan lo mismo. Por eso no hay
`grand_total`, y el `recurring_summary` **nunca** suma intervalos distintos (un
mensual y un anual se muestran por separado). Esto es exactamente lo que pide el
negocio: *"si es suscripción el precio es por mes, si es servicio es precio fijo"*.

**Neto vs IVA (regla única):** todos los subtotales son **netos**; el IVA se calcula
según `iva_mode` sobre el neto y se expone en las columnas `_iva` y `_gross`. El
cliente ve los `_gross`; los informes usan los netos y el IVA por separado.

**Inmutabilidad:** al pasar a *Enviado* el documento se **congela** (ver §5.1).

### 4.3 CRM Presupuesto Item
| Campo | Tipo | Notas |
|---|---|---|
| `description` | Data/Small Text | reqd |
| `qty` | Float | |
| `rate` | Currency | |
| `discount_percentage` | Percent | |
| `amount` / `net_amount` | Currency | calculados |
| **`billing_type`** | Select | **Único · Mensual · Trimestral · Anual** |
| `interval_months` | Int | derivado: 0, 1, 3, 12 |
| `service` | Link CRM Service | opcional (catálogo futuro) |

### 4.4 CRM Suscripcion
Nace **al aceptar** un presupuesto, una por cada ítem recurrente.
| Campo | Tipo | Notas |
|---|---|---|
| `naming_series` | Series | `S-.YYYY.-.####` |
| `presupuesto` / `presupuesto_item` | Link | trazabilidad al origen |
| `deal` / `organization` / `vertical` | Link | |
| `description` | Data | del ítem |
| `rate` | Currency | por período |
| `billing_interval` | Select | Mensual · Trimestral · Anual |
| `interval_months` | Int | 1 / 3 / 12 |
| `mrr` | Currency | `rate / interval_months` |
| `currency` | Link Currency | |
| `start_date` / `end_date` | Date | `end_date` vacío = indefinida |
| `billing_day` | Int | día del mes (1–31, con clamp a fin de mes) |
| `status` | Select | Activa · Pausada · Finalizada · Cancelada |
| `next_billing_date` | Date | índice; mueve el motor (§6) |
| `last_billed_date` | Date | |
| `billed_periods` | Int | cuántos cargos se generaron |
| `cancel_reason` | Small Text | |

### 4.5 CRM Factura
| Campo | Tipo | Notas |
|---|---|---|
| `naming_series` | Series | `F-.YYYY.-.####` (serie **interna**) |
| `organization` / `deal` / `vertical` | Link | |
| `presupuesto` | Link CRM Presupuesto | origen comercial |
| `suscripcion` | Link CRM Suscripcion | vacío si es única |
| `kind` | Select | Proyecto · Suscripción · Mixta |
| `issue_date` / `due_date` | Date | vencimiento por defecto: emisión + 15 días |
| `period_start` / `period_end` | Date | para suscripciones |
| `currency` / `iva_mode` | | |
| `items` | Table → CRM Factura Item | |
| `subtotal` / `discount_total` / `iva_amount` / `total` | Currency | |
| `paid_amount` / `outstanding` | Currency | rollup de pagos |
| `status` | Select | Borrador · Emitida · Parcial · Pagada · Vencida · Anulada |
| `emisor` | Link CRM Emisor | |
| **Fiscal (preparado)** | | |
| `fiscal_number` | Data | vacío hoy; número AFIP cuando exista |
| `point_of_sale` | Int | vacío hoy |
| `cae` / `cae_due` | Data / Date | vacíos hoy |
| `fiscal_status` | Select | No aplica · Pendiente · Emitida · Error |
| `fiscal_response` | Long Text | respuesta cruda del webservice (auditoría) |
| `snapshot_hash` | Data | hash del contenido comercial emitido (§8.3) |

**La factura tiene UN solo `total`** (a diferencia del presupuesto, que tiene dos):
una factura es un cargo puntual —de un período o de pago único—, no una relación
comercial con dos bases de tiempo. Si un cliente tiene una inversión inicial y tres
abonos, son **facturas distintas**, no una mezclada.

### 4.6 CRM Factura Item
Igual que el ítem de presupuesto (`description`, `qty`, `rate`,
`discount_percentage`, `amount`, `billing_type`, `period_start`, `period_end`)
más `presupuesto_item` para trazar el origen línea por línea.

### 4.7 CRM Pago
DocType propio (no child table) para permitir cobranzas, conciliación y una vista
"Cobros" transversal.
| Campo | Tipo | Notas |
|---|---|---|
| `naming_series` | Series | `C-.YYYY.-.####` |
| `factura` | Link CRM Factura | reqd |
| `organization` | Link | denormalizado |
| `payment_date` | Date | reqd |
| `amount` | Currency | reqd |
| `currency` | Link Currency | |
| `method` | Select | Transferencia · Efectivo · Tarjeta · MercadoPago · Cheque · Otro |
| `reference` | Data | nº de operación / cheque |
| `proof` | Attach | comprobante |
| `status` | Select | Registrado · Anulado |
| `notes` | Small Text | |

Al guardar/borrar un pago se recalcula `paid_amount` y `outstanding` de la factura
y su estado (`Parcial` / `Pagada`) — ver §5.3.

### 4.8 CRM Emisor (single)
`nombre`, `razon_social`, `tax_id` (CUIT), `address`, `phone`, `email`, `logo`,
`iva_condition`, y los campos de AFIP que se llenarán después
(`afip_cert`, `afip_key`, `point_of_sale`, `environment`).
Hoy MBG es el único registro. Es el **seam** para el webservice futuro.

---

## 5. Máquinas de estado

### 5.1 Presupuesto
```
Borrador ──enviar──▶ Enviado ──aceptar──▶ Aceptado
   │                    │  │
   │                    │  └──rechazar──▶ Rechazado
   │                    └──vencer (job diario: valid_until < hoy)──▶ Vencido
   └──anular──▶ Anulado
```
**"Facturado" no es un estado**: es un hecho derivado (existe ≥1 factura asociada) y
se muestra como badge. Un estado que se mantiene a mano termina desincronizado de
los hechos; los ERP serios calculan el avance, no lo duplican.

**Congelamiento:** al pasar a `Enviado` se guardan `snapshot_hash` y se bloquean
`items` y totales. Un cambio posterior **no edita**: crea la **versión siguiente**
(`version+1`, `is_current=1`, la anterior queda `is_current=0` como histórico).

**Transiciones** (única vía; no se edita el campo a mano):

| Acción | Desde | Hacia | Requisitos |
|---|---|---|---|
| Enviar | Borrador | Enviado | ≥1 ítem, `valid_until` futuro |
| Aceptar | Enviado | Aceptado | — (crea suscripciones, §6.4) |
| Rechazar | Enviado | Rechazado | `rejected_reason` |
| Nueva versión | Enviado / Aceptado / Rechazado / **Vencido** | Borrador (v+1) | — |
| Anular | Borrador / Enviado / Rechazado / Vencido | Anulado | sin facturas emitidas |

`Vencido` **sí** se versiona: es el caso más natural para renovar (el cliente nunca
contestó y el precio quedó viejo). Si no pudiera versionarse quedaría sin salida —no se
edita por congelado y no se puede versionar—. `Anulado` no se versiona: se anuló a
propósito.

### 5.2 Suscripción
```
Activa ⇄ Pausada
  ├── (job diario) end_date cumplido ──▶ Finalizada
  └── cancelar ──▶ Cancelada   (no genera más cargos; los períodos ya facturados quedan)
```

### 5.3 Factura (adaptación de Stripe Billing)
```
Borrador ──emitir──▶ Emitida ──pago parcial──▶ Parcial ──pago total──▶ Pagada
                        │                          └── (job diario) vencida ──▶ Vencida ──▶ Pagada
                        └──anular──▶ Anulada
```
Reglas:
- `outstanding = total − paid_amount`.
- Un pago que deja `outstanding == 0` ⇒ `Pagada`.
- Un pago que deja `0 < outstanding < total` ⇒ `Parcial`.
- Un pago **mayor** al saldo se **rechaza** (no hay saldo a favor en v1).
- `Vencida` lo pone el job diario: `status ∈ {Emitida, Parcial}` y `due_date < hoy`.
- `Anulada` exige `paid_amount == 0`; con pagos hay que anularlos primero.
- Una factura `Emitida` no se edita; para corregir se anula y se emite otra
  (trazabilidad; el camino correcto a futuro es la nota de crédito).

### 5.4 Pago
`Registrado → Anulado` (no se edita un pago: se anula y se carga de nuevo).

---

## 6. Motor de recurrencia

### 6.1 Reglas de fecha
- `interval_months`: Mensual 1 · Trimestral 3 · Anual 12.
- `next_billing_date` avanza por **aniversario desde `start_date`**, no por "+30 días".
- **Clamp de fin de mes:** si `start_date` es 31 y el mes destino tiene 30, se
  factura el último día (30); en febrero, el 28/29. El ancla original (31) **no se
  pierde**: el mes siguiente vuelve al 31. Es la regla de Stripe/Chargebee.
- Años bisiestos: 29/02 en año no bisiesto ⇒ 28/02.
- `billing_day` explícito manda sobre el día de `start_date` si está cargado.
- `end_date` es **inclusive**: se factura el período que empieza en `end_date` y
  luego la suscripción pasa a `Finalizada`.

### 6.2 Cálculo de MRR
```
mrr = rate / interval_months          # normaliza todo a mes
MRR       = Σ mrr de suscripciones Activas
ARR       = MRR × 12
```
Las **Pausadas** se muestran en una línea aparte y **no** suman al MRR (están
detenidas: contarlas infla el número). No se prorratea ni se convierte moneda (§2).
Se informa **por moneda**.

### 6.3 Bandeja "Por facturar" (billing run, patrón Zuora)
No es un DocType: es una **vista derivada**, sin estado que se desincronice.

```
por_facturar = suscripciones con status=Activa y next_billing_date <= hoy + 7 días
```
La vista muestra, por cada una, el período propuesto y el importe, agrupado por
organización (si un cliente tiene 3 suscripciones, se pueden facturar juntas en
**una** factura `kind=Suscripción` con 3 líneas — así lo hace un billing run real).

**Confirmar** ⇒ `POST /facturar` crea la Factura (estado `Borrador`), y **recién
al pasar a `Emitida`** se avanza `next_billing_date`, `last_billed_date` y
`billed_periods`. Si se anula la factura, el período **vuelve** a la bandeja.
Regla de oro: *el avance de la suscripción es consecuencia de una factura emitida,
nunca de una acción de UI*. Es lo que evita cargos duplicados o perdidos.

### 6.4 Aceptación de un presupuesto
Al pasar a `Aceptado`:
1. Por cada ítem con `billing_type != Único` ⇒ crear `CRM Suscripcion`
   (`start_date` = fecha de aceptación o la que se indique, `rate` = net del ítem,
   `billing_day` = día de inicio, `next_billing_date` = `start_date`).
2. Los ítems únicos **no** generan factura automática: aparecen como **pendiente de
   facturar** en el negocio (uno emite cuando corresponde, no cuando se acepta).
3. Se registra en el historial del negocio (documento → actividad).

### 6.5 Job diario (Frappe `scheduler_events.daily`)
1. Presupuestos `Enviado` con `valid_until < hoy` ⇒ `Vencido`.
2. Facturas `Emitida/Parcial` con `due_date < hoy` ⇒ `Vencida`.
3. Suscripciones `Activa` con `end_date <= hoy` ⇒ `Finalizada`.
4. Recalcular `next_billing_date` de las que quedaron atrás (catch-up) y avisar en
   el banner in-app (no hay SMTP, §12).

---

## 7. Numeración y puerta AFIP/ARCA

- Series internas **independientes por año**: `P-2026-0001`, `F-2026-0001`,
  `S-2026-0001`, `C-2026-0001` (Frappe `naming_series`).
- La serie interna de facturas **no** es la fiscal. Al integrar AFIP, el número
  fiscal vive en `fiscal_number` + `point_of_sale` (por punto de venta y
  **correlativo sin huecos**, requisito del régimen), y la UI mostrará ambos.
  Mezclarlos hoy obligaría a renumerar y romper la trazabilidad.
- `fiscal_status = No aplica` en todas las facturas actuales.
- La emisión quedará detrás de una interfaz `InvoiceIssuer` (contrato:
  `issue(factura) -> {cae, cae_due, fiscal_number, raw}`). Hoy: `InternalIssuer`
  (no hace nada). Mañana: `AfipIssuer` (webservice). La factura no cambia.

---

## 8. Documentos, visor previo y congelamiento

### 8.1 PDF
- Se generaliza `quote.html` a un render compartido:
  `templates/doc/presupuesto.html` y `templates/doc/factura.html`, con la misma
  identidad visual (logo, Outfit embebida, A4, Chromium headless).
- La factura reusa el membrete, la tabla, los totales, y agrega período, número
  interno, vencimiento, condición de pago y bloque de datos fiscales (hoy `—`
  o "Documento no válido como factura" cuando AFIP no está activo).
- Se conserva el harness `scripts/quote-preview.py` + `scripts/quote-shot.mjs`
  (mide páginas y genera PNG para revisar sin desplegar).

### 8.2 Visor previo (lo primero a entregar)
- **Overlay a pantalla completa** con el PDF embebido vía `blob:` URL en un
  `<iframe>` — el visor nativo del navegador, cero dependencias, y ya trae zoom,
  buscar y "guardar como PDF".
- Barra superior del visor: título, número, estado, y acciones
  **Descargar · Imprimir · Enviar · Aceptar · Rechazar**.
- Se abre desde: la tarjeta del presupuesto, el drawer del negocio, o el botón
  "Ver" junto a "PDF".
- Al enviar, el visor muestra el documento **tal como lo recibió el cliente**
  (mismo `snapshot_hash`), no una recalculada después.

### 8.3 Congelamiento
`snapshot_hash` = SHA-256 del **contenido comercial enviado** (negocio, modo de
IVA, moneda, condiciones e ítems), no del PDF renderizado. El PDF es una función
determinista del contenido + la plantilla: hashear el binario haría que una mejora
de plantilla ("no coincide") invalide presupuestos ya enviados, que es lo contrario
de lo que se quiere. El hash de contenido es el invariante correcto y es lo que se
compara para detectar ediciones posteriores. Es el principio de integridad
documental que usan los sistemas con validez probatoria.

---

## 9. Pantallas (UI)

Se mantiene el lenguaje premium existente: dark, Outfit, `#fe4100`, hairlines,
números tabulares, **drawer** (nunca modal), íconos SVG propios, estados
completos (hover/focus/active/disabled/loading/error/vacío que enseña).

### 9.1 Negocios (embudo) — se amplía
- Badge por tarjeta: estado del presupuesto vigente y, si hay, **facturado/pendiente**.
- Filtro por vertical y por "con presupuesto sin respuesta".

### 9.2 Negocio (drawer) — pasa a 4 pestañas
`Detalle · Presupuesto · Facturas · Actividad`
- **Presupuesto**: versión vigente, estado, historial de versiones, botón
  "Ver/Enviar/Aceptar/Rechazar", ítems con su tipo de cobro, y los totales
  separados en **Inversión inicial** y **Abono** (por período + equivalente mensual).
- **Facturas**: lista de la cadena, con estado, saldo y acceso al PDF.
- **Actividad**: timeline del ciclo (presupuesto enviado, aceptado, factura emitida,
  pago registrado) — el *document flow* navegable.

### 9.3 Facturación (vista nueva)
- Tabs: **Por facturar** · **Facturas** · **Cobros**.
- **Por facturar**: lote propuesto por la bandeja, agrupable por cliente, con
  selección múltiple y "Facturar seleccionadas".
- **Facturas**: tabla densa (número, cliente, vertical, período, total, saldo,
  estado, vencimiento) con filtros por estado/vertical/período y orden.
- **Cobros**: últimos pagos, con medio y comprobante.
- Detalle de factura: drawer con ítems, pagos, saldo, acciones
  (Emitir · Registrar pago · Anular · Ver PDF).

### 9.4 Suscripciones (vista nueva)
- KPIs arriba: MRR, ARR, activas, próxima renovación.
- Tabla: cliente, concepto, importe, periodicidad, próxima facturación, estado.
- Acciones por fila: Ver · Pausar/Reactivar · Cancelar · Facturar período.

### 9.5 Dashboard (vista nueva, la primera del nav)
- Fila de KPIs: **MRR · Facturado del mes · Cobrado del mes · Deuda total · Vencido**.
- Pipeline ponderado + tasa de aceptación de presupuestos.
- Gráfico de **barras de facturado por mes** (12 meses) separando único vs recurrente.
- **Aging de deuda** (0–30 / 31–60 / 61–90 / +90).
- Top clientes por facturación y MRR por vertical.
- Reglas de dataviz: sin 3D, sin rejillas pesadas, sin pasteles de 8 colores,
  etiquetas directas antes que leyendas, tabulares y alineados a la derecha.

### 9.6 Informes (vista nueva)
- **Facturación** por período / cliente / vertical / tipo.
- **Aceptación de presupuestos**: enviados, aceptados, tasa, tiempo medio a decisión.
- **Cobranzas**: aging y DSO.
- **Suscripciones**: activas, altas y bajas del período, MRR por vertical.
- Export CSV en todas.

---

## 10. Métricas (definiciones exactas)

### 10.1 Recurrencia
- **MRR** = Σ `rate / interval_months` de suscripciones `Activa`.
- **ARR** = MRR × 12.
- **ARPA** = MRR / cantidad de organizaciones con suscripción activa.
- **Churn bruto del mes** = MRR de suscripciones canceladas en el mes / MRR al
  inicio del mes. (La retención neta necesita expansión/upsell: fuera de v1.)

### 10.2 Cobranza
- **Facturado** = Σ `total` de facturas `Emitida/Parcial/Pagada/Vencida` con
  `issue_date` en el período.
- **Cobrado** = Σ pagos `Registrado` con `payment_date` en el período.
- **Deuda** = Σ `outstanding` de facturas no anuladas.
- **Aging**: tramos por días desde `due_date`. Base: NetSuite/QuickBooks.
- **DSO** = (Deuda / facturado de los últimos 90 días) × 90.

### 10.3 Comercial
- **Tasa de aceptación** = presupuestos `Aceptado` / (`Aceptado` + `Rechazado` +
  `Vencido`) del período.
- **Tiempo a decisión** = promedio de `accepted_on − sent_on`.
- **Pipeline ponderado** = Σ (`deal_value` × `probability`) del embudo abierto.

### 10.4 Moneda
Todo se informa **por moneda** (ARS y USD por separado). Sin convertir: no hay
fuente de tipo de cambio confiable en el sistema y convertir a ojo produce números
que no cierran con la realidad.

---

## 11. Arquitectura técnica

### 11.1 Backend (`apps/crm_core/crm_core/`)
- `mbcrm/doctype/{vertical,presupuesto,presupuesto_item,suscripcion,factura,factura_item,pago,emisor}/`
- `billing.py` — motor: avance de períodos, MRR, aging, rollups de pago.
  Separado de los controllers para poder testear la matemática sin base de datos.
- `documents.py` — render de PDF (generaliza el `quote_pdf` actual).
- `issuers.py` — `InvoiceIssuer` / `InternalIssuer` (§7).
- `api.py` — endpoints whitelisted nuevos (ver §11.3).
- `tasks.py` — job diario (§6.5) vía `scheduler_events` en `hooks.py`.

### 11.2 Frontend (`apps/web/src/`)
- Vistas: `Dashboard.tsx`, `Billing.tsx` (Por facturar / Facturas / Cobros),
  `Subscriptions.tsx`, `Reports.tsx`.
- Componentes: `PdfViewer.tsx` (overlay + iframe blob), `QuotePanel.tsx`,
  `InvoiceDrawer.tsx`, `StatusPill.tsx`, `KpiCard.tsx`, `BarChart.tsx` (SVG propio,
  sin librería), `AgingBar.tsx`.
- `Nav` pasa a: **Dashboard · Agenda · Hoy · Contactos · Negocios · Facturación · Suscripciones · Informes**.
  (Se agrupan las vistas comerciales y las financieras para que el nav no crezca sin orden.)

### 11.3 API (nuevos métodos)
```
get_dashboard(desde, hasta)                 → KPIs + series
get_billing_queue(dias=7)                   → bandeja por facturar
create_invoice_from_subscriptions(ids)      → factura borrador (billing run)
get_invoices(filtros) / get_invoice(name)   → lista / detalle
issue_invoice(name)                         → Borrador → Emitida (avanza suscripciones)
void_invoice(name, reason)
add_payment(factura, monto, fecha, medio, referencia)
get_subscriptions(filtros) / pause_subscription / cancel_subscription
get_quote_versions(deal) / new_quote_version(deal)
send_quote(name) / accept_quote(name, start_date) / reject_quote(name, reason)
get_reports(tipo, desde, hasta)             → series agregadas
invoice_pdf(name) / quote_pdf(name, version)
```

### 11.4 Rendimiento
- Índices: `Factura(due_date, status)`, `Factura(organization, issue_date)`,
  `Suscripcion(next_billing_date, status)`, `Presupuesto(deal, version)`.
- Los informes se resuelven con consultas agregadas (`frappe.db.get_all` +
  `group_by`), no recorriendo documentos en Python.
- Los rollups (`paid_amount`) se mantienen en el controller del pago, no se
  recalculan al leer.

---

## 12. Permisos, auditoría y notificaciones

- **Roles Frappe**: `Sales User` (comercial), `Finance User` (facturación y cobros),
  `Finance Manager` (anular, cancelar suscripciones), `System Manager`.
  Hoy hay un usuario; el modelo queda listo para delegar.
- **Auditoría**: Frappe ya versiona documentos; se agrega `Activity Log` explícito
  para las transiciones de estado (quién, cuándo, desde-hacia) — el *document flow*.
- **Notificaciones**: **no hay SMTP** en el servidor. Todo aviso es **in-app**
  (banner + badges en el nav: presupuestos vencidos, facturas vencidas, cargos por
  facturar). Cuando haya SMTP, se reusa el mismo origen de eventos.
- **Recordatorios de cobranza** (dunning, patrón Chargebee): v1 = alerta in-app al
  vencer y a los 7/15/30 días. Sin emails.

---

## 13. Datos actuales — no se migra nada

**Resuelto por el usuario el 2026-09-15:** los presupuestos que existen hoy
(`CRM Deal.products`) son **datos de prueba** y se borran. No hay migración.

Qué implica en F2:
1. Vaciar `CRM Deal.products` de los negocios existentes (los de prueba). El campo
   queda en desuso y se elimina en una fase posterior.
2. `deal_value` del negocio sigue siendo el campo denormalizado del embudo: pasa a
   espejar `total_one_time_gross` del presupuesto vigente (o el abono mensual si el
   presupuesto es solo recurrente).
3. No hace falta script de migración ni dry-run: se arranca limpio.

Esto elimina el mayor riesgo del proyecto (tocar datos reales): no hay datos reales
que tocar.

---

## 14. Fases de entrega

| Fase | Contenido | Resultado visible |
|---|---|---|
| **F1** | Visor previo + congelamiento (`snapshot_hash`) | Ver el PDF antes de bajarlo/enviarlo |
| **F2** | `CRM Vertical`, `CRM Presupuesto` + items con `billing_type` + versiones y estados + limpieza de los presupuestos de prueba | Presupuesto con estados y versiones; totales único vs abono |
| **F3** | `CRM Factura`, `CRM Factura Item`, `CRM Pago` + estados + PDF de factura | Facturar y cobrar (con parciales) |
| **F4** | `CRM Suscripcion` + bandeja **Por facturar** + job diario | Suscripciones y cobro recurrente propuesto |
| **F5** | Dashboard + Informes + CSV | Los números del negocio |
| **F6** *(futuro)* | `CRM Emisor` + `AfipIssuer` | Factura fiscal con CAE |

F1 es independiente y de bajo riesgo: se puede entregar y usar antes de tocar el
modelo.

---

## 15. Testing

- **Unitario (pytest)** sobre `billing.py`, sin base de datos: avance de períodos
  (fin de mes, bisiesto, aniversario), MRR, aging, DSO, tasas.
- **Integración**: transiciones de estado válidas e inválidas; rollup de pagos;
  que **anular una factura devuelva el período a la bandeja**; que no se pueda
  avanzar `next_billing_date` sin factura emitida.
- **E2E Playwright**: enviar presupuesto → aceptar → ver suscripción → facturar el
  período → registrar pago → ver el dashboard actualizado.
- **Visual del PDF**: `scripts/quote-preview.py` + `quote-shot.mjs` (altura, páginas).
- **Limpieza**: que vaciar `CRM Deal.products` no rompa el embudo (§13).

Regla transversal: toda la matemática de dinero en `Decimal` (nunca `float`), y se
redondea **solo al mostrar** (2 decimales), no en los pasos intermedios.

---

## 16. Riesgos y decisiones abiertas

| Riesgo | Mitigación |
|---|---|
| Complejidad del ciclo (6 documentos) | Fases con valor en cada una; F1 sin tocar el modelo |
| Doble facturación de un período | El avance depende de la factura **emitida** (§6.3), con test que lo fija |
| Inflación / cambio de precio en ARS | El precio vive en la suscripción y se puede editar **antes** de facturar el período; queda el histórico |
| Datos reales en producción | **Eliminado**: no se migra nada, los presupuestos actuales son de prueba (§13) |
| RAM del VPS al límite (2.6/3.7 GB) | Todo se construye en `crm_core` (sin ERPNext); resize a CX33 recomendado antes de F5 |
| Facturas fiscales | Campo fiscal separado desde el día 1 (§7) |

**Decisiones resueltas por el usuario (2026-09-15):**
1. **No hay migración.** Los presupuestos que existen hoy son datos de prueba: se
   **borran** (la tabla `CRM Deal.products` queda vacía y en desuso). Se elimina el §13.
2. **Vencimiento de factura editable a mano.** `due_date` es un campo normal con
   default `emisión + 15 días`; nunca se bloquea ni se recalcula solo.
3. **Moneda según el cliente.** El presupuesto/factura/suscripción toman la moneda por
   defecto de `CRM Organization.currency` (el campo ya existe) y se puede cambiar por
   documento. Los informes siguen mostrando **por moneda**, sin convertir (§10.4).
