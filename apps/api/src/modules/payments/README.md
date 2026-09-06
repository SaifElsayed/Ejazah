# payments

## Owns

`payments, payment_events`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Hold, route, balance, transfer or refund money; the gateway settles directly to the teacher and the platform takes 0% (FR-PAYG-1, FR-PAYG-10). Compute a net amount; record what the gateway reported (R-MONEY-5). Act on an event before its signature is verified on the raw body (R-MONEY-9) and its provider event id is persisted under the unique NOT NULL column (R-MONEY-8). Confirm an enrollment from a client redirect, a manual toggle, an admin action or an upload; the only path is the persisted paid event and the idempotent `confirm-enrollment` job (R-HONEST-1, FR-PAYG-8). Write `enrollments` or `teacher_profiles` directly; go through `booking` and `identity` public entries (R-API-6). Store a raw payout account number; only the gateway's recipient reference, encrypted (R-DB-8).

## Shape

`payments.service.ts` holds every rule. `payments.repository.ts` holds every query. `payments.router.ts` is thin (student: start checkout; teacher: payout setup and status; admin: read-only monitor). `payments.webhook.ts` is the raw-body HTTP endpoint outside tRPC, guarded by `platform/guards/webhook-signature.guard.ts`. Jobs: `confirm-enrollment`, `expire-pending-payments`. Arrives with Phase 2 (checkout, confirmation) and Phase 1 (payout onboarding).

## Requirement ids

`SRS-PAY-*`: FR-PAYG-1 to FR-PAYG-16, FR-ADMIN-18, section 3.6. _Filled as they land._
