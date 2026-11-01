# Contract: The gateway boundary (Phase 2)

## The payment port, as this phase calls it

`PaymentPort` (`apps/api/src/platform/ports/payment/payment.port.ts`) is unchanged in shape (ARCHITECTURE §3.5):

| Operation | Called by | When |
|---|---|---|
| `createCheckout(enrollmentId, gross_piasters, currency, latestExpiry)` → `{ gatewayOrderId, checkoutUrl, expiresAt }` | `checkout.pay`, `checkout.retry` | Outside any transaction; `latestExpiry` = the hold's expiry minus the grace (FR-355) |
| `cancelCheckout(gatewayOrderId)` → `'cancelled' \| 'paid' \| 'in_progress' \| 'unsupported'` | `checkout.hold` over an unexpired hold with a payable order (FR-BOOK-12 (b)); `checkout.pay` when the hold was lost meanwhile | Outside any transaction |
| `verifyAndParseEvent(rawBody, headers)` → `GatewayEvent` | the webhook | Before any handler (R-MONEY-9) |

## The webhook's order branch (R-214)

`POST /webhooks/payment` (Phase 1's route) now handles order events:

1. Verify the signature on the raw body; refuse with 401 and write nothing on a wrong or missing signature or a body
   changed after signing (FR-372).
2. In one transaction: insert `payment_events` (unique `provider_event_id`; a duplicate answers 200 and writes nothing, but a duplicate `paid`
   event still enqueues step 3's job, so an enqueue lost after a commit is recovered);
   move `payments.status` monotonically (data-model §3); on `paid`, record the transaction id, fee and net as reported;
   on `failed`, append the `order_failed` outcome through `booking.recordOrderFailed` (booking's table); clear `checkout_url_encrypted` when the order leaves `created`.
3. After commit, on `paid`: enqueue `confirm-enrollment({ paymentId })` with the job id `paymentId`.
4. Answer 200 `{ received: true }`.

An order event for an unknown `gatewayOrderId` cannot be recorded, since ERD rule 20 forbids an order event without
its `payment_id`; it is answered 200, written nowhere, and reported to error tracking, as Phase 1 did for every order
event.

## The stand-in's hosted page (development and test only)

Served by the API only while `PAYMENT_GATEWAY=fake`; the route does not exist otherwise.

| Route | What |
|---|---|
| `GET /stand-in/checkout/:gatewayOrderId` | A plain page: the amount, «ادفع», «فشل الدفع», «إلغاء». An unknown or no-longer-payable order shows that it cannot be paid |
| `POST /stand-in/checkout/:gatewayOrderId` with `action=pay\|fail\|cancel` | Signs the matching event (`paid` with a transaction id, fee and net the stand-in reports; `failed`; `failed` for cancel) with the stand-in's secret and sends it over HTTP to `POST /webhooks/payment` at the API's base URL; then a page with a link to `ijazah://checkout/return` |

`checkoutUrl` returned by the stand-in's `createCheckout` is this page's address on `API_PUBLIC_ORIGIN`.

## The test harness (`tests/support/gateway-stand-in.ts`)

The only way a spec produces a gateway event (SC-302). It holds the stand-in's secret and the listening app's address.

| Call | Effect |
|---|---|
| `paid(order, { fee_piasters?, net_piasters? })`, `failed(order)`, `expired(order)`, `recipientVerified(ref)`, `recipientRejected(ref, reason)` | Build the signed event with a fresh provider event id |
| `deliver(event)` | POST it over HTTP; resolves with the status code |
| `deliverTwice(event)` | The same body and id twice |
| `deliverInOrder([e1, e2, …])` | In the order given, whatever order they happened in |
| `tamper(event, 'wrong_secret' \| 'no_signature' \| 'body_changed')` | A forged variant |
| `onCancel(order, outcome)` | What the stand-in's `cancelCheckout` will answer for that order |

`scripts/dev/emit-recipient-event.ts` is rewritten on the harness; `recipient-events.spec.ts`'s hand-built events move
onto it.
