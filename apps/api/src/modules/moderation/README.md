# moderation

## Owns

`disputes, gender_flags, user_reports`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Compensation cases

`disputes` holds session disputes and enrollment-level compensation cases (`kind`). Termination flows open compensation cases automatically (FR-DISPUTE-5). An admin's `compensation_ordered` resolution records the decision only; Platform Administration executes it through the gateway outside the code path, and `payments` records the gateway's refunded event (FR-DISPUTE-6). This module never references a money amount (R-MONEY-6).

## Never

Auto-resolve under_threshold or provider_outage sessions; those are terminal only by admin action (R-SESS-6).

## Locks

`openCompensationCase` takes the caller's transaction and locks the enrollment's row before it reads the open case (T005's rule 1), since nothing in the database keeps one open case per enrollment and reason: a second call for the same enrollment waits, then joins the first's case. In T005's order the enrollment comes after the accounts, the teacher's profile, the slot and the hold, so a caller may hold any of those, but must not hold a `payments` row's lock nor another enrollment's with a greater id. The insert references the enrollment alone, never a `users` row (`raised_by_user_id` stays NULL for a system case). A path that closes a case (Phase 3's resolution) takes the enrollment's lock before it writes. `caseInstantsOf` is read under the caller's enrollment lock; `caseInstantsAmong` takes no lock.

## Shape

The rules live in the services: `compensation-case.service.ts` (the system's compensation case, `openCompensationCase`, T035). The queries live in the repositories: `compensation-case.repository.ts` (the open case of an enrollment and reason, its insert, and the enrollment's row lock the opening serialises on, T005; an enrollment's cases as the covering rule of `jobs/case-cover.ts` reads them, whether one is open, the latest opening and the latest closing, for the confirm job, T039, and for the `expire-pending-payments` sweep, T040; T082). A router, when one arrives, is thin: validate, call one service method, return. Moderation imports no module (ARCHITECTURE §4, the module graph); no module imports it in Phase 2: the jobs do, `confirm-enrollment` for `openCompensationCase` and `caseInstantsOf`, `expire-pending-payments` for `caseInstantsAmong`, and `jobs/case-cover.ts` for the `CaseInstants` type. `gender_flags` and `user_reports` have no code yet. `index.ts` is the only import path. The probe over the real tables, the race included, is `tests/db-integrity/compensation-case.spec.ts`.

## Requirement ids

FR-362, FR-375, FR-DISPUTE-5 (`openCompensationCase`: one open case per enrollment and reason, `slot_unavailable`, `party_restricted` or `duplicate_payment`; T035).

FR-375, FR-PAYG-19 as amended 2026-11-04 (an enrollment's cases as the covering rule reads them: whether one is open, the latest opening and the latest closing, the database's instants; T082): `caseInstantsOf`, `caseInstantsAmong` in `compensation-case.repository.ts`.

FR-473, FR-474 (a participant's dispute of a session, opened after the caller's locks of the raiser, the enrollment and the session, at most one open per session by rule 46's `disputes_one_open_per_session_key`; each session's latest session dispute for the parties' screens; T026 of specs/004-sessions): `openSessionDispute` in `session-dispute.service.ts`, `latestSessionDisputesOf` in `session-dispute.repository.ts`.

FR-421, FR-422, FR-472, FR-474 to FR-476, FR-478 (an administrator's ruling on a session dispute, its lock and the queue's reads, a session's disputes for a revision, a case closed under its enrollment's lock with `resolved_at` by the database's clock and, on a closed `student_suspended` case, the case that owes its sessions in `covered_by_case_id` (rule 49), and the case queue's reads, the suspension cases a case covers found by that link, not by comparing instants; T034, T059, T035, T036 of specs/004-sessions, B39): `resolveSessionDispute` in `session-dispute.service.ts`, `lockDispute`, `sessionDisputeOf`, `sessionDisputesPage` and `sessionDisputesOfSession` in `session-dispute.repository.ts`, `closeCase` in `compensation-case.service.ts`, `caseQueuePage`, `caseRecordOf`, `latestCaseOf` and `suspensionCasesCoveredBy` in `compensation-case.repository.ts`.
