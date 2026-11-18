// 005:T016 of specs/005-certification (the follow-up under T016 on the push's key share, fixed in B48
// on the owner's answer of 2026-11-18, `ejazah-tools\b48\owner-words-2.md`; B47's Q-R2 precedent,
// `user-report-race.spec.ts`; kernel.md, the `keyShareRows` row and the row «a push recorded by a
// producer») — each payment path that records a student's push without already holding that
// student's `users` row, raced against a path that holds the student `FOR UPDATE` and then waits on
// a row the producer locks (the hold, the enrollment), over the real tables as the application role.
//
// THE DEADLOCK. A push's `notifications` row key-shares its student's `users` row by its foreign
// key. Taken last, after the hold, enrollment and order locks, it waits on a `FOR UPDATE` of the
// student while holding them, and a path that holds the student and then waits on one of those rows
// (the student's own checkout or confirmation, an account's end) closes the cycle: 40P01. So each
// producer takes the student first: `keyShareRows` before its first lock where it holds nothing yet
// (payments' order events, the checkout's cancelled order, the two sweeps), and the accounts' one
// `FOR UPDATE` call widened to the students of the slot's and the student's holds where the path
// already locks accounts first (a placement, the confirmation's re-hold).
//
// THE OTHER PATH is a raw transaction on its own connection with exactly that order: the student
// `FOR UPDATE`, then the producer's row `FOR UPDATE`, then the commit. Each order is staged with the
// first party held and the second seen waiting in `pg_stat_activity` before the first goes on:
//
//   - the other path first: it holds the student; the producer is seen blocked by it (on the key
//     share or the accounts' call, holding nothing the other path needs); the other path takes the
//     row and commits; the producer goes on;
//   - the producer first: a third connection holds a row the producer locks later, so the producer
//     stops holding its first locks; the other path is seen waiting (on the student); the third
//     connection commits; the producer commits; the other path goes on.
//
// Both commit, neither is refused 40P01, and the push is written. Seen red first on the code before
// the fix and under the mutant «no key share first» at each path (lane A's `mutants\`): every case
// ends in 40P01. Rows are committed, each race with a world of its own, and left (as
// `payment-notices.spec.ts`' are).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { expireHolds, holdExpiryStepsOf } from '../../apps/api/src/jobs/expire-holds';
import {
  expirePendingPayments,
  pendingPaymentStepsOf,
} from '../../apps/api/src/jobs/expire-pending-payments';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index';
import {
  checkoutStepsOver,
  createCheckoutServices,
} from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors';
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
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { addMinutes } from '../../packages/time/src/index';
import { CAIRO, confirmationWorld, EARLIER, NOW, settings } from './confirmation-world';
import {
  expirySettings,
  listenWebhook,
  plantOrder,
  sweepInstant,
  type Webhook,
} from './expiry-world';
import { connectAsApplication, type Db } from './harness';

let database: Database;
let webhook: Webhook;
/** The other path, the connection that stops the producer, and the watcher. */
let other: Db;
let holder: Db;
let watch: Db;
let otherPid: number;
let holderPid: number;
let writer: ReturnType<typeof createNotificationWriter>;

const SILENT = { info: () => undefined, warn: () => undefined };

async function pidOf(client: Db): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const pid = rows[0]?.pid;
  if (pid === undefined) throw new Error('no backend pid');
  return pid;
}

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  writer = createNotificationWriter({
    database,
    queue: { enqueue: async () => undefined },
    log: SILENT,
  });
  webhook = await listenWebhook(database, { enqueue: async () => undefined }, writer);
  [other, holder, watch] = await Promise.all([
    connectAsApplication(),
    connectAsApplication(),
    connectAsApplication(),
  ]);
  [otherPid, holderPid] = await Promise.all([pidOf(other), pidOf(holder)]);
}, 60_000);

afterAll(async () => {
  await Promise.all([other?.end(), holder?.end(), watch?.end()]);
  await webhook?.close();
  if (database !== undefined) await closeDatabase(database);
});

const { person, world, order } = confirmationWorld(() => database);

// ---------------------------------------------------------------------------------------------
// The race.
// ---------------------------------------------------------------------------------------------

type Locked = 'enrollments' | 'slot_holds' | 'payments';

interface RaceRows {
  /** The student the producer pushes, whom the other path holds `FOR UPDATE` first. */
  readonly student: string;
  /** The row the producer locks before its push, which the other path then asks for. */
  readonly taken: { readonly table: Locked; readonly id: string };
  /** A row the producer locks after `taken`, held by the third connection to stop it. */
  readonly later: { readonly table: Locked; readonly id: string };
}

