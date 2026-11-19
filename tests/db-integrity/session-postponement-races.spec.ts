// 003:T112 (SRS FR-POSTPONE-1, FR-POSTPONE-2, DEC-90; contracts/kernel.md, «a postponement») — a
// postponement raced against the paths that lock the same rows, over the real tables.
//
//   - AGAINST AN ACCEPTED CANCELLATION of the week's one session: both end with no deadlock, in
//     either order, and agree. The answer first: the session `cancelled_by_agreement`; the
//     postponement, waiting on the enrollment's row the answer holds, reads the week once granted
//     (READ COMMITTED: its next statement sees the committed answer) and is refused
//     `no_session_in_week`. The postponement first: the session `postponed`, the answer refused
//     `SESSION_NOT_SCHEDULED`. The enrollment's row, locked by both before the week is read, decides
//     the race; the week read again under the sessions' locks is a second guard that decides nothing
//     here (PR #151's review, round 1, nit 2: its mutant M1-db, that re-read dropped, stayed green).
//   - AGAINST THE EVALUATION SWEEP on the same enrollment: the sweep settles the ended session and
//     the postponement moves the week's, both committed, in either order; the two share only the
//     enrollment's row, taken by both in kernel.md's place.
//   - A postponed session is never evaluated, its end passed or not (FR-POSTPONE-2).
//
// HOW EACH RACE IS STAGED, the order decided by the database and not by timing: a holder
// transaction takes the enrollment's row `FOR UPDATE`; the first path is started and seen waiting on
// a lock; the second is started and seen waiting; the holder commits, and PostgreSQL grants the
// enrollment's row in the order the two asked for it. The rows are committed, each probe with a world
// of its own; every connection is the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createCompletion,
  createEvaluation,
  createSessionsServices,
  type EvaluationStore,
  evaluationStore,
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
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../apps/api/src/platform/live/live-publisher.js';
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

const NO_PUSH = { record: async () => undefined };

let db: Db;
let holder: Db;
let database: Database;
let services: SessionsServices;

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
  session_evaluation_delay_minutes: 2,
  attendance_threshold_pct: 70,
  join_window_minutes: 10,
  minimum_connection_seconds: 60,
  slot_release_buffer_weeks: 0,
  room_close_grace_minutes: 5,
  room_close_retry_minutes: 60,
  postponement_notice_hours: 12,
  postponement_interval_weeks: 4,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });
const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };
const noLive: LivePublisher = { afterCommit: () => undefined };

