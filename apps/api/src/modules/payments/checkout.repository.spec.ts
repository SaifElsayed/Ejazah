// 006:T001 (the note under T001, Q-2 (a), the owner's decision of 2026-11-22; ERD §15 rule 72):
// `payments.gateway_order_id` is NULL-able since `20261122110318_ijazah_programme`, NULL only on an
// automatic order the gateway has not answered or that was refused before it. Nothing writes one
// until T014; the checkout's reads that hand a gateway reference on as a string refuse a NULL as the
// broken invariant it is on the manual path, never answer it as a reference or as «no order».
// Over a double of the transaction: the reads' filters are the database's (checkout.spec.ts).
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  assessmentOrderOf,
  checkoutOrdersAmong,
  heldOrdersOf,
  insertOrder,
  lastOrderOf,
  orderById,
  orderReferenceOf,
  payableProgrammeOrderAmong,
} from './checkout.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000c0e1';
const NO_GATEWAY_ID = /an order with no gateway id on a manual path/;

interface Row {
  readonly id: string;
  readonly enrollmentId: string;
  readonly gatewayOrderId: string | null;
  readonly status: string;
  readonly expiresAt: Date;
  readonly checkoutUrlEncrypted: Uint8Array | null;
  readonly kind?: string;
  readonly confirmedAt?: Date | null;
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

