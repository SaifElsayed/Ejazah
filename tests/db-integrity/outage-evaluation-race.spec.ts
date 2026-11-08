// T016's follow-up (PR #129's review, round 1, Minor 1; the owner's decision of 2026-11-08) —
// `sessions.outages.record` raced against `evaluate-sessions` settling a scheduled session the
// window overlaps (contracts/kernel.md's "outage record" and "evaluation" rows; T005's one order).
//
// THE LOST OUTAGE IT GUARDS. The sweep settles a session from the windows it reads under its locks;
// the record reclassifies the settled sessions it reads under its own. Were the record to lock only
// the settled ones, a session the sweep is settling would still read `scheduled` to it, so the
// record would neither reclassify it nor wait: committed one after the other, the sweep's outcome,
// read with no window, would stand beside the window. The record also locks the scheduled sessions
// the window overlaps that have ended, their enrollments first, then those sessions, the sweep's
// order, and reads them again under the locks, so one of the two waits for the other.
//
// HOW THE RACE IS STAGED, the order decided by the database and not by timing, as
// `evaluation-reresolution-race.spec.ts` stages its own. The session ended an hour before both
// clocks' instant (AT), so it is due and inside its dispute window; it has no participant event.
//   - The sweep first: its transaction has settled the session (Both-No-Show) and waits on a gate
//     before it commits; the record is seen waiting on a lock in `pg_stat_activity`; the gate
//     opens, and both commit: the record, reading the session again under its locks, finds it
//     settled and reclassifies it `provider_outage`.
//   - The record first: its transaction has locked the session and inserted the window and waits
//     on a gate before it commits; the sweep is seen waiting; the gate opens, and both commit: the
//     sweep, reading the session again under its locks, reads the committed window and settles the
//     session `provider_outage`.
// Both are global, so each is given the module's store narrowed to this file's sessions, and both
// read a stand-in clock (AT) on days of this run's own, far from every other spec's, since the
// windows are committed and `provider_outages` is append-only. Every connection is the
// application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomInt } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createCompletion,
  createEvaluation,
  createOutageServices,
  type EvaluationStore,
  evaluationStore,
  type OutageStore,
  outageStore,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addDays, resolveLocalDateTime } from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };
const SILENT = createLogger({ level: 'fatal', destination: { write: () => undefined } });
/** A zone with no clock change, UTC all year, so a wall clock reads as its instant. */
const ZONE = 'Africa/Abidjan';
/** This run's own days: from 2040-01-01 plus a random number of days. */
const RUN_OFFSET = randomInt(0, 3000);
const dayOf = (offset: number): string =>
  addDays(new Date('2040-01-01T00:00:00Z'), RUN_OFFSET + offset).slice(0, 10);
const utc = (day: string, time: string): string =>
  resolveLocalDateTime({ localDate: day, localTime: `${time}:00`, timezone: ZONE }).startsAt;

const SETTINGS: Readonly<Record<string, number>> = {
  session_evaluation_delay_minutes: 2,
  attendance_threshold_pct: 70,
  join_window_minutes: 10,
  minimum_connection_seconds: 60,
  early_join_lead_minutes: 15,
  dispute_window_hours: 72,
  slot_release_buffer_weeks: 0,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};

let db: Db;
let database: Database;
/** This file's sessions: the only ones either side sees. */
const own = new Set<string>();

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

function gate(): { readonly open: () => void; readonly opened: Promise<void> } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function signal(): { readonly give: () => void; readonly given: Promise<void> } {
  let give = (): void => undefined;
  const given = new Promise<void>((resolve) => {
    give = resolve;
  });
  return { give, given };
}

/** Resolves once one of `pids` waits on a lock; fails after about four seconds. */
async function seenWaiting(pids: () => readonly number[]): Promise<void> {
  for (let look = 0; look < 200; look += 1) {
    const { rows } = await db.query<{ waiting: boolean }>(
      `SELECT bool_or(wait_event_type = 'Lock') AS waiting FROM pg_stat_activity
        WHERE pid = ANY($1::int[])`,
      [pids()],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('neither backend waited on a lock');
}

/** True once `pids` is seen waiting on a lock, false when `finished` settles first. */
function waitedBefore(pids: () => readonly number[], finished: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    seenWaiting(pids).then(() => true),
    finished.then(
      () => false,
      () => false,
    ),
  ]);
}

/**
 * A confirmed enrollment and its one scheduled session, `day` 10:00 to 11:00 in ZONE, with no
 * participant event; the clocks' instant an hour after its end.
 */
async function world(): Promise<{ sessionId: string; at: Date; day: string }> {
  const day = dayOf(own.size);
  const offer = await makeOffer(db);
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
    scheduled_date_local: day,
    scheduled_start_time_local: '10:00:00',
    timezone: ZONE,
    scheduled_start_at: utc(day, '10:00'),
    scheduled_end_at: utc(day, '11:00'),
    status: 'scheduled',
  });
  own.add(sessionId);
  return { sessionId, at: new Date(utc(day, '12:00')), day };
}

/** The window `day` 09:30 to 11:30 in ZONE, over the session. */
const windowOn = (day: string) => ({
  start: { localDate: day, localTime: '09:30' },
  end: { localDate: day, localTime: '11:30' },
  timezone: ZONE,
  reason: 'انقطاع لدى مزود الفيديو',
});

