// 005:T016 of specs/005-certification (FR-619; SRS DEC-70 as amended by DEC-71; the note under T016,
// Q-N3 (a) with the review's condition) — the cancellation's pushes over the real tables, through
// the sessions services as `main.ts` binds them, with the notifications module's real writer:
//
//   - a request commits with one `notifications` row `cancellation_requested` for the counterparty,
//     payload the session's and the enrollment's ids only (stored as ERD §11 names them), its push queued once the request's list
//     is sent after the commit; a replay with the same key writes no second row;
//   - an answer, accepted and declined, commits with one row for the requester;
//   - an expired request (`expire-cancellation-requests`) writes no row (FR-619: none in v1.0).
//
// Each transaction binds the request's list itself (`bindToTransaction`); without it the writer
// refuses (`no_after_commit_list`) and the request or the answer rolls back. Seen red under the
// mutant «list not bound» at each of the two transactions (lane A's `mutants\`), and under the
// expiry made to record `cancellation_requested`. The rows are committed, each probe with a world
// of its own; every connection is the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { expireCancellationRequests } from '../../apps/api/src/jobs/expire-cancellation-requests.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index.js';
import {
  createSessionsServices,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
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
import { createVideoPort } from '../../apps/api/src/platform/ports/video/index.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

let db: Db;
let database: Database;
let services: SessionsServices;
/** The notification ids the writer queued, in order (`deliver-notification`'s queue). */
let queued: string[];

/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });
const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  queued = [];
  services = createSessionsServices({
    transactions: transactionsOver(database),
    settings,
    video: createVideoPort({
      VIDEO_PROVIDER: 'fake',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
    enrollmentSide: createEnrollmentSide({ settings }),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    // As `main.ts` binds it: the one writer, its queue the spec's own.
    notifications: createNotificationWriter({
      database,
      queue: {
        enqueue: async (notificationId) => {
          queued.push(notificationId);
        },
      },
      log: SILENT,
    }),
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** A male student and an approved male teacher, a confirmed enrollment and one scheduled session. */
async function world(startsInSeconds = 3 * 60 * 60) {
  const offer = await makeOffer(db);
  await insertRow(db, 'user_roles', {
    user_id: offer.teacherId,
    role: 'teacher',
    status: 'active',
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'approved',
    approved_at: '2026-10-01T00:00:00Z',
    application_status: 'approved',
    application_submitted_at: '2026-09-30T00:00:00Z',
    payout_verified_at: '2026-10-01T00:00:00Z',
  });
  const studentId = await makeUser(db, { gender: 'male' });
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:05:00Z',
  });
  const startsAt = new Date(addSeconds(new Date(), startsInSeconds));
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-10',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: startsAt.toISOString(),
    scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
    status: 'scheduled',
  });
  return { sessionId, enrollmentId, studentId, teacherId: offer.teacherId };
}

type World = Awaited<ReturnType<typeof world>>;

/**
 * `call` as the participant kind runs it (`surfaces/procedures.ts`): the request's list, sent once
 * the handler resolves and dropped when it throws.
 */
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

const ask = (w: World, userId: string, idempotencyKey = `probe-${randomUUID()}`) =>
  asParticipant((live) =>
    services.cancellation.request(
      { userId },
      { sessionId: w.sessionId, reason: 'سفر طارئ', idempotencyKey },
      log,
      live,
    ),
  );

const answer = (userId: string, requestId: string, accept: boolean) =>
  asParticipant((live) =>
    services.cancellation.answer({ userId }, { requestId, accept }, log, live),
  );

/** The world's notifications, as the writer stored them. */
function noticesOf(w: World) {
  return database.notification.findMany({
    where: { userId: { in: [w.studentId, w.teacherId] } },
    orderBy: { id: 'asc' },
    select: { id: true, userId: true, type: true, titleKey: true, bodyKey: true, payload: true },
  });
}

describe('a cancellation request pushes the other party (005:T016, FR-619)', () => {
  it('commits with one cancellation_requested row for the counterparty, ids only, queued after the commit', async () => {
    const w = await world();
    await ask(w, w.studentId);
    const rows = await noticesOf(w);
    expect(rows).toEqual([
      {
        id: expect.any(String),
        userId: w.teacherId,
        type: 'cancellation_requested',
        titleKey: 'notifications.push.cancellation_requested.title',
        bodyKey: 'notifications.push.cancellation_requested.body',
        payload: { session_id: w.sessionId, enrollment_id: w.enrollmentId },
      },
    ]);
    expect(queued).toContain(rows[0]?.id);
  });

  it('a replay with the same key writes no second row', async () => {
    const w = await world();
    const key = `probe-${randomUUID()}`;
    await ask(w, w.teacherId, key);
    await ask(w, w.teacherId, key);
    expect((await noticesOf(w)).map(({ userId, type }) => [userId, type])).toEqual([
      [w.studentId, 'cancellation_requested'],
    ]);
  });
});

describe('a cancellation answer pushes the requester (005:T016, FR-619)', () => {
  it.each([
    ['accepted', 'cancellation_request_accepted', true],
    ['declined', 'cancellation_request_declined', false],
  ])('an answer (%s) commits with one %s row for the requester', async (_name, type, accept) => {
    const w = await world();
    const { requestId } = await ask(w, w.studentId);
    await answer(w.teacherId, requestId, accept);
    const rows = await noticesOf(w);
    expect(rows.map(({ userId, type: kind, payload }) => [userId, kind, payload])).toEqual([
      [
        w.teacherId,
        'cancellation_requested',
        { session_id: w.sessionId, enrollment_id: w.enrollmentId },
      ],
      [w.studentId, type, { session_id: w.sessionId, enrollment_id: w.enrollmentId }],
    ]);
    expect(queued).toContain(rows[1]?.id);
  });
});

describe('an expired request pushes nothing (FR-619: none in v1.0)', () => {
  it('expire-cancellation-requests writes no notification for either party', async () => {
    // A request pending on a session that started a minute ago, as the sweep finds it.
    const w = await world(-60);
    const requestId = await insertRow(db, 'cancellation_requests', {
      session_id: w.sessionId,
      requested_by_user_id: w.studentId,
      reason: 'سفر طارئ',
      status: 'pending',
    });
    await expireCancellationRequests({
      database,
      enrollments: createEnrollmentSide({ settings }),
      log: SILENT,
      report: () => undefined,
    }).handle({});
    const { rows } = await db.query<{ status: string }>(
      'SELECT status::text AS status FROM cancellation_requests WHERE id = $1',
      [requestId],
    );
    expect(rows).toEqual([{ status: 'expired' }]);
    expect(await noticesOf(w)).toEqual([]);
  });
});
