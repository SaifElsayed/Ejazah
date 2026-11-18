// B38's race probes the conflict check gives lane C (P4, P5, P7), over the real tables as the
// application role (contracts/kernel.md's rows; `003:T005`'s rules; T031, T032):
//
//   - P4: the student's `sessions.remedy.accept` (T031 → T029) against the sweep's H5 booking at C
//     (`advance-remedies`' choice window's end, T032): both take «make-up booking»'s locks; one
//     booking, the other answering `REMEDY_NOT_OPEN` or leaving the remedy as it is, no deadlock.
//   - P5: the teacher's `sessions.remedy.answerCounter` (a decline) a millisecond before
//     `answerClosesAt` against the sweep's release of the unanswered counter at it, then its booking
//     of the proposal (T111 of specs/003-booking, DEC-84; no `counter_unanswered` case any more):
//     one outcome, the declined counter or the booked proposal, never both, no deadlock.
//   - P7: the teacher's acceptance of a counter on the teacher's Monday slot (T032 → T029) against
//     another student's `checkout.hold` on that slot, whose first session falls on the counter: one
//     of them, the make-up booked and the hold refused in both orders (the pending counter is a
//     reservation the hold reads, T027), no deadlock.
//
// HOW EACH RACE IS STAGED, as `cancellation-races.spec.ts` stages its own (PR #131's review, round 1,
// Major 1), the order the database's: the first path's transaction stops on a gate either just after
// its first lock (the accounts, which both paths take), before its next, or before its commit, its
// work done; the second is seen waiting on a lock in `pg_stat_activity`; the gate opens. Both orders,
// both stagings. The paths are the ones `main.ts` and `worker.ts` build, their locks and
// transactions wrapped only to stop.
//
// Committed rows, each probe a world of its own.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createEnrollmentSide,
  holdsStore,
  placeHold,
} from '../../apps/api/src/modules/booking/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createRemedyWindows,
  createSessionsServices,
  type RemedyStore,
  remedyStore,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addDays, addHours, addMinutes } from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const SETTINGS: Record<string, number> = {
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
/**
 * The warn lines the paths wrote. A deadlock T002's `runRetryingDeadlockOnce` retried away still
 * writes its «Transaction deadlocked» line, so a race that ends well after a deadlock is caught.
 */
const warned: string[] = [];
const SILENT = {
  info: () => undefined,
  warn: (_fields: unknown, message: string) => {
    warned.push(message);
  },
  error: () => undefined,
} as unknown as Logger;
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };
/** The fixed worlds' choice window closes (P4, P5): offered 2026-11-01T08:00Z. */
const C = new Date('2026-11-08T08:00:00.000Z');

type Path = 'student' | 'teacher' | 'sweep' | 'hold';

/** Where a path's deciding transaction stops, when a probe asks it to. */
interface Stops {
  /** Its backend, as it takes its first lock. */
  began?: (pid: number) => void;
  /** Just after its first lock (the accounts), holding it, before its next. */
  locked?: () => Promise<void>;
  /** After its work, holding its locks, before it commits. */
  beforeCommit?: () => Promise<void>;
}

let stops: Record<Path, Stops> = { student: {}, teacher: {}, sweep: {}, hold: {} };
/** The transactions that took a path's first lock: only those stop before their commit. */
const deciding = new WeakSet<object>();

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
};

/** The accounts' lock as `path` takes it: told, taken, then the stop the probe set after it. */
async function stoppingAt(path: Path, tx: Transaction, take: () => Promise<void>): Promise<void> {
  deciding.add(tx);
  stops[path].began?.(await pidOf(tx));
  await take();
  await stops[path].locked?.();
}

/** The process's transactions, a deciding one stopping before its commit where asked. */
function stoppable(path: Path): Transactions {
  return {
    run: (work) =>
      database.$transaction(async (tx) => {
        const value = await work(tx);
        if (deciding.has(tx)) await stops[path].beforeCommit?.();
        return value;
      }, OPTIONS),
  };
}

/** The remedy store `path` locks through, its accounts' lock stopping. */
const storeOf = (path: Path): RemedyStore => ({
  ...remedyStore,
  lockAccounts: (tx, ids) => stoppingAt(path, tx, () => remedyStore.lockAccounts(tx, ids)),
});

