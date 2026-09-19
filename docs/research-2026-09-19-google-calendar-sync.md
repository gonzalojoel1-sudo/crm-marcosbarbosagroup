# Frappe v15 native Google Calendar integration — deep research for a safe two-way sync

**Date:** 2026-09-19
**Primary evidence:** `frappe/frappe`, branch `version-15` (fetched 2026-09-19). Site in scope runs Frappe **15.120.0**.
**Files read (source of truth):**
- `frappe/integrations/doctype/google_calendar/google_calendar.py` — [link](https://github.com/frappe/frappe/blob/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py)
- `frappe/hooks.py` — [link](https://github.com/frappe/frappe/blob/version-15/frappe/hooks.py)
- `frappe/desk/doctype/event/event.json` — [link](https://github.com/frappe/frappe/blob/version-15/frappe/desk/doctype/event/event.json)
- `frappe/model/document.py`, `frappe/model/base_document.py`, `frappe/app.py`
- `frappe/integrations/doctype/google_settings/google_settings.json`

Local app evidence: `apps/crm_core/crm_core/api.py` (`insertar_evento_sin_sync`, `_neutralizar_sync_evento`, `_sacar_del_sync_antes_de_borrar`).

> Notation: `google_calendar.py:NNN` = line NNN of the `version-15` file as fetched on 2026-09-19. Line numbers drift between patch releases; verify before acting.

---

## 0. Verdict on the three claims (summary)

| Claim | Verdict | Evidence |
|---|---|---|
| Push **throws inside `Event.save()`** on HTTP error | **Verified (both insert and update)** | `google_calendar.py:496-501` (insert), `:580-585` (update); also auth failures raise at `:116-119`, `:104-109`, `:251-255`, `:264-269` |
| Native **delete fails silently** | **Verified, with nuance** | `google_calendar.py:610-615` catches `HttpError` and only `frappe.msgprint`s; no throw, no retry, no durable error. It is *visible in the Desk UI* but silent for API/scheduled callers |
| The **update guard is unsafe** | **Partially verified** | It does **not** check `pulled_from_google_calendar` (asymmetry vs insert at `:448`), and calls `doc.get_doc_before_save().add_video_conferencing` unguarded (`:551`). But it is **not** an echo vector by default, because pulled events carry `sync_with_google_calendar = 0` and the first guard (`:510-515`) returns. Details in §5 |

**Bottom line:** the three defects are real enough to justify what the app does today (neutralising the native hooks), but the app's neutralisation introduces a different, under-considered risk: **deleted CRM events reappear on the next full pull**, and CRM edits never reach Google. A reliable two-way sync is achievable for a single-consultant CRM **only by wrapping** the integration — see §6.

---

## 1. The push path, exactly

### 1.1 Triggers (doc_events)

`frappe/hooks.py:199-203`:

```python
"Event": {
    "after_insert": "frappe.integrations.doctype.google_calendar.google_calendar.insert_event_in_google_calendar",
    "on_update":    "frappe.integrations.doctype.google_calendar.google_calendar.update_event_in_google_calendar",
    "on_trash":     "frappe.integrations.doctype.google_calendar.google_calendar.delete_event_from_google_calendar",
},
```

All three are **global `doc_events` hooks** — they fire on *every* `Event` insert/update/delete on the site, not just the CRM's. There is no per-doctype opt-in besides the in-function guards.

Trigger points in the document lifecycle (`frappe/model/document.py`):
- `after_insert` runs inside `insert()` at `document.py:326`, i.e. **inside `Event.insert()`**, after the SQL insert (`:320`) and before `run_post_save_methods()` (`:334`).
- `on_update` runs inside `run_post_save_methods()` at `document.py:1182-1183`, i.e. **inside `Event.save()` / `insert()`**.
- `on_trash` runs during `frappe.delete_doc`.

### 1.2 `insert_event_in_google_calendar` (`:442-501`)

Guard (`:446-451`):

```python
if (
    not doc.sync_with_google_calendar
    or doc.pulled_from_google_calendar
    or not frappe.db.exists("Google Calendar", {"name": doc.google_calendar})
):
    return
```

Then `get_google_calendar_object(doc.google_calendar)` (`:453`) which:
- calls `GoogleCalendar.validate()` — throws if Google Settings disabled or client id/secret missing (`:104-109`);
- calls `get_access_token()` — raises `ValidationError` if no refresh token (`:116-119`);
- calls `check_google_calendar()` — throws if the calendar id is invalid (`:250-255`).

Push check `if not account.push_to_google_calendar: return` (`:455-456`). Builds the body (`:458-474`) using **`doc.google_calendar_id`** (a `fetch_from` field, see §4.7), then:

```python
try:
    event = google_calendar.events().insert(
        calendarId=doc.google_calendar_id, body=event,
        conferenceDataVersion=conference_data_version, sendUpdates="all").execute()
    frappe.db.set_value("Event", doc.name,
        {"google_calendar_event_id": event.get("id"), "google_meet_link": event.get("hangoutLink")},
        update_modified=False)
    frappe.msgprint(_("Event Synced with Google Calendar."))
except HttpError as err:
    frappe.throw(_("Google Calendar - Could not insert event in Google Calendar {0}, error code {1}.").format(...))
```
(`:476-501`)

**Where it throws:** the `except HttpError` → `frappe.throw` (`:496-501`), plus every pre-call throw listed above.

**Rollback semantics (why "the meeting is not saved" is true):** `after_insert` runs before the request commits. The exception propagates to `frappe/app.py`, where `rollback = True` (`app.py:140`) and, for unsafe HTTP methods (POST), `frappe.db.rollback()` runs (`app.py:191-192`). The API here is a POST (`insertar_evento_sin_sync` → whitelisted method), so **the inserted `Event` is rolled back**. For jobs, the exception aborts the job's transaction. **Claim verified.**

### 1.3 `update_event_in_google_calendar` (`:504-585`)

Guard (`:510-515`):

```python
if (
    not doc.sync_with_google_calendar
    or doc.modified == doc.creation
    or not frappe.db.exists("Google Calendar", {"name": doc.google_calendar})
):
    return
```

`doc.modified == doc.creation` is the "workaround" so the `on_update` that fires immediately after a fresh insert does not push (`:508-509`). Then, if the sync box is on but there is no Google id yet, it falls back to insert (`:517-520`):

```python
if doc.sync_with_google_calendar and not doc.google_calendar_event_id:
    insert_event_in_google_calendar(doc)
    return
```

Then the same auth/account resolution (`:522-525`), then inside `try`:

```python
event["recurrence"] = repeat_on_to_google_calendar_recurrence_rule(doc)   # :536
event["status"] = ("cancelled" if doc.status in ("Cancelled","Closed") else event.get("status"))  # :537-539
...
elif doc.get_doc_before_save().add_video_conferencing or event.get("hangoutLink"):   # :551
    ...
except HttpError as err:
    frappe.throw(... update Event ...)      # :580-585
```

**Unsafe points:**
1. **Asymmetry:** unlike insert, it never checks `doc.pulled_from_google_calendar` (`compare :448` vs `:510-515`).
2. **Unguarded `.get_doc_before_save()` at `:551`** — `get_doc_before_save()` returns `self._doc_before_save` and may be `None` (`document.py:503-504`; it is set to `None` for new docs at `:1161-1164`). For a normal update via `check_if_latest()` (`:850-859`) it is populated, but any save path that doesn't load it makes this line raise `AttributeError`, which is **not** an `HttpError`, so it escapes the `try/except` and **breaks the save**.
3. `frappe.throw` on `HttpError` (`:580-585`) — same rollback problem as insert.

### 1.4 `delete_event_from_google_calendar` (`:588-616`)

Guard (`:593-594`):

```python
if not frappe.db.exists("Google Calendar", {"name": doc.google_calendar, "push_to_google_calendar": 1}):
    return
```

Note: **it ignores `sync_with_google_calendar` entirely** — it only needs a `google_calendar` link whose record has push enabled. Then:

```python
try:
    event = google_calendar.events().get(calendarId=doc.google_calendar_id, eventId=doc.google_calendar_event_id).execute()
    event["recurrence"] = None
    event["status"] = "cancelled"
    google_calendar.events().update(calendarId=doc.google_calendar_id, eventId=doc.google_calendar_event_id, body=event).execute()
except HttpError as err:
    frappe.msgprint(_("Google Calendar - Could not delete Event {0} ... error code {1}.").format(...))
```

**Silent-failure analysis (claim verified):**
- The `except` is `frappe.msgprint`, never `frappe.throw` (`:610-615`). The local delete proceeds regardless, so **Google keeps the event**.
- `msgprint` is a UI channel. API callers, scheduler jobs, and background workers get no exception and no durable record (`Error Log` is not written).
- If `google_calendar_event_id` is empty, `events().get` returns 404 → `HttpError` → caught → same silent outcome.
- There is **no retry**.
- This is exactly why the app calls `_sacar_del_sync_antes_de_borrar` before deleting: clearing `google_calendar` makes the guard at `:593` return early so the native (broken) delete never runs. See §2.5 for the side effect.

### 1.5 Correct wrappers for each hook

The requirement is (a) a Google failure cannot break the CRM save, and (b) the failure is visible. A wrapper *inside* the existing hook cannot satisfy (a), because `frappe.throw` in the hook is what breaks the save. So the correct shape is to **never call these functions synchronously from `doc_events`**.

Pattern that satisfies both:

1. **Do not let `doc_events` run the push.** Keep the Event out of the native path (`sync_with_google_calendar = 0`, no `google_calendar` link) exactly as today, so the save is atomic and cannot fail because of Google.
2. **Enqueue an explicit push job** after the save, e.g. `frappe.enqueue("crm_core.google_sync.push_event", event=doc.name, queue="short", enqueue_after_commit=True)`.
3. **The worker owns the row**: reload the Event, set `sync_with_google_calendar=1`/`google_calendar=<account>` in memory, and call the Google API (or the native function) inside its own `try/except Exception`.
4. **Make failure durable and visible**: on failure, write `frappe.log_error(...)`/`Error Log` **and** set a status field on the Event (`custom_google_sync_status` ∈ {Pending, Synced, Failed} + `custom_google_sync_error`), then retry with backoff. Never `frappe.throw` from the worker on a Google error (throw only on programming errors).
5. **Store the remote id reliably**: on success, persist `google_calendar_event_id` (the native function already does this via `frappe.db.set_value`, which does **not** re-fire hooks — `document.py` `db_set` path).
6. **Delete:** treat it as an explicit cancel job, not a hook. Because the native delete cannot report failure, either (i) call the Google cancel yourself in the worker and only then delete the local row, or (ii) delete locally and enqueue a cancel job that records failure. Do **not** rely on `on_trash` for correctness.

Practical note: the native functions throw and `msgprint`, and they read `doc.google_calendar_id`/`write via db.set_value`. They are usable from a worker if wrapped in `try/except Exception` and you re-read the row afterwards, but a thin hand-rolled push (~100 lines) is cleaner and testable.

---

## 2. The pull path, exactly

### 2.1 Scheduler and entry point

`hooks.py:241-246`:

```python
"all": [
    ...
    "frappe.integrations.doctype.google_calendar.google_calendar.sync",
],
```

`sync()` (`:207-217`) selects `Google Calendar` records with `{"enable": 1, "pull_from_google_calendar": 1}` and calls `sync_events_from_google_calendar(g)` **per record**. This is a per-user iteration (one record per user/calendar), not one global calendar.

### 2.2 Account object and calendar auto-creation

`get_google_calendar_object` (`:220-239`) refreshes the token, builds the API client, and calls `check_google_calendar(account.reload(), ...)`. `check_google_calendar` (`:242-271`):
- if `account.google_calendar_id` is set, it validates it and returns (`:247-255`);
- **otherwise it creates a brand-new secondary calendar** named `account.calendar_name` with `timeZone = frappe.get_system_settings("time_zone")` and stores its id via `account.db_set("google_calendar_id", ...)` (`:257-271`).

**This is the most operationally important fact in the whole integration:** the sync only ever touches `account.google_calendar_id`, which by default is *a calendar Frappe created*, **not the user's primary Google Calendar**. Google Appointment Schedule bookings land on the organizer's calendar (typically `primary`) and will **not** be pulled unless `google_calendar_id` is pointed at that calendar.

### 2.3 Incremental pull (`sync_events_from_google_calendar`, `:274-377`)

- Token: `sync_token = account.get_password(fieldname="next_sync_token", ...) or None` (`:286`).
- List loop (`:289-322`): `events().list(calendarId=account.google_calendar_id, maxResults=2000, pageToken=..., singleEvents=False, showDeleted=True, syncToken=sync_token)`.
  - `showDeleted=True` is what makes cancellations visible.
  - On `HttpError` 410 (invalid token): it clears `next_sync_token` and `msgprint`s "Sync token was invalid and has been reset, Retry syncing." (`:309-313`); any other status → `frappe.throw` (`:314-315`).
  - On the last page it stores `nextSyncToken` and **`account.save()`** (`:318-321`) — which re-runs `GoogleCalendar.validate()`.
- `results` are then processed per item (`:324-370`).

### 2.4 Insert vs update vs delete decision

Confirmed branch (`:330-344`):

```python
if event.get("status") == "confirmed":
    ...
    if event.get("recurringEventId"):
        ...                                    # :339-340  <-- recurring INSTANCES are skipped entirely
    elif not frappe.db.exists("Event", {"google_calendar_event_id": event.get("id")}):
        insert_event_to_calendar(account, event, recurrence)     # :342
    else:
        update_event_in_calendar(account, event, recurrence)     # :344
```

- **Insert** (`insert_event_to_calendar`, `:380-401`) maps the Google event to a Frappe `Event`:
  `google_calendar_event_id = event["id"]` (`:391`), `google_calendar = account.name` (`:389`), `google_calendar_id = account.google_calendar_id` (`:390`), `pulled_from_google_calendar = 1` (`:393`), `owner = account.user` (`:394`), `event_type = Public if account.sync_as_public else Private` (`:395`).
  **It does NOT set `sync_with_google_calendar`.** Its default in the doctype is `0` (`event.json`, field `sync_with_google_calendar`, `"default": "0"`). This is what prevents the echo loop (§5).
- **Update** (`update_event_in_calendar`, `:427-439`) looks the row up **only by `google_calendar_event_id`**:

  ```python
  calendar_event = frappe.get_doc("Event", {"google_calendar_event_id": event.get("id")})
  ```
  then overwrites subject/description/meet link/recurrence/dates, calls `update_participants_in_event`, and `calendar_event.save(ignore_permissions=True)` (`:439`).
- **Cancel** (`:347-370`) looks up by **both** `google_calendar_id` **and** `google_calendar_event_id`:

  ```python
  event_name = frappe.db.get_value("Event", {
      "google_calendar_id": account.google_calendar_id,
      "google_calendar_event_id": event.get("id"),
  })
  if event_name:                       # <-- the #37010 fix, present on version-15
      frappe.db.set_value("Event", event_name, "status", "Closed")
      frappe.get_doc({... Comment "Event deleted from Google Calendar."}).insert(ignore_permissions=True)
  ```

- **Recurring events:** the existence/update decision short-circuits on `recurringEventId` (`:339-340`, literally `...`) — **instances of recurring events are never created or updated**. The docs also state this as a limitation.

### 2.5 Critical: what happens to an `Event` whose `google_calendar` link was cleared

The app clears `doc.google_calendar` on update (`_neutralizar_sync_evento`, `api.py:946-947`) and via `frappe.db.set_value({"sync_with_google_calendar": 0, "google_calendar": None})` before delete (`_sacar_del_sync_antes_de_borrar`, `api.py:958-963`). It deliberately keeps `google_calendar_event_id` (`api.py:943-944`). There are three distinct outcomes:

1. **Confirmed event, changed in Google → updated, not duplicated.**
   `update_event_in_calendar` looks up **only** by `google_calendar_event_id` (`:431`), which the neutralisation preserves. So the pull finds the existing CRM row and **updates it in place**. Then `calendar_event.save()` fires `on_update`, but the update hook returns immediately because `sync_with_google_calendar = 0` (`:510-511`). **No duplicate, no echo.** The inbound direction actually keeps working for already-linked events.

2. **Cancelled in Google → closed, still works (side effect of `fetch_from`).**
   The cancel branch filters on `google_calendar_id` too (`:351`). One might expect clearing `google_calendar` to clear the fetch field `google_calendar_id`; it does **not**. `_validate_links` only fetches when the link value is truthy (`base_document.py:803` `if docname:`), and `set_fetch_from_value` is only reached for non-empty links (`:845-851`). So with `google_calendar = None`, `google_calendar_id` keeps its **stale** value, the cancel lookup still matches, and the CRM row is set to `Closed`. (For the delete path, `_sacar_del_sync_antes_de_borrar` uses `db.set_value`, which skips `fetch_from` entirely.)

3. **Deleted in the CRM while Google still has it confirmed → resurrects on a full sync.**
   This is the real risk the neutralisation introduced. `_sacar_del_sync_antes_de_borrar` guarantees the native `on_trash` cancel never runs, so Google still holds a **confirmed** event. Because the Frappe row is gone, the next time Google returns that event as `confirmed`, `frappe.db.exists("Event", {"google_calendar_event_id": ...})` is false (`:341`), so `insert_event_to_calendar` runs and the event **comes back as a new Event**. This happens on a *full* pull (empty `next_sync_token`, i.e. first run or after a 410 reset) or the next time that Google event is modified. It does **not** happen on every incremental tick, because an unchanged Google event is not returned by a `syncToken` request.

4. **If `google_calendar_event_id` were also cleared** (it is not, today), a changed Google event would no longer match at `:431`, so `exists(...)` at `:341` would be false and the pull would **insert a duplicate**. Keep `google_calendar_event_id` intact; it is the only reconciliation key.

5. **Events the CRM created are invisible to the pull** because they have no `google_calendar_event_id` and (today) are never pushed. No dedupe happens against Google, so if the same meeting also exists in Google, a full pull inserts a second Event.

**Net:** clearing `google_calendar` does not, by itself, cause duplicates on the inbound path. It causes **silent outbound loss** and **deleted-event resurrection**. That is the precise risk.

---

## 3. Connecting the account

### 3.1 Google Cloud

1. Create a project, then **enable the Google Calendar API** (APIs & Services → Library → "Google Calendar API" → Enable).
2. Configure the OAuth consent screen. Two modes:
   - **Testing** (simplest, but refresh tokens expire after 7 days while the app is "Testing") — this is why the project's existing `authorize-gcal.py` was replaced with a published app + permanent tokens (see `docs/crm-config.md:23`).
   - **Published/External** for permanent refresh tokens (the project already did this: "App publicada a producción … tokens permanentes"). Publishing requires the app to be verified or set to production; unverified apps still work for the user who created them.
3. Create an **OAuth client ID**, application type **Web application**.
4. Add:
   - **Authorized JavaScript origin:** `https://<site>` (Frappe docs).
   - **Authorized redirect URI:** exactly `https://<site>?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`.
     - The source of truth is `authorize_access` (`google_calendar.py:152-155`): `redirect_uri = get_request_site_address(full_address=True) + "?cmd=" + google_callback.__module__ + "." + google_callback.__qualname__`.
     - The ERPNext doc gives this exact URI: [docs.frappe.io/erpnext/google_settings](https://docs.frappe.io/erpnext/google_settings).
     - ⚠️ The Framework guide shows an **outdated** URI (`...gcalendar_settings.gcalendar_settings.google_callback`) — [docs.frappe.io/framework/.../google_calendar](https://docs.frappe.io/framework/user/en/guides/integration/google_calendar). Do not use it on v15.
5. Scope requested by the code: `SCOPES = "https://www.googleapis.com/auth/calendar"` (`google_calendar.py:40`), sent as `scope=` in the auth URL (`:184-191`). This is a **read/write** scope, so the existing `calendar.readonly` token from `scripts/sync/authorize-gcal.py` (scope `calendar.readonly`, line 8) is **not sufficient for push**; you need a fresh token with the full `calendar` scope.
6. Put **Client ID / Client Secret** in **Google Settings** (`google_settings.json` fields `client_id`, `client_secret`, `enable`), at *Home → Integrations → Google Services → Google Settings*.

### 3.2 Frappe `Google Calendar` record (per user)

Fields from `google_calendar.json`:
- `enable` (default 1)
- `calendar_name` (required, unique — this is the doc name; "the name that will appear in Google Calendar")
- `user` (required, Link to User)
- `pull_from_google_calendar` (default 1)
- `push_to_google_calendar` (default 1)
- `sync_as_public` (default 0) — controls whether pulled events are Public or Private (`insert_event_to_calendar:395`)
- `google_calendar_id` (**read-only**) — the destination/only-synced calendar; set automatically by `check_google_calendar` (`:270`)
- hidden secrets: `refresh_token`, `authorization_code`, `next_sync_token`

### 3.3 Step-by-step

1. Create/verify the GCP OAuth client and redirect URI (§3.1).
2. Fill **Google Settings** (enable + client id + secret).
3. Create a **Google Calendar** record: pick `calendar_name` and `user`, tick `enable`, `pull_from_google_calendar`, `push_to_google_calendar`, choose `sync_as_public`.
4. Save, then click **Authorize Google Calendar Access** — this calls `authorize_access` (`:141-181`), opens the Google consent screen (`get_authentication_url`, `:184-191`), and on return `google_callback` (`:194-203`) stores the auth code and exchanges it for a `refresh_token` (`:174-176`).
5. **Decide the destination calendar.** If bookings arrive via Google Appointment Schedule on `primary`, you must point `google_calendar_id` at `primary` (or at the specific calendar the booking writes to). Because the field is `read_only`, do it via the console/REST, e.g. `frappe.db.set_value("Google Calendar", <name>, "google_calendar_id", "primary")`; then `check_google_calendar` will use `primary` instead of creating a new secondary calendar (`:247-255`).
6. Run `frappe.integrations.doctype.google_calendar.google_calendar.sync` once manually. First run has no token → full pull; it stores `next_sync_token`.
7. Optionally grant explicit permission to the `Google Calendar` record; the doctype has System Manager + Desk User (if_owner) roles (`google_calendar.json`).

Docs: [Framework guide](https://docs.frappe.io/framework/user/en/guides/integration/google_calendar), [ERPNext Google Calendar](https://docs.frappe.io/erpnext/google_calendar), [ERPNext Google Settings](https://docs.frappe.io/erpnext/google_settings).

---

## 4. Known problems (upstream issues and write-ups)

Real, citable upstream issues:

- **#37010 — cancelled event crashes the sync (`DoesNotExistError`).** When a Google event is cancelled but no local Event matches, the old code passed `event_name=None` to `set_value`/`Comment`, crashing for apps that hook `Comment` (explicitly mentions CRM). **Closed and fixed on `version-15`** by PR #37031 (commit `9e8ad8c5`, 2026-02-17), which added `if event_name:` — visible at `google_calendar.py:355`. [issue](https://github.com/frappe/frappe/issues/37010)
- **#27603 — Google event IDs longer than the field.** Fixed by widening `google_calendar_event_id` to `length: 320` (`event.json`); no truncation errors on long IDs. [issue](https://github.com/frappe/frappe/issues/27603)
- **#30918 — pulled events owned by Administrator and private.** Under the scheduler, `owner` was the session user (Administrator). Fixed by commit `0f50d688` (2025-02-21), which added `sync_as_public` and sets `owner = account.user` / `event_type = Public|Private` (`insert_event_to_calendar:394-395`). [issue](https://github.com/frappe/frappe/issues/30918)
- **#33682 — "Google calendar meetings show up twice."** The same user being added as both organizer and guest causes the meeting to appear on primary and the secondary calendar. Closed; the "duplicate" is a Google-side participant/calendar artifact, not a Frappe insert. Relevant because the integration's secondary calendar makes every event visible twice for the owner. [issue](https://github.com/frappe/frappe/issues/33682)
- **#15718 — recurring pull crash parsing `UNTIL`.** `google_calendar_to_repeat_on` used `%Y%m%d`, but Google sends `UNTIL=...T...Z`. Fixed by `420d772a` ("fix(Google Calendar): Parse recurrence params correctly"), now `get_recurrence_parameters` (`:778-795`). [issue](https://github.com/frappe/frappe/issues/15718)
- **#33531 — `on_update`/`on_trash` for `Event` fire only after a second save/delete.** A user's custom hooks did not fire on the first save, and `on_trash` did not fire if the Event was created and immediately deleted. Closed; in the core, the relevant behavior is that `on_update` runs for inserts too but the sync update-hook self-disables via `modified == creation` (`:512`), and `on_trash` only runs through `frappe.delete_doc`. This is a warning against relying on `on_trash` for correctness. [issue](https://github.com/frappe/frappe/issues/33531)
- **#7002 — historical "Critical Bugs" in the GCalendar integration.** Old, but indicates the integration's long history of defects. [issue](https://github.com/frappe/frappe/issues/7002)
- **Docs limitation:** "if an instance of a recurring event is cancelled in Google Calendar, this change will not be reflected in Frappe" ([Framework guide](https://docs.frappe.io/framework/user/en/guides/integration/google_calendar)).

Failure modes by symptom:

- **Sync token expiring / 410:** handled inline — cleared and `msgprint`ed (`:309-313`). The next scheduled run does a **full** sync. Google's documented recovery is a full resync from scratch ([Google sync guide](https://developers.google.com/workspace/calendar/api/guides/sync)); the practical side effect here is deleted-in-CRM events resurrecting (§2.5.3).
- **Duplicates:** the main sources are (a) a full pull after rows were deleted/never linked, (b) two competing pullers (native sync + the project's own `scripts/sync/sync-gcal-crm.py`, which creates `CRM Lead`s from `primary` — a different destination than the native secondary calendar), and (c) `#33682`'s participant/calendar overlap.
- **Echo loop:** no upstream issue was found specifically about the native integration echoing; the code-level analysis in §5 says the default is safe. Marked **unverified as an upstream defect**.
- **`google_calendar_id` empty on first push:** code-derived, not a filed issue. `insert_event_in_google_calendar` uses the **Event's** fetched `doc.google_calendar_id` (`:480`) while `check_google_calendar` may have only just created and stored the calendar id **on the `Google Calendar` record** (`:270`). If the Event's fetched value was captured before that id existed, the push sends an empty `calendarId`. `insertar_evento_sin_sync` pops the calendar link, so the CRM avoids this today, but a push implementation must pass `account.google_calendar_id`, not `doc.google_calendar_id`. Marked **unverified as an upstream issue** (no issue number found).
- **Timezone:** all conversions use `get_system_timezone()` (`format_date_according_to_google_calendar:692-716`, `parse_google_calendar_date:618-621`), so events are stored in the site timezone, not the user's. Historical fixes: `36761880`/`77ae997b` ("google calendar sync times").

---

## 5. The echo loop, specifically

**How Frappe prevents it today:**
1. Pulled events are inserted with `pulled_from_google_calendar = 1` and **without** `sync_with_google_calendar` (`insert_event_to_calendar:384-396`); the doctype default is `0` (`event.json`). So on the pull's own `calendar_event.save()` (`:439`), the `on_update` hook exits at `:510-511`.
2. The insert hook additionally checks `doc.pulled_from_google_calendar` (`:448`).
3. The push stores `google_calendar_event_id` via `frappe.db.set_value` (`:488-493`), which does not re-fire hooks (`document.py` `db_set` path).
4. `modified == creation` (`:512`) suppresses the `on_update` that follows a fresh insert.

**Is it sufficient?** For the default data model and for Frappe's own pull, **yes** — a pulled event is not pushed back, and a push is not re-imported as a change. Two caveats:
- **Asymmetry/fragility:** the *update* hook does not check `pulled_from_google_calendar`, so the protection rests entirely on `sync_with_google_calendar` staying `0`. Any code or user that ticks "Sync with Google Calendar" on a pulled Event turns it into an echo source (edit locally → push → pull → overwrite loop).
- **The `get_doc_before_save()` crash** at `:551` can break an update before any echo question even arises.

**What practitioners add on top:**
- Never enable `sync_with_google_calendar` on `pulled_from_google_calendar` docs (guard both directions).
- Add an explicit "origin/direction" field and ignore inbound writes for docs whose last change was a push (and vice-versa), i.e. a per-record sync-direction/etag check — Frappe has no `etag` column today.
- Use `google_calendar_event_id` as the sole reconciliation key and never clear it.
- Dedupe by Google event id before inserting.
- Prefer a single writer per calendar (avoid two pullers into the same site).

---

## 6. Honest verdict

**With Frappe v15 as it ships, a reliable two-way sync is *not* achievable by simply turning the integration on.** The native hooks make outbound sync a correctness hazard: a Google failure aborts the CRM save (verified), and deletes can fail without any durable signal (verified). The inbound path is better (the #37010 crash is fixed on `version-15`, owner/public was fixed, the update path is fine as long as `sync_with_google_calendar` stays `0`), but it has hard limits: recurring instances are skipped, only one calendar id is synced, and timezones follow the site, not the user.

**Wrapping is viable and is the right size for this CRM.** The pieces you keep from Frappe:
- the `Google Calendar` record as the **OAuth/token store** and destination-calendar selector;
- `frappe.enqueue` for async execution;
- the `Event` doctype as the local model.

The pieces you take over:
- **Push** (urgent): an explicit, idempotent, async push — insert/update/cancel by `google_calendar_event_id`, `try/except Exception`, `Error Log` + a persisted sync-status field, retry with backoff, `enqueue_after_commit=True`. Pass `account.google_calendar_id`, never the Event's possibly-stale `doc.google_calendar_id`.
- **Delete:** never rely on `on_trash`; enqueue the cancel and record its result.
- **Inbound:** decide on **one** puller. Today the site has two: the native scheduler and the project's `scripts/sync/sync-gcal-crm.py` (which reads `primary` and creates `CRM Lead`s, not `Event`s). Running both against the same calendar will produce divergent/duplicate data. Either point the native `Google Calendar` record at the appointment calendar and retire the script (if `Event` is now the source of truth), or keep the script and keep the native hooks neutralised for pull too.
- **Appointment Schedule:** ensure `google_calendar_id` is the calendar the bookings land on (typically `primary`); otherwise the native pull will never see them.

**A fully bespoke sync service (Nylas/CalDAV/dual sync tokens, webhook channel subscriptions) is overkill** for one consultant, one calendar, one destination. The pragmatic recommendation:

1. **Now, to make push urgent-but-safe:** keep the current neutralisation (saves must never break), add the async push job + sync-status field + `Error Log` + retry, and add an async cancel job for deletes.
2. **For inbound:** pick one puller, set `google_calendar_id` correctly, keep `sync_with_google_calendar = 0` on pulled docs, and never clear `google_calendar_event_id`.
3. **Add a reconciliation pass** (e.g. daily) that compares Google events vs linked `Event`s by `google_calendar_event_id` to detect the resurrection case and duplicates — this is the cheap insurance the native integration lacks.
4. **Do not enable the native `doc_events` push** until the three defects are fixed upstream or the functions are wrapped outside `doc_events`.

Tradeoff summary:

| Approach | Outbound safety | Visibility | Effort | Fit |
|---|---|---|---|---|
| Native as-is | ✗ (aborts save) | ✗ (delete silent) | 0 | **Do not use** |
| Neutralise + wrap (recommended) | ✓ (async, retried) | ✓ (status + log) | Medium | Best for 1 consultant |
| Bespoke service | ✓ | ✓ | High | Overkill |

---

## 7. How to enable it safely — checklist

**Google Cloud / OAuth**
- [ ] Calendar API enabled; consent screen in **production** (not Testing) so refresh tokens don't expire in 7 days.
- [ ] OAuth **Web application** client; JS origin `https://<site>`.
- [ ] Redirect URI **exactly** `https://<site>?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback` (not the outdated Framework-guide URI).
- [ ] Scope includes `https://www.googleapis.com/auth/calendar` (the existing `calendar.readonly` token is insufficient for push).
- [ ] Client ID/secret in **Google Settings** (`enable` = 1).

**Frappe**
- [ ] One `Google Calendar` record: correct `user`, `enable`, `pull_from_google_calendar`, `push_to_google_calendar`, `sync_as_public`.
- [ ] Click **Authorize Google Calendar Access** and confirm `refresh_token` is stored (hidden field).
- [ ] Set `google_calendar_id` to the calendar bookings actually land on; for Appointment Schedule that is usually `primary` (read-only field → set via console/REST).
- [ ] Confirm the scheduler job `frappe.integrations.doctype.google_calendar.google_calendar.sync` is not `stopped` and the `all` scheduler group runs.

**Behaviour**
- [ ] Keep `sync_with_google_calendar = 0` on all `pulled_from_google_calendar` docs; never tick it manually.
- [ ] Never clear `google_calendar_event_id` on docs that were ever linked (it is the only reconciliation key).
- [ ] Prefer one puller per site (native **or** `scripts/sync/sync-gcal-crm.py`, not both) to avoid divergent duplicates.

**Push wrapper**
- [ ] `frappe.enqueue(..., enqueue_after_commit=True)`; worker catches all exceptions.
- [ ] Persist a sync status + error per Event; write `Error Log`; retry with backoff.
- [ ] Use `account.google_calendar_id` for the API call, not `doc.google_calendar_id`.
- [ ] Store the returned `id` in `google_calendar_event_id` via `frappe.db.set_value` (no hook re-entry).
- [ ] Deletes go through an async cancel job, with the result recorded.

**Verification**
- [ ] Create an Event via the CRM API → confirm it appears in Google and `google_calendar_event_id` is set.
- [ ] Edit it → confirm the Google event updates and no duplicate appears.
- [ ] Delete it → confirm the Google event is cancelled; if not, the job must show `Failed`.
- [ ] Cancel an event in Google → confirm the CRM Event becomes `Closed`.
- [ ] Force a full pull (clear `next_sync_token`) → confirm previously deleted Events do **not** reappear; if they do, the reconciliation pass should flag them.

---

## Sources

Source code (primary):
- `google_calendar.py` — https://github.com/frappe/frappe/blob/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py
- `hooks.py` — https://github.com/frappe/frappe/blob/version-15/frappe/hooks.py
- `event.json` — https://github.com/frappe/frappe/blob/version-15/frappe/desk/doctype/event/event.json
- `document.py` — https://github.com/frappe/frappe/blob/version-15/frappe/model/document.py
- `base_document.py` — https://github.com/frappe/frappe/blob/version-15/frappe/model/base_document.py
- `app.py` — https://github.com/frappe/frappe/blob/version-15/frappe/app.py
- `google_settings.json` — https://github.com/frappe/frappe/blob/version-15/frappe/integrations/doctype/google_settings/google_settings.json

Fixes/commits:
- `9e8ad8c5` "check cancelled event exists before update it (#37031)" (2026-02-17) → `google_calendar.py:355`
- `0f50d688` "fix: Google calendar sync" (owner + `sync_as_public`, 2025-02-21)
- `b95dc6f9` "fix: Sync all calendars and not only the first one!" (2025-03-17)
- `420d772a` "fix(Google Calendar): Parse recurrence params correctly" (2025-03-17)

Docs:
- Framework Google Calendar — https://docs.frappe.io/framework/user/en/guides/integration/google_calendar
- ERPNext Google Calendar — https://docs.frappe.io/erpnext/google_calendar
- ERPNext Google Settings (correct redirect URI) — https://docs.frappe.io/erpnext/google_settings
- Google Calendar sync tokens / 410 — https://developers.google.com/workspace/calendar/api/guides/sync

Issues:
- #37010 — https://github.com/frappe/frappe/issues/37010
- #27603 — https://github.com/frappe/frappe/issues/27603
- #30918 — https://github.com/frappe/frappe/issues/30918
- #33682 — https://github.com/frappe/frappe/issues/33682
- #15718 — https://github.com/frappe/frappe/issues/15718
- #33531 — https://github.com/frappe/frappe/issues/33531
- #7002 — https://github.com/frappe/frappe/issues/7002

Local project evidence:
- `apps/crm_core/crm_core/api.py` (`insertar_evento_sin_sync:899-923`, `_neutralizar_sync_evento:926-947`, `_sacar_del_sync_antes_de_borrar:950-963`)
- `docs/crm-config.md`, `docs/runbook-crm-core.md`, `scripts/sync/sync-gcal-crm.py`, `scripts/sync/authorize-gcal.py`

**Explicitly unverified:** whether an upstream issue exists for the "empty `google_calendar_id` on first push" and for the "echo loop" — none was found; both are code-derived from the `version-15` source above.
