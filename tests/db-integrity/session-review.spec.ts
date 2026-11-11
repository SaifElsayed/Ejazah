// T033 of specs/004-sessions/tasks.md — the review queue over the real tables as the application
// role (FR-446, FR-450, FR-477, FR-495; R-SESS-6; contracts/kernel.md, «evaluation, a review or
// dispute resolution»; the note under T033, «one writer of an administrator's outcome»).
//
// A session `under_threshold` or `provider_outage` is listed in the queue and resolved to one of the
// four outcomes: `status` written, `outcome_under_dispute` NULL, `settled_by_admin_id` and
// `admin_settled_at` together (rule 40), one `session_events` row `review_resolved`, then T015's
// check, which completes an enrollment owing nothing once its last window has closed and leaves one
// owing a remedy confirmed, offering none. A session not under review is refused `CONFLICT`
// `not_under_review`, writing nothing.
//
// The parents are written and committed by the harness, each probe with its own users; each
// resolution runs in a transaction this file rolls back, so no status or event row it writes is
// kept. The sessions lie in October 2026, so their dispute windows closed long before the
// database's clock, which completion reads (Q3).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { randomUUID } from 'node:crypto';

import {
  createCompletion,
  createSessionReview,
  createTelemetryReader,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');
const AT = new Date('2026-11-10T08:00:00Z');

let db: Db;
let database: Database;

const SETTINGS: Readonly<Record<string, number>> = {
  dispute_window_hours: 72,
  admin_list_page_size: 100,
  slot_release_buffer_weeks: 0,
  join_window_minutes: 15,
  minimum_connection_seconds: 300,
  attendance_threshold_pct: 80,
  early_join_lead_minutes: 10,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
const log = { info: () => undefined } as unknown as Parameters<
  typeof createSessionReview
>[0]['log'];
const enrollments = createEnrollmentSide({ settings, now: () => AT });
const review = createSessionReview({
  enrollments,
  completion: createCompletion({ enrollments, settings }),
  telemetry: {
    of: async () => {
      throw new Error('the resolution reads no telemetry');
    },
  },
  settings,
  log,
  clock: async () => AT,
});

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

/** A committed confirmed enrollment of a new student and teacher, with one session of `status`. */
async function enrollmentWithSession(
  status: string,
): Promise<{ enrollmentId: string; sessionId: string }> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: CONFIRMED_AT,
    snapshot_session_count: 1,
  });
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-10-11',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: '2026-10-11T06:00:00Z',
    scheduled_end_at: '2026-10-11T07:00:00Z',
    status,
    simultaneous_connected_seconds: 600,
    evaluated_at: '2026-10-11T07:03:00Z',
  });
  return { enrollmentId, sessionId };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

describe('sessions.review.list (FR-477)', () => {
  it('lists a session under review with its figure and parties, and leaves out a settled one', async () => {
    const queued = await enrollmentWithSession('provider_outage');
    const settled = await enrollmentWithSession('done');
    const seen = new Map<string, unknown>();
    await rolledBack(async (tx) => {
      let cursor: string | undefined;
      // Bounded: each page moves past its last id, and the queue is finite.
      for (let page = 0; page < 1000; page += 1) {
        const answer = await review.list(tx, 'admin', cursor === undefined ? {} : { cursor });
        for (const item of answer.items) seen.set(item.sessionId, item);
        if (answer.nextCursor === undefined) break;
        cursor = answer.nextCursor;
      }
    });
    expect(seen.get(queued.sessionId)).toMatchObject({
      enrollmentId: queued.enrollmentId,
      status: 'provider_outage',
      startsAt: '2026-10-11T06:00:00.000Z',
      endsAt: '2026-10-11T07:00:00.000Z',
      simultaneousSeconds: 600,
      parties: { student: { deleted: false }, teacher: { deleted: false } },
    });
    expect(seen.has(settled.sessionId)).toBe(false);
  });
});

