// 003:T110 (ADR 0025 D4; the note under T110): the one query of a compensation case's amount over
// payments' own table (`payments`, R-API-6): the enrollment's paid orders with a teacher's share, in
// id order. Bounded by one enrollment, over `payments_enrollment_id_idx`; no lock: the amount is a
// figure an administrator reads, decides on and executes by hand (DEC-82).
import { piasters } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { CaseOrder } from './case-amount.rules.js';

/** The statuses of an order the gateway was paid on (a refunded one included, T102). */
const PAID_STATUSES = ['paid', 'refunded'] as const;

/**
 * The enrollment's paid orders with a share, oldest first by their time-ordered id, each with its
 * kind and an instalment's month (006:T012, R-512); an order from
 * before the commission (no share, rule 52's pair) is left out, as the releases leave it out.
 */
export async function caseOrdersOf(
  tx: Pick<Transaction, 'payment'>,
  enrollmentId: string,
): Promise<readonly CaseOrder[]> {
  const rows = await tx.payment.findMany({
    where: {
      enrollmentId,
      status: { in: [...PAID_STATUSES] },
      teacherSharePiasters: { not: null },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      kind: true,
      instalmentMonth: true,
      grossPiasters: true,
      teacherSharePiasters: true,
      refundedPiasters: true,
    },
  });
  return rows.flatMap(
    ({ id, kind, instalmentMonth, grossPiasters, teacherSharePiasters, refundedPiasters }) =>
      teacherSharePiasters === null
        ? []
        : [
            {
              paymentId: id,
              kind,
              instalmentMonth,
              paid_piasters: piasters(Number(grossPiasters)),
              share_piasters: piasters(Number(teacherSharePiasters)),
              refunded_piasters: piasters(Number(refundedPiasters)),
            },
          ],
  );
}
