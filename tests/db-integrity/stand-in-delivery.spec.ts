// T042 (FR-373, FR-366, FR-385, SC-311, SC-313; contracts/kernel.md, contracts/gateway.md "The test
// harness"): the gateway stand-in delivering as a real gateway may, through the harness, over HTTP to
// the webhook the application mounts, and `confirm-enrollment` running over the real tables. Each
// case reads its outcome and its `enrollment_events` rows:
//
//   - `deliverTwice`: the same paid event twice is recorded once, and both deliveries enqueue the
//     job (R-214), which confirms once: one confirmation, one converted hold, one set of sessions;
//   - `deliverInOrder` reversed: a failure or an expiry that happened before the paid event but
//     arrives after it changes nothing and undoes no confirmation, whether the job ran before it
//     arrived or after; in the order they happened, the failure is recorded as `order_failed` and
//     the paid event then confirms;
//   - a paid event after the hold expired (`deliverAfter`, the expiry sweep in its hook): the
//     enrollment, cancelled `payment_expired`, is re-held and confirmed (FR-362, FR-PAYG-19);
//   - a paid event after the slot was re-held by another student once the hold expired: the
//     database refuses the re-hold, the enrollment stays cancelled with `slot_unavailable` and one
//     compensation case is opened, the other student's hold untouched (FR-362).
//
// WHY HERE, and not under `apps/api/src/modules/payments/` as the task line names it. Each case
// needs a world in identity's, catalog's, booking's and payments' tables, and a spec under
// `apps/api/src/modules/payments/` may reach no table but payments' (`api/table-ownership`,
// R-API-6, which holds spec files too, and refuses `$queryRaw` outside the kernel) and cannot import
// the test tree, `apps/api`'s `rootDir` being `src`. The worlds of `confirmation-world.ts` and the
// webhook of `expiry-world.ts` are the test tree's, as T039's and T040's probes use them.
//
// THE QUEUE. The webhook's `confirm-enrollment` queue is the spec's: by default it runs the job as
// soon as the webhook enqueues it, after the event's commit, as a worker that takes the job at once
// would; a case that holds it runs the jobs it was given later, in order. The sweep's own hand-off
// is dropped: the cases' orders are not paid when it runs. The sweep is global, as T040's probe
// says; the files of this project run one at a time (`vitest.config.ts`), so no other file's world
// is mid-test meanwhile.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { expirePendingPayments } from '../../apps/api/src/jobs/expire-pending-payments';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { confirmationWorld, FOUR_THURSDAYS, NOW } from './confirmation-world';
import {
  expirySettings,
  farFuture,
  listenWebhook,
  plantOrder,
  sweepInstant,
  type Webhook,
} from './expiry-world';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

let database: Database;
let webhook: Webhook;
/** Whether the queue holds what it is given until `runHeld`, rather than running it at once. */
let holding = false;
const held: string[] = [];
/** Every run of the job, by order. */
const runs = new Map<string, number>();

const runJob = async (paymentId: string): Promise<void> => {
  runs.set(paymentId, (runs.get(paymentId) ?? 0) + 1);
  await confirmEnrollment({ database, settings: expirySettings, notices: NO_PUSH, clock: () => NOW }).handle({
    paymentId,
  });
};

/** Runs, in order, the jobs the queue held, and runs the next ones at once. */
async function runHeld(): Promise<void> {
  holding = false;
  for (const paymentId of held.splice(0)) await runJob(paymentId);
}

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  webhook = await listenWebhook(database, {
    enqueue: async (paymentId) => {
      if (holding) held.push(paymentId);
      else await runJob(paymentId);
    },
  });
}, 60_000);

beforeEach(() => {
  holding = false;
  held.length = 0;
});

afterAll(async () => {
  await webhook?.close();
  if (database !== undefined) await closeDatabase(database);
});

