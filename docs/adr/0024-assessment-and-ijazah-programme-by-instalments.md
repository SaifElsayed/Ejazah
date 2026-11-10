# ADR 0024 — The assessment and the ijazah programme paid by instalments

**Status:** accepted · **Date:** 2026-11-10 · **Decided by:** the owner, 2026-11-03, 2026-11-04, 2026-11-05 and 2026-11-09 (the decisions B37's tasks commit records; `PLAN.md`, «The road to the store») · **Amends:** [ADR 0007](0007-direct-gateway-checkout.md) D2 (one gateway order confirms an enrollment and generates all of its sessions) and D4 (`payments` holds one row per gateway order, now several per enrollment); SRS FR-BOOK-3, FR-BOOK-4, FR-BOOK-10, FR-PAYG-19, §3.14, §14, §16 (adds §3.5.1, FR-BOOK-13 to FR-BOOK-19, DEC-63 and OPEN-12) · **Leaves for later:** ADR 0007 D1 (0% commission, no per-session deferred share) and R-MONEY-6 are **not** amended here: the commission (`specs/003-booking/tasks.md` T104) and the teacher's share released session by session (T105) wait for their own ADR (the notes under T104 and T105)

## Context

`PLAN.md`'s «After the MVP» held, since 2026-11-03, a programme that starts with an assessment and is paid in stages,
to be built after every phase closed. On 2026-11-09 the owner moved it before the server, inside the dated road to
the store (11/24 to 11/30), and settled its rules: a package that starts with a paid assessment, a total-price offer
after it, and on the ijazah track a monthly instalment paid through the gateway's subscription service, with a pause
the student ends by renewing and a stop that only an administrator decides.

Four documents say the opposite today. ADR 0007 D2 and SRS FR-BOOK-3, FR-BOOK-4 and FR-PAYG-5 confirm an enrollment by
one full payment and generate all of its sessions at once. SRS FR-PAYG-19 (Phase 2's FR-375) treats a second paid
order on a confirmed enrollment as a student who paid twice and opens a compensation case. SRS FR-BOOK-10 (Phase 2's
FR-394) releases a slot only from the week after the final session. Phase 2's FR-312 freezes a package's track and
session length once it has an enrollment.

## Decision

### D1 — The programme starts with a paid assessment

- A package of the programme starts with an assessment session. Its fee is part of the package's price and is never
  refunded. What remains to pay is the package's price less the assessment fee; with instalments the fee may not be
  deducted, so paying by instalments costs a little more.
- After the assessment the teacher sets the student's level, readiness, the programme's expected length, the number of
  sessions and their length (30, 45 or 60 minutes). The student receives one offer with one total price; a session's
  price is derived from it. The count and the length are set once, at the offer, and frozen from then on, as FR-312
  freezes them for a package today.
- After the assessment the package's slots stay reserved while the student decides: cancel, or pay the rest within
  **24 hours**. If the first regular session starts sooner than that, the deadline is its start less **2 hours**. If
  it starts less than 2 hours after the assessment, it is not the package's first: the first becomes the next weekly
  occurrence, and the deadline is computed from it. A cancellation, or no payment by the deadline, offers the slots to
  anyone again. The student is reminded before the deadline.
- The teacher cannot refuse a student on their own: they give an administrator a reason, and the administrator decides.
- The 24 hours and the 2 hours are §3.14 settings, read from `settings` (R-MONEY-12; the owner's decision of
  2026-11-10 on B37's conflict check, Q3).

### D2 — Instalments, on the ijazah track only

- The recitation track is paid in full, as today. The ijazah track may be paid in full or by monthly instalments.
- Each instalment covers its month's sessions. After a month's last session, the next month's sessions do not open
  until the student renews. Each instalment is a gateway order of its own, so one enrollment holds several paid orders
  by design: an order carries its kind (the assessment, the rest in full, an instalment), and a paid order of an
  expected kind is never a second payment (FR-PAYG-19 as amended).
- Instalments go through the gateway's subscription service; the payee split applies there too (ADR 0007 D1's
  settlement to the teacher stands). What the gateway documents and what it said only verbally are recorded in
  OPEN-11 and in the open point on the gateway's answers (`PLAN.md`, «The road to the store»).

### D3 — Renewal: the grace stays open, and only an administrator closes

1. The grace stays open. The package is paused, its slots stay reserved, and the student can renew at any time. There
   are no extensions, no student requests and no timers; nothing closes by force, and no automatic close exists.
2. A paused package has no release, and its paused sessions never reach the attendance sweep as no-shows.
3. On renewal, the sessions that fell inside the pause are added at the end of the package, at the same weekly times;
   they move the final session, and with it the slot's release (FR-BOOK-10).
4. For the first **7 days** of a pause (a §3.14 setting, Q3) the teacher cannot ask to stop it. After them the teacher
   can raise a request to an administrator to stop the package because the student is late, with a reason; one open
   request at a time. The administrator decides. Approved, the package closes and all of its slots return to being
   available at once, which FR-BOOK-10 as amended allows.
5. A renewal while a stop request is open withdraws the request by itself, with one log line of ids and a reason that
   administrators can see; the teacher may raise a new one if the student is late again.
6. The student is reminded when an instalment is due; the teacher's screen shows that the student is late and since
   when; administrators see paused packages and stop requests oldest first, with how late the student is and the
   teacher's reason, decide each, and can reopen a closed package. Each automatic pause, and the withdrawal of a
   request, logs one line with ids and a reason.
7. A teacher who is suspended, banned or gone: a closed package offers no return and opens no case for an
   administrator; the app says the teacher is unavailable; sessions already paid and not taken stay under Phase 3's
   termination and remedy rules.

### D4 — What stays open

**Returning after a close** is not decided (SRS OPEN-12). The owner is reviewing with their sheikh whether it is
realistic, and answers before 11/23, before the programme's Spec Kit cycle. Hanging on it: whether a teacher
reinstated later makes a return possible again, and the gateway's subscription being suspended rather than cancelled
when a package closes (a cancelled subscription cannot be resumed on the same instalments). D3.7 is worded to stand
whatever OPEN-12 decides.

## Consequences

- No code before the programme's own Spec Kit cycle on 11/23 (R-PROC-1); the build runs 11/24 to 11/30, and nothing of
  it may slide past 12/6 into Phase 6 (R-PROC-6; `PLAN.md`, «The road to the store»).
- The cycle writes what the build needs from this ADR: the order's kind and FR-375 in `specs/003-booking/spec.md`, the
  offer's count and length beside FR-312, the pause, the stop request and the reminders in the ERD and the
  programme's data model, and the three new settings in the seed.
- The session code already reads the number and length of sessions from the enrollment's snapshot and assumes no
  one-time generation (FR-424 of `specs/004-sessions/spec.md`), which D2 and D3 rely on.
- ADR 0007 D1 and R-MONEY-6 are unchanged by this ADR. The commission (T104) and the share released per session (T105)
  conflict with them, and their ADR is written before 11/24, after the commission decision of 11/16 and the gateway's
  written answer; without that written answer T105 is not built in 11/24 to 11/30 (the notes under T104 and T105).

## Documents amended

`docs/SRS.md` (the amendment of 2026-11-10, §3.5.1, FR-BOOK-3, FR-BOOK-4, FR-BOOK-10, FR-PAYG-19, §3.14, DEC-63,
OPEN-12), `PLAN.md` («The road to the store»; «After the MVP»). In the programme's cycle (11/23):
`specs/003-booking/spec.md` (FR-312, FR-375), `docs/ERD.md`, the programme's own `specs/` folder.
