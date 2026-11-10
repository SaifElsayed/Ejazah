// T011 of specs/004-sessions — `sessions.get` and `sessions.join` as the service decides them
// (FR-431, FR-432, FR-434, FR-435, FR-436, FR-482, FR-494, FR-499; R-GENDER-7, R-SESS-5;
// contracts/app-surface.md, "`sessions`"; contracts/kernel.md, the `sessions.join` row). Written
// before the service, and run red first.
//
// Over a store that records what it is asked, in order, beside the transaction's begin and commit
// and the video stand-in's calls, so the spec reads the order the kernel's row names: the session
// read to learn its two parties, both accounts locked in one call, the session and both accounts
// read again under the locks, the commit, then `createRoom` and `createSessionToken`. What the
// database refuses or writes is tests/db-integrity/session-join.spec.ts'.
//
//   - a party reads the session in its zone, its length, its join period and the counterparty's
//     name or the deleted stand-in; a non-party, a nonexistent session and a counterparty of the
//     other gender by the server's records answer one NOT_FOUND;
//   - the join from `startsAt − early_join_lead_minutes` until `endsAt`, for a `scheduled` session,
//     both accounts active and the teacher approved, both of one gender, each refusal its code and
//     no video call, one log line with ids and the reason only;
//   - the room created after the commit with the two settings' timeouts, then the token bound to the
//     session and the caller until the scheduled end; a rejoin a new token; the token in no log line.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import type { SessionsGetOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import { bindJoinToken, type VideoPort } from '../../platform/ports/video/video.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CancellationRequestRow } from './cancellation.repository.js';
import type { DisputeView, SessionDisputeFields } from './dispute-view.js';
import type { EnrollmentSide, EnrollmentTerms } from './enrollment-side.port.js';
import type { PartySessionRow } from './sessions.repository.js';
import {
  createSessionsServices,
  type PartyStanding,
  type SessionsServices,
  type SessionsStore,
} from './sessions.service.js';

const SESSION = '0199d0a0-0000-7000-8000-00000000a001';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c001';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c002';
const STRANGER = '0199d0a0-0000-7000-8000-00000000c003';
const NOWHERE = '0199d0a0-0000-7000-8000-00000000a0ff';

/** Sunday 2026-11-08, 17:00 to 17:45 in Cairo (+02:00). */
const STARTS = new Date('2026-11-08T15:00:00.000Z');
const ENDS = new Date('2026-11-08T15:45:00.000Z');
/** `early_join_lead_minutes` 15: the join opens at 14:45Z. */
const OPENS = new Date('2026-11-08T14:45:00.000Z');

const SETTINGS: Record<string, number> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
};

const settings: SettingsReader = {
  read: async (key, schema) => schema.parse(SETTINGS[key]),
};

