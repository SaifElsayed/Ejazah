// 005:T026 (SC-606, FR-619; the note under T026, Q-C2 (a) as the owner refined it): each v1.0 push
// reaches the provider within two minutes of its cause, measured on the stand-in. 100 causes across
// the seven kinds, through the real producers, the notifications module's one writer, the queue and
// `deliver-notification`, over the real tables, each timed from its cause to its `pushed_at`:
//
//   kind                              producer (as main.ts and worker.ts bind it)          causes
//   session_reminder                  `send-reminder`, both parties at 1440 and 15 minutes    40
//   cancellation_requested            sessions' `cancellation.request`                        16
//   cancellation_request_accepted     sessions' `cancellation.answer`                          8
//   cancellation_request_declined     sessions' `cancellation.answer`                          8
//   payment_confirmed                 the webhook's paid event, then `confirm-enrollment`     10
//   payment_failed                    the webhook's failed event (payments' order events)      9
//   payment_expired                   `expire-pending-payments`                                9
//
// THE CAUSE (the owner's refinement). A reminder is timed from its offset instant (the session's
// start less the offset), never from the row's creation: the sweep runs each minute, so it adds up
// to 60 s. Every other kind is timed from its event: the request, the answer, the gateway's event
// delivered to the webhook, the sweep's release of the expired hold.
//
// THE CLOCK (R-TIME-1). One test clock, whole seconds, moved by this spec alone through
// `packages/time`, never read from the wall: the causes, the reminder sweep and the delivery job read
// it, and `pushed_at` is the delivery job's reading. It moves by the waits the system sets and by
// nothing else: the sweep's minute (each session's sweep runs 0 to 59 s after its offset instant, the
// whole range SC-606 allows) and the queue's backoff after a failure (`defaultJobOptions`,
// `jobs/queue.ts`: three attempts, exponential from one second). Work on the stand-in takes
// milliseconds and is not counted. The producers keep the clocks their own specs give them
// (`confirmation-world.ts`' NOW, `sweepInstant`, the session three hours ahead of the wall), which
// decide their outcome and none of the measure.
//
// THE QUEUE. The writer's queue is the spec's, as `stand-in-delivery.spec.ts`' is: a job is taken as
// soon as it is added, and a delivery that throws is tried again after the backoff of
// `defaultJobOptions`, as BullMQ would; one that fails every attempt is lost. A notification of
// another spec's user (the expiry sweep is global) is not delivered. The re-send of a lost enqueue
// (`send-reminder`'s step 2) reads `created_at`, the database's clock, so it finds none of these rows.
//
// THE FAILURE. The stand-in fails the first payment_confirmed push once: the job throws
// (`PushNotDelivered`), the queue retries it a second later, and it arrives.
//
// THE PASS: at least 99 of the 100 within 120 s; none lost; each reminder's span holding its sweep's
// wait. The distribution (min, median, p99, max) is the second case's annotation. Red first under a
// stub measure and three named mutants (B49 lane F's runs, `ejazah-tools\b49\runs\lane-f\`).
//
// The reminders' sessions are in March 2064, where no other spec's sweep reads; they and their
// parties are removed after the suite by the OWNER role, as `send-reminder.spec.ts` does. The other
// worlds are left as their own specs leave them; every device token written here is removed.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment.js';
import {
  deliverNotification,
  pushCopyRenderer,
} from '../../apps/api/src/jobs/deliver-notification.js';
import { expirePendingPayments } from '../../apps/api/src/jobs/expire-pending-payments.js';
import { defaultJobOptions } from '../../apps/api/src/jobs/queue.js';
import {
  REMINDER_OFFSETS_SETTING,
  REQUEUE_AFTER_SETTING,
  REQUEUE_MAX_AGE_SETTING,
  sendReminder,
} from '../../apps/api/src/jobs/send-reminder.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createPushRecipients } from '../../apps/api/src/modules/identity/index.js';
import {
  createNotificationDeliveries,
  createNotificationWriter,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from '../../apps/api/src/modules/notifications/index.js';
import {
  createSessionsServices,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { hashLookupToken } from '../../apps/api/src/platform/crypto/hashing.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { RequestLive, unboundBus } from '../../apps/api/src/platform/live/live-publisher.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { createPushPort } from '../../apps/api/src/platform/ports/push/index.js';
import type { PushPort } from '../../apps/api/src/platform/ports/push/push.port.js';
import { StandIn } from '../../apps/api/src/platform/ports/stand-in.js';
import { createVideoPort } from '../../apps/api/src/platform/ports/video/index.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { copyOf } from '../../apps/api/src/platform/web/copy.js';
import {
  addMinutes,
  addSeconds,
  measureSeconds,
  resolveLocalDateTime,
} from '../../packages/time/src/index.js';
import { confirmationWorld, NOW, settings as confirmationSettings } from './confirmation-world';
import {
  expirySettings,
  listenWebhook,
  plantOrder,
  sweepInstant,
  type Webhook,
} from './expiry-world';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const CAIRO = 'Africa/Cairo';
/** SC-606's bound: two minutes. */
const WITHIN_SECONDS = 120;
/** SC-606's share: 99% of the 100 attempts. */
const AT_LEAST = 99;
/** The test clock's start (R-TIME-1): a year no other spec's sweep reads. */
const T0 = new Date('2064-03-02T00:00:00Z');
/** Between two causes of the kinds that are not reminders. */
const STEP_SECONDS = 17;
/** Each reminder session's sweep runs this many seconds after its offset instants (0 to 59). */
const SWEEP_WAITS = [0, 6, 13, 19, 26, 32, 39, 45, 52, 59] as const;
/** The causes of each kind (the file's head). */
const PLANNED: Readonly<Record<NotificationKind, number>> = {
  session_reminder: 40,
  cancellation_requested: 16,
  cancellation_request_accepted: 8,
  cancellation_request_declined: 8,
  payment_confirmed: 10,
  payment_failed: 9,
  payment_expired: 9,
};
const MILLISECONDS_PER_SECOND = 1000;
const PUSH_TOKEN_COLUMN = 'device_push_tokens.token_encrypted';

const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };
const log = createLogger({ level: 'fatal' });

/** The seeded values (`prisma/seed.ts`) the producers read, through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  [REMINDER_OFFSETS_SETTING]: [1440, 15],
  [REQUEUE_AFTER_SETTING]: 5,
  [REQUEUE_MAX_AGE_SETTING]: 30,
};
const seeded: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };

// ---- The test clock -------------------------------------------------------------------------

let now = T0;
const clock = (): Date => now;

function setClock(at: Date): void {
  if (at.getTime() < now.getTime()) throw new Error('The test clock never runs backwards.');
  now = at;
}

// ---- The stand-in provider, the queue and the delivery job ----------------------------------

/** The stand-in, selected as configuration selects it (R-API-4: no adapter is named here). */
const stand = ((): PushPort & StandIn<PushPort> => {
  const port = createPushPort({ PUSH_PROVIDER: 'fake' });
  if (!(port instanceof StandIn)) throw new Error('PUSH_PROVIDER=fake selects a stand-in.');
  return port as PushPort & StandIn<PushPort>;
})();
/** The notifications whose push the stand-in refused, in order. */
const refused: string[] = [];
/** When each notification's push reached the stand-in, on the test clock. */
const reached = new Map<string, Date>();
const push: PushPort = {
  deliver: async (target, payload, message) => {
    try {
      await stand.deliver(target, payload, message);
    } catch (error: unknown) {
      refused.push(payload.notificationId);
      throw error;
    }
    reached.set(payload.notificationId, now);
  },
  findStaleTargets: (targets) => stand.findStaleTargets(targets),
};

interface Held {
  readonly notificationId: string;
  readonly runAt: Date;
  readonly attemptsMade: number;
}
const held: Held[] = [];
/** When each notification was queued, on the test clock: its row's creation as the clock reads it. */
const createdAt = new Map<string, Date>();
/** The notifications that failed every attempt. */
const lost: string[] = [];
/** Every user of the worlds below: the only recipients the queue delivers to. */
const mine = new Set<string>();

/** `deliver-notification { notificationId }`, as the writer adds it under the notification's id. */
const queue = {
  enqueue: async (notificationId: string): Promise<void> => {
    if (held.some((job) => job.notificationId === notificationId)) return;
    if (!createdAt.has(notificationId)) createdAt.set(notificationId, now);
    held.push({ notificationId, runAt: now, attemptsMade: 0 });
  },
};

/** BullMQ's exponential backoff after `attemptsMade` failed attempts, in whole seconds. */
function backoffSeconds(attemptsMade: number): number {
  return (defaultJobOptions.backoff.delay * 2 ** (attemptsMade - 1)) / MILLISECONDS_PER_SECOND;
}

let database: Database;
let setup: Db;
let webhook: Webhook;
let services: SessionsServices;
let writer: ReturnType<typeof createNotificationWriter>;
let delivery: ReturnType<typeof deliverNotification>;
const cipher = new ColumnCipher(randomBytes(32).toString('base64'));

async function isMine(notificationId: string): Promise<boolean> {
  const row = await database.notification.findUnique({
    where: { id: notificationId },
    select: { userId: true },
  });
  return row !== null && mine.has(row.userId);
}

/** Runs every held job in the order it falls due, the clock moved to each; a failure is retried. */
async function drain(): Promise<void> {
  for (;;) {
    held.sort((one, other) => (one.runAt.getTime() <= other.runAt.getTime() ? -1 : 1));
    const job = held.shift();
    if (job === undefined) return;
    if (job.runAt.getTime() > now.getTime()) setClock(job.runAt);
    if (!(await isMine(job.notificationId))) continue;
    try {
      await delivery.handle({ notificationId: job.notificationId });
    } catch {
      const attemptsMade = job.attemptsMade + 1;
      if (attemptsMade < defaultJobOptions.attempts) {
        held.push({
          notificationId: job.notificationId,
          runAt: new Date(addSeconds(now, backoffSeconds(attemptsMade))),
          attemptsMade,
        });
      } else {
        lost.push(job.notificationId);
      }
    }
  }
}

/** The writer's enqueue runs after its producer's commit and is not awaited by the producer. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The cause of each notification that is not a reminder: its event's instant on the test clock. */
const causes = new Map<string, Date>();

/** Moves the clock on, makes the event happen, and delivers what it queued. */
async function cause(event: () => Promise<unknown>): Promise<void> {
  setClock(new Date(addSeconds(now, STEP_SECONDS)));
  const at = now;
  const before = new Set(createdAt.keys());
  await event();
  await settled();
  for (const notificationId of createdAt.keys()) {
    if (!before.has(notificationId) && (await isMine(notificationId))) {
      causes.set(notificationId, at);
    }
  }
  await drain();
}

/** One device of `userId`, its token encrypted as identity stores it, and the user counted mine. */
async function reachable(...userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    mine.add(userId);
    const id = randomUUID();
    const token = `ExponentPushToken[probe-${randomUUID()}]`;
    await database.devicePushToken.create({
      data: {
        id,
        userId,
        tokenEncrypted: Uint8Array.from(cipher.encrypt(token, PUSH_TOKEN_COLUMN, id)),
        tokenHash: hashLookupToken(token),
        platform: 'android',
        lastSeenAt: T0,
      },
    });
  }
}

