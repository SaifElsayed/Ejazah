# Gateway: the programme's additions to `PaymentPort`

| Member | Shape | Notes |
|---|---|---|
| `createCheckout` (changed) | adds `options?: { saveCard: boolean }` | when true and the saved-card integration is configured, the intention asks the gateway to save the card |
| `chargeSavedCard` (new) | `(paymentId, gross: Piasters, currency, cardToken, payee?) → Promise<{ gatewayOrderId }>` | a merchant-initiated charge on the saved-card (Moto) integration with the split. Called once, after the order is recorded `created`, never under a database lock and never again for the same order; the merchant reference is `paymentId`, and the webhook is matched by it when the order has no gateway id yet. The result arrives by the webhook |
| `GatewayEvent` `failed` (changed) | adds `declineKind: 'soft' \| 'hard'` | mapped from the response code by a table; unknown → `hard` |
| `GatewayEvent` `card_saved` (new) | `{ gatewayOrderId, token, last4, brand }` | from the gateway's token callback; recorded as `payment_event_type` `card_saved`, provider event id `paymob:<txId>:token`; never logged |

**Live adapter, until the gateway's written answers (OPEN-11, DEC-92):**
- With no saved-card integration id configured, `saveCard` is ignored and `chargeSavedCard` rejects
  (`unsupported`).
- A token callback whose signature cannot be verified is refused.

**Fake adapter:** implements both, with stand-in helpers that answer paid, a soft decline or a hard decline.

To confirm in writing before live:
- the Moto integration id;
- `split_amounts` on such an intention;
- the token's issue on the first 3DS payment and its callback's HMAC;
- the merchant reference returned in the transaction callback (the match for an order with no gateway id);
- duplicate refusal by the merchant reference;
- fees on a declined attempt;
- the soft and hard codes.