const { person, world, order, enrollmentOf, holdsOf, sessionsOf, eventsOf, casesOf } =
  confirmationWorld(() => database);

/** The order's status and its recorded events, in the order they were recorded. */
async function orderOf(paymentId: string) {
  const [{ status }, events] = await Promise.all([
    database.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } }),
    database.paymentEvent.findMany({
      where: { paymentId },
      orderBy: { id: 'asc' },
      select: { providerEventId: true, eventType: true },
    }),
  ]);
  return { status, events };
}

/** One run of `expire-pending-payments` at `at`, its hand-off dropped. */
function sweep(at: Date): Promise<void> {
  return expirePendingPayments({
    notices: NO_PUSH,
    database,
    settings: expirySettings,
    confirmations: { enqueue: async () => undefined },
    clock: () => at,
  }).handle({});
}

/** A world awaiting payment with its hold running, and an order the stand-in created for it. */
async function checkout() {
  const on = await world();
  const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
  return { on, gatewayOrderId, paymentId };
}

/** What FR-361 leaves: confirmed at the job's instant by the order, its sessions, no case. */
async function expectConfirmedBy(enrollmentId: string, paymentId: string): Promise<void> {
  expect(await enrollmentOf(enrollmentId)).toEqual({
    status: 'confirmed',
    cancellationReason: null,
    confirmedAt: NOW,
  });
  expect(await sessionsOf(enrollmentId)).toEqual(FOUR_THURSDAYS);
  expect(await casesOf(enrollmentId)).toEqual([]);
  expect((await orderOf(paymentId)).status).toBe('paid');
}

const confirmedRow = (paymentId: string) => ({
  kind: 'confirmed',
  cancellationReason: null,
  paymentId,
  occurredAt: NOW,
});

describe('deliverTwice: one paid event delivered twice (FR-373, SC-311)', () => {
  it('is recorded once, runs the job twice, and confirms once', async () => {
    const { on, gatewayOrderId, paymentId } = await checkout();
    const paid = webhook.stand.paid(gatewayOrderId);

    expect(await webhook.stand.deliverTwice(paid)).toEqual([200, 200]);

    expect(runs.get(paymentId)).toBe(2);
    await expectConfirmedBy(on.enrollmentId, paymentId);
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
    expect(await eventsOf(on.enrollmentId)).toEqual([confirmedRow(paymentId)]);
    expect((await orderOf(paymentId)).events).toEqual([
      { providerEventId: paid.providerEventId, eventType: 'paid' },
    ]);
  }, 60_000);
});

describe('deliverInOrder: a failure or an expiry arriving after the paid event (FR-373, SC-311)', () => {
  const cases = [
    ['failed', 'the job run before it arrives'],
    ['failed', 'the job run after it arrives'],
    ['expired', 'the job run before it arrives'],
    ['expired', 'the job run after it arrives'],
  ] as const;

  it.each(cases)(
    'a late %s changes nothing and undoes no confirmation, %s',
    async (late, when) => {
      const { on, gatewayOrderId, paymentId } = await checkout();
      // They happened in this order: the attempt failed (or the order expired), then it was paid.
      const first =
        late === 'failed'
          ? webhook.stand.failed(gatewayOrderId)
          : webhook.stand.expired(gatewayOrderId);
      const paid = webhook.stand.paid(gatewayOrderId);
      holding = when === 'the job run after it arrives';

      expect(await webhook.stand.deliverInOrder([paid, first])).toEqual([200, 200]);
      await runHeld();

      expect(runs.get(paymentId)).toBe(1);
      await expectConfirmedBy(on.enrollmentId, paymentId);
      expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
      // No `order_failed` row: the failure moved nothing (R-214, FR-385).
      expect(await eventsOf(on.enrollmentId)).toEqual([confirmedRow(paymentId)]);
      expect((await orderOf(paymentId)).events).toEqual([
        { providerEventId: paid.providerEventId, eventType: 'paid' },
        { providerEventId: first.providerEventId, eventType: late },
      ]);
    },
    60_000,
  );

  it('in the order they happened, the failure is recorded, and the paid event then confirms', async () => {
    const { on, gatewayOrderId, paymentId } = await checkout();
    const failed = webhook.stand.failed(gatewayOrderId);
    const paid = webhook.stand.paid(gatewayOrderId);

    expect(await webhook.stand.deliverInOrder([failed, paid])).toEqual([200, 200]);

    expect(runs.get(paymentId)).toBe(1);
    await expectConfirmedBy(on.enrollmentId, paymentId);
    const rows = await eventsOf(on.enrollmentId);
    expect(rows.map(({ kind, paymentId: named }) => [kind, named])).toEqual([
      ['order_failed', paymentId],
      ['confirmed', paymentId],
    ]);
    expect(rows[1]).toEqual(confirmedRow(paymentId));
  }, 60_000);
});

