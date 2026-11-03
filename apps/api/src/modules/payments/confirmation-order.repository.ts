// T039 (R-215, FR-361, FR-375; the note under T035): what the `confirm-enrollment` job reads of the
// paid order it was enqueued for, answered by the module that owns `payments` and `payment_events`
// (R-API-6). Queries only, each on the caller's transaction.
//
// THE LOCK (the note under T039, T005's order). The order's enrollment is read first with no lock,
// an order's enrollment never changing; the job then takes its locks in the one order through
// booking's `lockForConfirmation`, which locks the enrollment's orders after it through
// `orderStandingsOf`, and only then reads the order's status and its paid event here.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { OrderStatus } from './payments.repository.js';

type Client = Pick<Transaction, 'payment' | 'paymentEvent'>;

/** The order's enrollment, read with no lock; null when no order has the id. */
export async function orderEnrollmentOf(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
): Promise<string | null> {
  const order = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { enrollmentId: true },
  });
  return order?.enrollmentId ?? null;
}

/** The order as the confirm job decides on it. */
export interface PaidOrder {
  readonly status: OrderStatus;
  /**
   * When its first `paid` event was recorded (`payment_events.created_at`, the database's clock),
   * or null when none was: a compensation case opened after it covers the order (the note under
   * T035).
   */
  readonly paidRecordedAt: Date | null;
}

/** The order's status and its first paid event's record; the caller holds the order's lock. */
export async function paidOrderOf(tx: Client, paymentId: string): Promise<PaidOrder> {
  const [order, paid] = await Promise.all([
    tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } }),
    tx.paymentEvent.findFirst({
      where: { paymentId, eventType: 'paid' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);
  return { status: order.status, paidRecordedAt: paid?.createdAt ?? null };
}
