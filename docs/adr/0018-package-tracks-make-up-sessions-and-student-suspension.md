# ADR 0018 — Package tracks, make-up sessions, and what a student's suspension costs

**Status:** accepted · **Date:** 2026-10-15 · **Decided by:** the owner, 2026-10-15 · **Amends:** SRS FR-PROFILE-2, FR-IJAZAH-1, §3.8 (FR-CANCEL-2, FR-NOSHOW-2, FR-NOSHOW-6, FR-DISPUTE-5; adds §3.8.5 FR-MAKEUP-1..6), FR-ADMIN-5, FR-NOTIF-1, §3.14, §6, §7, OPEN-11 (adds DEC-58); ERD packages, enrollments, sessions, settings

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

When a student chooses a refund (D2), a compensation case opens (FR-DISPUTE-5). The default amount is one session:
the snapshot price divided by the snapshot session count.

The administration decides the case and executes the refund through the gateway (FR-DISPUTE-6). The platform holds no
funds (ADR 0007).

How often the gateway pays the teacher (weekly or monthly) is decided with the gateway. Whether a refund decided
before a payout is taken from the teacher's pending payout is decided there too. Both are added to OPEN-11.

### D5 — Suspending or banning a student

| Action | Upcoming sessions | Money |
|---|---|---|
| **Suspension** (temporary, under review) | Sessions falling inside the suspension are cancelled (`cancelled_by_admin`). A compensation case opens and waits for the review | If the student is cleared: make-up sessions or a refund, under D2's rule for the enrollment's track. If the fault is confirmed: nothing owed, as with a student's absence |
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
- **ERD.** Forward migrations in the Phase 1 and Phase 2 passes:
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