/** The sessions services as `main.ts` builds them, for one path at a fixed clock. */
function servicesFor(path: Path, at: Date): SessionsServices {
  return createSessionsServices({
    notifications: NO_PUSH,
    transactions: stoppable(path),
    settings,
    video: {} as never,
    enrollmentSide: createEnrollmentSide({ settings, now: () => at }),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    clock: async () => at,
    remedyStore: storeOf(path),
  });
}

/** The sweep's windows' ends as `worker.ts` builds them, at a fixed clock. */
const windowsAt = (at: Date) =>
  createRemedyWindows({
    transactions: stoppable('sweep'),
    enrollments: createEnrollmentSide({ settings, now: () => at }),
    log: SILENT,
    report: () => undefined,
    clock: async () => at,
    store: storeOf('sweep'),
  });

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

function signal<T>(): { readonly give: (value: T) => void; readonly given: Promise<T> } {
  let give = (_value: T): void => undefined;
  const given = new Promise<T>((resolve) => {
    give = resolve;
  });
  return { give, given };
}

/** Where a race holds its first path. */
interface Staging {
  readonly name: string;
  readonly hold: (path: Path) => { readonly held: Promise<void>; readonly release: () => void };
}

const STAGINGS: readonly Staging[] = [
  {
    name: 'between its locks',
    hold: (path) => {
      const held = signal<void>();
      const opened = signal<void>();
      stops[path] = {
        locked: async () => {
          held.give();
          await opened.given;
        },
      };
      return { held: held.given, release: () => opened.give() };
    },
  },
  {
    name: 'before its commit',
    hold: (path) => {
      const held = signal<void>();
      const opened = signal<void>();
      stops[path] = {
        beforeCommit: async () => {
          held.give();
          await opened.given;
        },
      };
      return { held: held.given, release: () => opened.give() };
    },
  },
];

/** Runs `first` to its stop, then `second` until it is seen waiting, then lets both end. */
async function race(
  staging: Staging,
  first: { readonly path: Path; readonly run: () => Promise<unknown> },
  second: { readonly path: Path; readonly run: () => Promise<unknown> },
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  warned.length = 0;
  const hold = staging.hold(first.path);
  const firstRun = first.run();
  let secondRun: Promise<unknown> | undefined;
  try {
    await Promise.race([hold.held, firstRun]);
    const began = signal<number>();
    stops[second.path] = { began: began.give };
    secondRun = second.run();
    await seenWaiting(
      await Promise.race([
        began.given,
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
  stops = { student: {}, teacher: {}, sweep: {}, hold: {} };
  for (const outcome of settled) {
    if (outcome.status === 'rejected') expect(isDeadlock(outcome.reason)).toBe(false);
  }
  expect(warned.filter((message) => message === 'Transaction deadlocked')).toEqual([]);
  return settled as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>];
}

/** The refusal's code, or `answered` with the value when the call was not refused. */
function outcomeOf(result: PromiseSettledResult<unknown>): unknown {
  if (result.status === 'fulfilled') return result.value;
  if (result.reason instanceof DomainError) return result.reason.code;
  throw result.reason;
}

/**
 * A teacher (approved, visible) with a Sunday 09:00 Cairo slot (the enrollment's) and a Monday
 * 18:00 slot, a student, their confirmed enrollment, its Teacher-No-Show of 2026-10-11 and its
 * remedy (the proposal on `proposed_date` at the Sunday slot's start).
 */
async function world(remedy: Readonly<Record<string, unknown>> = {}) {
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
  const studentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
  });
  const mondaySlotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: offer.teacherId,
    day_of_week: 1,
    start_time_local: '18:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-10-11',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: '2026-10-11T06:00:00Z',
    scheduled_end_at: '2026-10-11T07:00:00Z',
    status: 'teacher_no_show',
  });
  const remedyId = await insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status: 'proposed',
    offered_at: '2026-11-01T08:00:00Z',
    choice_closes_at: C.toISOString(),
    snapshot_answer_window_hours: 72,
    snapshot_first_session_lead_hours: 24,
    proposed_date: '2026-11-15',
    ...remedy,
  });
  return { offer, studentId, teacherId: offer.teacherId, sessionId, remedyId, mondaySlotId };
}

type World = Awaited<ReturnType<typeof world>>;

