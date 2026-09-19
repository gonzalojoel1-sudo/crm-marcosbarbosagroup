# Two-way Google Calendar sync — open-source landscape for a Frappe v15 app

**Date:** 2026-09-19
**Scope:** open-source code we can study or reuse for a two-way Google Calendar ↔ Frappe `Event`
sync. No code was written. Every concrete claim is cited; unverified items are marked
**unverified**. Licenses were read from the repository license file / PyPI metadata where
possible; the exact file is named.

**Local context (for the reader):** this repo already pulls Google → CRM one way via a host cron
script `scripts/sync/sync-gcal-crm.py` (`docs/runbook-crm-core.md:60-67`), and the design doc
`docs/superpowers/specs/2026-09-14-premium-crm-design.md` already commits to Google's sync
contract (`nextSyncToken`, `410 GONE → full resync`, ETag/`If-Match`). This report answers
"what can we study or reuse", not "what should we build".

**Method / caveat:** findings come from reading the repositories' own source files and license
files, the GitHub license API, PyPI metadata, and the maintainers' own PR/issue threads. Star
counts and last-commit dates are *not* re-measured here except where quoted from a page I read;
treat maturity as directional, not audited. The single most surprising result is in §5: the
`calcom/cal.com` repository now resolves to `calcom/cal.diy` and its LICENSE is **MIT**, not
AGPL.

---

## (a) Table of projects

