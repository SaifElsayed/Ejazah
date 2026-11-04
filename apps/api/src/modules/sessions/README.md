# sessions

## Owns

`sessions, session_participant_events, cancellation_requests`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Accept attendance from the client; provider webhooks into `session_participant_events` only (R-SESS-1). Evaluate a session as a webhook reaction; the scheduled job at `scheduled_end + 2m` does it (R-SESS-2). Settle before scheduled end (R-SESS-3). Penalise a reconnection (R-SESS-4). Let a suspended, revoked or banned teacher join (R-SESS-5). Auto-resolve `under_threshold` or `provider_outage` (R-SESS-6). Resolve a session instant outside `packages/time` (R-TIME-1). Reference a price, a payment record or any payment concept (R-MONEY-6, ADR 0007).

## Shape

`sessions.service.ts` holds every rule. `sessions.repository.ts` holds every query. `sessions.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Session generation is exposed here for `booking` to call when the `confirm-enrollment` job confirms an enrollment on the gateway’s paid event (FR-PAYG-5). Arrives with Phase 2 (generation) and Phase 3 (lifecycle).

## Requirement ids

`SRS-SES-*`: `FR-SESS-*`, `FR-NOSHOW-*`, `FR-CANCEL-*`, section 3.7.5. _Filled as they land._

- FR-392, R-DB-4 (an enrollment's upcoming, completed and remaining sessions, derived on read; consumed are `done` and `student_no_show`): `progress.ts`. FR-390, FR-391 (the sessions of some enrollments and of a teacher's day, for booking's lists): `sessions.repository.ts`.
