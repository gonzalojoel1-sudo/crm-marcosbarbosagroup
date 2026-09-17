# Decisiones pendientes del usuario — Agenda: operar sin mouse

**Rama:** `feat/agenda-operar-sin-mouse` · **Plan:** `docs/superpowers/plans/2026-09-16-crm-agenda-operar-sin-mouse.md`
**Spec (autoridad):** `docs/superpowers/specs/2026-09-16-crm-agenda-operar-sin-mouse-design.md`
**Ledger completo (rulings técnicos):** `.superpowers/sdd/2026-09-16-crm-agenda-operar-sin-mouse/progress.md`

Esta lista es lo que **necesita tu decisión**. Todo lo demás lo resolví solo y quedó en el ledger,
cada ruling con lo que cuesta si me equivoqué. Nada de esto bloqueó el trabajo: son decisiones que
pueden esperar, o defectos que encontré y que no me correspondía arreglar en solitario.

---

## 1. Defecto real de accesibilidad, transversal, preexistente — y no lo toqué

**`#fff` sobre el naranja de marca (`--accent` `#fe4100`) da 3.52:1, y AA exige 4.5:1 para texto normal.**

- Afecta al botón **"Nueva reunión"** del topbar (`.btn.primary`), que **ya existía** antes de esta
  rama, y al estado `.p-dur.on` del panel que agregó la Task 2.
- **Por qué no lo arreglé:** la corrección toca `.btn.primary`, un componente compartido de toda la
  app. Cambiar el color de texto de todos los botones primarios es una decisión de diseño tuya, no
  un fix de tarea. Además excedía el alcance de dos archivos de la Task 2.
- **Opciones:** (a) oscurecer el fondo del primario hasta que el blanco llegue a 4.5:1; (b) usar
  texto oscuro sobre el naranja (el naranja da ~5.45:1 con texto casi negro); (c) dejarlo y aceptar
  el incumplimiento declarado.
- **Extra:** el arnés **no medía texto de botones**, solo texto de bloques de evento. Por eso este
  defecto nunca apareció. El hueco de medición hay que cerrarlo (mi recomendación: (b), que conserva
  el naranja como color y arregla el contraste).

## 2. Deuda declarada del spec: el cursor de celdas (no implementado a propósito)

El spec §4/S2 dice "`Enter` sobre una celda enfocada" para crear. **No se implementó** porque hoy las
flechas **scrollean** la grilla, y el APG advierte que un cursor de celdas **consumiría las flechas**:
es un rediseño del modelo de teclado, no un agregado. El camino de teclado para crear entra por el
botón de la toolbar y por "Nueva reunión" por día en la Lista, que son conformes.
**Decisión pendiente:** ¿querés el cursor de celdas (y con él, cambiar las teclas de scroll) o
preferís dejar el modelo actual? Mi recomendación: dejarlo, y si lo querés, hacerlo como tarea propia
con la migración de las flechas.

## 3. Deuda declarada: `⌘Z` (deshacer) no está implementado

El spec §8 y §4/S4 lo prometen y **ninguna tarea del plan lo implementa**. Consecuencia real y
verificable: **mover, redimensionar y duplicar anuncian pero no se pueden deshacer**, y por eso
**eliminar pide confirmación obligatoria**. Si querés deshacer, es una tarea propia (necesita una
pila de estados, alcance por vista y decidir si deshace borrados).

## 4. Defecto que encontré en el arnés (ya con ruling, para que lo sepas)

**El arnés nunca probó el arrastre** — la interacción más vieja del prototipo. Por eso un
`TypeError` preexistente (`geom()` no devolvía `minOf`) vivió sin que nadie lo viera, y **arrastrar
para crear estaba roto**. Lo arregló la Task 3 porque estaba en su camino crítico. Dejé el ruling
para que la Task 10 pruebe también el arrastre feliz, no solo la cancelación.

## 5. Alcance que quedó afuera y conviene decidir si entra

Declarados fuera de alcance en el spec y **no** implementados (para que no te sorprenda):

- **Eventos multi-día** y **fila de todo-el-día** ("Legendarios · próximas fechas" sigue como bloque
  con hora, semánticamente incorrecto).
- **Operaciones en la vista Mes** (los chips son botones inertes) y **en la Lista** más allá de crear.
- **Multi-día al arrastrar** y **mover el inicio manteniendo el fin**.
- **Táctil** (F4: manijas ≥24 px, long-press 1000 ms).
- **⌘K con lenguaje natural en español** (F6): el parser en español está a medias según la
  investigación y **no hay datos de fraseo argentino** — riesgo declarado, es lo primero que se corta.
