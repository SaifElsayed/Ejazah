// T073 of specs/004-sessions/tasks.md (FR-507; SRS FR-CANCEL-8 as amended on 2026-11-12, DEC-66;
// the note under T073, Q4 (a), Q6 (a), N3): payments' answer to the restore's `EnrollmentPayments`
// port (`apps/api/src/modules/sessions/enrollment-payments.port.ts`), since sessions reads no
// payment table (R-301). A refund at the gateway and the sessions are never both given back.
//
// 003:T102 (Q-3 (a), the owner's decision of 2026-11-18; the review of 9a5d39a4, point 2): a partial
// refund leaves its order `paid`, so the answer is true once any refund is recorded: an order
// `refunded`, or an order whose refunded total is above 0. The status branch keeps a whole refund
// recorded before the total existed, whatever its total holds.
//
// THE READ, WITH NO LOCK (N3). The restore calls it on its transaction, holding the enrollment's
// row lock; every order event takes the enrollment's lock before the order's (`order-events.service.ts`,
// «ONE TRANSACTION»), so no refund is recorded on the enrollment's orders before the restore commits.
// One statement over `payments_enrollment_id_idx`, bounded by the enrollment's orders.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'payment'>;

/** Whether any gateway order of the enrollment has a refund recorded (Q-3 (a)), read with no lock (N3). */
export async function refundedOf(tx: Client, enrollmentId: string): Promise<boolean> {
  const refunded = await tx.payment.findFirst({
    where: { enrollmentId, OR: [{ status: 'refunded' }, { refundedPiasters: { gt: 0n } }] },
    select: { id: true },
  });
  return refunded !== null;
}
