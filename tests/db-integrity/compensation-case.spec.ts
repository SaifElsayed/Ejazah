// T035 — moderation's `openCompensationCase` over the real tables (FR-362, FR-375, FR-DISPUTE-5; the
// owner's decisions of 2026-11-01, PR #109's review round 2).
//
// A case is a `disputes` row of `kind = compensation_case`, opened by the system: no session, no
// raiser, `status = open`, its reason one of the closed list written to `disputes.reason`. One open
// case per enrollment and reason: a call while it is open joins it, a call after it was resolved or
// dismissed opens a new one, and another reason on the same enrollment is a case of its own.
//
// T082: what the covering rule (`jobs/case-cover.ts`) reads of an enrollment's cases, through
// `caseInstantsOf` and `caseInstantsAmong`: whether one is open, the latest opening, and the latest
// closing (`resolved_at`), with two cases and with none. A case closed with no closing recorded
// was a case here until Phase 3's T001: ERD §15 rule 46 now refuses it, so the case proves the
// refusal and that the case stays open (the follow-up under T001 of specs/004-sessions/tasks.md).
//
// T004 of specs/004-sessions (research R-312, R-326; the owner's decision of 2026-11-06 on PR #126's
// review, follow-up 1): the closed list gains Phase 3's eleven reasons, and the covering rule reads
// Phase 2's three only (`COVERING_REASONS`): a `teacher_ended` case, open and then closed, is not
// read, so it never covers a second paid order, while Phase 2's three are.
//
// The race: `disputes` has no unique index that keeps one open case per enrollment and reason, so
// the function locks the enrollment's row (T005's `lockRows`) and only then reads the open case.
// HOW THE RACE IS STAGED, as `teacher-slots.spec.ts` stages it: transaction A opens the case and
// stays open; transaction B calls for the same enrollment and reason and is seen waiting on a lock
// by a watcher reading `pg_stat_activity`, so the order is the database's, not the timing's; then A
// commits and B ends, joining A's case. Without the lock B would not wait and both would insert.
//
// The rows are committed, each probe writing an enrollment of its own; all three connections are
// the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  caseInstantsAmong,
  caseInstantsOf,
  COMPENSATION_REASONS,
  COVERING_REASONS,
  openCompensationCase,
} from '../../apps/api/src/modules/moderation/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { connectAsApplication, type Db, makeAdmin, makeEnrollment } from './harness';

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
  await closeDatabase(database);
});

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

interface CaseColumns {
  id: string;
  enrollment_id: string;
  session_id: string | null;
  kind: string;
  raised_by_user_id: string | null;
  reason: string;
  status: string;
}

async function casesOf(enrollmentId: string): Promise<CaseColumns[]> {
  const { rows } = await db.query<CaseColumns>(
    `SELECT id, enrollment_id, session_id, kind::text AS kind, raised_by_user_id, reason,
            status::text AS status
       FROM disputes WHERE enrollment_id = $1 ORDER BY id`,
    [enrollmentId],
  );
  return rows;
}

/** One call in a transaction of its own, committed. */
function open(enrollmentId: string, reason: (typeof COMPENSATION_REASONS)[number]) {
  return database.$transaction((tx) => openCompensationCase(tx, enrollmentId, reason), OPTIONS);
}

