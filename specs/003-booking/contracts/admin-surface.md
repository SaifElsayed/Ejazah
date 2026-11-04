# Contract: The administrator surface (Phase 2)

Mounted on `adminRouter` as `payments` (research R-220). `adminProcedure`: a signed-in administrator with the second
factor (NFR-SEC-6, FR-ADMIN-1); every call writes its audit entry, reads included, as Phase 1's document viewer does.
Nothing here writes anything else (FR-401).

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `payments.list` | `{ status?: 'created' \| 'paid' \| 'failed' \| 'expired' \| 'refunded', search?, cursor? }` | `{ items: [{ paymentId, gatewayOrderId, createdAt, student: { displayName }, gross_piasters, gatewayFee_piasters?, net_piasters?, status, enrollmentCancelled }], nextCursor? }` | `payments.listed`, target the reading administrator | Newest first, pages of `admin_list_page_size`; `search` matches an order id exactly or a student's folded name by prefix (R-203); fee and net absent until the gateway reports them, a paid order included (FR-PAYG-7); `enrollmentCancelled` only on a paid order |
| `payments.get` | `{ paymentId }` | `{ paymentId, gatewayOrderId, gatewayTransactionId?, status, createdAt, gross_piasters, gatewayFee_piasters?, net_piasters?, currency, student: { displayName }, enrollment?: { enrollmentId, summary, teacher: { displayName }, status, cancellationReason?, completed, total }, events: [{ eventType, receivedAt }], outcomes: [{ kind, cancellationReason?, occurredAt }], paidOrders: [{ paymentId, gatewayOrderId, status, createdAt }] }` | `payments.viewed`, target the order (`payment`) | The timeline is `payment_events` and `enrollment_events` in order, rendered in plain language by the panel; `outcomes` are this order's confirmation or failure and any cancellation of the enrollment; `enrollment` is absent only for a soft-deleted enrollment; `paidOrders` are every order of the enrollment the gateway reported paid (`paid` or `refunded`), oldest first, since a compensation case covers each and records none (the note under T052) |

Amounts are what the gateway reported (R-MONEY-5): the panel formats them with two decimals and never computes one
from another. No procedure moves, holds, refunds or confirms money or an enrollment, and none will (FR-PAYG-8,
FR-PAYG-11).
