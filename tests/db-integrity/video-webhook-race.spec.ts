// T012 — the video webhook's participant event raced against a teacher's suspension (contracts/
// kernel.md's two `POST /webhooks/video` rows; the owner's decision of 2026-11-06 on the sixth
// analysis, H1; research R-321; the note under T012 of 2026-11-08, K3: the race against a
// cancellation request's decline is T021's).
//
// THE DEADLOCK IT GUARDS. A participant's event inserts a `session_participant_events` row whose two
// foreign keys key-share the session first and the account second
// (`20261101050220_append_only_foreign_keys_restrict`). A teacher's suspension holds the teacher's
// account `FOR UPDATE` (`StandingService.suspend`) and then, through booking's termination
// subscriber, locks the teacher's sessions `FOR UPDATE` (T006, `cancelRemainingSessions`). Were the
// webhook to insert straight away, it would hold the session's key-share while waiting on the
// account, and the suspension would wait on the session: a deadlock. The webhook takes the account
// `FOR KEY SHARE` first (`keyShareRows`), so it waits on the account before it touches the session.
//
// HOW THE RACE IS STAGED, as `compensation-case.spec.ts` stages its own, the order decided by the
// database and not by timing: the session is in its join period (started ten minutes before the
// subscriber's now, still scheduled), and the event is the teacher's `participant_left` through
// `POST /webhooks/video` from the harness, the only way a spec produces one.
//   - The suspension first: it holds the account (a consequence subscribed before booking's
//     subscriber waits on a gate), the webhook is seen waiting on a lock in `pg_stat_activity`, the
//     gate opens, and both commit: the account suspended, the session `cancelled_by_admin`, the
//     event recorded.
//   - The webhook first: its transaction has inserted and waits on a gate before it commits, the
//     suspension is seen waiting, the gate opens, and both commit, with the same three results.
// The webhook's transactions are the process's, wrapped only to stop at those two points.
//
// The rows are committed, each probe with a world of its own; every connection is the application
// role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { terminationSubscriber } from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createVideoWebhookRoute,
  VIDEO_WEBHOOK_PATH,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import {
  createVideoPort,
  type VideoConfig,
} from '../../apps/api/src/platform/ports/video/index.js';
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
/** The subscriber's now; the session started ten minutes before it. */
const NOW = new Date('2026-11-03T08:00:00Z');
const STARTED = new Date('2026-11-03T07:50:00Z');
const ENDS = new Date('2026-11-03T08:50:00Z');
const OPTIONS = { maxWait: 5_000, timeout: 15_000 };
/** A logger that writes nothing: the subscriber's line is its unit spec's. */
const SILENT = { info: () => undefined, warn: () => undefined };

/** Where the webhook's transaction stops, when a probe asks it to. */
interface WebhookStops {
  /** Its backend, once its transaction has begun. */
  began?: (pid: number) => void;
  /** After its work, before it commits. */
  beforeCommit?: () => Promise<void>;
}

let db: Db;
let database: Database;
let server: Server;
let stand: VideoStandIn;
let stops: WebhookStops = {};

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const transactions: Transactions = {
    run: (work) =>
      database.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        stops.began?.(row?.pid ?? 0);
        const value = await work(tx);
        await stops.beforeCommit?.();
        return value;
      }, OPTIONS),
  };
  const route = createVideoWebhookRoute({
    transactions,
    video: createVideoPort(CONFIG),
    log: createLogger({ level: 'fatal', destination: { write: () => undefined } }),
    maxBodyBytes: 1_048_576,
    report: () => undefined,
  });
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url !== VIDEO_WEBHOOK_PATH) {
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

/** The standing as `createAdminServices` builds it, over `registry`. */
function standingOver(registry: AccountConsequences): StandingService {
  return new StandingService({
    store: standingStoreOver(database),
    consequences: registry,
    revokeSubjects,
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
  });
}

/** Booking's subscriber, after `before` when one is given, as `main.ts` binds it. */
function registry(before?: Parameters<AccountConsequences['subscribe']>[0]): AccountConsequences {
  const consequences = new AccountConsequences();
  if (before !== undefined) consequences.subscribe(before);
  consequences.subscribe(
    terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
  );
  return consequences;
}

/** An approved teacher, a confirmed enrollment, and its one session in its join period. */
async function world() {
  const offer = await makeOffer(db);
  await insertRow(db, 'user_roles', {
    user_id: offer.teacherId,
    role: 'teacher',
    status: 'active',
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: '',
    qualification_summary: 'Hafs',
    verification_status: 'approved',
    approved_at: new Date('2026-10-01T00:00:00Z'),
    application_status: 'approved',
    application_submitted_at: new Date('2026-09-30T00:00:00Z'),
  });
  const studentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: new Date('2026-10-04T07:00:00Z'),
  });
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-03',
    scheduled_start_time_local: '09:50:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: STARTED,
    scheduled_end_at: ENDS,
    status: 'scheduled',
  });
  const adminId = await makeAdmin(db);
  return { teacherId: offer.teacherId, sessionId, adminId };
}

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

