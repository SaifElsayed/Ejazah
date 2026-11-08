// T004 of specs/004-sessions/tasks.md — the queries of an enrollment's end, over a recorded client.
// What a unit spec can show: an empty list sends no statement at all, and a list sends one statement
// on the caller's transaction, conditional on the state the service read under its locks (a session
// still `scheduled`, a remedy still open). The same queries over the real tables are
// `tests/db-integrity/termination.spec.ts`'s. Added after PR #127's CI (the follow-up under T004):
// the pipeline's coverage step leaves the db-integrity specs out, so these branches ran in none of
// its specs.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  cancelByAdmin,
  freezableRemediesOf,
  freeze,
  handToCase,
  lapse,
  openRemediesOf,
  scheduledSessionsOf,
} from './remaining-sessions.repository.js';

// The open statuses written out, not read from `OPEN_REMEDY_STATUSES`, so a list that drops one
// (`frozen`, data-model.md §3, F1) fails here (PR #127's review, round 3, Minor; the note under T005).
const OPEN = ['awaiting_choice', 'proposed', 'counter_proposed', 'frozen'];
// What a student's suspension freezes: the open remedies not yet frozen (R-311, "Frozen"; T005).
const FREEZABLE = ['awaiting_choice', 'proposed', 'counter_proposed'];

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-07T10:00:00Z');
const NO_COUNTER = {
  counterSlotId: null,
  counterDate: null,
  counterStartTimeLocal: null,
  counterTimezone: null,
  counterProposedAt: null,
};

/** A client any use of which fails the spec: an empty list must send nothing. */
const untouched = new Proxy({} as Transaction, {
  get: (_target, property) => {
    throw new Error(`the client was used: ${String(property)}`);
  },
});

/** A client that records each call and answers `rows` to a read. */
function recorded(rows: unknown[] = []) {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const model = (name: string) => ({
    findMany: async (args: unknown) => {
      calls.push({ model: name, method: 'findMany', args });
      return rows;
    },
    updateMany: async (args: unknown) => {
      calls.push({ model: name, method: 'updateMany', args });
      return { count: 0 };
    },
  });
  const tx = { session: model('session'), sessionRemedy: model('sessionRemedy') };
  return { calls, tx: tx as unknown as Transaction };
}

describe('the queries of an enrollment’s end (T004)', () => {
  it('sends no statement for an empty list', async () => {
    await expect(scheduledSessionsOf(untouched, [])).resolves.toEqual([]);
    await expect(cancelByAdmin(untouched, [])).resolves.toBeUndefined();
    await expect(openRemediesOf(untouched, [])).resolves.toEqual([]);
    await expect(handToCase(untouched, [], id(31), AT)).resolves.toBeUndefined();
    await expect(lapse(untouched, [], AT)).resolves.toBeUndefined();
    await expect(freezableRemediesOf(untouched, [])).resolves.toEqual([]);
    await expect(freeze(untouched, [])).resolves.toBeUndefined();
  });

  it('scheduledSessionsOf reads the scheduled sessions of the enrollments, in id order', async () => {
    const rows = [{ id: id(11), enrollmentId: id(1) }];
    const { calls, tx } = recorded(rows);
    await expect(scheduledSessionsOf(tx, [id(1), id(2)])).resolves.toBe(rows);
    expect(calls).toEqual([
      {
        model: 'session',
        method: 'findMany',
        args: {
          where: { enrollmentId: { in: [id(1), id(2)] }, status: 'scheduled' },
          orderBy: { id: 'asc' },
          select: { id: true, enrollmentId: true },
        },
      },
    ]);
  });

  it('cancelByAdmin cancels only those still scheduled, in one statement', async () => {
    const { calls, tx } = recorded();
    await cancelByAdmin(tx, [id(11), id(12)]);
    expect(calls).toEqual([
      {
        model: 'session',
        method: 'updateMany',
        args: {
          where: { id: { in: [id(11), id(12)] }, status: 'scheduled' },
          data: { status: 'cancelled_by_admin' },
        },
      },
    ]);
  });

  it('openRemediesOf reads the open remedies of the enrollments’ live sessions, each with its enrollment', async () => {
    const { calls, tx } = recorded([
      { id: id(21), sessionId: id(11), session: { enrollmentId: id(1) } },
    ]);
    await expect(openRemediesOf(tx, [id(1)])).resolves.toEqual([
      { id: id(21), sessionId: id(11), enrollmentId: id(1) },
    ]);
    expect(calls).toEqual([
      {
        model: 'sessionRemedy',
        method: 'findMany',
        args: {
          where: {
            status: { in: OPEN },
            session: { enrollmentId: { in: [id(1)] }, deletedAt: null },
          },
          orderBy: { id: 'asc' },
          select: { id: true, sessionId: true, session: { select: { enrollmentId: true } } },
        },
      },
    ]);
  });

  it('handToCase hands only those still open to the case, the counter-proposal withdrawn (rule 42)', async () => {
    const { calls, tx } = recorded();
    await handToCase(tx, [id(21)], id(31), AT);
    expect(calls).toEqual([
      {
        model: 'sessionRemedy',
        method: 'updateMany',
        args: {
          where: { id: { in: [id(21)] }, status: { in: OPEN } },
          data: { status: 'refund_case', caseId: id(31), decidedAt: AT, ...NO_COUNTER },
        },
      },
    ]);
  });

  it('lapse lapses only those still open, with no case, the counter-proposal withdrawn (rule 42)', async () => {
    const { calls, tx } = recorded();
    await lapse(tx, [id(21), id(22)], AT);
    expect(calls).toEqual([
      {
        model: 'sessionRemedy',
        method: 'updateMany',
        args: {
          where: { id: { in: [id(21), id(22)] }, status: { in: OPEN } },
          data: { status: 'lapsed', decidedAt: AT, ...NO_COUNTER },
        },
      },
    ]);
  });
});

describe('the queries of a student’s suspension (T005, R-311 "Frozen")', () => {
  it('freezableRemediesOf reads the open remedies not yet frozen of the enrollments’ live sessions, each with whether a counter is pending', async () => {
    const { calls, tx } = recorded([
      { id: id(21), sessionId: id(11), status: 'proposed', session: { enrollmentId: id(1) } },
      {
        id: id(22),
        sessionId: id(12),
        status: 'counter_proposed',
        session: { enrollmentId: id(2) },
      },
    ]);
    await expect(freezableRemediesOf(tx, [id(1), id(2)])).resolves.toEqual([
      { id: id(21), sessionId: id(11), enrollmentId: id(1), counterPending: false },
      { id: id(22), sessionId: id(12), enrollmentId: id(2), counterPending: true },
    ]);
    expect(calls).toEqual([
      {
        model: 'sessionRemedy',
        method: 'findMany',
        args: {
          where: {
            status: { in: FREEZABLE },
            session: { enrollmentId: { in: [id(1), id(2)] }, deletedAt: null },
          },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            sessionId: true,
            status: true,
            session: { select: { enrollmentId: true } },
          },
        },
      },
    ]);
  });

  it('freeze writes frozen on those still open and not frozen, the five counter columns cleared and proposed_date left as it is (rule 42)', async () => {
    const { calls, tx } = recorded();
    await freeze(tx, [id(21), id(22)]);
    expect(calls).toEqual([
      {
        model: 'sessionRemedy',
        method: 'updateMany',
        args: {
          where: { id: { in: [id(21), id(22)] }, status: { in: FREEZABLE } },
          data: { status: 'frozen', ...NO_COUNTER },
        },
      },
    ]);
  });
});
