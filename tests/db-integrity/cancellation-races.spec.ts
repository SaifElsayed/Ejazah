// B37's three probes across lanes (the owner's decision of 2026-11-10 on B37's lanes): a
// cancellation request's paths (T021) raced against the paths of the other lanes that lock the same
// rows, over the real tables (contracts/kernel.md's rows; `003:T005`'s rules).
//
//   - T021's line: a request, and then a decline, raced against an administrator's
//     `sessions.cancel` (T023) on the same session: both end with no deadlock, one wins and the other
//     changes nothing or is refused. The request and the decline take the two accounts, the
//     enrollment and the session; the cancellation the enrollment and the session.
//   - T022's line: the sweep's expiry raced against «cancellation accepted» on the same request:
//     both end with no deadlock, one wins and the other changes nothing. Both take the enrollment,
//     the session and the request, in that order.
//   - The note under T021 (K3, moved from T012): a participant's `participant_left` through
//     `POST /webhooks/video` raced against a request's decline during the early-join lead: no
//     deadlock and both transactions committed, in either order. The webhook takes the participant's
//     account `FOR KEY SHARE`; the decline takes both accounts `FOR UPDATE`.
//
// HOW EACH RACE IS STAGED, as `video-webhook-race.spec.ts` stages its own, the order decided by the
// database and not by timing: the first path's transaction stops on a gate holding its locks; the
// second is seen waiting on a lock in `pg_stat_activity`; the gate opens. The first path stops in one
// of two places (PR #131's review, round 1, Major 1, the follow-up under T021):
//   - between its locks, after its first lock on a row both paths take and before its next. Only
//     here does the first path still have a lock to wait for, so only here can a lock taken out of
//     kernel.md's order turn into a cycle, a deadlock the database breaks by failing one path;
//   - before its commit, its work done, so the one that waited decides on what the first wrote.
// Each race is run in both orders. The paths' transactions and stores are the ones `main.ts` and
// `worker.ts` give them, wrapped only to stop at those points; the sweep's global read is narrowed to
// this file's requests, so it expires no other spec's row.
//
// The rows are committed, each probe with a world of its own; every connection is the application
// role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  type CancellationExpiryStore,
  cancellationExpiryStore,
  type CancellationStore,
  cancellationStore,
  createCancellationExpiry,
  createSessionCancel,
  createSessionsServices,
  createVideoWebhookRoute,
  type SessionCancelStore,
  sessionCancelStore,
  type SessionsServices,
  sessionsStore,
  VIDEO_WEBHOOK_PATH,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import {
  type IdempotentRequest,
  IdempotencyService,
  type JsonValue,
} from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import {
  createVideoPort,
  type VideoConfig,
} from '../../apps/api/src/platform/ports/video/index.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { type VideoStandIn, videoStandIn } from '../support/video-stand-in';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

const CONFIG: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
  dispute_window_hours: 72,
  // T028 (B38): an acceptance offers the make-up it owes, reading the choice and answer windows.
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal', destination: { write: () => undefined } });
const OPTIONS = { maxWait: 5_000, timeout: 20_000 };

/** The rows a path locks, named as kernel.md's order names them. */
type Lock = 'accounts' | 'enrollments' | 'sessions' | 'requests';

/** Where a path's transaction stops, when a probe asks it to. */
interface Stops {
  /** Its backend, once its transaction has begun (the sweep's: as it takes its first lock). */
  began?: (pid: number) => void;
  /** Just after it locks `lock`'s rows, holding them. */
  locked?: (lock: Lock) => Promise<void>;
  /** After its work, holding its locks, before it commits. */
  beforeCommit?: () => Promise<void>;
}

type Path = 'participant' | 'admin' | 'sweep' | 'webhook';
let stops: Record<Path, Stops> = { participant: {}, admin: {}, sweep: {}, webhook: {} };

/** `lock` as `path` takes it: the module's own lock, then the stop the probe set after it, if any. */
const stopping =
  (
    path: Path,
    lock: Lock,
    take: (tx: Transaction, ids: readonly string[]) => Promise<void>,
  ): ((tx: Transaction, ids: readonly string[]) => Promise<void>) =>
  async (tx, ids) => {
    // The sweep's transactions are its own, so its backend is told as it takes a lock, whichever
    // it takes first.
    if (path === 'sweep') stops.sweep.began?.(await pidOf(tx));
    await take(tx, ids);
    await stops[path].locked?.(lock);
  };

