# Modelo de presupuesto con estados y cobro recurrente (F2) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el presupuesto sea un documento propio —versionado, con estados, y con ítems que distinguen cobro único de cobro recurrente (mensual/trimestral/anual)— en vez de una tabla escondida dentro del negocio.

**Architecture:** Tres DocTypes nuevos en el módulo `MbCRM` del app `crm_core`. La matemática de dinero vive en un módulo **puro** (`billing.py`, sin Frappe) para poder testearla sin base de datos; los controllers sólo la invocan. El estado cambia **sólo** por transiciones, y al enviar el presupuesto se **congela**: para cambiarlo hay que versionar. El render del PDF se muda a `documents.py` y muestra **dos totales** (inversión inicial y abono), porque sumarlos no significa nada.

**Tech Stack:** Frappe v15 (DocTypes JSON + controllers), Python `Decimal`, pytest local (sin sitio) + `bench run-tests` sobre el sitio `crm-test`, React 18 + TypeScript (Vite), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-15-crm-facturacion-a2-design.md` (§4.1–4.3, §5.1, §6.2, §8, §13)

## Alcance

Este plan cubre **F2**. No incluye facturación (F3), suscripciones (F4) ni dashboard (F5):
`accept_quote` en F2 **sólo cambia el estado**; la creación de suscripciones llega en F4.
Las decisiones que el usuario ya tomó están aplicadas: sin migración de datos (los presupuestos
actuales son de prueba y se borran), vencimiento editable a mano, y moneda por cliente.

## Hallazgos del audit (2026-09-15) que condicionan el plan

1. **Los DocTypes nuevos NO se crean solos.** Ningún servicio corre `bench migrate` (el
   `configurator` sólo hace `set-config`). Sin un `migrate` explícito, los DocTypes quedan en
   disco pero no en la base. **→ Task 9 agrega el migrate al deploy.**
2. **`crm-test` existe y sirve** (apps: `frappe`, `crm_core`; 12 DocTypes MbCRM). Permite correr
   pruebas de integración **sin tocar producción**. Ojo: **no tiene el app `crm`**, así que no
   puede resolver Links a `CRM Deal` hasta instalarlo (Task 4, Step 3).
3. **Hay 12 DocTypes muertos en el módulo MbCRM** (`Deal`, `Lead`, `Task`, `Contact`, `Account`…):
   10 con 0 filas y `Contact`/`Contact Email` con 3 filas de Fase 0. Duplican el modelo real
   (`CRM Deal`, `CRM Lead`, `CRM Task`) y confunden. **Su borrado es destructivo: queda como
   apéndice opt-in que requiere autorización explícita del usuario.**
4. **`apps/crm_core/tests/test_doctypes_offline.py` no testea nada.** Hace glob a
   `apps/crm_core/crm_core/doctype/*/*.json`, ruta que **no existe** (los DocTypes viven en
   `mbcrm/doctype/`), así que sus tests parametrizados corren sobre una lista vacía.
   **→ Task 2 lo arregla**, porque esa validación offline es la red que evita romper `migrate`
   en producción.
5. **`compose.yaml` está desactualizado** (dice `crm-mb:17`, lo desplegado es `crm-mb:59`).
   No bloquea: se anota, no se toca en F2.
6. **Backups**: cron 03:30 y 15:30 → Google Drive (`scripts/backup/backup-gdrive.sh`, usa
   `bench backup --with-files`). Es la red de seguridad antes del primer `migrate`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/crm_core/crm_core/billing.py` | **Nuevo.** Matemática pura del presupuesto. Sin Frappe. |
| `apps/crm_core/crm_core/documents.py` | **Nuevo.** Contexto y render del PDF. |
| `apps/crm_core/crm_core/fixtures.py` | **Nuevo.** Seed idempotente de las 7 verticales. |
| `.../mbcrm/doctype/crm_vertical/` | **Nuevo.** Dimensión analítica (las 7 verticales). |
| `.../mbcrm/doctype/crm_presupuesto/` | **Nuevo.** El documento, sus totales y sus estados. |
| `.../mbcrm/doctype/crm_presupuesto_item/` | **Nuevo.** Ítem con tipo de cobro. |
| `apps/crm_core/crm_core/api.py` | Endpoints del presupuesto (se reemplaza `save_quote`). |
| `apps/crm_core/crm_core/templates/quote.html` | Bloque de totales: dos bloques, no uno. |
| `apps/crm_core/tests/test_billing.py` | **Nuevo.** Tests puros de la matemática. |
| `apps/crm_core/tests/test_doctypes_offline.py` | Se arregla el glob roto + invariantes nuevas. |
| `apps/crm_core/tests/test_presupuesto_states.py` | **Nuevo.** Transiciones (integración). |
| `apps/web/src/{api.ts,DealDrawer.tsx,styles.css}` | Presupuesto con estados, versión y dos totales. |
| `scripts/deploy-crm.sh` | Se le agrega `--migrate`. |
| `scripts/e2e-presupuesto.mjs` | **Nuevo.** Test de aceptación de F2. |

## Global Constraints

- **Todo texto visible al usuario en español (Argentina).** Los nombres internos de DocType
  también, como manda el spec (`CRM Presupuesto`).
- **Dinero en `Decimal`, nunca `float`.** Se redondea a 2 decimales **al cerrar cada importe**,
  no en pasos intermedios.
- **Un presupuesto tiene DOS totales, no uno.** Nunca sumar un único con un recurrente, ni
  intervalos distintos entre sí. El abono siempre se expone además como **equivalente mensual**
  (`net / interval_months`), que es lo único comparable.
- **IVA**: `iva_mode ∈ {sumar, incluido, exento}`. Los subtotales son **netos**; `_iva` y
  `_gross` se derivan. Alícuota 21% en una constante.
- **`Facturado` no es un estado**: es derivado (existe una factura). Un estado mantenido a mano
  se desincroniza.
- **Congelamiento**: al pasar a `Enviado` el presupuesto no se edita; se crea la versión
  siguiente. Sólo una versión puede tener `is_current = 1` por negocio.
- **`naming_series` = `P-.YYYY.-.####`.** La serie interna **no** es la fiscal (AFIP usará
  `fiscal_number`, reservado, fuera de F2).
- **Íconos**: sólo SVG propios de `apps/web/src/icons.tsx`. Nada de glifos unicode ni emoji.
- **Todo overlay va con React portal a `document.body`** (lección de F1: `.pipe` crea un
  stacking context y el nav tapa lo que no se portala).
- **Verificación antes de cada commit:** los tests de la tarea en verde. Frontend:
  `npm run typecheck` y `npm run build` desde `apps/web`.
- **Deploy:** `bash scripts/deploy-crm.sh <N>` desde el VPS. Nunca `docker build` a mano, nunca
  encadenar con `| tail` (enmascara el exit code; ya causó una caída en F1).
- **Push antes de deploy.** El script hace `git pull` en el VPS: con commits sin pushear se
  despliega código viejo (`git log origin/main..HEAD` debe estar vacío).
- **E2E** contra producción con API key temporal (`scripts/tmp_admin_key.py`), y **siempre**
  borrarla al terminar, incluso si el test falla.
- **Los DocTypes del app `crm` NO se tocan.** `CRM Deal.products` queda vacío y en desuso
  (Task 7); el DocType no se modifica.
- **Nunca correr tests contra producción.** Integración → sitio `crm-test`. UI → E2E con datos
  propios que el test crea y borra.

---

### Task 1: `billing.py` — la matemática pura

Es el corazón de F2 y lo más fácil de romper en silencio (un centavo, un intervalo mal
normalizado). Va como módulo **sin Frappe** para poder testearlo con pytest pelado: sin sitio,
sin red, sin Docker.

**Files:**
- Create: `apps/crm_core/crm_core/billing.py`
- Create: `apps/crm_core/pytest.ini`
- Test: `apps/crm_core/tests/test_billing.py`

**Interfaces:**
- Consumes: nada.
- Produces: `dec(v) -> Decimal` · `money(v) -> Decimal` · `interval_months(billing_type) -> int` ·
  `line_amounts(qty, rate, discount_percentage) -> tuple[Decimal, Decimal]` ·
  `quote_totals(items, iva_mode="sumar", iva_rate=Decimal("0.21")) -> dict`.
  Los consumen Task 3 (controller), Task 5 (PDF) y Task 6 (API).

- [ ] **Step 1: Escribir los tests que fallan**

`apps/crm_core/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = .
# Los tests que exigen un sitio Frappe o red se corren a proposito, no en un `pytest` pelado.
addopts = --ignore=tests/test_rest_smoke.py --ignore=tests/test_hoy_api.py
```

`apps/crm_core/tests/test_billing.py`:
```python
"""Tests de la matemática de presupuestos. Puros: sin Frappe, sin base, sin red."""
from decimal import Decimal

from crm_core.billing import interval_months, line_amounts, money, quote_totals


def item(qty, rate, discount=0, billing_type="Único"):
    return {
        "qty": qty,
        "rate": rate,
        "discount_percentage": discount,
        "billing_type": billing_type,
    }


def test_interval_months_mapea_los_tipos():
    assert interval_months("Único") == 0
    assert interval_months("Mensual") == 1
    assert interval_months("Trimestral") == 3
    assert interval_months("Anual") == 12
    assert interval_months("Lo que sea") == 0


def test_money_redondea_a_dos_decimales():
    assert money("1000.005") == Decimal("1000.01")
    assert money(Decimal("0")) == Decimal("0.00")


def test_line_amounts_aplica_descuento_sobre_el_bruto():
    gross, net = line_amounts(3, "145000", 10)
    assert gross == Decimal("435000.00")
    assert net == Decimal("391500.00")


def test_line_amounts_sin_descuento():
    gross, net = line_amounts(2, "1000", 0)
    assert gross == net == Decimal("2000.00")


def test_solo_unicos_no_genera_abono():
    t = quote_totals([item(1, "850000"), item(2, "50000", 50)])
    assert t["total_one_time"] == Decimal("900000.00")
    assert t["total_recurring_monthly"] == Decimal("0.00")
    assert t["has_recurring"] is False
    assert t["has_one_time"] is True


def test_abono_se_normaliza_a_mensual():
    # 210.000 mensual + 1.200.000 anual => 210.000 + 100.000 = 310.000/mes
    t = quote_totals([item(1, "210000", 0, "Mensual"), item(1, "1200000", 0, "Anual")])
    assert t["total_recurring_monthly"] == Decimal("310000.00")
    assert t["total_one_time"] == Decimal("0.00")


def test_no_suma_intervalos_distintos_en_el_resumen():
    t = quote_totals([item(1, "210000", 0, "Mensual"), item(1, "1200000", 0, "Anual")])
    # Se agrupan por intervalo; nunca se suman entre sí.
    assert "Mensual" in t["recurring_summary"]
    assert "Anual" in t["recurring_summary"]
    assert "1.410.000" not in t["recurring_summary"]


def test_trimestral_se_normaliza_a_un_tercio():
    t = quote_totals([item(1, "300000", 0, "Trimestral")])
    assert t["total_recurring_monthly"] == Decimal("100000.00")


def test_iva_sumar_agrega_21_por_ciento():
    t = quote_totals([item(1, "100000")], iva_mode="sumar")
    assert t["total_one_time"] == Decimal("100000.00")
    assert t["total_one_time_iva"] == Decimal("21000.00")
    assert t["total_one_time_gross"] == Decimal("121000.00")


def test_iva_incluido_no_cambia_el_total_y_expone_el_contenido():
    t = quote_totals([item(1, "121000")], iva_mode="incluido")
    assert t["total_one_time_gross"] == Decimal("121000.00")
    assert t["total_one_time_iva"] == Decimal("21000.00")


def test_iva_exento_no_agrega_nada():
    t = quote_totals([item(1, "100000")], iva_mode="exento")
    assert t["total_one_time_iva"] == Decimal("0.00")
    assert t["total_one_time_gross"] == Decimal("100000.00")


def test_descuento_total_suma_las_diferencias():
    t = quote_totals([item(2, "100000", 10), item(1, "50000", 0, "Mensual")])
    assert t["discount_total"] == Decimal("20000.00")


def test_presupuesto_mixto_separa_las_dos_bases_de_tiempo():
    t = quote_totals([item(1, "850000"), item(1, "210000", 0, "Mensual")])
    assert t["total_one_time"] == Decimal("850000.00")
    assert t["total_recurring_monthly"] == Decimal("210000.00")
    assert t["has_one_time"] and t["has_recurring"]
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd apps/crm_core && python3 -m pytest tests/test_billing.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'crm_core.billing'`

- [ ] **Step 3: Implementar `billing.py`**

`apps/crm_core/crm_core/billing.py`:
```python
"""Matemática de presupuestos. Puro Python: sin Frappe, sin base, sin red.

Todo el dinero viaja en Decimal. Los importes se redondean a 2 decimales al
cerrarse cada uno (nunca en pasos intermedios), que es lo que evita el centavo
perdido cuando se suman muchos ítems con descuento.
"""

from decimal import ROUND_HALF_UP, Decimal

IVA_RATE = Decimal("0.21")
CENT = Decimal("0.01")

BILLING_TYPES = ("Único", "Mensual", "Trimestral", "Anual")

# Meses que representa cada tipo de cobro. Único = 0: no es recurrente.
INTERVAL_MONTHS = {
    "Único": 0,
    "Mensual": 1,
    "Trimestral": 3,
    "Anual": 12,
}

INTERVAL_LABELS = {1: "Mensual", 3: "Trimestral", 12: "Anual"}


def dec(value) -> Decimal:
    """Decimal seguro. Acepta None y ''; nunca pasa por float."""
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value) -> Decimal:
    """Redondea a 2 decimales. Se usa al cerrar cada importe."""
    return dec(value).quantize(CENT, rounding=ROUND_HALF_UP)


def interval_months(billing_type) -> int:
    """Meses del intervalo. Un tipo desconocido se trata como no recurrente."""
    return INTERVAL_MONTHS.get((billing_type or "").strip(), 0)


def line_amounts(qty, rate, discount_percentage) -> tuple:
    """(importe bruto, importe neto) de una línea."""
    gross = money(dec(qty) * dec(rate))
    discount = dec(discount_percentage) / Decimal("100")
    net = money(gross * (Decimal("1") - discount))
    return gross, net


def fmt_money(value, symbol="$") -> str:
    """Formato es-AR: miles con '.', decimales con ','."""
    raw = f"{money(value):,.2f}"
    raw = raw.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{symbol} {raw}" if symbol else raw


def _apply_iva(net: Decimal, iva_mode: str, iva_rate: Decimal) -> tuple:
    """(iva, bruto) para un neto, según el modo."""
    if iva_mode == "exento":
        return Decimal("0.00"), money(net)
    if iva_mode == "incluido":
        # El neto ya trae el IVA adentro: se expone la porción contenida.
        contained = net - (net / (Decimal("1") + iva_rate))
        return money(contained), money(net)
    iva = money(net * iva_rate)
    return iva, money(net + iva)


def _summary(by_interval: dict, iva_mode: str, iva_rate: Decimal) -> str:
    """Agrupa el abono por intervalo para mostrar. Nunca suma intervalos distintos."""
    parts = []
    for months in (1, 3, 12):
        total = by_interval.get(months)
        if not total:
            continue
        parts.append(f"{INTERVAL_LABELS[months]} {fmt_money(total)}")
    return " · ".join(parts)


def quote_totals(items, iva_mode: str = "sumar", iva_rate: Decimal = IVA_RATE) -> dict:
    """Totales de un presupuesto a partir de sus ítems.

    items: iterable de dicts con qty, rate, discount_percentage, billing_type.

    Devuelve dos bases de tiempo separadas a propósito: una inversión inicial y un
    abono. Sumarlas no significa nada, así que no se suman en ningún lado.
    """
    one_time = Decimal("0")
    discount_total = Decimal("0")
    by_interval = {}

    for it in items:
        gross, net = line_amounts(
            it.get("qty"), it.get("rate"), it.get("discount_percentage")
        )
        discount_total += gross - net
        months = interval_months(it.get("billing_type"))
        if months == 0:
            one_time += net
        else:
            by_interval[months] = by_interval.get(months, Decimal("0")) + net

    one_time = money(one_time)
    recurring = money(sum(by_interval.values(), Decimal("0")))
    recurring_monthly = money(
        sum((t / months for months, t in by_interval.items()), Decimal("0"))
    )

    one_time_iva, one_time_gross = _apply_iva(one_time, iva_mode, iva_rate)
    _, recurring_gross = _apply_iva(recurring, iva_mode, iva_rate)
    monthly_iva, monthly_gross = _apply_iva(recurring_monthly, iva_mode, iva_rate)

    return {
        "total_one_time": one_time,
        "total_one_time_iva": one_time_iva,
        "total_one_time_gross": one_time_gross,
        "total_recurring": recurring,
        "total_recurring_monthly": recurring_monthly,
        "total_recurring_monthly_iva": monthly_iva,
        "total_recurring_monthly_gross": monthly_gross,
        "total_recurring_gross": recurring_gross,
        "discount_total": money(discount_total),
        "recurring_summary": _summary(by_interval, iva_mode, iva_rate),
        "has_one_time": one_time > 0,
        "has_recurring": recurring > 0,
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd apps/crm_core && python3 -m pytest tests/test_billing.py -v`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/crm_core/crm_core/billing.py apps/crm_core/tests/test_billing.py apps/crm_core/pytest.ini
git commit -m "feat(presupuesto): matematica pura de totales (dos bases de tiempo, IVA, intervalos)"
```
---

### Task 2: Arreglar la validación offline de DocTypes

`test_doctypes_offline.py` hace glob a una ruta inexistente, así que **no valida nada**. En F2
agregamos 3 DocTypes y un JSON inválido rompe `migrate` **en producción**, así que esta red tiene
que funcionar antes de escribir el primer DocType nuevo.

**Files:**
- Modify: `apps/crm_core/tests/test_doctypes_offline.py`

**Interfaces:**
- Consumes: nada.
- Produces: la suite que valida los JSON de DocType de Task 3.

- [ ] **Step 1: Confirmar el defecto**

Run: `cd apps/crm_core && python3 -m pytest tests/test_doctypes_offline.py`
Expected: **3 tests FALLAN** con `FileNotFoundError` y los parametrizados corren sobre una lista
vacía. El archivo está peor de lo que parece: los 3 que fallan abren rutas de un directorio
(`crm_core/doctype/`) que **no existe**, y son restos del modelo de la Fase 0 abandonado.

- [ ] **Step 2: Corregir el glob, borrar los tests muertos y endurecer las invariantes**

Primero **borrar** los 3 tests que validan DocTypes de la Fase 0 abandonada:
`test_event_has_booking_uid_unique`, `test_gcal_connection_tokens_are_readonly` y
`test_activity_append_only`. Abren rutas inexistentes y cubren un modelo que el apéndice de este
plan propone eliminar: no se arreglan, se van. Dejar en el archivo sólo las validaciones genéricas
sobre los JSON que existen.

Después, reemplazar la constante `DOCTYPES` y agregar los tests nuevos al final del archivo:

```python
DOCTYPES = sorted(
    glob.glob("crm_core/mbcrm/doctype/*/*.json")
    + glob.glob("crm_core/doctype/*/*.json")
)
```

```python
def test_hay_doctypes_para_validar():
    """La red no sirve si el glob vuelve vacío: eso ya pasó (ruta mal escrita)."""
    assert len(DOCTYPES) >= 3, f"el glob no encontró DocTypes: {DOCTYPES}"


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_tiene_autoname_o_naming_series(path: str):
    """Un DocType sin forma de nombrarse falla al insertar, no al migrar."""
    d = json.loads(Path(path).read_text())
    fieldnames = [f.get("fieldname") for f in d["fields"]]
    assert d.get("autoname") or "naming_series" in fieldnames, f"{d['name']}: sin autoname"


