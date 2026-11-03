// T033 (FR-363, FR-PAYG-6, ADR 0010 D7; the owner's decision of 2026-11-03): what booking's release
// of a hold needs of an enrollment's gateway orders, answered by the module that owns them, since
// booking never reads a `payments` row (R-API-6) and never imports this module (R-208). Whether one
// order is `paid` (the enrollment then stays awaiting payment, for `confirm-enrollment`), and
// whether the last one failed (an expiry then cancels it `payment_failed`, else `payment_expired`).
//
// THE LOCK (T005's rules 1 and 2). The caller holds the enrollments' rows; this finds their orders,
// locks them in one `lockRows(tx, 'payments', ids)` call in id order, and reads their state again
// under the lock. An order cannot be added meanwhile: its insert references a locked enrollment.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { OrderStanding } from '../booking/index.js';

/**
 * Of `enrollmentIds`, each one's order standing; an enrollment with no order is absent. Expects the
 * caller to hold the enrollments' locks; takes the orders' after them.
 */
export async function orderStandingsOf(
  tx: Transaction,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, OrderStanding>> {
  const standings = new Map<string, OrderStanding>();
  if (enrollmentIds.length === 0) return standings;
  const where = { enrollmentId: { in: [...enrollmentIds] } };
  const found = await tx.payment.findMany({ where, orderBy: { id: 'asc' }, select: { id: true } });
  if (found.length === 0) return standings;
  await lockRows(
    tx,
    'payments',
    found.map(({ id }) => id),
  );
  const orders = await tx.payment.findMany({
    where,
    orderBy: { id: 'asc' },
    select: { enrollmentId: true, status: true },
  });
  // In id order, a UUIDv7's creation order, so the last order an enrollment meets is its latest.
  for (const { enrollmentId, status } of orders) {
    const paid = standings.get(enrollmentId)?.paid === true || status === 'paid';
    standings.set(enrollmentId, { paid, lastFailed: status === 'failed' });
  }
  return standings;
}
