// T028 of specs/004-sessions/tasks.md (FR-462, FR-449; the notes under T028, Q3, Q8, Q11, and its
// follow-up on the sweeps' reads) — `createRemedyAdvance().run` over a recorded store, offer and
// completion: the due sessions read in pages after the run's instant less the dispute window (the
// database's clock), each offered on its own transaction with one line after its commit; a failure
// caught on its own, logged by its id and reported, the run going on; the frozen remedies offered
// again; T015's check over the confirmed enrollments whose sessions all have an outcome, each under
// its enrollment's lock, one line per completion and none for a postponement. The rules of one offer
// are `remedy-offer.service.ts`', shown on Postgres by `tests/db-integrity/remedy-offer.spec.ts`.
import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import type { EnrollmentPage } from './enrollment-side.port.js';
import type { Offered } from './remedy-offer.service.js';
import { createRemedyAdvance, type RemedyAdvanceStore } from './remedy-offer.sweep.js';

const tx = {} as Transaction;
const RUN_AT = new Date('2026-11-20T10:00:00Z');
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

let trace: string[];
let lines: Record<string, unknown>[];
let reported: Error[];
let log: Logger;
let failOn: Set<string>;
let due: string[];
let frozen: string[];
let confirmed: string[];
let settled: Set<string>;
let completes: Set<string>;

const transactions: Transactions = {
  run: async (work) => {
    trace.push('begin');
    try {
      const answer = await work(tx);
      trace.push('commit');
      return answer;
    } catch (error) {
      trace.push('rollback');
      throw error;
    }
  },
};

const store: RemedyAdvanceStore = {
  dueForOffer: async (_tx, endedBy, after, limit) => {
    trace.push(`due ended by ${endedBy.toISOString()} after ${after ?? '-'}`);
    return due
      .filter((sessionId) => after === undefined || sessionId > after)
      .slice(0, limit)
      .map((sessionId) => ({ sessionId }));
  },
  frozenRemedies: async (_tx, after, limit) =>
    frozen
      .filter((remedyId) => after === undefined || remedyId > after)
      .slice(0, limit)
      .map((remedyId) => ({ remedyId, sessionId: `s-${remedyId}`, studentUserId: id(900) })),
  enrollmentsSettledAmong: async (_tx, ids) => ids.filter((one) => settled.has(one)),
};

function offered(sessionId: string, reoffered = false): Offered {
  return {
    remedyId: `r-${sessionId}`,
    sessionId,
    enrollmentId: id(500),
    status: 'proposed',
    proposedDate: '2026-12-03',
    reoffered,
  };
}

function advance() {
  return createRemedyAdvance({
    transactions,
    offer: {
      offer: async (_tx, sessionId) => {
        trace.push(`offer ${sessionId}`);
        if (failOn.has(sessionId)) throw new Error('probe: this offer fails');
        return offered(sessionId, sessionId.startsWith('s-'));
      },
    },
    completion: {
      completeIfDue: async (_tx, enrollmentId) => {
        trace.push(`complete ${enrollmentId}`);
        if (failOn.has(enrollmentId)) throw new Error('probe: this completion fails');
        return completes.has(enrollmentId);
      },
    },
    enrollments: {
      enrollmentPage: async (_tx, filter, cursor, batchSize): Promise<EnrollmentPage> => {
        expect(filter).toEqual({ status: 'confirmed' });
        const rest = confirmed.filter((one) => cursor === undefined || one < cursor);
        const items = rest.slice(0, batchSize).map((enrollmentId) => ({
          enrollmentId,
          studentUserId: id(900),
          teacherUserId: id(901),
          status: 'confirmed' as const,
          track: 'recitation' as const,
          sessionCount: 4,
        }));
        const last = items.at(-1);
        return rest.length > items.length && last !== undefined
          ? { items, nextCursor: last.enrollmentId }
          : { items };
      },
      lockEnrollments: async (_tx, ids) => {
        trace.push(`lock enrollments ${ids.join(',')}`);
      },
    },
    settings: { read: async (_key, schema) => schema.parse(72) },
    log,
    pageSize: 2,
    report: (error) => reported.push(error),
    clock: async () => RUN_AT,
    store,
  });
}

