// 005:T016 of specs/005-certification (FR-619; SRS DEC-70; the note under T016, Q-N1 (a), Q-N2 (a),
// Q-N3 (a) with the review's condition) — the payment pushes over the real tables, with the
// notifications module's real writer bound as `main.ts` and `worker.ts` bind it.
//
// THE REVIEW'S CONDITION. Every caller of booking's `recordEnrollmentEvents` that can write
// `confirmed`, `order_failed` or `cancelled` with `payment_expired` commits, on its real
// transaction, with its `notifications` row: the student's, payload the enrollment's id only.
//
//   caller (file)                                   transaction that binds its list
//   booking `confirmEnrollment` (confirmed)          confirm-enrollment, the `'confirm'` attempt
//   booking `reholdEnrollment` (cancelled, expired)  confirm-enrollment, the `'confirm'` attempt
//   booking `recordOrderFailed` (order_failed)       payments' order events (`record()`)
//   booking `placeHold` (cancelled, expired)         the checkout's hold (`checkout.hold`)
//   booking `releaseHolds` (cancelled, expired)      expire-pending-payments, a page of holds
//   booking `releaseHolds` (cancelled, expired)      expire-holds, a page (a Pay linked meanwhile)
//
// Each is red under the mutant «list not bound» at its site (lane A's `mutants\`): the writer
// refuses (`no_after_commit_list`) and the transaction rolls back, row and outcome together. Also:
// a `'confirm'` attempt the database refuses leaves no `payment_confirmed` row and the `'refuse'`
// attempt commits; a replayed failed event writes no second row; a cancellation for a failed
// payment pushes nothing (its order's failure was pushed); a refused late payment records its
// `cancelled` outcome with no push (Q-A1 (b)); the checkout's own gateway cancellation of an earlier
// order records its `order_failed` outcome with no push (#148 Saif r1, Major 2: the platform
// cancelled it, and nothing is left to Retry), and the gateway's own later failed and expired events
// for that order record nothing more (#148 Saif r2, Follow-up 1: red under R2M5, `MOVES_FROM.failed`
// admitting `failed`). Every queued id names a committed row.
// The rows are committed, each probe with a world of its own; every connection is the application
// role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { expireHolds, holdExpiryStepsOf } from '../../apps/api/src/jobs/expire-holds';
import { expirePendingPayments } from '../../apps/api/src/jobs/expire-pending-payments';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index';
import { createCheckoutServices } from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { addMinutes } from '../../packages/time/src/index';
import {
  CAIRO,
  confirmationWorld,
  EARLIER,
  NOW,
  settings,
  THURSDAY_0900,
} from './confirmation-world';
import {
  expirySettings,
  listenWebhook,
  plainOrder,
  plantOrder,
  sweepInstant,
  type Webhook,
} from './expiry-world';

let database: Database;
let webhook: Webhook;
/** The notification ids the writer queued after each commit (`deliver-notification`'s queue). */
const queued: string[] = [];
const SILENT = { info: () => undefined, warn: () => undefined };

/** The one writer, as `main.ts` and `worker.ts` bind it, its queue the spec's own. */
let writer: ReturnType<typeof createNotificationWriter>;

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  writer = createNotificationWriter({
    database,
    queue: {
      enqueue: async (notificationId) => {
        queued.push(notificationId);
      },
    },
    log: SILENT,
  });
  webhook = await listenWebhook(database, { enqueue: async () => undefined }, writer);
});

afterAll(async () => {
  await webhook?.close();
  if (database !== undefined) await closeDatabase(database);
});

const { person, world, order, enrollmentOf, eventsOf, casesOf } = confirmationWorld(() => database);

const confirm = (paymentId: string) =>
  confirmEnrollment({ database, settings, notices: writer, clock: () => NOW }).handle({
    paymentId,
  });

/** The pushes of `userIds`, as the writer stored them, in id order. */
async function pushesOf(...userIds: string[]) {
  const rows = await database.notification.findMany({
    where: { userId: { in: userIds } },
    orderBy: { id: 'asc' },
    select: { id: true, userId: true, type: true, payload: true },
  });
  return rows.map(({ userId, type, payload }) => ({ userId, type, payload }));
}