beforeAll(async () => {
  [db, holder] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  services = createSessionsServices({
    notifications: NO_PUSH,
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
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), holder?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * A male student and an approved male teacher with a confirmed enrollment and sessions starting
 * `startsIn` seconds from now, one each, in sequence order.
 */
async function world(...startsIn: number[]) {
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
  const sessionIds: string[] = [];
  for (const [index, seconds] of startsIn.entries()) {
    const startsAt = new Date(addSeconds(new Date(), seconds));
    sessionIds.push(
      await insertRow(db, 'sessions', {
        enrollment_id: enrollmentId,
        teacher_user_id: offer.teacherId,
        student_user_id: studentId,
        sequence_number: index + 1,
        scheduled_date_local: '2026-11-22',
        scheduled_start_time_local: '09:00:00',
        timezone: 'Africa/Cairo',
        scheduled_start_at: startsAt.toISOString(),
        scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
        status: 'scheduled',
      }),
    );
  }
  return { enrollmentId, studentId, teacherId: offer.teacherId, sessionIds };
}

const key = () => `probe-${randomUUID()}`;

const postpone = (enrollmentId: string, userId: string) =>
  services.postpone(
    { userId },
    { enrollmentId, reason: 'سفر طارئ', idempotencyKey: key() },
    log,
    noLive,
  );

/** The student's pending cancellation request on `sessionId`, committed. */
async function requested(sessionId: string, studentId: string): Promise<string> {
  const answer = await services.cancellation.request(
    { userId: studentId },
    { sessionId, reason: 'سفر', idempotencyKey: key() },
    log,
    noLive,
  );
  return answer.requestId;
}

/** Resolves once at least `count` backends of this database wait on a lock; fails after ~6 s. */
async function seenWaiting(count: number): Promise<void> {
  for (let look = 0; look < 300; look += 1) {
    const { rows } = await db.query<{ waiting: string }>(
      `SELECT count(*)::text AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (Number(rows[0]?.waiting ?? '0') >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`fewer than ${count} backends waited on a lock`);
}

/** Holds the enrollment's row until `release`; the paths started meanwhile queue behind it. */
async function hold(enrollmentId: string) {
  await holder.query('BEGIN');
  await holder.query('SELECT 1 FROM enrollments WHERE id = $1 FOR UPDATE', [enrollmentId]);
  return { release: () => holder.query('COMMIT') };
}

/** `first` started and seen waiting, then `second`, then the holder released; both settled. */
async function race<A, B>(
  enrollmentId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const held = await hold(enrollmentId);
  const one = first();
  one.catch(() => undefined);
  await seenWaiting(1);
  const two = second();
  two.catch(() => undefined);
  await seenWaiting(2);
  await held.release();
  return Promise.all([
    one.then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason: unknown) => ({ status: 'rejected', reason }) as const,
    ),
    two.then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason: unknown) => ({ status: 'rejected', reason }) as const,
    ),
  ]);
}

const refusal = (settled: PromiseSettledResult<unknown>) => {
  if (settled.status !== 'rejected') throw new Error('answered where it must be refused');
  if (!(settled.reason instanceof DomainError)) throw settled.reason;
  return { code: settled.reason.code, details: settled.reason.details };
};

const statusOf = async (sessionId: string) =>
  (
    await db.query<{ status: string }>('SELECT status::text FROM sessions WHERE id = $1', [
      sessionId,
    ])
  ).rows[0]?.status;

describe('a postponement raced against an accepted cancellation of the week’s session', () => {
  it('the answer first: the session cancelled by agreement, the postponement refused no_session_in_week', async () => {
    const w = await world(2 * DAY);
    const [session] = w.sessionIds as [string];
    const requestId = await requested(session, w.studentId);
    const [answer, postponement] = await race(
      w.enrollmentId,
      () =>
        services.cancellation.answer(
          { userId: w.teacherId },
          { requestId, accept: true },
          log,
          noLive,
        ),
      () => postpone(w.enrollmentId, w.teacherId),
    );
    expect(answer.status).toBe('fulfilled');
    expect(refusal(postponement)).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'no_session_in_week' }],
    });
    expect(await statusOf(session)).toBe('cancelled_by_agreement');
    const rows = await db.query('SELECT 1 FROM session_postponements WHERE enrollment_id = $1', [
      w.enrollmentId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('the postponement first: the session postponed, the answer refused SESSION_NOT_SCHEDULED', async () => {
    const w = await world(2 * DAY);
    const [session] = w.sessionIds as [string];
    const requestId = await requested(session, w.studentId);
    const [postponement, answer] = await race(
      w.enrollmentId,
      () => postpone(w.enrollmentId, w.teacherId),
      () =>
        services.cancellation.answer(
          { userId: w.teacherId },
          { requestId, accept: true },
          log,
          noLive,
        ),
    );
    expect(postponement.status).toBe('fulfilled');
    expect(refusal(answer).code).toBe('SESSION_NOT_SCHEDULED');
    expect(await statusOf(session)).toBe('postponed');
  });
});

/** The evaluation sweep at `at`, narrowed to `own` sessions so it settles no other spec's. */
function sweepOver(own: ReadonlySet<string>, at: Date) {
  const enrollments = createEnrollmentSide({ settings, now: () => at });
  const store: EvaluationStore = {
    ...evaluationStore,
    dueForEvaluation: async (tx, dueBy, after, limit) => {
      const all = await evaluationStore.dueForEvaluation(tx, dueBy, after, 100_000);
      return all.filter(({ id }) => own.has(id)).slice(0, limit);
    },
  };
  return createEvaluation({
    transactions: transactionsOver(database),
    enrollments,
    completion: createCompletion({ enrollments, settings }),
    video: { endRoom: async () => undefined },
    settings,
    log: SILENT,
    pageSize: 200,
    report: () => undefined,
    clock: async () => at,
    store,
  });
}

describe('a postponement raced against the evaluation sweep on the same enrollment', () => {
  it.each([['the sweep first'], ['the postponement first']])(
    '%s: the ended session settled, the week’s postponed, no deadlock',
    async (order) => {
      // An hour ended two hours ago, and one two days ahead.
      const w = await world(-3 * HOUR, 2 * DAY);
      const [ended, ahead] = w.sessionIds as [string, string];
      const sweep = sweepOver(new Set(w.sessionIds), new Date());
      const settle = () => sweep.settleDue();
      const move = () => postpone(w.enrollmentId, w.studentId);
      const [a, b] =
        order === 'the sweep first'
          ? await race(w.enrollmentId, settle, move)
          : await race(w.enrollmentId, move, settle);
      expect([a.status, b.status]).toEqual(['fulfilled', 'fulfilled']);
      expect(await statusOf(ended)).not.toBe('scheduled');
      expect(await statusOf(ahead)).toBe('postponed');
    },
  );

  it('never evaluates a postponed session, its end passed', async () => {
    const w = await world(2 * DAY);
    const [session] = w.sessionIds as [string];
    await postpone(w.enrollmentId, w.studentId);
    // The sweep three days on, after the session's end and the delay.
    const run = await sweepOver(
      new Set(w.sessionIds),
      new Date(addSeconds(new Date(), 3 * DAY)),
    ).settleDue();
    expect(run.settled).toEqual([]);
    expect(await statusOf(session)).toBe('postponed');
  });
});
