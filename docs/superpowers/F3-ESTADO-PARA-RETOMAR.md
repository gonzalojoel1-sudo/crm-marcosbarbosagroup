# F3 (facturar y cobrar) — estado para retomar

**Escrito:** 2026-09-16 · **Motivo:** pausa para atender el problema de la agenda/calendario.

## Dónde quedamos

**Plan:** `docs/superpowers/plans/2026-09-16-crm-f3-facturar-y-cobrar.md` (11 tareas)
**Spec:** `docs/superpowers/specs/2026-09-16-crm-facturacion-f3-design.md` (auditado; §15 tiene las 13 correcciones)

| Task | Estado | Commits (los finales) |
|---|---|---|
| 1 · `billing.py` facturación (puro) | completa | `fc7ff9e`, `dd16393` |
| 2 · leyenda legal AFIP + Punto de Venta + Emisor | completa | `e0b37ad`, `425212b` |
| 3 · `CRM Factura` + items + controller | completa | `9063b28`, `98ec37f` |
| 4 · PDF de la factura | completa | `3349162`, `adb34bd`, `1316783` |
| 5 · API de facturas | completa | `044fad1`, `cee4100`, `1506543` |
| 6 · `billing.py` cobranza (puro) | completa | `bd2710a`, `803418e` |
| 7 · `CRM Pago` + aplicaciones + recálculo | completa (4 rondas) | `286deb2`, `36263d4`, `80f2bc2`, `d0593ff`, `fd49a63` |
| 8 · API de cobros (`add_payment`, `apply_payment`, `remove_application`, `void_payment`, `get_billing_summary`) | **PENDIENTE** | — |
| 9 · Frontend: vista Facturación + detalle | **PENDIENTE** | — |
| 10 · Frontend: cobro con reparto asistido | **PENDIENTE** | — |
| 11 · Deploy `--migrate` + E2E en pantalla | **PENDIENTE** | — |

## Verificación al pausar

- `pytest -q` local (desde `apps/crm_core`): **129 passed**.
- Integración en `crm-test`: **78 OK** (`test_pago_recalculo` 28 · `test_factura_api` 19 ·
  `test_presupuesto_api` 19 · `test_presupuesto_states` 12).
- Producción: `crm-mb:66`, **18 DocTypes** en el módulo MbCRM (creados y estables), `/hoy` 301.
- 0 commits sin pushear.

## El ledger (no versionado)

El detalle completo de las 22 correcciones del plan, con severidad y quién las encontró, está en
`.superpowers/sdd/2026-09-16-crm-f3-facturar-y-cobrar/progress.md` (**gitignoreado**: existe sólo en
esta máquina). Si se pierde, se reconstruye de los commits y de este documento.

## Restricciones y hallazgos que la Task 8 NECESITA (no perder)

1. **`apply_payment` debe declarar `flags.aplicaciones_programaticas = True`** antes de `save()`: la
   guarda `guard_aplicaciones` (Task 7) bloquea **agregar** filas a un pago guardado por edición común
   (existe para que nadie reescriba historia contable desde el desk). Una API auditada es la excepción
   legítima y se declara explícitamente. Alternativa: usar `aplicar_a` del controller.
2. **`remove_application` debe recalcular la factura que QUITA**: `on_update` recalcula las
   aplicaciones **actuales**; la que se deja de tocar necesita su propio `recalcular_factura(factura)`.
3. **`get_billing_summary` debe informar el saldo DERIVADO** (`billing.outstanding_of(total, paid,
   credit)`), no la columna: la columna es caché. Mismo criterio que `_invoice_dto`.
4. **`solo_impagas` excluye `Borrador` y `Anulada`**: la deuda (AR) es de comprobantes emitidos.
5. **El tope por factura es por SUMA** (dos filas a la misma factura se validan juntas), y aplica sólo
   a filas **nuevas** (las persistidas ya están descontadas del saldo guardado).
6. **Residual de concurrencia declarado:** dos pagos **distintos** a la misma factura en simultáneo
   leen el mismo `outstanding` (TOCTOU) y el exceso se pierde por el clamp. Cerrarlo pide lock de la
   **factura**, no del pago. Sin impacto con un solo usuario cobrando.

## Cómo se retoma

```
cd /Users/joelpacheco/PROYECTOS/crm-marcosbarbosagroup
SK="<ruta del skill subagent-driven-development>"
bash "$SK/scripts/task-brief" docs/superpowers/plans/2026-09-16-crm-f3-facturar-y-cobrar.md 8
```
y se despacha la Task 8 con ese brief + las 6 restricciones de arriba.

**Deploy:** `bash scripts/deploy-crm.sh <N> [--migrate]` desde el VPS (el flag `--migrate` ya está
implementado y **se auto-re-ejecuta si el `git pull` cambia el script** — eso arregló un bug real).