/** Every id the writer queued names a committed row: nothing of a rolled-back attempt was sent. */
async function queuedAreCommitted(): Promise<void> {
  const rows = await database.notification.findMany({
    where: { id: { in: queued } },
    select: { id: true },
  });
  expect(rows.length).toBe(new Set(queued).size);
}

const push = (userId: string, type: string, enrollmentId: string) => ({
  userId,
  type,
  payload: { enrollment_id: enrollmentId },
});

/** Another student's enrollment awaiting payment on `slotId`, its hold expired and not released. */
async function expiredCheckoutOn(on: Awaited<ReturnType<typeof world>>) {
  const studentId = await person('female');
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: on.teacherId,
      packageId: on.packageId,
      slotId: on.slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 4,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: on.subjectId,
      snapshotSlotTimezone: CAIRO,
      status: 'pending_payment',
      purchasedAt: EARLIER,
      quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
    },
    select: { id: true },
  });
  const { id: holdId } = await database.slotHold.create({
    data: {
      slotId: on.slotId,
      packageId: on.packageId,
      sessionCount: 4,
      studentUserId: studentId,
      enrollmentId,
      expiresAt: EARLIER,
    },
    select: { id: true },
  });
  return { studentId, enrollmentId, holdId };
}

describe('confirm-enrollment pushes on each attempt’s transaction (005:T016)', () => {
  it('a confirmation commits with one payment_confirmed row for the student, queued after the commit', async () => {
    const on = await world();
    await confirm(await order(on.enrollmentId));
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('confirmed');
    expect(await pushesOf(on.studentId, on.teacherId)).toEqual([
      push(on.studentId, 'payment_confirmed', on.enrollmentId),
    ]);
    await queuedAreCommitted();
  });

  it('a late payment’s re-hold pushes payment_expired to the student whose expired checkout it releases, and payment_confirmed to the payer', async () => {
    const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    const other = await expiredCheckoutOn(on);
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(other.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
    });
    expect(await pushesOf(on.studentId, other.studentId)).toEqual([
      push(other.studentId, 'payment_expired', other.enrollmentId),
      push(on.studentId, 'payment_confirmed', on.enrollmentId),
    ]);
  });

  it('a confirm attempt the database refuses leaves no payment_confirmed row; the refuse attempt commits, pushing nothing for slot_unavailable', async () => {
    const on = await world();
    // The student's confirmed session with another teacher at the enrollment's second Thursday.
    const elsewhere = await world();
    const { id: otherEnrollment } = await database.enrollment.create({
      data: {
        studentUserId: on.studentId,
        teacherUserId: elsewhere.teacherId,
        packageId: elsewhere.packageId,
        slotId: elsewhere.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: elsewhere.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'confirmed',
        confirmedAt: EARLIER,
        purchasedAt: EARLIER,
        quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
      },
      select: { id: true },
    });
    await database.session.create({
      data: {
        enrollmentId: otherEnrollment,
        teacherUserId: elsewhere.teacherId,
        studentUserId: on.studentId,
        sequenceNumber: 1,
        scheduledDateLocal: new Date('2026-11-12T00:00:00Z'),
        scheduledStartTimeLocal: THURSDAY_0900,
        timezone: CAIRO,
        scheduledStartAt: new Date('2026-11-12T07:00:00Z'),
        scheduledEndAt: new Date('2026-11-12T08:00:00Z'),
        status: 'scheduled',
      },
    });
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
    });
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'slot_unavailable',
    ]);
    expect(await pushesOf(on.studentId)).toEqual([]);
    await queuedAreCommitted();
  });

  // Q-A1 (b), the owner's answer of 2026-11-18: a refused late payment records its `cancelled`
  // outcome without a push, so an enrollment already cancelled for an expired payment is not told
  // twice («none twice for one order»).
  it('a refusal for a party of an enrollment cancelled for an expired payment records that cancellation again, with no push (Q-A1 (b))', async () => {
    const on = await world({
      teacher: 'suspended',
      enrollment: { status: 'cancelled', reason: 'payment_expired' },
    });
    await confirm(await order(on.enrollmentId));
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'party_restricted',
    ]);
    expect(
      (await eventsOf(on.enrollmentId)).map(({ kind, cancellationReason }) => [
        kind,
        cancellationReason,
      ]),
    ).toEqual([['cancelled', 'payment_expired']]);
    expect(await pushesOf(on.studentId)).toEqual([]);
  });
});

