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

The rules live in the services: `compensation-case.service.ts` (the system's compensation case, `openCompensationCase`, T035). The queries live in the repositories: `compensation-case.repository.ts` (the open case of an enrollment and reason, its insert, and the enrollment's row lock the opening serialises on, T005; an enrollment's cases as the covering rule of `jobs/case-cover.ts` reads them, whether one is open, the latest opening and the latest closing, for the confirm job, T039, and for the `expire-pending-payments` sweep, T040; T082). A router, when one arrives, is thin: validate, call one service method, return. Moderation imports identity only, since 005:T011 (B47): `visibleTeachers` for a profile report (R-408; ARCHITECTURE §4, the module graph); sessions' and booking's parties reach it through the `Pairings` port (`pairings.port.ts`) that `main.ts` binds to `partyOfSession`, `partyOfEnrollment` and `paired`; no module imports it in Phase 2: the jobs do, `confirm-enrollment` for `openCompensationCase` and `caseInstantsOf`, `expire-pending-payments` for `caseInstantsAmong`, and `jobs/case-cover.ts` for the `CaseInstants` type. `user_reports` (005:T011, B47): `user-report.service.ts` and `user-report.repository.ts` behind `reports.create` (`reports.router.ts`) and the administrators' `reports.list`, `.get`, `.resolve` (`reports-admin.router.ts`); a session or chat report key-shares both accounts, then locks the enrollment (`lockCasesOf`), then inserts (`specs/004-sessions/contracts/kernel.md`, «a report raised»); the DB proofs are `tests/db-integrity/user-reports.spec.ts`, `pairings.spec.ts` and `user-report-race.spec.ts`. 005:T012 (B47): `open-matters.repository.ts`'s `enrollmentsWithOpenReportAmong` names the enrollments with an open `user_reports` row (through `enrollment_id`, no lock); the chat purge reads it beside `enrollmentsWithOpenMatterAmong`, booking's held files do not (FR-AUTH-14, Q-R1 (a)). `gender_flags` has no code yet. `index.ts` is the only import path. The probe over the real tables, the race included, is `tests/db-integrity/compensation-case.spec.ts`.

## Requirement ids

FR-362, FR-375, FR-DISPUTE-5 (`openCompensationCase`: one open case per enrollment and reason, `slot_unavailable`, `party_restricted` or `duplicate_payment`; T035).

FR-375, FR-PAYG-19 as amended 2026-11-04 (an enrollment's cases as the covering rule reads them: whether one is open, the latest opening and the latest closing, the database's instants; T082): `caseInstantsOf`, `caseInstantsAmong` in `compensation-case.repository.ts`.

FR-473, FR-474 (a participant's dispute of a session, opened after the caller's locks of the raiser, the enrollment and the session, at most one open per session by rule 46's `disputes_one_open_per_session_key`; each session's latest session dispute for the parties' screens; T026 of specs/004-sessions): `openSessionDispute` in `session-dispute.service.ts`, `latestSessionDisputesOf` in `session-dispute.repository.ts`.

FR-421, FR-422, FR-472, FR-474 to FR-476, FR-478 (an administrator's ruling on a session dispute, its lock and the queue's reads, a session's disputes for a revision, a case closed under its enrollment's lock with `resolved_at` by the database's clock and, on a closed `student_suspended` case, the case that owes its sessions in `covered_by_case_id` (rule 49), and the case queue's reads, the suspension cases a case covers found by that link, not by comparing instants; T034, T059, T035, T036 of specs/004-sessions, B39): `resolveSessionDispute` in `session-dispute.service.ts`, `lockDispute`, `sessionDisputeOf`, `sessionDisputesPage` and `sessionDisputesOfSession` in `session-dispute.repository.ts`, `closeCase` in `compensation-case.service.ts`, `caseQueuePage`, `caseRecordOf`, `latestCaseOf` and `suspensionCasesCoveredBy` in `compensation-case.repository.ts`.

FR-452 (the student's complaint of the teacher's absence, an `absence_complaint` row inserted under the caller's locks of the student and the enrollment, one open per enrollment by `disputes_one_open_complaint_per_enrollment_key`, and the open one read for `enrollments.get`'s `complaintOpen` and the `COMPLAINT_OPEN` answer; T060 of specs/004-sessions, B40): `openAbsenceComplaint` in `absence-complaint.service.ts`, `openComplaintOf` in `absence-complaint.repository.ts`. FR-486 (the case of an enrollment's end that a cleared suspension case names, read only among the cases opened after it; PR #133's review, round 2, B40): `latestCaseOf`'s `after` in `compensation-case.repository.ts`.

FR-613 to FR-615 (a user's flag of the declared gender of someone they are paired with or shown, one open flag per person by `gender_flags_one_open_per_user_key`, the reason stored and never logged; the administrator's flag, from a report or alone, the queue and the dismissal; 005:T013, B47): `createGenderFlags` in `gender-flag.service.ts`, `gender-flag.repository.ts`, `gender-flags.router.ts` (the user's `genderFlags.raise`). `main.ts` builds one service over the `Pairings` port's `paired` and hands it to both surfaces; the administrator's procedures are the admin module's router (Q-G1 (a)). FR-616 (a gender correction's case, `gender_correction` in `COMPENSATION_REASONS`, one per ended enrollment; 005:T014).

SRS FR-SESS-13 as amended (DEC-100; 005:T034, R1a): an administrator reads an enrollment's chat under an open session or chat report, `reports.chat` (`reports-admin.router.ts`, audited `chat.read` on the enrollment) over `createReportChat` (`report-chat.service.ts`: the report open and naming the enrollment the input names, read with no lock). Moderation imports no chat (chat → booking → moderation): it asks the `ReportChat` port (`report-chat.port.ts`), which `main.ts` binds to chat's `createDisputeChat()`. `reports.get` answers `chatAvailable`.