// ---- The worlds -------------------------------------------------------------------------------

const payments = confirmationWorld(() => database);

/** A male student and an approved male teacher, confirmed, one session three hours ahead. */
async function cancellationWorld() {
  const offer = await makeOffer(setup);
  await insertRow(setup, 'user_roles', {
    user_id: offer.teacherId,
    role: 'teacher',
    status: 'active',
  });
  await insertRow(setup, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'approved',
    approved_at: '2026-10-01T00:00:00Z',
    application_status: 'approved',
    application_submitted_at: '2026-09-30T00:00:00Z',
    payout_verified_at: '2026-10-01T00:00:00Z',
  });
  const studentId = await makeUser(setup, { gender: 'male' });
  const enrollmentId = await insertRow(setup, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:05:00Z',
  });
  // The service decides «not started» on its own clock, the wall's (cancellation-notices.spec.ts).
  const startsAt = new Date(addSeconds(new Date(), 3 * 60 * 60));
  const sessionId = await insertRow(setup, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-10',
    scheduled_start_time_local: '09:00:00',
    timezone: CAIRO,
    scheduled_start_at: startsAt.toISOString(),
    scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
    status: 'scheduled',
  });
  await reachable(offer.teacherId, studentId);
  return { sessionId, studentId, teacherId: offer.teacherId };
}

