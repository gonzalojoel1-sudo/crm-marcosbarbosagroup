# Two-way Google Calendar sync for a single-consultant CRM — decision report

**Date:** 2026-09-19
**Question:** how do production systems implement a *reliable* two-way Google Calendar sync, and what is the smallest correct v1 for a single-user CRM whose web bookings arrive from a Google Appointment Schedule link and whose CRM-created meetings must appear in Google?
**Mode:** research only. No code was written or changed.
**Rule:** every concrete claim carries a source. Where a claim could not be checked against a primary source it is marked **unverified** rather than guessed. Where a statement is a recommendation, it is labelled as such.
**Companions (repo):** `2026-09-16-agenda-diseno-v2-auditado.md` (Event model + sync design), `2026-09-17-decision-build-vs-adopt-agenda.md` (§4 Frappe Event leverage), `2026-09-18-restaurar-diseno-aprobado-en-prod.md` (D5 origin/busy).

---

## 0. Executive answer

1. **Poll `syncToken`; do not build webhooks for v1.** Incremental sync is a single conditional GET; push requires an HTTPS webhook, channel renewal, and still drops messages. For one user, polling every few minutes is trivially inside quota and removes an entire class of infrastructure failure. (§1.2, §6)
2. **You cannot have correct two-way sync without per-event state.** Google gives you `etag` + `updated` + conditional `If-Match`; Frappe `Event` stores none of them. That is the gap to close first. (§1.3, §2.1, §4.3)
3. **The conflict rule that will not silently destroy a meeting is: never overwrite a change the other side made since your last successful sync.** Use per-event *authority* (Google owns Appointment-Schedule bookings and the calendar clock; CRM owns CRM-created meetings and CRM-only fields), plus `If-Match` on every Google write so a concurrent remote edit returns `412` instead of clobbering. When both sides changed, keep Google's time and surface the conflict. (§2.3, §6)
4. **Prevent the echo with a mapping row + a source flag + good keying — not with time windows.** The strongest documented pattern (Nylas) is an external-ID map plus a content hash; the pragmatic Frappe version is your existing `pulled_from_google_calendar`/`google_calendar_event_id` pair, extended with an origin enum and a stored etag. "Never sync copies of copies" is the dedicated-tool version of the same rule. (§3)
5. **The big known products do not merge concurrent edits.** They avoid the problem: each event has one authoritative side, and "conflict resolution" mostly means *double-booking detection*, not field merging. Their documented limitations are the honest ceiling for a v1. (§2.2, §5)
6. **v1 scope:** one destination calendar, appointments and CRM meetings as single (non-recurring) events, Google wins for time/title/attendees, CRM wins for lead-link/notes, deletes handled conservatively, no per-instance recurrence, no RSVP/invite sync, polling not webhooks. (§6)

---

## 1. The Google Calendar API mechanics you must get right

### 1.1 Incremental sync: `syncToken`, `pageToken`, `410 GONE`

**Full sync once, incremental forever.** The documented flow: initial full sync obtains a `nextSyncToken`; every later sync sends that `syncToken` and stores the new one. ([Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync))

