# Gateway: the programme's additions to `PaymentPort`

| Member | Shape | Notes |
|---|---|---|
| `createCheckout` (changed) | adds an optional sixth argument `saveCard?: boolean` | true only when the order carries the student's consent; Paymob takes no intention field for it (the customer saves the card on Paymob's page), so a card is written only for an order carrying `card_consent_at` (R-510) |
| `chargeSavedCard` (new) | `(paymentId, gross: Piasters, currency, latestExpiry, cardToken, payee, recordOrder: (gatewayOrderId) => Promise<boolean>) → Promise<SavedCardCharge>` | two gateway steps (SRS DEC-113 (2)): the intention on the Moto integration, carrying `split_amounts`; its id handed to `recordOrder`, which writes it on the platform's order in its own short transaction; then the token payment, sent only when `recordOrder` answered true, once, never again. Answers `order_unanswered` (the intention unanswered: a soft decline at once, no inquiry), `order_not_recorded`, or `payment_sent`. Throws `ChargeRefusedError` before any request: `no_payee` (live mode, no payee, as `createCheckout`) or `charge_off` (no Moto integration id or no API key); the order is then recorded `failed`, `declineKind` `hard`, no gateway id, no push, no retry. Called after the order is recorded `created`, never under a database lock. The result arrives by the signed callback, matched by the signed `order.id`, or by `inquireOrder` |
| `inquireOrder` (new) | `(gatewayOrderId) → Promise<OrderInquiry>` | asks the gateway by the order's own id (DEC-110, DEC-113 (1)): `transaction` (a final `paid` or `failed` event, with the callback's provider event id), `none`, or `no_answer`. Paymob: a fresh auth token from `PAYMENT_GATEWAY_API_KEY` per ask; anything not final or unreadable is `no_answer`; off without the key |
| `GatewayEvent` `failed` (changed) | adds an optional `declineKind: 'soft' \| 'hard'` | set only from `inquireOrder`'s authenticated answer, never from a callback (its response codes are outside the HMAC): Visa's Category 2 codes are `soft`, every other or unknown code `hard`, an answer with no code `hard` (Q-10 (a) adjusted) |
| `GatewayEvent` `card_saved` (new) | `{ gatewayOrderId, token, last4, brand }` | from the gateway's token callback; recorded as `payment_event_type` `card_saved`, provider event id `paymob:<obj.id>:token`; never logged |

**Live adapter, until the gateway's written answers (OPEN-11, DEC-92):**
- With no saved-card integration id configured (`PAYMENT_GATEWAY_SAVED_CARD_INTEGRATION_ID`), a token callback is
  refused after its signature is checked. With no Moto integration id or no API key, `chargeSavedCard` throws
  `ChargeRefusedError('charge_off')` and `inquireOrder` answers `no_answer`.
- A token callback whose signature cannot be verified is refused.

**Fake adapter:** implements both, with stand-in helpers that answer paid, a soft decline or a hard decline.

To confirm in writing before live:
- the Moto integration id;
- `split_amounts` on such an intention;
- the token's issue on the first 3DS payment and its callback's HMAC;
- the inquiry's answers (its «no transaction» answer, where `acq_response_code` sits), the pay call's answer and its
  authorisation, and the auth token's lifetime (the merchant reference is never trusted: DEC-113 (2));
- fees on a declined attempt;
- the soft and hard codes.
