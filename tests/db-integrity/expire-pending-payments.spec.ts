// T040 — the expiry sweeps over the real tables, with the steps `worker.ts` binds (R-215, FR-363,
// FR-364, FR-PAYG-6, FR-PAYG-19; ARCHITECTURE §8.1; PR #109's review, M2 and round 2 N1).
//
//   - a paid event committed through the webhook with its enqueue dropped, then the sweep: the order
//     is handed to `confirm-enrollment`, which confirms the enrollment; the same with the student's
//     new checkout, or another student's hold on the slot, in between: confirmed or cancelled with
//     one compensation case, never a paid enrollment left cancelled without one;
//   - an expired hold's enrollment cancelled `payment_failed` when its last order failed and
//     `payment_expired` otherwise, with one `enrollment_events` row each, its created order marked
//     `expired`; one with a `paid` order left awaiting payment, with no row;
//   - not handed off: a paid order recorded within the timeout, and one whose enrollment has a case;
//   - `expire-holds` releases the expired holds that carry no enrollment, and nothing else;
//   - both sweeps run twice as once.
//
// The sweeps are global: they act on every row of the database, so the spec reads only its own
// worlds' rows, and runs `confirm-enrollment` only for its own orders. The files of this project run
// one at a time (`vitest.config.ts`), so no other file's world is mid-test meanwhile.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import { expireHolds } from '../../apps/api/src/jobs/expire-holds';
import { expirePendingPayments } from '../../apps/api/src/jobs/expire-pending-payments';
import { releaseExpiredHolds, releaseHolds } from '../../apps/api/src/modules/booking/index';
import { openCompensationCase } from '../../apps/api/src/modules/moderation/index';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { CAIRO, confirmationWorld, FOUR_THURSDAYS, NOW, THURSDAY_0900 } from './confirmation-world';
import {
  expirySettings,
  farFuture,
  listenWebhook,
  plainOrder,
  plantOrder,
  sweepInstant,
  type Webhook,
} from './expiry-world';

let database: Database;
let webhook: Webhook;
/** Every order the sweep handed to `confirm-enrollment`, in order. */
const handedOff: string[] = [];

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  // The webhook's enqueue dropped: the paid event is committed and nothing is queued.
  webhook = await listenWebhook(database, { enqueue: async () => undefined });
}, 60_000);

afterAll(async () => {
  await webhook?.close();
  if (database !== undefined) await closeDatabase(database);
});

const { person, world, order, enrollmentOf, holdsOf, sessionsOf, eventsOf, casesOf } =
  confirmationWorld(() => database);

const confirmations = {
  enqueue: async (paymentId: string) => {
    handedOff.push(paymentId);
  },
};

/** One run of `expire-pending-payments` at `at`. */
function sweep(at: Date = sweepInstant()): Promise<void> {
  return expirePendingPayments({
    database,
    settings: expirySettings,
    confirmations,
    clock: () => at,
  }).handle({});
}

/** One run of `expire-holds` at `at`. */
function sweepHolds(at: Date = sweepInstant()): Promise<void> {
  return expireHolds({ database, clock: () => at }).handle({});
}

/** The sweep, then `confirm-enrollment` for the order when the sweep handed it on. */
async function sweepThenConfirm(paymentId: string): Promise<void> {
  handedOff.length = 0;
  await sweep();
  expect(handedOff).toContain(paymentId);
  await confirmEnrollment({ database, settings: expirySettings, clock: () => NOW }).handle({
    paymentId,
  });
}

/** A paid event delivered over the webhook, committed, its enqueue dropped. */
async function paidThroughWebhook(gatewayOrderId: string): Promise<void> {
  expect(await webhook.stand.deliver(webhook.stand.paid(gatewayOrderId))).toBe(200);
}

/** Confirmed, or cancelled with exactly one compensation case: never cancelled without one. */
async function honoured(enrollmentId: string): Promise<'confirmed' | 'cancelled with one case'> {
  const { status } = await enrollmentOf(enrollmentId);
  const cases = await casesOf(enrollmentId);
  if (status === 'confirmed' && cases.length === 0) return 'confirmed';
  expect(status).toBe('cancelled');
  expect(cases).toHaveLength(1);
  return 'cancelled with one case';
}

