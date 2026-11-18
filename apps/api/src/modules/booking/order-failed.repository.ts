// T038 (R-214, R-216, FR-385): the `order_failed` outcome of an enrollment, appended when the payments
// module's order branch moves one of its orders to `failed`. `enrollment_events` is booking's table
// (R-API-6), so payments appends it through booking's entry, on its own transaction. The row names
// the order by its id alone: booking never reads a `payments` row. It is written by booking's one
// writer of `enrollment_events` rows (`enrollment-events.repository.ts`, T033), as B29's
// integration made it (the note under T038). 005:T016 of specs/005-certification: its push,
// `payment_failed`, through the notice port the caller passes, on the same transaction.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { recordEnrollmentEvents } from './enrollment-events.repository.js';
import type { PaymentOutcomeNotices } from './payment-outcome-notices.port.js';

/**
 * Appends `order_failed` for the enrollment, naming the order that failed, at `occurredAt`. The
 * caller holds the enrollment's row and then the payment's (`lockRows`, T005's order), and moved the
 * order to `failed` in the same transaction.
 */
export async function recordOrderFailed(
  tx: Transaction,
  enrollmentId: string,
  paymentId: string,
  occurredAt: Date,
  notices: PaymentOutcomeNotices,
): Promise<void> {
  await recordEnrollmentEvents(
    tx,
    [{ kind: 'order_failed', enrollmentId, paymentId, occurredAt }],
    notices,
  );
}
