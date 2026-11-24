// 004:T084 (SRS DEC-102, DEC-105, NFR-SEC-13, FR-SESS-2, FR-ADMIN-20 (a); the note under T084, (2),
// (3); ERD changelog row 78, §15 rule 84) — the media key's hand-over and the failure's record over the
// real tables: the sessions services with the store over the sessions module's reads and identity's
// accounts (`sessionsStore`), booking's `EnrollmentSide` and the video stand-in, as `main.ts` binds them.
//
//   - both parties of one session are handed one media key with their tokens, another session
//     another, and no audit entry and no stored idempotency response holds it;
//   - `sessions.encryptionFailed` writes one `encryption_failed` row per report, naming the caller's
//     side and the database's instant, nothing else; a non-party is answered NOT_FOUND, no row;
//   - its locks (contracts/kernel.md, rule 2 and the general rule): it waits on an account held by a
//     gender correction and reads the corrected record (NOT_FOUND, no row); it waits on the enrollment
//     held elsewhere at its own `FOR UPDATE`, never at the insert's foreign-key check;
//   - round 2 (the owner's Q-C1-2 (a)): `disputes.get`'s evidence lists the disputed session's
//     failures with their side and time, and none of another session's.
//
// The rows are committed, each probe writing parents of its own, since the services open their own
// transactions. Every connection is the application role, as `session-join.spec.ts` stages a wait.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createDisputeQueue,
  createSessionsServices,
  createTelemetryReader,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { lockRows } from '../../apps/api/src/platform/db/row-lock.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { createVideoPort } from '../../apps/api/src/platform/ports/video/index.js';
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

let db: Db;
let watcher: Db;
let database: Database;
let services: SessionsServices;

/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  // Round 2 (Q-C1-2 (a)): the attendance rules the dispute's telemetry reads.
  join_window_minutes: 15,
  minimum_connection_seconds: 300,
  attendance_threshold_pct: 80,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });

beforeAll(async () => {
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  services = createSessionsServices({
    notifications: { record: async () => undefined },
    transactions: transactionsOver(database),
    settings,
    // The stand-in, its media keys under a stand-in of a key generated for this run (R-SEC-1).
    video: createVideoPort({
      VIDEO_PROVIDER: 'fake',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
    enrollmentSide: createEnrollmentSide({ settings }),
    store: sessionsStore,
    idempotency: { run: () => Promise.reject(new Error('nothing is keyed here')) },
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

/**
 * A male student and an approved male teacher with a confirmed enrollment and two scheduled sessions
 * of an hour, the first starting five minutes from now.
 */
async function sessionWorld() {
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
  const session = async (sequence: number, startsInMinutes: number) => {
    const startsAt = new Date(addMinutes(new Date(), startsInMinutes));
    return insertRow(db, 'sessions', {
      enrollment_id: enrollmentId,
      teacher_user_id: offer.teacherId,
      student_user_id: studentId,
      sequence_number: sequence,
      scheduled_date_local: '2026-11-23',
      scheduled_start_time_local: '09:00:00',
      timezone: 'Africa/Cairo',
      scheduled_start_at: startsAt.toISOString(),
      scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
      status: 'scheduled',
    });
  };
  const sessionId = await session(1, 5);
  const nextSessionId = await session(2, 2 * 24 * 60);
  return { sessionId, nextSessionId, enrollmentId, studentId, teacherId: offer.teacherId };
}

/** The session's `session_events` rows, as written. */
async function eventsOf(sessionId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT enrollment_id, session_id, kind::text AS kind, party::text AS party, case_id,
            counter_slot_id, outcome_before, outcome_after, previous_start_at, occurred_at
       FROM session_events WHERE session_id = $1 ORDER BY occurred_at, id`,
    [sessionId],
  );
  return rows;
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

/** Resolves once a backend runs `pattern` waiting on a lock; fails after about two seconds. */
async function seenWaiting(pattern: string): Promise<string> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database() AND query LIKE $1`,
      [pattern],
    );
    const first = rows[0];
    if (first !== undefined) return first.query;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`nothing waited on a lock running ${pattern}`);
}

/** Holds `work`'s locks in a transaction of its own until `release` is called. */
function holding(work: (tx: Transaction) => Promise<void>) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = (): void => undefined;
  const taken = new Promise<void>((resolve) => {
    held = resolve;
  });
  const done = database.$transaction(
    async (tx) => {
      await work(tx);
      held();
      await released;
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
  return { taken, release, done };
}

describe('the media key over the real tables (T084, DEC-102, NFR-SEC-13)', () => {
  it('hands both parties of one session the same key and another session another, stored nowhere', async () => {
    const world = await sessionWorld();
    const student = await services.join(
      { userId: world.studentId },
      { sessionId: world.sessionId },
      log,
    );
    const teacher = await services.join(
      { userId: world.teacherId },
      { sessionId: world.sessionId },
      log,
    );

    expect(student.mediaKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(teacher.mediaKey).toBe(student.mediaKey);
    expect(teacher.token).not.toBe(student.token);
    for (const table of ['audit_logs', 'idempotency_keys']) {
      const { rows } = await db.query<{ holding: string }>(
        `SELECT count(*) AS holding FROM ${table} t WHERE strpos(t::text, $1) > 0`,
        [student.mediaKey],
      );
      expect(rows[0]?.holding, table).toBe('0');
    }
  });
});

describe('sessions.encryptionFailed over the real tables (T084, DEC-105)', () => {
  it('writes one encryption_failed row per report, naming the caller’s side and the database’s instant', async () => {
    const world = await sessionWorld();
    const before = new Date();
    await services.encryptionFailed(
      { userId: world.teacherId },
      { sessionId: world.sessionId },
      log,
    );
    await services.encryptionFailed(
      { userId: world.studentId },
      { sessionId: world.sessionId },
      log,
    );
    const after = new Date();

    const rows = await eventsOf(world.sessionId);
    expect(rows.map(({ occurred_at: _at, ...row }) => row)).toEqual(
      ['teacher', 'student'].map((party) => ({
        enrollment_id: world.enrollmentId,
        session_id: world.sessionId,
        kind: 'encryption_failed',
        party,
        case_id: null,
        counter_slot_id: null,
        outcome_before: null,
        outcome_after: null,
        previous_start_at: null,
      })),
    );
    for (const { occurred_at: at } of rows) {
      // The database's clock, a second either side of this process's.
      expect((at as Date).getTime()).toBeGreaterThanOrEqual(
        new Date(addSeconds(before, -1)).getTime(),
      );
      expect((at as Date).getTime()).toBeLessThanOrEqual(new Date(addSeconds(after, 1)).getTime());
    }
    expect(await eventsOf(world.nextSessionId)).toEqual([]);
  });

  it('answers a non-party and a nonexistent session NOT_FOUND, writing no row', async () => {
    const world = await sessionWorld();
    const stranger = await makeUser(db, { gender: 'male' });

    expect(
      await refusalOf(
        services.encryptionFailed({ userId: stranger }, { sessionId: world.sessionId }, log),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await refusalOf(
        services.encryptionFailed({ userId: world.studentId }, { sessionId: randomUUID() }, log),
      ),
    ).toBe('NOT_FOUND');
    expect(await eventsOf(world.sessionId)).toEqual([]);
  });
});

describe('sessions.encryptionFailed’s locks (contracts/kernel.md, rule 2 and the general rule)', () => {
  it('waits on an account held by a gender correction, then reads the corrected record: NOT_FOUND, no row', async () => {
    const world = await sessionWorld();
    // The server's record after an administrator's correction, written directly under the account's
    // lock, as such a correction would hold it (the note under T011, K2).
    const correction = holding(async (tx) => {
      await lockRows(tx, 'users', [world.teacherId]);
      await tx.user.update({ where: { id: world.teacherId }, data: { gender: 'female' } });
    });
    await correction.taken;
    const reporting = refusalOf(
      services.encryptionFailed({ userId: world.studentId }, { sessionId: world.sessionId }, log),
    );
    try {
      await seenWaiting('%FROM users WHERE id = ANY%FOR UPDATE%');
    } finally {
      correction.release();
    }
    await correction.done;

    expect(await reporting).toBe('NOT_FOUND');
    expect(await eventsOf(world.sessionId)).toEqual([]);
  });

  it('waits on the enrollment held elsewhere at its own FOR UPDATE, before its insert', async () => {
    const world = await sessionWorld();
    const hold = holding(async (tx) => {
      await lockRows(tx, 'enrollments', [world.enrollmentId]);
    });
    await hold.taken;
    const reporting = services.encryptionFailed(
      { userId: world.studentId },
      { sessionId: world.sessionId },
      log,
    );
    let waitingOn: string;
    try {
      // Whatever statement waits: under the rule it is the enrollment's lock, never the insert.
      waitingOn = await seenWaiting('%');
    } finally {
      hold.release();
    }
    await hold.done;
    await reporting;

    expect(waitingOn).toMatch(/FROM enrollments WHERE id = ANY\(.*\) ORDER BY id FOR UPDATE/);
    expect((await eventsOf(world.sessionId)).map(({ party }) => party)).toEqual(['student']);
  });
});

// Round 2 (the owner's Q-C1-2 (a), 2026-11-23; SRS DEC-105): a dispute's evidence lists its session's
// encryption failures, through `disputes.get` with the real telemetry reader; the ruling's revisions
// are `ruling-revision.spec.ts`' and a stub here.
describe('disputes.get: the session’s encryption failures (T084, Q-C1-2 (a))', () => {
  const queue = () =>
    createDisputeQueue({
      telemetry: createTelemetryReader({ settings }),
      revisions: { revisionView: async () => ({ revisable: false, revisions: [] }) },
      settings,
      log: { info: () => undefined },
    });

  /** The session disputed by its student, as the evaluation and the raise leave it. */
  async function disputedOn(world: Awaited<ReturnType<typeof sessionWorld>>, sessionId: string) {
    await db.query(
      `UPDATE sessions SET status = 'disputed', outcome_under_dispute = 'teacher_no_show',
              evaluated_at = now(), updated_at = now()
        WHERE id = $1`,
      [sessionId],
    );
    return insertRow(db, 'disputes', {
      enrollment_id: world.enrollmentId,
      session_id: sessionId,
      kind: 'session_dispute',
      raised_by_user_id: world.studentId,
      reason: 'لم يحضر المعلم',
      status: 'open',
    });
  }

  it('lists the disputed session’s failure with its side, and none on another session’s dispute', async () => {
    const world = await sessionWorld();
    await services.encryptionFailed(
      { userId: world.teacherId },
      { sessionId: world.sessionId },
      log,
    );
    const [failure] = await eventsOf(world.sessionId);
    const withFailure = await disputedOn(world, world.sessionId);
    const without = await disputedOn(world, world.nextSessionId);
    const admin = await makeAdmin(db);

    const answer = await database.$transaction((tx) =>
      queue().get(tx, admin, { disputeId: withFailure }),
    );
    expect(answer.telemetry.encryptionFailures).toEqual([
      { party: 'teacher', occurredAt: (failure?.occurred_at as Date).toISOString() },
    ]);
    const other = await database.$transaction((tx) =>
      queue().get(tx, admin, { disputeId: without }),
    );
    expect(other.telemetry.encryptionFailures).toEqual([]);
  });
});
