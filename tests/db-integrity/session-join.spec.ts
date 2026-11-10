// T011 of specs/004-sessions — `sessions.join` and `sessions.get` over the real tables (FR-431,
// FR-432, FR-482; R-GENDER-7, R-SESS-5; contracts/kernel.md, the `sessions.join` row; the note under
// T011, K2): the sessions services with the store over the sessions module's reads and identity's
// accounts (`sessionsStore`), booking's `EnrollmentSide` and the video stand-in, as `main.ts` binds
// them.
//
//   - a party inside the join period gets a token bound to the session and to them until the
//     scheduled end, and the join writes nothing: the session's row unchanged, no attendance, no
//     session event;
//   - the join waits on a party's account held `FOR UPDATE` by another transaction, and reads the
//     gender that transaction committed (an administrator's correction, made here in the test world
//     by changing `users.gender` directly, K2): the session answers as a nonexistent one;
//   - the join locks both accounts in one statement, in id order, and its transaction writes
//     nothing; anyone not one of the two parties is answered exactly as a nonexistent session;
//   - R-SESS-5's CI test (SC-412's token part): a teacher suspended, whose approval is revoked, or
//     banned through identity's real `StandingService` gets no token for a session in its join
//     period or in progress, and the stand-in is asked for no room and no token.
//
// The rows are committed, each probe writing parents of its own, since the services open their own
// transactions. Every connection is the application role, as `session-locks.spec.ts` stages a wait.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { addMinutes } from '../../packages/time/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createSessionsServices,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { lockRows } from '../../apps/api/src/platform/db/row-lock.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import {
  type Transactions,
  transactionsOver,
} from '../../apps/api/src/platform/db/transaction.repository.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { createVideoPort } from '../../apps/api/src/platform/ports/video/index.js';
import type { VideoPort } from '../../apps/api/src/platform/ports/video/video.port.js';
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

/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  enrollment_restore_window_days: 7,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });
/** T021: the join keys nothing; `sessions.cancellation.request` is cancellation-requests.spec.ts'. */
const UNKEYED = { run: () => Promise.reject(new Error('nothing is keyed here')) };

