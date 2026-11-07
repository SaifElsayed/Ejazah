// T002 of specs/004-sessions/tasks.md — the kernel's locks of Phase 3, against Postgres, as the
// application role (contracts/kernel.md, "Locks and refusals"; data-model.md §5).
//
// `lockRows` widens to `sessions`, `session_remedies`, `cancellation_requests` and `disputes`: for
// each, a second transaction locking the same row is seen waiting until the first ends, and one
// locking another row of the table is not. `keyShareRows` (the owner's decision of 2026-11-06 on
// the sixth analysis, H1) takes `FOR KEY SHARE` on `users` rows: it waits on a `FOR UPDATE` of the
// row, and another `FOR KEY SHARE` of it goes through while the first is held. `clockTimestamp`
// reads the database's clock, later than the transaction's `now()` inside one transaction (FR-422).
//
// HOW A WAIT IS SEEN, as `account-locks.spec.ts` stages it: transaction A takes its lock and stays
// open; transaction B takes its own and is seen waiting on a lock by a watcher reading
// `pg_stat_activity`, so the order is the database's, not the timing's; then A ends and B goes on.
// The rows are committed, each probe writing parents of its own; every connection is the
// application role, since PostgreSQL hides another role's wait from a non-superuser.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clockTimestamp } from '../../apps/api/src/platform/db/db-clock.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  keyShareRows,
  type LockedTable,
  lockRows,
} from '../../apps/api/src/platform/db/row-lock.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { connectAsApplication, type Db, insertRow, makeSession, makeUser } from './harness';

let db: Db;
let watcher: Db;
let database: Database;

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

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/** Resolves once backend `pid` waits on a lock; fails after about two seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

/** A transaction that runs `take` and stays open until released; `held` once it holds. */
function holder(take: (tx: Transaction) => Promise<void>, log: string[]) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = (): void => undefined;
  const holding = new Promise<void>((resolve) => {
    hold = resolve;
  });
  const ended = database
    .$transaction(async (tx) => {
      await take(tx);
      hold();
      await released;
    }, OPTIONS)
    .then(() => void log.push('first ended'));
  return { held: Promise.race([holding, ended]), ended, release };
}

/** A transaction that runs `take`; `pid` resolves with its backend once it has begun. */
function taker(take: (tx: Transaction) => Promise<void>, log: string[]) {
  let begun = (_pid: number): void => undefined;
  const pid = new Promise<number>((resolve) => {
    begun = resolve;
  });
  const ended = database.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    begun(row?.pid ?? 0);
    await take(tx);
    log.push('second took');
  }, OPTIONS);
  return { pid, ended };
}

/** B is seen waiting while A holds, and goes on once A ends. */
async function waitsOn(
  first: (tx: Transaction) => Promise<void>,
  second: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const log: string[] = [];
  const a = holder(first, log);
  await a.held;
  const b = taker(second, log);
  try {
    await seenWaiting(await b.pid);
  } finally {
    // Logged before the first commits: the database frees the row at that commit, so the second
    // can take it before the client hears the commit returned, and `first ended` has no fixed place.
    log.push('first released');
    a.release();
  }
  await Promise.all([a.ended, b.ended]);
  expect(log.filter((entry) => entry !== 'first ended')).toEqual(['first released', 'second took']);
  expect(log).toContain('first ended');
}

/** B ends while A still holds. */
async function goesThrough(
  first: (tx: Transaction) => Promise<void>,
  second: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const log: string[] = [];
  const a = holder(first, log);
  await a.held;
  try {
    await taker(second, log).ended;
  } finally {
    a.release();
  }
  await a.ended;
  expect(log).toEqual(['second took', 'first ended']);
}

/** Two committed rows of `table`, each of a session of its own. */
async function twoRows(table: LockedTable): Promise<[string, string]> {
  const one = await rowOf(table);
  const other = await rowOf(table);
  return [one, other];
}