/** What both transactions left: the account, the session and the event's rows. */
async function outcomeOf(teacherId: string, sessionId: string, providerEventId: string) {
  // One after the other: the watcher is one connection.
  const account = await db.query<{ account_status: string }>(
    'SELECT account_status::text FROM users WHERE id = $1::uuid',
    [teacherId],
  );
  const session = await db.query<{ status: string }>(
    'SELECT status::text FROM sessions WHERE id = $1::uuid',
    [sessionId],
  );
  const events = await db.query<{ user_id: string; event_type: string }>(
    `SELECT user_id::text, event_type::text FROM session_participant_events
      WHERE provider_event_id = $1`,
    [providerEventId],
  );
  return {
    account: account.rows[0]?.account_status,
    session: session.rows[0]?.status,
    events: events.rows,
  };
}

describe("a participant's leave raced against a teacher's suspension, the session in its join period (T012, H1)", () => {
  it('the suspension first: the webhook waits on the account, and both commit with no deadlock', async () => {
    const { teacherId, sessionId, adminId } = await world();
    const left = stand.left(sessionId, teacherId, { at: NOW });
    const holding = signal<number>();
    const suspensionGate = gate();
    const webhookBegan = signal<number>();
    stops = { began: webhookBegan.give };

    const suspension = database.$transaction(
      (tx) =>
        standingOver(
          registry(async (held) => {
            const [row] = await held.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            holding.give(row?.pid ?? 0);
            await suspensionGate.opened;
          }),
        ).suspend(tx, adminId, teacherId),
      OPTIONS,
    );
    let delivered: Promise<number> | undefined;
    try {
      await Promise.race([holding.given, suspension]);
      delivered = stand.deliver(left);
      await seenWaiting(await webhookBegan.given);
    } finally {
      suspensionGate.open();
    }
    const [suspended, status] = await Promise.allSettled([suspension, delivered]);
    stops = {};

    expect(suspended.status).toBe('fulfilled');
    expect(status).toEqual({ status: 'fulfilled', value: 200 });
    expect(await outcomeOf(teacherId, sessionId, left.providerEventId)).toEqual({
      account: 'suspended',
      session: 'cancelled_by_admin',
      events: [{ user_id: teacherId, event_type: 'left' }],
    });
  });

  it('the webhook first: the suspension waits on the account, and both commit with no deadlock', async () => {
    const { teacherId, sessionId, adminId } = await world();
    const left = stand.left(sessionId, teacherId, { at: NOW });
    const inserted = signal<void>();
    const webhookGate = gate();
    stops = {
      beforeCommit: async () => {
        inserted.give();
        await webhookGate.opened;
      },
    };

    const delivered = stand.deliver(left);
    let suspension: Promise<unknown> | undefined;
    try {
      await Promise.race([inserted.given, delivered]);
      const began = signal<number>();
      suspension = database.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        began.give(row?.pid ?? 0);
        return standingOver(registry()).suspend(tx, adminId, teacherId);
      }, OPTIONS);
      await seenWaiting(await began.given);
    } finally {
      webhookGate.open();
    }
    const [status, suspended] = await Promise.allSettled([delivered, suspension]);
    stops = {};

    expect(status).toEqual({ status: 'fulfilled', value: 200 });
    expect(suspended.status).toBe('fulfilled');
    expect(await outcomeOf(teacherId, sessionId, left.providerEventId)).toEqual({
      account: 'suspended',
      session: 'cancelled_by_admin',
      events: [{ user_id: teacherId, event_type: 'left' }],
    });
  });
});
