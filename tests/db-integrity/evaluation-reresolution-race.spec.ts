// T014 — `reresolve-session-instants` writing a session raced against `evaluate-sessions` settling
// the same session (contracts/kernel.md's evaluation and `reresolve-session-instants` rows; the
// owner's decision of 2026-11-06 on the fourth analysis, L1; research R-321, R-323 GAP-6).
//
// THE DEADLOCK IT GUARDS. The evaluation locks the enrollment, then the session. The re-resolution
// writes the session and inserts an `instants_reresolved` row, whose foreign key takes a key-share
// lock on the enrollment. Were the run to write the session with no lock taken first, it would hold
// the session while its insert waited on the enrollment the evaluation holds, and the evaluation
// would wait on the session: a deadlock. The run locks the sessions' enrollments, then the sessions,
// the evaluation's order, before it writes any of them, so one of the two waits for the other.
//
// HOW THE RACE IS STAGED, the order decided by the database and not by timing, as
// `video-webhook-race.spec.ts` stages its own. The session is due (ended days ago) and cached an
// hour early, as a time zone data change would leave it, so the run moves it.
//   - The run first: its transaction has locked and moved the session and waits on a gate before
//     its `instants_reresolved` row; the evaluation is seen waiting on a lock in `pg_stat_activity`;
//     the gate opens, and both commit: the session moved and then settled, one row of each kind.
//   - The evaluation first: its transaction has settled the session and waits on a gate before it
//     commits; the run is seen waiting; the gate opens, and both commit: the session settled at the
//     instants it had, which the run, reading it again under its locks, leaves with no row.
// The run is sessions' `reresolveScheduledSessions` on a transaction with the overlap constraints
// deferred, as the job runs it; the evaluation is sessions' `createEvaluation`, as the job builds
// it. Both are global sweeps, so each is given the module's store narrowed to this file's sessions.
// The rows are committed, each probe with a world of its own; every connection is the application
// role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createEnrollmentSide,
  sessionLengthsOf,
} from '../../apps/api/src/modules/booking/index.js';
import {
  createCompletion,
  createEvaluation,
  type EvaluationStore,
  evaluationStore,
  reresolutionStore,
  reresolveScheduledSessions,
} from '../../apps/api/src/modules/sessions/index.js';
import { clockTimestamp } from '../../apps/api/src/platform/db/db-clock.js';
import { withDeferredSessionConstraints } from '../../apps/api/src/platform/db/deferred-constraints.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };
const SILENT = createLogger({ level: 'fatal', destination: { write: () => undefined } });
/** A Thursday after Cairo's clocks went back (+02:00): 09:00 local is 07:00Z. */
const DAY = '2026-11-05';

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
/** This file's sessions: the only ones either sweep sees. */
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

/** A confirmed enrollment and its one session of DAY 09:00 in Cairo, cached an hour early. */
async function world(): Promise<{ enrollmentId: string; sessionId: string }> {
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
    scheduled_date_local: DAY,
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: `${DAY}T06:00:00Z`,
    scheduled_end_at: `${DAY}T07:00:00Z`,
    status: 'scheduled',
  });
  own.add(sessionId);
  return { enrollmentId, sessionId };
}

/** The run on its own transaction, as the job runs it, stopping where `stops` says. */
function reresolution(stops: {
  readonly began: (pid: number) => void;
  readonly beforeRows?: () => Promise<void>;
}) {
  return database.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    stops.began(row?.pid ?? 0);
    await withDeferredSessionConstraints(tx);
    return reresolveScheduledSessions(tx, {
      store: {
        ...reresolutionStore,
        // The global read in one page (`pageSize` below), narrowed to this file's sessions.
        scheduledAfter: async (inner, after, limit) =>
          (await reresolutionStore.scheduledAfter(inner, after, limit)).filter(({ id }) =>
            own.has(id),
          ),
        recordEvents: async (inner, events) => {
          await stops.beforeRows?.();
          await reresolutionStore.recordEvents(inner, events);
        },
      },
      lengthsOf: sessionLengthsOf,
      pageSize: 100_000,
      clock: clockTimestamp,
    });
  }, OPTIONS);
}

/** The evaluation as the job builds it, its transactions' backends recorded. */
function evaluation(stops: { readonly afterSettle?: () => Promise<void> } = {}) {
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
  const enrollments = createEnrollmentSide({ settings });
  return {
    pids,
    sweep: createEvaluation({
      transactions,
      enrollments,
      completion: createCompletion({ enrollments, settings }),
      video: { endRoom: async () => undefined },
      settings,
      log: SILENT,
      pageSize: 200,
      report: () => undefined,
      store,
    }),
  };
}

/** What both transactions left: the session's instants and status, and its rows of each kind. */
async function outcomeOf(sessionId: string) {
  const session = await db.query<{ starts: string; status: string }>(
    `SELECT to_char(scheduled_start_at AT TIME ZONE 'UTC', 'HH24:MI"Z"') AS starts, status::text
       FROM sessions WHERE id = $1::uuid`,
    [sessionId],
  );
  const rows = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
    [sessionId],
  );
  return { ...session.rows[0], rows: rows.rows.map(({ kind }) => kind) };
}

describe('the re-resolution writing a session raced against its evaluation (T014, kernel.md L1)', () => {
  it('the run first: the evaluation waits on the enrollment, and both commit with no deadlock', async () => {
    const { sessionId } = await world();
    const holding = signal();
    const runGate = gate();
    let runPid = 0;
    const run = reresolution({
      began: (pid) => {
        runPid = pid;
      },
      beforeRows: async () => {
        holding.give();
        await runGate.opened;
      },
    });
    const evaluating = evaluation();
    let settling: Promise<unknown> | undefined;
    try {
      await Promise.race([holding.given, run]);
      settling = evaluating.sweep.settleDue();
      await seenWaiting(() => evaluating.pids);
    } finally {
      runGate.open();
    }
    const [ran, settled] = await Promise.allSettled([run, settling]);

    expect(runPid).not.toBe(0);
    expect(ran).toEqual({ status: 'fulfilled', value: { moved: [sessionId], restored: [] } });
    expect(settled).toEqual({ status: 'fulfilled', value: { settled: [sessionId], failed: [] } });
    expect(await outcomeOf(sessionId)).toEqual({
      starts: '07:00Z',
      status: 'both_no_show',
      rows: ['instants_reresolved', 'settled'],
    });
  });

  it('the evaluation first: the run waits on the enrollment, and both commit with no deadlock', async () => {
    const { sessionId } = await world();
    const settledHeld = signal();
    const evaluationGate = gate();
    const evaluating = evaluation({
      afterSettle: async () => {
        settledHeld.give();
        await evaluationGate.opened;
      },
    });
    const settling = evaluating.sweep.settleDue();
    let run: Promise<unknown> | undefined;
    try {
      await Promise.race([settledHeld.given, settling]);
      let runPid = 0;
      run = reresolution({
        began: (pid) => {
          runPid = pid;
        },
      });
      await seenWaiting(() => [runPid]);
    } finally {
      evaluationGate.open();
    }
    const [settled, ran] = await Promise.allSettled([settling, run]);

    expect(settled).toEqual({ status: 'fulfilled', value: { settled: [sessionId], failed: [] } });
    expect(ran).toEqual({ status: 'fulfilled', value: { moved: [], restored: [] } });
    expect(await outcomeOf(sessionId)).toEqual({
      starts: '06:00Z',
      status: 'both_no_show',
      rows: ['settled'],
    });
  });
});
