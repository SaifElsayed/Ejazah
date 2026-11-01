# Contract: The administrator surface (Phase 2)

Mounted on `adminRouter` as `payments` (research R-220). `adminProcedure`: a signed-in administrator with the second
factor (NFR-SEC-6, FR-ADMIN-1); every call writes its audit entry, reads included, as Phase 1's document viewer does.
Nothing here writes anything else (FR-401).

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `payments.list` | `{ status?: 'created' \| 'paid' \| 'failed' \| 'expired' \| 'refunded', search?, cursor? }` | `{ items: [{ paymentId, gatewayOrderId, createdAt, student: { displayName }, gross_piasters, gatewayFee_piasters?, net_piasters?, status, enrollmentCancelled }], nextCursor? }` | `payments.listed`, no target | Newest first, pages of `admin_list_page_size`; `search` matches an order id exactly or a student's folded name by prefix (R-203); fee and net absent until paid (FR-PAYG-7) |
| `payments.get` | `{ paymentId }` | `{ gatewayOrderId, gatewayTransactionId?, status, gross_piasters, gatewayFee_piasters?, net_piasters?, currency, student: { displayName }, enrollment: { enrollmentId, summary, teacher: { displayName }, status, cancellationReason?, completed, total }, events: [{ eventType, receivedAt }], outcomes: [{ kind, cancellationReason?, occurredAt }] }` | `payments.viewed`, target the order | The timeline is `payment_events` and `enrollment_events` in order, rendered in plain language by the panel |

Amounts are what the gateway reported (R-MONEY-5): the panel formats them with two decimals and never computes one
from another. No procedure moves, holds, refunds or confirms money or an enrollment, and none will (FR-PAYG-8,
FR-PAYG-11).
