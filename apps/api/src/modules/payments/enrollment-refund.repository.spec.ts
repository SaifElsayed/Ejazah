// T073 of specs/004-sessions/tasks.md (FR-507; the note under T073, Q4 (a), N3): payments' answer to
// the restore's `EnrollmentPayments` port, one read of the enrollment's orders with no lock: any order
// `refunded` answers true. Over the real tables: `tests/db-integrity/restore.spec.ts` (a refunded
// order refuses the restore, writing nothing).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { refundedOf } from './enrollment-refund.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e0e1';

function recorded(found: { id: string } | null) {
  const calls: unknown[] = [];
  const client = {
    payment: {
      findFirst: async (args: unknown) => {
        calls.push(args);
        return found;
      },
    },
  } as unknown as Pick<Transaction, 'payment'>;
  return { client, calls };
}

const ASKED = { where: { enrollmentId: ENROLLMENT, status: 'refunded' }, select: { id: true } };

describe('refundedOf (T073, FR-507, Q4 (a))', () => {
  it('answers true when an order of the enrollment is refunded, reading its orders by status once', async () => {
    const { client, calls } = recorded({ id: '0199d0a0-0000-7000-8000-00000000e0p1' });
    expect(await refundedOf(client, ENROLLMENT)).toBe(true);
    expect(calls).toEqual([ASKED]);
  });

  it('answers false when no order of the enrollment is refunded', async () => {
    const { client, calls } = recorded(null);
    expect(await refundedOf(client, ENROLLMENT)).toBe(false);
    expect(calls).toEqual([ASKED]);
  });
});