beforeAll(async () => {
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

/** The stand-in as the configuration chooses it, with what it was asked to make recorded. */
interface RecordedVideo extends VideoPort {
  readonly calls: { readonly operation: string; readonly args: readonly unknown[] }[];
}

function recordedVideo(): RecordedVideo {
  const port = createVideoPort({
    VIDEO_PROVIDER: 'fake',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const calls: RecordedVideo['calls'] = [];
  return {
    calls,
    createRoom: (...args) => {
      calls.push({ operation: 'createRoom', args });
      return port.createRoom(...args);
    },
    createSessionToken: (...args) => {
      calls.push({ operation: 'createSessionToken', args });
      return port.createSessionToken(...args);
    },
    verifyAndParseParticipantEvent: (...args) => port.verifyAndParseParticipantEvent(...args),
    endRoom: (...args) => port.endRoom(...args),
  };
}

function servicesWith(video: VideoPort): SessionsServices {
  return createSessionsServices({
    transactions: transactionsOver(database),
    settings,
    video,
    enrollmentSide: createEnrollmentSide({ settings }),
    store: sessionsStore,
    idempotency: UNKEYED,
  });
}

/**
 * A male student and an approved male teacher with a confirmed enrollment and one scheduled
 * session of an hour starting `startsInMinutes` from now (negative: already in progress).
 */
async function sessionWorld(startsInMinutes: number) {
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
  const startsAt = new Date(addMinutes(new Date(), startsInMinutes));
  const endsAt = new Date(addMinutes(startsAt, 60));
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
    status: 'scheduled',
  });
  return { sessionId, enrollmentId, studentId, teacherId: offer.teacherId, endsAt };
}

/** The session's row and what references it, as the join must leave them. */
async function writtenFor(sessionId: string) {
  const { rows } = await db.query<{
    updated_at: Date;
    status: string;
    provider_room_id: string | null;
    participant_events: string;
    session_events: string;
  }>(
    `SELECT s.updated_at, s.status::text AS status, s.provider_room_id,
            (SELECT count(*) FROM session_participant_events e WHERE e.session_id = s.id) AS participant_events,
            (SELECT count(*) FROM session_events e WHERE e.session_id = s.id) AS session_events
       FROM sessions s WHERE s.id = $1`,
    [sessionId],
  );
  return rows[0];
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

/** Resolves once a backend locking `users` rows waits on a lock; fails after about two seconds. */
async function joinSeenWaiting(): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT count(*) > 0 AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%FROM users WHERE id = ANY%FOR UPDATE%'`,
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the join never waited on an account lock');
}

describe('sessions.join over the real tables (T011, FR-431, R-GENDER-7)', () => {
  it('answers each party a token bound to them until the scheduled end, and writes nothing', async () => {
    const world = await sessionWorld(5);
    const before = await writtenFor(world.sessionId);
    const video = recordedVideo();
    const services = servicesWith(video);

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

    expect(student.validUntil).toBe(world.endsAt.toISOString());
    expect(teacher.token).not.toBe(student.token);
    expect(
      video.calls
        .filter(({ operation }) => operation === 'createSessionToken')
        .map(({ args }) => args),
    ).toEqual([
      [world.sessionId, world.studentId, { validUntil: world.endsAt }],
      [world.sessionId, world.teacherId, { validUntil: world.endsAt }],
    ]);
    const after = await writtenFor(world.sessionId);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      status: 'scheduled',
      provider_room_id: null,
      participant_events: '0',
      session_events: '0',
    });
  });

  it('answers anyone not one of the two parties exactly as a nonexistent session (R-GENDER-2)', async () => {
    const world = await sessionWorld(5);
    const other = await sessionWorld(5);
    const services = servicesWith(recordedVideo());
    const stranger = await makeUser(db, { gender: 'male' });
    const shapeOf = async (call: Promise<unknown>) => {
      try {
        await call;
      } catch (error) {
        if (error instanceof DomainError) {
          return { code: error.code, message: error.message, details: error.details };
        }
        throw error;
      }
      throw new Error('answered where it must be refused');
    };
    const nonexistent = await shapeOf(
      services.join({ userId: world.studentId }, { sessionId: randomUUID() }, log),
    );
    expect(nonexistent).toEqual({
      code: 'NOT_FOUND',
      message: new DomainError('NOT_FOUND').message,
      details: undefined,
    });
    for (const userId of [stranger, other.studentId, other.teacherId]) {
      for (const procedure of ['get', 'join'] as const) {
        expect(
          await shapeOf(services[procedure]({ userId }, { sessionId: world.sessionId }, log)),
          `${procedure} by a non-party`,
        ).toEqual(nonexistent);
      }
    }
  });
});

describe('the join’s one lock (contracts/kernel.md, the `sessions.join` row)', () => {
  it('locks both accounts in one statement, in id order, and writes nothing on its transaction', async () => {
    const world = await sessionWorld(5);
    const [first, second] = [world.studentId, world.teacherId].sort();
    if (first === undefined || second === undefined) throw new Error('two parties');
    // Every raw statement and every write the join's transaction sends.
    const statements: string[] = [];
    const writes: string[] = [];
    const WRITES = new Set([
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ]);
    const watched: Transactions = {
      run: (work) =>
        database.$transaction((tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                const value: unknown = Reflect.get(target, key);
                if (key === '$queryRaw' || key === '$executeRaw') {
                  return (strings: TemplateStringsArray, ...values: unknown[]) => {
                    statements.push(`${strings.join('?')} ${JSON.stringify(values)}`);
                    return (value as (...args: unknown[]) => unknown).call(
                      target,
                      strings,
                      ...values,
                    );
                  };
                }
                if (typeof key === 'string' && typeof value === 'object' && value !== null) {
                  return new Proxy(value, {
                    get(model, method) {
                      const fn: unknown = Reflect.get(model, method);
                      if (typeof method === 'string' && WRITES.has(method))
                        writes.push(`${key}.${method}`);
                      return typeof fn === 'function' ? fn.bind(model) : fn;
                    },
                  });
                }
                return value;
              },
            }),
          ),
        ),
    };
    const services = createSessionsServices({
      transactions: watched,
      settings,
      video: recordedVideo(),
      enrollmentSide: createEnrollmentSide({ settings }),
      store: sessionsStore,
      idempotency: UNKEYED,
    });

    // The higher id held elsewhere: the join takes the lower one, then waits on it.
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = database.$transaction(
      async (tx) => {
        await lockRows(tx, 'users', [second]);
        held();
        await released;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await holding;
    const joining = services.join({ userId: world.studentId }, { sessionId: world.sessionId }, log);
    try {
      await joinSeenWaiting();
      // While it waits on the higher id, the lower one is already its.
      await db.query('BEGIN');
      const probe = await db
        .query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE NOWAIT', [first])
        .then(
          () => 'taken',
          (error: unknown) => (error as { code?: string }).code,
        );
      await db.query('ROLLBACK');
      expect(probe, 'the lower id is locked by the waiting join').toBe('55P03');
    } finally {
      release();
    }
    await holder;
    await joining;

    const locks = statements.filter((sql) => sql.includes('FOR UPDATE'));
    expect(locks).toEqual([
      `SELECT 1 FROM users WHERE id = ANY(?::uuid[]) ORDER BY id FOR UPDATE ${JSON.stringify([[first, second]])}`,
    ]);
    expect(writes, 'the join writes nothing').toEqual([]);
  });
});

