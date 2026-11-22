// 006:T001 (the note under T001, Q-2 (a), the owner's decision of 2026-11-22; ERD §15 rule 72):
// `payments.gateway_order_id` is NULL-able since `20261122110318_ijazah_programme`, NULL only on an
// automatic order the gateway has not answered or that was refused before it. Nothing writes one
// until T014; the checkout's reads that hand a gateway reference on as a string refuse a NULL as the
// broken invariant it is on the manual path, never answer it as a reference or as «no order».
// Over a double of the transaction: the reads' filters are the database's (checkout.spec.ts).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { heldOrdersOf, lastOrderOf, orderById, orderReferenceOf } from './checkout.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000c0e1';
const NO_GATEWAY_ID = /an order with no gateway id on a manual path/;

interface Row {
  readonly id: string;
  readonly enrollmentId: string;
  readonly gatewayOrderId: string | null;
  readonly status: string;
  readonly expiresAt: Date;
  readonly checkoutUrlEncrypted: Uint8Array | null;
}

const order = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: `0199d0a0-0000-7000-8000-00000000c0p${String(n)}`,
  enrollmentId: ENROLLMENT,
  gatewayOrderId: `fake_${String(n)}`,
  status: 'created',
  expiresAt: new Date('2026-11-22T10:10:00Z'),
  checkoutUrlEncrypted: Uint8Array.from([1, 2, 3]),
  ...overrides,
});

/** The rows each read finds, whatever its filter: the filters are the database's to prove. */
function orders(rows: readonly Row[]): Transaction {
  return {
    $queryRaw: async () => [],
    payment: {
      findMany: async () => rows,
      findUnique: async () => rows[0] ?? null,
      findFirst: async () => rows.at(-1) ?? null,
    },
  } as unknown as Transaction;
}

const AT = new Date('2026-11-22T10:00:00Z');

describe('heldOrdersOf (Q-2 (a))', () => {
  it('hands on the payable order with its gateway reference', async () => {
    const held = await heldOrdersOf(orders([order(1)]), ENROLLMENT, AT);
    expect(held.payable?.gatewayOrderId).toBe('fake_1');
  });

  it('refuses a payable order with no gateway id', async () => {
    await expect(
      heldOrdersOf(orders([order(1, { gatewayOrderId: null })]), ENROLLMENT, AT),
    ).rejects.toThrow(NO_GATEWAY_ID);
  });
});

describe('orderById and lastOrderOf (Q-2 (a))', () => {
  it('hand on an order with its gateway reference', async () => {
    expect((await orderById(orders([order(1)]), order(1).id))?.gatewayOrderId).toBe('fake_1');
    expect((await lastOrderOf(orders([order(1)]), ENROLLMENT))?.gatewayOrderId).toBe('fake_1');
  });

  it('answer null when there is no order', async () => {
    expect(await orderById(orders([]), order(1).id)).toBeNull();
    expect(await lastOrderOf(orders([]), ENROLLMENT)).toBeNull();
  });

  it('refuse an order with no gateway id', async () => {
    const unanswered = orders([order(1, { gatewayOrderId: null })]);
    await expect(orderById(unanswered, order(1).id)).rejects.toThrow(NO_GATEWAY_ID);
    await expect(lastOrderOf(unanswered, ENROLLMENT)).rejects.toThrow(NO_GATEWAY_ID);
  });
});

describe('orderReferenceOf (Q-2 (a))', () => {
  it('answers the reference, or null when there is no order', async () => {
    expect(await orderReferenceOf(orders([order(1)]), order(1).id)).toBe('fake_1');
    expect(await orderReferenceOf(orders([]), order(1).id)).toBeNull();
  });

  it('refuses an order with no gateway id rather than answer it as no order', async () => {
    await expect(
      orderReferenceOf(orders([order(1, { gatewayOrderId: null })]), order(1).id),
    ).rejects.toThrow(NO_GATEWAY_ID);
  });
});