/** `call` as the participant kind runs it: the request's list sent once the handler resolves. */
async function asParticipant<T>(call: (live: RequestLive) => Promise<T>): Promise<T> {
  const live = new RequestLive(unboundBus, SILENT);
  try {
    const answered = await call(live);
    live.flush();
    return answered;
  } catch (error: unknown) {
    live.drop();
    throw error;
  }
}

interface ReminderSession {
  readonly id: string;
  readonly startsAt: Date;
  /** Its sweep's wait after each of its offset instants. */
  readonly sweepWait: number;
}
const reminderSessions: ReminderSession[] = [];
/** The reminder worlds' rows, removed after the suite by the OWNER role. */
const reminderUsers: string[] = [];
const reminderSubjects: string[] = [];

/** The `i`th reminder session: 10:00 in Cairo on 2064-03-(03 + i), an enrollment of its own. */
async function reminderWorld(i: number): Promise<void> {
  const offer = await makeOffer(setup);
  const studentId = await makeUser(setup);
  reminderUsers.push(offer.teacherId, studentId);
  reminderSubjects.push(offer.subjectId);
  const enrollmentId = await insertRow(setup, 'enrollments', enrollmentValues(offer, studentId));
  const localDate = `2064-03-${String(3 + i).padStart(2, '0')}`;
  const { startsAt } = resolveLocalDateTime({ localDate, localTime: '10:00:00', timezone: CAIRO });
  const start = new Date(startsAt);
  const id = await insertRow(setup, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: localDate,
    scheduled_start_time_local: '10:00:00',
    timezone: CAIRO,
    scheduled_start_at: start.toISOString(),
    scheduled_end_at: new Date(addMinutes(start, 60)).toISOString(),
    status: 'scheduled',
  });
  await reachable(offer.teacherId, studentId);
  reminderSessions.push({ id, startsAt: start, sweepWait: SWEEP_WAITS[i] ?? 0 });
}