  it('refuse a manual order with no gateway id (an automatic one is never read here: Minor 4)', async () => {
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

// 006:T009 (FR-710, R-509, R-511): what programme.pay reads and writes of the orders.
describe('the orders programme.pay reads (006:T009)', () => {
  const OTHER = '0199d0a0-0000-7000-8000-00000000c0e2';

  function recording(answers: Record<string, unknown>) {
    const calls: [string, unknown][] = [];
    const client = {
      $queryRaw: async (...query: unknown[]) => {
        calls.push(['lock', (query[0] as readonly string[]).join('?')]);
        return [];
      },
      payment: Object.fromEntries(
        ['findMany', 'findFirst', 'create'].map((method) => [
          method,
          async (query: unknown) => {
            calls.push([method, query]);
            const answer = answers[method];
            return Array.isArray(answer) && method === 'findMany' ? answer.shift() : answer;
          },
        ]),
      ),
    } as unknown as Transaction;
    return { client, calls };
  }

  it('reads the assessment order the confirm step processed: its gross and its two rates (R-511)', async () => {
    const { client, calls } = recording({
      findFirst: {
        grossPiasters: 50_000n,
        teacherShareRatePercent: 70,
        halfReleaseRatePercent: 25,
      },
    });
    await expect(assessmentOrderOf(client, ENROLLMENT)).resolves.toStrictEqual({
      gross_piasters: 50_000,
      teacherShareRatePercent: 70,
      halfReleaseRatePercent: 25,
    });
    expect(calls).toEqual([
      [
        'findFirst',
        {
          where: { enrollmentId: ENROLLMENT, kind: 'assessment', confirmedAt: { not: null } },
          orderBy: { id: 'asc' },
          select: {
            grossPiasters: true,
            teacherShareRatePercent: true,
            halfReleaseRatePercent: true,
          },
        },
      ],
    ]);
  });

  it('refuses a programme with no processed assessment order, or one with no rate, as a broken invariant', async () => {
    await expect(
      assessmentOrderOf(recording({ findFirst: null }).client, ENROLLMENT),
    ).rejects.toThrow(/no processed assessment order with its rate/);
    await expect(
      assessmentOrderOf(
        recording({
          findFirst: {
            grossPiasters: 50_000n,
            teacherShareRatePercent: null,
            halfReleaseRatePercent: 25,
          },
        }).client,
        ENROLLMENT,
      ),
    ).rejects.toThrow(/no processed assessment order with its rate/);
  });

  it('locks the enrollments’ orders in one call, then answers each one’s payable order and whether one is paid', async () => {
    const first = order(1, { status: 'paid' });
    const second = order(2, { enrollmentId: OTHER });
    const { client, calls } = recording({
      findMany: [
        [{ id: first.id }, { id: second.id }],
        [first, second],
      ],
    });
    const answer = await checkoutOrdersAmong(client, [ENROLLMENT, OTHER], AT);
    expect([...answer.entries()]).toEqual([
      [ENROLLMENT, { payable: null, paid: true, programmeProcessing: false }],
      [
        OTHER,
        {
          payable: { paymentId: second.id, gatewayOrderId: 'fake_2', expiresAt: second.expiresAt },
          paid: false,
          programmeProcessing: false,
        },
      ],
    ]);
    expect(calls.map(([kind]) => kind)).toEqual(['findMany', 'lock', 'findMany']);
    expect(calls[0]?.[1]).toEqual({
      where: { enrollmentId: { in: [ENROLLMENT, OTHER] } },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
  });

  // PR #158 r1 Major 1 (PROBE-S1; FR-BOOK-12): a programme order paid at the gateway whose confirm
  // step has not run yet is still being processed; a processed one, or the paid assessment, is not.
  it('answers a rest or a month paid and not yet confirmed as processing; a processed one or the assessment not', async () => {
    const processedAt = new Date('2026-11-22T09:00:00Z');
    const worlds: [Partial<Row>, boolean][] = [
      [{ kind: 'rest_in_full', status: 'paid', confirmedAt: null }, true],
      [{ kind: 'instalment', status: 'paid', confirmedAt: null }, true],
      [{ kind: 'rest_in_full', status: 'paid', confirmedAt: processedAt }, false],
      [{ kind: 'assessment', status: 'paid', confirmedAt: null }, false],
      [{ kind: 'instalment', status: 'created', confirmedAt: null }, false],
    ];
    const answers: boolean[] = [];
    for (const [overrides] of worlds) {
      const one = order(1, overrides);
      const { client, calls } = recording({ findMany: [[{ id: one.id }], [one]] });
      const answer = await checkoutOrdersAmong(client, [ENROLLMENT], AT);
      answers.push(answer.get(ENROLLMENT)?.programmeProcessing === true);
      expect(calls[2]?.[1]).toMatchObject({ select: { kind: true, confirmedAt: true } });
    }
    expect(answers).toEqual(worlds.map(([, processing]) => processing));
  });

  it('locks nothing for enrollments with no order', async () => {
    const { client, calls } = recording({ findMany: [[]] });
    expect([...(await checkoutOrdersAmong(client, [ENROLLMENT], AT)).entries()]).toEqual([]);
    expect(calls.map(([kind]) => kind)).toEqual(['findMany']);
  });

  it('finds a programme order still payable among the enrollments, with no lock', async () => {
    const expiresAt = new Date('2026-11-22T10:05:00Z');
    const { client, calls } = recording({ findFirst: { enrollmentId: OTHER, expiresAt } });
    await expect(
      payableProgrammeOrderAmong(client, [ENROLLMENT, OTHER], AT),
    ).resolves.toStrictEqual({ enrollmentId: OTHER, expiresAt });
    expect(calls).toEqual([
      [
        'findFirst',
        {
          where: {
            enrollmentId: { in: [ENROLLMENT, OTHER] },
            kind: { in: ['rest_in_full', 'instalment'] },
            // PR #160 r1 Minor 4 (a): an automatic order under way is no checkout to continue.
            automatic: false,
            status: 'created',
            expiresAt: { gt: AT },
          },
          orderBy: { id: 'desc' },
          select: { enrollmentId: true, expiresAt: true },
        },
      ],
    ]);
    expect(
      await payableProgrammeOrderAmong(recording({ findFirst: null }).client, [ENROLLMENT], AT),
    ).toBeNull();
  });

  // PR #160 r1 Minor 4 (b): the student's status and continue read the latest manual order; an
  // automatic one (since T014, often with no gateway id: refused, or its intention unanswered) is
  // never read here. Example: Friday's retry `expired` with no id; Saturday's status still answers.
  it('reads the enrollment’s latest manual order, never an automatic one', async () => {
    const row = order(1);
    const { client, calls } = recording({ findFirst: row });
    expect((await lastOrderOf(client, ENROLLMENT))?.gatewayOrderId).toBe('fake_1');
    expect(calls).toEqual([
      [
        'findFirst',
        {
          where: { enrollmentId: ENROLLMENT, automatic: false },
          orderBy: { id: 'desc' },
          select: {
            id: true,
            enrollmentId: true,
            gatewayOrderId: true,
            status: true,
            expiresAt: true,
            checkoutUrlEncrypted: true,
          },
        },
      ],
    ]);
  });

  it('writes a programme order with its kind, its month and the card consent, and a package order without them', async () => {
    const { client, calls } = recording({ create: { id: 'x' } });
    const base = {
      id: 'pay-1',
      enrollmentId: ENROLLMENT,
      gateway: 'fake' as const,
      gatewayOrderId: 'fake_1',
      gross_piasters: piasters(100_000),
      currency: 'EGP',
      expiresAt: AT,
      checkoutUrlEncrypted: Uint8Array.from([1]),
      teacherShareRatePercent: 70,
      teacherShare_piasters: piasters(70_000),
      halfReleaseRatePercent: 25,
    };
    await insertOrder(client, {
      ...base,
      kind: 'instalment',
      instalmentMonth: 1,
      cardConsentAt: AT,
    });
    await insertOrder(client, { ...base, kind: 'package' });
    const [programme, pkg] = calls.map(([, query]) => (query as { data: object }).data);
    expect(programme).toMatchObject({ kind: 'instalment', instalmentMonth: 1, cardConsentAt: AT });
    expect(pkg).toMatchObject({ kind: 'package' });
    expect(pkg).not.toHaveProperty('instalmentMonth');
    expect(pkg).not.toHaveProperty('cardConsentAt');
  });
});