const row = (overrides: Partial<PartySessionRow> = {}): PartySessionRow => ({
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

const active = (gender: 'male' | 'female', displayName: string): PartyStanding => ({
  gender,
  accountStatus: 'active',
  teacherApproved: false,
  displayName,
});

let trace: string[];
let sessions: Map<string, PartySessionRow>;
let parties: Map<string, PartyStanding>;
/** Applied once the accounts are locked: what another transaction committed meanwhile. */
let underLock: (() => void) | undefined;
/** T021: each session's latest cancellation request, as `sessions.get` reads it. */
let cancellations: Map<string, CancellationRequestRow>;
/** T026: each viewer's dispute fields, as the dispute view answers them; none disputable by default. */
let disputeFields: Map<string, SessionDisputeFields>;
/** T026: what the dispute view was asked, in order. */
let disputeAsked: unknown[][];
/** The provider's address this spec's port answers with every token. */
const SERVER_URL = 'wss://video.spec.invalid';

/**
 * The video port as this spec sees it: what it was asked, in order, and the trace beside the
 * transaction's steps; a room per session, idempotent; a fresh credential per token. A module's spec
 * names no adapter (R-API-4).
 */
class RecordingVideo implements VideoPort {
  readonly calls: { operation: string; args: unknown[] }[] = [];
  readonly #rooms = new Map<string, string>();

  createRoom(...args: Parameters<VideoPort['createRoom']>): Promise<string> {
    trace.push('createRoom');
    this.calls.push({ operation: 'createRoom', args });
    const [sessionId] = args;
    const room = this.#rooms.get(sessionId) ?? `room_${randomUUID()}`;
    this.#rooms.set(sessionId, room);
    return Promise.resolve(room);
  }

  createSessionToken(
    ...args: Parameters<VideoPort['createSessionToken']>
  ): ReturnType<VideoPort['createSessionToken']> {
    trace.push('createSessionToken');
    this.calls.push({ operation: 'createSessionToken', args });
    const [sessionId, participantUserId] = args;
    return Promise.resolve(
      bindJoinToken(sessionId, participantUserId, `credential_${randomUUID()}`, SERVER_URL),
    );
  }

  verifyAndParseParticipantEvent(): ReturnType<VideoPort['verifyAndParseParticipantEvent']> {
    return Promise.reject(new Error('not reached by the join'));
  }

  endRoom(): Promise<void> {
    return Promise.reject(new Error('not reached by the join'));
  }

  roomOf(sessionId: string): string | undefined {
    return this.#rooms.get(sessionId);
  }
}

let video: RecordingVideo;
let lines: Record<string, unknown>[];
let log: Logger;
let now: Date;
let services: SessionsServices;

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

const store: SessionsStore = {
  sessionOfParty: async (_tx, sessionId, userId) => {
    trace.push(`read session as ${userId}`);
    const found = sessions.get(sessionId);
    return found !== undefined && (found.studentUserId === userId || found.teacherUserId === userId)
      ? found
      : null;
  },
  lockAccounts: async (_tx, userIds) => {
    trace.push(`lock users ${[...userIds].join(',')}`);
    underLock?.();
  },
  partiesOf: async (_tx, userIds) => {
    trace.push(`read parties ${[...userIds].join(',')}`);
    return new Map(
      userIds.flatMap((id) => {
        const party = parties.get(id);
        return party === undefined ? [] : [[id, party] as const];
      }),
    );
  },
  latestCancellationOf: async (_tx, sessionId) => {
    trace.push(`read cancellation of ${sessionId}`);
    return cancellations.get(sessionId) ?? null;
  },
};

const terms: EnrollmentTerms = {
  id: ENROLLMENT,
  status: 'confirmed',
  slotId: '0199d0a0-0000-7000-8000-00000000f001',
  track: 'recitation',
  timezone: 'Africa/Cairo',
  durationMinutes: 45,
  sessionCount: 8,
};

/** T026: the dispute view (`dispute-view.ts`) as this spec fakes it; what it reads is its own spec's. */
const disputeView: DisputeView = {
  ofSessions: async (_tx, asked, viewerUserId) => {
    trace.push(`read disputes of ${asked.map(({ id }) => id).join(',')} for ${viewerUserId}`);
    disputeAsked.push([asked, viewerUserId]);
    return new Map(
      asked.map(({ id }) => [id, disputeFields.get(viewerUserId) ?? { canRaiseDispute: false }]),
    );
  },
};

const enrollmentSide = {
  enrollmentFor: async (_tx: Transaction, id: string) => (id === ENROLLMENT ? terms : null),
} as unknown as EnrollmentSide;

beforeEach(() => {
  trace = [];
  sessions = new Map([[SESSION, row()]]);
  parties = new Map([
    [STUDENT, active('female', 'يُسْرى عليّ')],
    [TEACHER, { ...active('female', 'المعلمة سارة'), teacherApproved: true }],
    [STRANGER, active('female', 'زينب حسن')],
  ]);
  underLock = undefined;
  cancellations = new Map();
  disputeFields = new Map();
  disputeAsked = [];
  video = new RecordingVideo();
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
  now = new Date('2026-11-08T14:50:00.000Z');
  services = createSessionsServices({
    transactions,
    settings,
    video,
    enrollmentSide,
    store,
    // T021 and T026: no cancellation is requested and no dispute is raised here.
    idempotency: {
      run: () => Promise.reject(new Error('no cancellation or dispute is keyed here')),
    },
    disputeView,
    now: () => now,
  });
});

/** The refusal `call` ends in, as its code and details. */
async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('answered where it must be refused');
}

/** The log lines that name a refusal, without the logger's own fields. */
function refusalLines(): Record<string, unknown>[] {
  return lines
    .filter((line) => typeof line['errorCode'] === 'string')
    .map(({ sessionId, userId, errorCode, reason }) => ({ sessionId, userId, errorCode, reason }));
}

const studentSees: SessionsGetOutput = {
  sessionId: SESSION,
  enrollmentId: ENROLLMENT,
  sequenceNumber: 3,
  localDate: '2026-11-08',
  startTimeLocal: '17:00',
  timezone: 'Africa/Cairo',
  startsAt: STARTS.toISOString(),
  endsAt: ENDS.toISOString(),
  lengthMinutes: 45,
  status: 'scheduled',
  counterparty: { displayName: 'المعلمة سارة', deleted: false },
  join: { opensAt: OPENS.toISOString(), closesAt: ENDS.toISOString() },
  canRaiseDispute: false,
};

describe('sessions.get (FR-434, FR-494, R-HONEST-4)', () => {
  it('answers the student the session in its zone, its length, its join period and the teacher', async () => {
    expect(await services.get({ userId: STUDENT }, { sessionId: SESSION }, log)).toEqual(
      studentSees,
    );
  });

  it('answers the teacher the same session naming the student, and nothing else of them', async () => {
    const seen = await services.get({ userId: TEACHER }, { sessionId: SESSION }, log);
    expect(seen).toEqual({
      ...studentSees,
      counterparty: { displayName: 'يُسْرى عليّ', deleted: false },
    });
  });

  it('names the session a make-up is for', async () => {
    sessions.set(SESSION, row({ makeupForSequenceNumber: 2 }));
    const seen = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(seen.makeupFor).toEqual({ sequenceNumber: 2 });
  });

  it('answers a session in any status, as stored', async () => {
    sessions.set(SESSION, row({ status: 'cancelled_by_admin' }));
    const seen = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(seen.status).toBe('cancelled_by_admin');
  });

  it('names a deleted counterparty with the stand-in, as T007 answers it (FR-426)', async () => {
    parties.delete(TEACHER);
    const seen = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(seen.counterparty).toEqual({ displayName: null, deleted: true });
  });

  it('answers a non-party, a nonexistent session and the other gender with one NOT_FOUND (R-GENDER-2)', async () => {
    const stranger = await refusalOf(
      services.get({ userId: STRANGER }, { sessionId: SESSION }, log),
    );
    const nowhere = await refusalOf(services.get({ userId: STUDENT }, { sessionId: NOWHERE }, log));
    parties.set(TEACHER, { ...active('male', 'المعلم'), teacherApproved: true });
    const otherGender = await refusalOf(
      services.get({ userId: STUDENT }, { sessionId: SESSION }, log),
    );
    for (const refusal of [stranger, nowhere, otherGender]) {
      expect({ code: refusal.code, message: refusal.message, details: refusal.details }).toEqual({
        code: 'NOT_FOUND',
        message: new DomainError('NOT_FOUND').message,
        details: undefined,
      });
    }
    expect(refusalLines()).toEqual([
      { sessionId: SESSION, userId: STRANGER, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      { sessionId: NOWHERE, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'gender_differs' },
    ]);
  });

  it('reads and locks nothing beyond its one read transaction', async () => {
    await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(trace).toEqual([
      'begin',
      `read session as ${STUDENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      `read cancellation of ${SESSION}`,
      `read disputes of ${SESSION} for ${STUDENT}`,
      'commit',
    ]);
  });
});

// T021: `cancellation`, the session's latest request as each party reads it (FR-456, FR-458,
// FR-495; app-surface.md, `sessions.get`). A stored `pending` reads as `expired` from the start
// and once the session is no longer `scheduled` (the owner's decision of 2026-11-06 on PR #126's
// review, follow-up 3), its expiry the session's start; the reason is shown to both parties.
describe('sessions.get: the cancellation request (T021)', () => {
  const REQUEST = '0199d0a0-0000-7000-8000-00000000d001';
  const pending = (overrides: Partial<CancellationRequestRow> = {}): CancellationRequestRow => ({
    id: REQUEST,
    sessionId: SESSION,
    requestedByUserId: STUDENT,
    reason: 'سفر طارئ',
    status: 'pending',
    ...overrides,
  });
  const statusSeenBy = async (userId: string) =>
    (await services.get({ userId }, { sessionId: SESSION }, log)).cancellation?.status;

  it('answers no cancellation on a session with no request', async () => {
    const seen = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect('cancellation' in seen).toBe(false);
  });

  it('answers the pending request to its requester and to the counterparty, expiring at the start', async () => {
    cancellations.set(SESSION, pending());
    const shown = {
      requestId: REQUEST,
      reason: 'سفر طارئ',
      status: 'pending',
      expiresAt: STARTS.toISOString(),
    };
    const byStudent = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    const byTeacher = await services.get({ userId: TEACHER }, { sessionId: SESSION }, log);
    expect(byStudent.cancellation).toEqual({ ...shown, requestedByMe: true });
    expect(byTeacher.cancellation).toEqual({ ...shown, requestedByMe: false });
  });

  it('reads a pending request as pending one millisecond before the start, and expired at it (FR-458)', async () => {
    cancellations.set(SESSION, pending());
    now = new Date('2026-11-08T14:59:59.999Z');
    expect(await statusSeenBy(TEACHER)).toBe('pending');
    now = STARTS;
    expect(await statusSeenBy(TEACHER)).toBe('expired');
  });

  it.each(['cancelled_by_admin', 'done'] as const)(
    'reads a pending request on a session %s as over: expired',
    async (status) => {
      sessions.set(SESSION, row({ status }));
      cancellations.set(SESSION, pending());
      expect(await statusSeenBy(TEACHER)).toBe('expired');
    },
  );

  it.each(['accepted', 'declined', 'expired'] as const)(
    'answers a request %s as stored',
    async (status) => {
      cancellations.set(SESSION, pending({ status }));
      expect(await statusSeenBy(STUDENT)).toBe(status);
    },
  );
});

describe('sessions.join: admitted (FR-431, FR-435, R-GENDER-7)', () => {
  it('locks the two accounts in id order whichever is the student (kernel.md, rule 2)', async () => {
    // A teacher whose id sorts before the student's.
    const earlier = '0199d0a0-0000-7000-8000-00000000b001';
    sessions.set(SESSION, row({ teacherUserId: earlier }));
    parties.set(earlier, { ...active('female', 'المعلمة هدى'), teacherApproved: true });
    await services.join({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(trace.filter((step) => step.startsWith('lock'))).toEqual([
      `lock users ${earlier},${STUDENT}`,
    ]);
  });

  it('locks both accounts in one call, reads under the locks, commits, then creates the room and mints', async () => {
    const joined = await services.join({ userId: STUDENT }, { sessionId: SESSION }, log);

    expect(trace).toEqual([
      'begin',
      `read session as ${STUDENT}`,
      `lock users ${STUDENT},${TEACHER}`,
      `read session as ${STUDENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      'commit',
      'createRoom',
      'createSessionToken',
    ]);
    const [room, token] = video.calls;
    expect(room).toEqual({
      operation: 'createRoom',
      args: [SESSION, { emptyTimeoutSeconds: 300, departureTimeoutSeconds: 20 }],
    });
    expect(token).toEqual({
      operation: 'createSessionToken',
      args: [SESSION, STUDENT, { validUntil: ENDS }],
    });
    expect(joined).toEqual({
      sessionId: SESSION,
      serverUrl: SERVER_URL,
      token: expect.stringMatching(/^credential_/) as unknown,
      validUntil: ENDS.toISOString(),
    });
  });

  it('opens at startsAt − the lead and stays open until just before endsAt', async () => {
    now = OPENS;
    await expect(
      services.join({ userId: TEACHER }, { sessionId: SESSION }, log),
    ).resolves.toMatchObject({ sessionId: SESSION });
    now = new Date('2026-11-08T15:44:59.999Z');
    await expect(
      services.join({ userId: STUDENT }, { sessionId: SESSION }, log),
    ).resolves.toMatchObject({ sessionId: SESSION });
  });

  it('answers a rejoin with a new token for the same room (FR-435)', async () => {
    const first = await services.join({ userId: STUDENT }, { sessionId: SESSION }, log);
    const again = await services.join({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(again.token).not.toBe(first.token);
    // `createRoom` is asked each time and answers the one room, as the port promises (idempotent).
    const rooms = video.calls.filter(({ operation }) => operation === 'createRoom');
    expect(rooms.map(({ args }) => args[0])).toEqual([SESSION, SESSION]);
    expect(video.roomOf(SESSION)).toBeDefined();
  });

  it('mints each party a token bound to themselves, never the other’s (R-GENDER-7)', async () => {
    const student = await services.join({ userId: STUDENT }, { sessionId: SESSION }, log);
    const teacher = await services.join({ userId: TEACHER }, { sessionId: SESSION }, log);
    expect(teacher.token).not.toBe(student.token);
    const minted = video.calls
      .filter(({ operation }) => operation === 'createSessionToken')
      .map(({ args }) => args.slice(0, 2));
    expect(minted).toEqual([
      [SESSION, STUDENT],
      [SESSION, TEACHER],
    ]);
  });

  it('writes the token and its credential in no log line (R-SEC-2)', async () => {
    const joined = await services.join({ userId: STUDENT }, { sessionId: SESSION }, log);
    const written = JSON.stringify(lines);
    expect(written).not.toContain(joined.token);
    expect(lines.map(({ msg, sessionId, userId }) => ({ msg, sessionId, userId }))).toEqual([
      { msg: 'A join token was issued', sessionId: SESSION, userId: STUDENT },
    ]);
  });
});

describe('sessions.join: refused, with no video call (FR-431, FR-432, FR-482, R-SESS-5)', () => {
  async function refused(userId: string, sessionId = SESSION): Promise<DomainError> {
    const refusal = await refusalOf(services.join({ userId }, { sessionId }, log));
    expect(video.calls, 'no room and no token for a refused join').toEqual([]);
    return refusal;
  }

  it('answers a non-party and a nonexistent session NOT_FOUND before any lock', async () => {
    expect((await refused(STRANGER)).code).toBe('NOT_FOUND');
    expect((await refused(STUDENT, NOWHERE)).code).toBe('NOT_FOUND');
    expect(trace.filter((step) => step.startsWith('lock'))).toEqual([]);
  });

  it('answers a counterparty of the other gender NOT_FOUND, as a nonexistent session', async () => {
    parties.set(TEACHER, { ...active('male', 'المعلم'), teacherApproved: true });
    const refusal = await refused(STUDENT);
    expect({ code: refusal.code, details: refusal.details }).toEqual({
      code: 'NOT_FOUND',
      details: undefined,
    });
  });

  it('reads the gender under the accounts’ locks, never from before them (K2)', async () => {
    // The join's own first read saw one gender; a correction committed while it waited on the
    // locks is what the read under them answers.
    underLock = () => {
      parties.set(TEACHER, { ...active('male', 'المعلم'), teacherApproved: true });
    };
    expect((await refused(STUDENT)).code).toBe('NOT_FOUND');
    expect(refusalLines()).toEqual([
      { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'gender_differs' },
    ]);
  });

  it('refuses ACCOUNT_RESTRICTED when either account is not active or the teacher not approved', async () => {
    const cases: [string, () => void][] = [
      [
        'teacher suspended',
        () => parties.set(TEACHER, { ...parties.get(TEACHER)!, accountStatus: 'suspended' }),
      ],
      [
        'teacher banned',
        () => parties.set(TEACHER, { ...parties.get(TEACHER)!, accountStatus: 'banned' }),
      ],
      [
        'teacher revoked',
        () => parties.set(TEACHER, { ...parties.get(TEACHER)!, teacherApproved: false }),
      ],
      [
        'student under an identity request',
        () =>
          parties.set(STUDENT, {
            ...parties.get(STUDENT)!,
            accountStatus: 'verification_required',
          }),
      ],
      [
        'student suspended',
        () => parties.set(STUDENT, { ...parties.get(STUDENT)!, accountStatus: 'suspended' }),
      ],
      ['teacher deleted', () => parties.delete(TEACHER)],
    ];
    const healthy = new Map(parties);
    for (const [, restrict] of cases) {
      parties = new Map(healthy);
      restrict();
      for (const caller of [STUDENT, TEACHER]) {
        if (!parties.has(caller)) continue;
        const refusal = await refused(caller);
        expect({ code: refusal.code, details: refusal.details }).toEqual({
          code: 'ACCOUNT_RESTRICTED',
          details: undefined,
        });
      }
    }
    expect(new Set(refusalLines().map(({ reason }) => reason))).toEqual(
      new Set(['party_not_active', 'teacher_not_approved']),
    );
  });

  it('refuses a session no longer scheduled SESSION_NOT_SCHEDULED', async () => {
    for (const status of [
      'cancelled_by_admin',
      'cancelled_by_agreement',
      'done',
      'disputed',
    ] as const) {
      sessions.set(SESSION, row({ status }));
      expect((await refused(STUDENT)).code).toBe('SESSION_NOT_SCHEDULED');
    }
  });

  it('refuses before the lead JOIN_NOT_OPEN with opensAt, and from endsAt JOIN_CLOSED', async () => {
    now = new Date('2026-11-08T14:44:59.999Z');
    const early = await refused(STUDENT);
    expect({ code: early.code, details: early.details }).toEqual({
      code: 'JOIN_NOT_OPEN',
      details: [{ path: 'opensAt', code: OPENS.toISOString() }],
    });
    now = ENDS;
    expect((await refused(TEACHER)).code).toBe('JOIN_CLOSED');
    expect(refusalLines()).toEqual([
      { sessionId: SESSION, userId: STUDENT, errorCode: 'JOIN_NOT_OPEN', reason: 'before_open' },
      { sessionId: SESSION, userId: TEACHER, errorCode: 'JOIN_CLOSED', reason: 'after_end' },
    ]);
  });

  it('rolls the transaction back on every refusal, so nothing it read is acted on', async () => {
    now = ENDS;
    await refused(STUDENT);
    expect(trace.at(-1)).toBe('rollback');
  });
});

// T026: `dispute`, `canRaiseDispute` and `disputeClosesAt` (FR-473, FR-495; app-surface.md,
// `sessions.get`), read for the caller through the dispute view in the read's own transaction, after
// the cancellation; what the view decides (the window, the latest dispute, a cancelled session's
// none) is `dispute-view.spec.ts`'.
describe('sessions.get: the dispute (T026)', () => {
  const CLOSES = '2026-11-11T15:45:00.000Z';

  it('asks the view for the session as stored and the caller, and answers each party its own fields', async () => {
    sessions.set(SESSION, row({ status: 'disputed' }));
    disputeFields.set(STUDENT, {
      dispute: { status: 'open', raisedByMe: true, closesAt: CLOSES },
      canRaiseDispute: false,
      disputeClosesAt: CLOSES,
    });
    disputeFields.set(TEACHER, {
      dispute: { status: 'open', raisedByMe: false, closesAt: CLOSES },
      canRaiseDispute: false,
      disputeClosesAt: CLOSES,
    });
    const byStudent = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    const byTeacher = await services.get({ userId: TEACHER }, { sessionId: SESSION }, log);
    expect(byStudent).toEqual({ ...studentSees, status: 'disputed', ...disputeFields.get(STUDENT) });
    expect(byTeacher.dispute).toEqual({ status: 'open', raisedByMe: false, closesAt: CLOSES });
    expect(disputeAsked).toEqual([
      [[{ id: SESSION, status: 'disputed', endsAt: ENDS }], STUDENT],
      [[{ id: SESSION, status: 'disputed', endsAt: ENDS }], TEACHER],
    ]);
  });

  it('answers a session the caller may dispute now with its window, and no dispute', async () => {
    sessions.set(SESSION, row({ status: 'done' }));
    disputeFields.set(STUDENT, { canRaiseDispute: true, disputeClosesAt: CLOSES });
    const seen = await services.get({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(seen.canRaiseDispute).toBe(true);
    expect(seen.disputeClosesAt).toBe(CLOSES);
    expect('dispute' in seen).toBe(false);
  });

  it('asks nothing of the view for a session refused NOT_FOUND', async () => {
    await refusalOf(services.get({ userId: STRANGER }, { sessionId: SESSION }, log));
    expect(disputeAsked).toEqual([]);
  });
});