describe('the join reads the accounts under their locks (K2, contracts/kernel.md)', () => {
  it('waits on a party’s account held by a gender correction, then reads the corrected record', async () => {
    const world = await sessionWorld(5);
    const video = recordedVideo();
    const services = servicesWith(video);
    // The session reads as the student's while both are of one gender.
    expect(
      (await services.get({ userId: world.studentId }, { sessionId: world.sessionId }, log))
        .sessionId,
    ).toBe(world.sessionId);

    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    // The server's record after an administrator's correction (Phase 4's FR-GENDER-7), written
    // directly here under the account's lock, as such a correction would hold it.
    const correction = database.$transaction(
      async (tx) => {
        await lockRows(tx, 'users', [world.teacherId]);
        await tx.user.update({ where: { id: world.teacherId }, data: { gender: 'female' } });
        held();
        await released;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await holding;
    const joining = refusalOf(
      services.join({ userId: world.studentId }, { sessionId: world.sessionId }, log),
    );
    try {
      await joinSeenWaiting();
    } finally {
      release();
    }
    await correction;
    expect(await joining).toBe('NOT_FOUND');
    expect(
      await refusalOf(
        services.get({ userId: world.studentId }, { sessionId: world.sessionId }, log),
      ),
    ).toBe('NOT_FOUND');
    expect(video.calls).toEqual([]);
  });
});

describe('R-SESS-5: a restricted teacher gets no token (FR-482, SC-412)', () => {
  const standing = () =>
    new StandingService({
      store: standingStoreOver(database),
      // No subscriber: the sessions stay scheduled, so the token's own gate is what refuses.
      consequences: new AccountConsequences(),
      revokeSubjects,
      hasOpenIdentityRequest: async () => false,
    });

  const restrictions = {
    suspended: (service: StandingService, adminId: string, teacherId: string) =>
      database.$transaction((tx) => service.suspend(tx, adminId, teacherId)),
    'approval revoked': (service: StandingService, adminId: string, teacherId: string) =>
      database.$transaction((tx) =>
        service.revokeApproval(tx, adminId, teacherId, 'R-SESS-5 probe'),
      ),
    banned: (service: StandingService, adminId: string, teacherId: string) =>
      database.$transaction((tx) => service.ban(tx, adminId, teacherId)),
  } as const;

  for (const [restriction, restrict] of Object.entries(restrictions)) {
    it(`refuses a teacher ${restriction} for a session in its join period and one in progress`, async () => {
      const adminId = await makeAdmin(db);
      for (const startsIn of [5, -10]) {
        const world = await sessionWorld(startsIn);
        await restrict(standing(), adminId, world.teacherId);
        const video = recordedVideo();
        const services = servicesWith(video);
        for (const userId of [world.teacherId, world.studentId]) {
          expect(
            await refusalOf(services.join({ userId }, { sessionId: world.sessionId }, log)),
            `${restriction}, starting in ${String(startsIn)} minutes`,
          ).toBe('ACCOUNT_RESTRICTED');
        }
        expect(video.calls).toEqual([]);
      }
    });
  }
});