describe('a paid event whose enqueue was dropped, then the sweep (M2, round 2 N1)', () => {
  it('is handed to confirm-enrollment, which confirms the enrollment', async () => {
    const on = await world();
    const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
    await paidThroughWebhook(gatewayOrderId);
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');

    await sweepThenConfirm(paymentId);

    expect(await honoured(on.enrollmentId)).toBe('confirmed');
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
    expect(
      (await eventsOf(on.enrollmentId)).map(({ kind, paymentId: named }) => [kind, named]),
    ).toEqual([['confirmed', paymentId]]);
  }, 60_000);

  it('with the student’s new checkout in between: one compensation case, the new checkout undisturbed', async () => {
    const on = await world();
    const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
    await paidThroughWebhook(gatewayOrderId);
    // FR-BOOK-12: the new checkout releases the old hold and holds another slot.
    const { id: elsewhere } = await database.availabilitySlot.create({
      data: {
        teacherUserId: on.teacherId,
        dayOfWeek: 6,
        startTimeLocal: THURSDAY_0900,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const newHold = await database.$transaction(async (tx) => {
      await releaseHolds(tx, [on.holdId], 'checkout_abandoned', {
        at: NOW,
        orders: orderStandingsOf,
      });
      const { id } = await tx.slotHold.create({
        data: { slotId: elsewhere, studentUserId: on.studentId, expiresAt: farFuture() },
        select: { id: true },
      });
      return id;
    });
    // The paid order keeps its enrollment awaiting payment (FR-363 as amended).
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');

    await sweepThenConfirm(paymentId);

    expect(await honoured(on.enrollmentId)).toBe('cancelled with one case');
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      cancellationReason: 'slot_unavailable',
    });
    const kept = await database.slotHold.findUniqueOrThrow({ where: { id: newHold } });
    expect(kept.releasedAt).toBeNull();
  }, 60_000);

  it('with another student’s hold on the slot in between: one compensation case', async () => {
    const on = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
    const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
    await paidThroughWebhook(gatewayOrderId);
    // FR-351: another student's placement releases the expired hold on the slot, then holds it.
    const other = await person('female');
    await database.$transaction(async (tx) => {
      await releaseExpiredHolds(tx, { slotId: on.slotId }, { at: NOW, orders: orderStandingsOf });
      await tx.slotHold.create({
        data: { slotId: on.slotId, studentUserId: other, expiresAt: farFuture() },
      });
    });
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');

    await sweepThenConfirm(paymentId);

    expect(await honoured(on.enrollmentId)).toBe('cancelled with one case');
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'slot_unavailable',
    ]);
  }, 60_000);

  it('cancelled by the student’s new checkout before it was paid: confirmed by the late branch', async () => {
    const on = await world();
    const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
    await database.$transaction((tx) =>
      releaseHolds(tx, [on.holdId], 'checkout_abandoned', { at: NOW, orders: orderStandingsOf }),
    );
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'checkout_abandoned',
    });
    await paidThroughWebhook(gatewayOrderId);

    await sweepThenConfirm(paymentId);

    expect(await honoured(on.enrollmentId)).toBe('confirmed');
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
  }, 60_000);
});

describe('expire-pending-payments releases expired holds (FR-363, FR-364, FR-PAYG-6)', () => {
  it('cancels payment_failed when the last order failed, with one cancelled row', async () => {
    const on = await world();
    await plainOrder(database, on.enrollmentId, 'created');
    await plainOrder(database, on.enrollmentId, 'failed');
    const at = sweepInstant();
    await sweep(at);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'payment_failed',
      confirmedAt: null,
    });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: at }]);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'cancelled', cancellationReason: 'payment_failed', paymentId: null, occurredAt: at },
    ]);
  });

  it('cancels payment_expired otherwise, with one cancelled row, and marks the created order expired', async () => {
    const on = await world();
    const failed = await plainOrder(database, on.enrollmentId, 'failed');
    const created = await plainOrder(database, on.enrollmentId, 'created');
    const at = sweepInstant();
    await sweep(at);
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
    });
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'cancelled', cancellationReason: 'payment_expired', paymentId: null, occurredAt: at },
    ]);
    const orders = await database.payment.findMany({
      where: { enrollmentId: on.enrollmentId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, checkoutUrlEncrypted: true },
    });
    expect(orders).toEqual([
      { id: failed, status: 'failed', checkoutUrlEncrypted: null },
      { id: created, status: 'expired', checkoutUrlEncrypted: null },
    ]);
  });

  it('cancels payment_expired an enrollment with no order', async () => {
    const on = await world();
    await sweep();
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
    });
    expect(await eventsOf(on.enrollmentId)).toHaveLength(1);
  });

  it('keeps an enrollment with a paid order awaiting payment, with no row, and hands its order on', async () => {
    const on = await world();
    const paid = await order(on.enrollmentId);
    const at = sweepInstant();
    handedOff.length = 0;
    await sweep(at);
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: at }]);
    expect(await eventsOf(on.enrollmentId)).toEqual([]);
    expect(handedOff).toContain(paid);
  });

  it('leaves a hold that has not expired, and its order', async () => {
    const on = await world();
    await database.slotHold.update({ where: { id: on.holdId }, data: { expiresAt: farFuture() } });
    const created = await plainOrder(database, on.enrollmentId, 'created', farFuture());
    await sweep();
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: null }]);
    const { status } = await database.payment.findUniqueOrThrow({ where: { id: created } });
    expect(status).toBe('created');
  });
});