/** The student's counter on the Monday slot's first option at `at`; answers its start. */
async function countered(w: World, at: Date): Promise<string> {
  const student = servicesFor('student', at);
  const { options } = await student.remedy.counterOptions(
    { userId: w.studentId },
    { sessionId: w.sessionId },
    SILENT,
  );
  const monday = options.find(({ slotId }) => slotId === w.mondaySlotId);
  if (monday === undefined) throw new Error('probe: the Monday slot offers no time');
  await student.remedy.counter(
    { userId: w.studentId },
    {
      sessionId: w.sessionId,
      slotId: w.mondaySlotId,
      localDate: monday.localDate,
      idempotencyKey: `probe-${randomUUID()}`,
    },
    SILENT,
  );
  return monday.startsAt;
}

/** What the paths left: the remedy, its events, its make-ups and the enrollment's cases. */
async function left(w: World) {
  const remedy = await db.query<{ status: string }>(
    'SELECT status::text FROM session_remedies WHERE id = $1::uuid',
    [w.remedyId],
  );
  const events = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
    [w.sessionId],
  );
  const makeups = await db.query<{ starts: Date }>(
    'SELECT scheduled_start_at AS starts FROM sessions WHERE makeup_for_session_id = $1::uuid',
    [w.sessionId],
  );
  const cases = await db.query<{ reason: string }>(
    `SELECT reason FROM disputes
      WHERE enrollment_id = (SELECT enrollment_id FROM sessions WHERE id = $1::uuid)`,
    [w.sessionId],
  );
  return {
    remedy: remedy.rows[0]?.status,
    events: events.rows.map(({ kind }) => kind),
    makeups: makeups.rows.map(({ starts }) => starts.toISOString()),
    cases: cases.rows.map(({ reason }) => reason),
  };
}

describe.each(STAGINGS)(
  "P4: the student's accept against the sweep's H5 booking at C (T031 × T032), the first held $name",
  (staging) => {
    const accept = (w: World) => () =>
      servicesFor('student', C).remedy.accept(
        { userId: w.studentId },
        { sessionId: w.sessionId },
        SILENT,
      );
    const sweep = (w: World) => () => windowsAt(C).bookAtChoiceEnd(w.remedyId);

    it('the accept first: one booking, the sweep then leaves the remedy as it is', async () => {
      const w = await world();
      const [accepted, swept] = await race(
        staging,
        { path: 'student', run: accept(w) },
        { path: 'sweep', run: sweep(w) },
      );
      expect(outcomeOf(accepted)).toMatchObject({ status: 'booked' });
      expect(outcomeOf(swept)).toBe('not_due');
      expect(await left(w)).toEqual({
        remedy: 'booked',
        events: ['makeup_booked'],
        makeups: ['2026-11-15T07:00:00.000Z'],
        cases: [],
      });
    });

    it('the sweep first: one booking, the accept then refused REMEDY_NOT_OPEN', async () => {
      const w = await world();
      const [swept, accepted] = await race(
        staging,
        { path: 'sweep', run: sweep(w) },
        { path: 'student', run: accept(w) },
      );
      expect(outcomeOf(swept)).toBe('booked');
      expect(outcomeOf(accepted)).toBe('REMEDY_NOT_OPEN');
      expect(await left(w)).toEqual({
        remedy: 'booked',
        events: ['makeup_booked'],
        makeups: ['2026-11-15T07:00:00.000Z'],
        cases: [],
      });
    });
  },
);

describe.each(STAGINGS)(
  "P5: the teacher's decline just before answerClosesAt against the sweep's release and booking at it (T032; T111), the first held $name",
  (staging) => {
    /** Counter sent at 2026-11-03T08:00Z: its answer window closes 2026-11-06T08:00Z (A = 72 h). */
    const SENT = new Date('2026-11-03T08:00:00.000Z');
    const CLOSES = new Date('2026-11-06T08:00:00.000Z');
    const decline = (w: World) => () =>
      servicesFor('teacher', new Date(addMinutes(CLOSES, -1))).remedy.answerCounter(
        { userId: w.teacherId },
        { sessionId: w.sessionId, accept: false },
        SILENT,
      );
    const sweep = (w: World) => () => windowsAt(CLOSES).endAnswerWindow(w.remedyId);

    it('the decline first: the counter declined, the sweep then leaves the remedy, no case', async () => {
      const w = await world();
      await countered(w, SENT);
      const [declined, swept] = await race(
        staging,
        { path: 'teacher', run: decline(w) },
        { path: 'sweep', run: sweep(w) },
      );
      expect(outcomeOf(declined)).toMatchObject({ status: 'proposed' });
      expect(outcomeOf(swept)).toBe('not_due');
      expect(await left(w)).toEqual({
        remedy: 'proposed',
        events: ['counter_proposed', 'counter_declined'],
        makeups: [],
        cases: [],
      });
    });

    // T111 (DEC-84): the sweep's release commits first, the decline then finds no counter, and the
    // sweep's booking of the proposal follows in its own transaction; no case.
    it('the sweep first: the counter released and the proposal booked, the decline then refused REMEDY_NOT_OPEN, no case (T111)', async () => {
      const w = await world();
      await countered(w, SENT);
      const [swept, declined] = await race(
        staging,
        { path: 'sweep', run: sweep(w) },
        { path: 'teacher', run: decline(w) },
      );
      expect(outcomeOf(swept)).toBe('booked');
      expect(outcomeOf(declined)).toBe('REMEDY_NOT_OPEN');
      expect(await left(w)).toEqual({
        remedy: 'booked',
        events: ['counter_proposed', 'makeup_booked'],
        makeups: ['2026-11-15T07:00:00.000Z'],
        cases: [],
      });
    });
  },
);