/** The participant's store, `cancellationStore` stopping after each lock. */
const participantStore: CancellationStore = {
  ...cancellationStore,
  lockAccounts: stopping('participant', 'accounts', cancellationStore.lockAccounts),
  lockSessions: stopping('participant', 'sessions', cancellationStore.lockSessions),
  lockRequests: stopping('participant', 'requests', cancellationStore.lockRequests),
};

let db: Db;
let database: Database;
let server: Server;
let stand: VideoStandIn;
let services: SessionsServices;
/**
 * The running probe's requests: the only ones the sweep may expire (the header). Emptied by each
 * probe's `world`, so a request an earlier probe left pending is never this probe's.
 */
const own = new Set<string>();

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
};

/** The process's transactions, stopping where `stops[path]` asks. */
function stoppable(path: Path): Transactions {
  return {
    run: (work) =>
      database.$transaction(async (tx) => {
        stops[path].began?.(await pidOf(tx));
        const value = await work(tx);
        await stops[path].beforeCommit?.();
        return value;
      }, OPTIONS),
  };
}

const adminSide = createEnrollmentSide({ settings });
const adminCancel = createSessionCancel({
  enrollments: {
    lockEnrollments: stopping('admin', 'enrollments', adminSide.lockEnrollments),
  },
  log: { info: () => undefined } as unknown as Parameters<typeof createSessionCancel>[0]['log'],
  store: {
    ...sessionCancelStore,
    lockSessions: stopping('admin', 'sessions', sessionCancelStore.lockSessions),
  } satisfies SessionCancelStore,
});

/** T023's `sessions.cancel` on the transaction the admin surface opens for the call. */
const cancelAsAdmin = (adminId: string, sessionId: string) =>
  stoppable('admin').run((tx) =>
    adminCancel.cancel(tx, adminId, { sessionId, reason: 'سبب إداري' }),
  );

/** How many due requests the sweep's narrowed read asks for at a time. */
const DUE_PAGE = 500;

/**
 * T022's sweep over the probe's requests; its stop after the expiry's writes, inside its
 * transaction. Its read goes through every due request to the end (PR #131's review, round 1,
 * Minor 2): other specs leave requests pending on started sessions, and the probe's, the newest
 * ids, come after them.
 */
