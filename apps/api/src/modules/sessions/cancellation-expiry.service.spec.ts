// T022 of specs/004-sessions — the expiry of cancellation requests as the sweep decides it (FR-458;
// SC-411; research R-310; contracts/kernel.md, the `expire-cancellation-requests` row). Written
// before the service, and run red first.
//
// Over a store that records what it is asked, in order, beside each transaction's begin and
// commit, so the spec reads the row's order: for each pending request whose session has started,
// in its own transaction, the session's enrollment, the session, then the request, read again
// under them (still `pending`, its session started by the database's clock read under the locks),
// before the conditional update to `expired` and the one `cancellation_expired` row. What the
// database writes, the double-run and «no request pending after its start» are
// tests/sessions/expire-cancellation-requests.spec.ts'.
import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import {
  type CancellationExpiry,
  type CancellationExpiryStore,
  createCancellationExpiry,
  type DueRequest,
  type RequestToExpire,
} from './cancellation-expiry.service.js';
import type { SessionEventRecord } from './session-events.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const SESSION_A = '0199d0a0-0000-7000-8000-00000000a001';
const SESSION_B = '0199d0a0-0000-7000-8000-00000000a002';
const REQUEST_A = '0199d0a0-0000-7000-8000-00000000d001';
const REQUEST_B = '0199d0a0-0000-7000-8000-00000000d002';
const STARTS = new Date('2026-11-08T15:00:00.000Z');

let trace: string[];
let requests: Map<string, RequestToExpire>;
let events: SessionEventRecord[];
let failOn: string | undefined;
let underLock: (() => void) | undefined;
let now: Date;
let lines: Record<string, unknown>[];
let reported: Error[];
let log: Logger;
let expiry: CancellationExpiry;

const tx = {} as Transaction;
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

const due = (id: string): DueRequest => {
  const found = requests.get(id);
  if (found === undefined) throw new Error(`no request ${id}`);
  return { id, sessionId: found.sessionId, enrollmentId: found.enrollmentId };
};

const store: CancellationExpiryStore = {
  dueForExpiry: async (_tx, at, after, limit) => {
    trace.push(`read due at ${at.toISOString()} after ${after ?? '-'}`);
    return [...requests.values()]
      .filter(
        ({ id, status, startsAt }) =>
          status === 'pending' && startsAt <= at && (after === undefined || id > after),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(({ id }) => due(id));
  },
  lockSessions: async (_tx, ids) => {
    trace.push(`lock sessions ${ids.join(',')}`);
  },
  lockRequests: async (_tx, ids) => {
    trace.push(`lock requests ${ids.join(',')}`);
    underLock?.();
  },
  requestToExpire: async (_tx, id) => {
    trace.push(`read request ${id}`);
    return requests.get(id) ?? null;
  },
  expire: async (_tx, id) => {
    trace.push(`expire ${id}`);
    if (failOn === id) throw new Error('the database refused the update');
    const found = requests.get(id);
    if (found?.status !== 'pending') return false;
    requests.set(id, { ...found, status: 'expired' });
    return true;
  },
  recordEvents: async (_tx, records) => {
    trace.push(`record ${records.map(({ kind }) => kind).join(',')}`);
    events.push(...records);
  },
};

const enrollments = {
  lockEnrollments: async (_tx: Transaction, ids: readonly string[]) => {
    trace.push(`lock enrollments ${ids.join(',')}`);
  },
};

beforeEach(() => {
  trace = [];
  requests = new Map([
    [
      REQUEST_A,
      {
        id: REQUEST_A,
        sessionId: SESSION_A,
        enrollmentId: ENROLLMENT,
        status: 'pending',
        startsAt: STARTS,
      },
    ],
  ]);
  events = [];
  failOn = undefined;
  underLock = undefined;
  now = STARTS;
  lines = [];
  reported = [];
  log = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
        done();
      },
    }),
  });
  expiry = createCancellationExpiry({
    transactions,
    enrollments,
    log,
    pageSize: 2,
    report: (error) => reported.push(error),
    clock: async () => {
      trace.push('clock');
      return now;
    },
    store,
  });
});

/** The log lines without the logger's own fields. */
const written = () =>
  lines.map(({ level, msg, ...rest }) => {
    const { time: _time, pid: _pid, hostname: _host, ...fields } = rest;
    return { level, msg, ...fields };
  });

