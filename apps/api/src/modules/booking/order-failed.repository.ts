// T038 (R-214, R-216, FR-385): the `order_failed` outcome of an enrollment, appended when the payments
// module's order branch moves one of its orders to `failed`. `enrollment_events` is booking's table
// (R-API-6), so payments appends it through booking's entry, on its own transaction. The row names
// the order by its id alone: booking never reads a `payments` row.
//
// Its own file until B29's integration makes booking's one writer of `enrollment_events` rows (the
// note under T038): T033, T038, T039 and T040 each append one.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/**
 * Appends `order_failed` for the enrollment, naming the order that failed, at `occurredAt`. The
 * caller holds the enrollment's row and then the payment's (`lockRows`, T005's order), and moved the
 * order to `failed` in the same transaction.
 */
export async function recordOrderFailed(
  tx: Pick<Transaction, 'enrollmentEvent'>,
  enrollmentId: string,
  paymentId: string,
  occurredAt: Date,
): Promise<void> {
  await tx.enrollmentEvent.create({
    data: { enrollmentId, kind: 'order_failed', paymentId, occurredAt },
    select: { id: true },
  });
}
