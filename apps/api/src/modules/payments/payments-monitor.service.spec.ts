// T052 — the admin's payments monitor (FR-400, FR-401, R-220) over a store faked in memory: what each
// read asks of the owners and what it answers. The queries run on the database in
// `payments-monitor.repository.spec.ts`; the procedures, their audit entries and their refusals in
// `payments-admin.router.spec.ts`.
//
//   - the list is newest first, keyset pages of `admin_list_page_size`, a cursor only while more
//     orders follow; a status filter is the store's;
//   - a search matches an order reference exactly or a student's folded name by prefix, scanning
//     page after page until the page is full, and never asks the name of anyone outside a page;
//   - amounts are what the gateway reported, fee and net absent until paid (FR-PAYG-7);
//   - a paid order of a cancelled enrollment says so;
//   - the detail names the student and the teacher, carries the enrollment's package and progress,
//     the order's events, the outcomes that concern this order, and every paid order of the
//     enrollment (the note under T052); an unknown order answers NOT_FOUND.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { MonitoredEnrollment } from '../booking/index.js';
import type { MonitorOrderRow, PaymentsMonitorStore } from './payments-monitor.service.js';
import { PaymentsMonitorService } from './payments-monitor.service.js';

const tx = {} as Transaction;
const NOW = new Date('2026-11-10T12:00:00Z');
const PAGE_SIZE = 2;

const AMAL = '0199d0a0-0000-7000-8000-0000000000a1';
const HUDA = '0199d0a0-0000-7000-8000-0000000000a2';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b1';
const E_AMAL = '0199d0a0-0000-7000-8000-0000000000e1';
const E_HUDA = '0199d0a0-0000-7000-8000-0000000000e2';

/** When the n-th order was created: the n-th of November at 10:00. */
const CREATED = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((day) => `2026-11-0${day}T10:00:00Z`);

