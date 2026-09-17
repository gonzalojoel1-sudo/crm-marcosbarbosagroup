# Decisiones pendientes del usuario — Agenda: operar sin mouse

**Rama:** `feat/agenda-operar-sin-mouse` · **Plan:** `docs/superpowers/plans/2026-09-16-crm-agenda-operar-sin-mouse.md`
**Spec (autoridad):** `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md`
**Ledger completo (rulings técnicos):** `.superpowers/sdd/2026-09-16-crm-agenda-operar-sin-mouse/progress.md`

Esta lista es lo que **necesita tu decisión**. Todo lo demás lo resolví solo y quedó en el ledger,
cada ruling con lo que cuesta si me equivoqué. Nada de esto bloqueó el trabajo: son decisiones que
pueden esperar, o deuda declarada para el port.

---

## 1. Deuda declarada del spec: el cursor de celdas (no implementado a propósito)

El spec §4/S2 dice "`Enter` sobre una celda enfocada" para crear. **No se implementó** porque hoy las
flechas **scrollean** la grilla, y el APG advierte que un cursor de celdas **consumiría las flechas**:
es un rediseño del modelo de teclado, no un agregado. El camino de teclado para crear entra por el
botón de la toolbar y por "Nueva reunión" por día en la Lista, que son conformes.
**Decisión pendiente:** ¿querés el cursor de celdas (y con él, cambiar las teclas de scroll) o
preferís dejar el modelo actual? Mi recomendación: dejarlo, y si lo querés, hacerlo como tarea propia
con la migración de las flechas.

## 2. Deuda declarada: `⌘Z` (deshacer) no está implementado

El spec §8 y §4/S4 lo prometen y **ninguna tarea del plan lo implementa**. Consecuencia real y
verificable: **mover, redimensionar y duplicar anuncian pero no se pueden deshacer**, y por eso
**eliminar pide confirmación obligatoria**. Si querés deshacer, es una tarea propia (necesita una
pila de estados, alcance por vista y decidir si deshace borrados).

## 3. Defecto que encontré en el arnés (ya cerrado, para que lo sepas)

**El arnés nunca probó el arrastre** — la interacción más vieja del prototipo. Por eso un
`TypeError` preexistente (`geom()` no devolvía `minOf`) vivió sin que nadie lo viera, y **arrastrar
para crear estaba roto**. Lo arregló la Task 3 porque estaba en su camino crítico; hoy el arnés
prueba también el arrastre feliz, no solo la cancelación.

## 4. Alcance que quedó afuera y conviene decidir si entra

Declarados fuera de alcance en el spec y **no** implementados (para que no te sorprenda):

- **Eventos multi-día** y **fila de todo-el-día** ("Legendarios · próximas fechas" sigue como bloque
  con hora, semánticamente incorrecto).
- **Operaciones en la vista Mes** (los chips son botones inertes).
- **Multi-día al arrastrar** y **mover el inicio manteniendo el fin**.
- **Táctil** (F4: manijas ≥24 px, long-press 1000 ms).
- **⌘K con lenguaje natural en español** (F6): el parser en español está a medias según la
  investigación y **no hay datos de fraseo argentino** — riesgo declarado, es lo primero que se corta.
- **2.4.11 foco no tapado por el panel**, **3.3.1/3.3.3 errores del panel**, **F8 roles completos**
  del menú y del diálogo.

## 5. Deuda declarada para el port a React

- **Los diálogos están duplicados** ("Mover a…" y "Cambiar duración…") y el fix de foco de Tab vive en
  cuatro lugares. En un archivo de prototipo es tolerable; en `apps/web` va a doler.
- **`notes`/`title` se interpolan en HTML sin escapar** en la grilla y en la Lista. Es autoinfligido y
  solo del prototipo; en el port hay que escaparlos (o dejar que el framework lo haga).
- **`Ctrl+Alt`+flechas no está reservado por los motores, pero suele estarlo por el SO/WM** (cambio de
  escritorio en GNOME, rotación de pantalla en Windows). La evidencia es **macOS-only**: no hay ninguna
  afirmación de soporte en Windows/Linux sin probar.

## 6. Lo que necesito que revises al despertar

1. Abrí `prototypes/agenda/index.html` y probá el flujo completo: click en un hueco → panel → guardar;
   y sobre una reunión: menú → Mover / Duración / Duplicar / Eliminar.
2. **Merge a `main`**: los commits están en `feat/agenda-operar-sin-mouse`, no en `main`. La decisión
   de mergear es tuya.
3. El contraste del botón primario **quedó resuelto** (ver abajo); no queda ningún defecto de
   accesibilidad abierto que yo conozca, más allá de lo declarado fuera de alcance en §4.

---

# Cierre de la ejecución (mientras dormías)

**Las 10 tareas están implementadas.** Rama `feat/agenda-operar-sin-mouse`, 20 commits, arnés **29 ✓ / 0 ✗**.
Cada tarea pasó por: brief → implementador → review con doble veredicto → ronda de fixes → re-review.
Todas las rondas de fixes se verificaron **por mutación** (se reintrodujo el defecto y se confirmó que la guarda falla).

Lo que el review final de rama verificó por su cuenta: las **cinco acciones** (crear, mover, duración, duplicar,
eliminar) tienen camino de **puntero sin arrastrar** y de **teclado**, y cada camino está **medido** por una guarda.
0 hallazgos Critical.

## Resuelto durante la ejecución (ya no necesita tu decisión)

- **La vista Lista es operable (era inerte).** Cerrada por `1ea51bd`: es un compuesto APG con un solo
  tab stop, roving tabindex, flechas adentro y el MISMO menú que la grilla (Editar · Mover a… · Cambiar
  duración… · Duplicar · Eliminar). Ya no hay acciones "solo en la grilla".
