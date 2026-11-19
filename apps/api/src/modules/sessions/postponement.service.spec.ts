// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; the note under T112, Q-1 (a)
// to Q-3 (a); contracts/kernel.md, «a postponement») — `sessions.postpone` as the service decides it.
// Written before the service, and run red first.
//
// The pure rules: the week (now + the notice to now + 7 days, Q-1 (a)), a week as seven days of 24
// hours, and the interval per party per enrollment from that party's last request (Q-3 (a)). Then
// the service over a store that records what it is asked, in order, beside the transaction's begin
// and commit, so the spec reads kernel.md's order: `users` (both, one call), the teacher's
// `lockKey('teacher-slots')`, `enrollments`, the clock and the interval read under them, `sessions`,
// `session_remedies`, then the insert. Each refusal answers its code, writes nothing and one info
// line of ids and a reason, never the text. What the database refuses or writes is
// tests/db-integrity/session-postponements.spec.ts'.
import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../platform/live/live-publisher.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import type { EnrollmentTerms } from './enrollment-side.port.js';
import type { PostponementWeek, WeekSession } from './postponement.repository.js';
import {
  createPostponement,
  intervalPassed,
  type Postponement,
  type PostponementStore,
  postponementWeek,
  weeksAfter,
} from './postponement.service.js';
import type { Offered } from './remedy-offer.service.js';
import type { SessionEventRecord } from './session-events.repository.js';
import type { PartyStanding } from './sessions.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c002';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c001';
const STRANGER = '0199d0a0-0000-7000-8000-00000000c003';
const SLOT = '0199d0a0-0000-7000-8000-00000000b001';
const POSTPONEMENT = '0199d0a0-0000-7000-8000-00000000f001';
const FIRST = '0199d0a0-0000-7000-8000-00000000a001';
const SECOND = '0199d0a0-0000-7000-8000-00000000a002';
const NEAR = '0199d0a0-0000-7000-8000-00000000a003';
const LATER = '0199d0a0-0000-7000-8000-00000000a004';
const KEY = 'postpone-key-0199d0a0-0001';
const REASON = 'سفر طارئ';

/** Thursday 2026-11-19 10:00 UTC, the request (Q-1 (a)'s example). */
const NOW = new Date('2026-11-19T10:00:00.000Z');

const SETTINGS: Record<string, number> = {
  postponement_notice_hours: 12,
  postponement_interval_weeks: 4,
};

describe('the week and the interval, pure (Q-1 (a), Q-3 (a))', () => {
  // Q-A (a): `packages/time`'s `addWeeks`, whose instants are whole seconds (`addSeconds`).
  it('counts a week as seven days of 24 hours, and whole weeks from an instant, to the second', () => {
    expect(weeksAfter(NOW, 1)).toEqual(new Date('2026-11-26T10:00:00.000Z'));
    expect(weeksAfter(NOW, 4)).toEqual(new Date('2026-12-17T10:00:00.000Z'));
    expect(weeksAfter(new Date('2026-12-30T23:59:59Z'), 1)).toEqual(
      new Date('2027-01-06T23:59:59.000Z'),
    );
  });

  it('covers from now + the notice to now + 7 days: 19/11 10:00 covers 19/11 22:00 to 26/11 10:00', () => {
    expect(postponementWeek(NOW, 12)).toEqual({
      from: new Date('2026-11-19T22:00:00.000Z'),
      to: new Date('2026-11-26T10:00:00.000Z'),
    });
  });

  it('opens the next postponement 4 weeks after the last: from 17/12 10:00, not a millisecond before', () => {
    expect(intervalPassed(null, NOW, 4)).toBe(true);
    expect(intervalPassed(NOW, new Date('2026-12-17T09:59:59.999Z'), 4)).toBe(false);
    expect(intervalPassed(NOW, new Date('2026-12-17T10:00:00.000Z'), 4)).toBe(true);
  });
});

let trace: string[];
let terms: EnrollmentTerms | null;
let termsUnderLock: EnrollmentTerms | null | undefined;
let standings: Map<string, PartyStanding>;
let sessions: WeekSession[];
let lastAt: Date | null;
let written: string[];
let events: SessionEventRecord[];
let keyed: IdempotentRequest[];
let lines: Record<string, unknown>[];
let published: { to: readonly string[]; event: unknown }[];
let weeksAsked: PostponementWeek[];
let log: Logger;
let service: Postponement;