function sweep() {
  const side = createEnrollmentSide({ settings });
  const store: CancellationExpiryStore = {
    ...cancellationExpiryStore,
    dueForExpiry: async (tx, at, after, limit) => {
      const mine = [];
      let cursor = after;
      for (;;) {
        const page = await cancellationExpiryStore.dueForExpiry(tx, at, cursor, DUE_PAGE);
        mine.push(...page.filter(({ id }) => own.has(id)));
        if (page.length < DUE_PAGE) break;
        cursor = page.at(-1)?.id;
      }
      return mine.slice(0, limit);
    },
    lockSessions: stopping('sweep', 'sessions', cancellationExpiryStore.lockSessions),
    lockRequests: stopping('sweep', 'requests', cancellationExpiryStore.lockRequests),
    recordEvents: async (tx, events) => {
      await cancellationExpiryStore.recordEvents(tx, events);
      await stops.sweep.beforeCommit?.();
    },
  };
  return createCancellationExpiry({
    transactions: {
      run: (work) => database.$transaction(work, OPTIONS),
    },
    enrollments: {
      lockEnrollments: stopping('sweep', 'enrollments', side.lockEnrollments),
    },
    log: { info: () => undefined, error: () => undefined } as unknown as Parameters<
      typeof createCancellationExpiry
    >[0]['log'],
    pageSize: 50,
    store,
  }).expireStarted();
}

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const idempotency = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
  });
  const participantSide = createEnrollmentSide({ settings });
  services = createSessionsServices({
    transactions: stoppable('participant'),
    settings,
    video: createVideoPort(CONFIG),
    enrollmentSide: {
      ...participantSide,
      lockEnrollments: stopping('participant', 'enrollments', participantSide.lockEnrollments),
    },
    store: sessionsStore,
    cancellationStore: participantStore,
    // The kernel's idempotency, its effect stopping where the participant's path is asked to.
    idempotency: {
      run: <T extends JsonValue>(
        request: IdempotentRequest,
        effect: (tx: Transaction) => Promise<T>,
      ): Promise<T> =>
        idempotency.run(request, async (tx) => {
          stops.participant.began?.(await pidOf(tx));
          const value = await effect(tx);
          await stops.participant.beforeCommit?.();
          return value;
        }),
    },
  });
  const route = createVideoWebhookRoute({
    transactions: stoppable('webhook'),
    video: createVideoPort(CONFIG),
    log,
    maxBodyBytes: 1_048_576,
    report: () => undefined,
  });
  server = createServer((request, response) => {
    if ((request.url ?? '/') !== VIDEO_WEBHOOK_PATH) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stand = videoStandIn({
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    config: CONFIG,
  });
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

/**
 * A male student and an approved male teacher with a confirmed enrollment and one scheduled
 * session of an hour starting `startsInSeconds` from now, and an administrator.
 */
async function world(startsInSeconds = 3 * 60 * 60) {
  own.clear();
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
  const adminId = await makeAdmin(db);
  return { sessionId, studentId, teacherId: offer.teacherId, startsAt, adminId };
}

type World = Awaited<ReturnType<typeof world>>;

/** A request by `userId`, committed, and kept as this file's. */
async function requested(w: World, userId: string): Promise<string> {
  const { requestId } = await ask(w, userId);
  own.add(requestId);
  return requestId;
}

const ask = (w: World, userId: string) =>
  services.cancellation.request(
    { userId },
    { sessionId: w.sessionId, reason: 'سفر طارئ', idempotencyKey: `probe-${randomUUID()}` },
    log,
  );

const answer = (userId: string, requestId: string, accept: boolean) =>
  services.cancellation.answer({ userId }, { requestId, accept }, log);

/** Resolves once backend `pid` waits on a lock; fails after about four seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 200; look += 1) {
    const { rows } = await db.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

/** Resolves once the session's start has passed by the database's clock. */
async function startPassed(w: World): Promise<void> {
  for (;;) {
    const { rows } = await db.query<{ started: boolean }>(
      'SELECT clock_timestamp() >= $1::timestamptz AS started',
      [w.startsAt.toISOString()],
    );
    if (rows[0]?.started === true) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function gate(): { readonly open: () => void; readonly opened: Promise<void> } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function signal<T>(): { readonly give: (value: T) => void; readonly given: Promise<T> } {
  let give = (_value: T): void => undefined;
  const given = new Promise<T>((resolve) => {
    give = resolve;
  });
  return { give, given };
}

/** Holds `path`'s transaction before its commit; `held` resolves once it is held. */
function holdBeforeCommit(path: Path) {
  const held = signal<void>();
  const release = gate();
  stops[path] = {
    beforeCommit: async () => {
      held.give();
      await release.opened;
    },
  };
  return { held: held.given, release: release.open };
}

/**
 * Holds `path`'s transaction just after its first lock on one of `shared`, the rows the other path
 * also takes, before its next lock; `held` resolves once it is held.
 */
function holdBetweenLocks(path: Path, shared: readonly Lock[]) {
  const held = signal<void>();
  const release = gate();
  let stopped = false;
  stops[path] = {
    locked: async (lock) => {
      if (stopped || !shared.includes(lock)) return;
      stopped = true;
      held.give();
      await release.opened;
    },
  };
  return { held: held.given, release: release.open };
}

/** Where a race holds its first path: between its locks on `shared`, or before its commit. */
interface Staging {
  readonly name: string;
  readonly hold: (path: Path) => { readonly held: Promise<void>; readonly release: () => void };
}

const BEFORE_COMMIT: Staging = { name: 'before its commit', hold: holdBeforeCommit };

/** Both stagings of a race whose two paths both lock `shared` (the header). */
const stagingsOver = (shared: readonly Lock[]): readonly Staging[] => [
  { name: 'between its locks', hold: (path) => holdBetweenLocks(path, shared) },
  BEFORE_COMMIT,
];

/** The backend `path`'s next transaction runs on, once it has begun. */
function beganOf(path: Path): Promise<number> {
  const began = signal<number>();
  stops[path] = { began: began.give };
  return began.given;
}

/** The refusal's code, or `answered` when the call was not refused. */
function codeOf(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'answered';
  if (result.reason instanceof DomainError) return result.reason.code;
  throw result.reason;
}

/** What the paths left: the session's status, its requests, its events and participant events. */
async function outcomeOf(sessionId: string) {
  const session = await db.query<{ status: string }>(
    'SELECT status::text FROM sessions WHERE id = $1::uuid',
    [sessionId],
  );
  const requests = await db.query<{ status: string }>(
    'SELECT status::text FROM cancellation_requests WHERE session_id = $1::uuid ORDER BY id',
    [sessionId],
  );
  const events = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
    [sessionId],
  );
  const participants = await db.query<{ event_type: string }>(
    `SELECT event_type::text FROM session_participant_events WHERE session_id = $1::uuid
      ORDER BY id`,
    [sessionId],
  );
  return {
    session: session.rows[0]?.status,
    requests: requests.rows.map(({ status }) => status),
    events: events.rows.map(({ kind }) => kind),
    participants: participants.rows.map(({ event_type }) => event_type),
  };
}

/** Runs `first` to its stop, then `second` until it is seen waiting, then lets both end. */
async function race(
  staging: Staging,
  first: { readonly path: Path; readonly run: () => Promise<unknown> },
  second: { readonly path: Path; readonly run: () => Promise<unknown> },
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  const hold = staging.hold(first.path);
  const firstRun = first.run();
  let secondRun: Promise<unknown> | undefined;
  try {
    await Promise.race([hold.held, firstRun]);
    const began = beganOf(second.path);
    secondRun = second.run();
    await seenWaiting(
      await Promise.race([
        began,
        secondRun.then(
          () => -1,
          () => -1,
        ),
      ]),
    );
  } finally {
    hold.release();
  }
  const settled = await Promise.allSettled([firstRun, secondRun]);
  stops = { participant: {}, admin: {}, sweep: {}, webhook: {} };
  return settled as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>];
}

describe.each(stagingsOver(['enrollments', 'sessions']))(
  "a request and a decline raced against an administrator's sessions.cancel (T021 × T023), the first held $name",
  (staging) => {
    it('the request first: the cancellation waits, both commit, the request then reads as over', async () => {
      const w = await world();
      const [asked, cancelled] = await race(
        staging,
        { path: 'participant', run: () => ask(w, w.studentId) },
        { path: 'admin', run: () => cancelAsAdmin(w.adminId, w.sessionId) },
      );
      expect([codeOf(asked), codeOf(cancelled)]).toEqual(['answered', 'answered']);
      expect(await outcomeOf(w.sessionId)).toEqual({
        session: 'cancelled_by_admin',
        requests: ['pending'],
        events: ['cancellation_requested', 'cancelled_by_admin'],
        participants: [],
      });
      const seen = await services.get({ userId: w.teacherId }, { sessionId: w.sessionId }, log);
      expect(seen.cancellation?.status).toBe('expired');
    });

    it('the cancellation first: the request waits and is refused SESSION_NOT_SCHEDULED, writing nothing', async () => {
      const w = await world();
      const [cancelled, asked] = await race(
        staging,
        { path: 'admin', run: () => cancelAsAdmin(w.adminId, w.sessionId) },
        { path: 'participant', run: () => ask(w, w.studentId) },
      );
      expect([codeOf(cancelled), codeOf(asked)]).toEqual(['answered', 'SESSION_NOT_SCHEDULED']);
      expect(await outcomeOf(w.sessionId)).toEqual({
        session: 'cancelled_by_admin',
        requests: [],
        events: ['cancelled_by_admin'],
        participants: [],
      });
    });

    it('the decline first: the cancellation waits, both commit', async () => {
      const w = await world();
      const requestId = await requested(w, w.teacherId);
      const [declined, cancelled] = await race(
        staging,
        { path: 'participant', run: () => answer(w.studentId, requestId, false) },
        { path: 'admin', run: () => cancelAsAdmin(w.adminId, w.sessionId) },
      );
      expect([codeOf(declined), codeOf(cancelled)]).toEqual(['answered', 'answered']);
      expect(await outcomeOf(w.sessionId)).toEqual({
        session: 'cancelled_by_admin',
        requests: ['declined'],
        events: ['cancellation_requested', 'cancellation_declined', 'cancelled_by_admin'],
        participants: [],
      });
    });

    it('the cancellation first: the decline waits and is refused SESSION_NOT_SCHEDULED, writing nothing', async () => {
      const w = await world();
      const requestId = await requested(w, w.teacherId);
      const [cancelled, declined] = await race(
        staging,
        { path: 'admin', run: () => cancelAsAdmin(w.adminId, w.sessionId) },
        { path: 'participant', run: () => answer(w.studentId, requestId, false) },
      );
      expect([codeOf(cancelled), codeOf(declined)]).toEqual(['answered', 'SESSION_NOT_SCHEDULED']);
      expect(await outcomeOf(w.sessionId)).toEqual({
        session: 'cancelled_by_admin',
        requests: ['pending'],
        events: ['cancellation_requested', 'cancelled_by_admin'],
        participants: [],
      });
    });
  },
);

describe.each(stagingsOver(['enrollments', 'sessions', 'requests']))(
  'the sweep’s expiry raced against «cancellation accepted» (T022 × T021), the first held $name',
  (staging) => {
    // Held before its commit, the acceptance has decided before the start, so it stands and the
    // sweep changes nothing. Held between its locks, it decides after the start, read under the
    // locks, so it is refused and the sweep, waiting on it, expires the request (SC-411).
    const decided =
      staging === BEFORE_COMMIT
        ? {
            when: 'before the start: the acceptance stands and the sweep changes nothing',
            accepted: 'answered',
            expired: (_requestId: string): string[] => [],
            outcome: {
              session: 'cancelled_by_agreement',
              requests: ['accepted'],
              // T028 (B38): the acceptance offers the make-up it owes in its transaction.
              events: ['cancellation_requested', 'cancellation_accepted', 'remedy_offered'],
              participants: [],
            },
          }
        : {
            when: 'after the start: the acceptance is refused CANCELLATION_EXPIRED and the sweep expires the request',
            accepted: 'CANCELLATION_EXPIRED',
            expired: (requestId: string): string[] => [requestId],
            outcome: {
              session: 'scheduled',
              requests: ['expired'],
              events: ['cancellation_requested', 'cancellation_expired'],
              participants: [],
            },
          };

    it(`the acceptance first, the start passing while it is held: the sweep waits, the acceptance decided ${decided.when}`, async () => {
      const w = await world(4);
      const requestId = await requested(w, w.studentId);
      const hold = staging.hold('participant');
      const accepting = answer(w.teacherId, requestId, true);
      let sweeping: ReturnType<typeof sweep> | undefined;
      try {
        await Promise.race([hold.held, accepting]);
        await startPassed(w);
        const began = beganOf('sweep');
        sweeping = sweep();
        await seenWaiting(await began);
      } finally {
        hold.release();
      }
      const [accepted, swept] = await Promise.allSettled([accepting, sweeping]);
      stops = { participant: {}, admin: {}, sweep: {}, webhook: {} };

      expect(codeOf(accepted)).toBe(decided.accepted);
      expect(swept).toEqual({
        status: 'fulfilled',
        value: { expired: decided.expired(requestId), failed: [] },
      });
      expect(await outcomeOf(w.sessionId)).toEqual(decided.outcome);
    }, 20_000);

    it('the sweep first, after the start: the acceptance waits and is refused CANCELLATION_EXPIRED', async () => {
      const w = await world(3);
      const requestId = await requested(w, w.studentId);
      await startPassed(w);
      const [swept, accepted] = await race(
        staging,
        { path: 'sweep', run: () => sweep() },
        { path: 'participant', run: () => answer(w.teacherId, requestId, true) },
      );
      expect(swept).toEqual({ status: 'fulfilled', value: { expired: [requestId], failed: [] } });
      expect(codeOf(accepted)).toBe('CANCELLATION_EXPIRED');
      expect(await outcomeOf(w.sessionId)).toEqual({
        session: 'scheduled',
        requests: ['expired'],
        events: ['cancellation_requested', 'cancellation_expired'],
        participants: [],
      });
    }, 20_000);
  },
);

// The webhook locks the participant's account `FOR KEY SHARE` before its insert, which only
// key-shares the session (`video-webhook.controller.ts`), so the decline is held between its locks
// just after the accounts, before it takes the session `FOR UPDATE`.
describe('a participant’s leave raced against a decline during the early-join lead (the note under T021, K3)', () => {
  it.each(stagingsOver(['accounts']))(
    'the decline first, held $name: the webhook waits on the account, and both commit',
    async (staging) => {
      const w = await world(10 * 60);
      const requestId = await requested(w, w.teacherId);
      const left = stand.left(w.sessionId, w.studentId, { at: new Date() });
      const [declined, delivered] = await race(
        staging,
        { path: 'participant', run: () => answer(w.studentId, requestId, false) },
        { path: 'webhook', run: () => stand.deliver(left) },
      );
      expect(codeOf(declined)).toBe('answered');
      expect(delivered).toEqual({ status: 'fulfilled', value: 200 });
      expect(await outcomeOf(w.sessionId)).toEqual({
        session: 'scheduled',
        requests: ['declined'],
        events: ['cancellation_requested', 'cancellation_declined'],
        participants: ['left'],
      });
    },
  );

  it('the webhook first, held before its commit: the decline waits on the account, and both commit', async () => {
    const w = await world(10 * 60);
    const requestId = await requested(w, w.teacherId);
    const left = stand.left(w.sessionId, w.studentId, { at: new Date() });
    const [delivered, declined] = await race(
      BEFORE_COMMIT,
      { path: 'webhook', run: () => stand.deliver(left) },
      { path: 'participant', run: () => answer(w.studentId, requestId, false) },
    );
    expect(delivered).toEqual({ status: 'fulfilled', value: 200 });
    expect(codeOf(declined)).toBe('answered');
    expect(await outcomeOf(w.sessionId)).toEqual({
      session: 'scheduled',
      requests: ['declined'],
      events: ['cancellation_requested', 'cancellation_declined'],
      participants: ['left'],
    });
  });
});