describe('payments’ order events push a failed order (005:T016)', () => {
  it('a failed event commits with its order_failed outcome and one payment_failed row; its replay writes no second', async () => {
    const on = await world();
    const { gatewayOrderId } = await plantOrder(webhook, order, on.enrollmentId);
    const failed = webhook.stand.failed(gatewayOrderId);
    expect(await webhook.stand.deliver(failed)).toBe(200);
    expect(await pushesOf(on.studentId, on.teacherId)).toEqual([
      push(on.studentId, 'payment_failed', on.enrollmentId),
    ]);
    expect(await webhook.stand.deliver(failed)).toBe(200);
    expect(await pushesOf(on.studentId)).toHaveLength(1);
    await queuedAreCommitted();
  });
});

describe('the sweeps push an expired payment (005:T016)', () => {
  it('expire-pending-payments: a hold released for an expired payment pushes payment_expired; one whose last order failed pushes nothing', async () => {
    const expired = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
    const failing = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
    await plainOrder(database, failing.enrollmentId, 'failed');
    await expirePendingPayments({
      database,
      settings: expirySettings,
      confirmations: { enqueue: async () => undefined },
      notices: writer,
      clock: sweepInstant,
    }).handle({});
    expect(await enrollmentOf(failing.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_failed',
    });
    expect(await pushesOf(expired.studentId, failing.studentId)).toEqual([
      push(expired.studentId, 'payment_expired', expired.enrollmentId),
    ]);
    await queuedAreCommitted();
  });

  it('expire-holds: a hold a Pay linked after the page was read is released with its payment_expired push', async () => {
    const on = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
    const real = holdExpiryStepsOf(writer);
    await expireHolds({
      database,
      notices: writer,
      // The page read before the Pay linked the hold: its id, though it now carries an enrollment.
      steps: {
        ...real,
        expiredHolds: async (_tx, _at, after) => (after === undefined ? [on.holdId] : []),
      },
      clock: () => NOW,
      pageSize: 1,
    }).handle({});
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
    });
    expect(await pushesOf(on.studentId)).toEqual([
      push(on.studentId, 'payment_expired', on.enrollmentId),
    ]);
  });
});

// The checkout, over the stand-in gateway, at the real clock.
const CHECKOUT_SETTINGS: Readonly<Record<string, unknown>> = {
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  idempotency_key_ttl_hours: 24,
  teacher_share_percent: 70,
};
const checkoutSettings: SettingsReader = {
  read: async (key, schema) => schema.parse(CHECKOUT_SETTINGS[key]),
};

/** The checkout; `payment` the webhook's stand-in when a case sends the gateway's events for its orders. */
function checkoutServices(payment?: Webhook['payment']) {
  const config: PaymentConfig = {
    PAYMENT_GATEWAY: 'fake',
    PAYMENT_MODE: 'test',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  return createCheckoutServices({
    database,
    settings: checkoutSettings,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings: checkoutSettings,
    }),
    payment: payment ?? createPaymentPort(config),
    cipher: new ColumnCipher(randomBytes(32).toString('base64')),
    gateway: 'fake',
    notices: writer,
  });
}

/** A student's enrollment awaiting payment on a hold of the world's slot expiring in `minutes`. */
async function checkoutOn(on: Awaited<ReturnType<typeof world>>, minutes: number) {
  const studentId = await person('female');
  return database.$transaction(async (tx) => {
    const { id: enrollmentId } = await tx.enrollment.create({
      data: {
        studentUserId: studentId,
        teacherUserId: on.teacherId,
        packageId: on.packageId,
        slotId: on.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: on.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'pending_payment',
        purchasedAt: new Date(),
        quotedFirstSessionLocalDate: new Date('2026-12-03T00:00:00Z'),
      },
      select: { id: true },
    });
    const { id: holdId } = await tx.slotHold.create({
      data: {
        slotId: on.slotId,
        studentUserId: studentId,
        packageId: on.packageId,
        sessionCount: 4,
        enrollmentId,
        expiresAt: new Date(addMinutes(new Date(), minutes)),
      },
      select: { id: true },
    });
    return { studentId, enrollmentId, holdId };
  });
}

