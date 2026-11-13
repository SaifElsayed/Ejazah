// T073 of specs/004-sessions/tasks.md (FR-507; SRS FR-CANCEL-8 as amended on 2026-11-12, DEC-66;
// the note under T073, Q4 (a), Q6 (a), N3): payments' answer to the restore's `EnrollmentPayments`
// port (`apps/api/src/modules/sessions/enrollment-payments.port.ts`), since sessions reads no
// payment table (R-301). A refund at the gateway and the sessions are never both given back.
//
// THE READ, WITH NO LOCK (N3). The restore calls it on its transaction, holding the enrollment's
// row lock; every order move takes the enrollment's lock before the order's (`order-events.service.ts`,
// «ONE TRANSACTION»), so no order moves to `refunded` before the restore commits. One statement over
// `payments_enrollment_id_idx`, bounded by the enrollment's orders.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'payment'>;

/** Whether any gateway order of the enrollment is `refunded` (Q4 (a)), read with no lock (N3). */
export async function refundedOf(tx: Client, enrollmentId: string): Promise<boolean> {
  const refunded = await tx.payment.findFirst({
    where: { enrollmentId, status: 'refunded' },
    select: { id: true },
  });
  return refunded !== null;
}
