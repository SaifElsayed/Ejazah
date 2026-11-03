// T040 (R-215, FR-363, FR-364, FR-PAYG-6, FR-PAYG-19; ARCHITECTURE §8.1): the
// `expire-pending-payments` sweep's decisions, over recorded steps. Every minute on a cron pattern
// in code. One run, at one instant:
//
//   1. every `created` order past its expiry is marked `expired`, a page at a time, each page in one
//      transaction;
//   2. every expired active hold that carries an enrollment is released through booking's one
//      release under `'expired'` (which cancels with `payment_failed` or `payment_expired` and
//      leaves an enrollment with a `paid` order awaiting payment), a page per transaction;
//   3. every `paid` order whose paid event was recorded at least `checkout_confirmation_timeout_seconds`
//      before the run, whose enrollment is `pending_payment` or `cancelled` and has no compensation
//      case, is handed to `confirm-enrollment` by its id (M2, round 2 N1), after the page's reads.
//
// A failed hand-off fails the run, for the queue's retry. Two runs leave what one leaves. The same
// over the real tables, behind the webhook, is `tests/db-integrity/expire-pending-payments.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../platform/db/prisma.repository.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  CONFIRMATION_TIMEOUT_SETTING,
  EXPIRE_PENDING_PAYMENTS,
  expirePendingPayments,
  type PendingPaymentSteps,
} from './expire-pending-payments.js';

const NOW = new Date('2026-11-03T08:00:00Z');
const TIMEOUT_SECONDS = 15;

interface Order {
  readonly id: string;
  readonly enrollmentId: string;
  status: 'created' | 'paid' | 'failed' | 'expired';
  readonly expiresAt: Date;
  readonly paidRecordedAt: Date | null;
}

interface Hold {
  readonly id: string;
  readonly enrollmentId: string;
  readonly expiresAt: Date;
  releasedAt: Date | null;
}

interface Enrollment {
  readonly id: string;
  status: 'pending_payment' | 'confirmed' | 'cancelled';
  /** When its latest compensation case was opened; none when it has none. */
  readonly caseOpenedAt?: Date;
}

interface WorldRows {
  readonly orders?: Order[];
  readonly holds?: Hold[];
  readonly enrollments?: Enrollment[];
}

