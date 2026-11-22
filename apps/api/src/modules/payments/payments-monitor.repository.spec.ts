// 006:T001 (the note under T001, Q-2 (a), the owner's decision of 2026-11-22; ERD §15 rule 72):
// `payments.gateway_order_id` is NULL-able since `20261122110318_ijazah_programme`. The monitor's
// contract keeps the reference a string until T014 and T018 widen it, so its three order reads
// refuse an order with no gateway id as a broken invariant rather than hand a NULL to the contract.
// Over a double of the transaction: the reads' filters are the database's (the monitor's DB specs).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { monitoredOrderOf, orderPage, paidOrdersOf } from './payments-monitor.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000d0e1';
const NO_GATEWAY_ID = /an order with no gateway id on a manual path/;

const order = (n: number, gatewayOrderId: string | null = `fake_${String(n)}`) => ({
  id: `0199d0a0-0000-7000-8000-00000000d0p${String(n)}`,
  enrollmentId: ENROLLMENT,
  gatewayOrderId,
  gatewayTransactionId: null,
  status: 'paid',
  grossPiasters: 10_000n,
  gatewayFeePiasters: null,
  netPiasters: null,
  teacherShareRatePercent: null,
  teacherSharePiasters: null,
  refundedPiasters: 0n,
  refundReportedAt: null,
  currency: 'EGP',
  createdAt: new Date('2026-11-22T10:00:00Z'),
});

type Order = ReturnType<typeof order>;

function orders(rows: readonly Order[]): Pick<Transaction, 'payment'> {
  return {
    payment: { findMany: async () => rows, findUnique: async () => rows[0] ?? null },
  } as unknown as Pick<Transaction, 'payment'>;
}

describe('the monitor reads (Q-2 (a))', () => {
  it('hand on orders with their gateway reference', async () => {
    const both = orders([order(1), order(2)]);
    expect((await orderPage(both, { limit: 2 })).map((row) => row.gatewayOrderId)).toEqual([
      'fake_1',
      'fake_2',
    ]);
    expect((await monitoredOrderOf(both, order(1).id))?.gatewayOrderId).toBe('fake_1');
    expect((await paidOrdersOf(both, ENROLLMENT)).map((row) => row.gatewayOrderId)).toEqual([
      'fake_1',
      'fake_2',
    ]);
    expect(await monitoredOrderOf(orders([]), order(1).id)).toBeNull();
  });

  it('refuse a page holding an order with no gateway id', async () => {
    await expect(orderPage(orders([order(1), order(2, null)]), { limit: 2 })).rejects.toThrow(
      NO_GATEWAY_ID,
    );
  });

  it('refuse one order with no gateway id', async () => {
    await expect(monitoredOrderOf(orders([order(1, null)]), order(1).id)).rejects.toThrow(
      NO_GATEWAY_ID,
    );
  });

  it("refuse an enrollment's paid orders holding one with no gateway id", async () => {
    await expect(paidOrdersOf(orders([order(1, null)]), ENROLLMENT)).rejects.toThrow(
      NO_GATEWAY_ID,
    );
  });
});
