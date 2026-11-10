// T021 of specs/004-sessions — `sessions.cancellation.request` and `.answer` as the service decides
// them (FR-456, FR-457, FR-458, FR-461, FR-485, FR-495; SC-411; research R-310; contracts/
// app-surface.md, "`sessions.cancellation`"; contracts/kernel.md, the rows «cancellation request, a
// decline» and «cancellation accepted»). Written before the service, and run red first.
//
// Over a store that records what it is asked, in order, beside the transaction's begin and commit,
// so the spec reads the order the kernel's rows name: the accounts (both, one call), for an
// acceptance the teacher's slots' key, the enrollment, the session, for an acceptance the session's
// remedies, then the request; the session, the request and the accounts read again under the locks,
// and the database's clock read after them. What the database refuses or writes is
// tests/db-integrity/cancellation-requests.spec.ts'.
//
//   - a party requests a scheduled session not yet started, keyed by the kernel's idempotency; a
//     non-party, a nonexistent session and the other gender answer one NOT_FOUND; a session no
//     longer scheduled SESSION_NOT_SCHEDULED; at or after the start CANCELLATION_EXPIRED, one
//     millisecond before it admitted (no minimum notice, decision 14 (ii)); an open request
//     CANCELLATION_PENDING with its id;
//   - the counterparty answers: accept cancels the session by agreement, decline leaves it; the
//     requester, a non-party and the other gender NOT_FOUND; a session no longer scheduled
//     SESSION_NOT_SCHEDULED and at or after the start CANCELLATION_EXPIRED, each read under the
//     locks, nothing written; a request no longer pending CONFLICT;
//   - one `session_events` row per request and answer, at the clock read under the locks;
//   - every refusal one info line with the ids, the code and the reason, nothing else.
import { Writable } from 'node:stream';

import { addSeconds } from '@ijazah/time';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import type { CancellationRequestRow } from './cancellation.repository.js';
import {
  type CancellationServices,
  type CancellationStore,
  createCancellationServices,
} from './cancellation.service.js';
import type { Offered } from './remedy-offer.service.js';
import type { SessionEventRecord } from './session-events.repository.js';
import type { PartySessionRow } from './sessions.repository.js';

const SESSION = '0199d0a0-0000-7000-8000-00000000a001';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c001';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c002';
const STRANGER = '0199d0a0-0000-7000-8000-00000000c003';
const REQUEST = '0199d0a0-0000-7000-8000-00000000d001';
const OTHER_REQUEST = '0199d0a0-0000-7000-8000-00000000d002';
const NEW_REQUEST = '0199d0a0-0000-7000-8000-00000000d0ff';
const NOWHERE = '0199d0a0-0000-7000-8000-00000000a0ff';
const KEY = 'cancel-key-0199d0a0-0001';

/** Sunday 2026-11-08, 17:00 to 17:45 in Cairo (+02:00). */
const STARTS = new Date('2026-11-08T15:00:00.000Z');
const ENDS = new Date('2026-11-08T15:45:00.000Z');
/** One millisecond before the start. */
const JUST_BEFORE = new Date('2026-11-08T14:59:59.999Z');

const session = (overrides: Partial<PartySessionRow> = {}): PartySessionRow => ({
  id: SESSION,
  enrollmentId: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  sequenceNumber: 3,
  makeupForSequenceNumber: null,
  localDate: '2026-11-08',
  startTimeLocal: '17:00:00',
  timezone: 'Africa/Cairo',
  startsAt: STARTS,
  endsAt: ENDS,
  status: 'scheduled',
  ...overrides,
});

const request = (overrides: Partial<CancellationRequestRow> = {}): CancellationRequestRow => ({
  id: REQUEST,
  sessionId: SESSION,
  requestedByUserId: STUDENT,
  reason: 'سفر طارئ',
  status: 'pending',
  ...overrides,
});

