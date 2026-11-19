// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; ERD changelog row 59, §15
// rules 19 as amended, 65 and 66; contracts/kernel.md, «a postponement») — the postponement over the
// real tables, `20261119095115_session_postponements` applied.
//
//   - RULE 65: a reason blank or over 500 characters refused; the table append-only to the
//     application role (UPDATE and DELETE refused);
//   - RULE 66: a session `postponed` exactly when it names its postponement;
//   - RULE 19 as amended: a `postponed` session frees its time for both overlap exclusions, as the
//     two cancelled statuses do;
//   - `sessions.postpone` through the sessions services as `main.ts` binds them: the week's session
//     `postponed` naming the row written, one `postponed` event, its make-up offered, a session
//     after the week standing;
//   - THE RACE OF THE INTERVAL (FR-POSTPONE-4, kernel.md's row): two postponements by one party at
//     once, each with its own key, leave one: the second waits on the `users` lock the first holds,
//     reads the first's row under it and is refused `CONFLICT` `interval_not_passed`.
//
// The probes of the checks run in a rolled-back transaction; the service's rows are committed, each
// probe with a world of its own; every connection is the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createCaseQueue,
  createSessionsServices,
  remedyAdvanceStore,
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
  attempt,
  connectAsApplication,
  type Db,
  enrollmentValues,
  inRollback,
  insertRow,
  makeAdmin,
  makeOffer,
  makeSession,
  makeUser,
  SQLSTATE,
} from './harness';

const NO_PUSH = { record: async () => undefined };

let db: Db;
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
  // 003:T112.
  postponement_notice_hours: 12,
  postponement_interval_weeks: 4,
  // The case queue's reads (Q-B's probe).
  admin_list_page_size: 50,
  repeated_absence_flag_count: 5,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });
const noLive: LivePublisher = { afterCommit: () => undefined };

