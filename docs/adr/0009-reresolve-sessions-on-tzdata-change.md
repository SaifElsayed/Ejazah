# ADR 0009 — Re-resolve future sessions when time zone data changes

**Status:** proposed · **Date:** 2026-09-27 · **Amends:** [Architecture §9](../ARCHITECTURE.md), ERD `enrollments` and `sessions`

## Context

A session stores the UTC instant resolved when the enrollment was confirmed
(FR-020, Architecture §9: "Store UTC. Compute in the teacher's zone."). The
instant is computed from the slot's local wall-clock time and IANA zone, using the
time zone rules the server has at that moment. The server gets those rules from
the time zone data bundled with its runtime (Node's ICU data, read through
`@js-temporal/polyfill`).

Governments change their clock rules, sometimes at short notice. Egypt cancelled
summer time days before its 2016 start, and reinstated it in 2023. When that
happens after sessions were generated, every stored instant after the change is
off by the size of the change. A lesson the teacher set for 09:00 in Cairo
would start at 08:00 or 10:00 Cairo time. Nothing in the model notices, because
the stored value is an instant, not the local time the teacher chose.

This was found during the review of PR #19 (T032/T033). No document covered it.

## Decision

### D1 — Future sessions are re-resolved when the time zone data changes

When the runtime's time zone data version differs from the last version the
platform applied, a job re-resolves every session whose `status` is `scheduled`
and whose `scheduled_start_at` is in the future. Each one is resolved again from
its own local date, the enrollment's frozen start time and the enrollment's
frozen zone, through `packages/time` (R-TIME-1, R-TIME-2, R-TIME-7). Where the
new instant differs, `scheduled_start_at` and `scheduled_end_at` are updated.
Past sessions, and sessions in any status other than `scheduled`, are never
touched.

The local time the teacher chose is the fact. The UTC instant is derived from it
and is recomputed when the rules that derive it change.

### D2 — The local intent is stored, not derived

Re-resolution cannot recover the intended local time from the stored instant,
because converting that instant with the new rules gives the wrong answer; that
is the bug. So the intent is frozen at generation, the same way the enrollment
already freezes its zone:

| Table         | New column                  | Type   | Meaning                                                                           |
| ------------- | --------------------------- | ------ | --------------------------------------------------------------------------------- |
| `enrollments` | `snapshot_start_time_local` | `time` | The slot's `start_time_local`, frozen at purchase beside `snapshot_slot_timezone` |
| `sessions`    | `scheduled_local_date`      | `date` | The local calendar date this session was resolved from                            |

Both columns are plain `time` and `date`, not timestamps, so R-TIME-4 does not
apply to them. Both are additive (R-API-9). The table count stays 33.

### D3 — Detection and idempotency

The worker reads the runtime's time zone data version (`process.versions.tz` on
Node) at startup. The job is keyed in `idempotency_keys` (ADR 0008 D2) under the
scope `tzdata-reresolve` with the version as the key. A version is therefore
applied exactly once, however many workers start (R-API-14). No new table or
setting is needed.

### D4 — Everything keyed to the old instant follows it

Any delayed job scheduled from a session's start is rescheduled from the new
instant in the same run. That covers session reminders (FR-NOTIF-1, offsets from
`reminder_offsets`) and anything else computed the same way. Both participants
of a changed session are notified that its time was corrected for a clock change.
The teacher's local time is unchanged. A student in a different zone sees the
session move in their own local time, and needs to know why.

### D5 — Keeping the data current is an operational duty

The job only helps if the runtime's data is current. The runbook's upgrade
routine must treat a Node release that updates the bundled time zone data as a
priority update, in particular one carrying an Egyptian rule change.

## Consequences

- One new requirement in the SRS, FR-SESS-20, states D1 and D4.
- The ERD gains the two columns in D2. Session generation must write both.
- Session generation (`sessions.generateForEnrollment`) and the re-resolution
  job share `packages/time`'s `resolveLocalDateTime`, so one rule governs both.
- A rule change that lands _during_ a lesson's day is handled only if the runtime
  update is deployed before the lesson. D5 is what makes that likely; nothing in
  code can make it certain.
- No task implements this yet. It belongs to the phase that builds the sessions
  module, which must pick up FR-SESS-20.

## Alternatives rejected

- **Resolve sessions lazily, shortly before they start.** This avoids storing
  instants early, but the SRS stores scheduled instants at generation, and the
  reminders, the join window (FR-SESS-14) and evaluation (FR-SESS-10) all read
  them. Moving every reader to on-demand resolution is a larger change for the
  same result.
- **Store only the instant and re-derive the local time with the old rules.**
  The old rules are gone once the runtime is updated. There is nothing to derive
  with.
- **Do nothing and correct by hand.** An admin cannot see which sessions a rule
  change moved, and Egypt has changed its rules with only days of warning.