- **`nextSyncToken` only on the last page.** "If the result set is too large and the response gets paginated, then the `nextSyncToken` field is present only on the very last page." The reason is stated: "The information needed for the server to generate a correct sync token is encoded in the page token," and entries appearing during pagination "won't be missed". The `events.list` reference repeats it: `nextSyncToken` is "Omitted if further results are available, in which case `nextPageToken` is provided." ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))
- **Incremental pagination repeats the original query.** When a large delta pages, you "perform the exact same list query as was used for retrieval of the first page … append the `pageToken` … and paginate … until you find another `syncToken` on the last page." ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync))
- **Query restrictions are enforced.** With `syncToken` you cannot also send `iCalUID`, `orderBy`, `privateExtendedProperty`, `q`, `sharedExtendedProperty`, `timeMin`, `timeMax`, or `updatedMin`; all other parameters must match the initial sync or behaviour is undefined. A disallowed restriction returns `400`. ([events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))
- **Deletions are always in the result.** "The result will always contain deleted entries, so that the clients get the chance to remove them from storage." With `syncToken` you are not allowed to set `showDeleted=false`. ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))
- **`410 GONE` = token dead → wipe and full resync.** The server invalidates tokens (expiration, ACL changes). The documented handler is: catch `410`, delete the stored token, clear the local store, run a full sync. The error body is `reason: fullSyncRequired` ("Sync token is no longer valid, a full sync is required."). ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors))
- **Legacy `updatedMin` is no longer recommended.** Google says the old "preserve the `updated` field + `modifiedSince`" approach "is no longer recommended as it is more error-prone with respect to missed updates". `updatedMin` too far in the past itself returns `410 updatedMinTooLongAgo`. ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [errors](https://developers.google.com/workspace/calendar/api/guides/errors))

**Takeaway for us:** store the sync token at the *calendar* level (Frappe already does: `Google Calendar.next_sync_token`), and treat `410` as a routine, tested code path, not an exception.

### 1.2 Watch channels / push notifications — and why polling wins here

**The mechanism.** `events.watch` (and ACL/calendarList/settings watch) creates a channel. Required channel fields are `id` (UUID, ≤64 chars), `type: web_hook`, and an HTTPS `address` with a valid CA-signed certificate; optional `token` (≤256 chars) and `expiration`. ([Get push notifications](https://developers.google.com/workspace/calendar/api/guides/push))

- **Expiry: default TTL is 604800 s = 7 days.** `events.watch` documents `params.ttl` "Default is 604800 seconds." The push guide says the value is "determined either by your request or by any Google Calendar API internal limits or defaults (the more restrictive value is used)." A hard documented *maximum* beyond the default is **unverified** — the docs state the default and that Google may impose a more restrictive internal limit. ([events.watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch), [push guide](https://developers.google.com/workspace/calendar/api/guides/push))
- **No auto-renew.** "Currently, there's no automatic way to renew a notification channel. When a channel is close to its expiration, you must replace it with a new one by calling the `watch` method," using a new unique `id`; an "overlap period" is expected. ([push guide](https://developers.google.com/workspace/calendar/api/guides/push))
- **The notification does not tell you *what* changed.** It is a bodyless `POST` with `X-Goog-Resource-State: sync|exists|not_exists`. The docs are explicit: "These messages do not contain specific information about updated resources, you will need to make another API call to see the full change details." So push only *triggers* the same `syncToken` pull you would otherwise schedule. ([push guide](https://developers.google.com/workspace/calendar/api/guides/push))
- **Push is lossy.** "Notifications are not 100% reliable. Expect a small percentage of messages to get dropped under normal working conditions. Make sure to handle these missing messages gracefully, so that the application still syncs even if no push messages are received." Push is also per-calendar for events/ACLs. ([push guide](https://developers.google.com/workspace/calendar/api/guides/push))
- **Quota guidance pushes back on naive polling — but at scale.** "An anti-pattern here is to repeatedly poll every calendar of interest … if your application has 5,000 users and polls each user's calendar once a minute, then this requires a per-minute quota of at least 5,000, even before any work is done." With one user this reasoning does not bite. ([Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota))

**Tradeoff for a one-user CRM (recommendation).** Push buys latency (sub-second) at the cost of: a public HTTPS endpoint with a renewable TLS cert, channel lifecycle + renewal cron, handling the `sync` handshake, and tolerating dropped messages (so you still need the fallback poll). Polling `syncToken` every N minutes gives you correctness with one outbound GET and no inbound attack surface. For a single consultant, **poll** (plus an on-demand pull when the agenda UI opens, and a manual "Sync now"). Only move to push if a human is demonstrably waiting on second-level freshness; if you do, keep the poll as the reliability backstop, which is exactly what the docs require anyway.

### 1.3 IDs: client-supplied `id`, `iCalUID`, `etag`, `sequence`, stable mapping

- **Client can choose the event `id` on insert.** Rules, verbatim: characters are "those used in base32hex encoding, i.e. lowercase letters a–v and digits 0–9"; length 5–1024; unique per calendar. Google warns: "we cannot guarantee that ID collisions will be detected at event creation time. To minimize the risk of collisions we recommend using an established UUID algorithm such as one described in RFC4122." If you omit `id`, the server generates one. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert))
  - **Practical note (derived, unverified):** a standard RFC4122 UUID (hex `0-9a-f`, hyphens) cannot be used verbatim because `-` is not in the allowed set; stripping the hyphens leaves 32 chars all within `0-9a-v`, so it satisfies the constraint. Google also enforces global uniqueness with `409 duplicate` ("The requested identifier already exists."). ([errors](https://developers.google.com/workspace/calendar/api/guides/errors))
- **`iCalUID` ≠ `id`.** `iCalUID` is the RFC5545 UID used to identify events *across calendaring systems*; "only one of them should be supplied at event creation time." For recurring events all instances share one `iCalUID` but have different `id`s. `events.list` can search by `iCalUID`; `events.get` retrieves by `id`. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))
  - **Why this matters to us:** Cal.com shipped a real bug where the guest-facing ICS carried a different UID than the synced Google event (one `@Cal.com`, one `@google.com`), producing duplicate meetings and a leftover event on cancel. The root cause was the unified create path not threading `iCalUID` through to Google. ([cal.com#28884](https://github.com/calcom/cal.diy/issues/28884)) This is the exact failure mode a stable mapping is meant to prevent.
- **`etag`** is the resource version; it changes on every change and is the basis for conditional writes (§2.1). ([Get specific versions of resources](https://developers.google.com/workspace/calendar/api/guides/version-resources))
- **`sequence`** is the iCalendar SEQUENCE number, writable. Whether Google itself bumps `sequence` on ordinary edits is **unverified** (the reference only defines it as "Sequence number as per iCalendar"). Prefer `updated`/`etag` for change detection and treat `sequence` as an extra iCal-compatibility signal.
- **`updated`** is the read-only last-modification time of the main event data. Documented blind spot: **changing reminders does not change `updated`.** ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))
- **Stable identity that survives a restore:** stamp your CRM record id into `extendedProperties.private` (Google's hidden key-value store) so you can re-match after a local DB restore even if the id map is lost. Limits: key ≤44 chars, value ≤1024 chars, ≤300 properties / 32 kB per event; searchable with `privateExtendedProperty=name=value` (but see §1.1: that filter cannot be combined with `syncToken`, so use it for repair jobs, not the incremental pull). ([Extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties))

### 1.4 Deletes and cancellations: `status: cancelled`, `showDeleted`

- **A deletion in Google is a `status: "cancelled"` event, not a vanished row.** `events.list` returns cancelled events only on incremental sync (`syncToken`/`updatedMin`) or when `showDeleted=true`; `events.get` always returns them. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list))
- **Two different cancelled states.** (1) A cancelled exception of an *uncancelled* recurring event means "this instance should no longer be shown" and clients "should store these events for the lifetime of the parent recurring event"; only `id`, `recurringEventId`, `originalStartTime` are guaranteed. (2) "All other cancelled events represent deleted events. Clients should remove their locally synced copies. Such cancelled events will eventually disappear, so do not rely on them being available indefinitely" — only `id` is guaranteed. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))
- **Distinguishing "deleted remotely" from "we never saw it."** Because cancelled events eventually disappear, the only reliable test is a **local key lookup**: if the cancelled event's `id` is in your map, it is a remote deletion of something you had; if it is not, ignore it. A `410 deleted` ("Resource has been deleted") on a delete call means the job is already done — no action. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [errors](https://developers.google.com/workspace/calendar/api/guides/errors))
- For us: CRM-originated deletes and Google-originated cancellations must both be *propagated*, and both must be idempotent (Google returns `410` for an already-deleted event; treat as success).

### 1.5 Timezones and all-day

- **Timed vs all-day are different fields.** Timed events use `start.dateTime`/`end.dateTime`; all-day events use `start.date`/`end.date`. "The start and end of the event must both be timed or both be all-day. For example, it is **not valid** to specify `start.date` and `end.dateTime`." ([Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))
- **`timeZone` is an IANA name and is attached to the event.** A time can be expressed three equivalent ways (offset in `dateTime`, no offset + empty `timeZone` → calendar default, or no offset + explicit `timeZone`); "setting the `timeZone` field attaches a time zone to the event." For recurring events `timeZone` is **required** and defines how recurrences expand. ([concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))
- **All-day has no meaningful timezone.** "Note that the timezone field has no significance for all-day events." ([concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))
- **The documented re-interpretation pitfall.** Query results are converted to the `timeZone` request parameter, "If you omit this parameter, then these methods all use the calendar time zone as the default." So a naive local time stored without a zone will be reinterpreted against whatever zone is applied later. Concretely: store `2026-09-17 10:00:00` as wall-clock, and if the calendar default or the attached zone changes (or DST applies), the same digits mean a different instant. The correct pattern is to carry the zone explicitly and convert deliberately. ([concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars))
- **Our stack already encodes the right model.** Frappe stores **naive** datetimes interpreted in the site timezone; the native integration pulls with `astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)` and pushes `{"dateTime": ..., "timeZone": get_system_timezone()}`. Site here is `America/Argentina/Cordoba` (no DST). This is consistent with Google's model and should be preserved. ([Frappe `google_calendar.py` v15](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py), repo `2026-09-17-decision-build-vs-adopt-agenda.md` §5)

### 1.6 Quotas and rate limits

- **Limits:** 10,000 requests/min per project; 600 requests/min per user per project; 1,000,000 requests/day per project before billing. Quotas use a sliding window. ([Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota))
- **Errors:** exceeding → `403 userRateLimitExceeded` / `403 rateLimitExceeded` / `429 rateLimitExceeded`; all must be handled with **truncated exponential backoff** (Google publishes the algorithm). ([quota](https://developers.google.com/workspace/calendar/api/guides/quota), [errors](https://developers.google.com/workspace/calendar/api/guides/errors))
- **Do not spike.** "a common bad practice for a Calendar client is to perform a full sync at midnight … make sure that your traffic is spread throughout the day"; vary intervals by ±25%. ([quota](https://developers.google.com/workspace/calendar/api/guides/quota))
- **For us:** a single user polling `syncToken` every few minutes uses a handful of requests/hour; the daily threshold is irrelevant. Still: use backoff and randomize the poll minute so a future multi-user version does not inherit a thundering herd.

---

## 2. Conflict resolution (the most important section)

### 2.1 The primitives Google gives you

- **Conditional modification with `If-Match`.** "If you want to update or delete a resource only if it has not changed since you last retrieved it, you can specify an `If-Match` header that contains the value of the etag… Otherwise, you will get a `412` (Precondition failed)." The docs explicitly frame this as "very useful to prevent lost modifications." The response to `412` is: re-fetch the entity and re-apply the changes. ([Get specific versions of resources](https://developers.google.com/workspace/calendar/api/guides/version-resources), [errors](https://developers.google.com/workspace/calendar/api/guides/errors))
- **Conditional retrieval with `If-None-Match` → `304`** lets you skip work when nothing changed. ([version-resources](https://developers.google.com/workspace/calendar/api/guides/version-resources))
- **There is no conditional insert.** "There is no support for conditional modifications for insert operations. Instead, it is guaranteed that if you are allowed to provide a resource ID, then the operation will only succeed if no existing entry has that ID." So insert-side idempotency comes from your chosen client `id` + `409 duplicate`. ([version-resources](https://developers.google.com/workspace/calendar/api/guides/version-resources))
- **`update` is not patch; `update` and `patch` accept `If-Match`.** ["Events.update] does not support patch semantics and always updates the entire event resource. To do a partial update, perform a get followed by an update using etags to ensure atomicity." `patch` "supports patch semantics" but "each patch request consumes three quota units; prefer using a get followed by an update." ([events.update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update), [events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch))
- **Google's own sample does not merge; it overwrites after re-fetch.** The conditional-modification sample catches `412`, re-fetches the latest event, and notes: "You may want to have more complex logic here to resolve conflicts. In this sample we're simply overwriting the summary." That is the vendor's own baseline: detect, re-fetch, choose a winner. ([version-resources](https://developers.google.com/workspace/calendar/api/guides/version-resources))
- **Change-ordering signals.** `updated` (authoritative for the Google copy; reminders don't bump it) and `sequence` (iCal revision). Last-write-wins is normally built on `updated`. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))
- **Array fields overwrite wholesale.** "Fields that you don't specify in the request remain unchanged. Array fields, if specified, overwrite the existing arrays; this discards any previous array elements." This is a real hazard for field-level merge of `attendees`/`recurrence`. ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events))

### 2.2 What serious implementations actually do

A crucial and under-appreciated finding: **most "conflict resolution" language in calendar products means *double-booking/overlap detection*, not merging concurrent edits of one event.** They sidestep merge conflicts by making one side authoritative per event.

- **Google (vendor baseline):** detect via `412`, re-fetch, choose a winner (sample overwrites). No field-merge guidance. ([version-resources](https://developers.google.com/workspace/calendar/api/guides/version-resources))
- **Nylas (sync API vendor, the most explicit):** mapping row with `source ∈ {'app','calendar'}`, a **content hash**, and `updated_at`; on inbound, "if a match exists, you update the linked row instead of creating a second one"; the echo guard is "compute the hash of the incoming event and compare it to the stored hash … if they match, the change originated from your side and you skip it." It argues hash beats time windows: "A naive guard ignores any webhook that arrives within, say, 2 seconds of your write, but provider latency varies and a legitimate edit can land in that window. The hash compares actual content, so it never drops a real change." ([Nylas, two-way calendar sync](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync))
- **CalendarBridge (dedicated sync product):** each sync is one-way; a "Both Directions" connection "is simply two one-way syncs paired together"; and critically: "**Treat event copies as read-only. Edits you make to an event copy on the destination calendar are not synced back to the source calendar.**" Plus "CalendarBridge never makes copies of copies." This is conflict *avoidance by construction*: the destination shows a placeholder, edits to it are not round-tripped. ([CalendarBridge Manage Syncs](https://help.calendarbridge.com/help/manage-syncs.html))
- **`caldavsync` (OSS, Google↔CalDAV):** explicit per-pair policy — `conflict_resolution: newest_wins | google_wins | caldav_wins`; "You choose the winner. Per calendar you set the source of truth … and direction; read-only calendars can be one-way only." Matches "events are matched by content and linked, never blindly recreated." ([photoevents/caldavsync](https://github.com/photoevents/caldavsync))
- **Workato (iPaaS, the loop-prevention canon):** a dedicated **integration user**; exclude records "last modified by the integration user" using a `Last modified by` filter, a query-language `WHERE`, a changelog read, or a **custom "Sync Required" field**. This is the same "sync origin" idea in generic form. ([Workato](https://www.workato.com/product-hub/how-to-prevent-infinite-loops-in-bi-directional-data-syncs))
- **Motion:** documents one-side authority rather than merge: "Complex recurrence patterns … must be created and edited in the external calendar. Motion mirrors them but cannot generate advanced rules"; "Motion cannot edit meetings where you are not the organizer." ([Motion limitations](https://www.usemotion.com/help/time-management/all-things-calendars/reference-all-things-calendars/limitations.md))
- **Calendly:** only pulls *cancellations and reschedules* of its own bookings back from the calendar; "If invitees change or delete the event in their own calendars, it won't affect the meeting." Calendly-created events keep blocking even if marked free. ([Calendly Google sync](https://calendly.com/help/how-to-connect-your-google-calendar), [Calendly availability troubleshooting](https://calendly.com/help/how-to-troubleshoot-unavailable-times-that-should-be-available))
- **Reclaim:** Calendar Sync makes "synced copies of events from a source calendar onto another"; bidirectional is "two policies"; it skips a sync "If the destination calendar's email is already invited to the source event" to avoid duplicates, and honors `#nosync`. Its "conflict" features are about overlapping meetings, not edit merges. ([Reclaim Calendar Sync FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq), [Reclaim calendar sync](https://reclaim.ai/features/calendar-sync))
- **Cal.com (cautionary):** despite marketing "two-way calendar sync", its own issue tracker documents moves made in Google not reflecting into Cal.com ("If someone books in with cal.com, but the event is moved in Google calendar - it does not update in cal.com" — open since 2024), a `iCalUID` mismatch creating duplicate meetings, and a PATCH-not-retried gap causing silent booking/calendar desync. ([cal.com#16872](https://github.com/calcom/cal.com/issues/16872), [cal.com#28884](https://github.com/calcom/cal.diy/issues/28884), [cal.com#28834](https://github.com/calcom/cal.com/issues/28834))

### 2.3 Recommendation for a single-user CRM

**The simplest rule that will not silently destroy a user's meeting: per-event single-writer authority, plus "never overwrite the other side's newer change", plus `If-Match` on every Google write.** Concretely:

1. **Track two dirty flags per event**, derived from stored state (see §4):
   - `local_dirty = doc.modified > custom_last_synced_local_modified`
   - `remote_dirty = remote.updated > custom_gcal_updated`
2. **Only local dirty → push**, using `If-Match: custom_gcal_etag` (and `update` after a `get`, or `patch`). On `412`, re-fetch; if the remote changed, re-evaluate (step 4) instead of retrying blindly.
3. **Only remote dirty → pull into the `Event`.** Google wins for the fields Google owns.
4. **Both dirty → conflict.** Do **not** auto-merge and do **not** blind-overwrite. Apply a fixed, safe rule and surface it:
   - **Time/title/attendees:** keep Google's values (the calendar is the shared clock; overwriting a reschedule made in Google is precisely the "silently destroyed meeting" failure).
   - **CRM-only fields** (lead link, internal notes, `custom_origen`): keep the CRM's values.
   - Set `custom_sync_estado='conflict'` and show it; offer a manual "keep mine / keep theirs".
5. **Deletes are the dangerous case — make them conservative and explicit:**
   - Remote cancellation whose `id` is in the map **and** local is not dirty since last sync → delete/mark the local event.
   - Remote cancellation when local **is** dirty → don't delete; surface a conflict (`custom_sync_estado='conflict_delete'`).
   - Local delete → propagate to Google only if the event is CRM-originated **and** remote `updated` equals the last-seen value (`If-Match`). Otherwise soft-cancel and surface.
6. **Why this is the safe choice:** it never overwrites a change whose existence you didn't know about (the `If-Match`/`remote_dirty` guards), and when in doubt it prefers the side a human just edited and asks. It is also the shape Google's own sample implies (detect → re-fetch → decide) and the shape serious tools take (one authoritative side per event).

**What I would not build in v1:** general field-level 3-way merge. It sounds correct but array fields overwrite wholesale on Google (so attendee merges are lossy), `updated` has the reminder blind spot, and cross-system clocks are not comparable. Per-event authority + surfacing is the honest correct rule; a merge UI is a v2, only if users actually hit conflicts.

---

## 3. Preventing the echo loop (the second most important section)

The classic failure is stated plainly by Nylas: "Your write triggers a webhook, the webhook looks like a new change, and your handler writes it again." The documented techniques, with sources:

| # | Technique | How it works | Source |
|---|---|---|---|
| 1 | **External-ID mapping table** | A row links local record ↔ remote event id; on every inbound, look up before writing. Missing row ⇒ genuinely new ⇒ create; existing row ⇒ update. | ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync)) |
| 2 | **Two-tier match key** | Resolve by a stamped id on the remote object first (`metadata.key1`, or Google `extendedProperties.private`), then fall back to the stored remote event id. "the second one survives a database restore where local IDs drift." | ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync), [Google extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)) |
| 3 | **Content hash echo guard** | Store a hash of the synced fields; compute the same hash on inbound; equal ⇒ echo (or duplicate delivery) ⇒ skip. Preferred over time windows because provider latency varies and a real edit can fall inside a window. Also gives idempotency under at-least-once delivery. | ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync)) |
| 4 | **Sync-origin / source column** | The mapping row records `source ∈ {'app','calendar'}`; Workato's generic version is a dedicated integration user + "last modified by" exclusion, or a `Sync Required` custom field the writer flips. | ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync), [Workato](https://www.workato.com/product-hub/how-to-prevent-infinite-loops-in-bi-directional-data-syncs)) |
| 5 | **"Never sync copies of copies"** | An event created by a sync is never used as the source for another sync. The dedicated-tool expression of a source flag. | ([CalendarBridge](https://help.calendarbridge.com/help/manage-syncs.html)) |
| 6 | **Stored remote etag / version** | Keep the last-seen remote etag; use `If-Match` on writes (`412` = someone else changed it) and `If-None-Match` for cheap `304` no-op checks. Prevents both echo writes and lost updates. | ([Google version-resources](https://developers.google.com/workspace/calendar/api/guides/version-resources)) |
| 7 | **Ignore inbound older than last sync** | Compare remote `updated` with the stored last-seen `updated`; skip if older/equal. Simple, but weaker than a hash (Nylas warns time-window guards can drop real changes; `updated` also ignores reminder edits). Use as a cheap pre-filter, not the sole guard. | ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)) |
| 8 | **Suppress framework hooks / write-through-bypass** | Save locally with the push disabled, then enqueue your own push; mark origin and skip echo. Frappe's `sync_with_google_calendar` / `pulled_from_google_calendar` guards are exactly this. | (repo `apps/crm_core/crm_core/api.py:899-963`, [Frappe google_calendar.py v15](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py)) |

**How real projects structure it.** Nylas' SQL is the clearest reference: `event_sync_map(internal_id PK, nylas_event_id, grant_id, calendar_id, content_hash, source, updated_at, UNIQUE(grant_id, nylas_event_id))`, roughly 200 bytes/row. `tsdav`'s two-way calendar sync keeps `syncToken` + `ctag` on the calendar row and `etag` on each calendar object. CalendarBridge encodes the rule as product policy. ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync), [tsdav smart calendar sync](https://tsdav.vercel.app/docs/smart%20calendar%20sync), [CalendarBridge](https://help.calendarbridge.com/help/manage-syncs.html))

**Recommendation for us.** Combine (1)+(3)+(4)+(6): your `google_calendar_event_id` is already a first-class event field (better than a side table for Frappe), add the remote `etag` and `updated`, add an origin enum, and add a content hash if you want the strongest echo guard. Stamp `custom_google_event_uid`/the Event name into `extendedProperties.private` as the restore-surviving fallback key. Do **not** rely on a "within 2 seconds" time window.

---

## 4. The data model for a mapping

### 4.1 What a correct per-event mapping needs

| Field | Purpose |
|---|---|
| `remote_event_id` | The Google `id`; the primary cross-side key. |
| `remote_calendar_id` | Which calendar (you must send the right `calendarId` on every call). |
| `remote_etag` | For `If-Match` (`412`) and `If-None-Match` (`304`). |
| `remote_updated` | Last remote modification time, for `remote_dirty` and echo pre-filtering. |
| `remote_ical_uid` (optional) | Cross-system identity; helps dedupe imports. |
| `sync_origin` | Which side last originated the change (`crm` / `google` / `booking`). |
| `last_synced_at` | When the event was last reconciled. |
| `last_synced_local_modified` | Snapshot of the local `modified` at last sync → `local_dirty`. |
| `dirty` / pending flag | Local change queued for push. |
| `content_hash` (optional) | Strong echo/duplicate guard. |
| `tombstone` / deleted marker | Propagate and absorb deletions reliably. |
| `sync_state` + `sync_error` + attempts | Visible status and retry bookkeeping. |

This mirrors Nylas' mapping row and `tsdav`'s object model. ([Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync), [tsdav](https://tsdav.vercel.app/docs/smart%20calendar%20sync))

### 4.2 What Frappe `Event` already offers

Core Frappe v15 `Event` (verified in the v15 source): `google_calendar` (Link to `Google Calendar`), `google_calendar_id` (raw calendar id), `google_calendar_event_id` (the remote event id / mapping), `pulled_from_google_calendar` (origin-from-Google boolean), `sync_with_google_calendar` (push guard), `google_meet_link`, plus `subject`, `starts_on`/`ends_on`, `all_day`, `repeat_on`/`repeat_till`, `event_participants`, `links`, `reference_doctype`/`reference_docname`. The `Google Calendar` DocType carries `next_sync_token` (Password), `pull_from_google_calendar`, `push_to_google_calendar`, `sync_as_public`, `refresh_token`, etc. ([Frappe `event.py` v15](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/desk/doctype/event/event.py), [Frappe `google_calendar.py` v15](https://raw.githubusercontent.com/frappe/frappe/version-15/frappe/integrations/doctype/google_calendar/google_calendar.py))

This repo adds custom fields (verified by grep): `custom_origen` (CRM/Reservas/Google), `custom_sync_estado`, `custom_sync_error`, `custom_sync_intentos`, `custom_crm_agenda`, `custom_crm_deal`, `custom_crm_organization`, `custom_crm_lead`, `custom_repeat_interval`, `custom_repeat_count`, `custom_google_event_uid`. (repo `2026-09-16-agenda-diseno-v2-auditado.md`, grep)

**Correction to the brief:** `google_calendar_status` is **not** a core Frappe `Event` field and **not** present in this repo (grep finds zero occurrences). It appears to be a misremembered name; the repo's sync-status fields are `custom_sync_estado` / `custom_sync_error` / `custom_sync_intentos`. Treat "Frappe has `google_calendar_status`" as **unverified-false**.

### 4.3 What is MISSING

| Missing | Consequence today |
|---|---|
| **Remote `etag`** | No `If-Match` → cannot detect-to-prevent lost updates; no `304` cheap check. This is the single biggest gap. |
| **Remote `updated` timestamp stored** | Cannot compute `remote_dirty`; LWW and echo filtering are guesswork. |
| **A real `sync_origin` enum with "last change side"** | `pulled_from_google_calendar` is a static boolean saying "originated from Google"; it does not say who changed it *last*, and the repo deliberately never clears it. `custom_origen` partially covers this but is business-origin, not sync-origin. |
| **`last_synced_local_modified` snapshot** | Cannot reliably compute `local_dirty` (comparing `doc.modified > last_synced_at` is timezone/clock-fragile without a stored snapshot). |
| **Explicit `dirty`/pending flag** | `sync_with_google_calendar` is overloaded as a *hook guard*, set in memory only; it is not a durable queue marker. |
| **Content hash** | No strong echo/duplicate guard; you rely on id + timestamp. |
| **Tombstone/deletion marker** | The native delete hook "fails silently" (catches `HttpError` with a `msgprint`), so a CRM delete can leave the Google event alive; and there is no record to reconcile later. |
| **Per-instance recurrence exception storage** | Frappe `Event` is one row per series; the `recurringEventId` branch in the native sync is a no-op (`...`), and the docs concede instance cancellations are not reflected. ([Frappe Google Calendar integration limitations](https://docs.frappe.io/framework/user/en/guides/integration/google_calendar)) |

**Additional native-integration defects** (why one direction is disabled in our code), verified in the repo and in Frappe v15 source:
- **Push blocks the save:** `insert_event_in_google_calendar` calls `frappe.throw` inside `Event.insert()` → if Google fails, the meeting is not saved.
- **Delete fails silently:** `delete_event_from_google_calendar` catches `HttpError` with `msgprint`, so the CRM deletes and Google keeps the event.
- **Update is unsafe:** the update guard does not check `pulled_from_google_calendar`, and it calls `doc.get_doc_before_save()` (can be `None`).

(repo `apps/crm_core/crm_core/api.py:899-963`; `2026-09-17-decision-build-vs-adopt-agenda.md` §4.3)

---

## 5. What the well-known products actually ship

| Product | Sync model | Conflict / deletes | Documented limits | Sources |
|---|---|---|---|---|
| **Google Calendar (baseline)** | n/a | `If-Match`/`412`; sample re-fetches and overwrites | No conditional insert; array fields overwrite; reminders don't bump `updated` | [version-resources](https://developers.google.com/workspace/calendar/api/guides/version-resources), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events) |
| **Nylas (sync API)** | Two-way via mapping table | Content-hash echo guard; `source` column; two-tier key | None beyond design tradeoffs | [Nylas](https://developer.nylas.com/docs/cookbook/use-cases/sync/two-way-calendar-sync) |
| **CalendarBridge** | One-way rules; "Both Directions" = two one-way | Destination copies **read-only**; never copies-of-copies | Edits to the destination are not synced back by design | [CalendarBridge](https://help.calendarbridge.com/help/manage-syncs.html) |
| **caldavsync (OSS)** | Bidirectional or one-way per pair | `newest_wins` / `google_wins` / `caldav_wins` | Recurrence series-level | [GitHub](https://github.com/photoevents/caldavsync) |
| **Calendly** | Booking→calendar; calendar→booking only for cancel/reschedule | Calendly-owned events always block, even if marked free; invitee edits ignored | Bookings go to **one** calendar only; can't map event types to calendars | [Calendly Google sync](https://calendly.com/help/how-to-connect-your-google-calendar), [Calendly availability](https://calendly.com/help/how-to-troubleshoot-unavailable-times-that-should-be-available) |
| **Cal.com** | Claims two-way | — | **Open bugs:** moves in Google don't reflect; `iCalUID` mismatch duplicates; PATCH not retried → silent desync | [cal.com#16872](https://github.com/calcom/cal.com/issues/16872), [cal.com#28884](https://github.com/calcom/cal.diy/issues/28884), [cal.com#28834](https://github.com/calcom/cal.com/issues/28834) |
| **Reclaim** | Source→destination synced copies; bidirectional = two policies | Skips duplicate if destination email already invited; `#nosync` opt-out; RSVP drives busy/free | "Conflict" features are meeting-overlap detection, not edit merge | [Reclaim FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq), [Reclaim sync](https://reclaim.ai/features/calendar-sync) |
| **Motion** | Bi-directional (delete in Motion deletes external) | Advanced recurrence must be edited in the external calendar; can't edit meetings you don't organize | Sync delays; all-day sync as busy; reminders inherited | [Motion limitations](https://www.usemotion.com/help/time-management/all-things-calendars/reference-all-things-calendars/limitations.md), [Motion sync FAQ](https://www.usemotion.com/help/time-management/auto-scheduling/calendar-syncing-faq) |
| **Notion Calendar** | Google + Apple view; Notion DB items shown | Conflict avoidance = scheduling overlaps | **"importing Google Calendar events directly into a Notion database is not yet possible"** — no Notion-DB↔GCal write sync | [Notion Calendar FAQ](https://notion.com/product/calendar) |
| **Amie** | Real-time two-way; events/attendees/reminders/recurrence/video/colors; delete either side removes both | No documented conflict policy | "some changes may take up to 30 seconds"; no merge doc | [Amie Google integration](https://amie.so/documentation/google-calendar-integration) |
| **Vimcal** | Two-way across Google/Outlook; "Meet Slots" | No documented conflict policy | Marketing only; no sync limits page found | [Vimcal](https://www.vimcal.com/google-calendar-outlook-sync) |
| **Fantastical** | Apple-first; openings/proposals; most providers | No documented merge policy found | Ecosystem/feature limits; sync-conflict detail **unverified** | [Amie comparison](https://amie.so/best/calendar-apps) |

**What this tells us a reasonable v1 looks like:** every serious tool ships *one authoritative side per event* and *conflict detection*, not edit merging; dedicated sync tools restrict destination copies to read-only; booking tools (Calendly) only pull cancel/reschedule of their own events, not arbitrary edits; and the most feature-complete calendars (Amie) simply don't publish a merge policy. The Cal.com bugs are the warning: "two-way" without stored etags/updated and without hook hygiene degrades into silent desync.

---

## 6. Pragmatic v1 design sketch

**Assumptions:** one consultant, one Google account, one destination calendar (the consultant's primary, since the Appointment Schedule books there), bookings arrive via the Appointment Schedule link, CRM meetings link to a `CRM Lead`.

### 6.1 Authority (who owns what)

| Data | Authoritative side | Why |
|---|---|---|
| Appointment-Schedule bookings (existence, time, guest) | **Google** | The booking is created and owned by Google; the CRM discovers it. |
| CRM-created meeting time/title | **CRM** until first synced; after that, **last editor wins under the conflict rule** | The consultant created it in the CRM. |
| Attendees / RSVP / invitation emails | **Google** | Invites and RSVPs are Google's to send/hold. |
| Lead link, internal notes, deal/org links | **CRM** | Google has no concept of them; never overwrite from a pull. |
| Deletion | **Whichever side deleted, conservatively** | See §6.4. |

### 6.2 The field set (add as Custom Fields on `Event`; never re-declare the DocType)

Reuse native: `google_calendar_event_id` (remote id), `google_calendar` (calendar Link), `pulled_from_google_calendar`, `google_meet_link`, `starts_on`/`ends_on`/`all_day`.
Add: `custom_gcal_etag`, `custom_gcal_updated` (Datetime), `custom_gcal_calendar_id` (Data; some already have `google_calendar_id`), `custom_sync_origin` (`crm`/`booking`/`google`), `custom_sync_estado` (existing), `custom_sync_error`/`custom_sync_intentos` (existing), `custom_last_synced_at`, `custom_last_synced_local_modified`, `custom_dirty` (Check), optional `custom_content_hash`, and a deletion marker/`custom_gcal_deleted`.

### 6.3 The loop (what actually runs)

1. **Pull (scheduled every few minutes + on-demand):** `events.list` with `singleEvents=true`, `showDeleted=true` (implicit with `syncToken`), using `Google Calendar.next_sync_token`; page to the last page; store the new `nextSyncToken`; on `410` clear the local map and full-resync.
2. **For each changed event:** resolve local `Event` by `google_calendar_event_id`, then by `extendedProperties.private.crm_event`; branch on the two dirty flags (§2.3); write with a per-event transaction; commit the new `etag`/`updated` immediately.
3. **Push (on CRM write):** save the `Event` with `sync_with_google_calendar=0` and no `google_calendar` (so the native hooks can't throw/silently no-op), set `custom_dirty=1` and `custom_sync_origin='crm'`, then enqueue the push wrapper: `insert` with a client-chosen base32hex id (or `update` with `If-Match: custom_gcal_etag`); on success store id/etag/updated and clear dirty; on `409` treat as already-created; on `412` re-pull and re-evaluate; on `403/429` back off.
4. **Delete:** conservative per §2.3/§6.4; never rely on the native `on_trash` hook.
5. **Reconcile (daily, off-peak, randomized):** compare by id + `updated`; fix drift; surface anything unresolved.

### 6.4 Conflict rule (restated as the v1 contract)

- Local only changed → push with `If-Match`.
- Remote only changed → pull (Google wins for time/title/attendees).
- Both changed → **Google wins time/title/attendees; CRM keeps lead-link/notes; mark `custom_sync_estado='conflict'`; never silently overwrite.**
- Remote cancellation, local clean → delete/mark local. Remote cancellation, local dirty → conflict, don't delete.
- Local delete → push only if CRM-originated and remote unchanged; else soft-cancel + surface.

### 6.5 Explicitly NOT in v1 (and the honest consequence)

| Excluded | Consequence you accept |
|---|---|
| **Recurring events & per-instance exceptions** | A recurring CRM meeting must be a single event or created in Google; a Google recurring booking syncs at series level, and a moved/cancelled instance may not reflect. (Matches Motion's documented limit.) |
| **Editing a booking's time in the CRM** | CRM edits to Appointment-Schedule events would be overwritten by Google; show them read-only, like the repo's D5 decision. |
| **Attendee / RSVP / invitation sync** | CRM won't send invites or track RSVP; guests are managed in Google. (`sendUpdates` left default; note Google warns `none` "can have significant adverse effects, including events not syncing".) |
| **Push webhooks** | Latency = polling interval (minutes), not seconds; on the upside, no webhook/TLS/renewal/attack surface. |
| **Multi-calendar / multi-account** | Only the one destination calendar participates; other calendars are invisible. |
| **General field-merge UI** | Conflicts are surfaced with a fixed safe rule; the user resolves manually. |
| **Hard-delete propagation for attended events** | A cancelled booking with guests is soft-cancelled/flagged, not hard-deleted, to avoid orphaning invites. |
| **Reminder / color / attachment sync** | These stay in Google; they are not round-tripped. (Reminder edits don't even bump `updated`.) |

### 6.6 Why this is the right v1

It is the smallest design that is **correct under the failure modes that actually bite**: duplicate events (solved by a stable id + two-tier match), echo loops (solved by mapping + origin + hash), lost meetings (solved by `If-Match` + never overwriting the newer side), and silent desync (solved by visible `custom_sync_estado` + reconciliation). Everything excluded is either genuinely hard (per-instance recurrence), genuinely Google's job (invites/RSVP), or an optimization (push) whose absence is safe. The excluded items track the documented limits of products far larger than this CRM.

---

## 7. Verification status

**Verified this session against primary sources:** Google Calendar API — `sync` guide (syncToken/pageToken/`410`/nextSyncToken-on-last-page), `push` guide (channel TTL default 604800 s, renewal, bodyless notifications, lossiness), `events.list` (syncToken restrictions, `showDeleted`, `410`), `events.insert` (id rules, iCalUID, status), `events` resource (etag, `updated`, `sequence`, cancelled semantics, array overwrite, reminder/`updated` blind spot), `events.update`/`events.patch` (If-Match, patch cost), `events.watch` (`params.ttl` default), `version-resources` (If-Match/`412`, If-None-Match/`304`, no conditional insert), `concepts/events-calendars` (date vs dateTime, timeZone, all-day), `quota` (10k/600/1M, backoff, don't-spike), `errors` (`410`, `403`/`429`, `412`, `409`), `extended-properties` (private/shared, search, limits). Products: Nylas mapping/hash, CalendarBridge read-only/no-copies-of-copies, Workato integration-user/exclude, `caldavsync` conflict policies, Calendly cancel/reschedule sync + limits, Cal.com issue tracker, Reclaim sync FAQ, Motion limitations, Notion Calendar FAQ, Amie docs. Repo: `apps/crm_core/crm_core/api.py:899-963` (native hooks disabled), custom-field inventory via grep.

**Carried over (not re-verified here):** Frappe v15 `event.py` field list and `google_calendar.py` internals are cited from the repo's prior research (`2026-09-17-decision-build-vs-adopt-agenda.md` §4.1) which verified them against `raw.githubusercontent.com/frappe/frappe/version-15/...`.

**Unverified / flagged inline:** a hard *maximum* watch-channel TTL beyond the 7-day default (docs only give the default + "internal limits"); whether Google itself bumps `sequence` on ordinary edits; that a hyphen-stripped RFC4122 UUID always satisfies the base32hex id constraint (it is a derivation, not a documented example); Fantastical's exact sync-conflict behaviour; Vimcal's sync limit details (marketing pages only); the absolute reliability rate of push notifications (docs say "a small percentage").

**Correction:** `google_calendar_status` is not a Frappe core `Event` field nor present in this repo — the repo's status fields are `custom_sync_estado` / `custom_sync_error` / `custom_sync_intentos`.
