# Build vs. adopt — what to lean on for the agenda UI in the live CRM

**Date:** 2026-09-17
**Question:** before porting the already-designed calendar/agenda interaction into the real React app
(`apps/web`, Vite + React 18 + TS), what should we build on instead of writing everything by hand?
**Mode:** research only. No code was written or changed.
**Companions:** `2026-09-16-agenda-hallazgos.md` (Frappe/Google machinery),
`2026-09-16-agenda-diseno-v2-auditado.md` (Event model + sync design),
`2026-09-17-agenda-operable-teclado-open-source.md` (keyboard/OSS precedents),
`2026-09-17-calendario-agenda-operable-keyboard.md` (product keyboard survey),
`docs/superpowers/DECISIONES-PENDIENTES-agenda.md` (open product decisions).

**Rule:** every concrete claim carries a source URL. Where a claim could not be checked against a primary
source this session it is marked **unverified** rather than guessed. Licensing is stated explicitly; the
npm registry itself was used as the primary source for license/version/maintenance.

**Relationship to the existing corpus.** The four companion docs already established: (a) the root cause
("a meeting *is* a `CRM Lead`", `apps/crm_core/crm_core/api.py:757`); (b) that the prototype
(`prototypes/agenda/index.html`) already resolves the interaction and 29 a11y guards; (c) that Frappe ships
an `Event` DocType plus a two-way Google Calendar integration with correct timezone handling; and (d) that
no permissive OSS calendar documents keyboard move/resize. This report does **not** re-derive those. It adds
the licensing/maintenance/effort comparison that was missing, verifies the Frappe frontend-shipping question
against Frappe's own source, and turns #4 into a concrete migration answer.

---

## 0. Executive answer

1. **Do not adopt a calendar library. Keep our own.** The closest MIT match (MUI X Scheduler) is still
   **beta**, pulls in all of MUI + Emotion, and its documented a11y model uses **`role="grid"` — which our
   spec explicitly forbids**. Every other permissive option lacks keyboard move/resize too, or is GPL, or is
   unmaintained. Adopting one would mean throwing away the audited interaction to re-earn less than we already have.
2. **Do not use a drag-and-drop library for move/resize either.** WCAG 2.5.7 is satisfied by a *non-dragging
   alternative* (our "Mover a…" / "Cambiar duración…" menus), which is what the prototype already ships and
   what Pragmatic DnD's own accessibility guidance recommends. A DnD lib buys nothing for the keyboard path.
   If we want pixel-drag plumbing, `dnd-kit` is the least-bad, but it needs a custom coordinate getter and
   has no resize concept.
3. **Keep the current `www`/base64 shell for now, but know the documented alternative.** Frappe's own CRM
   ships a Vue+frappe-ui SPA via `frappe-ui/vite` (`buildConfig.indexHtmlPath`, `jinjaBootData`) with assets
   under `/assets/`. `frappe-ui` is Vue-only, so a React app gets the *build mechanism* but not the
   components. The base64 trick exists only to dodge Frappe's `.__` template guard, and there is a
   **documented escape hatch** (`safe_render = False` in the page controller). Removing base64 is worth a
   spike; removing the embedded-bundle model requires `/assets` to be reliable in the deploy topology.
4. **Yes — the new agenda should read/write Frappe `Event`, not `CRM Lead`.** This is the biggest leverage
   in the report. `Event` already has duration (`ends_on`), all-day, recurrence, timezone-correct Google
   sync, participants and Dynamic Links. The meeting↔contact coupling disappears; deleting a meeting no
   longer risks the contact. Cost: a migration of the existing 10 meetings, a thin wrapper around the
   framework's sync (three known hard edges), full RRULE parity as a separate task, and a link back on the
   lead page. Do it.
5. **Date/time: treat server datetimes as wall-clock in the site timezone, never convert to UTC in the
   browser.** Frappe stores naive datetimes in `get_system_timezone()`; JS `Date` is instant-based. Keep the
   naive `YYYY-MM-DD HH:mm:ss` wire format, do slot math in integer minutes, use `Intl` for display, and
   use Temporal (with polyfill, because Safari has not shipped it) or Luxon only where zone math is needed.

---

## 1. React calendar/scheduler libraries

