// T014 of specs/004-sessions/tasks.md (FR-441, FR-446, FR-447, FR-450, FR-482, FR-495; R-SESS-2,
// R-SESS-3, R-SESS-6; research R-306, R-308, R-313, R-323 GAP-7; contracts/kernel.md, "Jobs" and the
// evaluation's row) — `createEvaluation` over a recorded store, enrollment side, completion and
// video port:
//
//   - the sessions due (`evaluated_at` NULL, `scheduled` or `disputed`, the scheduled end plus
//     `session_evaluation_delay_minutes` at or before the database's clock) read a page at a time;
//   - each settled in its own transaction: the enrollment locked, then the session, read again
//     under them, left when already evaluated, no longer `scheduled` or `disputed`, or no longer due
//     (its end moved by a re-resolution); T013's outcome from its events and the outages
//     overlapping it; `status` written, or `outcome_under_dispute` when disputed, with the
//     simultaneous seconds and `evaluated_at`; one `session_events` row `settled`; then T015's
//     completion, the only check; one info line `{ sessionId, outcome }`, and when it completed
//     the enrollment one line «Enrollment completed» `{ enrollmentId }`, both once the session's
//     transaction has committed, so a rolled-back one leaves neither (PR #129's review, Minor 3);
//   - a session that fails is logged by its id and reported, and the run goes on;
//   - the room of every cancelled session in its join period with no `room_ended` row is ended
//     through `endRoom`, one info line `video room ended` with exactly `{ sessionId }`; a failed
//     call one warn line `{ sessionId, reason }`, reported, and the run goes on;
//   - T067 (FR-501; SRS FR-SESS-21; the note under T067, Q5 to Q8): the room of every session due a
//     close (its scheduled end plus `room_close_grace_minutes` at or before the database's clock, and
//     that plus `room_close_retry_minutes` after it), read a page at a time, ended through `endRoom`
//     with one info line `video room ended` of exactly `{ sessionId, reason: 'scheduled_end' }`; a
//     failed call one warn line `video room not ended` `{ sessionId, reason: 'end_room_failed' }`,
//     reported, and the run goes on; the step's own failure (a missing setting, a failed read) one
//     error line with no id and one report, never thrown.
//
// Over the real tables, through T010's harness: `tests/sessions/evaluate-sessions.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { AttendanceEvent } from './attendance.rules.js';
import {
  createEvaluation,
  type EvaluationStore,
  type SessionToSettle,
  type Settlement,
} from './evaluation.service.js';
import type { SessionEventRecord } from './session-events.repository.js';

const TX = {} as Transaction;
/** The database's clock at the run. */
const AT = new Date('2026-11-08T10:00:00Z');
const DELAY_MINUTES = 2;
const LEAD_MINUTES = 15;
/** Not the default 0, so the close's arithmetic shows (T067). */
const GRACE_MINUTES = 5;
const RETRY_MINUTES = 10;
const START = new Date('2026-11-08T08:00:00Z');
const END = new Date('2026-11-08T09:00:00Z');
const TEACHER = 'teacher-1';
const STUDENT = 'student-1';

const SETTINGS: Readonly<Record<string, number>> = {
  session_evaluation_delay_minutes: DELAY_MINUTES,
  join_window_minutes: 10,
  minimum_connection_seconds: 60,
  attendance_threshold_pct: 70,
  early_join_lead_minutes: LEAD_MINUTES,
  room_close_grace_minutes: GRACE_MINUTES,
  room_close_retry_minutes: RETRY_MINUTES,
};

/** The settings reader, failing closed as the real one does on each key in `missing`. */
function settingsWithout(missing: readonly string[] = []): SettingsReader {
  return {
    read: async (key, schema) => {
      if (missing.includes(key)) throw new SettingError(key, 'missing');
      if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
      return schema.parse(SETTINGS[key]);
    },
  };
}

/** A session as the store holds it: due, scheduled, unevaluated. */
function session(id: string, values: Partial<SessionToSettle> = {}): SessionToSettle {
  return {
    id,
    enrollmentId: `enrollment-${id}`,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    scheduledStartAt: START,
    scheduledEndAt: END,
    status: 'scheduled',
    evaluatedAt: null,
    ...values,
  };
}

/** Both participants connected from the start to the end. */
const BOTH_THROUGHOUT: readonly AttendanceEvent[] = [
  { kind: 'joined', userId: TEACHER, connectionRef: 't1', occurredAt: START },
  { kind: 'joined', userId: STUDENT, connectionRef: 's1', occurredAt: START },
  { kind: 'left', userId: TEACHER, connectionRef: 't1', occurredAt: END },
  { kind: 'left', userId: STUDENT, connectionRef: 's1', occurredAt: END },
];