let trace: string[];
let sessions: Map<string, PartySessionRow>;
let requests: Map<string, CancellationRequestRow>;
let genders: Map<string, 'male' | 'female'>;
let events: SessionEventRecord[];
let written: string[];
/** Applied once the request's own lock is taken: what another transaction committed meanwhile. */
let underLock: (() => void) | undefined;
/** What the insert does instead of inserting, when a spec makes the database refuse it. */
let insertRefusal: Error | undefined;
let now: Date;
let keyed: IdempotentRequest[];
let lines: Record<string, unknown>[];
/** T028: what the offer at an acceptance answers. */
let offerAnswer: Offered | null;
const REMEDY = '0199d0a0-0000-7000-8000-00000000c0de';
let log: Logger;
let services: CancellationServices;

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

/** The kernel's idempotency as the service sees it: the key recorded, the effect in a transaction. */
const idempotency = {
  run: <T>(keyedRequest: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) => {
    keyed.push(keyedRequest);
    return transactions.run(effect);
  },
};

const partyOf = (row: PartySessionRow, userId: string) =>
  row.studentUserId === userId || row.teacherUserId === userId;

const store: CancellationStore = {
  sessionOfParty: async (_tx, sessionId, userId) => {
    trace.push(`read session as ${userId}`);
    const found = sessions.get(sessionId);
    return found !== undefined && partyOf(found, userId) ? found : null;
  },
  requestOfParty: async (_tx, requestId, userId) => {
    trace.push(`read request as ${userId}`);
    const found = requests.get(requestId);
    const its = found === undefined ? undefined : sessions.get(found.sessionId);
    return found !== undefined && its !== undefined && partyOf(its, userId) ? found : null;
  },
  partiesOf: async (_tx, userIds) => {
    trace.push(`read parties ${[...userIds].join(',')}`);
    return new Map(
      userIds.flatMap((id) => {
        const gender = genders.get(id);
        return gender === undefined ? [] : [[id, { gender }] as const];
      }),
    );
  },
  lockAccounts: async (_tx, userIds) => {
    trace.push(`lock users ${[...userIds].join(',')}`);
  },
  lockTeacherSlots: async (_tx, teacherUserId) => {
    trace.push(`lock key teacher-slots ${teacherUserId}`);
  },
  lockSessions: async (_tx, ids) => {
    trace.push(`lock sessions ${[...ids].join(',')}`);
  },
  lockRemediesOf: async (_tx, sessionId) => {
    trace.push(`lock remedies of ${sessionId}`);
  },
  lockRequests: async (_tx, ids) => {
    trace.push(`lock requests ${[...ids].join(',')}`);
    underLock?.();
  },
  pendingRequestOf: async (_tx, sessionId) => {
    trace.push(`read pending of ${sessionId}`);
    return (
      [...requests.values()].find((row) => row.sessionId === sessionId && row.status === 'pending')
        ?.id ?? null
    );
  },
  requestById: async (_tx, id) => {
    trace.push(`read request ${id}`);
    return requests.get(id) ?? null;
  },
  insertRequest: async (_tx, row) => {
    trace.push(`insert request on ${row.sessionId} by ${row.requestedByUserId}`);
    if (insertRefusal !== undefined) throw insertRefusal;
    written.push(`request ${row.reason}`);
    requests.set(NEW_REQUEST, { id: NEW_REQUEST, ...row, status: 'pending' });
    return NEW_REQUEST;
  },
  answerRequest: async (_tx, id, answer, at) => {
    trace.push(`answer ${id} ${answer}`);
    const found = requests.get(id);
    if (found?.status !== 'pending') return false;
    written.push(`answer ${id} ${answer} at ${at.toISOString()}`);
    requests.set(id, { ...found, status: answer });
    return true;
  },
  cancelByAgreement: async (_tx, sessionId) => {
    trace.push(`cancel session ${sessionId}`);
    const found = sessions.get(sessionId);
    if (found?.status !== 'scheduled') return false;
    written.push(`session ${sessionId} cancelled_by_agreement`);
    sessions.set(sessionId, { ...found, status: 'cancelled_by_agreement' });
    return true;
  },
  recordEvents: async (_tx, records) => {
    trace.push(`record ${records.map(({ kind }) => kind).join(',')}`);
    events.push(...records);
  },
};