// ---- The run ----------------------------------------------------------------------------------

/** The cancellations: 16 requests, then 8 accepted and 8 declined. */
async function causeCancellations(): Promise<void> {
  const worlds = [];
  for (let i = 0; i < 16; i += 1) worlds.push(await cancellationWorld());
  const requests: string[] = [];
  for (const world of worlds) {
    await cause(async () => {
      const { requestId } = await asParticipant((live) =>
        services.cancellation.request(
          { userId: world.studentId },
          {
            sessionId: world.sessionId,
            reason: 'سفر طارئ',
            idempotencyKey: `probe-${randomUUID()}`,
          },
          log,
          live,
        ),
      );
      requests.push(requestId);
    });
  }
  for (const [i, world] of worlds.entries()) {
    const requestId = requests[i] ?? '';
    await cause(() =>
      asParticipant((live) =>
        services.cancellation.answer(
          { userId: world.teacherId },
          { requestId, accept: i % 2 === 0 },
          log,
          live,
        ),
      ),
    );
  }
}

/** The payments: 10 paid and 9 failed events delivered to the webhook, then one expiry sweep. */
async function causePayments(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const on = await payments.world();
    await reachable(on.teacherId, on.studentId);
    const { gatewayOrderId } = await plantOrder(webhook, payments.order, on.enrollmentId);
    // THE FAILURE: the first payment_confirmed push is refused once by the stand-in.
    if (i === 0) stand.failNext('deliver');
    await cause(() => webhook.stand.deliver(webhook.stand.paid(gatewayOrderId)));
  }
  for (let i = 0; i < 9; i += 1) {
    const on = await payments.world();
    await reachable(on.teacherId, on.studentId);
    const { gatewayOrderId } = await plantOrder(webhook, payments.order, on.enrollmentId);
    await cause(() => webhook.stand.deliver(webhook.stand.failed(gatewayOrderId)));
  }
  for (let i = 0; i < 9; i += 1) {
    const on = await payments.world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
    await reachable(on.teacherId, on.studentId);
  }
  await cause(() =>
    expirePendingPayments({
      database,
      settings: expirySettings,
      confirmations: { enqueue: async () => undefined },
      notices: writer,
      clock: sweepInstant,
    }).handle({}),
  );
}

