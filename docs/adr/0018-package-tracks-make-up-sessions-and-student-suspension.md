# ADR 0018 — Package tracks, make-up sessions, and what a student's suspension costs

**Status:** accepted · **Date:** 2026-10-15 · **Decided by:** the owner, 2026-10-15 · **Amends:** SRS FR-PROFILE-2, FR-IJAZAH-1, §3.8 (FR-CANCEL-2, FR-NOSHOW-2, FR-NOSHOW-6, FR-DISPUTE-5; adds §3.8.5 FR-MAKEUP-1..6), FR-ADMIN-5, FR-AUTH-11, FR-NOTIF-1, §3.14, §6, §7, OPEN-11 (adds DEC-58); ERD packages, enrollments, sessions, settings

**Amended 2026-11-05 (Phase 3's clarify, T106 of `specs/003-booking/tasks.md`; the owner's decision).** SRS FR-MAKEUP-2 and FR-MAKEUP-3 were amended, with FR-MAKEUP-1 and FR-MAKEUP-4 beside them: the remedy is offered once the session's outcome is final; the Student's counter-proposal is one of the Teacher's active availability slots; the Teacher answers it within 72 hours, and one left unanswered becomes a refund on either track. The same day, on Phase 3's plan (`specs/004-sessions/plan.md`, «Decisions recorded»; the owner's decisions), D3's "a declined counter-proposal falls back to the system's proposal" changed: while the choice window is open, a decline releases the counter-proposal's time and the Student may accept the proposal or counter-propose again, one counter-proposal pending at a time; only a decline after the window has closed books the proposal. While a counter-proposal is pending the Student may accept the proposal, which withdraws it. Neither the proposal nor a counter-proposal starts before the matter could still be decided: the proposal never before the end of the choice window plus one answer window. A cancellation by agreement is final at acceptance, so its make-up is offered at once (SRS FR-CANCEL-2). D5's suspension leaves the Enrollment Confirmed, holding its slot, until the case is decided: the Student cleared, the make-ups are placed in the same Enrollment; the fault confirmed, the Enrollment is cancelled and only then is its slot freed; a ban cancels the Enrollments at once (SRS FR-ADMIN-5). The same day, on Phase 3's analysis (the owner's decisions): a cleared Student is owed for each cancelled session what a Teacher-No-Show owes (on recitation a make-up or a refund at the Student's choice, on the ijazah track a make-up); a remedy already offered is frozen during a suspension and offered again, with a new full choice window, at reinstatement (SRS FR-ADMIN-5); and no make-up starts within the first-session lead of the moment it is decided, the answer window and the lead fixed at the proposal's offer (SRS FR-MAKEUP-3). On Phase 3's second analysis (the owner's decision, C1), D5's «nothing owed» for a confirmed fault became narrower: it covers only the sessions the suspension cancelled, the Enrollment ends, and every remedy still owed on it goes to a new compensation case, narrowed again on the third analysis to the ordinary sessions, a make-up session the suspension cancelled staying owed (SRS FR-ADMIN-5). The text of the decisions below is unchanged; `docs/SRS.md` §3.8.5, FR-ADMIN-5 and their amendments of 2026-11-05 govern.

## Context

The SRS says that some sessions are not consumed: a teacher's absence, a cancellation both parties agreed to, and
both parties absent. It never said what the student gets for them. All sessions are generated at payment, so a
session that is not consumed leaves a paid session with no date.

The SRS also let an admin suspend or ban a student, without saying what happens to that student's paid sessions.

## Decision

### D1 — Every package has a track

When creating a package, the teacher chooses one of two tracks:

- **تسميع** (recitation).
- **مسار إجازة** (ijazah track).

The enrollment keeps the track in its snapshot (DEC-24). An ijazah can be requested only from an enrollment in the
ijazah track (FR-IJAZAH-1, ADR 0017).

### D2 — A session that is not consumed is made up, or for recitation may be refunded