const tx = {} as Transaction;

const standing = (gender: 'male' | 'female' = 'female'): PartyStanding => ({
  gender,
  accountStatus: 'active',
  teacherApproved: true,
  displayName: 'اسم',
});

const enrollment = (overrides: Partial<EnrollmentTerms> = {}): EnrollmentTerms => ({
  id: ENROLLMENT,
  status: 'confirmed',
  slotId: SLOT,
  track: 'recitation',
  timezone: 'Africa/Cairo',
  durationMinutes: 45,
  sessionCount: 8,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  ...overrides,
});

const store: PostponementStore = {
  partiesOf: async (_tx, userIds) => {
    trace.push(`read parties ${[...userIds].join(',')}`);
    return new Map(
      userIds.flatMap((id) => {
        const found = standings.get(id);
        return found === undefined ? [] : [[id, found] as const];
      }),
    );
  },
  lockAccounts: async (_tx, userIds) => void trace.push(`lock users ${[...userIds].join(',')}`),
  lockTeacherSlots: async (_tx, teacher) => void trace.push(`lock key teacher-slots ${teacher}`),
  lockSessions: async (_tx, ids) => void trace.push(`lock sessions ${[...ids].join(',')}`),
  lockRemediesOf: async (_tx, sessionId) => void trace.push(`lock remedies of ${sessionId}`),
  lastPostponementAt: async (_tx, enrollmentId, userId) => {
    trace.push(`read last postponement of ${userId} on ${enrollmentId}`);
    return lastAt;
  },
  weekSessionsOf: async (_tx, _enrollmentId, week, among) => {
    trace.push(among === undefined ? 'read week' : `read week among ${among.join(',')}`);
    weeksAsked.push(week);
    return sessions.filter(
      ({ id, startsAt }) =>
        startsAt >= week.from && startsAt <= week.to && (among === undefined || among.includes(id)),
    );
  },
  insertPostponement: async (_tx, row) => {
    trace.push(`insert postponement by ${row.requestedByUserId}`);
    written.push(`postponement ${row.enrollmentId} ${row.reason}`);
    return POSTPONEMENT;
  },
  postponeSessions: async (_tx, ids, postponementId) => {
    trace.push(`postpone ${ids.join(',')}`);
    written.push(`postponed ${ids.join(',')} by ${postponementId}`);
    return ids.length;
  },
  recordEvents: async (_tx, records) => {
    trace.push(`record ${records.map(({ kind }) => kind).join(',')}`);
    events.push(...records);
  },
};

const offered = (sessionId: string): Offered => ({
  remedyId: `0199d0a0-0000-7000-8000-0000000c0${sessionId.slice(-3)}`,
  sessionId,
  enrollmentId: ENROLLMENT,
  status: 'proposed',
  proposedDate: '2027-01-14',
  reoffered: false,
});

const live: LivePublisher = {
  afterCommit: (to, event) => void published.push({ to, event }),
};

beforeEach(() => {
  trace = [];
  terms = enrollment();
  termsUnderLock = undefined;
  standings = new Map([
    [STUDENT, standing()],
    [TEACHER, standing()],
    [STRANGER, standing()],
  ]);
  sessions = [
    // 11 hours ahead: nearer than the 12-hour notice, it stands (FR-POSTPONE-3).
    { id: NEAR, startsAt: new Date('2026-11-19T21:00:00.000Z') },
    { id: FIRST, startsAt: new Date('2026-11-22T15:00:00.000Z') },
    // A make-up inside the week, postponed with it (Q-1 (a): make-ups included).
    { id: SECOND, startsAt: new Date('2026-11-26T10:00:00.000Z') },
    // A millisecond past the week.
    { id: LATER, startsAt: new Date('2026-11-26T10:00:00.001Z') },
  ];
  lastAt = null;
  written = [];
  events = [];
  keyed = [];
  lines = [];
  published = [];
  weeksAsked = [];
  log = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
        done();
      },
    }),
  });
  service = createPostponement({
    idempotency: {
      run: async <T>(keyedRequest: IdempotentRequest, effect: (on: Transaction) => Promise<T>) => {
        keyed.push(keyedRequest);
        trace.push('begin');
        try {
          const answer = await effect(tx);
          trace.push('commit');
          return answer;
        } catch (error) {
          trace.push('rollback');
          throw error;
        }
      },
    },
    enrollments: {
      enrollmentFor: async () => {
        const locked = trace.some((step) => step.startsWith('lock enrollments'));
        trace.push('read enrollment');
        return locked && termsUnderLock !== undefined ? termsUnderLock : terms;
      },
      lockEnrollments: async (_tx, ids) => void trace.push(`lock enrollments ${ids.join(',')}`),
    },
    settings: { read: async (key, schema) => schema.parse(SETTINGS[key]) },
    offer: {
      offerLocked: async (_tx, sessionId) => {
        trace.push(`offer ${sessionId}`);
        return offered(sessionId);
      },
    },
    store,
    clock: async () => {
      trace.push('clock');
      return NOW;
    },
  });
});