/** The n-th order id; a greater n is a newer order, as UUID v7 ids are time-ordered. */
function orderId(n: number): string {
  return `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

function order(n: number, overrides: Partial<MonitorOrderRow> = {}): MonitorOrderRow {
  return {
    id: orderId(n),
    enrollmentId: n % 2 === 0 ? E_HUDA : E_AMAL,
    gatewayOrderId: `fake_order_${n}`,
    gatewayTransactionId: null,
    status: 'created',
    grossPiasters: 120_000n,
    gatewayFeePiasters: null,
    netPiasters: null,
    teacherShareRatePercent: null,
    teacherSharePiasters: null,
    refundedPiasters: 0n,
    refundReportedAt: null,
    currency: 'EGP',
    createdAt: new Date(CREATED[n - 1] ?? '2026-11-09T10:00:00Z'),
    ...overrides,
  };
}

const enrollments = new Map([
  [E_AMAL, { studentUserId: AMAL, status: 'confirmed' as const }],
  [E_HUDA, { studentUserId: HUDA, status: 'cancelled' as const }],
]);

const names = new Map([
  [AMAL, 'آمال علي'],
  [HUDA, 'هدى سمير'],
  [TEACHER, 'المعلمة سارة'],
]);

const monitored: MonitoredEnrollment = {
  enrollmentId: E_AMAL,
  studentUserId: AMAL,
  teacherUserId: TEACHER,
  status: 'confirmed',
  summary: {
    subject: { id: '0199d0a0-0000-7000-8000-0000000000c1', nameAr: 'تجويد', nameEn: 'Tajweed' },
    track: 'recitation',
    sessionCount: 8,
    sessionDurationMinutes: 60,
  },
  completed: 3,
  total: 8,
  outcomes: [
    {
      kind: 'order_failed',
      cancellationReason: null,
      paymentId: orderId(1),
      occurredAt: new Date('2026-11-01T10:05:00Z'),
    },
    {
      kind: 'confirmed',
      cancellationReason: null,
      paymentId: orderId(3),
      occurredAt: new Date('2026-11-03T10:06:00Z'),
    },
    {
      kind: 'cancelled',
      cancellationReason: 'admin',
      paymentId: null,
      occurredAt: new Date('2026-11-05T10:00:00Z'),
    },
  ],
  // T024 of specs/004-sessions (GAP-8): a hold released before its reason was recorded, the
  // converted one, and one still active.
  holds: [
    {
      id: '0199d0a0-0000-7000-8000-0000000000d1',
      placedAt: new Date('2026-11-01T10:00:00Z'),
      expiresAt: new Date('2026-11-01T10:45:00Z'),
      releasedAt: new Date('2026-11-01T10:46:00Z'),
      releaseReason: null,
    },
    {
      id: '0199d0a0-0000-7000-8000-0000000000d2',
      placedAt: new Date('2026-11-03T09:58:00Z'),
      expiresAt: new Date('2026-11-03T10:43:00Z'),
      releasedAt: new Date('2026-11-03T10:06:00Z'),
      releaseReason: 'converted',
    },
    {
      id: '0199d0a0-0000-7000-8000-0000000000d3',
      placedAt: new Date('2026-11-09T09:00:00Z'),
      expiresAt: new Date('2026-11-09T09:45:00Z'),
      releasedAt: null,
      releaseReason: null,
    },
  ],
};

interface Recorded extends PaymentsMonitorStore {
  readonly asked: unknown[][];
}

function storeOf(orders: readonly MonitorOrderRow[]): Recorded {
  const asked: unknown[][] = [];
  const newestFirst = [...orders].sort((a, b) => b.id.localeCompare(a.id));
  return {
    asked,
    orderPage: async (_tx, { status, after, limit, enrollmentId }) => {
      asked.push(['orderPage', status, after, limit]);
      if (enrollmentId !== undefined) asked.push(['orderPage.enrollmentId', enrollmentId]);
      return newestFirst
        .filter((row) => status === undefined || row.status === status)
        .filter((row) => enrollmentId === undefined || row.enrollmentId === enrollmentId)
        .filter((row) => after === undefined || row.id < after)
        .slice(0, limit);
    },
    orderOf: async (_tx, paymentId) => orders.find(({ id }) => id === paymentId) ?? null,
    eventsOf: async () => [
      { eventType: 'failed', receivedAt: new Date('2026-11-03T10:01:00Z') },
      { eventType: 'paid', receivedAt: new Date('2026-11-03T10:05:00Z') },
    ],
    paidOrdersOf: async (_tx, enrollmentId) =>
      orders
        .filter((row) => row.enrollmentId === enrollmentId)
        .filter(({ status }) => status === 'paid' || status === 'refunded')
        .sort((a, b) => a.id.localeCompare(b.id)),
    enrollmentPartiesAmong: async (_tx, ids) => {
      asked.push(['enrollmentPartiesAmong', [...ids].sort()]);
      return new Map(
        ids.flatMap((id) => (enrollments.has(id) ? [[id, enrollments.get(id)!]] : [])),
      );
    },
    enrollmentOf: async (_tx, enrollmentId) => (enrollmentId === E_AMAL ? monitored : null),
    namesOf: async (_tx, ids) => {
      asked.push(['namesOf', [...ids].sort()]);
      return new Map(ids.flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : [])));
    },
    namePrefixMatches: async (_tx, candidates, typed) => {
      asked.push(['namePrefixMatches', [...candidates].sort(), typed]);
      return candidates.filter((id) => names.get(id)?.startsWith(typed) === true);
    },
  };
}

function serviceOver(store: PaymentsMonitorStore): PaymentsMonitorService {
  return new PaymentsMonitorService({
    store,
    settings: {
      read: async (key, schema) => {
        if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
        return schema.parse(PAGE_SIZE);
      },
    },
    now: () => NOW,
  });
}

describe('payments.list', () => {
  it('pages newest first by the time-ordered id, a cursor only while more orders follow', async () => {
    const store = storeOf([order(1), order(2), order(3), order(4), order(5)]);
    const service = serviceOver(store);
    const first = await service.list(tx, {});
    expect(first.items.map(({ paymentId }) => paymentId)).toEqual([orderId(5), orderId(4)]);
    expect(first.nextCursor).toBe(orderId(4));
    const second = await service.list(tx, { cursor: orderId(4) });
    expect(second.items.map(({ paymentId }) => paymentId)).toEqual([orderId(3), orderId(2)]);
    const last = await service.list(tx, { cursor: orderId(2) });
    expect(last.items.map(({ paymentId }) => paymentId)).toEqual([orderId(1)]);
    expect(last).not.toHaveProperty('nextCursor');
    // One row more than the page is read, so a cursor is written only while more remain.
    expect(store.asked.filter(([name]) => name === 'orderPage')).toEqual([
      ['orderPage', undefined, undefined, PAGE_SIZE + 1],
      ['orderPage', undefined, orderId(4), PAGE_SIZE + 1],
      ['orderPage', undefined, orderId(2), PAGE_SIZE + 1],
    ]);
  });

  it('writes no cursor when the page is exactly the last orders', async () => {
    const answer = await serviceOver(storeOf([order(1), order(2)])).list(tx, {});
    expect(answer.items).toHaveLength(PAGE_SIZE);
    expect(answer).not.toHaveProperty('nextCursor');
  });

  it('hands the status filter to the store', async () => {
    const store = storeOf([order(1), order(2, { status: 'paid' }), order(3)]);
    const answer = await serviceOver(store).list(tx, { status: 'paid' });
    expect(answer.items.map(({ paymentId }) => paymentId)).toEqual([orderId(2)]);
    expect(store.asked[0]).toEqual(['orderPage', 'paid', undefined, PAGE_SIZE + 1]);
  });

  // B42, T047 (the note under T047, Q6 (a)): `/payments?enrollment=` lists one enrollment's
  // orders; the filter is the store's query, as the status is.
  it('hands an enrollment filter to the store, and answers only that enrollment’s orders', async () => {
    const store = storeOf([order(1), order(2), order(3), order(4), order(5)]);
    const answer = await serviceOver(store).list(tx, { enrollmentId: E_HUDA });
    expect(answer.items.map(({ paymentId }) => paymentId)).toEqual([orderId(4), orderId(2)]);
    expect(answer).not.toHaveProperty('nextCursor');
    expect(store.asked).toContainEqual(['orderPage.enrollmentId', E_HUDA]);
  });

  it('answers the amounts as reported, fee and net absent until paid, and names the student', async () => {
    const paid = order(2, {
      status: 'paid',
      gatewayTransactionId: 'txn_2',
      gatewayFeePiasters: 3_480n,
      netPiasters: 116_520n,
    });
    const answer = await serviceOver(storeOf([order(1), paid])).list(tx, {});
    expect(answer.items).toEqual([
      {
        paymentId: orderId(2),
        gatewayOrderId: 'fake_order_2',
        createdAt: '2026-11-02T10:00:00.000Z',
        student: { displayName: 'هدى سمير' },
        gross_piasters: piasters(120_000),
        gatewayFee_piasters: piasters(3_480),
        net_piasters: piasters(116_520),
        refunded_piasters: piasters(0),
        status: 'paid',
        enrollmentCancelled: true,
      },
      {
        paymentId: orderId(1),
        gatewayOrderId: 'fake_order_1',
        createdAt: '2026-11-01T10:00:00.000Z',
        student: { displayName: 'آمال علي' },
        gross_piasters: piasters(120_000),
        refunded_piasters: piasters(0),
        status: 'created',
        enrollmentCancelled: false,
      },
    ]);
  });

  it('answers each order’s rate and the teacher’s share kept on it, and neither on an order created before the commission (003:T104)', async () => {
    const withShare = order(2, { teacherShareRatePercent: 70, teacherSharePiasters: 84_000n });
    const answer = await serviceOver(storeOf([order(1), withShare])).list(tx, {});
    expect(answer.items[0]).toMatchObject({
      teacherShareRatePercent: 70,
      teacherShare_piasters: piasters(84_000),
    });
    expect(answer.items[1]).not.toHaveProperty('teacherShareRatePercent');
    expect(answer.items[1]).not.toHaveProperty('teacherShare_piasters');
  });

  it('answers each order’s refunded total, a partly refunded order still paid (003:T102, DEC-82)', async () => {
    const partly = order(2, { status: 'paid', refundedPiasters: 30_000n });
    const answer = await serviceOver(storeOf([order(1), partly])).list(tx, {});
    expect(answer.items.map((item) => [item.status, item.refunded_piasters])).toEqual([
      ['paid', piasters(30_000)],
      ['created', piasters(0)],
    ]);
  });

  it('says a cancelled enrollment only on a paid order: an unpaid one of it is just unpaid', async () => {
    const answer = await serviceOver(storeOf([order(2, { status: 'failed' })])).list(tx, {});
    expect(answer.items[0]?.enrollmentCancelled).toBe(false);
  });

  it('reads each page’s enrollments and names once, for that page’s orders only', async () => {
    const store = storeOf([order(1), order(2), order(3)]);
    await serviceOver(store).list(tx, {});
    expect(store.asked.filter(([name]) => name !== 'orderPage')).toEqual([
      ['enrollmentPartiesAmong', [E_AMAL, E_HUDA]],
      ['namesOf', [AMAL, HUDA]],
    ]);
  });

  it('searches an order reference exactly', async () => {
    const answer = await serviceOver(storeOf([order(1), order(2), order(3)])).list(tx, {
      search: 'fake_order_2',
    });
    expect(answer.items.map(({ gatewayOrderId }) => gatewayOrderId)).toEqual(['fake_order_2']);
    const partial = await serviceOver(storeOf([order(1), order(2)])).list(tx, {
      search: 'fake_order',
    });
    expect(partial.items).toEqual([]);
  });

  it('searches a student’s name by its folded prefix, through the kernel’s query over the page’s students only', async () => {
    const store = storeOf([order(1), order(2), order(3), order(4)]);
    const answer = await serviceOver(store).list(tx, { search: 'هدى' });
    expect(answer.items.map(({ paymentId }) => paymentId)).toEqual([orderId(4), orderId(2)]);
    const asked = store.asked.filter(([name]) => name === 'namePrefixMatches');
    expect(asked.length).toBeGreaterThan(0);
    for (const [, candidates, typed] of asked) {
      expect([AMAL, HUDA]).toEqual(expect.arrayContaining(candidates as string[]));
      expect(typed).toBe('هدى');
    }
  });

  it('scans on past pages with no match until the page is full, and cuts the cursor at the last match', async () => {
    // Amal's orders are the odd ones: 9, 7, 5, 3, 1 newest first; each scan reads three orders.
    const store = storeOf([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => order(n)));
    const service = serviceOver(store);
    const first = await service.list(tx, { search: 'آمال' });
    expect(first.items.map(({ paymentId }) => paymentId)).toEqual([orderId(9), orderId(7)]);
    expect(first.nextCursor).toBe(orderId(7));
    const second = await service.list(tx, { search: 'آمال', cursor: orderId(7) });
    expect(second.items.map(({ paymentId }) => paymentId)).toEqual([orderId(5), orderId(3)]);
    expect(second.nextCursor).toBe(orderId(3));
    const third = await service.list(tx, { search: 'آمال', cursor: orderId(3) });
    expect(third.items.map(({ paymentId }) => paymentId)).toEqual([orderId(1)]);
    expect(third).not.toHaveProperty('nextCursor');
  });

  it('answers an empty page when nothing matches, after reading every order once, a short read ending the scan', async () => {
    const store = storeOf([1, 2, 3, 4, 5].map((n) => order(n)));
    const answer = await serviceOver(store).list(tx, { search: 'زينب' });
    expect(answer).toEqual({ items: [] });
    const afters = store.asked.filter(([name]) => name === 'orderPage').map(([, , after]) => after);
    expect(afters).toEqual([undefined, orderId(3)]);
    // Each window twice the last: a scan of n orders takes a number of reads logarithmic in n.
    const limits = store.asked
      .filter(([name]) => name === 'orderPage')
      .map(([, , , limit]) => limit);
    expect(limits).toEqual([PAGE_SIZE + 1, 2 * (PAGE_SIZE + 1)]);
  });
});

describe('payments.get', () => {
  const paid = order(3, {
    status: 'paid',
    gatewayTransactionId: 'txn_3',
    gatewayFeePiasters: 3_480n,
    netPiasters: 116_520n,
  });
  const refunded = order(5, { status: 'refunded', gatewayFeePiasters: 0n, netPiasters: 120_000n });
  const orders = [order(1, { status: 'failed' }), paid, refunded];

  it('answers the order as reported, its references, the enrollment, the events, its outcomes and the enrollment’s paid orders', async () => {
    expect(await serviceOver(storeOf(orders)).get(tx, orderId(3))).toEqual({
      paymentId: orderId(3),
      gatewayOrderId: 'fake_order_3',
      gatewayTransactionId: 'txn_3',
      status: 'paid',
      createdAt: '2026-11-03T10:00:00.000Z',
      gross_piasters: piasters(120_000),
      gatewayFee_piasters: piasters(3_480),
      net_piasters: piasters(116_520),
      refunded_piasters: piasters(0),
      currency: 'EGP',
      student: { displayName: 'آمال علي' },
      enrollment: {
        enrollmentId: E_AMAL,
        summary: monitored.summary,
        teacher: { displayName: 'المعلمة سارة' },
        status: 'confirmed',
        completed: 3,
        total: 8,
        // Oldest first; a release and its reason only where recorded («not recorded» on the panel).
        holds: [
          {
            holdId: '0199d0a0-0000-7000-8000-0000000000d1',
            placedAt: '2026-11-01T10:00:00.000Z',
            expiresAt: '2026-11-01T10:45:00.000Z',
            releasedAt: '2026-11-01T10:46:00.000Z',
          },
          {
            holdId: '0199d0a0-0000-7000-8000-0000000000d2',
            placedAt: '2026-11-03T09:58:00.000Z',
            expiresAt: '2026-11-03T10:43:00.000Z',
            releasedAt: '2026-11-03T10:06:00.000Z',
            releaseReason: 'converted',
          },
          {
            holdId: '0199d0a0-0000-7000-8000-0000000000d3',
            placedAt: '2026-11-09T09:00:00.000Z',
            expiresAt: '2026-11-09T09:45:00.000Z',
          },
        ],
      },
      events: [
        { eventType: 'failed', receivedAt: '2026-11-03T10:01:00.000Z' },
        { eventType: 'paid', receivedAt: '2026-11-03T10:05:00.000Z' },
      ],
      // Another order's failure is not this order's; the enrollment's cancellation concerns every order.
      outcomes: [
        { kind: 'confirmed', occurredAt: '2026-11-03T10:06:00.000Z' },
        { kind: 'cancelled', cancellationReason: 'admin', occurredAt: '2026-11-05T10:00:00.000Z' },
      ],
      paidOrders: [
        {
          paymentId: orderId(3),
          gatewayOrderId: 'fake_order_3',
          status: 'paid',
          createdAt: '2026-11-03T10:00:00.000Z',
        },
        {
          paymentId: orderId(5),
          gatewayOrderId: 'fake_order_5',
          status: 'refunded',
          createdAt: '2026-11-05T10:00:00.000Z',
        },
      ],
    });
  });

  it('answers the order’s rate and teacher share where it keeps them, and neither otherwise (003:T104)', async () => {
    const withShare = order(1, { teacherShareRatePercent: 65, teacherSharePiasters: 78_000n });
    const answer = await serviceOver(storeOf([withShare, ...orders.slice(1)])).get(tx, orderId(1));
    expect(answer).toMatchObject({ teacherShareRatePercent: 65, teacherShare_piasters: piasters(78_000) });
    const before = await serviceOver(storeOf(orders)).get(tx, orderId(1));
    expect(before).not.toHaveProperty('teacherShareRatePercent');
    expect(before).not.toHaveProperty('teacherShare_piasters');
  });

  it('answers the refunded total and, once set, when the gateway flagged a refund with no amount (003:T102, Q-2 (a))', async () => {
    const flagged = order(3, {
      status: 'paid',
      refundedPiasters: 30_000n,
      refundReportedAt: new Date('2026-11-18T09:00:00Z'),
    });
    const answer = await serviceOver(storeOf([orders[0]!, flagged, refunded])).get(tx, orderId(3));
    expect(answer).toMatchObject({
      status: 'paid',
      refunded_piasters: piasters(30_000),
      refundReportedAt: '2026-11-18T09:00:00.000Z',
    });
    const unflagged = await serviceOver(storeOf(orders)).get(tx, orderId(3));
    expect(unflagged).not.toHaveProperty('refundReportedAt');
  });

  it('answers an unpaid order with no fee, no net and no transaction', async () => {
    const answer = await serviceOver(storeOf(orders)).get(tx, orderId(1));
    expect(answer).not.toHaveProperty('gatewayFee_piasters');
    expect(answer).not.toHaveProperty('net_piasters');
    expect(answer).not.toHaveProperty('gatewayTransactionId');
    expect(answer.outcomes).toEqual([
      { kind: 'order_failed', occurredAt: '2026-11-01T10:05:00.000Z' },
      { kind: 'cancelled', cancellationReason: 'admin', occurredAt: '2026-11-05T10:00:00.000Z' },
    ]);
  });

  it('answers an order whose enrollment no read returns with no enrollment, no outcome and no name', async () => {
    const answer = await serviceOver(storeOf([order(2)])).get(tx, orderId(2));
    expect(answer).not.toHaveProperty('enrollment');
    expect(answer.outcomes).toEqual([]);
    expect(answer.student).toEqual({ displayName: '' });
  });

  it('answers NOT_FOUND for an order no row holds', async () => {
    await expect(serviceOver(storeOf(orders)).get(tx, orderId(7))).rejects.toEqual(
      new DomainError('NOT_FOUND'),
    );
  });
});