| Option | License | What it gives us | What it costs | Source |
|---|---|---|---|---|
| **FullCalendar (React)** | **MIT** (core + react + daygrid/timegrid/interaction; `fullcalendar-scheduler`/Premium from **$480**, OEM custom) | Mature timeGrid week view; **overlap lanes built in** — overlapping timed events are laid side by side, `slotEventOverlap` (default `true`) controls the visual offset; `eventOverlap` default `true`; pointer drag-create/move/resize; list/agenda views; v7 has theming | No keyboard move/resize: open since 2015, still milestone **v9** (`#2535`, `#6528`); in the **list** views drag/resize are **disabled on purpose**; fully restyling means fighting its DOM/CSS; large bundle; v7 restructured packages (core/react `7.1.0`, plugins still `6.1.21`) | [license](https://fullcalendar.io/license) · [pricing](https://fullcalendar.io/pricing) · [slotEventOverlap](https://fullcalendar.io/docs/slotEventOverlap) · [eventOverlap](https://fullcalendar.io/docs/eventOverlap) · [a11y](https://fullcalendar.io/docs/accessibility) · [#2535](https://github.com/fullcalendar/fullcalendar/issues/2535) · [#6528](https://github.com/fullcalendar/fullcalendar/issues/6528) |
| **MUI X Scheduler (Community)** | **MIT** (`@mui/x-scheduler`); Premium = recurrence/exceptions/Event Timeline, **$299–599/dev/yr** | Day/week/month/**agenda**; pointer **drag to move and resize built in** (`areEventsDraggable`, `areEventsResizable`); **documented, WCAG 2.2-AA-targeted a11y**: `role="grid"` with 3 logical rows, arrow navigation, **Enter creates on a cell**, event context menu (Edit/Delete), **non-modal** event dialog (`aria-modal="false"`), live-region toolbar label, localized ARIA keys | **Still beta** (`9.0.0-beta.12`, published 2026-09-17); peer-depends on `@mui/material` + Emotion (whole design system for one component); **its model is `role="grid"` — our spec bans it**; keyboard path is *create + open + delete* — **no keyboard move/resize**; Space-opens-menu is mouse/trackpad-only and suppressed on touch; mini-calendar has no arrow nav (documented limitation) | [licensing](https://mui.com/x/introduction/licensing) · [overview](https://mui.com/x/react-scheduler) · [drag](https://mui.com/x/react-scheduler/event-calendar/drag-interactions) · [a11y](https://mui.com/x/react-scheduler/accessibility) · [pricing](https://mui.com/pricing) |
| **Schedule-X** | **MIT core** / Premium **commercial** (€479/yr or €999 lifetime, 2–3 devs) | Framework-agnostic, React wrapper; nice theming, i18n, dark mode; **drag & drop, resize and drag-to-create are all PREMIUM plugins**; Temporal-based events | The exact features we need are behind the paywall; drag/drop **not available in list/month-agenda**; no keyboard documentation found → **unverified**; smaller ecosystem | [repo MIT](https://github.com/schedule-x/schedule-x) · [premium](https://schedule-x.dev/premium) · [drag (premium)](https://schedule-x.dev/docs/calendar/plugins/drag-and-drop) · [resize (premium)](https://schedule-x.dev/docs/calendar/plugins/resize) |
| **react-big-calendar** | **MIT** | Time-grid with overlap via `dayLayoutAlgorithm` (default `overlap`); Agenda view; DnD add-on (react-dnd) | No keyboard model at all — Agenda rows are non-focusable `<td onClick/onDoubleClick>` (documented anti-example); older/slower maintenance (last publish 2026-06-01); styling is CSS-class overrides | [repo](https://github.com/bigcalendar/react-big-calendar) · [LICENSE](https://github.com/bigcalendar/react-big-calendar/blob/master/LICENSE) · [`dayLayoutAlgorithm`](https://github.com/bigcalendar/react-big-calendar/blob/master/stories/props/dayLayoutAlgorithm.mdx) · [`Agenda.js`](https://github.com/bigcalendar/react-big-calendar/blob/master/src/Agenda.js) |
| **Mantine Schedule** (`@mantine/schedule`) — *not on your list* | **MIT** | New (Mantine v9, 2026): Day/week/month/year, **overlapping events auto-positioned side by side (documented)**, `withEventsDragAndDrop`, resources, recurring events; explicitly uses **timezone-agnostic `YYYY-MM-DD HH:mm:ss` strings** (matches Frappe's model); dayjs dependency | **Brand new**; keyboard accessibility **unverified**; pulls `@mantine/core`+`dates`+`hooks`+dayjs; no agenda/list documented in the same depth as MUI | [getting started](https://mantine.dev/schedule/getting-started) · [week view + overlap](https://mantine.dev/schedule/week-view) · [MIT LICENSE](https://github.com/mantinedev/mantine/blob/master/LICENSE) |
| **Bryntum Calendar** | **Commercial** — EUL **$600–680/dev**; SaaS/commercial redistribution requires an **OEM** license (quote) | Rich calendar/gantt family, drag-create/resize/move, many views, agenda | Paid; keyboard support only promises "focus position is easily visible" → **unverified**; no source adaptation rights outside the license | [licensing](https://bryntum.com/licensing) · [store](https://bryntum.com/store/calendar) |
| **DHTMLX Scheduler** | **GPL-2.0** (Standard) or **commercial** (e.g. Scheduling pack **$1,169/dev**) | Agenda/timeline/week views, drag/resize, recurring, i18n | **GPL-2.0 is copyleft → unusable in this closed CRM** without buying commercial; keyboard in Agenda **unverified** | [GPL repo](https://github.com/DHTMLX/scheduler) · [licenses](https://dhtmlx.com/docs/products/licenses.shtml) |
| **Kendo UI Scheduler** | **Commercial** (Progress). The `kendo-ui-core` repo is Apache-2.0 but **does not contain the Scheduler** (per the companion doc's repo-tree check) | Documented keyboard navigation; integrated edit form; agenda view | Paid; repo license doesn't cover the component; current price **unverified** here | [Kendo React Scheduler](https://www.telerik.com/kendo-react-ui/components/scheduler/) |
| **TOAST UI Calendar** | **MIT** | Week/day/month views | **No agenda/list view**; **last npm publish 2022-08-16 → effectively unmaintained**; no keyboard model found | registry (see §7) · [repo](https://github.com/nhn/tui.calendar) |
| **V-Calendar** | **MIT** | Date-picker calendar + month/week layouts | **Not a scheduler** (no agenda/event grid/drag); **last publish 2023-10-13** | registry (see §7) · [vcalendar.io](https://vcalendar.io/) |

**Recommendation — build our own, adopt patterns not packages.**
The prototype is the specification (`docs/superpowers/plans/2026-09-17-agenda-port-a-prod.md`), and it already
encodes decisions no library matches: 1/n overlap lanes, a **non-modal** panel, roving-tabindex list with the
same menu as the grid, the focus/announce alternation rule, `Ctrl+Alt` nudge, and **no `role="grid"`**. Every
library above either (a) lacks keyboard move/resize, (b) is beta/paid/copyleft, or (c) forces a conflicting
a11y architecture. MUI X Scheduler is the only one whose *documented* a11y ambitions overlap ours, and even
there we'd trade our model for `role="grid"`, absorb MUI+Emotion, and still have no keyboard drag.

**What we lose by not adopting:** recurrence expansion, all-day lanes, month rendering, i18n and the
event-edit dialog for free. **What we gain:** we keep the designed interaction and the measured a11y, and we
avoid a second design system. **Mitigation for what we lose:** take the *patterns* from MIT sources (MUI's
ARIA model, FullCalendar's issue threads as the design write-up, `dnd-kit`'s keyboard sensor semantics) —
reimplementing patterns from MIT code is unrestricted (companion doc §7).

**The one option worth a time-boxed spike:** `@mantine/schedule`, because it is MIT, documents overlap lanes
and drag, and its timezone-agnostic string model matches Frappe. It is not a recommendation — it is the only
new candidate that didn't exist when the comparison was first drawn.

---

## 2. Drag and drop with a keyboard equivalent

WCAG 2.2 **SC 2.5.7 (Dragging Movements)** does not require keyboard *dragging*; it requires a single-pointer
alternative to any drag operation. SC 2.1.1 requires everything be keyboard operable. Both are satisfied by
the same shape: focus the item → activate a control → choose the outcome (our existing per-event menu and
"Move to…"/"Duration" dialogs). The W3C's own Understanding doc frames it this way ([SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)).

| Option | License | Keyboard model | What it gives us | What it costs | Source |
|---|---|---|---|---|---|
| **dnd-kit (legacy `@dnd-kit/core`)** | **MIT** | `Space`/`Enter` picks up; arrows move (default **25 px**, overridable via `getNextCoordinates`); `Space`/`Enter` drops; `Escape` cancels. ARIA activator + live-region announcements | Battle-tested; explicit a11y guide and `KeyboardSensor`; sortable preset shows how to snap to discrete targets | **Pixels, not slots** — must write a custom coordinate getter for 15-min/day snapping; **no resize concept** (you'd model the handle as a second draggable); legacy line last published 2024-12 | [a11y guide](https://dndkit.com/legacy/guides/accessibility) · [keyboard sensor](https://dndkit.com/legacy/api-documentation/sensors/keyboard) |
| **dnd-kit (new `@dnd-kit/react` / `@dnd-kit/dom`)** | **MIT** | Same family, new sensor/plugin architecture | Active rewrite (published 2026-09-12); framework-agnostic core | **Pre-1.0** (`0.5.0`) — API churn; same slot-snapping/resize caveats | registry §7 · [dom README](https://app.unpkg.com/@dnd-kit/dom@0.5.0/files/README.md) |
| **React Aria `useDrag` / `useDrop`** | **Apache-2.0** | `Enter` enters DnD mode → **`Tab` cycles drop targets** → `Enter` drops; `Escape` cancels; localized screen-reader instructions + live regions | Best-documented, most complete SR story; full parity claimed; `hasDragButton` for a separate drag affordance | **Tab-between-targets is impractical for a 7×N time grid** (dozens of slot targets); built around collection/drop data, not calendar geometry; no resize; drag *move* only | [DnD guide](https://react-aria.adobe.com/dnd) · [useDrag](https://react-aria.adobe.com/useDrag) |
| **Pragmatic drag and drop (Atlassian)** | **Apache-2.0** | **Deliberately none.** "The core package does not enable accessible controls automatically… directional movement does not translate well to all experiences." Recommends a **menu/button alternative + live-region announcements** | Tiny (~4.7 kB core), extremely fast, powers Trello/Jira/Confluence; framework-agnostic | Ships no keyboard drag; its recommended alternative is *exactly our menu model* — so adopting it is optional plumbing for the pointer path only | [a11y guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines) · [README](https://github.com/atlassian/pragmatic-drag-and-drop) |

**Recommendation — keep pointer handlers hand-written; meet WCAG with the menu, not with keyboard dragging.**
The prototype already has the compliant keyboard path for all five verbs (create, move, duration, duplicate,
delete) via toolbar + per-event menu + dialogs, verified with 29 harness guards
(`docs/superpowers/DECISIONES-PENDIENTES-agenda.md`). Adding `dnd-kit` would duplicate the pointer logic we
already trust and still leave resize/duration to us. If we later want a reusable drag primitive, `dnd-kit` is
the one to take — but its keyboard path must snap to the grid, which means writing the same `yOf`/`minOf`
inverse the prototype already has.

**If we ever want true keyboard "grab and move":** the only documented pattern is FullCalendar's open proposal
(event focused → `Space` opens a popover with *Move* / *Change duration* → arrow roving → `Enter` confirms,
`Escape` cancels), which is a proposal, not an implementation ([#2535](https://github.com/fullcalendar/fullcalendar/issues/2535)). Our menu is the same shape and already built.

---

## 3. Shipping a custom frontend in a Frappe app — what's sanctioned

| Mechanism | License | What it is | Verdict for us | Source |
|---|---|---|---|---|
| **`www` portal page + `.py` controller** | Frappe framework MIT | `apps/<app>/<app>/www/<page>.{html,py}` maps to `/<page>`; controller builds `context`; can set `no_cache`, `title`, `safe_render` | **This is the legitimate base of what we already do.** The `.py` controller is where `no_cache`/`safe_render` live | [Portal Pages](https://docs.frappe.io/framework/user/en/portal-pages) |
| **`safe_render = False`** | Frappe framework MIT | Frappe refuses to render templates containing `.__` "to prevent running any illegal python expressions"; set `safe_render=False` in context to disable the guard | **This is the documented alternative to the base64 trick.** Our `gen-shell.mjs` says the sole reason for base64 is that guard (`apps/web/gen-shell.mjs:1-11,49-51`) | [Portal Pages → `safe_render`](https://docs.frappe.io/framework/user/en/portal-pages) |
| **`bench build` asset bundler** | Frappe framework MIT | Compiles `.js/.ts/.vue/.css/.scss/...`; `bench build [--apps]`, `bench watch`; assets served from `/assets/<app>/...` (`public/` dir) | The sanctioned way to ship real hashed assets with caching/CDN, instead of an inlined blob | [Asset Bundling](https://docs.frappe.io/framework/user/en/basics/asset-bundling) |
| **`hooks.py`: `app_include_js/css`** | Frappe framework MIT | Loads assets into **Desk** (`/app` → `/desk`) | Not our surface (`/hoy` is a portal page), but the standard Desk integration point | [hooks](https://docs.frappe.io/framework/user/en/python-api/hooks) |
| **`frappe-ui`** | **MIT** | Official component library + **`frappe-ui/vite` plugin**: dev proxy, icon resolver, **`jinjaBootData`** (injects `window[key]=…` from Jinja `boot`), **`buildConfig`** (output dir, `base: /assets/<app>/frontend/`, copies `index.html` → `www/<page>.html`) | **The officially-blessed SPA build/serve path.** But it is **Vue 3 + Tailwind** — the components are unusable from React; only the build mechanics are adoptable | [repo](https://github.com/frappe/frappe-ui) · [vite README](https://github.com/frappe/frappe-ui/blob/main/vite/README.md) · [docs](https://ui.frappe.io/docs/introduction) |
| **Frappe's own CRM frontend (reference implementation)** | GNU GPLv3 (app); frappe-ui MIT | `crm/frontend` is a Vue 3 SPA built with `frappe-ui/vite`: `buildConfig: { indexHtmlPath: '../crm/www/crm.html', sourcemap: true }`, `jinjaBootData: true`; `crm/www/crm.py` sets `no_cache=1` and returns a `boot` dict (incl. `csrf_token`, `timezone`) | Proves the pattern end-to-end in production: **Vite build → assets under `/assets/crm/frontend/` → generated `www/crm.html` + Jinja boot**. `crm.html` is **not committed** (generated) — the `www/` dir contains only `.py` files | [`vite.config.js`](https://raw.githubusercontent.com/frappe/crm/develop/frontend/vite.config.js) · [`crm/www/crm.py`](https://raw.githubusercontent.com/frappe/crm/develop/crm/www/crm.py) · [www dir listing](https://api.github.com/repos/frappe/crm/contents/crm/www?ref=develop) |
| **React on Frappe (third-party)** | Unclear / **unverified** | `frappe-ui-react` announced as a React port (Dec 2025) | **Could not find it on npm** (no dist-tags) → not production-ready; do not depend on it | [announcement](https://rtcamp.com/blog/frappe-ui-react) · npm registry §7 |
| **Base64 bundle inside `www/<page>.html` (current repo)** | n/a | `apps/web/gen-shell.mjs` reads `dist/index.js`, base64-encodes it, embeds it in the template, and boots it via `Blob` + dynamic `import()` | **Not documented anywhere.** Works, but: +33% size, no HTTP caching, no code splitting, no sourcemaps, and the entire app re-downloads on every page load | [`apps/web/gen-shell.mjs`](apps/web/gen-shell.mjs) |

**Recommendation — keep the mechanism for now; retire the base64 within it.**
Two separate questions:
- *Should we keep an embedded bundle instead of `/assets`?* The generator comment says the containers don't
  share `sites/assets` (`apps/web/gen-shell.mjs:3-7`), which is an infra constraint, not a Frappe one. If the
  deploy topology can serve `/assets`, the documented path (`frappe-ui/vite`-style build → `base` URL + boot
  JSON injected by a `www/<page>.py`) is strictly better. If it cannot, the current model stays.
- *Should the bundle be base64?* No. The only reason is the `.__` guard, and **`safe_render = False` in
  `www/hoy.py`** disables it (documented). Inlining the raw minified JS still forgoes caching/splitting, but
  it removes the base64 inflation and the `atob`/`Blob` boot. This is a contained spike, not a rewrite.
- **Do not** adopt `frappe-ui` components (Vue). Adopt at most its **Vite plugin's ideas** if we move to assets.

---

## 4. Frappe `Event` vs `CRM Lead` — the leverage question

### 4.1 What `Event` already is (verified in the v15 source)

`frappe/desk/doctype/event/event.py` declares the DocType fields: `subject`, `starts_on`, **`ends_on`
(Datetime)**, **`all_day`**, `event_category`, `color`, `location`, `description`, **`repeat_this_event` +
`repeat_on` (Daily/Weekly/Monthly/Yearly) + `repeat_till` + per-weekday booleans**, `event_participants`
(child table of User/Contact links), `event_type` (Private/Public), `status`
(Open/Completed/Closed/Cancelled), `owner`, **`google_calendar` (Link)**, `google_calendar_id`,
`google_calendar_event_id`, `pulled_from_google_calendar`, `sync_with_google_calendar`, `google_meet_link`,
**`links` (Dynamic Link table)** and `reference_doctype`/`reference_docname`.
Source: [`event.py` (version-15)](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/desk/doctype/event/event.py).

The `Google Calendar` DocType (same file's integration) carries `calendar_name`, `enable`,
`google_calendar_id`, **`next_sync_token` (Password)**, `pull_from_google_calendar`, `sync_as_public`,
`push_to_google_calendar`, `refresh_token`, `user`, `authorization_code`.
Source: [`google_calendar.py`](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py).

The integration is wired by `hooks.py`: `Event` → `after_insert` = `insert_event_in_google_calendar`,
`on_update` = `update_event_in_google_calendar`, `on_trash` = `delete_event_from_google_calendar`; and the
`all` scheduler event runs `google_calendar.sync` (lines 199–203 and 245).
Source: [`frappe/hooks.py` (version-15)](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/hooks.py).

Two more things the framework already gives us:
- **A whitelisted read API that expands recurrences.** `frappe.desk.doctype.event.event.get_events(start, end, user, filters)`
  expands `repeat_on` server-side over the range and returns `original_starts_on`/`original_ends_on`. This is
  a ready-made alternative to our custom `get_agenda`.
- **A generic "doctype on a calendar" DocType**, `Calendar View` (`reference_doctype`, `subject_field`,
  `start_date_field`, `end_date_field`, `all_day`), used by ERPNext to put arbitrary doctypes on a calendar.
  It confirms the framework's intended pattern is *map a doctype to date fields*, not *bake dates into a contact*.
  Source: [`calendar_view.py`](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/desk/doctype/calendar_view/calendar_view.py) · [ERPNext how-to](https://docs.frappe.io/erpnext/how-to-sync-doc-types-with-calendar).

### 4.2 What migrating buys (vs. staying on `CRM Lead.custom_meeting_datetime`)

| Capability we lack today on `CRM Lead` | With `Event` | Evidence |
|---|---|---|
| **Duration** (`ends_on`) — `_meeting_dto` currently fabricates `end = start + 1h` (`api.py:38`) | Native `ends_on` field | `event.py` fields; `DECISIONES-PENDIENTES-agenda.md` DECISIÓN 1 |
| All-day, event category, color, location, Meet link | Native fields | `event.py` |
| Recurrence (basic RRULE mapping in both directions) | `repeat_on`/`repeat_till`/weekdays ↔ Google `RRULE:FREQ/BYDAY/UNTIL` | `google_calendar.py` (`google_calendar_to_repeat_on`, `repeat_on_to_google_calendar_recurrence_rule`) |
| **Timezone-correct two-way sync** | Pull converts to `get_system_timezone()` and stores naive; push sends `timeZone: get_system_timezone()`, `sendUpdates="all"` | `google_calendar.py` (`parse_google_calendar_date`, `format_date_according_to_google_calendar`) |
| Incremental pull with `next_sync_token` (incl. cancellations) | `sync_events_from_google_calendar` uses `singleEvents=False, showDeleted=True, syncToken`; 410 resets the token | `google_calendar.py` |
| Participants as first-class links | `event_participants` child table (User/Contact), attendees pushed to Google | `event.py`, `google_calendar.py` |
| **Meeting ↔ lead without identity coupling** | `links` (Dynamic Link) + `reference_doctype/name`; the Event links to the Lead/Deal/Contact | `event.py` |
| Delete semantics | `Event.on_trash` deletes its Communications and calls Google; the **Lead is untouched** | `event.py` (`on_trash`) |

This directly answers **DECISIÓN 2** in `DECISIONES-PENDIENTES-agenda.md`: with `Event`, deleting a meeting
is just deleting an event. "Soft-deleting" the lead's meeting fields to avoid destroying a contact becomes
unnecessary.

### 4.3 What migrating costs (the honest list)

1. **Migrate the 10 existing meetings.** The v2 design already scoped this
   (`2026-09-16-agenda-diseno-v2-auditado.md` §1.5): 3 came from Google → create `Event` with
   `google_calendar_event_id = custom_event_id`, `pulled_from_google_calendar=1`, `google_calendar` = the
   ingestion record, and a Dynamic Link to the Lead; 7 were CRM-created → `Event` with
   `sync_with_google_calendar=0`. **Duration is not recoverable from the lead** (no end field), so default it
   (1h) or read it back from the Google event. Freeze `custom_meeting_datetime` and keep the Lead.
2. **Three hard edges in the framework's sync** (all confirmed in `google_calendar.py`), which mean we must
   not wire our writes straight through `doc_events`:
   - **Push blocks the save.** `insert_event_in_google_calendar` calls `frappe.throw` on `HttpError` inside
     the request → if Google fails, the meeting cannot be saved.
   - **Delete fails silently.** `delete_event_from_google_calendar` catches `HttpError` with a `msgprint` and
     returns → the CRM deletes and Google keeps it.
   - **Update is unsafe.** `update_event_in_google_calendar` skips when `modified == creation` and calls
     `doc.get_doc_before_save()` (can be `None`/crash when loaded via `get_doc`); its guard also does **not**
     check `pulled_from_google_calendar`, unlike the insert guard.
   ⇒ Adopt the **reliability layer already designed** in `2026-09-16-agenda-diseno-v2-auditado.md` §2.3: save
   the `Event` with `sync_with_google_calendar=0`, enqueue our own push wrapper (Google SDK, correct
   `colorId`/RRULE), retries + visible sync state + reconciliation, and controlled deletion.
3. **Recurrence exceptions are discarded.** In `sync_events_from_google_calendar`, the branch
   `if event.get("recurringEventId"): ...` is a Python `Ellipsis` — a **no-op**; and `Event` is one row per
   series, with nowhere to store "this instance moved/cancelled". The framework docs also state it as a
   limitation: *"if an instance of a recurring event is cancelled in Google Calendar, this change will not be
   reflected in Frappe."* So if we promise per-instance editing, we need our own exception DocType
   (as designed §2.4) — **or** declare it out of scope for the first release.
   Source: `google_calendar.py` · [Google Calendar Integration docs → Limitations](https://docs.frappe.io/framework/user/en/guides/integration/google_calendar).
4. **Recurrence parity is incomplete.** The mapping only handles `FREQ`/`BYDAY`/`UNTIL`; there is no
   `INTERVAL`/`COUNT`, a `Daily` event drops `ends_on`, and `Yearly` + `UNTIL` loses the end (companion
   design §2.5, verified in `google_calendar.py`). If the UI promises "recurrence like Google Calendar", we
   add custom fields + our own serializer/parser.
5. **The lead-centric CRM doesn't know about Events.** Lead list/detail pages must show "its meeting(s)" via a
   custom field or a Dynamic Link query. This is additive UI work, not a blocker.
6. **Pieces the framework needs turned on first** (per the v2 design, still valid): `System Settings.enable_scheduler`
   is currently **0** (so pull never runs), `Google Settings` unconfigured, `0` `Google Calendar` records, and
   OAuth callback `https://{site}?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`.
7. **Permissions model changes.** `Event.get_permission_query_conditions` = `event_type='Public' OR owner=user
   OR participant`, and `has_permission` denies write/create/delete to mere participants. Team visibility
   therefore requires `event_type="Public"`; the business rule for "who may edit whose meeting" must be decided.
8. **Do not re-declare the DocType.** This repo historically defined its own DocType named `Event` and
   overrode Frappe's; it was removed and the runbook warns about it (`docs/runbook-crm-core.md:53-55`). An
   `Event` adoption only adds **Custom Fields** (`custom_crm_agenda`, `custom_crm_deal`, `custom_crm_organization`,
   `custom_crm_lead`, `custom_origen`, sync-state fields, `custom_repeat_interval`, `custom_repeat_count`), never a DocType.

### 4.4 Recommendation

**Adopt Frappe `Event` as the meeting entity; link it to `CRM Lead`/`CRM Deal`/`Contact` via Dynamic Link;
keep `custom_meeting_datetime` frozen for backwards compatibility; retire the one-way cron
`scripts/sync/sync-gcal-crm.py` once ingestion works.** Concretely:

1. Read path: query `Event` (optionally reuse `event.get_events` for recurrence expansion) instead of
   scanning `CRM Lead.custom_meeting_datetime`; duration/all-day come for free.
2. Write path: `Event` saved with `sync_with_google_calendar=0`, then enqueue the push wrapper; never rely on
   the raw `doc_events` push. Provide the "Pendiente / Falló / Sincronizada" badge designed in §2.3.D.
3. Migration script for the ~10 existing meetings (Google-origin vs CRM-origin), with Dynamic Links to the Lead.
4. Keep per-instance recurrence exceptions as a **separate, explicitly-scoped task**; first release either
   omits them or shows Google's exceptions as read-only annotations.
5. Add a "Reuniones" panel on the Lead page reading linked Events, so the lead-centric CRM stays coherent.

**Why this is better than the alternatives:** adding `custom_meeting_end` (+ our own recurrence fields) to
`CRM Lead` reinvents `Event` and doubles down on the root cause at `api.py:757`; staying on the fabricate-1-hour
DTO means duration/resize can never be honest (DECISIÓN 1). `Event` is the only option where duration,
all-day, recurrence, timezone and sync already exist and are already tested by the framework.

---

## 5. Date/time handling

| Option | License | Good for | Pitfalls / cost | Source |
|---|---|---|---|---|
| **`Intl` + native `Date`** | built-in | Formatting/parsing for display; zero deps | `Date` is an instant with a UTC epoch; parsing `"2026-09-17 10:00:00"` uses the **browser** zone, and `toISOString()` shifts it → the exact class of "-1 hour" bug already diagnosed in the prototype (`2026-09-16-agenda-hallazgos.md` §1.3) | [MDN/Intl] |
| **date-fns 4.4.0** | MIT | Tree-shakeable date arithmetic; last publish 2026-05-29 | No timezone database (needs `date-fns-tz`); works on `Date`, so the instant-vs-wall-clock trap remains | npm registry §7 |
| **Luxon 3.7.2** | MIT | `DateTime` with named zones via `Intl`; duration math; last publish 2025-09-05 | Heavier; still a separate date model from Frappe's naive strings | npm registry §7 |
| **Temporal** | spec (ES2026); polyfills MIT/ISC | The correct model: `PlainDate`/`PlainTime`/`ZonedDateTime`/`Duration`; Frappe's own FullCalendar lead builds the de-facto polyfill | **Safari has not shipped it** → a polyfill is mandatory for a public site. `temporal-polyfill` 1.0 is MIT and ~19.5 kB gzip; `@js-temporal/polyfill` is ISC, ~52 kB, last published 2025-03 | [WebKit bug 320164 (claim)](https://bugs.webkit.org/show_bug.cgi?id=320164) · [`temporal-polyfill`](https://github.com/fullcalendar/temporal-polyfill) |
| **Recurrence expansion** | — | Server: Frappe already expands recurrence in `get_events`; `python-dateutil` is used by the integration | Client `rrule` is BSD-3-Clause but **last published 2023-11 → low maintenance**; Frappe's own model lacks INTERVAL/COUNT | `event.py` · npm registry §7 |
| **Python side: `frappe.utils`** | MIT | `getdate`, `get_datetime`, `add_to_date`, `now_datetime`, `get_system_timezone`, `convert_utc_to_system_timezone`, `get_datetime_in_timezone` | — | [Utility Functions](https://docs.frappe.io/framework/user/en/api/utils) |
| **Python side: `zoneinfo` (3.9+)** | stdlib | Named zones; **Frappe v15 itself uses `zoneinfo`** in `google_calendar.py` (`ZoneInfo(get_system_timezone())`) — so `pytz` is legacy here | — | `google_calendar.py` |

**The decisive fact:** Frappe stores **naive** datetimes interpreted in the **site/system timezone**
(`America/Argentina/Cordoba` here), not UTC. The integration bakes this in: pull does
`parser.parse(dt["dateTime"]).astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)`, and push
sends `{"dateTime": starts_on.isoformat(), "timeZone": get_system_timezone()}`
(`google_calendar.py`). Corroborated by Frappe's own CRM boot payload exposing `timezone.system` and
`timezone.user` to the frontend (`crm/www/crm.py`). Mantine Schedule documents the same model —
"timezone-agnostic `YYYY-MM-DD HH:mm:ss` strings and does not perform any timezone conversions on its own"
([docs](https://mantine.dev/schedule/week-view)) — which is a small point in its favour if a library is ever adopted.

**Recommendation:**
- Keep the **wire format naive** (`YYYY-MM-DD HH:mm:ss`) in the **site timezone**; **never** call
  `Date.prototype.toISOString()` on a server datetime, and never let the browser re-zone it.
- Do all grid math in **integer minutes since midnight** (as the prototype does) — no float hours, no DST surprises.
- Use **`Intl.DateTimeFormat`** for labels; use **Temporal (with `temporal-polyfill`) or Luxon** only where
  zone-aware arithmetic is genuinely needed.
- Compute/expand recurrence on the **server** (`get_events`, or our own expansion with `python-dateutil`,
  which the integration already depends on); store the RRULE and the original instance id as designed.
- The site timezone is fixed and Argentina has no DST — say so in the spec instead of implying full DST rigor.

---

## 6. Bottom line — the stack to build on

| Layer | Decision |
|---|---|
| Calendar grid / interaction | **Our own React implementation** of the audited prototype (1/n lanes, non-modal panel, roving tabindex list, focus/announce rule). No library. |
| Patterns to copy (MIT/Apache) | MUI X Scheduler's ARIA/context-menu model, FullCalendar's issue threads, `dnd-kit` KeyboardSensor semantics. |
| Drag & drop | Hand-written pointer handlers; WCAG met by the **existing menu/dialog alternative**. Optional `dnd-kit` only if we want a reusable primitive. |
| Meeting data model | **Frappe `Event`**, linked to `CRM Lead`/`Deal`/`Contact` by Dynamic Link; `CRM Lead.custom_meeting_datetime` frozen. |
| Google sync | Native Frappe integration + **our reliability wrapper** (save with sync off, enqueue push, retries, visible state, controlled delete). Enable scheduler + `Google Calendar` records + OAuth first. |
| Frontend shipping | Keep `www/hoy.html` for now; remove **base64** via `safe_render=False` in `www/hoy.py`; move to `/assets` + `base` + boot JSON only if the topology allows; do **not** adopt `frappe-ui` components (Vue). |
| Date/time | Naive site-timezone strings on the wire; integer-minute slot math; `Intl` for display; Temporal+polyfill/Luxon for zone math; recurrence expanded on the server. |

## 7. Verification status

**Verified this session against primary sources:** npm registry (license, version, unpacked size, last
publish) for FullCalendar, react-big-calendar, Schedule-X, `@mui/x-scheduler` (9.0.0-beta.12), Mantine
Schedule, `@toast-ui/calendar`, `v-calendar`, `@dnd-kit/*`, pragmatic-drag-and-drop, `react-aria`,
Temporal polyfills, `luxon`, `date-fns`, `rrule`, `frappe-ui`; FullCalendar/MUI/Schedule-X/Bryntum/DHTMLX/Mantine
licensing and pricing pages; MUI X Scheduler accessibility page; Frappe v15 `event.py`, `google_calendar.py`,
`hooks.py`, `calendar_view.py`, portal-pages docs, asset-bundling docs, frappe-ui vite README/source,
`frappe-ui-starter`, and the Frappe CRM `frontend/vite.config.js` + `crm/www/crm.py` (note: `crm/www/crm.html`
is **not** in the repo — it is generated by the build).

**Carried over from the companion docs (not re-verified here):** Kendo's Scheduler not being in
`kendo-ui-core`; react-big-calendar's `src/Agenda.js` being a non-focusable `<td>`; the exact Google Calendar
API behaviours (instances, syncToken, `recurringEventId`/`originalStartTime`) in `2026-09-16-agenda-hallazgos.md`.

**Unverified / flagged inline:** the WebKit bug's dates for Chrome/Firefox/Node Temporal shipping (single
advocacy source); keyboard accessibility of Bryntum, DHTMLX Agenda, Kendo and Mantine Schedule; Kendo's
current price; Schedule-X and Mantine list-view keyboard behaviour; exact **gzipped** bundle sizes (only npm
**unpacked** size was measured); whether `frappe-ui-react` exists as a usable npm package (registry has no
`latest` dist-tag); the infra claim that containers cannot share `/assets`.