/** Closes the case as an administrator's decision would, `resolved` or `dismissed`. */
async function close(caseId: string, status: 'resolved' | 'dismissed'): Promise<void> {
  const adminId = await makeAdmin(db);
  await db.query(
    `UPDATE disputes
        SET status = $2::dispute_status,
            resolution = CASE WHEN $2 = 'resolved' THEN 'compensation_ordered'::dispute_resolution END,
            resolution_notes = 'Probe decision', resolved_by_admin_id = $3, resolved_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [caseId, status, adminId],
  );
}

describe('openCompensationCase opens one system case per reason (T035, FR-DISPUTE-5)', () => {
  it('has exactly the seventeen reasons of the closed list: Phase 2’s three, R-312’s nine, the manual case’s two, T071’s pause, T082’s direct end and 005:T014’s gender correction', () => {
    expect([...COMPENSATION_REASONS]).toEqual([
      'slot_unavailable',
      'party_restricted',
      'duplicate_payment',
      'absence_termination',
      'admin_cancellation',
      'teacher_ended',
      'student_suspended',
      'student_banned',
      'student_fault_confirmed',
      'refund_choice',
      'counter_unanswered',
      'makeup_refused',
      'admin_opened_for_student',
      'admin_opened_for_teacher',
      'teacher_suspended',
      'admin_ended',
      'gender_correction',
    ]);
    expect(COMPENSATION_REASONS).not.toContain('teacher_no_show_threshold');
  });

  it('names Phase 2’s three as the only reasons the covering rule reads (T004)', () => {
    expect([...COVERING_REASONS]).toEqual([
      'slot_unavailable',
      'party_restricted',
      'duplicate_payment',
    ]);
  });

  for (const reason of COMPENSATION_REASONS) {
    it(`opens an open compensation case for ${reason}, raised by no one, on no session`, async () => {
      const { enrollmentId } = await makeEnrollment(db);
      const opened = await open(enrollmentId, reason);
      const cases = await casesOf(enrollmentId);
      expect(cases).toEqual([
        {
          id: opened.caseId,
          enrollment_id: enrollmentId,
          session_id: null,
          kind: 'compensation_case',
          raised_by_user_id: null,
          reason,
          status: 'open',
        },
      ]);
      expect(opened).toEqual({ caseId: cases[0]?.id, opened: true });
    });
  }
});

describe('one open case per enrollment and reason (the owner’s decisions of 2026-11-01)', () => {
  it('a repeated call while the case is open joins it and opens no second', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const first = await open(enrollmentId, 'duplicate_payment');
    const second = await open(enrollmentId, 'duplicate_payment');
    expect(second).toEqual({ caseId: first.caseId, opened: false });
    expect((await casesOf(enrollmentId)).map((row) => row.id)).toEqual([first.caseId]);
  });

  it('two reasons on one enrollment are two cases, each joined by its own reason', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const restricted = await open(enrollmentId, 'party_restricted');
    const duplicate = await open(enrollmentId, 'duplicate_payment');
    expect(duplicate.opened).toBe(true);
    expect(duplicate.caseId).not.toBe(restricted.caseId);
    expect(await open(enrollmentId, 'party_restricted')).toEqual({
      caseId: restricted.caseId,
      opened: false,
    });
    expect((await casesOf(enrollmentId)).map(({ reason, status }) => ({ reason, status }))).toEqual(
      [
        { reason: 'party_restricted', status: 'open' },
        { reason: 'duplicate_payment', status: 'open' },
      ],
    );
  });

  it('a call after the case was resolved, or dismissed, opens a new one', async () => {
    for (const status of ['resolved', 'dismissed'] as const) {
      const { enrollmentId } = await makeEnrollment(db);
      const first = await open(enrollmentId, 'duplicate_payment');
      await close(first.caseId, status);
      const next = await open(enrollmentId, 'duplicate_payment');
      expect(next.opened).toBe(true);
      expect(next.caseId).not.toBe(first.caseId);
      expect(
        (await casesOf(enrollmentId)).map(({ id, status: state }) => ({ id, status: state })),
      ).toEqual([
        { id: first.caseId, status },
        { id: next.caseId, status: 'open' },
      ]);
    }
  });

  it('a case of another enrollment is never joined', async () => {
    const one = await makeEnrollment(db);
    const other = await makeEnrollment(db);
    const first = await open(one.enrollmentId, 'slot_unavailable');
    const second = await open(other.enrollmentId, 'slot_unavailable');
    expect(second.opened).toBe(true);
    expect(second.caseId).not.toBe(first.caseId);
  });
});

/** The case's opening and closing instants as the database holds them, to the millisecond. */
async function instantsOf(caseId: string): Promise<{ openedAt: Date; closedAt: Date | null }> {
  const { rows } = await db.query<{ created_at: Date; resolved_at: Date | null }>(
    `SELECT created_at, resolved_at FROM disputes WHERE id = $1`,
    [caseId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error(`no case ${caseId}`);
  return { openedAt: row.created_at, closedAt: row.resolved_at };
}

describe('the cases the covering rule reads (T082, `jobs/case-cover.ts`)', () => {
  it('an enrollment with no case is absent', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    expect(await caseInstantsOf(database, enrollmentId)).toBeNull();
    expect((await caseInstantsAmong(database, [enrollmentId])).size).toBe(0);
    expect((await caseInstantsAmong(database, [])).size).toBe(0);
  });

  it('one open case: open, its opening, no closing', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const { caseId } = await open(enrollmentId, 'slot_unavailable');
    const { openedAt } = await instantsOf(caseId);
    expect(await caseInstantsOf(database, enrollmentId)).toEqual({
      open: true,
      lastOpenedAt: openedAt,
      lastClosedAt: null,
    });
  });

  it('a case resolved, or dismissed: not open, its opening and its closing', async () => {
    for (const status of ['resolved', 'dismissed'] as const) {
      const { enrollmentId } = await makeEnrollment(db);
      const { caseId } = await open(enrollmentId, 'party_restricted');
      await close(caseId, status);
      const { openedAt, closedAt } = await instantsOf(caseId);
      expect(closedAt).not.toBeNull();
      expect(await caseInstantsOf(database, enrollmentId)).toEqual({
        open: false,
        lastOpenedAt: openedAt,
        lastClosedAt: closedAt,
      });
    }
  });

  it('two cases, one closed and one open: open, the later opening, the closed one’s closing', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const restricted = await open(enrollmentId, 'party_restricted');
    await close(restricted.caseId, 'resolved');
    const duplicate = await open(enrollmentId, 'duplicate_payment');
    const closed = await instantsOf(restricted.caseId);
    const opened = await instantsOf(duplicate.caseId);
    expect(await caseInstantsOf(database, enrollmentId)).toEqual({
      open: true,
      lastOpenedAt: opened.openedAt,
      lastClosedAt: closed.closedAt,
    });
  });

  it('a case closed with no recorded closing is refused by the database (ERD §15 rule 46), and stays open', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const { caseId } = await open(enrollmentId, 'slot_unavailable');
    await expect(
      db.query(`UPDATE disputes SET status = 'dismissed', updated_at = now() WHERE id = $1`, [
        caseId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const { openedAt } = await instantsOf(caseId);
    expect(await caseInstantsOf(database, enrollmentId)).toEqual({
      open: true,
      lastOpenedAt: openedAt,
      lastClosedAt: null,
    });
  });

  it('reads several enrollments in one call, each its own', async () => {
    const one = await makeEnrollment(db);
    const other = await makeEnrollment(db);
    const none = await makeEnrollment(db);
    await open(one.enrollmentId, 'slot_unavailable');
    const closing = await open(other.enrollmentId, 'duplicate_payment');
    await close(closing.caseId, 'dismissed');
    const cases = await caseInstantsAmong(database, [
      one.enrollmentId,
      other.enrollmentId,
      none.enrollmentId,
    ]);
    expect([...cases.keys()].sort()).toEqual([one.enrollmentId, other.enrollmentId].sort());
    expect(cases.get(one.enrollmentId)?.open).toBe(true);
    expect(cases.get(other.enrollmentId)?.open).toBe(false);
  });
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

/**
 * A runs `first` and stays open; B runs `second` and is seen waiting; A commits. Answers what each
 * returned.
 */
async function race<T>(
  first: (tx: Transaction) => Promise<T>,
  second: (tx: Transaction) => Promise<T>,
): Promise<{ readonly a: T; readonly b: T }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (): void => undefined;
  const firstRan = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const a = database.$transaction(async (tx) => {
    const value = await first(tx);
    ran();
    await released;
    return value;
  }, OPTIONS);
  await Promise.race([firstRan, a]);
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = database.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    pidOfB(row?.pid ?? 0);
    return second(tx);
  }, OPTIONS);
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
  }
  return { a: await a, b: await b };
}

describe('the covering rule reads Phase 2’s three reasons only (T004 of specs/004-sessions)', () => {
  it('a teacher_ended case, open and then closed, is not read', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const { caseId } = await open(enrollmentId, 'teacher_ended');
    expect(await caseInstantsOf(database, enrollmentId)).toBeNull();
    expect((await caseInstantsAmong(database, [enrollmentId])).size).toBe(0);
    await close(caseId, 'resolved');
    expect(await caseInstantsOf(database, enrollmentId)).toBeNull();
  });

  it.each(COVERING_REASONS)(
    '%s is read, open and then closed, beside an open teacher_ended case it is not swayed by',
    async (reason) => {
      const { enrollmentId } = await makeEnrollment(db);
      await open(enrollmentId, 'teacher_ended');
      const { caseId } = await open(enrollmentId, reason);
      const opened = await instantsOf(caseId);
      expect(await caseInstantsOf(database, enrollmentId)).toEqual({
        open: true,
        lastOpenedAt: opened.openedAt,
        lastClosedAt: null,
      });
      await close(caseId, 'dismissed');
      const closed = await instantsOf(caseId);
      expect(await caseInstantsOf(database, enrollmentId)).toEqual({
        open: false,
        lastOpenedAt: opened.openedAt,
        lastClosedAt: closed.closedAt,
      });
    },
  );

  it('every reason Phase 3 and 005:T014 add is left out, each one open on its own enrollment', async () => {
    const added = COMPENSATION_REASONS.filter(
      (reason) => !(COVERING_REASONS as readonly string[]).includes(reason),
    );
    expect(added).toHaveLength(14);
    const enrollments: string[] = [];
    for (const reason of added) {
      const { enrollmentId } = await makeEnrollment(db);
      await open(enrollmentId, reason);
      enrollments.push(enrollmentId);
    }
    expect((await caseInstantsAmong(database, enrollments)).size).toBe(0);
  });
});

describe('two concurrent calls for one enrollment and reason leave one open case (T005)', () => {
  it('the second waits on the enrollment’s lock, then joins the first’s case', async () => {
    const { enrollmentId } = await makeEnrollment(db);
    const { a, b } = await race(
      (tx) => openCompensationCase(tx, enrollmentId, 'slot_unavailable'),
      (tx) => openCompensationCase(tx, enrollmentId, 'slot_unavailable'),
    );
    expect(a.opened).toBe(true);
    expect(b).toEqual({ caseId: a.caseId, opened: false });
    expect(
      (await casesOf(enrollmentId)).map(({ id, reason, status }) => ({ id, reason, status })),
    ).toEqual([{ id: a.caseId, reason: 'slot_unavailable', status: 'open' }]);
  });
});