@pytest.mark.parametrize("path", DOCTYPES)
def test_doctype_link_apunta_a_destinos_conocidos(path: str):
    """Un Link a un DocType inexistente hace fallar el migrate en producción."""
    d = json.loads(Path(path).read_text())
    propios = {json.loads(Path(p).read_text())["name"] for p in DOCTYPES}
    externos = {
        "User", "File", "Currency", "Country", "CRM Deal", "CRM Lead",
        "CRM Organization", "CRM Task", "CRM Deal Status", "CRM Lead Source",
    }
    for f in d["fields"]:
        if f.get("fieldtype") == "Link":
            destino = f.get("options")
            assert destino in propios | externos, (
                f"{d['name']}.{f['fieldname']}: Link a '{destino}' desconocido"
            )
```

- [ ] **Step 3: Correr y verificar**

Run: `cd apps/crm_core && python3 -m pytest tests/test_doctypes_offline.py -v`
Expected: PASS y el conteo de tests parametrizados **ya no es 0** (aparecen los 12 DocTypes
existentes × los tests parametrizados).

Si `test_doctype_link_apunta_a_destinos_conocidos` falla con un Link legítimo que falta,
agregalo al conjunto `externos` — es la lista de destinos fuera del app.

- [ ] **Step 4: Commit**

```bash
git add apps/crm_core/tests/test_doctypes_offline.py
git commit -m "test(crm_core): arreglar glob que dejaba la validacion de DocTypes en cero"
```

---

### Task 3: `CRM Vertical`, `CRM Presupuesto` y `CRM Presupuesto Item`

Los tres DocTypes. Los campos exactos están en el spec §4.1–4.3 (es la autoridad); acá van la
estructura JSON, los valores no obvios (opciones con saltos de línea, `autoname`, permisos) y el
controller con el cálculo.

**Files:**
- Create: `apps/crm_core/crm_core/mbcrm/doctype/crm_vertical/{__init__.py,crm_vertical.json,crm_vertical.py}`
- Create: `apps/crm_core/crm_core/mbcrm/doctype/crm_presupuesto_item/{__init__.py,crm_presupuesto_item.json,crm_presupuesto_item.py}`
- Create: `apps/crm_core/crm_core/mbcrm/doctype/crm_presupuesto/{__init__.py,crm_presupuesto.json,crm_presupuesto.py}`
- Create: `apps/crm_core/crm_core/fixtures.py`

**Interfaces:**
- Consumes: `billing` (Task 1).
- Produces: DocType `CRM Presupuesto` con los campos que consumen Task 5, 6 y 8.
  Métodos de instancia: `set_interval_months()`, `calculate_totals()`, `guard_frozen()`.
  **La clase se llama `CRMPresupuesto`** (Frappe quita los espacios del nombre del DocType).

- [ ] **Step 1: `CRM Vertical`**

`crm_vertical.json` — usá `apps/crm_core/crm_core/mbcrm/doctype/task/task.json` como molde de la
estructura (mismas claves de nivel raíz: `actions`, `creation`, `doctype`, `engine`,
`field_order`, `fields`, `index_web_pages_for_search`, `links`, `modified`, `module`, `name`,
`owner`, `permissions`, `sort_field`, `sort_order`, `states`). Valores:

```json
{
  "autoname": "field:nombre",
  "field_order": ["nombre", "activo", "color", "orden", "email_contacto"],
  "fields": [
    {"fieldname": "nombre", "fieldtype": "Data", "label": "Nombre", "reqd": 1, "unique": 1, "in_list_view": 1},
    {"fieldname": "activo", "fieldtype": "Check", "label": "Activa", "default": "1", "in_list_view": 1},
    {"fieldname": "color", "fieldtype": "Data", "label": "Color", "description": "Hex, ej #fe4100"},
    {"fieldname": "orden", "fieldtype": "Int", "label": "Orden", "default": "0"},
    {"fieldname": "email_contacto", "fieldtype": "Data", "label": "Email de contacto", "options": "Email"}
  ],
  "module": "MbCRM",
  "name": "CRM Vertical",
  "sort_field": "orden",
  "sort_order": "ASC"
}
```
Permisos: `System Manager` con todo, y `All` con `read`/`write`/`create` (igual que `task.json`).
`creation` y `modified`: `"2026-09-15 12:00:00.000000"`. `owner`: `"Administrator"`.

`crm_vertical.py`:
```python
from frappe.model.document import Document


