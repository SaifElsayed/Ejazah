# sessions

## Owns

`sessions, session_participant_events, cancellation_requests, session_remedies`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6. Phase 2 writes and reads `sessions` alone; `session_participant_events`, `cancellation_requests` and `session_remedies` have no code before Phase 3.

## Never

Accept attendance from the client; provider webhooks into `session_participant_events` only (R-SESS-1). Evaluate a session as a webhook reaction; the scheduled job at `scheduled_end + 2m` does it (R-SESS-2). Settle before scheduled end (R-SESS-3). Penalise a reconnection (R-SESS-4). Let a suspended, revoked or banned teacher join (R-SESS-5). Auto-resolve `under_threshold` or `provider_outage` (R-SESS-6). Resolve a session instant outside `packages/time` (R-TIME-1). Reference a price, a payment record or any payment concept (R-MONEY-6, ADR 0007).

## Locks

Generation inserts rows that reference both accounts and the enrollment, so `generateForEnrollment` takes the caller's transaction and takes no lock itself: it expects the caller to hold, in T005's order (`apps/api/src/platform/db/row-lock.ts`), both accounts in one `lockRows(tx, 'users', …)` call, then the slot, then the enrollment. Its one caller, the `confirm-enrollment` job, takes them through booking's `lockForConfirmation`. A session the database refuses as overlapping another of the teacher or the student (ERD §15 rule 19) fails the whole statement, and the caller rolls back. The re-resolution writes by a conditional update on the session being still `scheduled`, inserts nothing and takes no lock; every read for booking takes none. `sessions.join` (T011 of specs/004-sessions; contracts/kernel.md, its row) reads the session to learn its two parties, locks both accounts in one `lockSessionParties` call (`lockRows(tx, 'users', …)`), reads the session and both accounts again under the locks, and commits having written nothing: no `sessions` row is locked or written, and no attendance; the room and the token are asked of the video port after the commit. `sessions.get` reads on one transaction and takes no lock.

## Shape