beforeAll(async () => {
  db = await connectAsApplication();
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
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** A postponement row of a fresh session's enrollment, by its student, inside the caller's transaction. */
async function postponementRow(probe: Db, reason = 'سفر طارئ') {
  const session = await makeSession(probe);
  const postponementId = await insertRow(probe, 'session_postponements', {
    enrollment_id: session.enrollmentId,
    requested_by_user_id: session.studentId,
    reason,
  });
  return { ...session, postponementId };
}

describe('rule 65: the reason, and an append-only table', () => {
  it('refuses a reason empty, blank or over 500 characters, and takes one of 500', async () => {
    await inRollback(db, async (probe) => {
      const { enrollmentId, studentId } = await makeSession(probe);
      const insert = (reason: string) =>
        attempt(
          probe,
          `INSERT INTO session_postponements (enrollment_id, requested_by_user_id, reason)
           VALUES ($1, $2, $3)`,
          [enrollmentId, studentId, reason],
        );
      expect(await insert('')).toBe(SQLSTATE.checkViolation);
      expect(await insert('   ')).toBe(SQLSTATE.checkViolation);
      expect(await insert('ا'.repeat(501))).toBe(SQLSTATE.checkViolation);
      expect(await insert('ا'.repeat(500))).toBeNull();
    });
  });

  it('refuses the application role an UPDATE and a DELETE of a row', async () => {
    await inRollback(db, async (probe) => {
      const { postponementId } = await postponementRow(probe);
      expect(
        await attempt(probe, `UPDATE session_postponements SET reason = 'other' WHERE id = $1`, [
          postponementId,
        ]),
      ).toBe(SQLSTATE.insufficientPrivilege);
      expect(
        await attempt(probe, 'DELETE FROM session_postponements WHERE id = $1', [postponementId]),
      ).toBe(SQLSTATE.insufficientPrivilege);
    });
  });
});

describe('rule 66: postponed exactly when it names its postponement', () => {
  it('refuses the status without the row and the row without the status, and takes both', async () => {
    await inRollback(db, async (probe) => {
      const { sessionId, postponementId } = await postponementRow(probe);
      expect(
        await attempt(probe, `UPDATE sessions SET status = 'postponed' WHERE id = $1`, [sessionId]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await attempt(probe, 'UPDATE sessions SET postponement_id = $2 WHERE id = $1', [
          sessionId,
          postponementId,
        ]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await attempt(
          probe,
          `UPDATE sessions SET status = 'postponed', postponement_id = $2 WHERE id = $1`,
          [sessionId, postponementId],
        ),
      ).toBeNull();
    });
  });
});

describe('rule 19 as amended: a postponed session frees both parties’ time', () => {
  it.each([['teacher'], ['student']])(
    'admits a session over the %s’s postponed one, refused while it was scheduled',
    async (party) => {
      await inRollback(db, async (probe) => {
        const first = await postponementRow(probe);
        // A second enrollment sharing the party, the other party new, at the same hour.
        const offer = await makeOffer(probe);
        const otherStudent = await makeUser(probe, { gender: 'male' });
        const values = enrollmentValues(offer, otherStudent);
        const enrollmentId = await insertRow(probe, 'enrollments', {
          ...values,
          ...(party === 'teacher'
            ? { teacher_user_id: first.teacherId }
            : { student_user_id: first.studentId }),
        });
        const overlapping = `INSERT INTO sessions (enrollment_id, teacher_user_id, student_user_id,
            sequence_number, scheduled_date_local, scheduled_start_time_local, timezone,
            scheduled_start_at, scheduled_end_at, status, updated_at)
          VALUES ($1, $2, $3, 1, '2026-10-04', '09:00:00', 'Africa/Cairo',
            '2026-10-04T06:30:00Z', '2026-10-04T07:30:00Z', 'scheduled', now())`;
        const params = [
          enrollmentId,
          party === 'teacher' ? first.teacherId : offer.teacherId,
          party === 'teacher' ? otherStudent : first.studentId,
        ];
        expect(await attempt(probe, overlapping, params)).toBe(SQLSTATE.exclusionViolation);
        await probe.query(
          `UPDATE sessions SET status = 'postponed', postponement_id = $2 WHERE id = $1`,
          [first.sessionId, first.postponementId],
        );
        expect(await attempt(probe, overlapping, params)).toBeNull();
      });
    },
  );
});

/**
 * A male student and an approved male teacher with a confirmed enrollment: its first session two
 * days from now, inside the week, and its second nine days from now, after it.
 */
async function world() {
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
  const session = async (sequence: number, startsInSeconds: number) => {
    const startsAt = new Date(addSeconds(new Date(), startsInSeconds));
    return insertRow(db, 'sessions', {
      enrollment_id: enrollmentId,
      teacher_user_id: offer.teacherId,
      student_user_id: studentId,
      sequence_number: sequence,
      scheduled_date_local: '2026-11-22',
      scheduled_start_time_local: '09:00:00',
      timezone: 'Africa/Cairo',
      scheduled_start_at: startsAt.toISOString(),
      scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
      status: 'scheduled',
    });
  };
  const DAY = 24 * 60 * 60;
  const inWeek = await session(1, 2 * DAY);
  const afterWeek = await session(2, 9 * DAY);
  return { enrollmentId, studentId, teacherId: offer.teacherId, inWeek, afterWeek };
}

const postpone = (enrollmentId: string, userId: string, idempotencyKey = `probe-${randomUUID()}`) =>
  services.postpone({ userId }, { enrollmentId, reason: 'سفر طارئ', idempotencyKey }, log, noLive);

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('answered where it must be refused');
}

describe('sessions.postpone over the real tables (FR-POSTPONE-1, FR-POSTPONE-2)', () => {
  it('moves the week’s session to postponed naming its row, records the event, offers its make-up and leaves the next week’s', async () => {
    const w = await world();
    const answer = await postpone(w.enrollmentId, w.teacherId);
    expect(answer.sessionIds).toEqual([w.inWeek]);
    const sessions = await db.query<{ id: string; status: string; postponement_id: string | null }>(
      'SELECT id, status::text, postponement_id FROM sessions WHERE enrollment_id = $1 ORDER BY sequence_number',
      [w.enrollmentId],
    );
    expect(sessions.rows).toEqual([
      { id: w.inWeek, status: 'postponed', postponement_id: answer.postponementId },
      { id: w.afterWeek, status: 'scheduled', postponement_id: null },
    ]);
    const rows = await db.query<{ requested_by_user_id: string; reason: string }>(
      'SELECT requested_by_user_id, reason FROM session_postponements WHERE enrollment_id = $1',
      [w.enrollmentId],
    );
    expect(rows.rows).toEqual([{ requested_by_user_id: w.teacherId, reason: 'سفر طارئ' }]);
    const events = await db.query<{ kind: string }>(
      'SELECT kind::text FROM session_events WHERE session_id = $1 ORDER BY id',
      [w.inWeek],
    );
    expect(events.rows.map(({ kind }) => kind)).toEqual(['postponed', 'remedy_offered']);
    const remedies = await db.query<{ status: string }>(
      'SELECT status::text FROM session_remedies WHERE session_id = $1',
      [w.inWeek],
    );
    expect(remedies.rows).toEqual([{ status: 'proposed' }]);
    // 003:T112 (Q-D (a)): both parties read who postponed it, its reason and when (sessions.get).
    for (const userId of [w.studentId, w.teacherId]) {
      const got = await services.get({ userId }, { sessionId: w.inWeek }, log);
      expect(got.status).toBe('postponed');
      expect(got.postponement).toEqual({
        by: 'teacher',
        reason: 'سفر طارئ',
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    }
    expect(
      (await services.get({ userId: w.studentId }, { sessionId: w.afterWeek }, log)).postponement,
    ).toBeUndefined();
  });

  it('two postponements by one party at once leave one; the second, waiting on the users lock, is refused interval_not_passed', async () => {
    const w = await world();
    const [a, b] = await Promise.allSettled([
      postpone(w.enrollmentId, w.studentId),
      postpone(w.enrollmentId, w.studentId),
    ]);
    const answered = [a, b].filter((one) => one.status === 'fulfilled');
    const refused = [a, b].flatMap((one) => (one.status === 'rejected' ? [one.reason] : []));
    expect(answered).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(DomainError);
    expect((refused[0] as DomainError).code).toBe('CONFLICT');
    expect((refused[0] as DomainError).details).toEqual([
      { path: 'cause', code: 'interval_not_passed' },
    ]);
    const rows = await db.query('SELECT 1 FROM session_postponements WHERE enrollment_id = $1', [
      w.enrollmentId,
    ]);
    expect(rows.rowCount).toBe(1);
    // The other party's own interval is untouched: the teacher may postpone the next week's later.
    expect((await refusalOf(postpone(w.enrollmentId, w.teacherId))).details).toEqual([
      { path: 'cause', code: 'no_session_in_week' },
    ]);
  });
});

// 003:T112 (the owner's Q-B (a)): a postponed session whose make-up was never offered (its student
// suspended at the postponement, say) is owed as an agreed cancellation is: the sweep offers it, and
// an end hands it to its case. Written before `OWING_STATUSES` changed, run red first.
describe('a postponed session never offered, as the sweep and an end read it (Q-B)', () => {
  it('is due for the sweep’s offer and owed never offered on its enrollment', async () => {
    const w = await world();
    const postponementId = await insertRow(db, 'session_postponements', {
      enrollment_id: w.enrollmentId,
      requested_by_user_id: w.studentId,
      reason: 'سفر طارئ',
    });
    await db.query(`UPDATE sessions SET status = 'postponed', postponement_id = $2 WHERE id = $1`, [
      w.inWeek,
      postponementId,
    ]);
    const due = await database.$transaction((tx) =>
      remedyAdvanceStore.dueForOffer(tx, new Date(), undefined, 100_000),
    );
    expect(due.map(({ sessionId }) => sessionId)).toContain(w.inWeek);
    // An end's case covers it as owed never offered (`case-covers.repository.ts`, through the queue).
    const admin = await makeAdmin(db);
    const caseId = await insertRow(db, 'disputes', {
      enrollment_id: w.enrollmentId,
      kind: 'compensation_case',
      reason: 'teacher_ended',
      status: 'open',
    });
    const queue = createCaseQueue({
      enrollments: createEnrollmentSide({ settings }),
      settings,
      log: { info: () => undefined },
    });
    const answer = await database.$transaction((tx) => queue.get(tx, admin, { caseId }));
    expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual([w.inWeek]);
  });
});