class CRMVertical(Document):
    pass
```
`__init__.py`: vacío.

- [ ] **Step 2: `CRM Presupuesto Item`** (child table)

Valores no obvios: `"istable": 1`, `"editable_grid": 1`, **sin** `autoname` y con
`"permissions": []`. El resto de las claves raíz iguales al molde.

```json
{
  "field_order": ["description", "billing_type", "interval_months", "qty", "rate", "discount_percentage", "amount", "net_amount"],
  "fields": [
    {"fieldname": "description", "fieldtype": "Small Text", "label": "Descripción", "reqd": 1, "in_list_view": 1},
    {"fieldname": "billing_type", "fieldtype": "Select", "label": "Tipo de cobro", "options": "Único\nMensual\nTrimestral\nAnual", "default": "Único", "reqd": 1, "in_list_view": 1},
    {"fieldname": "interval_months", "fieldtype": "Int", "label": "Meses del intervalo", "read_only": 1},
    {"fieldname": "qty", "fieldtype": "Float", "label": "Cantidad", "default": "1", "in_list_view": 1},
    {"fieldname": "rate", "fieldtype": "Currency", "label": "Precio unitario", "options": "currency", "in_list_view": 1},
    {"fieldname": "discount_percentage", "fieldtype": "Percent", "label": "Descuento %"},
    {"fieldname": "amount", "fieldtype": "Currency", "label": "Importe", "options": "currency", "read_only": 1},
    {"fieldname": "net_amount", "fieldtype": "Currency", "label": "Importe neto", "options": "currency", "read_only": 1}
  ],
  "istable": 1,
  "editable_grid": 1,
  "module": "MbCRM",
  "name": "CRM Presupuesto Item"
}
```

`crm_presupuesto_item.py`:
```python
from frappe.model.document import Document


class CRMPresupuestoItem(Document):
    pass
```

- [ ] **Step 3: `CRM Presupuesto`**

Valores no obvios: `"autoname": "naming_series:"`, el campo `naming_series` como `Select` con
`"options": "P-.YYYY.-.####"` y `"default"` igual, `"hidden": 1`. Los campos exactos, con sus
tipos y opciones, salen del spec §4.2 — incluidos **los tres totales de la inversión**
(`total_one_time`, `total_one_time_iva`, `total_one_time_gross`) y **los tres del abono**
(`total_recurring_monthly`, `total_recurring_monthly_iva`, `total_recurring_monthly_gross`), más
`discount_total` y `recurring_summary`.

Opciones que **no** se pueden deducir y hay que copiar tal cual:
- `status`: `"Borrador\nEnviado\nAceptado\nRechazado\nVencido\nAnulado"`, default `"Borrador"`, reqd.
- `iva_mode`: `"sumar\nincluido\nexento"`, default `"sumar"`, reqd.
- `deal`: Link a `CRM Deal`, reqd.
- `organization`: Link a `CRM Organization`.
- `vertical`: Link a `CRM Vertical`. **En F2 se elige a mano en el presupuesto**: heredarla del
  negocio exigiría un campo nuevo en `CRM Deal`, que es un DocType de un app de terceros (`crm`), y
  eso es un `Custom Field` — un cambio de esquema fuera del alcance de esta fase. La herencia
  automática queda para cuando exista la pantalla donde elegir la vertical del negocio.
- `currency`: Link a `Currency`.
- `items`: Table a `CRM Presupuesto Item`, reqd.
- `version`: Int, `"default": "1"`, read_only. `is_current`: Check, `"default": "1"`.
- `valid_until`: Date. `sent_on`/`accepted_on`/`rejected_on`: Datetime, read_only.
- `snapshot_hash`: Data, read_only.
- Todos los campos de importe: `Currency` con `"options": "currency"` y `read_only` (los calcula el
  controller: aceptarlos de afuera es aceptar números que no cierran).
- Permisos: igual que `CRM Vertical`.

`crm_presupuesto.py`:
```python
import hashlib
import json

import frappe
from frappe.model.document import Document

from crm_core import billing

FROZEN_STATUSES = ("Enviado", "Aceptado", "Rechazado", "Vencido")

TOTAL_FIELDS = (
    "total_one_time",
    "total_one_time_iva",
    "total_one_time_gross",
    "total_recurring_monthly",
    "total_recurring_monthly_iva",
    "total_recurring_monthly_gross",
    "discount_total",
    "recurring_summary",
)