interface World {
  readonly calls: string[];
  readonly settlements: Settlement[];
  readonly events: SessionEventRecord[];
  readonly lines: { level: string; fields: Record<string, unknown>; message: string }[];
  readonly reported: Error[];
  readonly ended: string[];
  readonly store: EvaluationStore;
}

function worldOf({
  sessions = [session('a')],
  attendance = {},
  outages = [],
  underLock = {},
  settles = true,
  failing = [],
  cancelled = [],
  failingRooms = [],
  page = 10,
  completes = false,
  commitRefused = false,
  dueCloses = [],
  closeReadFails = false,
  missingSettings = [],
}: {
  sessions?: SessionToSettle[];
  attendance?: Readonly<Record<string, readonly AttendanceEvent[]>>;
  outages?: { startsAt: Date; endsAt: Date }[];
  /** What another transaction committed before the locks were granted, by id. */
  underLock?: Readonly<Record<string, Partial<SessionToSettle>>>;
  settles?: boolean;
  failing?: string[];
  cancelled?: string[];
  failingRooms?: string[];
  page?: number;
  /** What completion answers: whether it completed the enrollment. */
  completes?: boolean;
  /** The commit of a transaction that checked completion is refused, so it rolls back. */
  commitRefused?: boolean;
  /** The sessions due a close (T067), by id; each page answers them in id order. */
  dueCloses?: string[];
  /** The read of the sessions due a close throws. */
  closeReadFails?: boolean;
  /** The settings the reader does not hold. */
  missingSettings?: string[];
} = {}) {
  let refuseCommit = false;
  const transactions: Transactions = {
    run: async (work) => {
      const result = await work(TX);
      if (refuseCommit) {
        refuseCommit = false;
        throw new Error('commit refused');
      }
      return result;
    },
  };
  const calls: string[] = [];
  const settlements: Settlement[] = [];
  const events: SessionEventRecord[] = [];
  const lines: World['lines'] = [];
  const reported: Error[] = [];
  const ended: string[] = [];
  const store: EvaluationStore = {
    async dueForEvaluation(_tx, dueBy, after, limit) {
      calls.push(`due ${dueBy.toISOString()} ${after ?? '-'} ${String(limit)}`);
      return sessions
        .filter((one) => after === undefined || one.id > after)
        .toSorted((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map(({ id, enrollmentId }) => ({ id, enrollmentId }));
    },
    async lockSessions(_tx, ids) {
      calls.push(`lockSessions ${ids.join(',')}`);
    },
    async sessionToSettle(_tx, id) {
      calls.push(`read ${id}`);
      if (failing.includes(id)) throw new Error(`read of ${id} failed`);
      const found = sessions.find((one) => one.id === id);
      return found === undefined ? null : { ...found, ...underLock[id] };
    },
    async attendanceEventsOf(_tx, sessionId) {
      calls.push(`events ${sessionId}`);
      return attendance[sessionId] ?? [];
    },
    async outagesOverlapping(_tx, window) {
      calls.push(`outages ${window.startsAt.toISOString()} ${window.endsAt.toISOString()}`);
      return outages;
    },
    async settle(_tx, settlement) {
      calls.push(`settle ${settlement.id}`);
      settlements.push(settlement);
      return settles;
    },
    async recordEvents(_tx, recorded) {
      calls.push('recordEvents');
      events.push(...recorded);
    },
    async cancelledInJoinPeriod(_tx, at, joinOpensBy) {
      calls.push(`cancelled ${at.toISOString()} ${joinOpensBy.toISOString()}`);
      return cancelled;
    },
    async dueRoomCloses(_tx, endedBy, endedAfter, after, limit) {
      calls.push(
        `closes ${endedBy.toISOString()} ${endedAfter.toISOString()} ${after ?? '-'} ${String(limit)}`,
      );
      if (closeReadFails) throw new Error('read of the closes failed');
      const read = dueCloses
        .filter((id) => after === undefined || id > after)
        .toSorted()
        .slice(0, limit);
      return { due: read, next: read.length < limit ? undefined : read.at(-1) };
    },
  };
  const evaluation = createEvaluation({
    transactions,
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        calls.push(`lockEnrollments ${ids.join(',')}`);
      },
    },
    completion: {
      completeIfDue: async (_tx, enrollmentId) => {
        calls.push(`complete ${enrollmentId}`);
        refuseCommit = commitRefused;
        return completes;
      },
    },
    video: {
      endRoom: async (sessionId) => {
        calls.push(`endRoom ${sessionId}`);
        if (failingRooms.includes(sessionId)) throw new Error('provider unreachable');
        ended.push(sessionId);
      },
    },
    settings: settingsWithout(missingSettings),
    log: {
      info: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: 'info', fields, message }),
      warn: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: 'warn', fields, message }),
      error: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: 'error', fields, message }),
    } as unknown as Parameters<typeof createEvaluation>[0]['log'],
    report: (error) => void reported.push(error),
    clock: async () => AT,
    pageSize: page,
    store,
  });
  return { evaluation, calls, settlements, events, lines, reported, ended };
}