describe('deliverAfter: a paid event after the hold expired (FR-373, FR-362, FR-PAYG-19)', () => {
  it('re-holds the slot and confirms the enrollment the sweep cancelled', async () => {
    const { on, gatewayOrderId, paymentId } = await checkout();
    const paid = webhook.stand.paid(gatewayOrderId);
    const at = sweepInstant();

    const status = await webhook.stand.deliverAfter(paid, async () => {
      await sweep(at);
      expect(await enrollmentOf(on.enrollmentId)).toEqual({
        status: 'cancelled',
        cancellationReason: 'payment_expired',
        confirmedAt: null,
      });
      expect((await orderOf(paymentId)).status).toBe('expired');
    });

    expect(status).toBe(200);
    expect(runs.get(paymentId)).toBe(1);
    await expectConfirmedBy(on.enrollmentId, paymentId);
    expect(await holdsOf(on.enrollmentId)).toEqual([
      { id: on.holdId, releasedAt: at },
      { id: expect.any(String), releasedAt: NOW },
    ]);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'cancelled', cancellationReason: 'payment_expired', paymentId: null, occurredAt: at },
      confirmedRow(paymentId),
    ]);
  }, 60_000);
});

describe('deliverAfter: a paid event after the slot was re-held by another student (FR-373, FR-362)', () => {
  it('is refused: cancelled slot_unavailable, one compensation case, the other hold kept', async () => {
    const { on, gatewayOrderId, paymentId } = await checkout();
    const paid = webhook.stand.paid(gatewayOrderId);
    const at = sweepInstant();
    const other = await person('female');
    let otherHold = '';

    const status = await webhook.stand.deliverAfter(paid, async () => {
      await sweep(at);
      // FR-351: another student holds the slot the expired hold left free.
      ({ id: otherHold } = await database.slotHold.create({
        data: {
          slotId: on.slotId,
          packageId: on.packageId,
          sessionCount: 4,
          studentUserId: other,
          expiresAt: farFuture(),
        },
        select: { id: true },
      }));
    });

    expect(status).toBe(200);
    expect(runs.get(paymentId)).toBe(1);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
      confirmedAt: null,
    });
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: at }]);
    expect(
      (await casesOf(on.enrollmentId)).map(({ kind, reason, status: state }) => [
        kind,
        reason,
        state,
      ]),
    ).toEqual([['compensation_case', 'slot_unavailable', 'open']]);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'cancelled', cancellationReason: 'payment_expired', paymentId: null, occurredAt: at },
      {
        kind: 'cancelled',
        cancellationReason: 'slot_unavailable',
        paymentId: null,
        occurredAt: NOW,
      },
    ]);
    const kept = await database.slotHold.findUniqueOrThrow({
      where: { id: otherHold },
      select: { releasedAt: true },
    });
    expect(kept.releasedAt).toBeNull();
    expect((await orderOf(paymentId)).status).toBe('paid');
  }, 60_000);
});