const enrollments = {
  lockEnrollments: async (_tx: Transaction, ids: readonly string[]) => {
    trace.push(`lock enrollments ${[...ids].join(',')}`);
  },
};

beforeEach(() => {
  trace = [];
  sessions = new Map([[SESSION, session()]]);
  requests = new Map();
  genders = new Map([
    [STUDENT, 'female'],
    [TEACHER, 'female'],
    [STRANGER, 'female'],
  ]);
  events = [];
  written = [];
  underLock = undefined;
  insertRefusal = undefined;
  now = new Date('2026-11-08T14:00:00.000Z');
  keyed = [];
  lines = [];
  log = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
        done();
      },
    }),
  });
  offerAnswer = {
    remedyId: REMEDY,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    status: 'proposed',
    proposedDate: '2026-12-03',
    reoffered: false,
  };
  services = createCancellationServices({
    transactions,
    idempotency,
    enrollments,
    store,
    // T028: the make-up an acceptance owes, offered on its transaction under its locks.
    offer: {
      offerLocked: async (_tx, sessionId) => {
        trace.push(`offer ${sessionId}`);
        return offerAnswer;
      },
    },
    clock: async () => {
      trace.push('clock');
      return now;
    },
  });
});

/**
 * The refusal `call` threw, each one marked «logged» where it was logged, so `onError` writes no
 * second line (PR #130's review, round 1, Minor 4).
 */
async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) {
      expect(isRefusalLogged(error), `${error.code} marked «logged»`).toBe(true);
      return error;
    }
    throw error;
  }
  throw new Error('answered where it must be refused');
}

/** The log lines that name a refusal, without the logger's own fields. */
function refusalLines(): Record<string, unknown>[] {
  return lines
    .filter((line) => typeof line['errorCode'] === 'string')
    .map(({ msg: _msg, level: _level, time: _time, pid: _pid, hostname: _host, ...rest }) => rest);
}

const ask = (userId: string, sessionId = SESSION) =>
  services.request({ userId }, { sessionId, reason: 'سفر طارئ', idempotencyKey: KEY }, log);

const answer = (userId: string, accept: boolean, requestId = REQUEST) =>
  services.answer({ userId }, { requestId, accept }, log);