describe('sessions.review.resolve (R-SESS-6, FR-450)', () => {
  it('writes the outcome, the administrator and the instant, one review_resolved row, and completes an enrollment owing nothing', async () => {
    const adminId = await makeAdmin(db);
    const { enrollmentId, sessionId } = await enrollmentWithSession('under_threshold');
    await rolledBack(async (tx) => {
      expect(
        await review.resolve(tx, adminId, { sessionId, outcome: 'done', reason: 'r' }),
      ).toEqual({ sessionId, status: 'done' });
      const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session).toMatchObject({
        status: 'done',
        outcomeUnderDispute: null,
        settledByAdminId: adminId,
        adminSettledAt: AT,
        simultaneousConnectedSeconds: 600,
      });
      const events = await tx.sessionEvent.findMany({ where: { sessionId } });
      expect(events.map(({ kind, caseId, occurredAt }) => ({ kind, caseId, occurredAt }))).toEqual([
        { kind: 'review_resolved', caseId: null, occurredAt: AT },
      ]);
      const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(enrollment.status).toBe('completed');
      expect(await tx.sessionRemedy.count({ where: { sessionId } })).toBe(0);
    });
  });

  it('leaves an enrollment owing the remedy of a Teacher-No-Show confirmed, offering none in the transaction (A2)', async () => {
    const adminId = await makeAdmin(db);
    const { enrollmentId, sessionId } = await enrollmentWithSession('provider_outage');
    await rolledBack(async (tx) => {
      await review.resolve(tx, adminId, { sessionId, outcome: 'teacher_no_show', reason: 'r' });
      expect((await tx.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
        'teacher_no_show',
      );
      const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(enrollment.status).toBe('confirmed');
      expect(await tx.sessionRemedy.count({ where: { sessionId } })).toBe(0);
    });
  });

  it.each(['done', 'scheduled'])(
    'refuses a %s session CONFLICT not_under_review, writing nothing',
    async (status) => {
      const adminId = await makeAdmin(db);
      const { sessionId } = await enrollmentWithSession(status);
      await rolledBack(async (tx) => {
        const refused = await refusalOf(
          review.resolve(tx, adminId, { sessionId, outcome: 'done', reason: 'r' }),
        );
        expect(refused.code).toBe('CONFLICT');
        expect(refused.details).toEqual([{ path: 'cause', code: 'not_under_review' }]);
        const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } });
        expect(session).toMatchObject({ status, settledByAdminId: null, adminSettledAt: null });
        expect(await tx.sessionEvent.count({ where: { sessionId } })).toBe(0);
      });
    },
  );
});

describe('sessions.review.get (GAP-2)', () => {
  const reading = createSessionReview({
    enrollments,
    completion: createCompletion({ enrollments, settings }),
    telemetry: createTelemetryReader({ settings }),
    settings,
    log,
  });

  /** One recorded participant event or room end of the session, as the video webhook writes it. */
  async function recorded(
    sessionId: string,
    eventType: 'joined' | 'left' | 'room_ended',
    occurredAt: string,
    userId: string | null = null,
    connectionRef: string | null = null,
  ): Promise<void> {
    await insertRow(db, 'session_participant_events', {
      session_id: sessionId,
      user_id: userId,
      event_type: eventType,
      connection_ref: connectionRef,
      occurred_at: occurredAt,
      provider_event_id: `probe-${randomUUID()}`,
    });
  }

  it('reads a cancelled session’s record over the real tables: its room’s end, the parties’ joins and leaves', async () => {
    const { sessionId } = await enrollmentWithSession('cancelled_by_admin');
    const { rows } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
      'SELECT student_user_id, teacher_user_id FROM sessions WHERE id = $1::uuid',
      [sessionId],
    );
    const [parties] = rows;
    if (parties === undefined) throw new Error('probe: no session');
    await recorded(sessionId, 'joined', '2026-10-11T06:00:05Z', parties.teacher_user_id, 'PA_t');
    await recorded(sessionId, 'joined', '2026-10-11T06:10:00Z', parties.student_user_id, 'PA_s');
    await recorded(sessionId, 'left', '2026-10-11T06:30:00Z', parties.teacher_user_id, 'PA_t');
    await recorded(sessionId, 'room_ended', '2026-10-11T06:40:00Z');
    await rolledBack(async (tx) => {
      const telemetry = await reading.get(tx, 'admin', { sessionId });
      expect(telemetry).toMatchObject({
        sessionId,
        schedule: {
          localDate: '2026-10-11',
          startTimeLocal: '09:00',
          timezone: 'Africa/Cairo',
          startsAt: '2026-10-11T06:00:00.000Z',
          endsAt: '2026-10-11T07:00:00.000Z',
        },
        status: 'cancelled_by_admin',
        intervals: {
          teacher: [{ startsAt: '2026-10-11T06:00:05.000Z', endsAt: '2026-10-11T06:30:00.000Z' }],
          student: [{ startsAt: '2026-10-11T06:10:00.000Z', endsAt: '2026-10-11T06:40:00.000Z' }],
          together: [{ startsAt: '2026-10-11T06:10:00.000Z', endsAt: '2026-10-11T06:30:00.000Z' }],
        },
        simultaneousSeconds: 600,
        joined: { student: true, teacher: true },
      });
      expect(telemetry.events.map(({ party, type }) => `${party}:${type}`)).toEqual([
        'teacher:joined',
        'student:joined',
        'teacher:left',
        'room:room_ended',
      ]);
    });
  });

  it('refuses a scheduled session CONFLICT not_settled', async () => {
    const { sessionId } = await enrollmentWithSession('scheduled');
    await rolledBack(async (tx) => {
      const refused = await refusalOf(reading.get(tx, 'admin', { sessionId }));
      expect(refused.code).toBe('CONFLICT');
      expect(refused.details).toEqual([{ path: 'cause', code: 'not_settled' }]);
    });
  });
});