async function rowOf(table: LockedTable): Promise<string> {
  const { sessionId, enrollmentId, studentId } = await makeSession(db);
  switch (table) {
    case 'sessions':
      return sessionId;
    case 'session_remedies':
      return insertRow(db, 'session_remedies', {
        session_id: sessionId,
        kind: 'makeup',
        status: 'proposed',
        offered_at: '2026-10-07T07:00:00Z',
        choice_closes_at: '2026-10-14T07:00:00Z',
        snapshot_answer_window_hours: 72,
        snapshot_first_session_lead_hours: 24,
      });
    case 'cancellation_requests':
      return insertRow(db, 'cancellation_requests', {
        session_id: sessionId,
        requested_by_user_id: studentId,
        reason: 'Travelling',
        status: 'expired',
      });
    case 'disputes':
      return insertRow(db, 'disputes', {
        enrollment_id: enrollmentId,
        kind: 'compensation_case',
        reason: 'admin_cancellation',
        status: 'open',
      });
    default:
      throw new Error(`no row of ${table} is written here`);
  }
}

const PHASE_3_TABLES = [
  'sessions',
  'session_remedies',
  'cancellation_requests',
  'disputes',
] as const;

describe('lockRows on Phase 3’s tables (T002, data-model.md §5)', () => {
  it.each(PHASE_3_TABLES)(
    '%s: a second lock of the same row waits until the first ends',
    async (table) => {
      const [id] = await twoRows(table);
      await waitsOn(
        (tx) => lockRows(tx, table, [id]),
        (tx) => lockRows(tx, table, [id]),
      );
    },
  );

  it.each(PHASE_3_TABLES)('%s: a lock of another row does not wait', async (table) => {
    const [one, other] = await twoRows(table);
    await goesThrough(
      (tx) => lockRows(tx, table, [one]),
      (tx) => lockRows(tx, table, [other]),
    );
  });

  it.each(PHASE_3_TABLES)(
    '%s: a lock of several rows takes them in id order, in one statement',
    async (table) => {
      const [one, other] = await twoRows(table);
      const ids = [one, other].sort().reverse();
      await expect(
        database.$transaction((tx) => lockRows(tx, table, ids), OPTIONS),
      ).resolves.toBeUndefined();
    },
  );
});

describe('keyShareRows (T002, the sixth analysis, H1)', () => {
  it('waits on a FOR UPDATE of the account', async () => {
    const userId = await makeUser(db);
    await waitsOn(
      (tx) => lockRows(tx, 'users', [userId]),
      (tx) => keyShareRows(tx, 'users', [userId]),
    );
  });

  it('lets another FOR KEY SHARE of the account through', async () => {
    const userId = await makeUser(db);
    await goesThrough(
      (tx) => keyShareRows(tx, 'users', [userId]),
      (tx) => keyShareRows(tx, 'users', [userId]),
    );
  });

  it('makes a FOR UPDATE of the account wait until it ends', async () => {
    const userId = await makeUser(db);
    await waitsOn(
      (tx) => keyShareRows(tx, 'users', [userId]),
      (tx) => lockRows(tx, 'users', [userId]),
    );
  });
});

describe('clockTimestamp (T002, FR-422)', () => {
  it('reads the database’s clock, later than the transaction’s now() inside one transaction', async () => {
    const { started, read } = await database.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ started: Date }[]>`SELECT now() AS started`;
      // `$executeRaw`: the function answers a `void` column, which `$queryRaw` refuses to read.
      await tx.$executeRaw`SELECT pg_sleep(0.01)`;
      return { started: row?.started, read: await clockTimestamp(tx) };
    }, OPTIONS);
    expect(started).toBeInstanceOf(Date);
    expect(read).toBeInstanceOf(Date);
    expect(read.getTime()).toBeGreaterThan(started?.getTime() ?? Number.POSITIVE_INFINITY);
  });
});
