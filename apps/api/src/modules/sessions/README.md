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

## Requirement ids

`SRS-SES-*`: `FR-SESS-*`, `FR-NOSHOW-*`, `FR-CANCEL-*`, section 3.7.5. _Filled as they land._

- FR-368, FR-369 (an enrollment's sessions at the slot's local time in consecutive weeks, the first at least `first_session_lead_hours` after the confirmation, each resolved on its own; R-209, ADR 0009 D1 and D2): `generation.service.ts`, `sessions.repository.ts`.
- FR-370, FR-SESS-20 (the cached instants recomputed when time zone rules change, an overlap restored to its previous instants; R-210, ADR 0009 D3): `reresolution.service.ts`, `reresolution.repository.ts`.
- FR-394, FR-BOOK-10 (an enrollment's final session's date, for a slot's release; R-205): `sessions.repository.ts`.
- FR-351, FR-BOOK-5 (the parties' sessions the one overlap check reads): `sessions.repository.ts`.
- FR-386, FR-393 (an enrollment's sessions as `checkout.status` shows them): `sessions.repository.ts`.
- FR-392, R-DB-4 (an enrollment's upcoming, completed and remaining sessions, derived on read; consumed are `done` and `student_no_show`): `progress.ts`. FR-390, FR-391 (the sessions of some enrollments and of a teacher's day, for booking's lists): `sessions.repository.ts`.
- FR-431, FR-432, FR-434, FR-435, FR-482, FR-494, FR-499, R-GENDER-7, R-SESS-5 (a session read by its party, and the join from `startsAt − early_join_lead_minutes` until `endsAt`, for a `scheduled` session, both accounts active, the teacher approved, both of one gender, read under both accounts' locks, a token bound to the session and the caller until the scheduled end; T011 of specs/004-sessions): `sessions.service.ts`, `sessions.repository.ts`, `sessions.router.ts`.
