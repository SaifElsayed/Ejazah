// 006:T001 (the note under T001, Q-2 (a), the owner's decision of 2026-11-22; ERD §15 rule 72):
// `payments.gateway_order_id` is NULL-able since `20261122110318_ijazah_programme`, NULL only on an
// automatic order the gateway has not answered or that was refused before it. 006:T018 (the follow-up
// carried from T014, option (d), the owner's «موافق» of 2026-11-24): the monitor's three order reads
// hand such an order on with its NULL (a page holding one is listed whole), and each reads the
// programme's terms: the order's kind, its month, whether it is automatic and why it failed. The
// contract's edge maps the NULL to `''` (`payments-monitor.service.ts`). Over a double of the
// transaction: the reads' filters are the database's (the monitor's DB specs).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  enrollmentOrdersOf,
  monitoredOrderOf,
  orderPage,
  paidOrdersOf,
} from './payments-monitor.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000d0e1';

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
  kind: 'instalment',
  instalmentMonth: 2,
  automatic: true,
  declineKind: null,
});

type Order = ReturnType<typeof order>;

/** A double of the transaction answering `rows`, the `select` of each read kept. */
function orders(rows: readonly Order[]): Pick<Transaction, 'payment'> & { selects: unknown[] } {
  const selects: unknown[] = [];
  return {
    selects,
    payment: {
      findMany: async ({ select }: { select: unknown }) => {
        selects.push(select);
        return rows;
      },
      findUnique: async ({ select }: { select: unknown }) => {
        selects.push(select);
        return rows[0] ?? null;
      },
    },
  } as unknown as Pick<Transaction, 'payment'> & { selects: unknown[] };
}

const TERMS = { kind: true, instalmentMonth: true, automatic: true, declineKind: true };

describe('the monitor reads (Q-2 (a); 006:T018 option (d))', () => {
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

  it('list a page holding an order with no gateway id whole, its reference null', async () => {
    const page = await orderPage(orders([order(1), order(2, null), order(3)]), { limit: 3 });
    expect(page.map((row) => row.gatewayOrderId)).toEqual(['fake_1', null, 'fake_3']);
  });

  it('hand on one order with no gateway id, its reference null', async () => {
    expect((await monitoredOrderOf(orders([order(1, null)]), order(1).id))?.gatewayOrderId).toBe(
      null,
    );
  });

  it("hand on an enrollment's paid orders holding one with no gateway id", async () => {
    expect(
      (await paidOrdersOf(orders([order(1, null), order(2)]), ENROLLMENT)).map(
        (row) => row.gatewayOrderId,
      ),
    ).toEqual([null, 'fake_2']);
  });

  it("read the programme's terms of each order: its kind, month, automatic and decline", async () => {
    const tx = orders([order(1)]);
    await orderPage(tx, { limit: 1 });
    await monitoredOrderOf(tx, order(1).id);
    await paidOrdersOf(tx, ENROLLMENT);
    expect(tx.selects).toHaveLength(3);
    for (const select of tx.selects) expect(select).toMatchObject(TERMS);
    const [row] = await orderPage(tx, { limit: 1 });
    expect(row).toMatchObject({
      kind: 'instalment',
      instalmentMonth: 2,
      automatic: true,
      declineKind: null,
    });
  });
});

// 006:T018 (admin-surface.md `programmes.get`): every order of a programme's enrollment, oldest
// first, with its terms, for the administrator's programme page.
describe("an enrollment's orders (006:T018)", () => {
  it('reads every order of the enrollment, whatever its status, oldest first, with its terms', async () => {
    const calls: unknown[] = [];
    const tx = {
      payment: {
        findMany: async (query: unknown) => {
          calls.push(query);
          return [order(1, null), order(2)];
        },
      },
    } as unknown as Pick<Transaction, 'payment'>;
    expect((await enrollmentOrdersOf(tx, ENROLLMENT)).map((row) => row.gatewayOrderId)).toEqual([
      null,
      'fake_2',
    ]);
    expect(calls).toEqual([
      {
        where: { enrollmentId: ENROLLMENT },
        orderBy: { id: 'asc' },
        select: expect.objectContaining(TERMS),
      },
    ]);
  });
});