describe('the checkout pushes (005:T016)', () => {
  const ENDED = { status: 'cancelled', reason: 'payment_expired' } as const;

  it('checkout.hold: the placement releasing another student’s expired checkout pushes that student payment_expired', async () => {
    // The world's own enrollment, ended earlier, occupies nothing.
    const on = await world({ enrollment: ENDED });
    const stale = await checkoutOn(on, -30);
    const newcomer = await person('female');
    await checkoutServices().hold(
      { userId: newcomer, gender: 'female' as RequesterGender },
      { packageId: on.packageId, slotId: on.slotId, idempotencyKey: randomUUID() },
    );
    expect(await enrollmentOf(stale.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
    });
    expect(await pushesOf(stale.studentId, newcomer)).toEqual([
      push(stale.studentId, 'payment_expired', stale.enrollmentId),
    ]);
    await queuedAreCommitted();
  });

  it('checkout.hold: an earlier order the gateway cancels is recorded failed with no push (#148 Saif r1, Major 2)', async () => {
    const [first, second] = [
      await world({ enrollment: ENDED }),
      await world({ enrollment: ENDED }),
    ];
    const own = await checkoutOn(first, 15);
    const services = checkoutServices();
    await services.retry(
      { userId: own.studentId, gender: 'female' as RequesterGender },
      { enrollmentId: own.enrollmentId, idempotencyKey: randomUUID() },
    );
    await services.hold(
      { userId: own.studentId, gender: 'female' as RequesterGender },
      { packageId: second.packageId, slotId: second.slotId, idempotencyKey: randomUUID() },
    );
    expect(await enrollmentOf(own.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'checkout_abandoned',
    });
    // The order's failure is recorded; the platform cancelled it, so nothing is pushed.
    expect(
      (await eventsOf(own.enrollmentId)).map(({ kind, cancellationReason }) => [
        kind,
        cancellationReason,
      ]),
    ).toEqual([
      ['order_failed', null],
      ['cancelled', 'checkout_abandoned'],
    ]);
    expect(await pushesOf(own.studentId)).toEqual([]);
    await queuedAreCommitted();
  });

  // #148 Saif r2, Follow-up 1 (Q-C1 (a), B49): the checkout wrote the order `failed` first, so the
  // gateway's own later events for it move nothing (`MOVES_FROM.failed` and `.expired`, `['created']`).
  it('checkout.hold: the gateway’s later failed and expired events for the order it cancelled record no second order_failed row and no push', async () => {
    const [first, second] = [
      await world({ enrollment: ENDED }),
      await world({ enrollment: ENDED }),
    ];
    const own = await checkoutOn(first, 15);
    // The webhook's stand-in creates the order, so it can sign the gateway's events for it.
    const services = checkoutServices(webhook.payment);
    await services.retry(
      { userId: own.studentId, gender: 'female' as RequesterGender },
      { enrollmentId: own.enrollmentId, idempotencyKey: randomUUID() },
    );
    const { gatewayOrderId } = await database.payment.findFirstOrThrow({
      where: { enrollmentId: own.enrollmentId },
      select: { gatewayOrderId: true },
    });
    // 006:T001: `gateway_order_id` is NULL-able now; a manual order always carries one.
    if (gatewayOrderId === null) throw new Error('no gateway id');
    await services.hold(
      { userId: own.studentId, gender: 'female' as RequesterGender },
      { packageId: second.packageId, slotId: second.slotId, idempotencyKey: randomUUID() },
    );
    expect(await webhook.stand.deliver(webhook.stand.failed(gatewayOrderId))).toBe(200);
    expect(await webhook.stand.deliver(webhook.stand.expired(gatewayOrderId))).toBe(200);
    expect(
      (await eventsOf(own.enrollmentId)).map(({ kind, cancellationReason }) => [
        kind,
        cancellationReason,
      ]),
    ).toEqual([
      ['order_failed', null],
      ['cancelled', 'checkout_abandoned'],
    ]);
    expect(await pushesOf(own.studentId)).toEqual([]);
    await queuedAreCommitted();
  });
});
