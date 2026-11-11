# Phase 3 Contracts

**Feature**: `specs/004-sessions/` · **Date**: 2026-11-05

The procedures that run, settle, cancel, make up and dispute a session, the chat, the administrator's queues, the video
provider's boundary, and what changes in the kernel. As in Phases 1 and 2: every procedure is additive-only once merged
(R-API-9), declared through a caller kind with its input and its **output** schema (`.output(schema)`, the owner's
decision of 2026-10-10), and, where it can be flooded, its rate limit (this phase: `chat.send`'s `rate_limit_chat_message`,
the chat upload's `rate_limit_upload`, `sessions.complaint.raise`'s `rate_limit_absence_complaint` and the live
channel's opening, `live.events`' `rate_limit_live_channel` (10 per 60 s; research R-324), each with the user as subject; the complaint's with a test that a call over it is refused, SC-415; on the administrator surface
`disputes.revise`'s `rate_limit_dispute_revision`, `sessions.restore`'s `rate_limit_enrollment_restore`,
`sessions.review.revise`'s `rate_limit_outcome_correction` and `cases.openManual`'s `rate_limit_manual_compensation_case`, the administrator as subject, checked before the kind's transaction; the three name searches, `users.list`, `sessions.monitor.list` and `teacher.students.list`, Phase 1's `rate_limit_search`, the administrator or the teacher as subject, failing closed (the owner's decision of 2026-11-06 on the fourth analysis, C2), each with a test that a call over it is refused; every signed-in procedure that declares none is counted
by `rate_limit_signed_in_default`, 150 per 60 s per research R-325 (the owner's decision of 2026-11-06 on the fifth analysis; the larger of 120 and the heaviest normal minute × 2–3, never a number above 200: R-321, item 5), failing open, while every declared limit fails closed:
spec FR-470, kernel.md "Rate limits"); every output is exactly its schema's fields
(R-HONEST-4); every non-public user-surface procedure has a refusal test naming it (`pnpm check:authz`); every change
passes `pnpm contract:snapshot --check --base origin/develop`.

| Document | Contract |
|---|---|
| [app-surface.md](./app-surface.md) | The user surface: a session, its join, cancellation, remedies, disputes; a complaint of the teacher's absence; chat; the live channel (`live.events`, a subscription over Server-Sent Events); Phase 2's lists' additive fields |
| [admin-surface.md](./admin-surface.md) | The administrator surface: the monitor and an enrollment's restore, the review queue, outages, disputes, cases and a complaint's decision, a student's standing, the user directory |
| [video.md](./video.md) | The video port as this phase calls it, the webhook, the LiveKit adapter, the stand-in and its harness |
| [kernel.md](./kernel.md) | Locks, database refusals, the rate limits, the live channel (its registry, bus and after-commit publisher, the shutdown order), the composition root, the jobs, the gates |

## Conventions

- **Names.** `namespace.verb` in camelCase. New namespaces on the user surface: `sessions` (with `cancellation`,
  `remedy`, `dispute`, `complaint`), `chat`, `live` (one subscription, `live.events`). On the administrator surface: `sessions` (with `monitor`, `review`, `outages`),
  `disputes`, `cases`, `students`; and two new reads, `list` and `get`, in Phase 1's `users` (the user directory).
- **Callers.** "participant" is the user kind admitting an active student, or an approved teacher whose account is
  active, who is one of the two people of the session or enrollment named; anyone else answers `NOT_FOUND` with the
  shape a nonexistent id gets (R-GENDER-2, FR-432). A restricted account is `ACCOUNT_RESTRICTED` before the service.
- **Ids in inputs.** `sessionId`, `enrollmentId`, `requestId`, `slotId`, `messageId`, `disputeId`, `caseId`,
  `remedyId` and `userId` (admin only): never `gender` or `role`, and a user procedure never takes a `userId` (R-GENDER-4).
- **Errors.** Added: `JOIN_NOT_OPEN` (with `opensAt` in details), `JOIN_CLOSED`, `SESSION_NOT_SCHEDULED`,
  `CANCELLATION_PENDING` (the other party's request is open; with `requestId`), `CANCELLATION_EXPIRED`,
  `CONFLICT` with `details.cause` `not_pending` (`sessions.cancellation.answer` to a request no longer pending, nothing
  written; the owner's decision of 2026-11-10 on B37, T021), `DISPUTE_WINDOW_CLOSED`, `DISPUTE_OPEN`, `SESSION_UNDER_REVIEW`, `NOT_DISPUTABLE` (any cancelled session, by
  agreement or by an administrator; a Cancelled-By-Agreement one is final at acceptance), `REMEDY_NOT_OPEN`, `COUNTER_PENDING` (a counter-proposal is
  already waiting for the teacher's answer), `CHOICE_NOT_ALLOWED` (a refund
  where only a make-up is owed), `SLOT_NOT_OFFERED` (a counter outside the options), `MAKEUP_REFUSED` (the database
  refused the booking, by an overlap, or by a deadlock on the retry too (the sixth analysis, L5: retried once); the remedy stays open; a teacher's refused acceptance then releases the counter-proposal in its
  own transaction, as a decline does: the third analysis, A3), `ATTACHMENT_REFUSED` (an image, or a type the chat does
  not take), `CHAT_CLOSED`, and on the administrator surface `STUDENT_SUSPENDED` (a suspended student's case closed as
  cleared before the account is reinstated), `RULING_FINAL` (a ruling's revision after the session's dispute window
  closed or once a remedy exists; `details.cause`) and `RULING_SUPERSEDED` (a revision of a ruling a later dispute's
  resolution replaced), both on the third analysis; on the decision of no automatic termination (2026-11-05),
  `COMPLAINT_OPEN` on the user surface (a complaint of the teacher's absence is already open on the enrollment) and
  `RESTORE_REFUSED` on the administrator surface (`details.cause`: `not_restorable`, `window_closed`, `case_closed`,
  `party_restricted`, `slot_inactive`, `slot_changed` (the slot's day, local start or zone changed since the enrollment's
  sessions were generated: the owner's decision of 2026-11-05, an eighth cause), `slot_taken`, `time_taken` (an overlap, or a deadlock on the retry too: the sixth analysis, L5)); on the decisions answering the administrator's control inventory (2026-11-05),
  `REMEDY_NOT_OPEN` also on the administrator surface (`cases.openManual` naming a remedy no longer open), and
  `CONFLICT` with `details.cause` `ruled` or `not_settled` (`sessions.review.revise`, `sessions.review.get`); on B39's conflict check (the owner's decision of 2026-11-11, Q2; B37's precedent), `CONFLICT` with `details.cause` `not_under_review` (`sessions.review.resolve` on a session neither `under_threshold` nor `provider_outage`), `not_evaluated` (`disputes.resolve` with `upheld`, `compensation_ordered`, `party_suspended` or `party_banned` while the session's outcome is not yet frozen, its evaluation not yet run) and `not_open` (`disputes.resolve` on a dispute no longer open).
  On B39's conflict check (the owner's decision of 2026-11-11, Q2; B37's precedent), `CONFLICT` with `details.cause`
  `not_open` on `cases.resolve` and `cases.dismiss` (a case no longer open, T035), and (Q5 (a)) `no_free_week` on
  `cases.resolve` of a `student_suspended` case when T028's offer finds no free week for a session the suspension
  cancelled, the case left open (T036). Every
  refusal writes nothing. Changed, additively (the owner's decision of 2026-11-06 on the sixth analysis, item 6; T062):
  Phase 1's `RATE_LIMITED` refusal from a rate limit's counter carries the time until its window ends,
  `details: [{ path: 'retryAfterSeconds', code: '<n>' }]`, a positive whole number of seconds as text, read from the
  counter key's remaining time to live on the refused path only; a refusal whose time cannot be read, or that no
  counter made, has no details (kernel.md, "Rate limits"). The phone and the panel read it through their existing
  `errorDetailsOf` (`apps/mobile/src/lib/client.ts`, `apps/admin/src/lib/client.ts`).
- **Time.** Instants as ISO-8601 UTC strings; a session as its local date, local start and zone plus its instants,
  shown twice by the client (ADR 0009 D5, FR-494); nothing client-supplied is an instant (R-TIME-6): the outage window
  is local date, time and zone.
- **A deleted party** (T090, FR-426): `{ displayName: string | null, deleted: boolean }`; the apps show the stand-in.
- **What is not here.** No amount, share, commission, refund or payout (FR-497, T104, T105). No review, report,
  notification, reminder or certificate (Phase 4). No rescheduling and no cancellation of a whole enrollment by a
  student (FR-461). No gender dispute (Phase 4).