type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

const settle = (run: Promise<unknown>): Promise<Outcome> =>
  run.then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  );

const lockRow = (client: Db, { table, id }: RaceRows['taken']) =>
  client.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);

/** Polls until `check` holds; fails after a few seconds, or once every one of `running` ended. */
async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let look = 0; look < 300; look += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`never seen: ${what}`);
}

/** Whether some backend waits on a lock `pid` holds. */
async function blocking(pid: number): Promise<boolean> {
  const { rows } = await watch.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
    [pid],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** Whether `pid` waits on a lock. */
async function waiting(pid: number): Promise<boolean> {
  const { rows } = await watch.query<{ waiting: boolean }>(
    `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
    [pid],
  );
  return rows[0]?.waiting === true;
}

/** The other path's rest: the producer's row, then the commit; rolled back if refused. */
async function otherGoesOn(rows: RaceRows): Promise<void> {
  try {
    await lockRow(other, rows.taken);
    await other.query('COMMIT');
  } catch (error: unknown) {
    await other.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** The other path holds the student; the producer is seen blocked by it; the other path goes on. */
async function otherFirst(rows: RaceRows, produce: () => Promise<unknown>) {
  await other.query('BEGIN');
  await other.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [rows.student]);
  const producer = settle(produce());
  let otherRun: Promise<Outcome>;
  try {
    await until(() => blocking(otherPid), 'the producer waiting on the other path');
  } finally {
    otherRun = settle(otherGoesOn(rows));
  }
  return { producer: await producer, other: await otherRun };
}

/**
 * The third connection holds the producer's later row; the producer is seen stopped on it; the
 * other path starts and is seen waiting; the third connection commits.
 */
async function producerFirst(rows: RaceRows, produce: () => Promise<unknown>) {
  await holder.query('BEGIN');
  await lockRow(holder, rows.later);
  const producer = settle(produce());
  let otherRun: Promise<Outcome> | undefined;
  try {
    await until(() => blocking(holderPid), 'the producer stopped on the held row');
    otherRun = settle(
      (async () => {
        await other.query('BEGIN');
        try {
          await other.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [rows.student]);
        } catch (error: unknown) {
          await other.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
        await otherGoesOn(rows);
      })(),
    );
    await until(() => waiting(otherPid), 'the other path waiting');
  } finally {
    await holder.query('COMMIT');
  }
  return { producer: await producer, other: await (otherRun ?? Promise.resolve({ ok: true })) };
}

const deadlocked = (outcome: Outcome) =>
  !outcome.ok &&
  (isDeadlock(outcome.error) || (outcome.error as { code?: unknown } | null)?.code === '40P01');

/** Neither refused 40P01, both committed, and the student's push written. */
async function bothCommitted(
  settled: { readonly producer: Outcome; readonly other: Outcome },
  student: string,
  type: 'payment_failed' | 'payment_expired',
): Promise<void> {
  expect([deadlocked(settled.producer), deadlocked(settled.other)]).toEqual([false, false]);
  expect([settled.producer.ok, settled.other.ok]).toEqual([true, true]);
  const pushes = await database.notification.findMany({
    where: { userId: student, type },
    select: { id: true },
  });
  expect(pushes).toHaveLength(1);
}

// ---------------------------------------------------------------------------------------------
// The worlds and the producers.
// ---------------------------------------------------------------------------------------------

/** Another student's enrollment awaiting payment on the world's slot, its hold expired, unreleased. */
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

/** A student's enrollment awaiting payment on a hold of the slot expiring `minutes` from now. */
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
const cipher = new ColumnCipher(randomBytes(32).toString('base64'));

function checkoutServices() {
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
    payment: createPaymentPort(config),
    cipher,
    gateway: 'fake',
    notices: writer,
  });
}

const ENDED = { status: 'cancelled', reason: 'payment_expired' } as const;
const ORDERS: readonly ['other first', 'producer first'] = ['other first', 'producer first'];
const run = (which: (typeof ORDERS)[number]) =>
  which === 'other first' ? otherFirst : producerFirst;
const RACE_TIMEOUT = 30_000;

describe('payments’ order events, a failed order (the student key-shared first)', () => {
  it.each(ORDERS)(
    '%s: both commit, no deadlock, one payment_failed',
    async (which) => {
      const on = await world();
      const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
      const failed = webhook.stand.failed(gatewayOrderId);
      const settled = await run(which)(
        {
          student: on.studentId,
          taken: { table: 'enrollments', id: on.enrollmentId },
          later: { table: 'payments', id: paymentId },
        },
        async () => {
          const status = await webhook.stand.deliver(failed);
          if (status !== 200) throw new Error(`the webhook answered ${String(status)}`);
        },
      );
      await bothCommitted(settled, on.studentId, 'payment_failed');
    },
    RACE_TIMEOUT,
  );
});

describe('the checkout’s order the gateway cancelled (the student key-shared first)', () => {
  it.each(ORDERS)(
    '%s: both commit, no deadlock, one payment_failed',
    async (which) => {
      const on = await world();
      const paymentId = await order(on.enrollmentId, 'created');
      const settled = await run(which)(
        {
          student: on.studentId,
          taken: { table: 'enrollments', id: on.enrollmentId },
          later: { table: 'payments', id: paymentId },
        },
        () =>
          checkoutStepsOver(database, cipher, writer).recordCancelled(on.enrollmentId, paymentId),
      );
      await bothCommitted(settled, on.studentId, 'payment_failed');
    },
    RACE_TIMEOUT,
  );
});

describe('expire-pending-payments, a page of holds (its students key-shared first)', () => {
  it.each(ORDERS)(
    '%s: both commit, no deadlock, one payment_expired',
    async (which) => {
      const on = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
      const steps = {
        ...pendingPaymentStepsOf(writer),
        expiredOrders: async () => [],
        paidOrders: async () => [],
        expiredHolds: async (_tx: Transaction, _at: Date, after: string | undefined) =>
          after === undefined ? [on.holdId] : [],
      };
      const settled = await run(which)(
        {
          student: on.studentId,
          taken: { table: 'slot_holds', id: on.holdId },
          later: { table: 'enrollments', id: on.enrollmentId },
        },
        () =>
          expirePendingPayments({
            database,
            settings: expirySettings,
            confirmations: { enqueue: async () => undefined },
            notices: writer,
            steps,
            clock: sweepInstant,
          }).handle({}),
      );
      await bothCommitted(settled, on.studentId, 'payment_expired');
    },
    RACE_TIMEOUT,
  );
});

describe('expire-holds, a page (its students key-shared first)', () => {
  it.each(ORDERS)(
    '%s: both commit, no deadlock, one payment_expired',
    async (which) => {
      const on = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
      const steps = {
        ...holdExpiryStepsOf(writer),
        expiredHolds: async (_tx: Transaction, _at: Date, after: string | undefined) =>
          after === undefined ? [on.holdId] : [],
      };
      const settled = await run(which)(
        {
          student: on.studentId,
          taken: { table: 'slot_holds', id: on.holdId },
          later: { table: 'enrollments', id: on.enrollmentId },
        },
        () => expireHolds({ database, notices: writer, steps, clock: () => NOW }).handle({}),
      );
      await bothCommitted(settled, on.studentId, 'payment_expired');
    },
    RACE_TIMEOUT,
  );
});

describe('a placement releasing another student’s expired checkout (that student in the accounts’ lock)', () => {
  it.each(ORDERS)(
    '%s: both commit, no deadlock, one payment_expired',
    async (which) => {
      const on = await world({ enrollment: ENDED });
      const stale = await checkoutOn(on, -30);
      const newcomer = await person('female');
      const settled = await run(which)(
        {
          student: stale.studentId,
          taken: { table: 'slot_holds', id: stale.holdId },
          later: { table: 'enrollments', id: stale.enrollmentId },
        },
        () =>
          checkoutServices().hold(
            { userId: newcomer, gender: 'female' },
            { packageId: on.packageId, slotId: on.slotId, idempotencyKey: randomUUID() },
          ),
      );
      await bothCommitted(settled, stale.studentId, 'payment_expired');
    },
    RACE_TIMEOUT,
  );
});

describe('the confirmation’s re-hold releasing another student’s expired checkout (that student in the accounts’ lock)', () => {
  it.each(ORDERS)(
    '%s: both commit, no deadlock, one payment_expired',
    async (which) => {
      const on = await world({ enrollment: ENDED });
      const stale = await expiredCheckoutOn(on);
      const paid = await order(on.enrollmentId);
      const settled = await run(which)(
        {
          student: stale.studentId,
          taken: { table: 'slot_holds', id: stale.holdId },
          later: { table: 'enrollments', id: stale.enrollmentId },
        },
        () =>
          confirmEnrollment({ database, settings, notices: writer, clock: () => NOW }).handle({
            paymentId: paid,
          }),
      );
      await bothCommitted(settled, stale.studentId, 'payment_expired');
    },
    RACE_TIMEOUT,
  );
});