/** The reminders: each session's sweep at 1440 and at 15 minutes, its wait after the offset. */
async function causeReminders(): Promise<void> {
  for (let i = 0; i < SWEEP_WAITS.length; i += 1) await reminderWorld(i);
  const sweep = sendReminder({
    database,
    settings: seeded,
    writer,
    queue,
    log: SILENT,
    clock,
  });
  const runs = reminderSessions
    .flatMap((session) =>
      [1440, 15].map(
        (offset) =>
          new Date(addSeconds(new Date(addMinutes(session.startsAt, -offset)), session.sweepWait)),
      ),
    )
    .sort((one, other) => (one.getTime() <= other.getTime() ? -1 : 1));
  for (const at of runs) {
    setClock(at);
    await sweep.handle({});
    await settled();
    await drain();
  }
}

// ---- The measure ------------------------------------------------------------------------------

interface Attempt {
  readonly notificationId: string;
  readonly kind: NotificationKind;
  /** The reminder's session, for a reminder. */
  readonly sessionId: string | undefined;
  readonly causeAt: Date;
  readonly pushedAt: Date | null;
  /** Whole seconds from the cause to `pushed_at`; null when never pushed. */
  readonly seconds: number | null;
  readonly reachedProvider: boolean;
  /** The pushes the stand-in was asked for, refused ones included. */
  readonly deliveries: number;
}

/** Each measured notification, timed from its cause to its `pushed_at`. */
async function measure(): Promise<readonly Attempt[]> {
  const started = new Map<string, { readonly at: Date; readonly sessionId?: string }>(
    [...causes].map(([notificationId, at]) => [notificationId, { at }]),
  );
  // A reminder's cause is its offset instant: the session's start less the offset.
  const reminders = await database.sessionReminder.findMany({
    where: { sessionId: { in: reminderSessions.map(({ id }) => id) } },
    select: { sessionId: true, offsetMinutes: true, notificationId: true },
  });
  for (const { sessionId, offsetMinutes, notificationId } of reminders) {
    const session = reminderSessions.find(({ id }) => id === sessionId);
    if (session === undefined) throw new Error(`No reminder session ${sessionId}.`);
    started.set(notificationId, {
      at: new Date(addMinutes(session.startsAt, -offsetMinutes)),
      sessionId,
    });
  }
  const rows = await database.notification.findMany({
    where: { id: { in: [...started.keys()] } },
    orderBy: { id: 'asc' },
    select: { id: true, type: true, pushedAt: true },
  });
  return rows.map(({ id, type, pushedAt }) => {
    const { at, sessionId } = started.get(id) ?? { at: T0 };
    return {
      notificationId: id,
      kind: type as NotificationKind,
      sessionId,
      causeAt: at,
      pushedAt,
      seconds: pushedAt === null ? null : measureSeconds([{ startsAt: at, endsAt: pushedAt }]),
      reachedProvider: reached.has(id),
      deliveries: stand.calls.filter(
        (call) => call.operation === 'deliver' && call.args[1].notificationId === id,
      ).length,
    };
  });
}

let attempts: readonly Attempt[] = [];

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  setup = await connectAsApplication();
  writer = createNotificationWriter({ database, queue, log: SILENT });
  delivery = deliverNotification({
    notifications: createNotificationDeliveries(database),
    recipients: createPushRecipients({ database, cipher }),
    push,
    render: pushCopyRenderer({ ar: copyOf('ar'), en: copyOf('en') }),
    log: SILENT,
    clock,
  });
  // The paid event's `confirm-enrollment`, run as soon as the webhook queues it.
  webhook = await listenWebhook(
    database,
    {
      enqueue: async (paymentId) => {
        await confirmEnrollment({
          database,
          settings: confirmationSettings,
          notices: writer,
          clock: () => NOW,
        }).handle({ paymentId });
      },
    },
    writer,
  );
  services = createSessionsServices({
    transactions: transactionsOver(database),
    settings: seeded,
    video: createVideoPort({
      VIDEO_PROVIDER: 'fake',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
    enrollmentSide: createEnrollmentSide({ settings: seeded }),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings: seeded,
    }),
    notifications: writer,
  });

  await causeCancellations();
  await causePayments();
  await causeReminders();
  attempts = await measure();
}, 600_000);

