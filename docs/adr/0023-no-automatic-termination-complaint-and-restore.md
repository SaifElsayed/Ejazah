# ADR 0023 — No automatic termination for a teacher's absence; a student's complaint; an administrator's restore

**Status:** accepted · **Date:** 2026-11-05 · **Decided by:** the owner, 2026-11-05 (`specs/004-sessions/plan.md`, «Decisions of 2026-11-05, no automatic termination») · **Amends:** SRS FR-NOSHOW-3, FR-NOSHOW-4, FR-NOSHOW-5, FR-DISPUTE-5, FR-DISPUTE-7, FR-ADMIN-4, §3.14, §7, §8, UC-4 (adds FR-CANCEL-8 and DEC-61); ERD `enrollments`, `enrollment_events`, `session_remedies`, `session_events`, `disputes`, `settings`, §14, §15 rules 43 and 46; `specs/004-sessions/` spec, plan, research, data model, contracts and quickstart; PLAN.md, Phase 3

**Amended 2026-11-12 (SRS DEC-66, DEC-68 and DEC-69; the owner's decisions of 2026-11-11 and 2026-11-12).** Every closing an administrator started is restorable at any time: the restore window (default 14 days) only holds the enrollment's slot, unless an administrator releases it, and after it a restore succeeds while the slot and the times are free (`window_closed` is no longer produced); a ban's and a revocation's closing, and an administrator's direct end (DEC-68), are restorable the same way, never one a deletion or a gender correction ended; a restore never owes again a session an administrator's cancellation case already owes, and is refused after a refund. SRS FR-ADMIN-5, FR-CANCEL-8 and FR-CANCEL-9 govern where this ADR says otherwise (D4: «default 7», «a ban … not restorable»).

**Amended 2026-11-06 (Phase 3's fourth analysis, S3; the decisions of 2026-11-05 on the administrator's control and the rate limits, `specs/004-sessions/plan.md`; SRS FR-CANCEL-8 as amended).** D4's conditions are written as they were decided later the same day: the slot active, a deactivated one refused `slot_inactive` (no path deletes a slot, so a removed slot is a deactivated one); the slot's day, local start and zone unchanged since the enrollment's sessions were generated, else refused `slot_changed`, the eighth cause (the student enrolled on the old time, and a restore never moves them to a new one); and the restore declares its own rate limit, `rate_limit_enrollment_restore` (§3.14, 10 per 60 s, the Administrator as subject), checked before anything is written, apart from the idempotency key (NFR-SEC-12). Its eight causes are `not_restorable`, `window_closed`, `case_closed`, `party_restricted`, `slot_inactive`, `slot_changed`, `slot_taken` and `time_taken` (`specs/004-sessions/research.md` R-322).

## Context

SRS FR-NOSHOW-3 and FR-NOSHOW-4 ended an enrollment by themselves: at an administrator-configurable count of the
teacher's absences (default 2) the system cancelled the remaining sessions, set the enrollment Terminated-No-Show and
opened a compensation case. Phase 3's design built that termination into every path that settles a session, and a
disputed absence was held out of the count until it was resolved (plan.md, decision 7).

The owner decided on 2026-11-05 that a count must not end an enrollment. A teacher's absence is owed its remedy, and
whether the enrollment should end is a judgement an administrator makes, on the student's complaint, with the
evidence in front of them. An administrator who ends an enrollment, or confirms a suspended student's fault, may also
be wrong, and the owner asked for a short window in which the decision can be undone.

Undoing it moves an enrollment out of a state the design had treated as final. Two facts bound that:

- **The database forbids no exit.** No ERD §15 rule, check constraint or trigger holds `enrollments.status` in a
  terminal state; the enum is plain (`prisma/migrations/20261007000000_init`). `session_remedies.status` has no such
  rule either: rule 42 ties `refund_case` to a non-null `case_id`, nothing more.
- **One exit already exists.** [ADR 0010](0010-database-refuses-double-booking.md) D5 moves a `cancelled` enrollment
  to `confirmed` when a late paid event finds its slot free, and returns `cancellation_reason` to NULL. That move was
  recorded in an ADR; this one is recorded the same way, the constitution asking an ADR of every architectural
  decision (Order of work).

## Decision

### D1 — A count never ends an enrollment

Each Teacher-No-Show is owed its remedy (FR-NOSHOW-2) and the enrollment continues. An enrollment or its sessions end
only by an administrator's decision. The setting `teacher_no_show_threshold`, the threshold check and every automatic
path to `terminated_no_show` are removed, the check on a dispute's resolution included. Decision 7 of the plan (a
disputed absence not counted until resolved) served only the threshold and is removed with it.

### D2 — A repeated-absence mark, for administrators only

The enrollment's Teacher-No-Show sessions since it began are counted when read, never stored (R-DB-4), each by its
final status: Both-No-Show, Cancelled-By-Agreement and an absence a dispute's resolution or a ruling's revision
removed are not counted, and a session under dispute counts once it is resolved. At `repeated_absence_flag_count`
(default 5) the enrollment is shown marked, with its count, on the monitor, the compensation-case queue and the
disputes queue, and the teacher's record in the user directory lists the marked enrollments. Nothing happens
automatically because of the mark. A ruling's revision changes the outcome only, and the mark follows it.

### D3 — The student's complaint

