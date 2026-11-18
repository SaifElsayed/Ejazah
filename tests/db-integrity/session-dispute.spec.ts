// T026 of specs/004-sessions/tasks.md — `sessions.dispute.raise` over the real tables, as the
// application role (FR-473, FR-474, FR-495; research R-308; ERD §15 rule 46; contracts/kernel.md, the
// «dispute raised» row): the services `main.ts` binds, the kernel's idempotency over
// `idempotency_keys`, booking's `EnrollmentSide` for the enrollment's lock.
//
// A raise opens one `disputes` row (`session_dispute`, `open`, the raiser and the reason), marks the
// session `disputed` with its outcome frozen in `outcome_under_dispute` (or NULL before the
// evaluation) and writes one `session_events` row `dispute_raised`; a retry under the same key
// answers the first dispute and writes nothing; a session whose dispute an administrator resolved is
// disputed again inside its window (G1); outside the window nothing is written. The probe: two raises
// of one session at once, both past their first read before either locks, leave one open dispute,
// the second refused `DISPUTE_OPEN`, whether the two raisers are the session's two parties (they meet
// on the enrollment's lock) or one party twice under two keys (on the raiser's).
//
// The rows are written and committed by the harness, each probe with its own session.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createSessionsServices,
  disputeRaiseStore,
  type DisputeRaiseStore,
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
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addHours } from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

let db: Db;
let database: Database;

/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  dispute_window_hours: 72,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** The services as `main.ts` binds them, the raise's store narrowed where a probe says. */
function servicesWith(disputeStore: DisputeRaiseStore = disputeRaiseStore): SessionsServices {
  return createSessionsServices({
    notifications: NO_PUSH,
    transactions: transactionsOver(database),
    settings,
    video: {} as never,
    enrollmentSide: createEnrollmentSide({ settings }),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    disputeStore,
  });
}

/**
 * A male student and an approved male teacher with a confirmed enrollment and one session of an
 * hour that ended `endedHoursAgo` hours before now, in `status` (and its frozen outcome if any).
 */
async function sessionWorld(status: string, endedHoursAgo: number) {
  const offer = await makeOffer(db);
  await insertRow(db, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'approved',
    application_status: 'approved',
    payout_verified_at: '2026-10-01T00:00:00Z',
  });
  const studentId = await makeUser(db, { gender: 'male', display_name: 'طالب الفحص' });
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:05:00Z',
  });
  const endsAt = new Date(addHours(new Date(), -endedHoursAgo));
  const startsAt = new Date(addHours(endsAt, -1));
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-08',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: startsAt.toISOString(),
    scheduled_end_at: endsAt.toISOString(),
    status,
  });
  return { sessionId, enrollmentId, studentId, teacherId: offer.teacherId };
}

/** What the raise wrote for `sessionId`. */
async function writtenFor(sessionId: string) {
  const { rows: [session] = [] } = await db.query<{
    status: string;
    outcome_under_dispute: string | null;
  }>(
    'SELECT status::text AS status, outcome_under_dispute::text AS outcome_under_dispute FROM sessions WHERE id = $1',
    [sessionId],
  );
  const { rows: disputes } = await db.query<{
    id: string;
    kind: string;
    status: string;
    raised_by_user_id: string;
    reason: string;
  }>(
    `SELECT id, kind::text AS kind, status::text AS status, raised_by_user_id, reason
       FROM disputes WHERE session_id = $1 ORDER BY id`,
    [sessionId],
  );
  const { rows: events } = await db.query<{ kind: string }>(
    'SELECT kind::text AS kind FROM session_events WHERE session_id = $1 ORDER BY id',
    [sessionId],
  );
  return { session, disputes, events: events.map(({ kind }) => kind) };
}

async function refusalOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('answered where it must be refused');
}

const key = () => `probe-${randomUUID()}`;

