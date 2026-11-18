// T073 of specs/004-sessions/tasks.md (FR-507; the note under T073, Q4 (a), N3): payments' answer to
// the restore's `EnrollmentPayments` port, one read of the enrollment's orders with no lock. Since
// 003:T102 (Q-3 (a); the review of 9a5d39a4, point 2) it answers true once any refund is recorded: an
// order `refunded` (a whole refund, T073's recorded before the total existed included) or an order
// whose refunded total is above 0 (a partial refund, still `paid`). Over the real tables:
// `tests/db-integrity/restore.spec.ts` (a refunded order refuses the restore, writing nothing) and
// `tests/payments/order-events.spec.ts` (a partial refund through the webhook).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { refundedOf } from './enrollment-refund.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e0e1';
const OTHER = '0199d0a0-0000-7000-8000-00000000e0e2';

interface Row {
  readonly id: string;
  readonly enrollmentId: string;
  readonly status: string;
  readonly refundedPiasters: bigint;
}

interface Where {
  readonly enrollmentId?: string;
  readonly status?: string;
  readonly refundedPiasters?: { readonly gt: bigint };
  readonly OR?: readonly Where[];
}

/** The filter Prisma applies, for the fields this read names; any other field fails the case. */
function matches(row: Row, where: Where): boolean {
  for (const [field, condition] of Object.entries(where)) {
    if (field === 'OR') {
      if (!(condition as readonly Where[]).some((branch) => matches(row, branch))) return false;
    } else if (field === 'enrollmentId' || field === 'status') {
      if (row[field] !== condition) return false;
    } else if (field === 'refundedPiasters') {
      if (!(row.refundedPiasters > (condition as { gt: bigint }).gt)) return false;
    } else {
      throw new Error(`the read names a field this double does not know: ${field}`);
    }
  }
  return true;
}

function orders(rows: readonly Row[]) {
  const calls: unknown[] = [];
  const client = {
    payment: {
      findFirst: async (args: { where: Where; select: { id: true } }) => {
        calls.push(args);
        const found = rows.find((row) => matches(row, args.where));
        return found === undefined ? null : { id: found.id };
      },
    },
  } as unknown as Pick<Transaction, 'payment'>;
  return { client, calls };
}

const order = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: `0199d0a0-0000-7000-8000-00000000e0p${String(n)}`,
  enrollmentId: ENROLLMENT,
  status: 'paid',
  refundedPiasters: 0n,
  ...overrides,
});

describe('refundedOf (T073, FR-507, Q4 (a); 003:T102, Q-3 (a))', () => {
  it('answers true when an order of the enrollment is refunded, its total the gross', async () => {
    const { client, calls } = orders([order(1, { status: 'refunded', refundedPiasters: 25_000n })]);
    expect(await refundedOf(client, ENROLLMENT)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('answers true for a whole refund recorded before the total existed (status refunded, total 0)', async () => {
    const { client } = orders([order(1, { status: 'refunded', refundedPiasters: 0n })]);
    expect(await refundedOf(client, ENROLLMENT)).toBe(true);
  });

  it('answers true after a partial refund, the order still paid', async () => {
    const { client } = orders([order(1, { refundedPiasters: 7_500n })]);
    expect(await refundedOf(client, ENROLLMENT)).toBe(true);
  });

  it('answers false when no order of the enrollment is refunded in whole or part', async () => {
    const { client, calls } = orders([
      order(1),
      order(2, { status: 'failed' }),
      order(3, { enrollmentId: OTHER, status: 'refunded', refundedPiasters: 25_000n }),
      order(4, { enrollmentId: OTHER, refundedPiasters: 100n }),
    ]);
    expect(await refundedOf(client, ENROLLMENT)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