class CRMPresupuesto(Document):
    def validate(self):
        self.set_interval_months()
        self.calculate_totals()
        self.guard_frozen()

    def set_interval_months(self):
        for it in self.items or []:
            it.interval_months = billing.interval_months(it.billing_type)

    def calculate_totals(self):
        """Los totales SIEMPRE se recalculan: nunca se aceptan de afuera."""
        totals = billing.quote_totals(
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
        for key in TOTAL_FIELDS:
            setattr(self, key, totals[key])

        # Los importes de línea se persisten para que el PDF y los informes no
        # dependan de recalcular la fórmula en dos lugares distintos.
        for it in self.items or []:
            gross, net = billing.line_amounts(it.qty, it.rate, it.discount_percentage)
            it.amount = gross
            it.net_amount = net

    def guard_frozen(self):
        """Congelado: si ya salió del borrador, el contenido comercial no se toca.

        No bloquea el cambio de estado (eso lo hacen las transiciones), sólo la
        edición de los ítems.
        """
        if self.is_new():
            return
        before = self.get_doc_before_save()
        if not before:
            return
        if before.status in FROZEN_STATUSES and self.status == before.status:
            if self.get("items") != before.get("items"):
                frappe.throw(
                    "Este presupuesto ya fue enviado y no se puede editar. "
                    "Creá una versión nueva para cambiarlo."
                )
```

- [ ] **Step 4: Seed de las 7 verticales**

`apps/crm_core/crm_core/fixtures.py`:
```python
"""Datos base de crm_core. Idempotente: se puede correr muchas veces."""

import frappe

# Las 7 verticales de marcosbarbosagroup.com, en el orden del sitio.
VERTICALES = [
    ("Consultora Estratégica", "#fe4100", 1),
    ("Cuerpo de Cristo", "#8b5cf6", 2),
    ("Servicios", "#06b6d4", 3),
    ("Software y Aplicaciones", "#3b82f6", 4),
    ("Legendarios", "#f59e0b", 5),
    ("Los 1000 Socios", "#22c55e", 6),
    ("Formate con Nosotros", "#ec4899", 7),
]


def seed_verticales():
    for nombre, color, orden in VERTICALES:
        if frappe.db.exists("CRM Vertical", nombre):
            continue
        frappe.get_doc(
            {
                "doctype": "CRM Vertical",
                "nombre": nombre,
                "color": color,
                "orden": orden,
                "activo": 1,
            }
        ).insert(ignore_permissions=True)
    frappe.db.commit()
```

- [ ] **Step 5: Validación offline de los 3 nuevos**

Run: `cd apps/crm_core && python3 -m pytest tests/test_doctypes_offline.py -v`
Expected: PASS y el conteo **sube** (se suman los 3 JSON nuevos). Si el test de Links se queja de
`CRM Vertical`, agregalo al conjunto `externos`.

- [ ] **Step 6: Commit**

```bash
git add apps/crm_core/crm_core/mbcrm/doctype/crm_vertical \
        apps/crm_core/crm_core/mbcrm/doctype/crm_presupuesto \
        apps/crm_core/crm_core/mbcrm/doctype/crm_presupuesto_item \
        apps/crm_core/crm_core/fixtures.py
git commit -m "feat(presupuesto): DocTypes CRM Vertical, CRM Presupuesto y sus items"
```

---

### Task 4: Estados, versiones y congelamiento

**Files:**
- Modify: `apps/crm_core/crm_core/mbcrm/doctype/crm_presupuesto/crm_presupuesto.py`
- Test: `apps/crm_core/tests/test_presupuesto_states.py`

**Interfaces:**
- Consumes: `CRMPresupuesto` (Task 3).
- Produces: métodos `send()`, `accept()`, `reject(reason)`, `void()` y la función de módulo
  `new_version(deal) -> CRMPresupuesto`. Los consume Task 6 (API).

- [ ] **Step 1: Agregar la máquina de estados al controller**

Dentro de la clase `CRMPresupuesto`, después de `guard_frozen`:

```python
    # ── Transiciones: la única vía de cambio de estado ──────────────────
    # No se edita `status` a mano: cada transición valida su origen y deja traza.

    def _assert_status(self, *allowed):
        if self.status not in allowed:
            frappe.throw(f"No se puede hacer esa acción desde el estado «{self.status}».")

    def send(self):
        self._assert_status("Borrador")
        if not (self.items or []):
            frappe.throw("El presupuesto no tiene ítems.")
        if self.valid_until and str(self.valid_until) < str(frappe.utils.nowdate()):
            frappe.throw("La fecha de validez ya pasó.")
        self.status = "Enviado"
        self.sent_on = frappe.utils.now()
        self.snapshot_hash = self._snapshot()
        self.save()

    def accept(self):
        self._assert_status("Enviado")
        self.status = "Aceptado"
        self.accepted_on = frappe.utils.now()
        self.save()
        # F4 crea acá las suscripciones de los ítems recurrentes.

    def reject(self, reason):
        self._assert_status("Enviado")
        if not (reason or "").strip():
            frappe.throw("Indicá el motivo del rechazo.")
        self.status = "Rechazado"
        self.rejected_on = frappe.utils.now()
        self.rejected_reason = reason.strip()
        self.save()

    def void(self):
        self._assert_status("Borrador", "Enviado", "Rechazado", "Vencido")
        self.status = "Anulado"
        self.save()

    def _snapshot(self):
        """Huella del contenido comercial al enviar (integridad documental)."""
        payload = json.dumps(
            {
                "deal": self.deal,
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

Y como función de módulo al final del archivo:

```python
def new_version(deal):
    """Clona el presupuesto vigente del negocio como la versión siguiente, en borrador.

    Es el único camino para cambiar un presupuesto ya enviado.
    """
    actual = frappe.get_all(
        "CRM Presupuesto", filters={"deal": deal, "is_current": 1}, fields=["name"], limit=1
    )
    if not actual:
        frappe.throw("El negocio no tiene un presupuesto vigente.")
    origen = frappe.get_doc("CRM Presupuesto", actual[0].name)

    if origen.status == "Borrador":
        frappe.throw("El presupuesto vigente ya es un borrador: editalo en vez de versionar.")

    for otro in frappe.get_all("CRM Presupuesto", filters={"deal": deal, "is_current": 1}, pluck="name"):
        frappe.db.set_value("CRM Presupuesto", otro, "is_current", 0)

    nuevo = frappe.copy_doc(origen)
    nuevo.status = "Borrador"
    nuevo.version = (origen.version or 1) + 1
    nuevo.is_current = 1
    nuevo.sent_on = None
    nuevo.accepted_on = None
    nuevo.rejected_on = None
    nuevo.rejected_reason = None
    nuevo.snapshot_hash = None
    nuevo.insert(ignore_permissions=True)
    return nuevo
```

- [ ] **Step 2: Test de integración de las transiciones**

`apps/crm_core/tests/test_presupuesto_states.py` (corre con `bench run-tests` sobre `crm-test`):
```python
"""Transiciones del presupuesto. Requiere sitio Frappe (crm-test, NUNCA producción)."""
import frappe
from frappe.tests.utils import FrappeTestCase

from crm_core.mbcrm.doctype.crm_presupuesto.crm_presupuesto import new_version


class TestPresupuestoEstados(FrappeTestCase):
    def _deal(self):
        return frappe.get_doc({"doctype": "CRM Deal", "lead_name": "Test F2"}).insert(
            ignore_permissions=True
        )

    def _quote(self, deal):
        return frappe.get_doc(
            {
                "doctype": "CRM Presupuesto",
                "deal": deal.name,
                "iva_mode": "sumar",
                "items": [
                    {"description": "Servicio", "billing_type": "Único", "qty": 1, "rate": 100000}
                ],
            }
        ).insert(ignore_permissions=True)

    def test_calcula_los_dos_totales_al_guardar(self):
        q = self._quote(self._deal())
        self.assertEqual(q.total_one_time, 100000)
        self.assertEqual(q.total_one_time_gross, 121000)
        self.assertEqual(q.total_recurring_monthly, 0)

    def test_no_se_puede_enviar_sin_items(self):
        q = self._quote(self._deal())
        q.items = []
        with self.assertRaises(frappe.ValidationError):
            q.send()

    def test_enviar_congela_y_marca_la_traza(self):
        q = self._quote(self._deal())
        q.send()
        self.assertEqual(q.status, "Enviado")
        self.assertTrue(q.sent_on)
        self.assertTrue(q.snapshot_hash)

    def test_no_se_puede_editar_un_enviado(self):
        q = self._quote(self._deal())
        q.send()
        q.items[0].rate = 999999
        with self.assertRaises(frappe.ValidationError):
            q.save()

    def test_versionar_deja_una_sola_vigente(self):
        deal = self._deal()
        q = self._quote(deal)
        q.send()
        nueva = new_version(deal.name)
        self.assertEqual(nueva.version, 2)
        self.assertEqual(nueva.status, "Borrador")
        vigentes = frappe.get_all(
            "CRM Presupuesto", filters={"deal": deal.name, "is_current": 1}, pluck="name"
        )
        self.assertEqual(vigentes, [nueva.name])

    def test_rechazar_exige_motivo(self):
        q = self._quote(self._deal())
        q.send()
        with self.assertRaises(frappe.ValidationError):
            q.reject("   ")

    def test_no_se_puede_aceptar_un_borrador(self):
        q = self._quote(self._deal())
        with self.assertRaises(frappe.ValidationError):
            q.accept()
```

- [ ] **Step 3: Correr sobre el sitio de prueba**

```bash
ssh root@2.28.121.92
BE=$(docker ps -qf name=crm_backend.1)
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm-test run-tests --app crm_core --module crm_core.tests.test_presupuesto_states"
```
Expected: PASS (7 tests).

Si falla porque `crm-test` no tiene el app `crm` (y por eso no existe `CRM Deal`), instalarlo
**una sola vez** en el sitio de prueba:
```bash
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm-test install-app crm"
```
Es un sitio de prueba: no toca producción y hace que espeje la realidad.

- [ ] **Step 4: Commit**

```bash
git add apps/crm_core/crm_core/mbcrm/doctype/crm_presupuesto/crm_presupuesto.py \
        apps/crm_core/tests/test_presupuesto_states.py
git commit -m "feat(presupuesto): maquina de estados, congelamiento y versionado"
```
---

### Task 5: `documents.py` y el PDF con dos totales

**Files:**
- Create: `apps/crm_core/crm_core/documents.py`
- Modify: `apps/crm_core/crm_core/templates/quote.html` (sólo el bloque de totales y el tag del ítem)
- Modify: `apps/crm_core/crm_core/api.py` (quitar de ahí el render, que se muda)
- Modify: `scripts/quote-preview.py` (el harness de preview, para que arme el contexto nuevo)

**Interfaces:**
- Consumes: `CRMPresupuesto` (Task 3), `billing` (Task 1).
- Produces: `documents.quote_context(presupuesto_name) -> dict` y
  `documents.render_quote_pdf(presupuesto_name) -> bytes`, más
  `documents.quote_number(name) -> str`. Los consume Task 6.

- [ ] **Step 1: Crear `documents.py` moviendo y adaptando el render**

Traer de `api.py` las funciones `_font_b64` y `_html_to_pdf` (quedan igual, salvo que `_html_to_pdf`
pasa a ser privada del módulo nuevo) y reescribir el contexto para leer **del presupuesto** y
exponer los dos totales. El módulo completo:

```python
"""Render de documentos (PDF) del CRM."""

import base64
import os
import re
import subprocess
import tempfile

import frappe
from frappe.utils import flt, getdate

from crm_core import billing

TEMPLATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
_font_cache = {}

EMPRESA = {
    "city": "Córdoba, Argentina",
    "phone": "+54 9 351 733 4040",
    "email": "consultora.marcosbarbosa@gmail.com",
    "web": "marcosbarbosagroup.com",
}
QUOTE_VALIDITY_DAYS = 15


def _font_b64():
    if "outfit" not in _font_cache:
        with open(os.path.join(TEMPLATES, "fonts", "outfit-latin.woff2"), "rb") as f:
            _font_cache["outfit"] = base64.b64encode(f.read()).decode()
    return _font_cache["outfit"]


def quote_number(name):
    """P-00025 a partir del sufijo numérico del nombre."""
    m = re.search(r"(\d+)$", name or "")
    return f"P-{m.group(1)}" if m else (name or "S/N")


def quote_context(presupuesto_name):
    p = frappe.get_doc("CRM Presupuesto", presupuesto_name)
    items = [it for it in (p.items or []) if (it.description or "").strip()]
    if not items:
        frappe.throw("El presupuesto no tiene ítems cargados.")

    currency = p.currency or "ARS"
    symbol = "US$" if currency == "USD" else "$"

    rows = []
    for it in items:
        rows.append(
            {
                "description": it.description,
                "qty_fmt": f"{flt(it.qty):g}",
                "rate_fmt": billing.fmt_money(it.rate, ""),
                "discount_fmt": f"{flt(it.discount_percentage):g}%" if it.discount_percentage else "—",
                "net_fmt": billing.fmt_money(it.net_amount, ""),
                "billing_label": it.billing_type if it.billing_type != "Único" else "",
            }
        )

    org_name = ""
    if p.organization:
        org_name = (
            frappe.db.get_value("CRM Organization", p.organization, "organization_name")
            or p.organization
        )
    email = phone = ""
    if p.deal:
        lead = frappe.db.get_value("CRM Deal", p.deal, "lead")
        if lead:
            r = frappe.db.get_value("CRM Lead", lead, ["email", "mobile_no"], as_dict=True) or {}
            email, phone = r.get("email") or "", r.get("mobile_no") or ""

    show_iva = (p.iva_mode or "sumar") != "exento"
    iva_included = p.iva_mode == "incluido"

    return {
        "font_b64": _font_b64(),
        "company": EMPRESA,
        "quote_no": quote_number(p.name),
        "date": getdate(p.creation).strftime("%d/%m/%Y"),
        "validity": str(p.valid_until) if p.valid_until else f"{QUOTE_VALIDITY_DAYS} días",
        "currency": currency,
        "client": {
            "company": org_name or "Cliente",
            "contact": frappe.db.get_value("CRM Deal", p.deal, "lead_name") or "",
            "email": email,
            "phone": phone,
        },
        "deal_name": p.deal,
        "deal_title": org_name or p.deal,
        "owner": "",
        "items": rows,
        "has_recurring": flt(p.total_recurring_monthly) > 0,
        "recurring_summary": p.recurring_summary or "",
        "tot": {
            "one_time_net": billing.fmt_money(p.total_one_time, symbol),
            "one_time_iva": billing.fmt_money(p.total_one_time_iva, symbol),
            "one_time_gross": billing.fmt_money(p.total_one_time_gross, symbol),
            "recurring_net": billing.fmt_money(p.total_recurring_monthly, symbol),
            "recurring_iva": billing.fmt_money(p.total_recurring_monthly_iva, symbol),
            "recurring_gross": billing.fmt_money(p.total_recurring_monthly_gross, symbol),
            "discount": billing.fmt_money(p.discount_total, symbol),
            "has_discount": flt(p.discount_total) > 0.005,
            "show_iva": show_iva,
            "iva_included": iva_included,
        },
        "conditions": [
            {
                "k": "Validez",
                "v": str(p.valid_until) if p.valid_until else f"{QUOTE_VALIDITY_DAYS} días desde la emisión",
            },
            {"k": "Forma de pago", "v": "A convenir con el cliente"},
            {
                "k": "Moneda",
                "v": "Dólares estadounidenses (USD)" if currency == "USD" else "Pesos argentinos (ARS)",
            },
        ],
        "notes": p.notes or "",
    }


def _html_to_pdf(html):
    """Chromium headless: misma fidelidad que el navegador (wkhtmltopdf no da)."""
    with tempfile.TemporaryDirectory() as d:
        hp, pp = os.path.join(d, "q.html"), os.path.join(d, "q.pdf")
        with open(hp, "w", encoding="utf-8") as f:
            f.write(html)
        proc = subprocess.run(
            [
                "chromium-headless-shell", "--headless", "--no-sandbox", "--disable-gpu",
                "--disable-dev-shm-usage", f"--user-data-dir={os.path.join(d, 'profile')}",
                "--no-pdf-header-footer", f"--print-to-pdf={pp}", f"file://{hp}",
            ],
            capture_output=True,
            timeout=120,
        )
        if not os.path.exists(pp) or os.path.getsize(pp) == 0:
            frappe.log_error(
                (proc.stderr.decode(errors="ignore") or "chromium sin salida")[-3000:], "quote_pdf"
            )
            frappe.throw("No se pudo generar el PDF. Probá de nuevo en un momento.")
        with open(pp, "rb") as f:
            return f.read()


def render_quote_pdf(presupuesto_name):
    ctx = quote_context(presupuesto_name)
    with open(os.path.join(TEMPLATES, "quote.html"), encoding="utf-8") as f:
        html = frappe.render_template(f.read(), ctx)
    return _html_to_pdf(html)
```

En `api.py`, borrar `_font_b64`, `_html_to_pdf`, `_quote_context`, `_quote_number`, `COMPANY`,
`QUOTE_VALIDITY_DAYS`, `IVA_RATE`, `_es_money` y el `quote_pdf` viejo (Task 6 lo reescribe). Dejar
`TEMPLATES`/`_TEMPLATES` sólo si algo más lo usa; si no, se va también.

- [ ] **Step 2: Los dos totales en la plantilla**

En `templates/quote.html`, reemplazar `<section class="totals">…</section>` completo por
**dos bloques** (son dos bases de tiempo; sumarlos no significa nada):

```html
  <section class="totals">
    {% if tot.has_discount %}
    <div class="totals-note">Descuentos aplicados: {{ tot.discount }}</div>
    {% endif %}

    {% if has_recurring %}
    <div class="tot-wrap">
      <div class="totals-inner">
        <div class="t-row"><span class="t-k">Subtotal</span><span>{{ tot.recurring_net }}</span></div>
        {% if tot.show_iva %}
        <div class="t-row">
          <span class="t-k">IVA 21%{% if tot.iva_included %} (incluido){% endif %}</span>
          <span>{{ tot.recurring_iva }}</span>
        </div>
        {% endif %}
        <div class="t-total">
          <span class="t-k">Abono mensual</span>
          <span class="t-v">{{ tot.recurring_gross }}</span>
        </div>
        {% if recurring_summary %}<div class="t-sub">{{ recurring_summary }}</div>{% endif %}
      </div>
    </div>
    {% endif %}

    <div class="tot-wrap">
      <div class="totals-inner">
        <div class="t-row"><span class="t-k">Subtotal</span><span>{{ tot.one_time_net }}</span></div>
        {% if tot.show_iva %}
        <div class="t-row">
          <span class="t-k">IVA 21%{% if tot.iva_included %} (incluido){% endif %}</span>
          <span>{{ tot.one_time_iva }}</span>
        </div>
        {% endif %}
        <div class="t-total">
          <span class="t-k">Inversión inicial</span>
          <span class="t-v">{{ tot.one_time_gross }}</span>
        </div>
      </div>
    </div>
  </section>
```

Estilos a agregar junto a los de `.totals`:
```css
.tot-wrap { display: flex; justify-content: flex-end; margin-top: 3mm; }
.totals-note { font-size: 9pt; color: #6b6b73; margin-top: 2mm; }
.t-sub { font-size: 8.6pt; color: #9a989e; text-align: right; margin-top: 1.5mm; }
.d-tag { font-size: 8pt; color: #b03413; margin-left: 4px; }
```
Y en el `<td class="desc">`, después de `<span class="d-name">{{ it.description }}</span>`, agregar
`{% if it.billing_label %}<span class="d-tag">{{ it.billing_label }}</span>{% endif %}`.

- [ ] **Step 3: Verificar la maqueta con el harness local**

Actualizar `scripts/quote-preview.py` para armar el contexto nuevo (dos totales: un ítem único, uno
mensual y uno anual) y correr:

```bash
python3 scripts/quote-preview.py && node scripts/quote-shot.mjs
```
Expected: `páginas: 1` (o 2 con muchos ítems: aceptable) y en `quote-preview.png` se ven **los dos
bloques** ("Abono mensual" y "Inversión inicial"), con el tag del tipo de cobro en las filas que no
son únicas. Revisar el PNG a ojo y ajustar márgenes si algo queda huérfano al pie.

- [ ] **Step 4: Commit**

```bash
git add apps/crm_core/crm_core/documents.py apps/crm_core/crm_core/templates/quote.html \
        apps/crm_core/crm_core/api.py scripts/quote-preview.py
git commit -m "feat(presupuesto): documents.py y PDF con dos totales (inversion inicial y abono)"
```

---

### Task 6: API del presupuesto

**Files:**
- Modify: `apps/crm_core/crm_core/api.py`

**Interfaces:**
- Consumes: `CRMPresupuesto` (Tasks 3-4), `documents` (Task 5), `billing` (Task 1).
- Produces: `get_deal` (extendido con `quote`), `save_quote`, `send_quote`, `accept_quote`,
  `reject_quote`, `new_quote_version`, `quote_pdf`. Los consume Task 8 (api.ts y la UI).

- [ ] **Step 1: `get_deal` devuelve el presupuesto vigente**

Reemplazar en `get_deal` las claves `items`, `total` y `quote_no` por un objeto `quote` con el
presupuesto vigente (`is_current = 1`):

```python
    vigente = frappe.get_all(
        "CRM Presupuesto", filters={"deal": name, "is_current": 1}, fields=["name"], limit=1
    )
    quote = None
    if vigente:
        p = frappe.get_doc("CRM Presupuesto", vigente[0].name)
        quote = {
            "name": p.name,
            "version": p.version,
            "status": p.status,
            "currency": p.currency or "",
            "iva_mode": p.iva_mode or "sumar",
            "valid_until": str(p.valid_until) if p.valid_until else "",
            "conditions": p.conditions or "",
            "notes": p.notes or "",
            "recurring_summary": p.recurring_summary or "",
            "is_editable": p.status == "Borrador",
            "totals": {
                "one_time_net": p.total_one_time or 0,
                "one_time_iva": p.total_one_time_iva or 0,
                "one_time_gross": p.total_one_time_gross or 0,
                "recurring_net": p.total_recurring_monthly or 0,
                "recurring_iva": p.total_recurring_monthly_iva or 0,
                "recurring_gross": p.total_recurring_monthly_gross or 0,
                "discount": p.discount_total or 0,
            },
            "items": [
                {
                    "description": it.description,
                    "billing_type": it.billing_type,
                    "qty": it.qty,
                    "rate": it.rate,
                    "discount_percentage": it.discount_percentage,
                    "net_amount": it.net_amount,
                }
                for it in (p.items or [])
            ],
        }
```
y agregar `"quote": quote,` al dict de retorno.

- [ ] **Step 2: `save_quote` escribe el DocType, no la tabla del negocio**

```python
@frappe.whitelist()
def save_quote(deal, items, iva_mode="sumar", valid_until=None, conditions=None, currency=None):
    """Crea o actualiza el presupuesto EN BORRADOR del negocio.

    Si el vigente ya salió del borrador, NO se edita: se crea la versión siguiente.
    """
    rows = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    rows = [r for r in rows if str(r.get("description") or "").strip()]
    if not rows:
        frappe.throw("Agregá al menos un ítem al presupuesto.")

    d = frappe.get_doc("CRM Deal", deal)
    vigente = frappe.get_all(
        "CRM Presupuesto",
        filters={"deal": deal, "is_current": 1},
        fields=["name", "status"],
        limit=1,
    )

    if vigente and vigente[0].status != "Borrador":
        from crm_core.mbcrm.doctype.crm_presupuesto.crm_presupuesto import new_version

        doc = new_version(deal)
    elif vigente:
        doc = frappe.get_doc("CRM Presupuesto", vigente[0].name)
    else:
        doc = frappe.new_doc("CRM Presupuesto")
        doc.deal = deal
        doc.version = 1
        doc.is_current = 1

    doc.organization = d.get("organization")
    if d.get("organization"):
        doc.currency = (
            currency
            or d.currency
            or frappe.db.get_value("CRM Organization", d.organization, "currency")
            or "ARS"
        )
    else:
        doc.currency = currency or d.currency or "ARS"
    doc.iva_mode = iva_mode or "sumar"
    if valid_until is not None:
        doc.valid_until = valid_until or None
    if conditions is not None:
        doc.conditions = conditions

    doc.set("items", [])
    for r in rows:
        doc.append(
            "items",
            {
                "description": str(r.get("description")).strip(),
                "billing_type": r.get("billing_type") or "Único",
                "qty": r.get("qty") or 1,
                "rate": r.get("rate") or 0,
                "discount_percentage": r.get("discount_percentage") or 0,
            },
        )
    doc.save(ignore_permissions=True)

    # El valor del negocio espeja la inversión inicial (o el abono si es sólo recurrente).
    d.reload()
    d.deal_value = doc.total_one_time_gross or doc.total_recurring_monthly_gross or None
    d.save(ignore_permissions=True)

    return {
        "name": doc.name,
        "version": doc.version,
        "status": doc.status,
        "totals": {
            "one_time_gross": doc.total_one_time_gross,
            "recurring_gross": doc.total_recurring_monthly_gross,
        },
    }
```

- [ ] **Step 3: Transiciones y PDF**

```python
def _quote_or_throw(name):
    if not frappe.db.exists("CRM Presupuesto", name):
        frappe.throw("El presupuesto no existe.")
    return frappe.get_doc("CRM Presupuesto", name)


@frappe.whitelist()
def send_quote(name):
    doc = _quote_or_throw(name)
    doc.send()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def accept_quote(name):
    doc = _quote_or_throw(name)
    doc.accept()
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def reject_quote(name, reason):
    doc = _quote_or_throw(name)
    doc.reject(reason)
    return {"ok": True, "status": doc.status}


@frappe.whitelist()
def new_quote_version(deal):
    from crm_core.mbcrm.doctype.crm_presupuesto.crm_presupuesto import new_version

    doc = new_version(deal)
    return {"name": doc.name, "version": doc.version}


@frappe.whitelist()
def quote_pdf(name):
    """PDF del presupuesto. `name` es el nombre del PRESUPUESTO."""
    from crm_core.documents import quote_context, render_quote_pdf

    if not frappe.db.exists("CRM Presupuesto", name):
        # Compatibilidad: si llega el negocio, resolver al presupuesto vigente.
        name = (
            frappe.db.get_value("CRM Presupuesto", {"deal": name, "is_current": 1}, "name") or name
        )
    ctx = quote_context(name)
    pdf = render_quote_pdf(name)
    fname = f"Presupuesto {ctx['quote_no']} - {ctx['client']['company']}.pdf"
    frappe.local.response.filename = re.sub(r'[\\/:*?"<>|]', "-", fname)
    frappe.local.response.filecontent = pdf
    frappe.local.response.type = "download"
```

- [ ] **Step 4: Verificar en el sitio de prueba**

```bash
BE=$(docker ps -qf name=crm_backend.1)
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm-test execute crm_core.fixtures.seed_verticales"
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm-test execute frappe.client.get_count --kwargs '{\"doctype\":\"CRM Vertical\"}'"
```
Expected: las 7 verticales creadas. Y que `save_quote` calcule: crear un presupuesto con un ítem
`Mensual` de 100.000 y verificar `total_recurring_monthly == 100000` y `total_recurring_monthly_gross == 121000`.

- [ ] **Step 5: Commit**

```bash
git add apps/crm_core/crm_core/api.py
git commit -m "feat(presupuesto): API del presupuesto con estados, versiones y PDF"
```

---

### Task 7: Limpiar los presupuestos de prueba

El usuario autorizó borrar los presupuestos viejos: son datos de prueba. `CRM Deal.products` queda
vacío y en desuso; el DocType **no** se modifica.

**Files:**
- Create: `scripts/cleanup_deal_products.py`
- Modify: `README.md` o `docs/runbook-crm-core.md` (nota de que el campo quedó en desuso)

**Interfaces:**
- Consumes: nada.
- Produces: nada (tarea de datos, de una sola vez).

- [ ] **Step 1: Escribir el script con `--dry-run`**

`scripts/cleanup_deal_products.py`:
```python
"""Vacía CRM Deal.products (los presupuestos viejos, que eran de prueba).

Los presupuestos ahora viven en el DocType CRM Presupuesto. El campo queda en
desuso hasta que se elimine en una fase posterior.

Uso:
    ... ./env/bin/python cleanup_deal_products.py --dry-run
    ... ./env/bin/python cleanup_deal_products.py
"""
import sys

sys.path.insert(0, "/home/frappe/frappe-bench/apps")

import frappe

DRY = "--dry-run" in sys.argv


def main():
    frappe.init("crm.marcosbarbosagroup.com", sites_path="/home/frappe/frappe-bench/sites")
    frappe.connect()
    frappe.flags.in_install_db = False

    con_items = [
        r.name
        for r in frappe.get_all("CRM Deal", fields=["name"], limit_page_length=0)
        if frappe.get_all("CRM Products", filters={"parent": r.name}, limit=1)
    ]
    print(f"negocios con ítems en CRM Deal.products: {len(con_items)} -> {con_items}")
    if DRY:
        print("dry-run: no se toca nada")
        return

    for name in con_items:
        frappe.db.sql("delete from `tabCRM Products` where parent=%s", name)
    frappe.db.commit()
    print("listo. negocios con ítems ahora:", 0)


main()
```

- [ ] **Step 2: Dry-run en producción**

```bash
ssh root@2.28.121.92
BE=$(docker ps -qf name=crm_backend.1)
docker cp /opt/crm-marcosbarbosagroup/scripts/cleanup_deal_products.py "$BE":/home/frappe/
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && ./env/bin/python /home/frappe/cleanup_deal_products.py --dry-run"
```
Expected: lista los negocios que tienen ítems y **no** modifica nada.

- [ ] **Step 3: Ejecutar (después de un backup)**

```bash
ssh root@2.28.121.92 'bash /opt/crm-marcosbarbosagroup/scripts/backup/backup-gdrive.sh'
BE=$(docker ps -qf name=crm_backend.1)
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && ./env/bin/python /home/frappe/cleanup_deal_products.py"
```
Expected: `listo. negocios con ítems ahora: 0`. El backup previo es la red: si algo sale mal, está el
`.sql.gz` en Google Drive.

- [ ] **Step 4: Commit**

```bash
git add scripts/cleanup_deal_products.py docs/runbook-crm-core.md
git commit -m "chore(presupuesto): script de limpieza de los presupuestos de prueba"
```
---

### Task 8: Frontend — el presupuesto con estados, versión y dos totales

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/DealDrawer.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: la API de Task 6.
- Produces: la pestaña Presupuesto de F2. La consume Task 10 (E2E).

- [ ] **Step 1: Tipos y métodos en `api.ts`**

Agregar a `DealDetail` el objeto del presupuesto y **quitar** `items` y `total` (los reemplaza):

```ts
export type BillingType = "Único" | "Mensual" | "Trimestral" | "Anual";
export type QuoteStatus = "Borrador" | "Enviado" | "Aceptado" | "Rechazado" | "Vencido" | "Anulado";

export interface QuoteItemDTO {
  description: string;
  billing_type: BillingType;
  qty: number;
  rate: number;
  discount_percentage: number;
  net_amount: number;
}

export interface QuoteDTO {
  name: string;
  version: number;
  status: QuoteStatus;
  currency: string;
  iva_mode: IvaMode;
  valid_until: string;
  conditions: string;
  notes: string;
  recurring_summary: string;
  is_editable: boolean;
  totals: {
    one_time_net: number;
    one_time_iva: number;
    one_time_gross: number;
    recurring_net: number;
    recurring_iva: number;
    recurring_gross: number;
    discount: number;
  };
  items: QuoteItemDTO[];
}

export type IvaMode = "sumar" | "incluido" | "exento";
```
y en `DealDetail`: `quote: QuoteDTO | null;`

Métodos nuevos (y `saveQuote` cambia de firma: recibe el **negocio**, no el presupuesto):

```ts
  saveQuote: (
    deal: string,
    items: Array<{
      description: string;
      billing_type: BillingType;
      qty: number;
      rate: number;
      discount_percentage: number;
    }>,
    opts: { ivaMode: IvaMode; validUntil?: string; conditions?: string; currency?: string } ,
  ) =>
    post<{ name: string; version: number; status: string }>("crm_core.api.save_quote", {
      deal,
      items,
      iva_mode: opts.ivaMode,
      valid_until: opts.validUntil ?? null,
      conditions: opts.conditions ?? null,
      currency: opts.currency ?? null,
    }),
  sendQuote: (name: string) =>
    post<{ ok: boolean; status: string }>("crm_core.api.send_quote", { name }),
  acceptQuote: (name: string) =>
    post<{ ok: boolean; status: string }>("crm_core.api.accept_quote", { name }),
  rejectQuote: (name: string, reason: string) =>
    post<{ ok: boolean; status: string }>("crm_core.api.reject_quote", { name, reason }),
  newQuoteVersion: (deal: string) =>
    post<{ name: string; version: number }>("crm_core.api.new_quote_version", { deal }),
```
`quotePdf` pasa a recibir el nombre del **presupuesto**; ajustar el tipo si estaba como `ivaMode`
(ya no hace falta: el IVA vive en el documento):
```ts
  quotePdf: (quoteName: string) => postBlob("crm_core.api.quote_pdf", { name: quoteName }),
```

- [ ] **Step 2: La pestaña Presupuesto en `DealDrawer.tsx`**

Cambios de comportamiento (el resto del drawer no se toca):

1. El estado local de filas suma `billing_type`:
   ```tsx
   type Row = { description: string; billing_type: BillingType; qty: string; rate: string; discount: string };
   const EMPTY_ROW: Row = { description: "", billing_type: "Único", qty: "1", rate: "", discount: "" };
   ```
2. Al cargar (`api.getDeal`), llenar `rows` desde `d.quote.items` (si `d.quote` existe) y guardar
   `quoteName`, `quoteStatus`, `quoteVersion`, `isEditable`, y `ivaMode` desde `d.quote.iva_mode`.
   Si `d.quote` es `null`, el presupuesto se crea al guardar (como hoy).
3. **Si `!isEditable`** (el presupuesto no está en borrador): la grilla de ítems se muestra en
   **sólo lectura** (inputs `disabled`), y el pie cambia: en vez de "Guardar presupuesto" aparece
   **"Crear versión nueva"** (`api.newQuoteVersion(dealName)` y recargar). El selector de IVA
   también se deshabilita. Así el congelamiento se ve, no se descubre con un error.
4. El selector de IVA (`seg`) y las acciones describen el estado: arriba de la grilla, una línea
   con `Presupuesto v{version} · {estado}` usando una píldora:
   ```tsx
   <span className={`pill st-${quoteStatus?.toLowerCase()}`}>{quoteStatus}</span>
   ```
5. Los totales se muestran **separados**, respetando el diseño de dos bases de tiempo:
   ```tsx
   <div className="quote-sum">
     {totals.recurring_net > 0 ? (
       <>
         <div className="qs-row"><span>Abono mensual (neto)</span><span>{money(totals.recurring_net)}</span></div>
         {ivaMode !== "exento" ? (
           <div className="qs-row"><span>IVA 21%{ivaMode === "incluido" ? " (incluido)" : ""}</span><span>{money(totals.recurring_iva)}</span></div>
         ) : null}
         <div className="qs-total"><span>Abono mensual</span><strong>{money(totals.recurring_gross)}</strong></div>
         {recurringSummary ? <div className="qs-sub">{recurringSummary}</div> : null}
       </>
     ) : null}
     {totals.one_time_net > 0 ? (
       <>
         <div className="qs-row"><span>Inversión inicial (neto)</span><span>{money(totals.one_time_net)}</span></div>
         {ivaMode !== "exento" ? (
           <div className="qs-row"><span>IVA 21%{ivaMode === "incluido" ? " (incluido)" : ""}</span><span>{money(totals.one_time_iva)}</span></div>
         ) : null}
         <div className="qs-total"><span>Inversión inicial</span><strong>{money(totals.one_time_gross)}</strong></div>
       </>
     ) : null}
   </div>
   ```
   **Los totales que se muestran son los que devolvió el servidor** (`d.quote.totals`), no una cuenta
   local: el cliente no recalcula dinero. Tras guardar, se recarga con `api.getDeal` para tomar los
   números nuevos. Mientras se edita, la vista previa local puede mostrar la suma de las filas, pero
   los totales grandes salen siempre del servidor.
6. Cada fila de la grilla suma un `<select>` de tipo de cobro entre Descripción y Cantidad:
   ```tsx
   <select value={r.billing_type} onChange={(e) => setRow(i, "billing_type", e.target.value)}>
     {["Único", "Mensual", "Trimestral", "Anual"].map((b) => <option key={b} value={b}>{b}</option>)}
   </select>
   ```
   Ancho de la columna: ~92px. El encabezado de la grilla pasa a: Descripción · **Cobro** · Cant. · Precio · Desc. % · Importe.
7. Acciones del ciclo en el pie (sólo cuando hay presupuesto):
   - `Borrador` → "Ver presupuesto" · "Enviar" · "Guardar presupuesto"
   - `Enviado` → "Ver presupuesto" · "Aceptar" · "Rechazar"
   - `Aceptado`/`Rechazado`/`Vencido`/`Anulado` → "Ver presupuesto" · "Crear versión nueva"
   "Rechazar" pide el motivo con un `prompt`-free approach: abre un campo de texto en el pie (nada
   de `window.prompt`, rompe el lenguaje visual) y confirma con un botón.
   "Enviar", "Aceptar" y "Rechazar" hacen su llamada y **recargan** con `api.getDeal`.

- [ ] **Step 3: Estilos**

Agregar en `styles.css` (junto a los del presupuesto que ya existen):
```css
.pill { font-size: 11px; font-weight: 650; border-radius: 999px; padding: 2px 9px; border: 1px solid var(--border); color: var(--fg-dim); }
.pill.st-borrador { color: var(--fg-dim); }
.pill.st-enviado { color: #60a5fa; border-color: rgba(96, 165, 250, 0.35); }
.pill.st-aceptado { color: var(--ok); border-color: rgba(52, 211, 153, 0.35); }
.pill.st-rechazado, .pill.st-anulado { color: var(--danger); border-color: rgba(255, 90, 90, 0.35); }
.pill.st-vencido { color: #f59e0b; border-color: rgba(245, 158, 11, 0.35); }
.qs-sub { font-size: 12px; color: var(--fg-faint); text-align: right; margin-top: 3px; }
.quote-row select { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--fg); font-family: inherit; font-size: 13px; padding: 7px 6px; outline: none; }
.quote-head, .quote-row { grid-template-columns: minmax(96px, 1fr) 92px 52px 86px 56px 98px 26px; }
.quote-row input:disabled, .quote-row select:disabled { opacity: 0.6; cursor: not-allowed; }
.quote-frozen { font-size: 12.5px; color: #f59e0b; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 9px; padding: 8px 11px; margin-bottom: 12px; }
```
La grilla pasa de 6 a 7 columnas: subir el `min-width` de `.quote-head, .quote-row` a `560px` para
que en el drawer ancho (560px) entren todas, y mantener el `overflow-x: auto` en mobile.

- [ ] **Step 4: Verificar tipos y build**

Run: `cd apps/web && npm run typecheck && npm run build`
Expected: ambos PASS. El build regenera `apps/crm_core/crm_core/www/hoy.html`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/DealDrawer.tsx apps/web/src/styles.css \
        apps/crm_core/crm_core/www/hoy.html
git commit -m "feat(presupuesto): estado, version, tipo de cobro y dos totales en la UI"
```

---

### Task 9: Deploy con `migrate`

Sin esto los DocTypes nuevos existen en disco pero **no en la base**. Es la primera vez que se corre
`migrate` en producción desde que existe el stack: por eso va con backup previo y verificación.

**Files:**
- Modify: `scripts/deploy-crm.sh`

**Interfaces:**
- Consumes: `scripts/deploy-crm.sh` (de F1).
- Produces: el flag `--migrate`. Lo consume Task 10.

- [ ] **Step 1: Agregar el flag al script**

En `scripts/deploy-crm.sh`, después del `for` que actualiza los servicios y antes de la verificación,
insertar:

```bash
MIGRATE=0
for arg in "$@"; do
  [ "$arg" = "--migrate" ] && MIGRATE=1
done

if [ "$MIGRATE" = "1" ]; then
  echo "backup previo al migrate…"
  docker exec "$(docker ps -qf name=crm_backend)" bench --site crm.marcosbarbosagroup.com backup >/dev/null
  echo "migrate…"
  docker exec "$(docker ps -qf name=crm_backend)" \
    bench --site crm.marcosbarbosagroup.com migrate 2>&1 | tail -20
fi
```
Y ajustar el parseo del tag para que ignore el flag:
```bash
NEW="${1:?uso: deploy-crm.sh <tag-nuevo> [--migrate]}"
```

Agregar también, al final, la verificación de que los DocTypes quedaron creados:

```bash
if [ "$MIGRATE" = "1" ]; then
  CANT=$(docker exec "$(docker ps -qf name=crm_backend)" \
    bench --site crm.marcosbarbosagroup.com execute frappe.client.get_count \
    --kwargs '{"doctype":"DocType","filters":{"module":"MbCRM"}}' 2>/dev/null | tail -1)
  echo "DocTypes en MbCRM tras migrate: $CANT (esperado >= 15)"
fi
```

- [ ] **Step 2: Desplegar y migrar**

```bash
cd /opt/crm-marcosbarbosagroup && bash scripts/deploy-crm.sh 60 --migrate
```
Expected: `DEPLOY OK: crm-mb:60`, los 5 servicios en `1/1`, el migrate sin errores y
`DocTypes en MbCRM tras migrate: >= 15`.

Si el migrate falla: **no seguir**. Leer el error (casi siempre es un JSON de DocType inválido), y el
backup del Step anterior está en Google Drive para volver atrás.

- [ ] **Step 3: Sembrar las verticales en producción**

```bash
BE=$(docker ps -qf name=crm_backend.1)
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm.marcosbarbosagroup.com execute crm_core.fixtures.seed_verticales"
docker exec "$BE" bash -lc "cd /home/frappe/frappe-bench && bench --site crm.marcosbarbosagroup.com execute frappe.client.get_count --kwargs '{\"doctype\":\"CRM Vertical\"}'"
```
Expected: `7`.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-crm.sh
git commit -m "feat(deploy): migrate opcional con backup y verificacion de DocTypes"
```

---

### Task 10: Verificación en pantalla y cierre

**Files:**
- Create: `scripts/e2e-presupuesto.mjs`
- Modify: `docs/runbook-crm-core.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el test de aceptación de F2.

- [ ] **Step 1: Escribir el E2E**

`scripts/e2e-presupuesto.mjs` — mismo molde que `scripts/e2e-pdf-viewer.mjs` (crea su negocio, lo
borra en `finally`, exit code por fallas). Debe verificar, con un presupuesto **mixto**
(un ítem `Único` de 850.000 y uno `Mensual` de 210.000):

1. `save_quote` devuelve un nombre de presupuesto y la tarjeta del negocio muestra el valor.
2. En la UI, la pestaña Presupuesto muestra **dos bloques**: "Inversión inicial" y "Abono mensual".
3. La píldora de estado dice `Borrador`.
4. El `<select>` de cobro por fila existe y la fila mensual tiene `Mensual` seleccionado.
5. Al pulsar "Enviar": la píldora pasa a `Enviado`, los ítems quedan `disabled` y el pie muestra
   "Crear versión nueva" (el congelamiento se ve).
6. "Crear versión nueva" → la píldora vuelve a `Borrador` y el texto dice `v2`.
7. El visor abre y el PDF del presupuesto mixto muestra ambos bloques (chequear con el harness
   local, no en el E2E, porque en headless el PDF no renderiza).

- [ ] **Step 2: Correr el E2E contra producción**

```bash
# key temporal
ssh root@2.28.121.92 'BE=$(docker ps -qf name=crm_backend.1); docker exec -u root "$BE" bash -c "mkdir -p /home/frappe/logs /home/frappe/frappe-bench/crm.marcosbarbosagroup.com/logs && chown -R frappe:frappe /home/frappe/logs /home/frappe/frappe-bench/crm.marcosbarbosagroup.com/logs" && docker cp /opt/crm-marcosbarbosagroup/scripts/tmp_admin_key.py "$BE":/home/frappe/k.py && docker exec "$BE" bash -c "cd /home/frappe/frappe-bench && MODE=create FRAPPE_SITE=crm.marcosbarbosagroup.com ./env/bin/python /home/frappe/k.py 2>&1 | tail -2"'
TOKEN="<KEY>:<SECRET>" node scripts/e2e-presupuesto.mjs
```
Expected: todas las aserciones OK, exit 0.

- [ ] **Step 3: Verificación visual obligatoria**

Capturar con Playwright **en modo headed** (`chromium.launch({ headless: false })`, porque en
headless Chrome no renderiza PDFs) y revisar a ojo:
- La pestaña Presupuesto con los **dos bloques de totales** y el selector de cobro por fila.
- El estado `Enviado` con los ítems bloqueados y el aviso de congelado.
- El PDF del presupuesto mixto (dos bloques, tag "Mensual" en la fila recurrente).
- Desktop (1280) y mobile (390), verificando que **nada quede tapado por el nav**.

- [ ] **Step 4: Limpiar y cerrar**

- Borrar el negocio/organización de prueba (el E2E ya borra el negocio; la organización queda: usar el
  patrón de limpieza de F1).
- Borrar la API key (`MODE=remove`).
- Borrar los scripts temporales de captura.
- Commit final del runbook.

```bash
git add docs/runbook-crm-core.md && git commit -m "docs(runbook): presupuesto como documento propio (estados, versiones, dos totales)"
```

---

## Self-Review

**1. Cobertura del spec**
- §4.1 `CRM Vertical` → Task 3. §4.2 `CRM Presupuesto` → Task 3. §4.3 `CRM Presupuesto Item` con
  `billing_type` → Task 3.
- Los **dos totales** y la regla de no sumar bases distintas → Task 1 (matemática, con test explícito
  que prohíbe la suma) y Task 5 (PDF).
- §5.1 estados, transiciones y congelamiento → Task 4. `Facturado` como derivado: no se implementa
  en F2 (llega con facturas en F3), y **no** existe como estado en el DocType (verificado en la lista
  de `status` de Task 3).
- §6.2 MRR normalizado (`net / interval_months`) → `total_recurring_monthly` en Task 1.
- §8 visor/congelamiento (`snapshot_hash`) → Task 4.
- §13 limpieza de los presupuestos de prueba → Task 7.
- Moneda por cliente → Task 6 (`save_quote` toma la moneda de la organización, editable por
  documento). Vencimiento editable a mano → el campo `valid_until` es un `Date` normal, sin
  cálculo automático: lo setea quien lo pase y nunca se recalcula solo.
- **Fuera de F2 y declarado:** suscripciones (F4) — `accept_quote` no las crea; facturas (F3);
  dashboard (F5); AFIP (F6).

**2. Placeholders:** no hay `TBD`/`TODO`. Las listas de campos de los DocTypes se especifican por
tabla de valores en Task 3 más la referencia al spec §4.2, que es la autoridad: el ejecutor tiene
los `fieldname`, tipos, opciones, defaults y flags. Los `<KEY>:<SECRET>` salen del comando del Step 2
de Task 10.

**3. Consistencia de tipos:** `quote_totals` devuelve las claves que consumen el controller (Task 3,
vía `TOTAL_FIELDS`), `documents.quote_context` (Task 5) y `get_deal` (Task 6). `interval_months` se
usa en Task 3 y Task 1. Los nombres del DocType (`total_one_time_gross`, etc.) coinciden entre
Task 3, 5, 6 y 8. El frontend tipa `BillingType`/`QuoteStatus`/`IvaMode` en Task 8 y los usa el mismo
task.

**4. Riesgo residual:** el `migrate` sobre producción es la operación más delicada de todo el plan
(es la primera vez que corre). Mitigado con backup previo automático, verificación del conteo de
DocTypes y un script de deploy que nunca enmascara el exit code.

## Apéndice (opt-in, requiere autorización del usuario)

**Borrar los 12 DocTypes muertos del módulo MbCRM.** Son de la Fase 0: `Deal`, `Lead`, `Task`,
`Account`, `Activity`, `Event Attendee`, `GCal Connection`, `GCal Sync State`, `Sync Conflict`,
`Contact Phone` (0 filas) y `Contact`, `Contact Email` (3 filas de prueba). Duplican el modelo real.
Es **destructivo** (borra tablas), así que:

1. No se ejecuta sin que el usuario lo apruebe explícitamente.
2. `bench --site <site> delete-doctype <Nombre>` por cada uno, **jamás** tocando los `CRM *` del app
   `crm`.
3. Antes: backup. Después: verificar que la UI sigue funcionando y que `CRM Deal`/`CRM Lead`/`CRM Task`
   siguen intactos.
4. Alternativa más conservadora: dejarlos y sólo documentar el hallazgo. Costo: confusión permanente
   en el modelo de datos.

## Roadmap

- **F3** — `CRM Factura`, `CRM Factura Item`, `CRM Pago`, estados y PDF de factura. Depende del estado
  `Aceptado` de F2 y del `quote_pdf` para reusar `documents.py`.
- **F4** — `CRM Suscripcion`, bandeja **Por facturar** y job diario. Es donde `accept_quote` empieza a
  crear documentos.
- **F5** — Dashboard e Informes, sobre los datos de F3 y F4.
- **F6** — Emisor AFIP/ARCA (`CRM Emisor` + `InvoiceIssuer`).
