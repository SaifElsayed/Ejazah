# ADR 0009 — A session's local time is the source of truth; its UTC instants are recomputed when time zone rules change

**Status:** proposed · **Date:** 2026-09-27 · **Amends:** [Architecture §9](../ARCHITECTURE.md), ERD `sessions`, constitution R-DB-4 (v2.1.2), Phase 0 spec FR-020, FR-033, SC-014, quickstart and T070

## Context

A session stores only the UTC instants resolved when its enrollment was
confirmed (FR-020, Architecture §9). They are computed from the slot's local
wall-clock time and IANA zone, using the time zone rules the server has at that
moment. The server gets those rules from the time zone data bundled with its
runtime: Node's ICU data, read through `@js-temporal/polyfill`.

Governments change their clock rules, sometimes at short notice. Egypt cancelled
summer time days before its 2016 start, and reinstated it in 2023. Once that
happens, a stored instant for a later lesson is off by the size of the change. A
lesson the teacher set for 09:00 in Cairo would start at 08:00 or 10:00 Cairo
time, and nothing in the model can notice. The local time the teacher chose was
never stored on the session, and converting the stored instant with the new rules
gives the wrong local time. That conversion is the bug itself.

This was found during the review of PR #19 (T032/T033). No project document
covered it.

## What the rest of the industry does

This is a solved problem, and the sources agree:

| Source                                                 | What it says                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jon Skeet, _Storing UTC is not a silver bullet_ (2019) | For a future event, store the **local time and the zone ID** the user supplied, and treat UTC as "derived data" recalculated when rules change. Of the three options he compares, this is his "preferred option". Storing UTC alone breaks, and so does storing UTC plus a rules version and remapping it, which is complex and needs the old rules. |
| W3C, _Working with Time Zones_, §4.2.2–4.2.3           | Future events need the time zone ID, not an offset, "because a future event's wall time depends on time zone-related information". Each recurrence computes its own instant from the governing zone's rules.                                                                                                                                         |
| Google Calendar API, `Event.start.timeZone`            | "For recurring events this field is required and specifies the time zone in which the recurrence is expanded". The format is an IANA name.                                                                                                                                                                                                           |
| RFC 5545 (iCalendar)                                   | A recurring event is `DTSTART;TZID=<zone>:<local time>` plus `RRULE`, so it is local time plus zone. An ambiguous local time "refers to the first occurrence". A local time in a gap is read "using the UTC offset before the gap", which moves it forward. That is R-TIME-7.                                                                        |
| TC39 Temporal docs, `ZonedDateTime` `offset` option    | When a zone's definition changes after a future value was stored, `'ignore'` "will keep local time unchanged but may result in a different exact time than was originally stored". That is the behaviour a calendar needs.                                                                                                                           |

The project already follows this for availability: a slot is local wall-clock
time plus an IANA zone (R-TIME-3). A session drops that intent at generation.
This ADR stops dropping it.

## Decision

### D1 — A session carries its own local start and zone, and those are the fact

`sessions` gains three columns, written at generation:

| Column                       | Type          | Meaning                                                                           |
| ---------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `scheduled_date_local`       | `date`        | The calendar date the occurrence was **requested** for (that week's slot day)     |
| `scheduled_start_time_local` | `time`        | The start time the teacher **chose**: the slot's `start_time_local`, as requested |
| `timezone`                   | `text` (IANA) | The zone those local values are in (the enrollment's `snapshot_slot_timezone`)    |

These three store what was asked for, never where the instant landed. The two
differ only inside a spring-forward gap. There a requested `00:30` resolves to
`01:30` (R-TIME-7), and `packages/time`'s `resolveOccurrences` returns the
landed values, which is the right answer for display and the wrong one to keep.
Storing the landed time would make a later rule change recompute from a time the
teacher never chose. RFC 5545 does the same: `DTSTART` keeps the requested local
time, and the gap is applied when an instant is computed from it. So generation
writes the occurrence's requested date and the slot's `start_time_local`, not
the `localDate` and `startTimeLocal` it gets back. The sessions phase either
computes the requested date alongside the call, or adds the requested fields to
`Occurrence`.

The three columns follow the same shape as `availability_slots` (R-TIME-3).
Every local column ends in `_local` and sits next to its `timezone` column
(R-TIME-5, ERD conventions). None is a timestamp, so R-TIME-4 does not apply.
All three are additive (R-API-9).

### D2 — `scheduled_start_at` and `scheduled_end_at` become a declared derived cache

The two UTC columns stay, because reminders, the join window (FR-SESS-14),
evaluation (FR-SESS-10) and every "what starts next" query read and index them.
They are now derived: `scheduled_start_at` is the local start resolved in
`timezone` (R-TIME-7 for gaps and overlaps). `scheduled_end_at` is that instant
plus the enrollment's `snapshot_duration_minutes` of elapsed time. R-DB-4
forbids a derived value without an ADR, and this ADR is that declaration. The
cache is written only by generation and by D3, both through `packages/time`.

### D3 — The cache is recomputed when the time zone data changes

The worker reads the runtime's time zone data version (`process.versions.tz` on
Node) at startup. When it differs from the last version applied, a job
recomputes the cache for every session whose `status` is still `scheduled`,
whatever its cached start says. The cached start is exactly the value that may
be wrong. If the update is deployed late, a session whose stale instant has just
passed may still be ahead in real time, and filtering on that instant would skip
it. The job recomputes from D1's three columns, never from the old instant. Any
delayed job keyed to a session's start, such as reminders (FR-NOTIF-1,
`reminder_offsets`), is rescheduled from the new instant in the same run.
Sessions in any other status have been held or settled, and keep their instants.