- **2.4.11 foco no tapado por el panel**, **3.3.1/3.3.3 errores del panel**, **F8 roles completos**
  del menú y del diálogo.

## 6. Lo que necesito que revises al despertar

1. Abrí `prototypes/agenda/index.html` y probá el flujo completo: click en un hueco → panel → guardar;
   y sobre una reunión: menú → Mover / Duración / Duplicar / Eliminar.
2. **Merge a `main`**: los commits están en `feat/agenda-operar-sin-mouse`, no en `main`. La decisión
   de mergear es tuya.
3. El punto 1 (contraste del botón primario) es el único defecto de accesibilidad real que queda
   abierto y declarado.

---

# Cierre de la ejecución (mientras dormías)

**Las 10 tareas están implementadas.** Rama `feat/agenda-operar-sin-mouse`, 17 commits, arnés **27 ✓ / 0 ✗**.
Cada tarea pasó por: brief → implementador → review con doble veredicto → ronda de fixes → re-review.
Todas las rondas de fixes se verificaron **por mutación** (se reintrodujo el defecto y se confirmó que la guarda falla).

Lo que el review final de rama verificó por su cuenta: las **cinco acciones** (crear, mover, duración, duplicar,
eliminar) tienen camino de **puntero sin arrastrar** y de **teclado**, y cada camino está **medido** por una guarda.
0 hallazgos Critical.

## Resuelto durante la ejecución (ya no necesita tu decisión)

- **Contraste del botón primario (era 3.52:1):** resuelto. Los controles con fondo de acento ahora usan texto
  oscuro (`var(--bg)`) → **5.45:1 medido**, y el arnés mide contraste de botones (antes no medía ninguno).
- **El hint `Supr`** que prometía una tecla que no hacía nada: ahora funciona y está guardado.
- **Doble anuncio en los diálogos:** los diálogos anunciaban *y* movían el foco; unificado con la regla de
  alternancia, y **dos guardas que se contradecían** quedaron consistentes.
- **2.1.4:** `n` ya no dispara sin foco en un componente.

## DECISIONES DE ALCANCE — necesito que las tomes (no las tomé yo)

**A. La vista Lista es inerte.** Sus botones no tienen handler: una reunión **no se puede mover, redimensionar,
duplicar, eliminar ni editar desde la Lista**. La spec §4/S6 y §5.3 prometen eso, y además es la entrada
"no subdimensionada" que hacía cumplir 2.5.8 sin depender de excepciones. **Sin ella, los bloques densos quedan
solo con la excepción "Essential".** Es trabajo real, no un fix.
*Opciones:* hacerla operable (mi recomendación, si la Lista va a ser el camino accesible de verdad) · o corregir
la spec y aceptar explícitamente que la Lista es solo de lectura + crear.

**B. El panel quedó parcial (spec A4).** Tiene título, hora y duración, pero **no** agenda (categoría), notas,
día ni el selector de fecha del APG. *Opciones:* completarlo · o declarar A4 reducido en la spec.

**C. `Alt`+flechas verificado solo en macOS.** En Windows/Linux es Atrás/Adelante y el navegador puede ignorar
`preventDefault`. Si la app se va a usar ahí, hay que mover el acorde a `Ctrl+Alt`. Verificado en los 3 motores
**en macOS** solamente.

**D. Lo que sigue sin existir, y estaba declarado fuera de alcance:** deshacer (`⌘Z`), táctil (F4: manijas ≥24px,
long-press 1000 ms), operaciones en la vista Mes, eventos multi-día y todo-el-día, y la paleta ⌘K con lenguaje
natural en español (el parser en español está a medias y no hay datos de fraseo argentino).

**E. Deuda declarada para el port a React:** el andamiaje de los diálogos está **duplicado** entre "Mover a…" y
"Cambiar duración…", y el fix de foco de Tab vive en **cuatro** lugares. En un archivo de prototipo es tolerable;
en `apps/web` va a doler.

## Mi recomendación de merge

El review final dice: **merge condicional** — mergeá como **prototipo**, no como "entrega conforme WCAG 2.2 AA".
Las 10 tareas están, las guardas están verdes y los tres puntos ciegos de medición que tenía el arnés quedaron
cerrados (el arrastre no se medía, el contraste de botones no se medía, y un nodo de texto de ancho cero pasaba
un chequeo de truncado). Si el objetivo de mergear es tener las guardas verdes en `main` antes del port a React,
es una razón legítima. Los puntos A y B de arriba son los que impiden llamarlo "conforme AA".