describe('sessions.dispute.raise over the real tables (T026)', () => {
  it('opens one dispute, marks the session disputed with its outcome frozen and writes one dispute_raised event', async () => {
    const world = await sessionWorld('teacher_no_show', 2);
    const raised = await servicesWith().raiseDispute(
      { userId: world.studentId },
      { sessionId: world.sessionId, reason: 'لم يحضر المعلم', idempotencyKey: key() },
      log,
    );

    const written = await writtenFor(world.sessionId);
    expect(written.session).toEqual({ status: 'disputed', outcome_under_dispute: 'teacher_no_show' });
    expect(written.disputes).toEqual([
      {
        id: raised.disputeId,
        kind: 'session_dispute',
        status: 'open',
        raised_by_user_id: world.studentId,
        reason: 'لم يحضر المعلم',
      },
    ]);
    expect(raised.status).toBe('open');
    expect(written.events).toEqual(['dispute_raised']);
  });

  it('leaves the outcome NULL for a session still scheduled past its end, never evaluated', async () => {
    const world = await sessionWorld('scheduled', 1);
    await servicesWith().raiseDispute(
      { userId: world.teacherId },
      { sessionId: world.sessionId, reason: 'حضرتُ ولم يحضر الطالب', idempotencyKey: key() },
      log,
    );
    expect((await writtenFor(world.sessionId)).session).toEqual({
      status: 'disputed',
      outcome_under_dispute: null,
    });
  });

  it('answers a retry under the same key with the first dispute, writing nothing new', async () => {
    const world = await sessionWorld('done', 3);
    const services = servicesWith();
    const sent = { sessionId: world.sessionId, reason: 'سبب', idempotencyKey: key() };
    const first = await services.raiseDispute({ userId: world.studentId }, sent, log);
    const again = await services.raiseDispute({ userId: world.studentId }, sent, log);
    expect(again).toEqual(first);
    const written = await writtenFor(world.sessionId);
    expect(written.disputes).toHaveLength(1);
    expect(written.events).toEqual(['dispute_raised']);
  });

  it('opens a second dispute after an administrator resolved the first, inside the window (G1)', async () => {
    const world = await sessionWorld('teacher_no_show', 5);
    const services = servicesWith();
    const first = await services.raiseDispute(
      { userId: world.teacherId },
      { sessionId: world.sessionId, reason: 'حضرتُ', idempotencyKey: key() },
      log,
    );
    // The administrator's resolution, as T034 will write it: the dispute closed, the final status.
    const admin = await makeAdmin(db);
    await db.query(
      `UPDATE disputes SET status = 'resolved', resolution = 'no_show_recorded',
              resolution_notes = 'Probe ruling', resolved_by_admin_id = $2, resolved_at = clock_timestamp(),
              updated_at = now()
        WHERE id = $1`,
      [first.disputeId, admin],
    );
    await db.query(
      `UPDATE sessions SET status = 'student_no_show', outcome_under_dispute = NULL,
              settled_by_admin_id = $2, admin_settled_at = now(), updated_at = now()
        WHERE id = $1`,
      [world.sessionId, admin],
    );

    const second = await services.raiseDispute(
      { userId: world.studentId },
      { sessionId: world.sessionId, reason: 'كنتُ حاضرًا', idempotencyKey: key() },
      log,
    );

    const written = await writtenFor(world.sessionId);
    expect(written.disputes.map(({ id, status }) => [id, status])).toEqual([
      [first.disputeId, 'resolved'],
      [second.disputeId, 'open'],
    ]);
    expect(written.session).toEqual({ status: 'disputed', outcome_under_dispute: 'student_no_show' });
    expect(written.events).toEqual(['dispute_raised', 'dispute_raised']);
  });

  it('refuses outside the window, a cancelled session and an open dispute, writing nothing', async () => {
    const closed = await sessionWorld('done', 73);
    expect(
      await refusalOf(
        servicesWith().raiseDispute(
          { userId: closed.studentId },
          { sessionId: closed.sessionId, reason: 'سبب', idempotencyKey: key() },
          log,
        ),
      ),
    ).toBe('DISPUTE_WINDOW_CLOSED');
    expect(await writtenFor(closed.sessionId)).toEqual({
      session: { status: 'done', outcome_under_dispute: null },
      disputes: [],
      events: [],
    });

    const cancelled = await sessionWorld('cancelled_by_agreement', 2);
    expect(
      await refusalOf(
        servicesWith().raiseDispute(
          { userId: cancelled.teacherId },
          { sessionId: cancelled.sessionId, reason: 'سبب', idempotencyKey: key() },
          log,
        ),
      ),
    ).toBe('NOT_DISPUTABLE');
    expect((await writtenFor(cancelled.sessionId)).disputes).toEqual([]);
  });
});

/**
 * A raise store whose first unlocked read of each raise waits until `count` raises have made theirs,
 * so the raises meet at the locks, never one after the other's commit.
 */
function meetingAtTheLocks(count: number): DisputeRaiseStore {
  const seen = new WeakSet<object>();
  let arrived = 0;
  let release: () => void = () => undefined;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    ...disputeRaiseStore,
    sessionOfParty: async (tx, sessionId, userId) => {
      const row = await disputeRaiseStore.sessionOfParty(tx, sessionId, userId);
      if (!seen.has(tx)) {
        seen.add(tx);
        arrived += 1;
        if (arrived === count) release();
        await allArrived;
      }
      return row;
    },
  };
}

describe('two raises of one session at once (T026, rule 46; kernel.md, «dispute raised»)', () => {
  it('leave one open dispute when the student and the teacher raise together, the second refused DISPUTE_OPEN', async () => {
    const world = await sessionWorld('done', 2);
    const services = servicesWith(meetingAtTheLocks(2));
    const outcomes = await Promise.allSettled([
      services.raiseDispute(
        { userId: world.studentId },
        { sessionId: world.sessionId, reason: 'سبب الطالب', idempotencyKey: key() },
        log,
      ),
      services.raiseDispute(
        { userId: world.teacherId },
        { sessionId: world.sessionId, reason: 'سبب المعلم', idempotencyKey: key() },
        log,
      ),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const [refused] = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused?.reason).toBeInstanceOf(DomainError);
    expect((refused?.reason as DomainError).code).toBe('DISPUTE_OPEN');
    const written = await writtenFor(world.sessionId);
    expect(written.disputes.filter(({ status }) => status === 'open')).toHaveLength(1);
    expect(written.events).toEqual(['dispute_raised']);
    expect(written.session?.status).toBe('disputed');
  });

  it('leave one open dispute when one party raises twice under two keys', async () => {
    const world = await sessionWorld('student_no_show', 2);
    const services = servicesWith(meetingAtTheLocks(2));
    const outcomes = await Promise.allSettled(
      [key(), key()].map((idempotencyKey) =>
        services.raiseDispute(
          { userId: world.studentId },
          { sessionId: world.sessionId, reason: 'سبب', idempotencyKey },
          log,
        ),
      ),
    );

    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const written = await writtenFor(world.sessionId);
    expect(written.disputes).toHaveLength(1);
    expect(written.events).toEqual(['dispute_raised']);
  });
});