const postpone = (userId: string, reason = REASON) =>
  service.postpone(
    { userId },
    { enrollmentId: ENROLLMENT, reason, idempotencyKey: KEY },
    log,
    live,
  );

/** The refusal `call` threw, marked «logged» where it was logged (PR #130's review, Minor 4). */
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

/** The log lines without the logger's own fields. */
const fieldsOf = (wanted: (line: Record<string, unknown>) => boolean) =>
  lines
    .filter(wanted)
    .map(({ msg: _msg, level: _level, time: _time, pid: _pid, hostname: _host, ...rest }) => rest);

describe('sessions.postpone: the postponement (FR-POSTPONE-1, FR-POSTPONE-2)', () => {
  it('postpones the caller’s sessions of the week, make-ups included, keyed, and answers them', async () => {
    expect(await postpone(TEACHER)).toEqual({
      postponementId: POSTPONEMENT,
      sessionIds: [FIRST, SECOND],
    });
    expect(keyed).toEqual([
      {
        scope: 'sessions.postpone',
        key: KEY,
        actorId: TEACHER,
        input: { enrollmentId: ENROLLMENT, reason: REASON },
      },
    ]);
    expect(written).toEqual([
      `postponement ${ENROLLMENT} ${REASON}`,
      `postponed ${FIRST},${SECOND} by ${POSTPONEMENT}`,
    ]);
    expect(events).toEqual([
      { enrollmentId: ENROLLMENT, sessionId: FIRST, kind: 'postponed', occurredAt: NOW },
      { enrollmentId: ENROLLMENT, sessionId: SECOND, kind: 'postponed', occurredAt: NOW },
    ]);
  });

  it('leaves a session nearer than the notice standing, and reads the week from the clock under the locks', async () => {
    await postpone(STUDENT);
    expect(weeksAsked[0]).toEqual({
      from: new Date('2026-11-19T22:00:00.000Z'),
      to: new Date('2026-11-26T10:00:00.000Z'),
    });
    expect(written.join(' ')).not.toContain(NEAR);
    expect(written.join(' ')).not.toContain(LATER);
  });

  it('takes kernel.md’s order: users, the teacher’s slots, the enrollment, then the sessions and their remedies, before the insert', async () => {
    await postpone(STUDENT);
    expect(trace).toEqual([
      'begin',
      'read enrollment',
      `lock users ${TEACHER},${STUDENT}`,
      `lock key teacher-slots ${TEACHER}`,
      `lock enrollments ${ENROLLMENT}`,
      'read enrollment',
      `read parties ${TEACHER},${STUDENT}`,
      'clock',
      `read last postponement of ${STUDENT} on ${ENROLLMENT}`,
      'read week',
      `lock sessions ${FIRST},${SECOND}`,
      `lock remedies of ${FIRST}`,
      `lock remedies of ${SECOND}`,
      `read week among ${FIRST},${SECOND}`,
      `insert postponement by ${STUDENT}`,
      `postpone ${FIRST},${SECOND}`,
      'record postponed,postponed',
      `offer ${FIRST}`,
      `offer ${SECOND}`,
      'commit',
    ]);
  });

  it('owes each postponed session its make-up at once, under the same locks (FR-POSTPONE-2)', async () => {
    await postpone(TEACHER);
    expect(trace.filter((step) => step.startsWith('offer '))).toEqual([
      `offer ${FIRST}`,
      `offer ${SECOND}`,
    ]);
  });

  it('tells the other party on the live channel, each session and the enrollment, with no push (FR-POSTPONE-5)', async () => {
    await postpone(TEACHER);
    expect(published).toEqual([
      { to: [STUDENT], event: { type: 'session', sessionId: FIRST, enrollmentId: ENROLLMENT } },
      { to: [STUDENT], event: { type: 'session', sessionId: SECOND, enrollmentId: ENROLLMENT } },
      { to: [STUDENT], event: { type: 'enrollment', enrollmentId: ENROLLMENT } },
    ]);
  });

  it('writes one info line of ids after the commit, never the reason, and each offer’s line', async () => {
    await postpone(STUDENT);
    expect(fieldsOf((line) => line['postponementId'] !== undefined)).toEqual([
      {
        postponementId: POSTPONEMENT,
        enrollmentId: ENROLLMENT,
        userId: STUDENT,
        sessionIds: [FIRST, SECOND],
      },
    ]);
    expect(fieldsOf((line) => line['action'] === 'offered')).toHaveLength(2);
    expect(JSON.stringify(lines)).not.toContain(REASON);
  });
});

