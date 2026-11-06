# ADR 0022 — `sessions.simultaneous_connected_seconds` is the figure the outcome was decided on

**Status:** accepted · **Date:** 2026-11-05 · **Decided by:** the owner, 2026-11-05 (decision 3 of `specs/004-sessions/plan.md`, and the analysis of Phase 3 that asked for this record) · **Amends:** constitution R-DB-4 (v2.5.1), ERD `sessions` (v1.15)

## Context

R-DB-4 forbids storing a derived value except the declared caches, "and never add another without an ADR". The ERD has
held `sessions.simultaneous_connected_seconds` since Phase 0, but nothing wrote it before Phase 3. Phase 3 computes the
simultaneous time from the recorded provider events (`specs/004-sessions/research.md` R-305), so the column is a value
derived from `session_participant_events`.

Two readings were possible:

- recompute it on every read, so the column is not needed; or
- write it once, at the evaluation, and never recompute it.

Recomputing would move a settled session's telemetry as late events arrive: an event recorded after the evaluation
changes nothing (spec, Edge Cases), yet a recomputed figure would show the administrator a number the outcome was not
decided on. The figure an administrator weighs in a dispute or in the review queue is the one the evaluation used.

The owner chose the second reading on 2026-11-05 (plan.md, decision 3), and the constitution's 2.5.0 named the column
in R-DB-4 on that decision without the ADR the rule's last clause asks for. Phase 3's analysis found the gap; this ADR
is that record.

## Decision

- `sessions.simultaneous_connected_seconds` is written once, by the evaluation job, in the transaction that settles the
  session, as the figure its outcome was decided on. Nothing recomputes it: not a late event, not a read, not a
  resolution. An administrator's resolution changes the session's status, never this figure.
- It is a declared cache in R-DB-4's list, beside `sessions.scheduled_start_at` / `scheduled_end_at` (ADR 0009) and
  `sessions.teacher_user_id` / `student_user_id` (ADR 0010).
- The schema gate's `DECLARED_CACHES` names it (`scripts/schema-check.ts`, T001 of `specs/004-sessions/tasks.md`),
  the gate holding R-DB-4's machine part as the constitution's cell says.

## Consequences

- **Constitution.** R-DB-4 cites this ADR for the column (2.5.1, a patch: the rule's text already allowed a cache
  through an ADR, so no prohibition changed); the 2.5.0 history row says the ADR was written the same day.
- **ERD.** §0's conventions and the `sessions` row cite this ADR.
- **Code.** None beyond Phase 3's plan: the evaluation (T014) writes the column; the review and dispute telemetry read
  it (T033, T034).
