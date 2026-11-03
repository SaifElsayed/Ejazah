# payments

## Owns

`payments, payment_events`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Hold, route, balance, transfer or refund money; the gateway settles directly to the teacher and the platform takes 0% (FR-PAYG-1, FR-PAYG-10). Compute a net amount; record what the gateway reported (R-MONEY-5). Act on an event before its signature is verified on the raw body (R-MONEY-9) and its provider event id is persisted under the unique NOT NULL column (R-MONEY-8). Confirm an enrollment from a client redirect, a manual toggle, an admin action or an upload; the only path is the persisted paid event and the idempotent `confirm-enrollment` job (R-HONEST-1, FR-PAYG-8). Write `enrollments` or `teacher_profiles` directly; go through `booking` and `identity` public entries (R-API-6). Store a raw payout account number; only the gateway's recipient reference, encrypted (R-DB-8).

## Shape

`payments.service.ts` holds every rule. `payments.repository.ts` holds every query. `payments.router.ts` is thin (student: start checkout; admin: read-only monitor); payout setup and its status are the identity module's `teacher.payout` (research R-121). `webhook.controller.ts` is the raw-body HTTP endpoint outside tRPC, `POST /webhooks/payment` (T077), verified through `platform/guards/webhook-signature.guard.ts`'s `verifyInboundEvent`; `recipient-events.service.ts` records a signed payout-recipient event and hands its verdict to `identity`'s entry in the same transaction (research R-114, R-121). `order-standing.repository.ts` (T033) answers booking's release of a hold whether an enrollment has a `paid` order and whether its last order failed, locking the orders after the caller's enrollments (FR-363). Jobs: `confirm-enrollment`, `expire-pending-payments`. Arrives with Phase 2 (checkout, confirmation) and Phase 1 (the recipient events).

## Requirement ids

`SRS-PAY-*`: FR-PAYG-1 to FR-PAYG-18, FR-ADMIN-18, section 3.6. _Filled as they land._

- FR-PAYG-4, FR-PAYG-15, FR-191 (Phase 1, T077): the webhook, and the recipient events recorded once and routed to the teacher by the reference's hash.
- FR-360, FR-365, FR-367 (Phase 2, T038; R-214): `order-events.service.ts`, the webhook's order branch. In one transaction, the order's enrollment and then the order locked (T005's order), the event recorded under its unique provider event id with the body's hash, the order moved monotonically (`created` to `paid`, `failed` or `expired`; `failed` or `expired` to `paid`; `paid` to `refunded` only) with the transaction id, fee and net as reported on `paid`, the address cleared, and a failed order's `order_failed` outcome appended through booking's `recordOrderFailed`; after commit, every paid event of a known order, a replay included, enqueues `confirm-enrollment` under the job id `paymentId` (bound by `main.ts`). An order no row holds is acknowledged, written nowhere and reported.
- FR-351 to FR-357, FR-BOOK-12 (Phase 2, T036; R-208, ARCHITECTURE §8.1): `checkout.service.ts` and `checkout.router.ts`, the student's `checkout.hold`, `checkout.pay` and `checkout.retry`. Keyed in two steps (the owner's decision of 2026-11-03): the key read first, a completed one answered from its outcome with no gateway call; the gateway's order created outside any transaction and recorded under the key, the order a duplicate made unnecessary or the transaction refused cancelled at the gateway; the stored outcome holds no address, read again from `checkout_url_encrypted` while the order is `created` and unexpired. Booking's holds and enrollments are written through its entry (`placeCheckoutHold`, `payTargetOf`, `enrollOnHold`, `lockOrderTarget`).