describe('expire-cancellation-requests: the expiry (FR-458, SC-411)', () => {
  it('expires a pending request at its session’s start, under kernel.md’s row, with one cancellation_expired row', async () => {
    expect(await expiry.expireStarted()).toEqual({ expired: [REQUEST_A], failed: [] });
    expect(requests.get(REQUEST_A)?.status).toBe('expired');
    expect(events).toEqual([
      {
        enrollmentId: ENROLLMENT,
        sessionId: SESSION_A,
        kind: 'cancellation_expired',
        occurredAt: now,
      },
    ]);
    expect(trace).toEqual([
      'begin',
      'clock',
      'commit',
      'begin',
      `read due at ${STARTS.toISOString()} after -`,
      'commit',
      'begin',
      `lock enrollments ${ENROLLMENT}`,
      `lock sessions ${SESSION_A}`,
      `lock requests ${REQUEST_A}`,
      `read request ${REQUEST_A}`,
      'clock',
      `expire ${REQUEST_A}`,
      'record cancellation_expired',
      'commit',
    ]);
  });

  it('logs each expiry, an automatic action, with its ids only, after its commit', async () => {
    await expiry.expireStarted();
    expect(written()).toEqual([
      {
        level: 'info',
        msg: 'Cancellation request expired',
        requestId: REQUEST_A,
        sessionId: SESSION_A,
      },
    ]);
  });

  it('leaves a request whose session has not started, one millisecond before it', async () => {
    now = new Date('2026-11-08T14:59:59.999Z');
    expect(await expiry.expireStarted()).toEqual({ expired: [], failed: [] });
    expect(requests.get(REQUEST_A)?.status).toBe('pending');
    expect(events).toEqual([]);
  });

  it('leaves a request answered by another transaction committed before the locks, writing nothing', async () => {
    underLock = () => {
      const found = requests.get(REQUEST_A);
      if (found !== undefined) requests.set(REQUEST_A, { ...found, status: 'accepted' });
    };
    expect(await expiry.expireStarted()).toEqual({ expired: [], failed: [] });
    expect(trace).not.toContain(`expire ${REQUEST_A}`);
    expect(events).toEqual([]);
    expect(written()).toEqual([]);
  });

  it('leaves a request whose session a re-resolution moved past the clock, read under the locks', async () => {
    underLock = () => {
      const found = requests.get(REQUEST_A);
      if (found !== undefined) {
        requests.set(REQUEST_A, { ...found, startsAt: new Date('2026-11-08T15:01:00.000Z') });
      }
    };
    expect(await expiry.expireStarted()).toEqual({ expired: [], failed: [] });
    expect(requests.get(REQUEST_A)?.status).toBe('pending');
  });

  it('reads the due requests a page at a time, each on its own transaction', async () => {
    const third = '0199d0a0-0000-7000-8000-00000000d003';
    for (const [id, sessionId] of [
      [REQUEST_B, SESSION_B],
      [third, '0199d0a0-0000-7000-8000-00000000a003'],
    ] as const) {
      requests.set(id, {
        id,
        sessionId,
        enrollmentId: ENROLLMENT,
        status: 'pending',
        startsAt: STARTS,
      });
    }
    expect((await expiry.expireStarted()).expired).toEqual([REQUEST_A, REQUEST_B, third]);
    expect(trace.filter((step) => step.startsWith('read due'))).toEqual([
      `read due at ${STARTS.toISOString()} after -`,
      `read due at ${STARTS.toISOString()} after ${REQUEST_B}`,
    ]);
  });

  it('a request whose expiry fails is rolled back alone, logged by its id and reported, and the next still expires', async () => {
    requests.set(REQUEST_B, {
      id: REQUEST_B,
      sessionId: SESSION_B,
      enrollmentId: ENROLLMENT,
      status: 'pending',
      startsAt: STARTS,
    });
    failOn = REQUEST_A;
    expect(await expiry.expireStarted()).toEqual({ expired: [REQUEST_B], failed: [REQUEST_A] });
    expect(reported.map(({ message }) => message)).toEqual(['the database refused the update']);
    expect(written()).toEqual([
      { level: 'error', msg: 'Cancellation request expiry failed', requestId: REQUEST_A },
      {
        level: 'info',
        msg: 'Cancellation request expired',
        requestId: REQUEST_B,
        sessionId: SESSION_B,
      },
    ]);
  });

  it('run twice, expires once and writes one row (R-API-14)', async () => {
    await expiry.expireStarted();
    expect(await expiry.expireStarted()).toEqual({ expired: [], failed: [] });
    expect(events).toHaveLength(1);
  });
});
