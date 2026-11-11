// T035 of specs/004-sessions/tasks.md — moderation's `closeCase` over the real tables as the
// application role (FR-422; research R-312; contracts/kernel.md, the row «closing a case or
// dispute»; the note under `003:T082` of specs/003-booking/tasks.md).
//
// - Each status: one conditional update writes `status`, `resolution` (the argument, none for a
//   dismissal), `resolution_notes`, `resolved_by_admin_id` and `resolved_at` together, `resolved_at`
//   the database's clock read under the enrollment's lock, never the transaction's start; a case no
//   longer open is left as it is and answered null.
// - The race the note under 003:T082 asks for, staged with a paid event: the closing's transaction
//   starts, a confirm job's transaction holds the enrollment's lock, a paid event is recorded and
//   committed, the closing is seen waiting on the lock, the job commits; the case's `resolved_at` is
//   then after the paid event, so the covering rule (`jobs/case-cover.ts`) keeps that order covered.
//   With `now()` the closing instant would be the transaction's start, before the paid event, and
//   the order would be left without its case.
// - One resolved and one dismissed case on one enrollment, the later closing winning in
//   `caseInstantsAmong`, each order of the two closings, on Phase 2's reasons, which are the only
//   ones that rule reads since T004 (the note under T035, F4; research R-326).
//
// Every row is committed, each probe with an enrollment of its own; all connections are the
// application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { covers } from '../../apps/api/src/jobs/case-cover.js';
import {
  caseInstantsAmong,
  caseInstantsOf,
  closeCase,
  openCompensationCase,
} from '../../apps/api/src/modules/moderation/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { lockRows } from '../../apps/api/src/platform/db/row-lock.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { connectAsApplication, type Db, insertRow, makeAdmin, makeEnrollment } from './harness';

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

interface ClosedColumns {
  status: string;
  resolution: string | null;
  resolution_notes: string | null;
  resolved_by_admin_id: string | null;
  resolved_at: Date | null;
}

async function columnsOf(caseId: string): Promise<ClosedColumns> {
  const { rows } = await db.query<ClosedColumns>(
    `SELECT status::text AS status, resolution::text AS resolution, resolution_notes,
            resolved_by_admin_id, resolved_at
       FROM disputes WHERE id = $1`,
    [caseId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no such case');
  return row;
}

async function openCase(
  enrollmentId: string,
  reason: Parameters<typeof openCompensationCase>[2],
): Promise<string> {
  const { caseId } = await database.$transaction(
    (tx) => openCompensationCase(tx, enrollmentId, reason),
    OPTIONS,
  );
  return caseId;
}

/** The transaction's start (`now()`) and what `closeCase` answered, in one committed transaction. */
function closeInOwn(
  caseId: string,
  closing: Parameters<typeof closeCase>[2],
): Promise<{ readonly started: Date; readonly closedAt: Date | null }> {
  return database.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ started: Date }[]>`SELECT now() AS started`;
    if (row === undefined) throw new Error('now() answered no row');
    return { started: row.started, closedAt: await closeCase(tx, caseId, closing) };
  }, OPTIONS);
}

describe('closeCase writes the closing in one conditional update (T035, FR-422)', () => {
  it.each([
    ['resolved', 'compensation_ordered'],
    ['dismissed', null],
  ] as const)(
    'closes an open case %s: resolution, notes, administrator and resolved_at together, by the database clock',
    async (status, resolution) => {
      const adminId = await makeAdmin(db);
      const { enrollmentId } = await makeEnrollment(db);
      const caseId = await openCase(enrollmentId, 'party_restricted');
      const { started, closedAt } = await closeInOwn(caseId, {
        status,
        resolution,
        note: 'Probe note',
        adminId,
      });
      const row = await columnsOf(caseId);
      expect(row).toEqual({
        status,
        resolution,
        resolution_notes: 'Probe note',
        resolved_by_admin_id: adminId,
        resolved_at: closedAt,
      });
      expect(closedAt).not.toBeNull();
      // The database's clock under the lock, later than the transaction's start (never `now()`).
      expect(closedAt!.getTime()).toBeGreaterThan(started.getTime());
    },
  );

  it.each(['resolved', 'dismissed'] as const)(
    'answers null and changes nothing on a case already %s',
    async (first) => {
      const adminId = await makeAdmin(db);
      const other = await makeAdmin(db);
      const { enrollmentId } = await makeEnrollment(db);
      const caseId = await openCase(enrollmentId, 'duplicate_payment');
      await closeInOwn(caseId, {
        status: first,
        resolution: first === 'resolved' ? 'compensation_ordered' : null,
        note: 'First',
        adminId,
      });
      const before = await columnsOf(caseId);
      const again = await closeInOwn(caseId, {
        status: 'resolved',
        resolution: 'compensation_ordered',
        note: 'Second',
        adminId: other,
      });
      expect(again.closedAt).toBeNull();
      expect(await columnsOf(caseId)).toEqual(before);
    },
  );
});

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