describe('sessions.cancellation.request: admitted (FR-456, R-310)', () => {
  it('a party asks, keyed by the kernel under the request without its key, and is answered pending until the start', async () => {
    expect(await ask(STUDENT)).toEqual({
      requestId: NEW_REQUEST,
      status: 'pending',
      expiresAt: STARTS.toISOString(),
    });
    expect(keyed).toEqual([
      {
        scope: 'sessions.cancellation.request',
        key: KEY,
        actorId: STUDENT,
        input: { sessionId: SESSION, reason: 'سفر طارئ' },
      },
    ]);
    expect(written).toEqual(['request سفر طارئ']);
  });

  it('the teacher asks as well (either participant)', async () => {
    expect((await ask(TEACHER)).status).toBe('pending');
    expect(requests.get(NEW_REQUEST)?.requestedByUserId).toBe(TEACHER);
  });

  it('locks the accounts, the enrollment, the session, then reads again under them (kernel.md, «cancellation request, a decline»)', async () => {
    await ask(STUDENT);
    expect(trace).toEqual([
      'begin',
      `read session as ${STUDENT}`,
      `lock users ${STUDENT},${TEACHER}`,
      `lock enrollments ${ENROLLMENT}`,
      `lock sessions ${SESSION}`,
      `read pending of ${SESSION}`,
      `read session as ${STUDENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      'clock',
      `insert request on ${SESSION} by ${STUDENT}`,
      'record cancellation_requested',
      'commit',
    ]);
  });

  it('locks the two accounts in id order whichever is the student (rule 2)', async () => {
    const earlier = '0199d0a0-0000-7000-8000-00000000b001';
    sessions.set(SESSION, session({ teacherUserId: earlier }));
    genders.set(earlier, 'female');
    await ask(STUDENT);
    expect(trace).toContain(`lock users ${earlier},${STUDENT}`);
  });

  it('writes one cancellation_requested row at the clock read under the locks (FR-495)', async () => {
    await ask(STUDENT);
    expect(events).toEqual([
      {
        enrollmentId: ENROLLMENT,
        sessionId: SESSION,
        kind: 'cancellation_requested',
        occurredAt: now,
      },
    ]);
  });

  it('admits a request one millisecond before the start: no minimum notice (decision 14 (ii))', async () => {
    now = JUST_BEFORE;
    expect((await ask(STUDENT)).status).toBe('pending');
  });

  it('admits a new request once an earlier one was declined', async () => {
    requests.set(OTHER_REQUEST, request({ id: OTHER_REQUEST, status: 'declined' }));
    expect((await ask(TEACHER)).requestId).toBe(NEW_REQUEST);
  });
});

describe('sessions.cancellation.request: refused, nothing written', () => {
  it('a non-party, a nonexistent session and the other gender answer one NOT_FOUND, locking nothing for the first two (R-GENDER-2)', async () => {
    const stranger = await refusalOf(ask(STRANGER));
    const nowhere = await refusalOf(ask(STUDENT, NOWHERE));
    expect(trace.filter((step) => step.startsWith('lock'))).toEqual([]);
    genders.set(TEACHER, 'male');
    const otherGender = await refusalOf(ask(STUDENT));
    for (const refusal of [stranger, nowhere, otherGender]) {
      expect({ code: refusal.code, message: refusal.message, details: refusal.details }).toEqual({
        code: 'NOT_FOUND',
        message: new DomainError('NOT_FOUND').message,
        details: undefined,
      });
    }
    expect(written).toEqual([]);
    expect(events).toEqual([]);
    expect(refusalLines()).toEqual([
      { sessionId: SESSION, userId: STRANGER, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      { sessionId: NOWHERE, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'gender_differs' },
    ]);
  });

  it.each(['cancelled_by_admin', 'cancelled_by_agreement', 'done'] as const)(
    'a session %s is SESSION_NOT_SCHEDULED',
    async (status) => {
      sessions.set(SESSION, session({ status }));
      expect((await refusalOf(ask(STUDENT))).code).toBe('SESSION_NOT_SCHEDULED');
      expect(written).toEqual([]);
      expect(refusalLines()).toEqual([
        {
          sessionId: SESSION,
          userId: STUDENT,
          errorCode: 'SESSION_NOT_SCHEDULED',
          reason: 'not_scheduled',
        },
      ]);
    },
  );

  it.each([
    ['at the start', 0],
    ['after the start', 60],
  ])('%s is CANCELLATION_EXPIRED (FR-458)', async (_name, after) => {
    now = new Date(addSeconds(STARTS, after));
    expect((await refusalOf(ask(STUDENT))).code).toBe('CANCELLATION_EXPIRED');
    expect(written).toEqual([]);
    expect(refusalLines()).toEqual([
      { sessionId: SESSION, userId: STUDENT, errorCode: 'CANCELLATION_EXPIRED', reason: 'started' },
    ]);
  });

  it.each([
    ['the counterparty', TEACHER],
    ['the caller', STUDENT],
  ])(
    'an open request of %s is CANCELLATION_PENDING with its id, locked and read again first',
    async (_name, by) => {
      requests.set(REQUEST, request({ requestedByUserId: by }));
      const refusal = await refusalOf(ask(STUDENT));
      expect({ code: refusal.code, details: refusal.details }).toEqual({
        code: 'CANCELLATION_PENDING',
        details: [{ path: 'requestId', code: REQUEST }],
      });
      expect(trace.slice(trace.indexOf(`read pending of ${SESSION}`))).toEqual([
        `read pending of ${SESSION}`,
        `lock requests ${REQUEST}`,
        `read pending of ${SESSION}`,
        `read session as ${STUDENT}`,
        `read parties ${STUDENT},${TEACHER}`,
        'clock',
        'rollback',
      ]);
      expect(written).toEqual([]);
      expect(refusalLines()).toEqual([
        {
          sessionId: SESSION,
          userId: STUDENT,
          errorCode: 'CANCELLATION_PENDING',
          reason: 'request_pending',
          requestId: REQUEST,
        },
      ]);
    },
  );

  it('the database refusing a second pending request (rule 45) is CANCELLATION_PENDING', async () => {
    // The adapter's error as `db-errors.ts` reads it (its own spec reads a real one).
    insertRefusal = Object.assign(new Error('unique'), {
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage: '',
            constraint: { index: 'cancellation_requests_one_pending_key' },
          },
        },
      },
    });
    const refusal = await refusalOf(ask(STUDENT));
    expect({ code: refusal.code, details: refusal.details }).toEqual({
      code: 'CANCELLATION_PENDING',
      details: undefined,
    });
    expect(refusalLines()).toEqual([
      {
        sessionId: SESSION,
        userId: STUDENT,
        errorCode: 'CANCELLATION_PENDING',
        reason: 'request_pending',
      },
    ]);
  });

  it('any other failure of the insert is thrown as it is', async () => {
    insertRefusal = new Error('the database is down');
    await expect(ask(STUDENT)).rejects.toBe(insertRefusal);
  });
});

describe('sessions.cancellation.answer: admitted (FR-457, FR-458, R-310)', () => {
  beforeEach(() => {
    requests.set(REQUEST, request());
  });

  it('the counterparty declines: the request declined, the session standing, one cancellation_declined row', async () => {
    expect(await answer(TEACHER, false)).toEqual({
      requestId: REQUEST,
      status: 'declined',
      sessionStatus: 'scheduled',
    });
    expect(written).toEqual([`answer ${REQUEST} declined at ${now.toISOString()}`]);
    expect(events).toEqual([
      {
        enrollmentId: ENROLLMENT,
        sessionId: SESSION,
        kind: 'cancellation_declined',
        occurredAt: now,
      },
    ]);
  });

  it("a decline takes kernel.md's «cancellation request, a decline» row: users, enrollments, sessions, the request", async () => {
    await answer(TEACHER, false);
    expect(trace).toEqual([
      'begin',
      `read request as ${TEACHER}`,
      `read session as ${TEACHER}`,
      `lock users ${STUDENT},${TEACHER}`,
      `lock enrollments ${ENROLLMENT}`,
      `lock sessions ${SESSION}`,
      `lock requests ${REQUEST}`,
      `read request ${REQUEST}`,
      `read session as ${TEACHER}`,
      `read parties ${STUDENT},${TEACHER}`,
      'clock',
      `answer ${REQUEST} declined`,
      'record cancellation_declined',
      'commit',
    ]);
  });

  it('the counterparty accepts: the request accepted, the session cancelled by agreement, no penalty, one cancellation_accepted row (FR-457, FR-485)', async () => {
    expect(await answer(TEACHER, true)).toEqual({
      requestId: REQUEST,
      status: 'accepted',
      sessionStatus: 'cancelled_by_agreement',
    });
    expect(written).toEqual([
      `answer ${REQUEST} accepted at ${now.toISOString()}`,
      `session ${SESSION} cancelled_by_agreement`,
    ]);
    expect(events).toEqual([
      {
        enrollmentId: ENROLLMENT,
        sessionId: SESSION,
        kind: 'cancellation_accepted',
        occurredAt: now,
      },
    ]);
  });

  it("an acceptance takes kernel.md's «cancellation accepted» row: users, the teacher's slots' key, enrollments, sessions, remedies, the request", async () => {
    await answer(TEACHER, true);
    expect(trace).toEqual([
      'begin',
      `read request as ${TEACHER}`,
      `read session as ${TEACHER}`,
      `lock users ${STUDENT},${TEACHER}`,
      `lock key teacher-slots ${TEACHER}`,
      `lock enrollments ${ENROLLMENT}`,
      `lock sessions ${SESSION}`,
      `lock remedies of ${SESSION}`,
      `lock requests ${REQUEST}`,
      `read request ${REQUEST}`,
      `read session as ${TEACHER}`,
      `read parties ${STUDENT},${TEACHER}`,
      'clock',
      `answer ${REQUEST} accepted`,
      `cancel session ${SESSION}`,
      'record cancellation_accepted',
      // T028: the make-up it owes, offered in its transaction, under the same locks.
      `offer ${SESSION}`,
      'commit',
    ]);
  });

  it('an acceptance offers the make-up it owes in its transaction and writes one line after the commit (T028, decision 5, Q11)', async () => {
    await answer(TEACHER, true);
    const offeredLines = lines
      .filter(({ msg }) => msg === 'Remedy offered')
      .map(({ remedyId, sessionId, enrollmentId, action }) => ({
        remedyId,
        sessionId,
        enrollmentId,
        action,
      }));
    expect(offeredLines).toEqual([
      { remedyId: REMEDY, sessionId: SESSION, enrollmentId: ENROLLMENT, action: 'offered' },
    ]);
  });

  it('an acceptance that owes nothing yet (a suspended student) writes no offer line, and a decline offers nothing (T028)', async () => {
    offerAnswer = null;
    await answer(TEACHER, true);
    expect(lines.filter(({ msg }) => msg === 'Remedy offered')).toEqual([]);
    requests.set(REQUEST, request());
    trace = [];
    await answer(TEACHER, false).catch(() => undefined);
    expect(trace.some((step) => step.startsWith('offer'))).toBe(false);
  });

  it("the student answers the teacher's request", async () => {
    requests.set(REQUEST, request({ requestedByUserId: TEACHER }));
    expect((await answer(STUDENT, true)).status).toBe('accepted');
  });

  it('an answer one millisecond before the start is admitted', async () => {
    now = JUST_BEFORE;
    expect((await answer(TEACHER, true)).status).toBe('accepted');
  });
});

describe('sessions.cancellation.answer: refused, nothing written', () => {
  beforeEach(() => {
    requests.set(REQUEST, request());
  });

  it('the requester answering their own request, a non-party, a nonexistent request and the other gender answer one NOT_FOUND', async () => {
    const own = await refusalOf(answer(STUDENT, true));
    const stranger = await refusalOf(answer(STRANGER, true));
    const nowhere = await refusalOf(answer(TEACHER, true, NOWHERE));
    expect(trace.filter((step) => step.startsWith('lock'))).toEqual([]);
    genders.set(STUDENT, 'male');
    const otherGender = await refusalOf(answer(TEACHER, false));
    for (const refusal of [own, stranger, nowhere, otherGender]) {
      expect({ code: refusal.code, message: refusal.message, details: refusal.details }).toEqual({
        code: 'NOT_FOUND',
        message: new DomainError('NOT_FOUND').message,
        details: undefined,
      });
    }
    expect(written).toEqual([]);
    expect(events).toEqual([]);
    expect(refusalLines()).toEqual([
      { requestId: REQUEST, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'own_request' },
      { requestId: REQUEST, userId: STRANGER, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      { requestId: NOWHERE, userId: TEACHER, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      {
        requestId: REQUEST,
        sessionId: SESSION,
        userId: TEACHER,
        errorCode: 'NOT_FOUND',
        reason: 'gender_differs',
      },
    ]);
  });

  describe.each([true, false])('accept %s', (accept) => {
    it.each(['cancelled_by_admin', 'cancelled_by_agreement', 'done'] as const)(
      'a session %s is SESSION_NOT_SCHEDULED, the request left as it is',
      async (status) => {
        sessions.set(SESSION, session({ status }));
        expect((await refusalOf(answer(TEACHER, accept))).code).toBe('SESSION_NOT_SCHEDULED');
        expect(written).toEqual([]);
        expect(events).toEqual([]);
        expect(requests.get(REQUEST)?.status).toBe('pending');
        expect(refusalLines()).toEqual([
          {
            requestId: REQUEST,
            sessionId: SESSION,
            userId: TEACHER,
            errorCode: 'SESSION_NOT_SCHEDULED',
            reason: 'not_scheduled',
          },
        ]);
      },
    );

    it('a session cancelled by another path committed before the locks is read under them: SESSION_NOT_SCHEDULED', async () => {
      underLock = () => sessions.set(SESSION, session({ status: 'cancelled_by_admin' }));
      expect((await refusalOf(answer(TEACHER, accept))).code).toBe('SESSION_NOT_SCHEDULED');
      expect(written).toEqual([]);
    });

    it.each([
      ['at the start', 0],
      ['after the start', 60],
    ])('%s is CANCELLATION_EXPIRED, the session unchanged (SC-411)', async (_name, after) => {
      now = new Date(addSeconds(STARTS, after));
      expect((await refusalOf(answer(TEACHER, accept))).code).toBe('CANCELLATION_EXPIRED');
      expect(written).toEqual([]);
      expect(sessions.get(SESSION)?.status).toBe('scheduled');
      expect(refusalLines()).toEqual([
        {
          requestId: REQUEST,
          sessionId: SESSION,
          userId: TEACHER,
          errorCode: 'CANCELLATION_EXPIRED',
          reason: 'started',
        },
      ]);
    });

    it.each(['declined', 'accepted', 'expired'] as const)(
      'a request already %s is CONFLICT with details.cause not_pending (an addition to the contract)',
      async (status) => {
        requests.set(REQUEST, request({ status }));
        const refusal = await refusalOf(answer(TEACHER, accept));
        expect({ code: refusal.code, details: refusal.details }).toEqual({
          code: 'CONFLICT',
          details: [{ path: 'cause', code: 'not_pending' }],
        });
        expect(written).toEqual([]);
        expect(refusalLines()).toEqual([
          {
            requestId: REQUEST,
            sessionId: SESSION,
            userId: TEACHER,
            errorCode: 'CONFLICT',
            reason: 'not_pending',
          },
        ]);
      },
    );

    // The owner's order of 2026-11-10 (B37, Q2): NOT_FOUND, CANCELLATION_EXPIRED,
    // SESSION_NOT_SCHEDULED, then CONFLICT.
    it.each(['cancelled_by_admin', 'cancelled_by_agreement', 'done'] as const)(
      'a session %s whose start has passed is CANCELLATION_EXPIRED: the start is read before the status',
      async (status) => {
        sessions.set(SESSION, session({ status }));
        now = STARTS;
        expect((await refusalOf(answer(TEACHER, accept))).code).toBe('CANCELLATION_EXPIRED');
        expect(written).toEqual([]);
      },
    );

    it('a request no longer pending on a session no longer scheduled is SESSION_NOT_SCHEDULED before CONFLICT', async () => {
      sessions.set(SESSION, session({ status: 'cancelled_by_agreement' }));
      requests.set(REQUEST, request({ status: 'accepted' }));
      expect((await refusalOf(answer(TEACHER, accept))).code).toBe('SESSION_NOT_SCHEDULED');
    });

    it('a request no longer pending whose session has started is CANCELLATION_EXPIRED before CONFLICT', async () => {
      requests.set(REQUEST, request({ status: 'declined' }));
      now = STARTS;
      expect((await refusalOf(answer(TEACHER, accept))).code).toBe('CANCELLATION_EXPIRED');
    });

    it('a request answered by another transaction committed before the lock is read under it: CONFLICT', async () => {
      underLock = () => requests.set(REQUEST, request({ status: 'declined' }));
      expect((await refusalOf(answer(TEACHER, accept))).code).toBe('CONFLICT');
      expect(written).toEqual([]);
    });
  });
});
