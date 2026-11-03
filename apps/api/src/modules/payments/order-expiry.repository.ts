// T040 (FR-364, FR-PAYG-6, R-215; ARCHITECTURE §8.1; PR #109's review, M2 and round 2 N1): what the
// `expire-pending-payments` sweep reads and writes of payments' rows, each on the caller's
// transaction.
//
// MARKING AN ORDER EXPIRED. A `created` order past its `expires_at` (written at its creation, FR-355)
// moves to `expired`, and its hosted page's address, kept only while the order is `created`, is
// cleared, as every move clears it (data-model §2.4). The orders' rows are locked first, in id order
// in one statement (T005's rule 2, payments last in the order and nothing taken after them), and the
// move is one conditional update that reads the status and the expiry again under the lock (rule 1):
// an order a paid event moved meanwhile is left as it is. The enrollment is not locked: nothing of it
// is read or written, and the webhook's branch, which takes the enrollment and then the order, only
// ever waits here, never the other way round (the lock-order note under T040).
//
// A PAID ORDER TO HAND ON. A page, in id order, of the `paid` orders whose first `paid` event was
// recorded (`payment_events.created_at`, the database's clock, as the confirm job reads it) at or
// before the caller's instant, with each one's enrollment; read with no lock, the confirm job
// deciding under its own. Which of them still await confirmation is booking's and moderation's
// answer, asked by the sweep through their entries (R-API-6).
//
// Every page is at most `limit` rows after the caller's cursor; no new index (R-DB-9): a page scans
// the orders by their primary key.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'payment'>;

/** A `created` order's ids past their expiry at `at`, in id order after `after`, at most `limit`. */
export async function expiredOrderIds(
  tx: Client,
  at: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const rows = await tx.payment.findMany({
    where: {
      status: 'created',
      expiresAt: { lte: at },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/**
 * Marks those of `paymentIds` still `created` and past their expiry at `at` expired, clearing their
 * hosted page's address; locks the orders first (this file's head). The caller holds no lock after
 * the payments' place in T005's order.
 */
export async function markOrdersExpired(
  tx: Transaction,
  paymentIds: readonly string[],
  at: Date,
): Promise<void> {
  if (paymentIds.length === 0) return;
  const ids = [...new Set(paymentIds)].sort();
  await lockRows(tx, 'payments', ids);
  await tx.payment.updateMany({
    where: { id: { in: ids }, status: 'created', expiresAt: { lte: at } },
    data: { status: 'expired', checkoutUrlEncrypted: null },
  });
}

/** A paid order, its enrollment, and when its first paid event was recorded (as `paidOrderOf`). */
export interface PaidOrderRef {
  readonly paymentId: string;
  readonly enrollmentId: string;
  readonly paidRecordedAt: Date | null;
}

/**
 * A page of the `paid` orders whose paid event was recorded at or before `recordedBefore`, in id
 * order after `after`, at most `limit`, each with its enrollment and its first paid event's record.
 */
export async function paidOrdersRecordedBefore(
  tx: Client,
  recordedBefore: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly PaidOrderRef[]> {
  const rows = await tx.payment.findMany({
    where: {
      status: 'paid',
      events: { some: { eventType: 'paid', createdAt: { lte: recordedBefore } } },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      enrollmentId: true,
      events: {
        where: { eventType: 'paid' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  return rows.map(({ id, enrollmentId, events }) => ({
    paymentId: id,
    enrollmentId,
    paidRecordedAt: events[0]?.createdAt ?? null,
  }));
}