function settingsOf(seconds: unknown): SettingsReader & { keys: string[] } {
  return {
    keys: [],
    async read(key, schema) {
      this.keys.push(key);
      if (key !== CONFIRMATION_TIMEOUT_SETTING) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(seconds);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function page<T extends { readonly id: string }>(
  rows: readonly T[],
  keep: (row: T) => boolean,
  after: string | undefined,
  limit: number,
): T[] {
  return rows
    .filter((row) => keep(row) && (after === undefined || row.id > after))
    .sort((one, other) => (one.id < other.id ? -1 : 1))
    .slice(0, limit);
}

function paymentsWorld({ orders = [], holds = [], enrollments = [] }: WorldRows) {
  const transactions: string[][] = [];
  /** The queue, by job id: a second add of one id is the same job. */
  const queued = new Map<string, number>();
  let current: string[] | undefined;
  const tx = {} as Transaction;
  const database = {
    $transaction: (async (work: (client: Transaction) => Promise<unknown>) => {
      current = [];
      transactions.push(current);
      try {
        return await work(tx);
      } finally {
        current = undefined;
      }
    }) as never,
  };
  const enrollment = (id: string) => enrollments.find((one) => one.id === id);
  const steps: PendingPaymentSteps = {
    expiredOrders: async (client, at, after, limit) => {
      expect(client).toBe(tx);
      current?.push(`orders after ${after ?? '-'}`);
      return page(
        orders,
        (order) => order.status === 'created' && order.expiresAt <= at,
        after,
        limit,
      ).map(({ id }) => id);
    },
    markExpired: async (client, ids, at) => {
      expect([client, at]).toEqual([tx, NOW]);
      current?.push(`expire ${ids.join(',')}`);
      for (const order of orders) {
        if (ids.includes(order.id) && order.status === 'created') order.status = 'expired';
      }
    },
    expiredHolds: async (client, at, after, limit) => {
      expect(client).toBe(tx);
      current?.push(`holds after ${after ?? '-'}`);
      return page(
        holds,
        (hold) => hold.releasedAt === null && hold.expiresAt <= at,
        after,
        limit,
      ).map(({ id }) => id);
    },
    release: async (client, ids, at) => {
      expect([client, at]).toEqual([tx, NOW]);
      current?.push(`release ${ids.join(',')}`);
      for (const hold of holds) {
        if (!ids.includes(hold.id) || hold.releasedAt !== null) continue;
        hold.releasedAt = at;
        const held = enrollment(hold.enrollmentId);
        const paid = orders.some(
          (o) => o.enrollmentId === hold.enrollmentId && o.status === 'paid',
        );
        if (held?.status === 'pending_payment' && !paid) held.status = 'cancelled';
      }
    },
    paidOrders: async (client, recordedBefore, after, limit) => {
      expect(client).toBe(tx);
      current?.push(`paid after ${after ?? '-'}`);
      return page(
        orders,
        (order) =>
          order.status === 'paid' &&
          order.paidRecordedAt !== null &&
          order.paidRecordedAt <= recordedBefore,
        after,
        limit,
      ).map(({ id, enrollmentId, paidRecordedAt }) => ({
        paymentId: id,
        enrollmentId,
        paidRecordedAt,
      }));
    },
    awaitingConfirmation: async (client, ids) => {
      expect(client).toBe(tx);
      current?.push(`awaiting ${ids.join(',')}`);
      return enrollments
        .filter(({ id, status }) => ids.includes(id) && status !== 'confirmed')
        .map(({ id }) => id);
    },
    latestCases: async (client, ids) => {
      expect(client).toBe(tx);
      current?.push(`cases ${ids.join(',')}`);
      return new Map(
        enrollments.flatMap(({ id, caseOpenedAt }) =>
          ids.includes(id) && caseOpenedAt !== undefined ? [[id, caseOpenedAt] as const] : [],
        ),
      );
    },
  };
  const confirmations = {
    enqueue: async (paymentId: string) => {
      queued.set(paymentId, (queued.get(paymentId) ?? 0) + 1);
    },
  };
  return { orders, holds, enrollments, transactions, queued, database, steps, confirmations };
}

const at = (iso: string) => new Date(iso);

describe('expire-pending-payments (T040, FR-364)', () => {
  it('runs every minute on a cron pattern in code, with no payload', () => {
    const world = paymentsWorld({});
    const job = expirePendingPayments({ ...world, settings: settingsOf(TIMEOUT_SECONDS) });
    expect(job.name).toBe(EXPIRE_PENDING_PAYMENTS);
    expect(job.name).toBe('expire-pending-payments');
    expect(job.schedule).toBe('* * * * *');
  });

  it('marks the created orders past their expiry expired, a page per transaction, and no other', async () => {
    const world = paymentsWorld({
      orders: [
        {
          id: 'o1',
          enrollmentId: 'e1',
          status: 'created',
          expiresAt: at('2026-11-03T07:50:00Z'),
          paidRecordedAt: null,
        },
        { id: 'o2', enrollmentId: 'e2', status: 'created', expiresAt: NOW, paidRecordedAt: null },
        {
          id: 'o3',
          enrollmentId: 'e3',
          status: 'created',
          expiresAt: at('2026-11-03T08:00:01Z'),
          paidRecordedAt: null,
        },
        {
          id: 'o4',
          enrollmentId: 'e4',
          status: 'failed',
          expiresAt: at('2026-11-03T07:00:00Z'),
          paidRecordedAt: null,
        },
        {
          id: 'o5',
          enrollmentId: 'e5',
          status: 'created',
          expiresAt: at('2026-11-03T06:00:00Z'),
          paidRecordedAt: null,
        },
      ],
    });
    const job = expirePendingPayments({
      ...world,
      settings: settingsOf(TIMEOUT_SECONDS),
      clock: () => NOW,
      pageSize: 2,
    });
    await job.handle({});
    expect(world.orders.map(({ id, status }) => [id, status])).toEqual([
      ['o1', 'expired'],
      ['o2', 'expired'],
      ['o3', 'created'],
      ['o4', 'failed'],
      ['o5', 'expired'],
    ]);
    expect(world.transactions.slice(0, 3)).toEqual([
      ['orders after -', 'expire o1,o2'],
      ['orders after o2', 'expire o5'],
      ['holds after -'],
    ]);
  });

  it('releases the expired holds that carry an enrollment through the one release, a page per transaction', async () => {
    const world = paymentsWorld({
      holds: [
        { id: 'h1', enrollmentId: 'e1', expiresAt: at('2026-11-03T07:00:00Z'), releasedAt: null },
        { id: 'h2', enrollmentId: 'e2', expiresAt: at('2026-11-03T08:10:00Z'), releasedAt: null },
        { id: 'h3', enrollmentId: 'e3', expiresAt: at('2026-11-03T07:59:00Z'), releasedAt: null },
      ],
      enrollments: [
        { id: 'e1', status: 'pending_payment' },
        { id: 'e2', status: 'pending_payment' },
        { id: 'e3', status: 'pending_payment' },
      ],
    });
    const job = expirePendingPayments({
      ...world,
      settings: settingsOf(TIMEOUT_SECONDS),
      clock: () => NOW,
      pageSize: 1,
    });
    await job.handle({});
    expect(world.transactions.filter((calls) => calls[0]?.startsWith('holds'))).toEqual([
      ['holds after -', 'release h1'],
      ['holds after h1', 'release h3'],
      ['holds after h3'],
    ]);
    expect(world.holds.map(({ releasedAt }) => releasedAt)).toEqual([NOW, null, NOW]);
    expect(world.enrollments.map(({ status }) => status)).toEqual([
      'cancelled',
      'pending_payment',
      'cancelled',
    ]);
  });

  it('hands to confirm-enrollment every paid order recorded before the timeout whose enrollment awaits it and that no case covers', async () => {
    const recorded = at('2026-11-03T07:59:45Z');
    const world = paymentsWorld({
      orders: [
        { id: 'o1', enrollmentId: 'e1', status: 'paid', expiresAt: NOW, paidRecordedAt: recorded },
        { id: 'o2', enrollmentId: 'e2', status: 'paid', expiresAt: NOW, paidRecordedAt: recorded },
        { id: 'o3', enrollmentId: 'e3', status: 'paid', expiresAt: NOW, paidRecordedAt: recorded },
        { id: 'o4', enrollmentId: 'e4', status: 'paid', expiresAt: NOW, paidRecordedAt: recorded },
        {
          id: 'o5',
          enrollmentId: 'e5',
          status: 'paid',
          expiresAt: NOW,
          paidRecordedAt: at('2026-11-03T07:59:46Z'),
        },
        { id: 'o6', enrollmentId: 'e6', status: 'failed', expiresAt: NOW, paidRecordedAt: null },
        { id: 'o7', enrollmentId: 'e7', status: 'paid', expiresAt: NOW, paidRecordedAt: recorded },
      ],
      enrollments: [
        { id: 'e1', status: 'pending_payment' },
        { id: 'e2', status: 'cancelled' },
        { id: 'e3', status: 'confirmed' },
        // A case opened after the paid event covers the order; one opened before it does not.
        { id: 'e4', status: 'cancelled', caseOpenedAt: at('2026-11-03T07:59:50Z') },
        { id: 'e5', status: 'pending_payment' },
        { id: 'e6', status: 'cancelled' },
        { id: 'e7', status: 'cancelled', caseOpenedAt: at('2026-11-03T07:00:00Z') },
      ],
    });
    const settings = settingsOf(TIMEOUT_SECONDS);
    const job = expirePendingPayments({ ...world, settings, clock: () => NOW, pageSize: 3 });
    await job.handle({});
    expect(settings.keys).toEqual([CONFIRMATION_TIMEOUT_SETTING]);
    expect([...world.queued.keys()]).toEqual(['o1', 'o2', 'o7']);
    expect(world.transactions.filter((calls) => calls[0]?.startsWith('paid'))).toEqual([
      ['paid after -', 'awaiting e1,e2,e3', 'cases e1,e2'],
      ['paid after o3', 'awaiting e4,e7', 'cases e4,e7'],
    ]);
  });

  it('reads the timeout before any work, and refuses to run without it', async () => {
    const world = paymentsWorld({
      orders: [
        {
          id: 'o1',
          enrollmentId: 'e1',
          status: 'created',
          expiresAt: at('2026-11-03T07:00:00Z'),
          paidRecordedAt: null,
        },
      ],
    });
    const job = expirePendingPayments({ ...world, settings: settingsOf(0), clock: () => NOW });
    await expect(job.handle({})).rejects.toBeInstanceOf(SettingError);
    expect(world.transactions).toEqual([]);
  });

  it('fails the run when a hand-off fails, for the queue to retry it', async () => {
    const world = paymentsWorld({
      orders: [
        {
          id: 'o1',
          enrollmentId: 'e1',
          status: 'paid',
          expiresAt: NOW,
          paidRecordedAt: at('2026-11-03T07:00:00Z'),
        },
      ],
      enrollments: [{ id: 'e1', status: 'pending_payment' }],
    });
    const job = expirePendingPayments({
      ...world,
      settings: settingsOf(TIMEOUT_SECONDS),
      clock: () => NOW,
      confirmations: {
        enqueue: async () => {
          throw new Error('The queue is unreachable');
        },
      },
    });
    await expect(job.handle({})).rejects.toThrow('The queue is unreachable');
  });

  it('runs twice as once (R-API-14): the same orders marked, holds released and job ids queued', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () =>
        paymentsWorld({
          orders: [
            {
              id: 'o1',
              enrollmentId: 'e1',
              status: 'created',
              expiresAt: at('2026-11-03T07:50:00Z'),
              paidRecordedAt: null,
            },
            {
              id: 'o2',
              enrollmentId: 'e2',
              status: 'paid',
              expiresAt: NOW,
              paidRecordedAt: at('2026-11-03T07:40:00Z'),
            },
          ],
          holds: [
            {
              id: 'h1',
              enrollmentId: 'e1',
              expiresAt: at('2026-11-03T07:55:00Z'),
              releasedAt: null,
            },
            {
              id: 'h2',
              enrollmentId: 'e2',
              expiresAt: at('2026-11-03T07:55:00Z'),
              releasedAt: null,
            },
          ],
          enrollments: [
            { id: 'e1', status: 'pending_payment' },
            { id: 'e2', status: 'pending_payment' },
          ],
        }),
      run: (world) =>
        expirePendingPayments({
          ...world,
          settings: settingsOf(TIMEOUT_SECONDS),
          clock: () => NOW,
        }).handle({}),
      observe: (world) => ({
        orders: world.orders.map(({ status }) => status),
        holds: world.holds.map(({ releasedAt }) => releasedAt),
        enrollments: world.enrollments.map(({ status }) => status),
        queued: [...world.queued.keys()],
      }),
    });
    expect(once).toEqual({
      orders: ['expired', 'paid'],
      holds: [NOW, NOW],
      enrollments: ['cancelled', 'pending_payment'],
      queued: ['o2'],
    });
    expect(twice).toEqual(once);
  });
});