The rules live in `generation.service.ts` (an enrollment's sessions, T034), `reresolution.service.ts` (the recomputation of every scheduled session's cached instants when time zone rules change, T048, ADR 0009 D3) and `progress.ts` (an enrollment's progress, derived on every read and stored nowhere, T049). The queries live in `sessions.repository.ts` (generation's one insert and the reads booking asks for) and `reresolution.repository.ts` (the re-resolution's pages and updates). `sessions.router.ts` serves `sessions.get` and `sessions.join` over `sessions.service.ts` (T011 of specs/004-sessions), the participant kind, mounted under `sessions` by `app.router.ts`. Sessions imports identity's entry for the parties' accounts (ARCHITECTURE §4, the graph Phase 3 builds) and declares `EnrollmentSide` for booking's enrollments; booking and the jobs import it. `index.ts` is the only import path.

What `index.ts` gives the others, each on the caller's transaction:

- Booking: `lastSessionDateOf` (an enrollment's final session's local date, for a slot's release, T026), `partiesSessionsBetween` (a student's and a teacher's sessions in a window, for the one overlap check of the booking sheet and the hold, T032, T033), `enrollmentSessionsOf` (`checkout.status`, T037), `sessionsOfEnrollments`, `teacherSessionsBetween` and `sessionProgress` (the lists and the payments monitor's progress, T049, T052).
- The `confirm-enrollment` job: `generateForEnrollment` (T034, T039).
- The `reresolve-session-instants` job: `reresolveScheduledSessions` and `reresolutionStore` (T048), with each enrollment's length read through booking's entry.
- The `advance-remedies` job (T028, T032 of specs/004-sessions): `createRemedyAdvance` (the sweep: remedies offered once their dispute windows close, frozen ones offered again, the completion check), `createRemedyOffer` and `createRemedyWindows` (a counter's answer window and the choice window ended, each remedy on its own transaction), over booking's `EnrollmentSide`.
- `EnrollmentSide` (booking implements it): besides the moves, `slotWeekTaken` and `slotsFreeFrom` (a week of a slot another package keeps, the remedy's own enrollment left out: the owner's rule of 2026-11-10, a package's slot returns only once it is completed) and `heldTimesOf` (the parties' open holds).

## Requirement ids

`SRS-SES-*`: `FR-SESS-*`, `FR-NOSHOW-*`, `FR-CANCEL-*`, section 3.7.5. _Filled as they land._

- FR-368, FR-369 (an enrollment's sessions at the slot's local time in consecutive weeks, the first at least `first_session_lead_hours` after the confirmation, each resolved on its own; R-209, ADR 0009 D1 and D2): `generation.service.ts`, `sessions.repository.ts`.
- FR-370, FR-SESS-20 (the cached instants recomputed when time zone rules change, an overlap restored to its previous instants; R-210, ADR 0009 D3): `reresolution.service.ts`, `reresolution.repository.ts`.
- FR-394, FR-BOOK-10 (an enrollment's final session's date, for a slot's release; R-205): `sessions.repository.ts`.
- FR-351, FR-BOOK-5 (the parties' sessions the one overlap check reads): `sessions.repository.ts`.
- FR-386, FR-393 (an enrollment's sessions as `checkout.status` shows them): `sessions.repository.ts`.
- FR-392, R-DB-4 (an enrollment's upcoming, completed and remaining sessions, derived on read; consumed are `done` and `student_no_show`): `progress.ts`. FR-390, FR-391 (the sessions of some enrollments and of a teacher's day, for booking's lists): `sessions.repository.ts`.
- FR-431, FR-432, FR-434, FR-435, FR-482, FR-494, FR-499, R-GENDER-7, R-SESS-5 (a session read by its party, and the join from `startsAt − early_join_lead_minutes` until `endsAt`, for a `scheduled` session, both accounts active, the teacher approved, both of one gender, read under both accounts' locks, a token bound to the session and the caller until the scheduled end; T011 of specs/004-sessions): `sessions.service.ts`, `sessions.repository.ts`, `sessions.router.ts`.
- FR-459, FR-CANCEL-5 (the cancellation requests a user made, in total and within `cancellation_requests_recent_days`, counted when read; T025 of specs/004-sessions): `cancellation-request-counts.service.ts`, `cancellation-request-counts.repository.ts`.
- FR-473, FR-474, FR-495 (`sessions.dispute.raise`: keyed, the raiser, the enrollment and the session locked in that order, the session `disputed` with its outcome frozen, moderation's `openSessionDispute`, one `dispute_raised` event; and the dispute fields the screens read; T026 of specs/004-sessions): `dispute-raise.service.ts`, `dispute-raise.repository.ts`, `dispute-view.ts`, `sessions.router.ts`.
- FR-468, R-320 (a remedy's reserved times: its proposal, and a pending counter's time, hidden from every other offer and booking until it is booked or released; T027 of specs/004-sessions): `reservations.service.ts`, `reservations.repository.ts`.
- FR-462, FR-463, FR-464 (a remedy offered once the dispute window closes with no dispute open, its proposal the first week after the enrollment's last session that no session, hold, reservation or other package takes, searched at most the snapshot's count of weeks; frozen and offered again; T028): `remedy-offer.service.ts`, `remedy-offer.repository.ts`, `remedy-offer.sweep.ts`, `remedy-offer.view.ts`.
- FR-423, FR-468, FR-469 (a make-up booked, the proposal or a counter, under the kernel's «make-up booking» locks; a reserved time, another package's week (a counter) or the database's exclusion refusing it; one retry on a deadlock; T029): `makeup-booking.service.ts`, `makeup-booking.repository.ts`.
- FR-463, FR-465, FR-467, SC-410 (a remedy handed to a compensation case with its reason, no amount; T030): `remedy-case.service.ts`, `remedy-case.repository.ts`.
- FR-463 to FR-469, FR-495 (`sessions.remedy.choose`, `.accept`, `.counterOptions`, `.counter` and `.answerCounter`; the counter's answer window and the choice window ended by the sweep; T031, T032): `remedy.service.ts`, `remedy.repository.ts`, `remedy-deadlines.ts`, `sessions.router.ts`.
- FR-421, FR-422, FR-446, FR-449, FR-450, FR-462, FR-470, FR-471 (c), FR-472, FR-474 to FR-478, FR-480, FR-486, FR-493, FR-495 (the administrator's review queue, disputes queue and ruling, a ruling's revision and an outcome's correction, the compensation-case queue and its closings, a suspended student's case, and the manual case; T033, T034, T059, T035, T036, T064 of specs/004-sessions, B39): `review.service.ts`, `review.repository.ts`, `telemetry.ts`, `admin-outcome.service.ts`, `admin-outcome.repository.ts`, `dispute-queue.service.ts`, `dispute-queue.repository.ts`, `dispute-resolution.service.ts`, `disputes-admin.router.ts`, `revision.service.ts`, `revision.repository.ts`, `ruling-revision.ts`, `case-queue.service.ts`, `case-covers.repository.ts`, `case-closing.service.ts`, `cases-admin.router.ts`, `suspension-case.service.ts`, `suspension-case.repository.ts`, `manual-case.service.ts`.