describe.each(STAGINGS)(
  "P7: a make-up booked on a counter's slot against another student's hold on that slot (T032 × checkout.hold), the first held $name",
  (staging) => {
    /**
     * At the database's own clock R (the hold reads the counter's reservation at it, T027): the
     * remedy's choice window open until R + 1 day, the student's counter on the Monday slot's first
     * option at or after R + A + L, accepted an hour later; the other student's hold placed so its
     * first session falls on the counter's time.
     */
    async function racing() {
      const now = new Date();
      const w = await world({
        offered_at: new Date(addDays(now, -1)).toISOString(),
        choice_closes_at: new Date(addDays(now, 1)).toISOString(),
        proposed_date: '2040-01-01',
      });
      const counterStarts = new Date(await countered(w, now));
      const other = await makeUser(db);
      const holdAt = new Date(addHours(counterStarts, -25));
      const placing = {
        ...holdsStore,
        lockRows: async (
          tx: Transaction,
          table: Parameters<typeof holdsStore.lockRows>[1],
          ids: readonly string[],
        ) => {
          if (table !== 'users') return holdsStore.lockRows(tx, table, ids);
          return stoppingAt('hold', tx, () => holdsStore.lockRows(tx, table, ids));
        },
      };
      const hold = () =>
        stoppable('hold').run((tx) =>
          placeHold(
            tx,
            { userId: other, gender: 'male' as RequesterGender },
            { packageId: w.offer.packageId, slotId: w.mondaySlotId },
            {
              notices: NO_PUSH,
              terms: {
                now: holdAt,
                ttlMinutes: 10,
                graceMinutes: 5,
                leadHours: 24,
                bufferWeeks: async () => 0,
                windowDays: async () => 14, // T070 (rule d)
              },
              orders: orderStandingsOf,
              store: placing,
            },
          ),
        );
      const acceptCounter = () =>
        servicesFor('teacher', new Date(addHours(now, 1))).remedy.answerCounter(
          { userId: w.teacherId },
          { sessionId: w.sessionId, accept: true },
          SILENT,
        );
      const holdsOf = async () =>
        (
          await db.query<{ id: string }>(
            'SELECT id FROM slot_holds WHERE student_user_id = $1::uuid AND released_at IS NULL',
            [other],
          )
        ).rows;
      return { w, counterStarts, hold, acceptCounter, holdsOf };
    }

    // A hold the reservation refuses never reaches its commit, so it is held first between its
    // locks only.
    it.each(
      staging.name === 'before its commit'
        ? (['the booking'] as const)
        : (['the booking', 'the hold'] as const),
    )(
      '%s first: no deadlock, the counter booked and the hold refused, never both on the time',
      async (which) => {
        const { w, counterStarts, hold, acceptCounter, holdsOf } = await racing();
        const booking = { path: 'teacher' as const, run: acceptCounter };
        const holding = { path: 'hold' as const, run: hold };
        const [booked, held] =
          which === 'the booking'
            ? await race(staging, booking, holding)
            : (await race(staging, holding, booking)).toReversed();
        expect(outcomeOf(booked as PromiseSettledResult<unknown>)).toMatchObject({
          status: 'booked',
        });
        expect((held as PromiseSettledResult<unknown>).status).toBe('rejected');
        expect(await holdsOf()).toEqual([]);
        expect(await left(w)).toMatchObject({
          remedy: 'booked',
          makeups: [counterStarts.toISOString()],
        });
      },
    );
  },
);