/** The record on its own transaction, as the procedure runs it, stopping where `stops` says. */
function record(
  admin: string,
  day: string,
  at: Date,
  stops: { readonly began: (pid: number) => void; readonly afterInsert?: () => Promise<void> },
) {
  const narrowed = <T extends { readonly id: string }>(rows: readonly T[]): T[] =>
    rows.filter(({ id }) => own.has(id));
  const store: OutageStore = {
    ...outageStore,
    reclassifiableSessions: async (tx, window, endedAfter, ids) =>
      narrowed(await outageStore.reclassifiableSessions(tx, window, endedAfter, ids)),
    endedScheduledSessions: async (tx, window, endedBy) =>
      narrowed(await outageStore.endedScheduledSessions(tx, window, endedBy)),
    insertOutage: async (tx, outage) => {
      const id = await outageStore.insertOutage(tx, outage);
      await stops.afterInsert?.();
      return id;
    },
  };
  const enrollments = createEnrollmentSide({ settings, now: () => at });
  const outages = createOutageServices({
    enrollments,
    completion: createCompletion({ enrollments, settings, log: SILENT }),
    settings,
    log: SILENT,
    adminNames: async () => new Map(),
    clock: async () => at,
    store,
  });
  return database.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    stops.began(row?.pid ?? 0);
    return outages.record(tx, admin, windowOn(day));
  }, OPTIONS);
}

/** The evaluation as the job builds it, on the stand-in clock, its transactions' backends recorded. */
function evaluation(at: Date, stops: { readonly afterSettle?: () => Promise<void> } = {}) {
  const pids: number[] = [];
  const transactions: Transactions = {
    run: (work) =>
      database.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pids.push(row?.pid ?? 0);
        return work(tx);
      }, OPTIONS),
  };
  const store: EvaluationStore = {
    ...evaluationStore,
    dueForEvaluation: async (tx, dueBy, after, limit) => {
      const all = await evaluationStore.dueForEvaluation(tx, dueBy, after, 100_000);
      return all.filter(({ id }) => own.has(id)).slice(0, limit);
    },
    settle: async (tx, settlement) => {
      const moved = await evaluationStore.settle(tx, settlement);
      await stops.afterSettle?.();
      return moved;
    },
  };
  const enrollments = createEnrollmentSide({ settings, now: () => at });
  return {
    pids,
    sweep: createEvaluation({
      transactions,
      enrollments,
      completion: createCompletion({ enrollments, settings, log: SILENT }),
      video: { endRoom: async () => undefined },
      settings,
      log: SILENT,
      pageSize: 200,
      report: () => undefined,
      clock: async () => at,
      store,
    }),
  };
}

/** What both transactions left: the session's status and its rows, oldest first. */
async function outcomeOf(sessionId: string) {
  const session = await db.query<{ status: string }>(
    'SELECT status::text FROM sessions WHERE id = $1::uuid',
    [sessionId],
  );
  const rows = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
    [sessionId],
  );
  return { status: session.rows[0]?.status, rows: rows.rows.map(({ kind }) => kind) };
}

describe(`the outage record raced against the evaluation of a session it overlaps (T016, Minor 1), RUN_OFFSET ${RUN_OFFSET}`, () => {
  it('the sweep first: the record waits on the enrollment and reclassifies the session the sweep settled', async () => {
    const admin = await makeAdmin(db);
    const { sessionId, at, day } = await world();
    const settledHeld = signal();
    const sweepGate = gate();
    const evaluating = evaluation(at, {
      afterSettle: async () => {
        settledHeld.give();
        await sweepGate.opened;
      },
    });
    const settling = evaluating.sweep.settleDue();
    let recording: Promise<unknown> = Promise.resolve();
    let waited = false;
    try {
      await Promise.race([settledHeld.given, settling]);
      let recordPid = 0;
      recording = record(admin, day, at, {
        began: (pid) => {
          recordPid = pid;
        },
      });
      waited = await waitedBefore(() => [recordPid], recording);
    } finally {
      sweepGate.open();
    }
    const [settled, recorded] = await Promise.allSettled([settling, recording]);

    expect(await outcomeOf(sessionId)).toEqual({
      status: 'provider_outage',
      rows: ['settled', 'outage_reclassified'],
    });
    expect(settled).toEqual({ status: 'fulfilled', value: { settled: [sessionId], failed: [] } });
    expect(recorded).toMatchObject({ status: 'fulfilled', value: { reclassified: 1 } });
    expect(waited).toBe(true);
  });

  it('the record first: the sweep waits on the enrollment and settles the session with the window', async () => {
    const admin = await makeAdmin(db);
    const { sessionId, at, day } = await world();
    const holding = signal();
    const recordGate = gate();
    let recordPid = 0;
    const recording = record(admin, day, at, {
      began: (pid) => {
        recordPid = pid;
      },
      afterInsert: async () => {
        holding.give();
        await recordGate.opened;
      },
    });
    const evaluating = evaluation(at);
    let settling: Promise<unknown> = Promise.resolve();
    let waited = false;
    try {
      await Promise.race([holding.given, recording]);
      settling = evaluating.sweep.settleDue();
      waited = await waitedBefore(() => evaluating.pids, settling);
    } finally {
      recordGate.open();
    }
    const [recorded, settled] = await Promise.allSettled([recording, settling]);

    expect(recordPid).not.toBe(0);
    expect(await outcomeOf(sessionId)).toEqual({ status: 'provider_outage', rows: ['settled'] });
    expect(recorded).toMatchObject({ status: 'fulfilled', value: { reclassified: 0 } });
    expect(settled).toEqual({ status: 'fulfilled', value: { settled: [sessionId], failed: [] } });
    expect(waited).toBe(true);
  });
});
