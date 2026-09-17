# Cómo se despliega y verifica una vista nueva en producción

**Fecha:** 2026-09-17
**Alcance:** reemplazo de la agenda de `/hoy` (tres vistas, arrastre, panel, diálogos, teclado) en un Frappe v15 single-user, Docker Swarm, frontend React embebido en base64 en `www/hoy.html`.
**Tema:** verificación de UI en prod, E2E contra app desplegada, a11y en CI, deploy seguro en Frappe, monitoreo de errores.
**Regla:** cada afirmación concreta lleva URL de fuente. Lo que no pude verificar está marcado como tal.

---

## TL;DR

- **El hallazgo que ordena todo:** `scripts/deploy-crm.sh` decide si el deploy está bien mirando `1/1` y un HTTP 200/301/302 (`scripts/deploy-crm.sh:73-99`). Con un frontend que renderiza en el cliente, **un bundle roto igual devuelve 200**. El health check del script no puede ver la falla; el único gate real es un E2E que afirme **cero `pageerror`** y que las tres vistas monten.
- **Para un solo usuario, la ceremonia de feature flags sobra.** Un canary por porcentaje es matemáticamente vacío (n=1). Ruta paralela `/hoy-nuevo` es la única variante barata y honesta; aun así, con un solo usuario que sos vos, *vos sos el canary* (lo que Fowler/Hodgson llaman "champagne brunch": la feature se expone a un conjunto específico de usuarios; acá ese conjunto es una persona). Fuente: https://martinfowler.com/articles/feature-toggles.html
- **La a11y con axe es complementaria, no redundante.** axe **no tiene ninguna regla** para contraste del indicador de foco (1.4.11/2.4.11), ni para contraste de líneas/bordes de UI (1.4.11), ni para existencia/persistencia de `aria-live` (4.1.3), ni para orden de foco (2.4.3, solo una experimental `focus-order-semantics`). `target-size` (2.5.8) existe pero **viene apagada por defecto**. Todo eso es exactamente lo que mide `scripts/audit-agenda-proto.mjs`.
- **`jest-axe` no sirve acá:** corre en jsdom y el propio README de axe-core dice que `color-contrast` no funciona en JSDOM. El harness custom tampoco corre en CI de GitHub (necesita el sitio real con login).
- **Deploy seguro:** `bench migrate` sincroniza schema/fixtures/páginas web por checksum MD5 y **no borra columnas** al quitar/renombrar campos (https://docs.frappe.io/framework/user/en/database-migrations). Pero `deploy-crm.sh` swapea los 5 servicios y *después* migra (`scripts/deploy-crm.sh:55-68`): hay una ventana con frontend nuevo contra DB sin el campo nuevo. Recomendación: migrar **antes** que el frontend (dos deploys o frontend defensivo).
- **Monitoreo mínimo:** un handler global de `error`/`unhandledrejection` que postee al Error Log de Frappe alcanza y sobra para saber que la vista se rompió. Sentry es opcional y tiene un problema conocido con bundles sin sourcemaps.

---

## 0. El hecho que cambia el diseño de la verificación

El deploy actual verifica servicios y HTTP (`scripts/deploy-crm.sh:73-99`), pero **no ejecuta JavaScript**. Un `import()` de un bundle base64/Blob que tira `SyntaxError` (por ejemplo, si `gen-shell.mjs` no se regeneró, si se cortó el bundle, o si un `TypeError` en el arranque mata el render) sigue devolviendo `200 OK` en `/hoy`.

Esto tiene tres consecuencias directas:

1. **El gate de verdad es el E2E, no el health check.** `scripts/e2e_hoy.mjs:17-21` ya captura `pageerror` y `console.error`, pero **no los afirma**: solo los imprime. Convertir esa captura en aserción es el cambio de mayor valor por línea de todo el plan.
2. **El rollback del script no se dispara por una UI rota.** `FAIL=1` solo si algún servicio no está `1/1` o si el HTTP no es 200/301/302 (`scripts/deploy-crm.sh:73-85`). Una vista rota no cumple ninguna de las dos.
3. **El script actualiza imagen y migra en ese orden** (`scripts/deploy-crm.sh:55-68`), así que el frontend nuevo corre, por unos segundos, contra el schema viejo. Ver §4.

---

## 1. Verificar un cambio de UI en producción (sin romperla)

### Opciones

| Opción | Qué da | Qué cuesta | Fuente |
|---|---|---|---|
| **Nada: deploy + E2E + rollback de imagen** | Con un usuario, el "rollout" es instantáneo: si el E2E post-deploy pasa, listo; si no, `deploy-crm.sh <tag-previo>` reapunta los servicios. Costo casi cero y ya está implementado. | No hay control fino; no se puede "probar con el 1% de los usuarios" porque no hay 1%. | `scripts/deploy-crm.sh:80-85`; Fowler/Hodgson https://martinfowler.com/articles/feature-toggles.html |
| **Feature flag on/off por config/env** (build-time o startup-time) | Permite dejar el código nuevo "latente" y prenderlo/apagarlo sin redeploy. Hodgson: para decisiones estáticas, `if/else` sobre config alcanza; "prefer static configuration". | Un toggle más que mantener y retirar. Fowler: "release flags should be your last choice"; hay que jubilarlos apenas la feature se asienta. | https://martinfowler.com/articles/feature-toggles.html · https://www.martinfowler.com/bliki/FeatureFlag.html |
| **Feature flag self-hosted** (Unleash, Flagsmith, `bandeira`, `flagz`, `openflags`) | API de evaluación + panel + targeting por usuario/porcentaje. `bandeira` y `flagz` son binario único + SQLite; `flagz` ni siquiera usa la DB en el hot path. | Un servicio más en el VPS (CPU/RAM, backup, updates). Para un usuario no compra nada que no dé el rollback. | https://github.com/felipekafuri/bandeira · https://github.com/matt-riley/flagz · https://github.com/huextrat/openflags |
| **OpenFeature** (estándar CNCF, vendor-neutral) | API común para no casarse con un vendor; el SDK web tiene providers, multi-provider, OFREP. | Es un **contrato**, no un servicio: igual hay que implementar/proveer el backend de flags. Overkill acá. | https://openfeature.dev/ · https://openfeature.dev/docs/reference/sdks/client/web/ |
| **Ruta paralela** (`/hoy-nuevo` al lado de `/hoy`) | Canary "manual": comparás una contra la otra en la misma app, sin tocar tráfico. La app ya sabe reflejar estado en la URL (`?view=&zoom=`), así que una ruta hermana cuesta poco. | Dos templates generados y dos puntos que mantener; hay que decidir cuándo borrar la vieja. | Plan de port: `docs/superpowers/plans/2026-09-17-agenda-port-a-prod.md:73-84` |
| **Canary por porcentaje** (Traefik WRR) | Reparte tráfico entre dos versiones por pesos (5% → 50% → 100%), con rollback cambiando el peso a 0. Requiere dos backends vivos sirviendo versiones distintas. | Para n=1 el "porcentaje" es 0% o 100%. Además exige mantener dos despliegues y sticky sessions. | https://doc.traefik.io/traefik/master/reference/routing-configuration/http/load-balancing/service/ · https://doc.traefik.io/traefik-hub/api-gateway/expose/services/api-gateway-canary |
| **Blue-green** | Dos entornos idénticos; se corta el tráfico al verde. El rollback es instantáneo. | Duplicar el stack (5 servicios × MariaDB/Redis) en un VPS single-user es desproporcionado. | https://martinfowler.com/bliki/BlueGreenDeployment.html |
| **Dogfooding interno / "champagne brunch"** | Exponer la feature a un conjunto específico de usuarios (en vez de una cohorte aleatoria como el canary). | Acá el conjunto específico = el dueño. Es literalmente "usarla vos". Sin infraestructura extra. | https://martinfowler.com/articles/feature-toggles.html |

### Recomendación

**No agregar feature flags ni canary.** Con un usuario, la decisión honesta es: desplegar, correr el E2E contra el sitio real, y si algo no cierra, `deploy-crm.sh <tag-previo>`. El "porcentaje" y las cohortes no tienen sentido con n=1, y un toggle self-hosted sería más superficie operativa (un servicio nuevo que puede caerse) que la feature que intenta proteger.

Dos matices que sí valen:

- **La ruta paralela `/hoy-nuevo` es la única ceremonia barata con retorno real** *si* querés comparar las dos agendas por un rato. La app ya tiene el router de vistas en la URL; servir el shell nuevo en una ruta hermana y dejar `/hoy` vieja una semana cuesta una copia del template. Pero si el plan es reemplazar de una, no la agregues.
- **Lo que reemplaza al canary es el rollback por imagen**, que ya existe y es el mecanismo correcto acá. Lo único que le falta es dispararse también cuando el **E2E** falla, no solo cuando falla el HTTP (§2).

---

## 2. Smoke tests y E2E contra la app desplegada

Esta es la parte que más valor tiene para el caso.

### 2.1 El estado actual

`scripts/e2e_hoy.mjs` y `scripts/e2e_agenda.mjs` usan la librería `playwright` "cruda" (no `@playwright/test`), sin `playwright.config`, sin baseURL, sin storageState, y con `waitUntil: "networkidle"` (`scripts/e2e_hoy.mjs:10-23`). Capturan errores pero no fallan por ellos. La autenticación es un token de API por header (`Authorization: token KEY:SEC`), generado por `scripts/tmp_admin_key.py` y borrado después (runbook, `docs/runbook-crm-core.md:76-83`).

### 2.2 Opciones

| Opción | Qué da | Qué cuesta | Fuente |
|---|---|---|---|
| **`@playwright/test` + `playwright.config.ts`** con `baseURL` | Runner con config: `retries`, `workers`, `forbidOnly`, reporter HTML, `trace`. `baseURL` permite navegar con rutas relativas. Hoy no hay config y CI no corre E2E (`.github/workflows/ci.yaml`). | Migrar los scripts de librería a specs. Chico, pero es trabajo real. | https://playwright.dev/docs/test-configuration · https://playwright.dev/docs/test-use-options |
| **Auth por `storageState`** (setup project) | Se loguea una vez, se guarda cookies/localStorage/IndexedDB en `playwright/.auth/user.json` (gitignoreado) y todos los tests arrancan autenticados. Documentado como el patrón recomendado. | Hay que resolver el login en el setup. Para Frappe se puede por `request.post('/api/method/login')` o generando un token. | https://playwright.dev/docs/auth |
| **Auth por token de API (actual)** | Un header y listo; sirve para `www` y para `/api/method`. Roles del usuario del token. | El script actual crea un API key de **Administrator** temporal. Si el proceso se corta, queda una llave de admin viva. Mejor un usuario de test dedicado. | https://docs.frappe.io/framework/user/en/api/rest · `scripts/tmp_admin_key.py` |
| **`retries` en CI** | Re-ejecuta fallos intermitentes; categoriza passed/flaky/failed. `failOnFlakyTests` falla si un test pasó solo al reintentar. Config típica: `retries: process.env.CI ? 2 : 0`. | Solo tiene sentido en CI. Acá el E2E va contra prod (necesita red/credenciales de prod), así que probablemente corra local o desde el VPS, no en GitHub Actions. | https://playwright.dev/docs/test-retries · https://playwright.dev/docs/test-configuration |
| **`networkidle` (lo que hace hoy)** | Espera a que no haya conexiones por 500 ms. | **Playwright lo marca explícitamente DISCOURAGED**: "Don't use this method for testing, rely on web assertions to assess readiness instead." Con un bundle base64 grande e import dinámico puede dar timeouts o falsos "listo". | https://playwright.dev/docs/api/class-page (option de `goto`) |
| **`page.route` para mockear red** | Interceptar `/api/*` para probar estados de error (500, lento, vacío). | **No funciona con `blob:` en Chromium/Firefox.** El propio test de Playwright está marcado `it.fixme(browserName !== 'webkit')`: solo WebKit lo intercepta. Como el bundle corre desde un Blob, no podés mockear la red de la app. | https://github.com/microsoft/playwright/blob/c0cc9802/tests/page/interception.spec.ts |

### 2.3 Lo que sí o sí hay que afirmar (porque HTTP 200 no prueba nada)

Un E2E post-deploy debería:

1. **Cero `pageerror` y cero `console.error`** desde la navegación hasta después de montar las tres vistas. Esto es lo que atrapa el bundle roto.
2. **Las tres vistas montan** (Semana, Lista, Mes) y el cambio de vista ocurre **sin recargar**.
3. **Una operación real de punta a punta** con limpieza: crear → mover → duplicar → eliminar una reunión de prueba, y verificar por API que no quedó residuo. El repo ya tiene ese patrón en `scripts/smoke_prod.py:16-29` (INSERT → READ → DELETE, sin residuo) y en el plan (`docs/superpowers/plans/2026-09-17-agenda-port-a-prod.md:137`).
4. **El camino por teclado**: al menos abrir el panel con `n` (con foco en la grilla), cerrar con `Escape`, y comprobar que el foco vuelve.
5. **Un chequeo de que el bundle es el nuevo**: exponer la versión/imagen (p. ej. `window.__crm_release`) y afirmarla. Sin esto, un deploy que no cambió nada también "pasa".

### 2.4 Auth concreta para este caso

Frappe documenta dos vías (https://docs.frappe.io/framework/user/en/api/rest):

- **Token** (`Authorization: token api_key:api_secret`) — es lo que usan los scripts hoy. Los roles se evalúan contra el usuario dueño del token. **No usar Administrator**: crear un usuario de test con rol mínimo, o reusar el usuario del sync de Google.
- **Password/sesión** (`POST /api/method/login`, cookie) — encaja perfecto con `storageState`: el setup project hace el login y guarda la cookie. Frappe devuelve `Logged In` y setea las cookies.

Recomendación: **usuario de test dedicado + `storageState`, no Administrator temporal.** El `tmp_admin_key.py` fue una solución de arranque; con E2E recurrente es un riesgo (llave de admin efímera que puede quedar viva). Un usuario de test con API key fija, guardada como secreto, loguea por `/api/method/login` y guarda el estado una vez por corrida.

### 2.5 Pitfalls específicos del bundle base64/Blob

| Pitfall | Detalle | Fuente |
|---|---|---|
| **No se puede interceptar la red** | El código se ejecuta desde `URL.createObjectURL(blob)` y `import()`. `page.route` no intercepta `blob:` en Chromium/Firefox (solo WebKit). **No hay forma de mockear `/api`** para probar estados de error: hay que inyectarlos con `page.addInitScript`/`page.evaluate` o pegarle a la API real. | `apps/web/gen-shell.mjs:36-44`; https://github.com/microsoft/playwright/blob/c0cc9802/tests/page/interception.spec.ts |
| **CSP rompería el import** | `blob:` es un *scheme source*; `'self'` y `*` **no** matchean `blob:`. Si algún día Frappe/Traefik/nginx agrega `Content-Security-Policy: script-src 'self'`, el bundle deja de ejecutarse. Hoy no hay CSP (verificado: `docs/traefik-crm.yml` no define ninguna). | https://github.com/w3c/webappsec-csp/issues/487 · https://centralcsp.com/en/blog/csp-blob-scheme |
| **Sin sourcemaps, stack traces ilegibles** | Los errores apuntan a URLs `blob:` con código minificado. Para depurar un `TypeError`, correr el mismo bundle con sourcemaps en local; en prod los `pageerror` van a ser crípticos. | inferencia de `gen-shell.mjs` (no verifiqué si Vite emite sourcemaps en este build) |
| **HTML gigante en el DOM** | El template embebe el bundle entero en base64 (`gen-shell.mjs:36-47`). `page.content()` y el parseo del HTML cargan MBs; evitar capturas de `content()` y preferir locators. | `apps/web/gen-shell.mjs` |
| **`networkidle`** | Ver §2.2. | https://playwright.dev/docs/api/class-page |

### 2.6 Recomendación con tradeoff

**Adoptar `@playwright/test` con `playwright.config.ts`, `baseURL`, un `setup` project con usuario de test y `storageState`, y convertir el E2E actual en un gate post-deploy que afirme cero `pageerror` y un CRUD real con limpieza.** El tradeoff es el costo de migrar los scripts y mantener un usuario de test; el retorno es que **es lo único que puede detectar un bundle roto** dado que HTTP 200 miente. Los `retries` quedan en 0 si el E2E corre local/desde el VPS (no hay flakiness de CI que justifique reintentos, y reintentar contra prod puede enmascarar un problema real de timing); si algún día corre en Actions, `retries: 2` + `trace: 'on-first-retry'`.

---

## 3. A11y como test de regresión en CI

### 3.1 Opciones

| Opción | Qué da | Qué cuesta | Fuente |
|---|---|---|---|
| **`@axe-core/playwright`** | Motor axe-core dentro de Playwright. Es el único que llega a **estados interactivos**: abrís el panel/diálogo/menú y recién ahí escaneás. `AxeBuilder` con `.include()`, `.withTags()`, `.exclude()`; se recomienda un fixture con config compartida. | Dependencia nueva; hay que decidir las tags (por defecto corre reglas que no son WCAG). WCAG 2.2 viene apagado por defecto. | https://playwright.dev/docs/accessibility-testing · https://www.npmjs.com/package/@axe-core/playwright |
| **`pa11y-ci`** | Crawlea una lista/sitemap de URLs, un código de salida. Ideal para un sitio con muchas páginas estáticas. | **No llega a nada detrás de login, diálogo ni cambio de ruta cliente**. Para esta app no sirve. Runner alternativo HTML_CodeSniffer es más ruidoso. | https://www.web-accessibility-a11y.com/web-accessibility-testing-fundamentals-tool-selection/ |
| **Lighthouse CI** | Score 0–100 (a11y es un subconjunto de axe). Sirve de tendencia. | Un score no es un gate: puede dar 95 con violaciones. No extensible. Redundante si ya corrés axe. | https://a11ypath.com/guides/accessibility-testing-tools/ |
| **`jest-axe` / jsdom** | Rápido, en tests unitarios, por componente. | **No corre con layout**: el README de axe-core dice que `color-contrast` no funciona en JSDOM. No sirve para una agenda que depende de geometría. | https://github.com/dequelabs/axe-core |
| **`eslint-plugin-jsx-a11y`** | Atrapa errores obvios (alt, roles) antes de ejecutar. | Estático: no ve el DOM renderizado ni el estado. Complemento barato, no reemplazo. | https://a11ypath.com/guides/accessibility-testing-tools/ |
| **El harness custom** (`scripts/audit-agenda-proto.mjs`) | Mide invariantes que ninguna herramienta ve (§3.3). | No es "CI-friendly" tal cual: necesita el sitio real autenticado y hace ~20 navegaciones. | `scripts/audit-agenda-proto.mjs` |

### 3.2 Qué cubre axe y qué no (esto es lo importante)

Según la tabla oficial de reglas (https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md), axe **sí** cubre: `color-contrast` (1.4.3, AA), nombres accesibles (`button-name`, `link-name`, `aria-command-name`, `aria-dialog-name`), validez de roles/atributos ARIA, `html-has-lang`, `document-title`, `skip-link`, `scrollable-region-focusable`, y `target-size` (**pero la sección WCAG 2.2 viene deshabilitada por defecto**: "These rules are disabled by default, until WCAG 2.2 is more widely adopted").

Y **no** cubre lo que el harness mide:

| Invariante que mide el harness | ¿axe lo cubre? | Evidencia |
|---|---|---|
| Contraste del **indicador de foco** ≥ 3:1 (1.4.11 / 2.4.11) — el harness mide 5.45:1 (`audit-agenda-proto.mjs:229-243`) | **No existe regla.** axe no evalúa `outline`/`:focus-visible`. | rule-descriptions: no hay regla de focus appearance |
| Contraste de **líneas de grilla / bordes de UI** (1.4.11) — el harness exige ≥1.3:1 (`:174-190`) | **No existe regla.** `color-contrast` es solo texto. | rule-descriptions |
| **Target size ≥ 24×24** (2.5.8) — el harness lo mide en items del menú (`:722`) | Regla `target-size` existe pero **apagada por defecto**. | rule-descriptions (sección WCAG 2.2) |
| **Existencia y persistencia de `aria-live`** (4.1.3) — el harness exige `[role=status][aria-live=polite]` **fuera** del subárbol que se re-renderiza (`:227`, `:374-404`) | **No existe regla.** Deque cerró el pedido: "not something we could... axe-core can't understand and requires a human". | https://github.com/dequelabs/axe-core-npm/issues/1172 |
| **Orden de foco** y **devolución del foco tras `Escape`** (2.4.3) | Solo `focus-order-semantics` **experimental** (rol apropiado, no orden). | rule-descriptions (Experimental) |
| **Operabilidad por teclado** (`Enter` abre menú, `Tab` no se escapa, atajo de una tecla acotado al foco 2.1.4, `Ctrl+Alt+flechas`) | Imposible en un snapshot: hay que **ejecutar** la interacción. | https://playwright.dev/docs/accessibility-testing (interactuar antes de `analyze`) |
| **Contraste sobre fondos con alfa/oklch** — el harness **compone el alfa** con canvas (`:149-172`) | `color-contrast` devuelve `incomplete` (needs review) cuando no puede muestrear imagen/gradiente/overlay. | https://modern-framework-accessibility.com/testing-and-automating-accessibility/automated-accessibility-testing-with-axe-core/ |
| **Choque de bloques / solapamiento de eventos** (`:197-208`) | Ninguna. | — |

Sobre la cobertura: el README de axe-core afirma "on average 57% of WCAG issues automatically"; estudios secundarios y la propia Deque mencionan 30–40%, y un mapeo criterio-por-criterio da ~29.5% totalmente automatizable y ~60% que requiere humano (https://www.rushis.com/wcag-success-criteria-to-axe-core-mapping/). La cifra exacta no importa: importa que **el harness mide justamente el complemento**.

### 3.3 Recomendación con tradeoff

**Sumar `@axe-core/playwright` como complemento, no como reemplazo; mantener el harness custom como autoridad de los invariantes medidos.**

- **Qué suma axe que hoy no hay:** regresiones estructurales del shell y de los diálogos nuevos — nombres accesibles de botones/menuitems/dialog, ARIA válida, `html-lang`, `document-title`, y `target-size` si se habilita `wcag22aa`. Es barato y de falsos positivos casi nulos (Deque: "zero false positives"; los dudosos van a `incomplete`).
- **Qué NO hay que hacer:** confiar en que axe reemplaza al harness. Es exactamente al revés: el harness cubre el ~70% que axe no puede decidir, y **el riesgo real de la agenda nueva** (foco, teclado, líneas, `aria-live` persistente) está en ese 70%.
- **Cómo integrarlo:** en la misma corrida de Playwright, después de **conducir cada estado interactivo** —abrir el panel, abrir el menú, cambiar a Lista y a Mes— y escanear con `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])` y `.include()` de la región. Adjuntar el JSON de resultados como artifact, y **reportar `incomplete` aparte** (no tratarlo como pass).
- **Qué descartar:** `jest-axe` (jsdom + `color-contrast` roto), Lighthouse CI (score, no gate, y corre un subconjunto de axe), `pa11y-ci` (no llega detrás de login ni a estados interactivos). `eslint-plugin-jsx-a11y` es un extra opcional en el lint, barato.
- **El tradeoff honesto:** axe agrega cobertura nueva con poco costo, pero **no mueve la aguja en lo que hace única a esta vista**. El esfuerzo de a11y debería seguir puesto en el harness y en el recorrido por teclado, no en sumar herramientas.

---

## 4. Deploy seguro en Frappe (con Custom Field + frontend nuevo)

### 4.1 Qué hace `bench migrate` (para no asumir de más)

Frappe, en `migrate`, corre el hook `before_migrate`, ejecuta los patches de `patches.txt`, y sincroniza: **schema de la DB, background jobs, fixtures, dashboards/desktop icons/web pages, traducciones, y el índice de búsqueda**. Los DocTypes se recargan comparando el **MD5 del JSON** contra el guardado en la tabla `DocType` (checksum comparison). **Al quitar o renombrar campos, las columnas no se borran** (para evitar pérdida de datos). Fuente: https://docs.frappe.io/framework/user/en/database-migrations

`bench migrate` = "Run patches, sync schema and rebuild files, translations and indexes on a particular site." Fuente: https://docs.frappe.io/framework/user/en/bench/frappe-commands

### 4.2 Custom Fields: dos caminos

| Camino | Cómo | Comportamiento en migrate | Fuente |
|---|---|---|---|
| **Fixtures** | `hooks.py` con `fixtures = ["Custom Field"]`, crear el campo y `bench export-fixtures`; el JSON queda en la app. | Se importa al instalar el app y al actualizar (`bench update`/`migrate`). Es el camino reproducible y versionado. | https://docs.frappe.io/framework/user/en/guides/app-development/how-to-create-custom-fields-during-app-installation |
| **Export Customizations** (Customize Form) | Botón "Export Customizations" → carpeta `custom/` del módulo. | Se sincroniza en `bench update`/`migrate`. **Cuidado:** al sincronizar reemplaza *todos* los property setters y permisos custom del sitio con lo que está en código. | https://docs.frappe.io/framework/user/en/guides/app-development/exporting-customizations |

Pitfall documentado: fixtures que no se aplican aún con `migrate` — casos de carpeta `custom/` vieja o caché. El repo ya tiene un fallback para DocTypes que no se registran: `bench --site X reload-doc MbCRM doctype <snake>` (runbook, `docs/runbook-crm-core.md:228-231`). Ver: https://discuss.frappe.io/t/new-fixtures-not-applied-with-bench-update-nor-bench-migrate/83546

### 4.3 Lo que NO aplica acá

- **`bench build`** no es necesario para este frontend: el bundle está embebido en `www/hoy.html` (no usa el pipeline de assets). `bench build` reconstruye JS/CSS de las apps Frappe. El repo hornea el template en la imagen (`docs/runbook-crm-core.md:86-97`).
- **Igual hay que reiniciar**: `www/`, `api.py` y `hooks.py` se cachean en los procesos gunicorn; los cambios van en la imagen + rolling update (runbook, `:108-112`).
- **Caché de 404**: si `/hoy` da 404 fantasma, `frappe.cache.delete_value("website_404")` (runbook, `:108-109`).

### 4.4 Orden de operaciones recomendado (Custom Field + frontend)

El problema central: `deploy-crm.sh` actualiza los servicios a la imagen nueva y **después** corre `migrate` (`scripts/deploy-crm.sh:55-68`). Como la imagen nueva trae *tanto* el fixture (campo) *como* el frontend nuevo, hay una ventana en la que el frontend nuevo lee un campo que todavía no existe en la DB.

Orden sin ventana, en orden de preferencia:

1. **Frontend defensivo (mejor):** que la agenda trate el campo nuevo como opcional. Entonces el orden da igual y se usa el script de un tirón.
2. **Dos deploys (si el frontend no es defensivo):**
   a. Deploy A: imagen con el fixture **y el frontend viejo** + `--migrate`. El campo se crea con la UI vieja corriendo.
   b. Deploy B: imagen con el frontend nuevo, sin `--migrate`.
3. **En los dos casos:** backup **antes** de cualquier `migrate`, y verificado (archivo existe y pesa > 0). `bench --site X backup` (agregar `--with-files` si tocás archivos); el script ya lo hace antes del migrate (`deploy-crm.sh:62-64`) y hay backup a Google Drive por cron (runbook, `:70-71`). Fuente: https://docs.frappe.io/framework/user/en/bench/frappe-commands
4. **Probar en `crm-test` primero**, nunca en prod: el same-bench ya existe para esto (`docs/runbook-crm-core.md:101-104`).
5. **Verificar post-deploy:** `1/1`, HTTP, el conteo de DocTypes/campos, `bench --site X doctor` (comunidad), y el **E2E** (§2).
6. **Rollback:** imagen previa (el script ya revierte solo en fallo de servicios/HTTP). Si el migrate fue destructivo, restaurar backup — con la advertencia de que **todo lo creado después del backup se pierde** (comunidad: https://managely.cloud/en/blog/how-to-update-erpnext). Como los Custom Fields son aditivos, el rollback normal rara vez necesita restaurar DB.

Advertencia de orden en el script: el `--migrate` es **obligatorio** cuando el deploy agrega/cambia DocTypes (un DocType existe en la DB recién después del migrate), lo dice el propio script (`deploy-crm.sh:16-18`). Un Custom Field en un DocType existente sigue la misma lógica vía fixtures/custom.

---

## 5. Monitoreo de errores para la vista nueva

### Opciones

| Opción | Qué da | Qué cuesta | Fuente |
|---|---|---|---|
| **Nada (solo el deploy)** | — | **Insuficiente**: HTTP 200 no distingue bundle roto (§0). | `scripts/deploy-crm.sh:94-99` |
| **Handler global → Error Log de Frappe** | Capturás `window.onerror` y `unhandledrejection` en el shell y posteás a un endpoint whitelisted que llama `frappe.log_error(traceback, title)`. Queda en el DocType Error Log, visible en Desk, **sin vendor**. | Un endpoint y ~10 líneas; un poco de ruido si no filtrás. | https://docs.frappe.io/framework/user/en/api/logging |
| **Error Snapshot de Frappe** | Frappe ya guarda snapshots para HTTP >= 500 y los sincroniza a la DB (DocType Error Snapshot, retención 1 mes). | Solo cubre errores de servidor, no el JS del cliente. Es gratis y ya está. | https://docs.frappe.io/framework/user/en/logging |
| **Sentry browser SDK** | Captura uncaught exceptions y unhandled rejections, agrupa, alerta, `release` por versión. Free tier para un proyecto chico. | Un servicio externo (privacidad de datos de un CRM), y **sourcemaps**: sin `release`+sourcemaps los traces llegan minificados, y el bundle corre desde `blob:` (URLs sin mapear). El loader "errors-only" solo captura lo no manejado. | https://docs.sentry.io/platforms/javascript/ · https://docs.sentry.io/platforms/javascript/install/loader.md |
| **Health endpoint que renderiza** | Un E2E que corre post-deploy y afirma cero `pageerror` es, de hecho, el mejor "health check" de frontend. | Es el mismo trabajo del §2. | `scripts/e2e_hoy.mjs:17-21` |

### Recomendación

**Mínimo viable: (a) handler global `error`/`unhandledrejection` que postea al Error Log de Frappe + (b) el E2E post-deploy como gate.** Con un usuario, eso alcanza para saber "se rompió la vista" sin sumar un vendor ni un servicio al VPS:

- El handler te avisa en runtime, con el mensaje, la URL y (si agregás `window.__crm_release` = tag de imagen) **qué deploy** rompió.
- El E2E te avisa antes de que lo veas vos, en el deploy, y evita el estado "HTTP 200 pero pantalla en blanco".
- **Sentry solo si querés stack traces legibles y alertas.** Con el bundle base64/Blob, la resolución de sourcemaps es incierta (no pude verificarlo) y meter un sourcemap inline dentro de un bundle ya base64 agranda un archivo que ya es grande. Para un CRM de un usuario, el Error Log de Frappe es el 80% del valor al 5% del costo.

---

## Lo que no pude verificar

- **Si Vite emite sourcemaps en el build actual** de `apps/web` y si viajan dentro del bundle base64. Sin eso, los `pageerror` de prod (y de Sentry) son minificados.
- **Si Sentry resuelve sourcemaps para código que corre desde `blob:`** en Chromium. No encontré documentación primaria; hay que probarlo.
- **Comportamiento exacto de `page.route` con el `import()` desde blob** en la versión instalada (`playwright@^1.63.0`, `package.json:20`). La evidencia es el test de Playwright con `fixme` para no-WebKit; conviene reproducirlo en el repo antes de depender de mocks.
- **Si Frappe bloquea `Authorization: token` en páginas `www`** (no-`/api`). Los scripts del repo lo usan y el runbook dice que funciona, pero no encontré la parte de la doc que lo garantice para `www` (la doc de REST habla de `/api`). El login por sesión (`/api/method/login` + `storageState`) es el camino documentado.
- **Los números de cobertura de axe** (30–40% vs 57%): las fuentes se contradicen según metodología (axe-core README dice 57%; Deque y análisis secundarios dicen 30–40%). No afecta la conclusión, que es que el harness cubre el complemento.
- **El estado del CI de GitHub** (`.github/workflows/ci.yaml`) no corre E2E ni a11y y tiene `test` con `continue-on-error: true` (`ci.yaml:36-38`): hoy nada de esto está gateado automáticamente.