/** The log lines without the logger's own fields. */
const written = () =>
  lines.map(({ level, msg, time: _time, pid: _pid, hostname: _host, ...fields }) => ({
    level,
    msg,
    ...fields,
  }));

beforeEach(() => {
  trace = [];
  lines = [];
  reported = [];
  failOn = new Set();
  due = [];
  frozen = [];
  confirmed = [];
  settled = new Set();
  completes = new Set();
  log = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
        done();
      },
    }),
  });
});

describe('advance-remedies: the offers (T028, FR-462, Q8, Q11)', () => {
  it('reads the due sessions in pages, ended by the run’s instant less the dispute window, each offered on its own transaction', async () => {
    due = [id(1), id(2), id(3)];
    const run = await advance().run();
    expect(run.offered).toEqual([`r-${id(1)}`, `r-${id(2)}`, `r-${id(3)}`]);
    expect(trace.filter((step) => step.startsWith('due'))).toEqual([
      'due ended by 2026-11-17T10:00:00.000Z after -',
      `due ended by 2026-11-17T10:00:00.000Z after ${id(2)}`,
    ]);
    expect(trace.filter((step) => step === 'begin').length).toBeGreaterThanOrEqual(3 + 2);
  });

  it('writes one info line per offer after its commit, ids and the action only', async () => {
    due = [id(1)];
    await advance().run();
    expect(written()).toEqual([
      {
        level: 'info',
        msg: 'Remedy offered',
        remedyId: `r-${id(1)}`,
        sessionId: id(1),
        enrollmentId: id(500),
        action: 'offered',
      },
    ]);
    const offerAt = trace.indexOf(`offer ${id(1)}`);
    expect(trace[offerAt + 1]).toBe('commit');
  });

  it('catches one offer’s failure on its own: rolled back, logged by its id, reported, and the next still offered', async () => {
    due = [id(1), id(2)];
    failOn = new Set([id(1)]);
    const run = await advance().run();
    expect(run.failed).toEqual([id(1)]);
    expect(run.offered).toEqual([`r-${id(2)}`]);
    expect(reported.map(({ message }) => message)).toEqual(['probe: this offer fails']);
    expect(written().filter(({ level }) => level === 'error')).toEqual([
      { level: 'error', msg: 'Remedy offer failed', sessionId: id(1) },
    ]);
    expect(trace[trace.indexOf(`offer ${id(1)}`) + 1]).toBe('rollback');
  });

  it('offers each frozen remedy again, as a re-offer', async () => {
    frozen = [id(7)];
    const run = await advance().run();
    expect(run.reoffered).toEqual([`r-s-${id(7)}`]);
    expect(written()[0]).toMatchObject({ msg: 'Remedy offered', action: 'reoffered' });
  });
});

describe('advance-remedies: T015’s completion check (FR-449, Q3 (a))', () => {
  it('checks each confirmed enrollment whose sessions all have an outcome, under its enrollment’s lock, one line per completion', async () => {
    confirmed = [id(30), id(20), id(10)];
    settled = new Set([id(30), id(10)]);
    completes = new Set([id(30)]);
    const run = await advance().run();
    expect(run.completed).toEqual([id(30)]);
    expect(trace.filter((step) => step.startsWith('lock') || step.startsWith('complete'))).toEqual([
      `lock enrollments ${id(30)}`,
      `complete ${id(30)}`,
      `lock enrollments ${id(10)}`,
      `complete ${id(10)}`,
    ]);
    expect(written()).toEqual([
      { level: 'info', msg: 'Enrollment completed', enrollmentId: id(30) },
    ]);
  });

  it('catches one completion’s failure on its own, logged by its id and reported', async () => {
    confirmed = [id(20), id(10)];
    settled = new Set([id(20), id(10)]);
    completes = new Set([id(10)]);
    failOn = new Set([id(20)]);
    const run = await advance().run();
    expect(run.failed).toEqual([id(20)]);
    expect(run.completed).toEqual([id(10)]);
    expect(written().filter(({ level }) => level === 'error')).toEqual([
      { level: 'error', msg: 'Enrollment completion failed', enrollmentId: id(20) },
    ]);
  });
});
