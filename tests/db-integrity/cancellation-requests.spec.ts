// T021 of specs/004-sessions — cancellation requests over the real tables (FR-456, FR-457, FR-458,
// FR-485, FR-495; SC-411; research R-310; contracts/kernel.md, the rows «cancellation request, a
// decline» and «cancellation accepted»; ERD §15 rule 45): the sessions services as `main.ts` binds
// them, with the kernel's idempotency over its own table and booking's `EnrollmentSide`.
//
//   - a request and its answer: accepted, the session `cancelled_by_agreement`, the request
//     `accepted` with `responded_at`, no penalty; declined, the session standing and a new request
//     admitted; one `session_events` row per request and answer; a retry with the same key answers
//     the first request and writes nothing;
//   - THE PROBE OF RULE 45: two requests at once, by the two parties, leave one pending: the second
//     waits on the locks the first holds, reads the first's request under them and is refused
//     `CANCELLATION_PENDING`; the race staged by a transaction holding the session's row until
//     both are seen waiting;
//   - THE PROBE OF SC-411: an answer racing the start, accept and decline, waits on the session's
//     row held past the start, reads the database's clock under the locks and is refused
//     `CANCELLATION_EXPIRED`: the session, the request and the events unchanged;
//   - an answer, accept and decline, after an administrator's cancellation (the session written
//     `cancelled_by_admin` as T023's `sessions.cancel` writes it) and after a teacher's end
//     (`teacher_ended`, through identity's real `StandingService` and booking's subscriber) is
//     refused `SESSION_NOT_SCHEDULED` with nothing written, and `sessions.get` reads the request as
//     over (`expired`);
//   - the lists' read (`pendingCancellationsAmong`): a request pending on a scheduled session not
//     yet started, and nothing else.
//
// The race against T023's `sessions.cancel`, against T022's sweep and of a `participant_left`
// against a decline are the integration's (the owner's decision of 2026-11-10 on B37's lanes).
// The rows are committed, each probe with a world of its own; every connection is the application
// role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import {
  createEnrollmentSide,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createSessionsServices,
  pendingCancellationsAmong,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
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
let holder: Db;
let watcher: Db;
let database: Database;
let services: SessionsServices;

/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });
const SILENT = { info: () => undefined };

beforeAll(async () => {
  [db, holder, watcher] = await Promise.all([
    connectAsApplication(),
    connectAsApplication(),
    connectAsApplication(),
  ]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
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
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), holder?.end(), watcher?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

/**
 * A male student and an approved male teacher with a confirmed enrollment and one scheduled
 * session of an hour starting `startsInSeconds` from now.
 */
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
  return { sessionId, enrollmentId, studentId, teacherId: offer.teacherId, startsAt };
}

type World = Awaited<ReturnType<typeof world>>;

const key = () => `probe-${randomUUID()}`;

const ask = (w: World, userId: string, idempotencyKey = key()) =>
  services.cancellation.request(
    { userId },
    { sessionId: w.sessionId, reason: 'سفر طارئ', idempotencyKey },
    log,
  );

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('answered where it must be refused');
}

/** What the session's rows say: its status, its requests and its events, oldest first. */
async function writtenFor(sessionId: string) {
  const session = await db.query<{ status: string; updated_at: Date }>(
    'SELECT status::text, updated_at FROM sessions WHERE id = $1',
    [sessionId],
  );
  const requests = await db.query<{
    requested_by_user_id: string;
    status: string;
    responded: boolean;
    updated_at: Date;
  }>(
    `SELECT requested_by_user_id::text, status::text, responded_at IS NOT NULL AS responded, updated_at
       FROM cancellation_requests WHERE session_id = $1 ORDER BY id`,
    [sessionId],
  );
  const events = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1 ORDER BY id',
    [sessionId],
  );
  return {
    session: session.rows[0],
    requests: requests.rows,
    events: events.rows.map(({ kind }) => kind),
  };
}