| Case | Recitation | Ijazah track |
|---|---|---|
| Teacher absent (Teacher-No-Show) | The student chooses a make-up session or a monetary refund of that session | Make-up session only |
| Cancelled by agreement | Make-up session | Make-up session |
| Both absent | Make-up session | Make-up session |
| Student absent | Consumed. Nothing owed (unchanged) | Consumed. Nothing owed |

An ijazah-track package is a whole: a dropped session must be made up.

### D3 — The make-up session is placed by agreement

**The proposal.** The system proposes the same weekly slot in the week after the enrollment's last session. If that
slot is taken that week, it proposes the first week the slot is free.

**The student's response.** The student can:

- accept the proposal;
- propose another date and time, which the teacher accepts or declines. A declined counter-proposal falls back to the
  system's proposal.

**If the student does not respond.** When the Admin-configurable choice window ends (§3.14, default 7 days), the
proposed slot is booked.

**What the make-up session is.** It is an ordinary session of the enrollment:

- it is numbered after the last one;
- it extends the enrollment's end;
- it extends the slot's release (FR-BOOK-10).

It is not rescheduling, which stays deferred (§13): the original session keeps its outcome.

### D4 — A refund is an admin-decided case, executed by the gateway

When a student chooses a refund (D2), a compensation case opens (FR-DISPUTE-5) for the unconsumed session. The case
carries no amount: the platform computes no share of a price (ADR 0007 D1, R-MONEY-5 and R-MONEY-6), and `disputes`
and `session_remedies` gain no `_piasters` column. Platform Administration works out what one session is worth from the
enrollment's snapshot price and session count outside the code path, as it executes the refund (FR-DISPUTE-6).

The administration decides the case and executes the refund through the gateway (FR-DISPUTE-6). The platform holds no
funds (ADR 0007).

How often the gateway pays the teacher (weekly or monthly) is decided with the gateway. Whether a refund decided
before a payout is taken from the teacher's pending payout is decided there too. Both are added to OPEN-11.

### D5 — Suspending or banning a student

| Action | Upcoming sessions | Money |
|---|---|---|
| **Suspension** (temporary, under review) | Every upcoming session is cancelled at the moment of suspension (`cancelled_by_admin`); a suspension has no end date, so none is left to become a no-show. A compensation case opens and waits for the review | If the student is cleared: make-up sessions or a refund, under D2's rule for the enrollment's track. If the fault is confirmed: nothing owed, as with a student's absence |
| **Ban** (final) | All upcoming sessions are cancelled | Nothing owed by default. The administration may decide otherwise in the case |

Either way, the teacher is notified and the freed slots return to booking. The Terms say plainly that a suspension
or ban for a violation earns no refund (FR-AUTH-11).

## Consequences

- **SRS.**
  - FR-PROFILE-2 and FR-IJAZAH-1 change.
  - FR-CANCEL-2, FR-NOSHOW-2 and FR-NOSHOW-6 point to §3.8.5.
  - New §3.8.5: FR-MAKEUP-1..6.
  - FR-DISPUTE-5 gains refund choices and student suspensions.
  - FR-ADMIN-5 states D5.
  - FR-NOTIF-1 gains the make-up events.
  - §3.14 gains the choice window.
  - OPEN-11 gains two questions.
  - §6 and §7 change, and DEC-58 is added.
- **ERD.** Forward migrations in the Phase 1 ERD pass:
  - `packages.track` (enum `recitation` · `ijazah_track`) and `enrollments.snapshot_track`;
  - `sessions.makeup_for_session_id` (nullable);
  - a `session_remedies` table: one row per session not consumed, holding:
    - `session_id`;
    - `kind`: `makeup` or `refund`;
    - `status`: `awaiting_choice`, `proposed`, `counter_proposed`, `booked` or `refund_case`;
    - `proposed_date`, `counter_date`, `decided_at`, `case_id`;
  - a settings row for the choice window.
- **Design, student:**
  - a choice sheet (make-up or refund) after a teacher's absence on recitation;
  - the proposal sheet (accept or propose another time);
  - the make-up session in the enrollment.
- **Design, teacher:**
  - the track on the package editor;
  - the counter-proposal sheet.
- **Design, admin:**
  - refund cases;
  - the student suspension dialog per D5;
  - the choice-window setting.