The job is keyed in `idempotency_keys` (ADR 0008 D2) under the scope
`tzdata-reresolve`, with the version as the key. The key is recorded only
**after** the run completes. If it were written first and the worker crashed
halfway, the remaining sessions and reminders would never be recomputed for
that version. A run interrupted before the key is written simply runs again.
That is harmless, because the recompute is a pure function of D1's columns, so
two runs give the same result (R-API-14). No new table or setting is needed.

### D4 — Keeping the data current is an operational duty

The recomputation only helps if the runtime's data is current. The runbook's
upgrade routine treats a Node release that updates the bundled time zone data
as a priority update, especially one that carries an Egyptian rule change.

### D5 — A session is shown in the teacher's zone and in the viewer's

Wherever a session's time is shown, it appears twice. The first line is the
session's local time in its own zone, as the server resolves it from D1 through
`packages/time`, for example "Friday 09:00, Cairo time". This equals the time
the teacher chose, except inside a spring-forward gap, where it shows the
shifted time the lesson actually starts. The second line converts to the
viewer's own zone, for example "(10:00 your time)". The first line never depends
on the viewer's device. If the device's own time
zone data is out of date, the two lines disagree visibly instead of the lesson
silently showing at the wrong hour. It also explains to a teacher or student in
another country why the number differs from the one the teacher chose. Display
formatting stays in the viewer's locale (R-MOBILE-9).

## Consequences

- One new requirement in the SRS, FR-SESS-20, states D1 to D3. D5 is a display
  rule for the screens that show sessions.
- The ERD gains D1's three columns on `sessions` and records D2's cache.
  Session generation must write all five schedule columns. The table count stays 33.
- Session generation (`sessions.generateForEnrollment`) and the D3 job both
  resolve through `packages/time`, so one rule governs both.
- A rule change that takes effect before the runtime update is deployed is not
  seen in time. D4 is what makes a timely update likely; nothing in code can
  make it certain.
- No task implements this yet. It belongs to the phase that builds the sessions
  module, which must pick up FR-SESS-20.

## Alternatives rejected

- **Store only the UTC instant** (today's model). This is Skeet's option 1: it
  silently breaks on any rule change.
- **Store the UTC instant plus the rules version, and remap on change.** This is
  Skeet's option 2. The remap needs the old rules, which are gone once the
  runtime is updated, and he rejects it as complex for no benefit.
- **Resolve on demand and store no UTC at all.** It is correct, but every reader
  and every index needs the instant (D2), so the cache is kept and recomputed
  instead.

## References

- Jon Skeet, "Storing UTC is not a silver bullet", 2019 — https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/
- W3C, "Working with Time Zones" — https://www.w3.org/TR/timezone/
- Google Calendar API, Events resource — https://developers.google.com/workspace/calendar/api/v3/reference/events
- RFC 5545, Internet Calendaring and Scheduling Core Object Specification — https://datatracker.ietf.org/doc/html/rfc5545
- TC39 Temporal, `ZonedDateTime` and `TimeZone` documentation — https://tc39.es/proposal-temporal/docs/zoneddatetime.html