describe('sessions.postpone: the refusals (FR-POSTPONE-1, FR-POSTPONE-3, FR-POSTPONE-4)', () => {
  /** What every refusal leaves: nothing written, nothing told, one line of ids and its reason. */
  function expectRefused(error: DomainError, code: string, reason: string, cause?: string) {
    expect(error.code).toBe(code);
    expect(error.details).toEqual(
      cause === undefined ? undefined : [{ path: 'cause', code: cause }],
    );
    expect(written).toEqual([]);
    expect(events).toEqual([]);
    expect(published).toEqual([]);
    expect(trace).toContain('rollback');
    expect(fieldsOf((line) => typeof line['errorCode'] === 'string')).toEqual([
      expect.objectContaining({ enrollmentId: ENROLLMENT, errorCode: code, reason }),
    ]);
    expect(JSON.stringify(lines)).not.toContain(REASON);
  }

  it('answers NOT_FOUND to a person who is not a party, before any lock, and to an enrollment that does not exist', async () => {
    expectRefused(await refusalOf(postpone(STRANGER)), 'NOT_FOUND', 'not_a_party');
    expect(trace.filter((step) => step.startsWith('lock '))).toEqual([]);
    lines = [];
    trace = [];
    terms = null;
    expectRefused(await refusalOf(postpone(STUDENT)), 'NOT_FOUND', 'not_a_party');
  });

  it('answers NOT_FOUND when the other party is of the other gender by the server’s records', async () => {
    standings.set(TEACHER, standing('male'));
    expectRefused(await refusalOf(postpone(STUDENT)), 'NOT_FOUND', 'gender_differs');
  });

  it('refuses ACCOUNT_RESTRICTED while either account is not active, read under the locks', async () => {
    standings.set(TEACHER, { ...standing(), accountStatus: 'suspended' });
    expectRefused(await refusalOf(postpone(STUDENT)), 'ACCOUNT_RESTRICTED', 'party_not_active');
  });

  it('refuses CONFLICT enrollment_not_confirmed when the enrollment is no longer confirmed under the lock', async () => {
    termsUnderLock = enrollment({ status: 'cancelled' });
    expectRefused(
      await refusalOf(postpone(STUDENT)),
      'CONFLICT',
      'enrollment_not_confirmed',
      'enrollment_not_confirmed',
    );
  });

  it('refuses CONFLICT interval_not_passed inside 4 weeks of the caller’s last postponement, read under the locks', async () => {
    lastAt = new Date('2026-10-22T10:00:01.000Z');
    expectRefused(
      await refusalOf(postpone(TEACHER)),
      'CONFLICT',
      'interval_not_passed',
      'interval_not_passed',
    );
  });

  it('admits a postponement exactly 4 weeks after the last', async () => {
    lastAt = new Date('2026-10-22T10:00:00.000Z');
    expect((await postpone(TEACHER)).sessionIds).toEqual([FIRST, SECOND]);
  });

  it('refuses CONFLICT no_session_in_week when no session is left in the week', async () => {
    sessions = sessions.filter(({ id }) => id === NEAR || id === LATER);
    expectRefused(
      await refusalOf(postpone(STUDENT)),
      'CONFLICT',
      'no_session_in_week',
      'no_session_in_week',
    );
  });
});