/** Holds the session's row `FOR UPDATE` on its own connection until `release`. */
async function holdSession(sessionId: string): Promise<() => Promise<void>> {
  await holder.query('BEGIN');
  await holder.query('SELECT 1 FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
  return async () => {
    await holder.query('COMMIT');
  };
}

/** Resolves once `count` backends wait on a lock of a `sessions` row; fails after about four seconds. */
async function seenWaitingOnSession(count: number): Promise<void> {
  for (let look = 0; look < 200; look += 1) {
    const { rows } = await watcher.query<{ waiting: string }>(
      `SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND (query LIKE '%FROM sessions WHERE id = ANY%FOR UPDATE%'
               OR query LIKE '%FROM users WHERE id = ANY%FOR UPDATE%')
          AND datname = current_database()`,
    );
    if (Number(rows[0]?.waiting) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`fewer than ${String(count)} backends waited on the session's locks`);
}

describe('a request and its answer (FR-456, FR-457, FR-458, FR-495)', () => {
  it('accepted: the session cancelled by agreement, the request accepted, one event each', async () => {
    const w = await world();
    const { requestId, status, expiresAt } = await ask(w, w.studentId);
    expect({ status, expiresAt }).toEqual({
      status: 'pending',
      expiresAt: w.startsAt.toISOString(),
    });

    expect(
      await services.cancellation.answer({ userId: w.teacherId }, { requestId, accept: true }, log),
    ).toEqual({ requestId, status: 'accepted', sessionStatus: 'cancelled_by_agreement' });
    const written = await writtenFor(w.sessionId);
    expect(written.session?.status).toBe('cancelled_by_agreement');
    expect(written.requests).toEqual([
      expect.objectContaining({
        requested_by_user_id: w.studentId,
        status: 'accepted',
        responded: true,
      }),
    ]);
    expect(written.events).toEqual(['cancellation_requested', 'cancellation_accepted']);
    const seen = await services.get({ userId: w.studentId }, { sessionId: w.sessionId }, log);
    expect(seen.cancellation).toEqual({
      requestId,
      requestedByMe: true,
      reason: 'سفر طارئ',
      status: 'accepted',
      expiresAt: w.startsAt.toISOString(),
    });
  });

  it('declined: the session standing, and a new request admitted after it', async () => {
    const w = await world();
    const first = await ask(w, w.teacherId);
    expect(
      await services.cancellation.answer(
        { userId: w.studentId },
        { requestId: first.requestId, accept: false },
        log,
      ),
    ).toEqual({ requestId: first.requestId, status: 'declined', sessionStatus: 'scheduled' });
    const second = await ask(w, w.studentId);
    expect(second.requestId).not.toBe(first.requestId);
    const written = await writtenFor(w.sessionId);
    expect(written.session?.status).toBe('scheduled');
    expect(written.requests.map(({ status }) => status)).toEqual(['declined', 'pending']);
    expect(written.events).toEqual([
      'cancellation_requested',
      'cancellation_declined',
      'cancellation_requested',
    ]);
  });

  it('a retry with the same key answers the first request and writes nothing more', async () => {
    const w = await world();
    const idempotencyKey = key();
    const first = await ask(w, w.studentId, idempotencyKey);
    expect(await ask(w, w.studentId, idempotencyKey)).toEqual(first);
    const written = await writtenFor(w.sessionId);
    expect(written.requests).toHaveLength(1);
    expect(written.events).toEqual(['cancellation_requested']);
  });

  it('the requester answering their own request is NOT_FOUND, nothing written', async () => {
    const w = await world();
    const { requestId } = await ask(w, w.studentId);
    const before = await writtenFor(w.sessionId);
    expect(
      (
        await refusalOf(
          services.cancellation.answer({ userId: w.studentId }, { requestId, accept: true }, log),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(await writtenFor(w.sessionId)).toEqual(before);
  });
});

describe('the probe of rule 45: two requests at once leave one pending (FR-456)', () => {
  it('the second waits on the first’s locks, reads its request and is refused CANCELLATION_PENDING', async () => {
    const w = await world();
    const release = await holdSession(w.sessionId);
    let settled: PromiseSettledResult<unknown>[];
    try {
      const both = Promise.allSettled([ask(w, w.studentId), ask(w, w.teacherId)]);
      // The first holds the accounts and waits on the session; the second waits on the accounts.
      await seenWaitingOnSession(2);
      await release();
      settled = await both;
    } catch (error) {
      await holder.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const answered = settled.filter((result) => result.status === 'fulfilled');
    const refused = settled.flatMap((result) =>
      result.status === 'rejected' && result.reason instanceof DomainError ? [result.reason] : [],
    );
    expect(answered).toHaveLength(1);
    expect(refused.map(({ code }) => code)).toEqual(['CANCELLATION_PENDING']);
    const written = await writtenFor(w.sessionId);
    expect(written.requests.map(({ status }) => status)).toEqual(['pending']);
    expect(refused[0]?.details).toEqual([
      {
        path: 'requestId',
        code: (answered[0] as PromiseFulfilledResult<{ requestId: string }>).value.requestId,
      },
    ]);
    expect(written.events).toEqual(['cancellation_requested']);
  });
});

describe('the probe of SC-411: an answer racing the start changes nothing', () => {
  it.each([true, false])(
    'accept %s: the answer waits on the session held past the start and is refused CANCELLATION_EXPIRED',
    async (accept) => {
      const w = await world(2);
      const { requestId } = await ask(w, w.studentId);
      const before = await writtenFor(w.sessionId);
      const release = await holdSession(w.sessionId);
      let refusal: DomainError;
      try {
        const answering = refusalOf(
          services.cancellation.answer({ userId: w.teacherId }, { requestId, accept }, log),
        );
        await seenWaitingOnSession(1);
        // Hold the session until its start has passed by the database's clock.
        for (;;) {
          const { rows } = await watcher.query<{ started: boolean }>(
            'SELECT clock_timestamp() >= $1::timestamptz AS started',
            [w.startsAt.toISOString()],
          );
          if (rows[0]?.started === true) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await release();
        refusal = await answering;
      } catch (error) {
        await holder.query('ROLLBACK').catch(() => undefined);
        throw error;
      }

      expect(refusal.code).toBe('CANCELLATION_EXPIRED');
      expect(await writtenFor(w.sessionId)).toEqual(before);
      const seen = await services.get({ userId: w.teacherId }, { sessionId: w.sessionId }, log);
      expect(seen.cancellation?.status).toBe('expired');
    },
    20_000,
  );
});

describe('an answer after another path cancelled the session (PR #126 follow-up 3)', () => {
  it.each([true, false])(
    'accept %s after an administrator’s cancellation: SESSION_NOT_SCHEDULED, nothing written, the request read as over',
    async (accept) => {
      const w = await world();
      const { requestId } = await ask(w, w.studentId);
      // As T023's `sessions.cancel` writes it; its race with an answer is the integration's probe.
      await db.query(`UPDATE sessions SET status = 'cancelled_by_admin' WHERE id = $1`, [
        w.sessionId,
      ]);
      const before = await writtenFor(w.sessionId);
      const refusal = await refusalOf(
        services.cancellation.answer({ userId: w.teacherId }, { requestId, accept }, log),
      );
      expect(refusal.code).toBe('SESSION_NOT_SCHEDULED');
      expect(await writtenFor(w.sessionId)).toEqual(before);
      expect(before.requests.map(({ status }) => status)).toEqual(['pending']);
      for (const userId of [w.studentId, w.teacherId]) {
        const seen = await services.get({ userId }, { sessionId: w.sessionId }, log);
        expect(seen.cancellation?.status).toBe('expired');
      }
    },
  );

  it.each([true, false])(
    'accept %s after a teacher’s end (teacher_ended): SESSION_NOT_SCHEDULED, nothing written, the request read as over',
    async (accept) => {
      const w = await world();
      const { requestId } = await ask(w, w.teacherId);
      const adminId = await makeAdmin(db);
      const consequences = new AccountConsequences();
      consequences.subscribe(terminationSubscriber({ orders: orderStandingsOf, log: SILENT }));
      const standing = new StandingService({
        store: standingStoreOver(database),
        consequences,
        revokeSubjects,
        hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
      });
      await database.$transaction((tx) => standing.suspend(tx, adminId, w.teacherId));
      const before = await writtenFor(w.sessionId);
      expect(before.session?.status).toBe('cancelled_by_admin');

      const refusal = await refusalOf(
        services.cancellation.answer({ userId: w.studentId }, { requestId, accept }, log),
      );
      expect(refusal.code).toBe('SESSION_NOT_SCHEDULED');
      expect(await writtenFor(w.sessionId)).toEqual(before);
      expect(before.requests.map(({ status }) => status)).toEqual(['pending']);
      const seen = await services.get({ userId: w.studentId }, { sessionId: w.sessionId }, log);
      expect(seen.cancellation?.status).toBe('expired');
    },
  );
});

describe('the lists’ read: pendingCancellationsAmong', () => {
  it('names a session whose request is pending, scheduled and not started, and nothing else', async () => {
    const [pending, declined, cancelled, none] = await Promise.all([
      world(),
      world(),
      world(),
      world(),
    ]);
    await ask(pending, pending.studentId);
    const asked = await ask(declined, declined.studentId);
    await services.cancellation.answer(
      { userId: declined.teacherId },
      { requestId: asked.requestId, accept: false },
      log,
    );
    await ask(cancelled, cancelled.teacherId);
    await db.query(`UPDATE sessions SET status = 'cancelled_by_admin' WHERE id = $1`, [
      cancelled.sessionId,
    ]);
    const ids = [pending, declined, cancelled, none].map(({ sessionId }) => sessionId);

    const now = new Date();
    expect([
      ...(await database.$transaction((tx) => pendingCancellationsAmong(tx, ids, now))),
    ]).toEqual([pending.sessionId]);
    // From the start, the pending one is over too (FR-458).
    expect([
      ...(await database.$transaction((tx) =>
        pendingCancellationsAmong(tx, ids, pending.startsAt),
      )),
    ]).toEqual([]);
  });
});