/** A promise and the function that settles it. */
function signal<T = void>(): { readonly promise: Promise<T>; readonly settle: (value: T) => void } {
  let settle = (_value: T): void => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * An order on the enrollment, committed before the race: its insert key-shares the enrollment, so
 * it is placed before the job holds the row, as an order is placed at Pay, long before its event.
 */
function placeOrder(enrollmentId: string): Promise<string> {
  return insertRow(db, 'payments', {
    enrollment_id: enrollmentId,
    gateway: 'fake',
    gateway_order_id: `probe-order-${enrollmentId}`,
    currency: 'EGP',
    status: 'paid',
    expires_at: '2026-10-04T07:10:00Z',
  });
}

/** The order's paid event, committed; its `created_at`, the paid instant the covering rule reads. */
async function recordPaidEvent(paymentId: string, enrollmentId: string): Promise<Date> {
  const eventId = await insertRow(db, 'payment_events', {
    payment_id: paymentId,
    provider_event_id: `probe-paid-${enrollmentId}`,
    event_type: 'paid',
    signature_verified_at: '2026-10-04T07:01:00Z',
    payload_hash: 'probe-payload-hash',
    received_at: '2026-10-04T07:01:00Z',
  });
  const { rows } = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM payment_events WHERE id = $1',
    [eventId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no paid event');
  return row.created_at;
}

describe('the closing raced with a paid event (the note under 003:T082)', () => {
  it('waits on the enrollment the confirm job holds, and closes after the paid event, which stays covered', async () => {
    const adminId = await makeAdmin(db);
    const { enrollmentId } = await makeEnrollment(db);
    const caseId = await openCase(enrollmentId, 'party_restricted');
    const paymentId = await placeOrder(enrollmentId);

    // The confirm job's side: the enrollment's lock held, as `confirm-enrollment` holds it.
    const jobHolds = signal();
    const jobReleases = signal();
    const job = database.$transaction(async (tx: Transaction) => {
      await lockRows(tx, 'enrollments', [enrollmentId]);
      jobHolds.settle();
      await jobReleases.promise;
    }, OPTIONS);
    await jobHolds.promise;

    // The closing's transaction starts before the paid event is recorded.
    const closingStarted = signal<{ readonly started: Date; readonly pid: number }>();
    const paidRecorded = signal();
    const closing = database.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ started: Date; pid: number }[]>`
        SELECT now() AS started, pg_backend_pid() AS pid`;
      if (row === undefined) throw new Error('no row');
      closingStarted.settle(row);
      await paidRecorded.promise;
      return closeCase(tx, caseId, {
        status: 'resolved',
        resolution: 'compensation_ordered',
        note: 'Probe race',
        adminId,
      });
    }, OPTIONS);
    const { started, pid } = await closingStarted.promise;
    const paidAt = await recordPaidEvent(paymentId, enrollmentId);
    paidRecorded.settle();
    try {
      await seenWaiting(pid);
    } finally {
      jobReleases.settle();
    }
    await job;
    const closedAt = await closing;

    expect(started.getTime()).toBeLessThan(paidAt.getTime());
    expect(closedAt).not.toBeNull();
    expect(closedAt!.getTime()).toBeGreaterThanOrEqual(paidAt.getTime());
    const instants = await caseInstantsOf(database, enrollmentId);
    expect(instants).toMatchObject({ open: false, lastClosedAt: closedAt });
    expect(covers(instants, paidAt)).toBe(true);
  });
});

describe('one resolved and one dismissed case on one enrollment: the later closing wins (F4)', () => {
  it.each([
    ['resolved first, dismissed later', 'resolved', 'dismissed'],
    ['dismissed first, resolved later', 'dismissed', 'resolved'],
  ] as const)('%s', async (_name, first, second) => {
    const adminId = await makeAdmin(db);
    const { enrollmentId } = await makeEnrollment(db);
    const one = await openCase(enrollmentId, 'slot_unavailable');
    const other = await openCase(enrollmentId, 'party_restricted');
    const closing = (status: 'resolved' | 'dismissed') => ({
      status,
      resolution: status === 'resolved' ? ('compensation_ordered' as const) : null,
      note: 'Probe',
      adminId,
    });
    const earlier = await closeInOwn(one, closing(first));
    const later = await closeInOwn(other, closing(second));
    expect(later.closedAt!.getTime()).toBeGreaterThan(earlier.closedAt!.getTime());
    const instants = (await caseInstantsAmong(database, [enrollmentId])).get(enrollmentId);
    expect(instants).toMatchObject({ open: false, lastClosedAt: later.closedAt });
    expect((await columnsOf(one)).status).toBe(first);
    expect((await columnsOf(other)).status).toBe(second);
  });
});