describe('settleDue: the sessions due, each settled in its own transaction (R-306, R-SESS-2)', () => {
  it('locks the enrollment, then the session, reads it again, and writes the outcome, its row and the completion check, in that order', async () => {
    const world = worldOf({ attendance: { a: BOTH_THROUGHOUT } });

    await world.evaluation.settleDue();

    expect(world.calls).toEqual([
      `due 2026-11-08T09:58:00.000Z - 10`,
      'lockEnrollments enrollment-a',
      'lockSessions a',
      'read a',
      'events a',
      `outages ${START.toISOString()} ${END.toISOString()}`,
      'settle a',
      'recordEvents',
      'complete enrollment-a',
    ]);
    expect(world.settlements).toEqual([
      { id: 'a', from: 'scheduled', outcome: 'done', simultaneousSeconds: 3600, evaluatedAt: AT },
    ]);
    expect(world.events).toEqual([
      { enrollmentId: 'enrollment-a', sessionId: 'a', kind: 'settled', occurredAt: AT },
    ]);
    expect(world.lines).toEqual([
      { level: 'info', fields: { sessionId: 'a', outcome: 'done' }, message: 'Session settled' },
    ]);
  });

  it('a session nobody joined: both_no_show, no simultaneous time', async () => {
    const world = worldOf();

    await world.evaluation.settleDue();

    expect(world.settlements).toEqual([
      {
        id: 'a',
        from: 'scheduled',
        outcome: 'both_no_show',
        simultaneousSeconds: 0,
        evaluatedAt: AT,
      },
    ]);
  });

  it('an outage overlapping the session decides it first: provider_outage', async () => {
    const world = worldOf({
      attendance: { a: BOTH_THROUGHOUT },
      outages: [{ startsAt: new Date('2026-11-08T08:30:00Z'), endsAt: AT }],
    });

    await world.evaluation.settleDue();

    expect(world.settlements.map(({ outcome }) => outcome)).toEqual(['provider_outage']);
  });

  it('a disputed session not yet evaluated: the outcome goes to outcome_under_dispute (R-308), the row and the check as usual', async () => {
    const world = worldOf({
      sessions: [session('a', { status: 'disputed' })],
      attendance: { a: BOTH_THROUGHOUT },
    });

    await world.evaluation.settleDue();

    expect(world.settlements).toEqual([
      { id: 'a', from: 'disputed', outcome: 'done', simultaneousSeconds: 3600, evaluatedAt: AT },
    ]);
    expect(world.events.map(({ kind }) => kind)).toEqual(['settled']);
    expect(world.calls.at(-1)).toBe('complete enrollment-a');
    expect(world.lines).toEqual([
      {
        level: 'info',
        fields: { sessionId: 'a', outcome: 'done' },
        message: 'Session evaluated under dispute',
      },
    ]);
  });

  it.each([
    ['already evaluated by another run', { evaluatedAt: AT }],
    ['cancelled meanwhile', { status: 'cancelled_by_admin' as const }],
    ['settled under review', { status: 'under_threshold' as const }],
    // A re-resolution committed before the locks moved its end later: never before end + delay.
    ['no longer due, its end moved', { scheduledEndAt: new Date('2026-11-08T09:58:01Z') }],
  ])('read again under the locks and %s: nothing written, no check', async (_case, underLock) => {
    const world = worldOf({ underLock: { a: underLock } });

    await world.evaluation.settleDue();

    expect(world.calls).toEqual([
      `due 2026-11-08T09:58:00.000Z - 10`,
      'lockEnrollments enrollment-a',
      'lockSessions a',
      'read a',
    ]);
    expect(world.lines).toEqual([]);
  });

  it('a session the conditional update did not move: no row, no check', async () => {
    const world = worldOf({ settles: false });

    await world.evaluation.settleDue();

    expect(world.events).toEqual([]);
    expect(world.calls).not.toContain('complete enrollment-a');
    expect(world.lines).toEqual([]);
  });

  it('due at its end plus the delay exactly: settled', async () => {
    const world = worldOf({
      sessions: [session('a', { scheduledEndAt: new Date('2026-11-08T09:58:00Z') })],
    });

    await world.evaluation.settleDue();

    expect(world.settlements.map(({ id }) => id)).toEqual(['a']);
  });

  it('reads the due sessions a page at a time after the last id, until a short page', async () => {
    const world = worldOf({ sessions: ['a', 'b', 'c'].map((id) => session(id)), page: 2 });

    await world.evaluation.settleDue();

    expect(world.calls.filter((call) => call.startsWith('due'))).toEqual([
      'due 2026-11-08T09:58:00.000Z - 2',
      'due 2026-11-08T09:58:00.000Z b 2',
    ]);
    expect(world.settlements.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('a completion: one line «Enrollment completed» of exactly { enrollmentId }, after the session’s, once committed', async () => {
    const world = worldOf({ completes: true });

    await world.evaluation.settleDue();

    expect(world.lines).toEqual([
      { level: 'info', fields: { sessionId: 'a', outcome: 'both_no_show' }, message: 'Session settled' },
      { level: 'info', fields: { enrollmentId: 'enrollment-a' }, message: 'Enrollment completed' },
    ]);
    expect(Object.keys(world.lines[1]?.fields ?? {})).toEqual(['enrollmentId']);
  });

  it('a completion postponed: no completion line', async () => {
    const world = worldOf({ completes: false });

    await world.evaluation.settleDue();

    expect(world.lines.map(({ message }) => message)).toEqual(['Session settled']);
  });

  it('a session whose transaction rolls back after its completion: no completion line, no settled line, the error line', async () => {
    const world = worldOf({ completes: true, commitRefused: true });

    const run = await world.evaluation.settleDue();

    expect(run).toEqual({ settled: [], failed: ['a'] });
    expect(world.lines).toEqual([
      { level: 'error', fields: { sessionId: 'a' }, message: 'Session evaluation failed' },
    ]);
  });

  it('a session that fails is logged by its id alone and reported, and the next one is still settled', async () => {
    const world = worldOf({ sessions: [session('a'), session('b')], failing: ['a'] });

    const run = await world.evaluation.settleDue();

    expect(run).toEqual({ settled: ['b'], failed: ['a'] });
    expect(world.lines[0]).toEqual({
      level: 'error',
      fields: { sessionId: 'a' },
      message: 'Session evaluation failed',
    });
    expect(world.reported.map(({ message }) => message)).toEqual(['read of a failed']);
    expect(world.settlements.map(({ id }) => id)).toEqual(['b']);
  });
});

describe('endCancelledRooms: a cancelled session’s room ended in its join period (FR-482, R-313, K5, K6)', () => {
  it('asks for the cancelled sessions whose join period holds the clock, then ends each room with one line of exactly its id', async () => {
    const world = worldOf({ cancelled: ['x', 'y'] });

    const ended = await world.evaluation.endCancelledRooms();

    expect(ended).toEqual(['x', 'y']);
    expect(world.calls).toEqual([
      // The join period opens the early-join lead before the start: a start at or before AT + lead.
      `cancelled ${AT.toISOString()} 2026-11-08T10:15:00.000Z`,
      'endRoom x',
      'endRoom y',
    ]);
    expect(world.lines).toEqual([
      { level: 'info', fields: { sessionId: 'x' }, message: 'video room ended' },
      { level: 'info', fields: { sessionId: 'y' }, message: 'video room ended' },
    ]);
  });

  it('a call that fails: one warn line of its id and reason, reported, and the next room is still ended', async () => {
    const world = worldOf({ cancelled: ['x', 'y'], failingRooms: ['x'] });

    const ended = await world.evaluation.endCancelledRooms();

    expect(ended).toEqual(['y']);
    expect(world.lines).toEqual([
      {
        level: 'warn',
        fields: { sessionId: 'x', reason: 'end_room_failed' },
        message: 'video room not ended',
      },
      { level: 'info', fields: { sessionId: 'y' }, message: 'video room ended' },
    ]);
    expect(world.reported.map(({ message }) => message)).toEqual(['provider unreachable']);
  });

  it('no cancelled session in its join period: no call', async () => {
    const world = worldOf();

    expect(await world.evaluation.endCancelledRooms()).toEqual([]);
    expect(world.calls.filter((call) => call.startsWith('endRoom'))).toEqual([]);
  });
});

describe('endScheduledRooms: the room ended at the session’s scheduled end (T067, FR-501, SRS FR-SESS-21)', () => {
  it('asks for the sessions whose end plus the grace has passed and whose end plus the grace and the retries has not, then ends each room with one line of exactly its id and reason', async () => {
    const world = worldOf({ dueCloses: ['x', 'y'] });

    const ended = await world.evaluation.endScheduledRooms();

    expect(ended).toEqual(['x', 'y']);
    expect(world.calls).toEqual([
      // Ended at or before AT less the grace, and after that less the retries.
      `closes 2026-11-08T09:55:00.000Z 2026-11-08T09:45:00.000Z - 10`,
      'endRoom x',
      'endRoom y',
    ]);
    expect(world.lines).toEqual([
      {
        level: 'info',
        fields: { sessionId: 'x', reason: 'scheduled_end' },
        message: 'video room ended',
      },
      {
        level: 'info',
        fields: { sessionId: 'y', reason: 'scheduled_end' },
        message: 'video room ended',
      },
    ]);
    expect(Object.keys(world.lines[0]?.fields ?? {})).toEqual(['sessionId', 'reason']);
    expect(world.reported).toEqual([]);
  });

  it('a call that fails: one warn line of exactly its id and reason, reported, and the next room is still ended (Q7, Q8)', async () => {
    const world = worldOf({ dueCloses: ['x', 'y'], failingRooms: ['x'] });

    const ended = await world.evaluation.endScheduledRooms();

    expect(ended).toEqual(['y']);
    expect(world.lines).toEqual([
      {
        level: 'warn',
        fields: { sessionId: 'x', reason: 'end_room_failed' },
        message: 'video room not ended',
      },
      {
        level: 'info',
        fields: { sessionId: 'y', reason: 'scheduled_end' },
        message: 'video room ended',
      },
    ]);
    expect(Object.keys(world.lines[0]?.fields ?? {})).toEqual(['sessionId', 'reason']);
    expect(world.reported.map(({ message }) => message)).toEqual(['provider unreachable']);
  });

  it('reads the sessions due a close a page at a time after the last id, until a page that is not full', async () => {
    const world = worldOf({ dueCloses: ['a', 'b', 'c'], page: 2 });

    const ended = await world.evaluation.endScheduledRooms();

    expect(world.calls.filter((call) => call.startsWith('closes'))).toEqual([
      `closes 2026-11-08T09:55:00.000Z 2026-11-08T09:45:00.000Z - 2`,
      `closes 2026-11-08T09:55:00.000Z 2026-11-08T09:45:00.000Z b 2`,
    ]);
    expect(ended).toEqual(['a', 'b', 'c']);
  });

  it('no session due a close: no call, no line', async () => {
    const world = worldOf();

    expect(await world.evaluation.endScheduledRooms()).toEqual([]);
    expect(world.calls.filter((call) => call.startsWith('endRoom'))).toEqual([]);
    expect(world.lines).toEqual([]);
  });

  it.each([['room_close_grace_minutes'], ['room_close_retry_minutes']])(
    'the setting %s missing: one error line with no id, one report, nothing read, nothing thrown (Q7 (a))',
    async (key) => {
      const world = worldOf({ dueCloses: ['x'], missingSettings: [key] });

      expect(await world.evaluation.endScheduledRooms()).toEqual([]);
      expect(world.calls).toEqual([]);
      expect(world.lines).toEqual([
        { level: 'error', fields: {}, message: 'video room close failed' },
      ]);
      expect(world.reported).toHaveLength(1);
      expect(world.reported[0]).toBeInstanceOf(SettingError);
    },
  );

  it('the read failing: one error line with no id, one report, no call, nothing thrown (Q7 (a))', async () => {
    const world = worldOf({ dueCloses: ['x'], closeReadFails: true });

    expect(await world.evaluation.endScheduledRooms()).toEqual([]);
    expect(world.calls.filter((call) => call.startsWith('endRoom'))).toEqual([]);
    expect(world.lines).toEqual([
      { level: 'error', fields: {}, message: 'video room close failed' },
    ]);
    expect(world.reported.map(({ message }) => message)).toEqual(['read of the closes failed']);
  });
});