A student may complain of the teacher's absence on a confirmed enrollment, with a mandatory written reason. The
complaint is a `disputes` row of a third kind, `absence_complaint`, raised by the student, carrying their text in
`reason` and no session: a compensation case's `reason` is a closed list, and Phase 2's covering rule reads
`compensation_case` rows only (`caseInstantsAmong`), which a complaint must not move. One complaint per enrollment
may be open (a partial unique index); a second answers `COMPLAINT_OPEN`, and the app reads the open one to label the
button «شكوتك قيد المراجعة». The procedure declares its own rate limit, `rate_limit_absence_complaint`, with the
student as subject, as `booking.slots` and `checkout.*` declare theirs.

The administrator decides it one of three ways, each with a mandatory note and an audit entry:

- **(a) End the enrollment.** The old termination's effects: the remaining sessions `cancelled_by_admin`, the
  enrollment `terminated_no_show`, and a new compensation case `absence_termination` holding every remedy still owed
  (open or frozen, and every session owed one never offered), as a confirmed fault's case does (plan.md, the second
  analysis, C1). The complaint closes `resolved` with the resolution `enrollment_ended`.
- **(b) Suspend the teacher**, through `StandingService.suspend` on the decision's transaction, in a
  `party_suspended` resolution's lock order; the teacher's end (FR-483) then ends this enrollment with the others. The
  complaint closes `resolved`, `party_suspended`.
- **(c) Close the complaint.** It closes `dismissed`; nothing else changes.

### D4 — An administrator's restore

An administrator may restore an enrollment an administrator's decision closed before completion — `terminated_no_show`
under D3 (a), or `cancelled` (`admin`) when a suspended student's fault was confirmed — within
`enrollment_restore_window_days` (default 7) of the closing, read as the instant the closing's case was opened, in the
closing's own transaction. The closing is known by that case: `absence_termination` or `student_fault_confirmed`. A
ban, a deletion, a teacher's end and completion are not restorable.

Conditions, under the locks of an administrator's cancellation widened by the accounts and the slot: both accounts
active and the teacher's approval standing; the closing's case still open (one resolved or dismissed refuses); the
slot active, held by no other student's open hold and occupied by no other enrollment in any week the restore would
fill; no session it would create overlapping a session, an open hold or a reserved make-up time of either party. Each
refusal answers `RESTORE_REFUSED` with its cause and writes nothing.

Effects, in one transaction:

- the enrollment returns to `confirmed`; `cancellation_reason` returns to NULL, as ADR 0010 D5 does; `confirmed_at`
  is not written (R-HONEST-1: its one write path is the gateway's confirmation, which the enrollment had);
- one `enrollment_events` row of the new kind `restored`, the durable event Phase 4's notice reads;
- the sessions still owed are created anew, ordinary sessions numbered after the last, at the enrollment's weekly
  slot in its snapshot zone, from the nearest occurrence that starts at least the first-session lead after the
  restore. Their number is the snapshot's session count less the consumed sessions and less every session owed or
  still settling on its own path (a remedy the case held, a remedy never offered, a session not yet settled), so no
  session is owed twice. The cancelled sessions stay as they are;
- each remedy the closing's case held (`refund_case`, kind `makeup`, its `case_id` that case) is offered again as a
  frozen remedy is at reinstatement: a new `offered_at`, a full choice window, the answer window and the lead read
  again, a new proposal placed after the recreated sessions under the window rule;
- the closing's case closes `dismissed` with the note `restored`;
- audited `enrollment.restored` with the administrator's mandatory reason; idempotent under an `idempotencyKey`
  through the kernel's `IdempotencyService` (ADR 0008).

## Consequences

- **The state machines.** The enrollment gains `terminated_no_show → confirmed` and `cancelled (admin) → confirmed`
  by D4, beside ADR 0010 D5's `cancelled → confirmed`. A remedy gains `refund_case → awaiting_choice | proposed` by
  D4, its `case_id` cleared (rule 42 holds); `refund_case` is final except for that move. No database rule changes for
  either; the service holds both moves under the locks, with a database spec each.
- **What a restore leaves as it was.** The cancelled sessions, the complaint and its resolution, the
  `enrollment_events` rows of the closing, the `session_events` rows of the hand-over. The closing's case keeps its
  history: the remedies it held name it no more, the `remedy_handed_to_case` and `cancelled_by_admin` rows remain.
- **The chat.** An enrollment ended is read-only (FR-488); restored, it is writable again. The purge cannot have run,
  since it waits for every open case on the enrollment and the restore needs the closing's case open.
- **Phase 4.** A student may review a teacher once the enrollment is terminal (FR-REVIEW-1). Phase 3 writes no
  review; Phase 4's cycle decides what a restore does to a review written in the window.
- **SRS.** FR-NOSHOW-3, FR-NOSHOW-4 and FR-NOSHOW-5 rewritten; FR-CANCEL-8 added; FR-DISPUTE-5, FR-DISPUTE-7 and
  FR-ADMIN-4 amended; §3.14 loses the threshold row and gains `repeated_absence_flag_count` (5),
  `enrollment_restore_window_days` (7) and `rate_limit_absence_complaint` (5 per 3600 s); UC-4, §7 and §8; DEC-61.
- **ERD.** `disputes.kind` gains `absence_complaint`, `resolution` gains `enrollment_ended`, the compensation reasons
  replace `teacher_no_show_threshold` with `absence_termination`; rule 46 and §14 gain the one-open-complaint
  partial unique; `enrollment_events.kind` gains `restored`; `session_events.kind` gains `complaint_raised` and
  `complaint_decided`, rule 43 naming the complaint on them; the settings change; the notes on the status columns.
- **Code.** Phase 3's tasks, as the owner approves them (`specs/004-sessions/tasks.md`).