- **El panel está completo (era parcial).** Cerrado por `b5eb7e9`: suma agenda (categoría), día y notas,
  y las persiste al crear y al editar. El día se elige con un `<select>` nativo de los cinco días
  (desvío deliberado del date-picker del APG; ver spec §4/S1 y §13).
- **El acorde del nudge ya no es `Alt` solo.** Cerrado por `b5eb7e9`: `Alt`+flechas se movió a
  **`Ctrl+Alt`+flechas**. Verificado en los tres motores **en macOS**; para Windows/Linux la afirmación
  es que el acorde no está reservado por los motores, no una medición (ver §5).
- **Contraste del botón primario (era 3.52:1):** resuelto. Los controles con fondo de acento ahora usan texto
  oscuro (`var(--bg)`) → **5.45:1 medido**, y el arnés mide contraste de botones (antes no medía ninguno).
- **El hint `Supr`** que prometía una tecla que no hacía nada: ahora funciona y está guardado.
- **Doble anuncio en los diálogos:** los diálogos anunciaban *y* movían el foco; unificado con la regla de
  alternancia, y **dos guardas que se contradecían** quedaron consistentes.
- **2.1.4:** `n` ya no dispara sin foco en un componente.

## Estado de los puntos A/B/C: CERRADOS

Los tres puntos que la versión anterior de este documento dejaba abiertos **ya están cerrados**, con
el trabajo y los commits de arriba:

- **A. La Lista era inerte — CERRADO (`1ea51bd`).** Ahora opera las cinco acciones reusando el menú
  de la grilla, sin duplicar acciones.
- **B. El panel era parcial — CERRADO (`b5eb7e9`).** Ahora tiene agenda, día y notas, persistidas.
- **C. `Alt`+flechas solo verificado en macOS — CERRADO como riesgo (`b5eb7e9`).** El acorde se movió a
  `Ctrl+Alt`, no reservado por los motores; la caveat honesta de Windows/Linux queda en §5.

## Lo que sigue abierto

- **§1 cursor de celdas** y **§2 `⌘Z`**: decisiones de alcance, sin implementar.
- **§4**: todo lo declarado fuera de alcance (Mes, multi-día, táctil, ⌘K en español, F7 del panel/menú).
- **§5**: las tres deudas para el port a React, incluida la de `Ctrl+Alt` a nivel SO/WM.

## Mi recomendación de merge

El review final dice: **merge condicional** — mergeá como **prototipo**, no como "entrega conforme WCAG 2.2 AA".
Las 10 tareas están, las guardas están verdes y los puntos A/B/C que antes bloqueaban **están cerrados**. Lo que
evita llamarlo "entrega conforme" es el alcance declarado fuera de alcance en §4, no un defecto abierto. Si el
objetivo de mergear es tener las guardas verdes en `main` antes del port a React, es una razón legítima.

---

# Port a prod: lo que apareció al empezar (2026-09-17)

**El plan del port está en `docs/superpowers/plans/2026-09-17-agenda-port-a-prod.md` (8 tareas).**
La Task 1 (los endpoints que faltaban: mover, duración, duplicar, eliminar) está escrita en el commit
`78a6786`, **pero no verificada**: en este entorno no hay `bench`, así que los 10 tests de integración
**no se corrieron**. Hay que correrlos en el VPS contra `crm-test`. Tampoco se tocó producción.

## DECISIÓN 1 (bloqueante) — el CRM no tiene duración de reunión

**Hallazgo: `CRM Lead` no tiene campo de fin.** `_meeting_dto` **fabrica** `end = start + 1 hora`
(api.py:38) y `create_event` **ignora** el `ends_on` que le mandes. O sea que hoy **toda reunión dura
1 hora por invención**, y "cambiar la duración" no tiene dónde guardarse.

El subagente resolvió con un parche: guardar `Fin: <datetime>` **dentro de `notes`**. Eso es frágil, y
además se apila sobre otro parche ya existente: el **título** del evento también se parsea de `notes`
("Reunión agendada: <summary>"). Estaríamos guardando datos estructurados en texto libre — dos veces.

**Opciones:**
- **(a) Agregar un campo real** (`custom_meeting_end` en `CRM Lead`) y hacer el deploy **con `--migrate`**.
  Es la única forma de que mover, redimensionar y duplicar sean confiables. El plan preveía un deploy
  **sin** migrate; esto lo cambia, y un migrate sobre el CRM en uso exige el backup previo (que el
  script ya hace).
- **(b) Aceptar que toda reunión dura 1 hora** y sacar "Cambiar duración" de la agenda. Menos funcional,
  pero sin tocar el modelo de datos.
- **(c) Dejar el parche de `notes`.** No lo recomiendo: datos estructurados en texto libre, y ya hay uno.

**Mi recomendación: (a).** Redimensionar es una de las cinco operaciones que pediste, y sin campo real
no puede funcionar bien.

## DECISIÓN 2 — eliminar una reunión

Como una reunión **es** un `CRM Lead`, borrarla de verdad borraría el lead, el contacto y el historial.
El subagente eligió **borrado suave**: limpia los campos de reunión y **conserva** el lead. Creo que es
lo correcto, pero es una decisión de producto tuya: **¿eliminar la reunión debe borrar el lead también?**

## DECISIÓN 3 — dónde se corren los tests

Sin `bench` acá, la verificación de la Task 1 (y de las que siguen) tiene que correr en el VPS contra
`crm-test`. Necesito que me confirmes que puedo entrar y correrlos, o los corrés vos.