| Name | What it solves | Licence (source) | Maturity | File to read |
|---|---|---|---|---|
| `frappe/frappe` — `integrations/doctype/google_calendar` | Native Frappe `Event` ↔ Google Calendar pull + push hooks, recurrence mapping, Meet links | **MIT** (source header `License: MIT. See LICENSE`) | Framework ~10.8k★, active | `frappe/integrations/doctype/google_calendar/google_calendar.py` ([v15 raw](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py)) |
| `frappe/crm` | CRM app; issue #110 "Calendar Integration" | **AGPL-3.0** (`LICENSE`) | Active | Repo only; no calendar sync code — #110 was **closed** and calendar moved out ([issue #110](https://github.com/frappe/crm/issues/110)) |
| `frappe/mail` PR #399 "feat: calendar" | Attempted calendar feature; **closed** Apr 2026, repo **archived** Aug 2026 | (Frappe app; repo archived) | Closed | [PR #399](https://github.com/frappe/mail/pull/399) |
| `frappe/nextcloud-integration` | Frappe ↔ Nextcloud (not calendar sync) | **MIT** (`LICENSE`) | Low activity | Repo |
| `pibico/pibical` | **Bidirectional Frappe/ERPNext ↔ CalDAV** (Nextcloud/ownCloud), recurring, TZ | **MIT** (`license.txt` says `License: MIT`; GitHub label "Other") | ~21★; v13 branch deprecated, v15 branch revived — see [frappe/frappe#18716](https://github.com/frappe/frappe/issues/18716) | `pibical/pibical/custom.py` (main sync logic, ~39 KB) ([raw](https://raw.githubusercontent.com/pibico/pibical/develop/pibical/pibical/custom.py)) |
| `pimutils/vdirsyncer` | The canonical two-way file/CalDAV syncer; status model + conflict handling | **BSD-3-Clause** (`LICENSE`) | Mature, reference design | `vdirsyncer/sync/__init__.py` ([blob](https://github.com/pimutils/vdirsyncer/blob/main/vdirsyncer/sync/__init__.py)); `vdirsyncer/vobject.py` (`ident`/`hash`) |
| `nextcloud/calendar` | Nextcloud's calendar (CalDAV server/client) | **AGPL-3.0** (`COPYING`) | Active (Nextcloud) | importer lives in the sibling app, not this repo |
| `nextcloud/integration_google` | Google → Nextcloud **one-time/one-way import** of calendars/contacts/photos/drive | **AGPL-3.0** | ~133★, active | `lib/Service/GoogleCalendarAPIService.php` ([blob](https://github.com/nextcloud/integration_google/blob/main/lib/Service/GoogleCalendarAPIService.php)) |
| `MarcelRobitaille/nextcloud_google_synchronization` | Fork: periodic **Google → Nextcloud** calendar import (one-way) | **AGPL-3.0** (`COPYING`, API `spdx_id: AGPL-3.0`) | Small fork | GitHub repo |
| `ianustec/nextcloud-google-calendar-sync` | **Genuinely bidirectional** Google Workspace ↔ Nextcloud; mapping tables + sync tokens/etags; last-modified-wins | **AGPL-3.0** (`LICENSE`, © 2026 IANUSTEC) | New (© 2026) | `lib/Service/` (SyncEngine), `lib/Db/` (mapping), `lib/Migration/`, `lib/Cron/` |
| `calcom/cal.diy` (formerly `calcom/cal.com`) | Scheduling app; Google Calendar create/update/delete + **free/busy("busy-time") sync** | **MIT** (`LICENSE`, API `spdx_id: MIT`); no `ee`/`packages/ee` dir found (404) | Large, active; repo renamed | `packages/app-store/googlecalendar/lib/CalendarService.ts` ([raw](https://raw.githubusercontent.com/calcom/cal.diy/main/packages/app-store/googlecalendar/lib/CalendarService.ts)) |
| `chriskoch/cal-sync` | **Python/FastAPI bidirectional Google ↔ Google** sync; `event_mappings`, content hashing, idempotent | **MIT** (`LICENSE`, API `spdx_id: MIT`) | Small/personal (© 2025) | `backend/app/core/sync_engine.py` ([blob](https://github.com/chriskoch/cal-sync/blob/main/backend/app/core/sync_engine.py)) |
| `samiabid/calbridge-sync` | **Node/TS two-way** Google↔Google; webhooks, sync tokens, mapping, loop prevention | **Unlicensed — no LICENSE/COPYING in repo root** (GitHub license API 404) | New (© 2026) | `src/`, `prisma/schema.prisma`; README documents model |
| `bobuk/gcalsync` | Go multi-account sync via "blocker" events; read/write/both modes | **MIT** (stated in README) | Small | Go source; SQLite store |
| `marianozunino/go-sync-cal` | Go: merge/two-way sync between two Google Calendars | **MIT** (`LICENSE`, API `spdx_id: MIT`) | Small (© 2023) | Go source |
| `onfranciis/booking-headless` | Rust booking backend; two-way = free/busy + event creation | **unverified** (license not read) | New | Rust source |
| `Kozea/Radicale` | CalDAV/CardDAV server (server side of the pattern) | **GPL-3.0** (`COPYING.md`, API `spdx_id: GPL-3.0`) | Mature | — (pair with vdirsyncer) |

---

## 1. Frappe ecosystem — what exists, and what upstream actually fixed or refused

### 1.1 The native integration (baseline, MIT)

`frappe/frappe` core is MIT. The v15 file
`frappe/integrations/doctype/google_calendar/google_calendar.py` is the whole integration:

- Pull uses `events().list(..., singleEvents=False, showDeleted=True, syncToken=...)` and stores
  `next_sync_token` as an encrypted `Password` field. On HTTP **410** it clears the token and
  asks for a retry. ([file](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py))
- Push is split across `insert_event_in_google_calendar`,
  `update_event_in_google_calendar`, `delete_event_from_google_calendar`; recurrence ↔ `RRULE`
  conversion is in `google_calendar_to_repeat_on` / `repeat_on_to_google_calendar_recurrence_rule`.
- **There is no per-event ETag / `If-Match`, no mapping table, and no conflict detection.** Echo
  suppression is only `pulled_from_google_calendar` plus the `doc.modified == doc.creation`
  guard in the update hook. The delete hook does **not** check `sync_with_google_calendar`.
- Recurring Google events are effectively skipped: after `if event.get("recurringEventId"): ...`
  the branch is empty. (Your own audit already records this:
  `docs/superpowers/research/2026-09-16-agenda-diseno-v2-auditado.md:119-180`.)

**Takeaway:** the date/recurrence conversion and the `nextSyncToken`+410 handling are reusable
directly (same MIT codebase, same `Event` doctype). The *sync engine* is what upstream does not
have.

### 1.2 What maintainers fixed (so we don't re-fix it)

- **`refactor: Google Calendar` PR [#31772](https://github.com/frappe/frappe/pull/31772)**
  (merged Mar 2025, backported as [#31807](https://github.com/frappe/frappe/pull/31807)) fixes:
  correct recurrence parsing, "ensure all calendars are synced, not just the first", events
  without titles, **sync based on the calendar user not the creator** (closed
  [#30918](https://github.com/frappe/frappe/issues/30918)), participant sync for in-system users,
  and moves the job from hourly to "all". It also explicitly **deferred** two items the author
  wanted ("stop the sync job unless Google Settings enabled" and "more frequent / push
  notifications watcher").
- **410 sync-token reset** PR [#10764](https://github.com/frappe/frappe/pull/10764) /
  backport [#10889](https://github.com/frappe/frappe/pull/10889) — the 410 handling you rely on.
- **Cancelled-event crash** issue [#37010](https://github.com/frappe/frappe/issues/37010) /
  PR [#37031](https://github.com/frappe/frappe/pull/37031): the pull loop crashed with
  `DoesNotExistError: Event None not found` when a cancelled Google event had no local match;
  fixed and shipped in **v15.100.1** and v16.7.0 (per the issue's release bot comments).

### 1.3 What maintainers refused / deferred

- **CalDAV/CardDAV has been requested since 2013** ([#339](https://github.com/frappe/frappe/issues/339),
  closed) and again in [#18716](https://github.com/frappe/frappe/issues/18716). A maintainer
  replied that the Google connector is a "short/mid-term and pragmatic solution … until someone
  funds the development of a better solution"; contributors pointed at Radicale, `pibico/pibical`
  and `python-caldav`. That thread also records that `pibical` was deprecated for v15 and later
  revived.
- **`frappe/calendar` does not exist.** `https://api.github.com/repos/frappe/calendar` returns
  **404**. There is no first-party Frappe calendar-sync repo to fork.
- **Calendar is not in `frappe/crm`.** Issue [#110](https://github.com/frappe/crm/issues/110) is
  **closed**; the discussion there ("calendar will be a component close to frappe mail…") led to
  `frappe/mail` PR [#399](https://github.com/frappe/mail/pull/399), which was **closed Apr 2026**
  with the comment *"Calendar will be a separate app as opposed to part of the Mail repo."*
  `frappe/mail` was **archived Aug 10, 2026**. So as of this report there is **no public
  Frappe-maintained calendar app** to lean on.
- **Community forks/apps beyond `pibical`:** none credible found for Google two-way sync.
  `pibical` is CalDAV, not Google. `frappe/nextcloud-integration` (MIT) is contacts/files, not
  calendar. Anything else would be **unverified**.

---

## (b) Closest matches — how the algorithm actually works

### B1. `vdirsyncer` — the reference two-way engine (BSD-3) — closest *model*

The whole algorithm is in [`vdirsyncer/sync/__init__.py`](https://github.com/pimutils/vdirsyncer/blob/main/vdirsyncer/sync/__init__.py)
(design write-up: ["A simple synchronization algorithm"](https://unterwaditzer.net/2016/sync-algorithm.html)).

- A persistent **`status`** maps each item identity to per-side metadata
  `ItemMetadata(href, etag, hash)`.
- `_StorageInfo.prepare_new_status()` lists both sides and prefetches only items whose
  `href/etag` differ from status.
- `is_changed(ident)` = `new_meta.etag != old_meta.etag AND new_meta.hash != old_meta.hash`
  (etag = cheap change signal, content hash = confirm).
- `_get_actions()` yields exactly one action per identity: `Upload`, `Update`, `Delete`, or
  `ResolveConflict`, from (present in A?, present in B?, changed in A?, changed in B?).
- `ResolveConflict` calls the caller's `conflict_resolution` (`"a wins"`, `"b wins"`, or a callable);
  the default raises `SyncConflict`. **It does not auto-merge.**
- Safety: `StorageEmpty` aborts when one side is suddenly empty; `partial_sync` handles read-only
  sides; every action runs inside a rollback scope and the status write is transactional.

**Important correction to a common assumption:** vdirsyncer is *not* a textual three-way merge.
"Three-way" here means **base = last-synced status**; the merge decision is delegated. Adapting
the *shape* (status table + change triage + explicit conflict policy) to Python/Frappe is
trivial; the CalDAV `Storage` plumbing is not relevant to Google's REST API.

### B2. `ianustec/nextcloud-google-calendar-sync` — closest *real Google two-way*, but AGPL

The README's own diagram: `SyncEngine::syncUser()` lists NC calendars (CalDavBackend) and Google
calendars (service-account impersonation), pairs them **by display name**, then
`syncCalendarPair()` does Google→NC (create/update/delete), NC→Google (push new/changed), and
resolves conflicts **last-modified-wins**; it stores **sync tokens + etags in mapping tables**.
Two tables: `oc_neura_gcal_calendar_mapping` (calendar ID pair + sync token) and
`oc_neura_gcal_event_mapping` (**NC event UID ↔ Google event ID pairs with etags**)
([repo README](https://github.com/ianustec/nextcloud-google-calendar-sync)). Exact files:
`lib/Service/` (engine), `lib/Db/` (entities), `lib/Migration/`, `lib/Cron/`
([tree](https://api.github.com/repos/ianustec/nextcloud-google-calendar-sync/contents/lib)).
**Licence AGPL-3.0 — study for the design, do not copy code.**

The older official importer is one-way and simpler:
[`nextcloud/integration_google/lib/Service/GoogleCalendarAPIService.php`](https://github.com/nextcloud/integration_google/blob/main/lib/Service/GoogleCalendarAPIService.php)
(AGPL-3.0).

### B3. `calcom/cal.diy` (Cal.com OSS) — busy-time sync + event CRUD, **MIT now**

[`packages/app-store/googlecalendar/lib/CalendarService.ts`](https://raw.githubusercontent.com/calcom/cal.diy/main/packages/app-store/googlecalendar/lib/CalendarService.ts)
is the exact file. Relevant methods:

- `createEvent` / `updateEvent` / `deleteEvent` — build a `calendar_v3.Schema$Event`, set
  `conferenceDataVersion`, `sendUpdates:"none"`, and patch in the Meet link after insert.
- `getAvailability` → `getFreeBusyData` → `fetchAvailability` calls `calendar.freebusy.query`.
  It **chunks ranges into 90-day windows** (Google's `/freebusy` limit) and filters out
  holiday/birthday system calendars. This is the "busy-time sync" you asked about: it is
  **free/busy, not a two-way event merge**.
- `deleteEvent` treats **410** as "already deleted" and **404** as "on another calendar" and
  returns quietly.
- Recurrence via the `rrule` package; exceptions handled through `events.instances` for
  `existingRecurringEvent`.
- Echo/duplication control is **booking-centric** (Cal.com's own DB is the source of truth), not
  a generic etag merge. So it is a great reference for *Google API mechanics*, not for the
  mapping engine.

### B4. `chriskoch/cal-sync` — closest *Python* implementation (MIT)

[`backend/app/core/sync_engine.py`](https://github.com/chriskoch/cal-sync/blob/main/backend/app/core/sync_engine.py)
(MIT). Models: `event_mappings` table (bidirectional tracking, `sync_cluster_id` UUID,
SHA-256 content hashing, last-modified timestamps, bidirectional references), plus Google
`extendedProperties.shared.source_id` written onto each created event as the **echo marker**.
Sync operations are create/update/delete/skip driven by comparing source events to the mapping
(README documents "Idempotent sync mechanism — unlimited re-runs without duplicates"). Small
personal project, but the closest language match and the schema is directly portable to
Frappe DocTypes.

### B5. `samiabid/calbridge-sync` — richest *webhook* design, **but unlicensed**

The repo root has **no LICENSE/COPYING** (GitHub license API returns 404), so it is *all rights
reserved*: read for ideas, do not copy. Its README is nonetheless the best short spec of the hard
parts: one active mapping per `syncId + sourceCalendarId + sourceEventId`; Google incremental
**sync tokens advanced only after every returned change succeeds**; expired token → fresh
baseline + reconciliation; recurring exceptions keyed by `recurringEventId + originalStartTime`
(never treat multiple cancelled occurrences as a whole-series delete); "events created by sync
are marked to prevent infinite loops"; webhook channels renewed and cleared safely.
([README](https://github.com/samiabid/calbridge-sync))

### B6. Go variants (both MIT)

- [`bobuk/gcalsync`](https://github.com/bobuk/gcalsync) — syncs multiple Google calendars by
  writing **"blocker" events**; per-calendar `read`/`write`/`both` modes; local **SQLite** store
  of tokens/event data. Not a symmetric merge, but a clean example of "one calendar is a source,
  the other mirrors availability".
- [`marianozunino/go-sync-cal`](https://github.com/marianozunino/go-sync-cal) — literal two-way
  merge between two Google Calendars with a `twoWaySync` flag and field redaction options.

### B7. `pibico/pibical` — the Frappe-native one, but CalDAV (MIT)

`pibical/pibical/custom.py` is a ~39 KB bidirectional sync for Frappe/ERPNext ↔ CalDAV
(Nextcloud/ownCloud), MIT. Historically v13-only and "deprecated for v15", then revived for v15
([frappe/frappe#18716](https://github.com/frappe/frappe/issues/18716)). It is the best example of
the *Frappe integration surface* (hooks, custom fields, per-minute job) even though it speaks
CalDAV, not Google.

---

## (c) Named reusable patterns, with source and adaptability

| Pattern | What it is | Source (file) | Trivially adaptable to Frappe/Python? |
|---|---|---|---|
| **Status / mapping table** | One row per item identity holding `href/etag/hash` for each side | `vdirsyncer/sync/__init__.py` (`ItemMetadata`, `SubStatus`); ianustec `oc_neura_gcal_event_mapping`; `chriskoch/cal-sync` `event_mappings`; calbridge `SyncedEvent` | **Yes** — a Frappe child/standalone DocType `CRM GCal Map` with `event`, `gcal_event_id`, `gcal_etag`, `gcal_updated`, `gcal_status`, `last_synced_hash`, `direction` |
| **Etag + content-hash columns** | Cheap change detection via etag, confirm via SHA-256 of normalized body | `vdirsyncer/vobject.py` (`hash_item`, `ident`); `chriskoch/cal-sync` (SHA-256) | **Yes** — compute a normalized hash of the Google event JSON / Event fields and store it |
| **Three-way (base = last-synced status)** | Decide add/update/delete by comparing current A/B to the stored base; merge is **delegated**, not automatic | `vdirsyncer/sync/__init__.py` (`is_changed`, `_get_actions`, `ResolveConflict`) | **Yes** — this is the core loop to port; vdirsyncer does *not* text-merge |
| **Explicit conflict rule** | `a wins` / `b wins` / callable; default raises; others use **last-modified-wins** | `vdirsyncer` docs ("Conflict resolution"); ianustec README | **Yes** — pick last-modified-wins or CRM-wins and persist a conflict audit |
| **Echo suppression** | Prevent a synced write from re-triggering a push | Frappe `pulled_from_google_calendar` + `modified == creation`; `chriskoch/cal-sync` `extendedProperties.shared.source_id`; calbridge "marked to prevent infinite loops"; ianustec "separate mapping tables" | **Yes** — Frappe already has the flag; a mapping/etag check is stronger than a boolean |
| **Incremental sync token + 410 recovery** | `nextSyncToken`; on 410 wipe token and full-resync | Frappe `google_calendar.py` (`next_sync_token`, status 410 branch); calbridge README; Google Calendar API v3 sync guide | **Yes** — Frappe already implements it |
| **Full-sync safety valve** | Abort if one side suddenly reads empty/clobbered | `vdirsyncer` `StorageEmpty` / `force_delete` | **Yes** — cheap and prevents catastrophic mass-delete |
| **Recurrence exception handling** | Key per-instance exceptions by `recurringEventId + originalStartTime`; don't let cancelled instances delete the series | calbridge README; Google `singleEvents` / `events.instances`; contrast Frappe which skips `recurringEventId` | Partly — real work; Frappe's `Event` recurrence model does not store per-instance exceptions |
| **Busy-time / free-busy sync** | Query `freebusy.query` for external conflicts, chunk 90 days | Cal.com `CalendarService.ts` (`fetchAvailabilityData`) | Yes, if you need availability; orthogonal to event merge |

---

## (d) Licensing verdict

**Closest approaches and whether re-implementation is unencumbered:**

1. **`vdirsyncer` — BSD-3-Clause.** Permissive. You may study and re-implement freely, and even
   copy code into a closed Frappe app provided you keep the copyright notice and don't use the
   authors' names to endorse. This is the safest model to mirror.
2. **`chriskoch/cal-sync` — MIT.** Permissive. Its Python schema (mapping table + content hash +
   `source_id`) can be re-implemented or adapted with attribution. Small project; treat as a
   pattern, not a dependency.
3. **`calcom/cal.diy` (Cal.com OSS) — MIT (verified via `LICENSE` and GitHub license API on
   `main`).** **This contradicts the premise that Cal.com is AGPL.** Two cautions:
   (i) the repository was renamed `calcom/cal.com` → `calcom/cal.diy` (the license API rewrites
   the URL), and older commits/branches were **AGPL-3.0** — if you copy anything, **pin the MIT
   commit and read its LICENSE**; (ii) no `ee` or `packages/ee` directory was found (both 404),
   but I did not exhaustively scan every directory for a sub-license. Cal.com's *hosted product*
   terms are separate. Treat the current OSS repo as MIT, but verify the exact revision.

**Copyleft / avoid copying:**

- **AGPL-3.0:** `frappe/crm` (all of it), `nextcloud/calendar`, `nextcloud/integration_google`,
  `MarcelRobitaille/nextcloud_google_synchronization`, `ianustec/nextcloud-google-calendar-sync`.
  Do **not** copy code from these into a proprietary CRM; AGPL's network clause bites even for
  SaaS. Reading them to learn the *design* is fine; re-implement from the design.
- **GPL-3.0:** `Kozea/Radicale` — server-side; study only.
- **Unlicensed (all rights reserved):** `samiabid/calbridge-sync` — **no license file exists**;
  do not copy, adapt, or vendor it.
- **Frappe core is MIT**, so the native `google_calendar.py` helpers *can* be imported/reused
  directly (and ship with your framework dependency anyway).

**Python libraries (for §e):**

| Library | Licence | Maintenance |
|---|---|---|
| `google-api-python-client` | Apache-2.0 (**not re-verified this session**) | Google-maintained, active |
| `google-auth`, `google-auth-oauthlib` | Apache-2.0 (**not re-verified this session**) | Google-maintained, active |
| `gcsa` (Google Calendar Simple API) | **MIT** (PyPI `info.license`; `License :: OSI Approved :: MIT License`) | Active: v2.7.0 released 2026-07-14 |
| `caldav` (python-caldav) | **Dual GPL-3.0 / Apache-2.0** (README: "dual-licensed under … GPLv3 or the Apache License 2.0"; `COPYING.GPL` + `COPYING.APACHE`) | Active |
| `icalendar` | **BSD-2-Clause** (2-condition BSD text in `LICENSE.rst`; GitHub labels "Other") | Active (Plone collective) |

---

## (e) The honest answer: can we lean on something?

**There is no maintained Python library that implements generic two-way Google Calendar sync
(mapping + change detection + conflict resolution).** What exists is:

- **Transport + typed models** — `google-api-python-client` (Apache-2.0) and
  `google-auth` (Apache-2.0), or the friendlier **`gcsa` (MIT, actively released)**. `gcsa`
  wraps event/calendar CRUD and recurrence but, per its own README/PyPI description, it is a
  "Pythonic object oriented adapter for the official API" — **it has no sync state, no mapping,
  no conflict handling**. It removes boilerplate, not the sync problem.
- **iCalendar parsing** — `icalendar` (BSD-2), useful if you ever need `.ics` import/export;
  irrelevant to Google's JSON API.
- **A CalDAV *engine*, not a Google one** — `vdirsyncer` (BSD-3) is the reference two-way
  algorithm, but it is a standalone CLI/library whose `Storage` is CalDAV/filesystem. You cannot
  drop it into a Frappe app for Google's REST API; you can copy its **status + triage + conflict**
  design (see §c).

**Recommended direction (as research conclusion, not implementation):** implement the mapping
ourselves and use Google's own Python client.

1. Keep Frappe's MIT `google_calendar.py` for date/RRULE conversion and `nextSyncToken`+410.
2. Add a `CRM GCal Map` DocType (identity → `gcal_event_id`, `gcal_etag`, `gcal_updated`,
   `gcal_status`, `local_hash`, `remote_hash`, `last_synced_at`) modelled on vdirsyncer's
   `ItemMetadata` and the ianustec mapping table.
3. Drive the loop with vdirsyncer-style change triage; conflict policy = **last-modified-wins**
   (or CRM-wins) with an audit row; use Google `updated`/ETag as the comparator and consider
   `If-Match` for optimistic locking (Google Calendar API v3 supports ETag/`If-Match` and returns
   **412** on mismatch — documented by Google; *not re-fetched in this session*).
4. Echo suppression: keep `pulled_from_google_calendar` for the Frappe hook guard **and** a
   mapping/etag check (Frappe's boolean alone is not enough; see the empty `recurringEventId`
   branch and the delete hook not checking `sync_with_google_calendar`).
5. For bookings from the Appointment Schedule link, prefer **Google → CRM as the read path**
   (as today's cron does) and CRM → Google only for events the CRM originates; do not attempt to
   bidirectionally merge recurring series in v1 — the `Event` model has no per-instance exceptions
   (this is the one area all the references warn about).

**If a dependency is wanted anyway:** the only code-adjacent reusable pieces are the Google
client (`google-api-python-client`, Apache-2.0 — it *is* a safe dependency) and optional `gcsa`
(MIT). No existing project is license-safe *and* importable *and* does two-way merge; the
permissive candidates (vdirsyncer BSD-3, cal-sync MIT, cal.diy MIT) are patterns to copy, and the
two-way Google-native ones (ianustec, Nextcloud) are AGPL.

---

## What I could not verify

- Stars / exact last-commit dates for most projects (only `frappe/frappe` ~10.8k★ and a few counts
  I read on pages). Maturity columns are directional.
- `onfranciis/booking-headless` license (not fetched).
- `google-api-python-client` / `google-auth` licenses were not re-fetched this session (Apache-2.0
  is widely documented; treat as **unverified here**).
- `ical.js` / `tui-calendar` / `klokantech` / a maintained npm `google-calendar-sync`: **not
  verified and none found credible** for sync logic. `tui-calendar` is a UI library (out of scope
  per the brief) and `ical.js` (MPL-2.0, unverified) is a parser, not a sync engine.
- Whether any branch of `cal.diy` still carries an AGPL license: I verified only `main` (MIT) and
  the absence of `ee`/`packages/ee`. Pin a commit before copying.

---

### Source index (all URLs used)

- Frappe core: https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py
- Frappe PR #31772: https://github.com/frappe/frappe/pull/31772 · backport #31807: https://github.com/frappe/frappe/pull/31807
- Frappe 410 fix #10764: https://github.com/frappe/frappe/pull/10764 · #10889: https://github.com/frappe/frappe/pull/10889
- Frappe cancelled-event bug #37010: https://github.com/frappe/frappe/issues/37010 · fix #37031: https://github.com/frappe/frappe/pull/37031
- Frappe recurrence bug #15718: https://github.com/frappe/frappe/issues/15718 · owner bug #30918: https://github.com/frappe/frappe/issues/30918
- Frappe CalDAV request #18716: https://github.com/frappe/frappe/issues/18716 · #339: https://github.com/frappe/frappe/issues/339
- frappe/crm #110 (closed): https://github.com/frappe/crm/issues/110 · frappe/crm LICENSE (AGPL): https://github.com/frappe/crm/blob/develop/LICENSE
- frappe/mail PR #399 (closed, repo archived): https://github.com/frappe/mail/pull/399
- frappe/nextcloud-integration LICENSE (MIT): https://api.github.com/repos/frappe/nextcloud-integration/license
- pibical: https://github.com/pibico/pibical · logic: https://raw.githubusercontent.com/pibico/pibical/develop/pibical/pibical/custom.py · license (MIT): https://raw.githubusercontent.com/pibico/pibical/develop/license.txt
- vdirsyncer algorithm: https://github.com/pimutils/vdirsyncer/blob/main/vdirsyncer/sync/__init__.py · https://github.com/pimutils/vdirsyncer/blob/main/vdirsyncer/vobject.py · blog: https://unterwaditzer.net/2016/sync-algorithm.html · LICENSE (BSD-3): https://raw.githubusercontent.com/pimutils/vdirsyncer/main/LICENSE
- Cal.com/cal.diy: https://github.com/calcom/cal.diy · LICENSE (MIT): https://github.com/calcom/cal.diy/blob/main/LICENSE · license API: https://api.github.com/repos/calcom/cal.com/license · CalendarService.ts: https://raw.githubusercontent.com/calcom/cal.diy/main/packages/app-store/googlecalendar/lib/CalendarService.ts
- nextcloud/calendar (AGPL): https://github.com/nextcloud/calendar · https://raw.githubusercontent.com/nextcloud/calendar/master/COPYING
- nextcloud/integration_google (AGPL): https://github.com/nextcloud/integration_google · https://raw.githubusercontent.com/nextcloud/integration_google/main/lib/Service/GoogleCalendarAPIService.php
- MarcelRobitaille fork (AGPL): https://github.com/MarcelRobitaille/nextcloud_google_synchronization · license API: https://api.github.com/repos/MarcelRobitaille/nextcloud_google_synchronization/license
- ianustec fork (AGPL): https://github.com/ianustec/nextcloud-google-calendar-sync · license API: https://api.github.com/repos/ianustec/nextcloud-google-calendar-sync/license · lib tree: https://api.github.com/repos/ianustec/nextcloud-google-calendar-sync/contents/lib
- Radicale (GPL-3.0): https://api.github.com/repos/Kozea/Radicale/license
- chriskoch/cal-sync (MIT): https://github.com/chriskoch/cal-sync · engine: https://github.com/chriskoch/cal-sync/blob/main/backend/app/core/sync_engine.py · license API: https://api.github.com/repos/chriskoch/cal-sync/license
- samiabid/calbridge-sync (no license): https://github.com/samiabid/calbridge-sync · license API 404: https://api.github.com/repos/samiabid/calbridge-sync/license
- bobuk/gcalsync (MIT, README): https://github.com/bobuk/gcalsync
- marianozunino/go-sync-cal (MIT): https://github.com/marianozunino/go-sync-cal · license API: https://api.github.com/repos/marianozunino/go-sync-cal/license
- onfranciis/booking-headless (license unverified): https://github.com/onfranciis/booking-headless
- gcsa (MIT, v2.7.0 2026-07-14): https://pypi.org/pypi/gcsa/json
- python-caldav (dual GPL-3.0/Apache-2.0): https://github.com/python-caldav/caldav · https://raw.githubusercontent.com/python-caldav/caldav/master/README.md
- icalendar (BSD-2): https://github.com/collective/icalendar · https://api.github.com/repos/collective/icalendar/license