describe('expire-pending-payments hands on only what awaits confirmation', () => {
  it('not a paid order recorded within the timeout', async () => {
    const on = await world();
    const paid = await order(on.enrollmentId);
    handedOff.length = 0;
    await sweep(new Date());
    expect(handedOff).not.toContain(paid);
  });

  it('not a paid order whose enrollment has a compensation case', async () => {
    const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    const paid = await order(on.enrollmentId);
    await database.$transaction((tx) =>
      openCompensationCase(tx, on.enrollmentId, 'slot_unavailable'),
    );
    handedOff.length = 0;
    await sweep();
    expect(handedOff).not.toContain(paid);
  });

  it('not a paid order whose enrollment is confirmed', async () => {
    const on = await world();
    const paid = await order(on.enrollmentId);
    await confirmEnrollment({ database, settings: expirySettings, clock: () => NOW }).handle({
      paymentId: paid,
    });
    handedOff.length = 0;
    await sweep();
    expect(handedOff).not.toContain(paid);
  });
});

describe('expire-holds (FR-364, ADR 0010 D7)', () => {
  /** A hold that carries no enrollment: a student in checkout who never pressed Pay. */
  async function checkoutHold(teacherId: string, expiresAt: Date): Promise<string> {
    const { id: slotId } = await database.availabilitySlot.create({
      data: {
        teacherUserId: teacherId,
        dayOfWeek: 2,
        startTimeLocal: THURSDAY_0900,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const { id } = await database.slotHold.create({
      data: { slotId, studentUserId: await person('female'), expiresAt },
      select: { id: true },
    });
    return id;
  }

  const releasedAt = async (id: string) =>
    (await database.slotHold.findUniqueOrThrow({ where: { id } })).releasedAt;

  it('releases the expired holds that carry no enrollment, and leaves the running ones and the linked ones', async () => {
    const on = await world();
    const expired = await checkoutHold(on.teacherId, NOW);
    const running = await checkoutHold(on.teacherId, farFuture());
    const at = sweepInstant();
    await sweepHolds(at);
    expect(await releasedAt(expired)).toEqual(at);
    expect(await releasedAt(running)).toBeNull();
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: null }]);
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');
  });

  it('runs twice as once (R-API-14)', async () => {
    const at = sweepInstant();
    const { once, twice } = await runOnceAndTwice({
      world: async () => {
        const on = await world();
        return {
          expired: await checkoutHold(on.teacherId, NOW),
          running: await checkoutHold(on.teacherId, farFuture()),
        };
      },
      run: () => sweepHolds(at),
      observe: async ({ expired, running }) => ({
        expired: (await releasedAt(expired)) !== null,
        running: await releasedAt(running),
      }),
    });
    expect(once).toEqual({ expired: true, running: null });
    expect(twice).toEqual(once);
  });
});

describe('expire-pending-payments runs twice as once (R-API-14)', () => {
  it('one cancellation, one row, the order expired once, the paid order handed on once', async () => {
    const at = sweepInstant();
    const { once, twice } = await runOnceAndTwice({
      world: async () => {
        const failing = await world();
        await plainOrder(database, failing.enrollmentId, 'created');
        const paying = await world();
        return { failing, paying, paid: await order(paying.enrollmentId) };
      },
      run: async () => {
        await sweep(at);
      },
      observe: async ({ failing, paying, paid }) => {
        const queued = new Set(handedOff.splice(0)).has(paid);
        return {
          failing: await enrollmentOf(failing.enrollmentId),
          failingEvents: (await eventsOf(failing.enrollmentId)).map(
            ({ kind, cancellationReason }) => [kind, cancellationReason],
          ),
          orders: (
            await database.payment.findMany({
              where: { enrollmentId: failing.enrollmentId },
              select: { status: true },
            })
          ).map(({ status }) => status),
          paying: await enrollmentOf(paying.enrollmentId),
          payingEvents: await eventsOf(paying.enrollmentId),
          queued,
        };
      },
    });
    expect(once).toMatchObject({
      failing: { status: 'cancelled', cancellationReason: 'payment_expired' },
      failingEvents: [['cancelled', 'payment_expired']],
      orders: ['expired'],
      paying: { status: 'pending_payment' },
      payingEvents: [],
      queued: true,
    });
    expect(twice).toEqual(once);
  });
});