afterAll(async () => {
  await webhook?.close();
  if (database !== undefined) {
    await database.devicePushToken.deleteMany({ where: { userId: { in: [...mine] } } });
  }
  await setup?.end();
  if (database !== undefined) await closeDatabase(database);
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('DELETE FROM "session_reminders" WHERE user_id = ANY($1)', [reminderUsers]);
    await owner.query('DELETE FROM "notifications" WHERE user_id = ANY($1)', [reminderUsers]);
    await owner.query(
      `DELETE FROM "session_events" WHERE enrollment_id IN (
         SELECT id FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1))`,
      [reminderUsers],
    );
    await owner.query(
      'DELETE FROM "sessions" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [reminderUsers],
    );
    await owner.query(
      'DELETE FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [reminderUsers],
    );
    await owner.query('DELETE FROM "availability_slots" WHERE teacher_user_id = ANY($1)', [
      reminderUsers,
    ]);
    await owner.query('DELETE FROM "packages" WHERE teacher_user_id = ANY($1)', [reminderUsers]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [reminderSubjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [reminderUsers]);
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
}, 120_000);

/** Nearest rank: the smallest value at or above `share` of the sorted values. */
function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.ceil(share * sorted.length) - 1] ?? Number.NaN;
}

describe('SC-606: each push reaches the provider within two minutes of its cause (005:T026)', () => {
  it('measures 100 causes across the seven kinds', () => {
    const counted = Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, attempts.filter((one) => one.kind === kind).length]),
    );
    expect(counted).toEqual(PLANNED);
  });

  it('pushes at least 99 of the 100 within 120 s of their cause', async ({ annotate }) => {
    const within = attempts.filter(
      ({ seconds }) => seconds !== null && seconds < WITHIN_SECONDS,
    ).length;
    expect(within).toBeGreaterThanOrEqual(AT_LEAST);
    const sorted = attempts
      .map(({ seconds }) => seconds ?? Number.POSITIVE_INFINITY)
      .sort((one, other) => one - other);
    const median = ((sorted[49] ?? Number.NaN) + (sorted[50] ?? Number.NaN)) / 2;
    await annotate(
      `SC-606 distribution, seconds from cause to pushed_at over ${String(sorted.length)} attempts: ` +
        `min ${String(sorted[0])}, median ${String(median)}, p99 ${String(percentile(sorted, 0.99))}, ` +
        `max ${String(sorted.at(-1))}; within ${String(WITHIN_SECONDS)} s: ${String(within)}`,
    );
  });

  it('loses none to a stand-in failure: the refused push is retried and arrives', () => {
    expect(attempts).toHaveLength(100);
    expect(
      attempts.filter(({ pushedAt, reachedProvider }) => pushedAt === null || !reachedProvider),
    ).toEqual([]);
    expect(lost).toEqual([]);
    expect(refused).toHaveLength(1);
    const retried = attempts.find(({ notificationId }) => notificationId === refused[0]);
    expect(retried).toMatchObject({ kind: 'payment_confirmed', deliveries: 2 });
    expect(retried?.seconds).toBe(backoffSeconds(1));
  });

  it('times each reminder from its offset instant: the sweep’s wait is inside its span', () => {
    const reminders = attempts.filter(({ kind }) => kind === 'session_reminder');
    expect(reminders).toHaveLength(PLANNED.session_reminder);
    const waitOf = (sessionId: string | undefined): number =>
      reminderSessions.find(({ id }) => id === sessionId)?.sweepWait ?? Number.NaN;
    expect(
      reminders
        .filter(({ seconds, sessionId }) => !(seconds !== null && seconds >= waitOf(sessionId)))
        .map(({ sessionId, seconds }) => ({ sessionId, seconds, wait: waitOf(sessionId) })),
    ).toEqual([]);
    expect(Math.max(...reminders.map(({ seconds }) => seconds ?? 0))).toBe(
      Math.max(...SWEEP_WAITS),
    );
  });
});
