// T011 of specs/004-sessions — `sessions.get` and `sessions.join` as the user surface serves them
// (contracts/app-surface.md, "`sessions`"; contracts/README.md, "Callers"; FR-431, FR-432, FR-434).
//
// Both are the participant kind: an anonymous caller is UNAUTHENTICATED and a suspended or banned
// account, student or teacher, ACCOUNT_RESTRICTED, none of them reaching the service. The service
// is handed the session's own account and the session id, never anything else the input says
// (R-GENDER-4); what it answers is parsed by the output schema, which strips any field it does not
// name (R-HONEST-4); its NOT_FOUND reaches the client with no field. The authorization gate
// (R-MOBILE-13, `pnpm check:authz`) reads these cases by path. What the service decides is
// sessions.service.spec.ts'.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import {
  RateLimiter,
  SIGNED_IN_DEFAULT_RATE_LIMIT,
} from '../../platform/guards/rate-limit.guard.js';
import type { LiveBus, LiveMessage } from '../../platform/live/live-bus.js';
import type { LiveRegistry } from '../../platform/live/live-registry.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { sessionsRouter } from './sessions.router.js';
import {
  createSessionsServices,
  type SessionsServices,
  type SessionsStore,
} from './sessions.service.js';

const CALLER = '0199d0a0-0000-7000-8000-00000000d001';
const OTHER = '0199d0a0-0000-7000-8000-00000000d002';
const SESSION = '0199d0a0-0000-7000-8000-00000000d0a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000d0e1';
// T060.
const COMPLAINT = '0199d0a0-0000-7000-8000-00000000d0f1';

const surfaceRouter = createAppRouter({ sessions: sessionsRouter });
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Who =
  | 'student'
  | 'teacher'
  | 'suspended student'
  | 'banned student'
  | 'suspended teacher'
  | 'banned teacher';

function sessionOf(who: Who, gender: 'male' | 'female' = 'female'): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-00000000d0f9',
    gender,
    preferredLanguage: 'ar' as const,
  };
  const accountStatus = who.startsWith('suspended')
    ? 'suspended'
    : who.startsWith('banned')
      ? 'banned'
      : 'active';
  if (who.endsWith('teacher')) {
    return {
      ...base,
      role: 'teacher',
      accountStatus,
      teacher: {
        verificationStatus: accountStatus === 'active' ? 'approved' : accountStatus,
        payoutVerified: true,
        applicationStatus: 'approved',
      },
    };
  }
  return { ...base, role: 'student', accountStatus };
}

const got = {
  sessionId: SESSION,
  enrollmentId: ENROLLMENT,
  sequenceNumber: 1,
  localDate: '2026-11-12',
  startTimeLocal: '09:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-12T07:00:00.000Z',
  endsAt: '2026-11-12T08:00:00.000Z',
  lengthMinutes: 60 as const,
  status: 'scheduled' as const,
  counterparty: { userId: OTHER, displayName: 'أحمد سالم', deleted: false },
  join: { opensAt: '2026-11-12T06:45:00.000Z', closesAt: '2026-11-12T08:00:00.000Z' },
  // T065: required by the output schema.
  counterpartyInRoom: false,
};

const joined = {
  sessionId: SESSION,
  serverUrl: 'wss://video-stand-in.invalid',
  token: 'fake_vtk_spec',
  validUntil: '2026-11-12T08:00:00.000Z',
  // 004:T084: required by the output schema; a stand-in shape, never a real key.
  mediaKey: Buffer.alloc(32, 6).toString('base64'),
};

// T021.
const REQUEST = '0199d0a0-0000-7000-8000-00000000d0c1';
const KEY = 'cancel-key-0199d0a0-0001';
const requested = {
  requestId: REQUEST,
  status: 'pending' as const,
  expiresAt: '2026-11-12T07:00:00.000Z',
};
const answered = {
  requestId: REQUEST,
  status: 'accepted' as const,
  sessionStatus: 'cancelled_by_agreement' as const,
};

// T026.
const DISPUTE = '0199d0a0-0000-7000-8000-00000000d0d1';
const DISPUTE_KEY = 'dispute-key-0000000001';
const raised = { disputeId: DISPUTE, status: 'open' as const };

// 003:T112.
const POSTPONE_KEY = 'postpone-key-0000000001';
const postponed = { postponementId: DISPUTE, sessionIds: [SESSION] };

let calls: unknown[][];

const sessions: SessionsServices = {
  get: async (caller, input) => {
    calls.push(['get', caller, input]);
    if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
    // Fields no schema names, as a careless service might add them: stripped (R-HONEST-4).
    return {
      ...got,
      counterparty: { ...got.counterparty, dateOfBirth: '2012-01-01' },
      providerRoomId: 'room',
    } as never;
  },
  join: async (caller, input) => {
    calls.push(['join', caller, input]);
    if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
    return { ...joined, participantUserId: CALLER } as never;
  },
  // T021.
  cancellation: {
    request: async (caller, input) => {
      calls.push(['request', caller, input]);
      if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
      return { ...requested, reason: input.reason, requestedByUserId: CALLER } as never;
    },
    answer: async (caller, input) => {
      calls.push(['answer', caller, input]);
      if (input.requestId !== REQUEST) throw new DomainError('NOT_FOUND');
      return { ...answered, sessionId: SESSION, respondedAt: 'now' } as never;
    },
  },
  // T026.
  raiseDispute: async (caller, input) => {
    calls.push(['raiseDispute', caller, input]);
    if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
    // A field no schema names, as a careless service might add it: stripped (R-HONEST-4).
    return { ...raised, raisedByUserId: CALLER } as never;
  },
  // 003:T112.
  postpone: async (caller, input, _log, live) => {
    calls.push(['postpone', caller, input, typeof live.afterCommit]);
    if (input.enrollmentId !== ENROLLMENT) throw new DomainError('NOT_FOUND');
    // A field no schema names, as a careless service might add it: stripped (R-HONEST-4).
    return { ...postponed, reason: input.reason } as never;
  },
  // 004:T084.
  encryptionFailed: async (caller, input) => {
    calls.push(['encryptionFailed', caller, input]);
    if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
  },
  // T060.
  complaint: {
    raise: async (caller, input) => {
      calls.push(['complaint.raise', caller, input]);
      if (input.enrollmentId !== ENROLLMENT) throw new DomainError('NOT_FOUND');
      // A field no schema names, as a careless service might add it: stripped (R-HONEST-4).
      return { complaintId: COMPLAINT, status: 'open', reason: input.reason } as never;
    },
  },
  // T031.
  remedy: {
    choose: async (caller, input) => {
      calls.push(['choose', caller, input]);
      if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
      return { ...remedied, caseId: OTHER } as never;
    },
    accept: async (caller, input) => {
      calls.push(['accept', caller, input]);
      if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
      return { ...accepted, enrollmentId: ENROLLMENT } as never;
    },
    counterOptions: async (caller, input) => {
      calls.push(['counterOptions', caller, input]);
      if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
      return { options: [{ ...option, teacherUserId: OTHER }] } as never;
    },
    counter: async (caller, input) => {
      calls.push(['counter', caller, input]);
      if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
      return { ...remedied, snapshotAnswerWindowHours: 72 } as never;
    },
    // T032.
    answerCounter: async (caller, input) => {
      calls.push(['answerCounter', caller, input]);
      if (input.sessionId !== SESSION) throw new DomainError('NOT_FOUND');
      return { ...remedied, counterProposedAt: 'now' } as never;
    },
  },
};

// T031: what the remedy's procedures answer, and the extra field each careless answer above adds
// (stripped, R-HONEST-4).
const remedied = {
  status: 'proposed' as const,
  kind: 'makeup' as const,
  offeredAt: '2026-11-01T10:00:00.000Z',
  choiceClosesAt: '2026-11-08T10:00:00.000Z',
  proposal: {
    localDate: '2026-11-15',
    startTimeLocal: '09:00',
    timezone: 'Africa/Cairo',
    startsAt: '2026-11-15T07:00:00.000Z',
  },
  canChooseRefund: false,
};
const accepted = { ...remedied, status: 'booked' as const, makeupSessionId: DISPUTE };
const option = {
  slotId: REQUEST,
  localDate: '2026-11-16',
  startTimeLocal: '18:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-16T16:00:00Z',
};
const COUNTER_KEY = 'counter-key-0000000001';

beforeEach(() => {
  calls = [];
});

function callerAs(session: UserSession | null): Caller {
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    catalog: unusedCatalogServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const procedures = {
  'sessions.get': (caller: Caller, sessionId = SESSION) => caller.sessions.get({ sessionId }),
  'sessions.join': (caller: Caller, sessionId = SESSION) => caller.sessions.join({ sessionId }),
  'sessions.cancellation.request': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.cancellation.request({ sessionId, reason: 'سفر طارئ', idempotencyKey: KEY }),
  'sessions.cancellation.answer': (caller: Caller, requestId = REQUEST) =>
    caller.sessions.cancellation.answer({ requestId, accept: true }),
  'sessions.dispute.raise': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.dispute.raise({
      sessionId,
      reason: 'لم يحضر المعلم',
      idempotencyKey: DISPUTE_KEY,
    }),
  // T031.
  'sessions.remedy.choose': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.remedy.choose({ sessionId, choice: 'makeup' }),
  'sessions.remedy.accept': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.remedy.accept({ sessionId }),
  'sessions.remedy.counterOptions': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.remedy.counterOptions({ sessionId }),
  'sessions.remedy.counter': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.remedy.counter({
      sessionId,
      slotId: REQUEST,
      localDate: '2026-11-16',
      idempotencyKey: COUNTER_KEY,
    }),
  // T032.
  'sessions.remedy.answerCounter': (caller: Caller, sessionId = SESSION) =>
    caller.sessions.remedy.answerCounter({ sessionId, accept: true }),
  // 003:T112.
  'sessions.postpone': (caller: Caller, enrollmentId = ENROLLMENT) =>
    caller.sessions.postpone({ enrollmentId, reason: 'سفر طارئ', idempotencyKey: POSTPONE_KEY }),
} as const;

const metaOf = (path: string): unknown =>
  (surfaceRouter._def.procedures as unknown as Record<string, { _def: { meta?: unknown } }>)[path]
    ?._def.meta;

describe("'sessions.get' (T011)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'sessions.get'", async () => {
    await expect(procedures['sessions.get'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or banned student or teacher ACCOUNT_RESTRICTED before the service: 'sessions.get'", async () => {
    for (const who of [
      'suspended student',
      'banned student',
      'suspended teacher',
      'banned teacher',
    ] as const) {
      await expect(procedures['sessions.get'](callerAs(sessionOf(who))), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the session's own account and the session id, whatever else the input says: 'sessions.get'", async () => {
    for (const who of ['student', 'teacher'] as const) {
      await callerAs(sessionOf(who)).sessions.get({
        sessionId: SESSION,
        userId: OTHER,
        gender: 'male',
        role: 'student',
      } as never);
    }
    expect(calls).toEqual([
      ['get', { userId: CALLER }, { sessionId: SESSION }],
      ['get', { userId: CALLER }, { sessionId: SESSION }],
    ]);
  });

  it("answers the session parsed by the output schema, which strips a field it does not name: 'sessions.get'", async () => {
    expect(await procedures['sessions.get'](callerAs(sessionOf('teacher')))).toEqual(got);
  });

  it("answers the service's NOT_FOUND with no field: 'sessions.get'", async () => {
    const thrown: unknown = await procedures['sessions.get'](
      callerAs(sessionOf('student')),
      OTHER,
    ).catch((error: unknown) => error);
    const { status, body } = toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
    expect(status).toBe(404);
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  });

  it("refuses a session id that is not an id VALIDATION_FAILED before the service: 'sessions.get'", async () => {
    const thrown: unknown = await procedures['sessions.get'](
      callerAs(sessionOf('student')),
      'not-an-id',
    ).catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });

  it("is stamped with the participant kind: 'sessions.get'", () => {
    expect(metaOf('sessions.get')).toEqual({ surface: 'app', caller: 'participant' });
  });
});

describe("'sessions.join' (T011)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'sessions.join'", async () => {
    await expect(procedures['sessions.join'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or banned student or teacher ACCOUNT_RESTRICTED before the service: 'sessions.join'", async () => {
    for (const who of [
      'suspended student',
      'banned student',
      'suspended teacher',
      'banned teacher',
    ] as const) {
      await expect(procedures['sessions.join'](callerAs(sessionOf(who))), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the session's own account and the session id, whatever else the input says: 'sessions.join'", async () => {
    for (const who of ['student', 'teacher'] as const) {
      await callerAs(sessionOf(who)).sessions.join({
        sessionId: SESSION,
        participantUserId: OTHER,
        gender: 'male',
      } as never);
    }
    expect(calls).toEqual([
      ['join', { userId: CALLER }, { sessionId: SESSION }],
      ['join', { userId: CALLER }, { sessionId: SESSION }],
    ]);
  });

  it("answers the token parsed by the output schema, which strips a field it does not name: 'sessions.join'", async () => {
    expect(await procedures['sessions.join'](callerAs(sessionOf('student')))).toEqual(joined);
  });

  it("is a mutation stamped with the participant kind: 'sessions.join'", () => {
    expect(metaOf('sessions.join')).toEqual({ surface: 'app', caller: 'participant' });
    const procedure = (
      surfaceRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>
    )['sessions.join'];
    expect(procedure?._def.type).toBe('mutation');
  });

  // PR #129's review, round 1, Minor 2 (the owner's decision of 2026-11-08; T062): no limit of its
  // own, so the participant kind's signed-in default counts the join, and a join past it is
  // refused before the real service runs: no transaction opened, no room, no token.
  it("refuses a join past the signed-in default RATE_LIMITED, never reaching createRoom nor writing anything: 'sessions.join'", async () => {
    const opened = vi.fn();
    const video = {
      createRoom: vi.fn(async () => 'room'),
      createSessionToken: vi.fn(async () => {
        throw new Error('no token is issued here');
      }),
      verifyAndParseParticipantEvent: vi.fn(),
      endRoom: vi.fn(),
    };
    const realSessions = createSessionsServices({
      transactions: {
        run: async () => {
          opened();
          throw new Error('no transaction is opened here');
        },
      },
      settings: { read: async () => Promise.reject(new Error('no setting is read here')) },
      video,
      enrollmentSide: {} as never,
      store: {} as SessionsStore,
      // 005:T016: no cancellation is requested or answered here.
      notifications: { record: () => Promise.reject(new Error('no push is recorded here')) },
      idempotency: {
        run: async () => {
          opened();
          throw new Error('no transaction is opened here');
        },
      },
    });
    const read: string[] = [];
    // The caller already made the window's one call: this one is the limit plus one.
    const rateLimiter = new RateLimiter({
      settings: {
        read: async (key, schema) => {
          read.push(key);
          return schema.parse({ limit: 1, window_seconds: 60 });
        },
      },
      counter: { hit: async () => 2 },
      subjectKey: Buffer.alloc(32, 5),
    });
    const services: AppServices = {
      settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      teacherProfile: unusedTeacherProfileServices,
      catalog: unusedCatalogServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions: realSessions,
      chat: unusedChatServices,
      certification: unusedCertificationServices,
      moderation: unusedModerationServices,
    };
    const log = createLogger({ level: 'info', destination: { write: () => undefined } });
    const caller = callerFor(
      createAppContext({
        session: sessionOf('student'),
        log,
        rateLimiter,
        clientAddress: '203.0.113.9',
        services,
      }),
    );

    const thrown: unknown = await procedures['sessions.join'](caller).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(toErrorShape(thrown as never).body.code).toBe('RATE_LIMITED');
    expect(read).toEqual([SIGNED_IN_DEFAULT_RATE_LIMIT]);
    expect(opened).not.toHaveBeenCalled();
    expect(video.createRoom).not.toHaveBeenCalled();
    expect(video.createSessionToken).not.toHaveBeenCalled();
  });
});

// 003:T112 (SRS FR-POSTPONE-1, DEC-90): `sessions.postpone`, a keyed mutation of the participant kind,
// handing the service the caller's own account, the validated input and the request's live list.
// Written before the procedure, run red first.
describe("'sessions.postpone' (003:T112)", () => {
  it('refuses an anonymous, a suspended and a banned caller before the service', async () => {
    await expect(procedures['sessions.postpone'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of ['suspended student', 'banned teacher'] as const) {
      await expect(procedures['sessions.postpone'](callerAs(sessionOf(who))), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it('hands the service the caller’s own account, the trimmed input and the live list, whatever else it says', async () => {
    for (const who of ['student', 'teacher'] as const) {
      await callerAs(sessionOf(who)).sessions.postpone({
        enrollmentId: ENROLLMENT,
        reason: '  سفر طارئ ',
        idempotencyKey: POSTPONE_KEY,
        userId: OTHER,
      } as never);
    }
    const handed = [
      'postpone',
      { userId: CALLER },
      { enrollmentId: ENROLLMENT, reason: 'سفر طارئ', idempotencyKey: POSTPONE_KEY },
      'function',
    ];
    expect(calls).toEqual([handed, handed]);
  });

  it('answers the postponement parsed by the output schema, which strips a field it does not name', async () => {
    expect(await procedures['sessions.postpone'](callerAs(sessionOf('student')))).toEqual(
      postponed,
    );
  });

  it('refuses a blank reason or a missing key VALIDATION_FAILED before the service', async () => {
    const caller = callerAs(sessionOf('teacher'));
    for (const input of [
      { enrollmentId: ENROLLMENT, reason: '   ', idempotencyKey: POSTPONE_KEY },
      { enrollmentId: ENROLLMENT, reason: 'سفر' },
    ]) {
      const thrown: unknown = await caller.sessions
        .postpone(input as never)
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
  });

  it('is a mutation stamped with the participant kind, with no limit of its own', () => {
    expect(metaOf('sessions.postpone')).toEqual({ surface: 'app', caller: 'participant' });
    const procedure = (
      surfaceRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>
    )['sessions.postpone'];
    expect(procedure?._def.type).toBe('mutation');
  });
});

// T021 of specs/004-sessions: `sessions.cancellation.request` and `.answer`, the participant kind,
// each a mutation handing the service the caller's own account and the validated input only.
describe("'sessions.cancellation.request' (T021)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'sessions.cancellation.request'", async () => {
    await expect(procedures['sessions.cancellation.request'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or banned student or teacher ACCOUNT_RESTRICTED before the service: 'sessions.cancellation.request'", async () => {
    for (const who of [
      'suspended student',
      'banned student',
      'suspended teacher',
      'banned teacher',
    ] as const) {
      await expect(
        procedures['sessions.cancellation.request'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the trimmed input, whatever else it says: 'sessions.cancellation.request'", async () => {
    for (const who of ['student', 'teacher'] as const) {
      await callerAs(sessionOf(who)).sessions.cancellation.request({
        sessionId: SESSION,
        reason: '  سفر طارئ ',
        idempotencyKey: KEY,
        userId: OTHER,
        gender: 'male',
      } as never);
    }
    const handed = [
      'request',
      { userId: CALLER },
      { sessionId: SESSION, reason: 'سفر طارئ', idempotencyKey: KEY },
    ];
    expect(calls).toEqual([handed, handed]);
  });

  it("answers the request parsed by the output schema, which strips a field it does not name: 'sessions.cancellation.request'", async () => {
    expect(
      await procedures['sessions.cancellation.request'](callerAs(sessionOf('student'))),
    ).toEqual(requested);
  });

  it("refuses a blank reason or a missing key VALIDATION_FAILED before the service: 'sessions.cancellation.request'", async () => {
    const caller = callerAs(sessionOf('student'));
    for (const input of [
      { sessionId: SESSION, reason: '   ', idempotencyKey: KEY },
      { sessionId: SESSION, reason: 'سفر' },
    ]) {
      const thrown: unknown = await caller.sessions.cancellation
        .request(input as never)
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
  });

  it("answers the service's NOT_FOUND with no field: 'sessions.cancellation.request'", async () => {
    const thrown: unknown = await procedures['sessions.cancellation.request'](
      callerAs(sessionOf('teacher')),
      OTHER,
    ).catch((error: unknown) => error);
    const { status, body } = toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
    expect(status).toBe(404);
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  });

  it("is a mutation stamped with the participant kind: 'sessions.cancellation.request'", () => {
    expect(metaOf('sessions.cancellation.request')).toEqual({
      surface: 'app',
      caller: 'participant',
    });
    const procedure = (
      surfaceRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>
    )['sessions.cancellation.request'];
    expect(procedure?._def.type).toBe('mutation');
  });
});

describe("'sessions.cancellation.answer' (T021)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'sessions.cancellation.answer'", async () => {
    await expect(procedures['sessions.cancellation.answer'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or banned student or teacher ACCOUNT_RESTRICTED before the service: 'sessions.cancellation.answer'", async () => {
    for (const who of [
      'suspended student',
      'banned student',
      'suspended teacher',
      'banned teacher',
    ] as const) {
      await expect(
        procedures['sessions.cancellation.answer'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the request and the answer, whatever else the input says: 'sessions.cancellation.answer'", async () => {
    for (const who of ['student', 'teacher'] as const) {
      await callerAs(sessionOf(who)).sessions.cancellation.answer({
        requestId: REQUEST,
        accept: false,
        userId: OTHER,
        sessionId: SESSION,
      } as never);
    }
    const handed = ['answer', { userId: CALLER }, { requestId: REQUEST, accept: false }];
    expect(calls).toEqual([handed, handed]);
  });

  it("answers the answer parsed by the output schema, which strips a field it does not name: 'sessions.cancellation.answer'", async () => {
    expect(
      await procedures['sessions.cancellation.answer'](callerAs(sessionOf('teacher'))),
    ).toEqual(answered);
  });

  it("answers the service's NOT_FOUND with no field: 'sessions.cancellation.answer'", async () => {
    const thrown: unknown = await procedures['sessions.cancellation.answer'](
      callerAs(sessionOf('student')),
      OTHER,
    ).catch((error: unknown) => error);
    const { status, body } = toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
    expect(status).toBe(404);
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  });

  it("is a mutation stamped with the participant kind: 'sessions.cancellation.answer'", () => {
    expect(metaOf('sessions.cancellation.answer')).toEqual({
      surface: 'app',
      caller: 'participant',
    });
    const procedure = (
      surfaceRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>
    )['sessions.cancellation.answer'];
    expect(procedure?._def.type).toBe('mutation');
  });
});

describe("'sessions.dispute.raise' (T026)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'sessions.dispute.raise'", async () => {
    await expect(procedures['sessions.dispute.raise'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or banned student or teacher ACCOUNT_RESTRICTED before the service: 'sessions.dispute.raise'", async () => {
    for (const who of [
      'suspended student',
      'banned student',
      'suspended teacher',
      'banned teacher',
    ] as const) {
      await expect(
        procedures['sessions.dispute.raise'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the session's own account and the input, whatever else it says: 'sessions.dispute.raise'", async () => {
    for (const who of ['student', 'teacher'] as const) {
      await callerAs(sessionOf(who)).sessions.dispute.raise({
        sessionId: SESSION,
        reason: 'لم يحضر المعلم',
        idempotencyKey: DISPUTE_KEY,
        userId: OTHER,
        gender: 'male',
      } as never);
    }
    const handed = [
      'raiseDispute',
      { userId: CALLER },
      { sessionId: SESSION, reason: 'لم يحضر المعلم', idempotencyKey: DISPUTE_KEY },
    ];
    expect(calls).toEqual([handed, handed]);
  });

  it("answers the dispute parsed by the output schema, which strips a field it does not name: 'sessions.dispute.raise'", async () => {
    expect(await procedures['sessions.dispute.raise'](callerAs(sessionOf('student')))).toEqual(
      raised,
    );
  });

  // The owner's decision of 2026-11-10: the reason is trimmed before its bounds, as a cancellation
  // request's is, so a reason of spaces only is refused (no migration: `disputes` checks no blank).
  it("refuses a reason of spaces only VALIDATION_FAILED before the service, and hands it a reason trimmed: 'sessions.dispute.raise'", async () => {
    const caller = callerAs(sessionOf('student'));
    const thrown: unknown = await caller.sessions.dispute
      .raise({ sessionId: SESSION, reason: '   ', idempotencyKey: DISPUTE_KEY })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
    await caller.sessions.dispute.raise({
      sessionId: SESSION,
      reason: '  لم يحضر المعلم ',
      idempotencyKey: DISPUTE_KEY,
    });
    expect(calls).toEqual([
      [
        'raiseDispute',
        { userId: CALLER },
        { sessionId: SESSION, reason: 'لم يحضر المعلم', idempotencyKey: DISPUTE_KEY },
      ],
    ]);
  });

  it("refuses an empty or over-long reason, a malformed key or session id VALIDATION_FAILED before the service: 'sessions.dispute.raise'", async () => {
    for (const input of [
      { sessionId: SESSION, reason: '', idempotencyKey: DISPUTE_KEY },
      { sessionId: SESSION, reason: 'x'.repeat(501), idempotencyKey: DISPUTE_KEY },
      { sessionId: SESSION, reason: 'سبب', idempotencyKey: 'short' },
      { sessionId: 'not-an-id', reason: 'سبب', idempotencyKey: DISPUTE_KEY },
    ]) {
      const thrown: unknown = await callerAs(sessionOf('student'))
        .sessions.dispute.raise(input)
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
  });

  it("is a mutation stamped with the participant kind: 'sessions.dispute.raise'", () => {
    expect(metaOf('sessions.dispute.raise')).toEqual({ surface: 'app', caller: 'participant' });
    const procedure = (
      surfaceRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>
    )['sessions.dispute.raise'];
    expect(procedure?._def.type).toBe('mutation');
  });
});

// T031 of specs/004-sessions: `sessions.remedy.choose`, `.accept`, `.counterOptions` and `.counter`,
// the participant kind (the student's own refusal of the teacher is the service's NOT_FOUND), each
// handing the service the caller's own account and the validated input only; `counterOptions` a
// query, the other three mutations, `counter` keyed (contracts/app-surface.md, "`sessions.remedy`").
const RESTRICTED = [
  'suspended student',
  'banned student',
  'suspended teacher',
  'banned teacher',
] as const;

const typeOf = (path: string): unknown =>
  (surfaceRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>)[path]
    ?._def.type;

describe("'sessions.remedy.choose' (T031)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a restricted one ACCOUNT_RESTRICTED before the service: 'sessions.remedy.choose'", async () => {
    await expect(procedures['sessions.remedy.choose'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of RESTRICTED) {
      await expect(
        procedures['sessions.remedy.choose'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the input only, and answers the remedy stripped: 'sessions.remedy.choose'", async () => {
    const answered = await callerAs(sessionOf('student')).sessions.remedy.choose({
      sessionId: SESSION,
      choice: 'refund',
      userId: OTHER,
      gender: 'male',
    } as never);
    expect(calls).toEqual([
      ['choose', { userId: CALLER }, { sessionId: SESSION, choice: 'refund' }],
    ]);
    expect(answered).toEqual(remedied);
  });

  it("refuses a choice it does not name VALIDATION_FAILED before the service, and is a participant mutation: 'sessions.remedy.choose'", async () => {
    const thrown: unknown = await callerAs(sessionOf('student'))
      .sessions.remedy.choose({ sessionId: SESSION, choice: 'cash' } as never)
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
    expect(metaOf('sessions.remedy.choose')).toEqual({ surface: 'app', caller: 'participant' });
    expect(typeOf('sessions.remedy.choose')).toBe('mutation');
  });
});

describe("'sessions.remedy.accept' (T031)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a restricted one ACCOUNT_RESTRICTED before the service: 'sessions.remedy.accept'", async () => {
    await expect(procedures['sessions.remedy.accept'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of RESTRICTED) {
      await expect(
        procedures['sessions.remedy.accept'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the session only, and answers the remedy with its make-up, stripped: 'sessions.remedy.accept'", async () => {
    const answered = await callerAs(sessionOf('student')).sessions.remedy.accept({
      sessionId: SESSION,
      userId: OTHER,
    } as never);
    expect(calls).toEqual([['accept', { userId: CALLER }, { sessionId: SESSION }]]);
    expect(answered).toEqual(accepted);
  });

  it("answers the service's NOT_FOUND with no field, and is a participant mutation: 'sessions.remedy.accept'", async () => {
    const thrown: unknown = await procedures['sessions.remedy.accept'](
      callerAs(sessionOf('teacher')),
      OTHER,
    ).catch((error: unknown) => error);
    const { status, body } = toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
    expect(status).toBe(404);
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    expect(metaOf('sessions.remedy.accept')).toEqual({ surface: 'app', caller: 'participant' });
    expect(typeOf('sessions.remedy.accept')).toBe('mutation');
  });
});

describe("'sessions.remedy.counterOptions' (T031)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a restricted one ACCOUNT_RESTRICTED before the service: 'sessions.remedy.counterOptions'", async () => {
    await expect(procedures['sessions.remedy.counterOptions'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of RESTRICTED) {
      await expect(
        procedures['sessions.remedy.counterOptions'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the session only, and answers the options stripped; a participant query: 'sessions.remedy.counterOptions'", async () => {
    const answered = await callerAs(sessionOf('student')).sessions.remedy.counterOptions({
      sessionId: SESSION,
      gender: 'male',
    } as never);
    expect(calls).toEqual([['counterOptions', { userId: CALLER }, { sessionId: SESSION }]]);
    expect(answered).toEqual({ options: [option] });
    expect(metaOf('sessions.remedy.counterOptions')).toEqual({
      surface: 'app',
      caller: 'participant',
    });
    expect(typeOf('sessions.remedy.counterOptions')).toBe('query');
  });
});

describe("'sessions.remedy.counter' (T031)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a restricted one ACCOUNT_RESTRICTED before the service: 'sessions.remedy.counter'", async () => {
    await expect(procedures['sessions.remedy.counter'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of RESTRICTED) {
      await expect(
        procedures['sessions.remedy.counter'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the input with its key, never an instant or a zone, and answers the remedy stripped: 'sessions.remedy.counter'", async () => {
    const answered = await callerAs(sessionOf('student')).sessions.remedy.counter({
      sessionId: SESSION,
      slotId: REQUEST,
      localDate: '2026-11-16',
      idempotencyKey: COUNTER_KEY,
      startsAt: '2026-11-16T16:00:00Z',
      timezone: 'UTC',
    } as never);
    expect(calls).toEqual([
      [
        'counter',
        { userId: CALLER },
        {
          sessionId: SESSION,
          slotId: REQUEST,
          localDate: '2026-11-16',
          idempotencyKey: COUNTER_KEY,
        },
      ],
    ]);
    expect(answered).toEqual(remedied);
  });

  it("refuses a malformed key, date or slot VALIDATION_FAILED before the service, and is a participant mutation: 'sessions.remedy.counter'", async () => {
    for (const input of [
      { sessionId: SESSION, slotId: REQUEST, localDate: '2026-11-16', idempotencyKey: 'short' },
      { sessionId: SESSION, slotId: REQUEST, localDate: '16/11/2026', idempotencyKey: COUNTER_KEY },
      { sessionId: SESSION, slotId: 'slot', localDate: '2026-11-16', idempotencyKey: COUNTER_KEY },
    ]) {
      const thrown: unknown = await callerAs(sessionOf('student'))
        .sessions.remedy.counter(input)
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
    expect(metaOf('sessions.remedy.counter')).toEqual({ surface: 'app', caller: 'participant' });
    expect(typeOf('sessions.remedy.counter')).toBe('mutation');
  });
});

// T032 of specs/004-sessions: `sessions.remedy.answerCounter`, the participant kind (the student's
// own refusal is the service's NOT_FOUND), a mutation handing the service the caller's own account
// and the validated input only.
describe("'sessions.remedy.answerCounter' (T032)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a restricted one ACCOUNT_RESTRICTED before the service: 'sessions.remedy.answerCounter'", async () => {
    await expect(procedures['sessions.remedy.answerCounter'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of RESTRICTED) {
      await expect(
        procedures['sessions.remedy.answerCounter'](callerAs(sessionOf(who))),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the input only, and answers the remedy stripped: 'sessions.remedy.answerCounter'", async () => {
    const answered = await callerAs(sessionOf('teacher')).sessions.remedy.answerCounter({
      sessionId: SESSION,
      accept: false,
      userId: OTHER,
      role: 'teacher',
    } as never);
    expect(calls).toEqual([
      ['answerCounter', { userId: CALLER }, { sessionId: SESSION, accept: false }],
    ]);
    expect(answered).toEqual(remedied);
  });

  it("refuses an input without its answer VALIDATION_FAILED before the service, and is a participant mutation: 'sessions.remedy.answerCounter'", async () => {
    const thrown: unknown = await callerAs(sessionOf('teacher'))
      .sessions.remedy.answerCounter({ sessionId: SESSION } as never)
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
    expect(metaOf('sessions.remedy.answerCounter')).toEqual({
      surface: 'app',
      caller: 'participant',
    });
    expect(typeOf('sessions.remedy.answerCounter')).toBe('mutation');
  });
});

// T060 of specs/004-sessions: `sessions.complaint.raise`, the participant kind (the note under T060,
// F2: the service decides the caller is the enrollment's student), a mutation handing the service
// the caller's own account and the validated input only, under its own declared limit,
// `rate_limit_absence_complaint`, the student as subject (contracts/app-surface.md,
// "`sessions.complaint`"; FR-452, SC-415).
describe("'sessions.complaint.raise' (T060)", () => {
  const raise = (caller: Caller, input: Record<string, unknown>) =>
    caller.sessions.complaint.raise(input as never);
  const REASON = 'غاب المعلم عن حصتين';

  it("refuses an anonymous caller UNAUTHENTICATED and a restricted account ACCOUNT_RESTRICTED before the service: 'sessions.complaint.raise'", async () => {
    await expect(
      raise(callerAs(null), { enrollmentId: ENROLLMENT, reason: REASON }),
    ).rejects.toEqual(refused('UNAUTHENTICATED'));
    for (const who of RESTRICTED) {
      await expect(
        raise(callerAs(sessionOf(who)), { enrollmentId: ENROLLMENT, reason: REASON }),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the input trimmed, whatever else it says, and answers through the output schema: 'sessions.complaint.raise'", async () => {
    const answer = await raise(callerAs(sessionOf('student')), {
      enrollmentId: ENROLLMENT,
      reason: `  ${REASON} `,
      userId: OTHER,
      gender: 'male',
    });
    expect(answer).toEqual({ complaintId: COMPLAINT, status: 'open' });
    expect(calls).toEqual([
      ['complaint.raise', { userId: CALLER }, { enrollmentId: ENROLLMENT, reason: REASON }],
    ]);
  });

  it("answers the service's NOT_FOUND with no field: 'sessions.complaint.raise'", async () => {
    await expect(
      raise(callerAs(sessionOf('teacher')), { enrollmentId: OTHER, reason: REASON }),
    ).rejects.toEqual(refused('NOT_FOUND'));
  });

  it("refuses an empty, blank or over-long reason and an enrollment id that is not one VALIDATION_FAILED before the service: 'sessions.complaint.raise'", async () => {
    for (const input of [
      { enrollmentId: ENROLLMENT, reason: '' },
      { enrollmentId: ENROLLMENT, reason: '   ' },
      { enrollmentId: ENROLLMENT, reason: 'x'.repeat(501) },
      { enrollmentId: 'not-an-id', reason: REASON },
      { enrollmentId: ENROLLMENT },
    ]) {
      const thrown: unknown = await raise(callerAs(sessionOf('student')), input).catch(
        (error: unknown) => error,
      );
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
    await raise(callerAs(sessionOf('student')), {
      enrollmentId: ENROLLMENT,
      reason: 'x'.repeat(500),
    });
    expect(calls).toHaveLength(1);
  });

  it("is a mutation of the participant kind declaring rate_limit_absence_complaint: 'sessions.complaint.raise'", () => {
    expect(metaOf('sessions.complaint.raise')).toEqual({
      surface: 'app',
      caller: 'participant',
      rateLimit: 'rate_limit_absence_complaint',
    });
    expect(typeOf('sessions.complaint.raise')).toBe('mutation');
  });

  it("refuses a call over rate_limit_absence_complaint RATE_LIMITED before the service, the student as subject, nothing reached (SC-415): 'sessions.complaint.raise'", async () => {
    const read: string[] = [];
    const hits: string[] = [];
    const rateLimiter = new RateLimiter({
      settings: {
        read: async (key, schema) => {
          read.push(key);
          return schema.parse({ limit: 5, window_seconds: 3600 });
        },
      },
      counter: {
        hit: async (key) => {
          hits.push(key);
          return 6;
        },
      },
      subjectKey: Buffer.alloc(32, 6),
    });
    const services: AppServices = {
      settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      teacherProfile: unusedTeacherProfileServices,
      catalog: unusedCatalogServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions,
      chat: unusedChatServices,
      certification: unusedCertificationServices,
      moderation: unusedModerationServices,
    };
    const caller = callerFor(
      createAppContext({
        session: sessionOf('student'),
        log: createLogger({ level: 'info', destination: { write: () => undefined } }),
        rateLimiter,
        clientAddress: '203.0.113.9',
        services,
      }),
    );
    const thrown: unknown = await raise(caller, { enrollmentId: ENROLLMENT, reason: REASON }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(toErrorShape(thrown as never).body.code).toBe('RATE_LIMITED');
    expect(read).toEqual(['rate_limit_absence_complaint']);
    expect(hits).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});

// T066 of specs/004-sessions (the note under T066, Q3 (a)): `sessions.cancellation.request` and
// `.answer` hand the service the request's own after-commit list, `ctx.live`, which the participant
// kind sends once the handler resolves and drops when it throws.
describe("'sessions.cancellation': the request's live list (T066)", () => {
  const EVENT = { type: 'session', sessionId: SESSION, enrollmentId: ENROLLMENT } as const;

  function liveCaller(fails: boolean) {
    const published: LiveMessage[] = [];
    const bus: LiveBus = {
      publish: (message) => void published.push(message),
      subscribe: () => () => undefined,
    };
    const adding: SessionsServices = {
      ...sessions,
      cancellation: {
        request: async (caller, input, _log, live) => {
          calls.push(['request', caller, input]);
          live.afterCommit([caller.userId], EVENT);
          if (fails) throw new DomainError('CANCELLATION_EXPIRED');
          return requested as never;
        },
        answer: async (caller, input, _log, live) => {
          calls.push(['answer', caller, input]);
          live.afterCommit([caller.userId], EVENT);
          if (fails) throw new DomainError('CANCELLATION_EXPIRED');
          return answered as never;
        },
      },
    };
    const services: AppServices = {
      settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      teacherProfile: unusedTeacherProfileServices,
      catalog: unusedCatalogServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions: adding,
      chat: unusedChatServices,
      certification: unusedCertificationServices,
      moderation: unusedModerationServices,
    };
    const caller = callerFor(
      createAppContext({
        session: sessionOf('student'),
        log: createLogger({ level: 'info', destination: { write: () => undefined } }),
        rateLimiter: { check: vi.fn(async () => undefined) } as unknown as RateLimiter,
        clientAddress: '203.0.113.9',
        services,
        live: { bus, registry: {} as LiveRegistry },
      }),
    );
    return { caller, published };
  }

  it.each(['sessions.cancellation.request', 'sessions.cancellation.answer'] as const)(
    'sends what the service added once %s resolved',
    async (path) => {
      const { caller, published } = liveCaller(false);
      await procedures[path](caller);
      expect(published).toEqual([{ to: [CALLER], event: EVENT }]);
    },
  );

  it.each(['sessions.cancellation.request', 'sessions.cancellation.answer'] as const)(
    'drops what the service added when %s throws',
    async (path) => {
      const { caller, published } = liveCaller(true);
      await expect(procedures[path](caller)).rejects.toEqual(refused('CANCELLATION_EXPIRED'));
      expect(published).toEqual([]);
    },
  );
});

// 004:T084 (SRS DEC-105; the note under T084, (3), Q-5 (a)): `sessions.encryptionFailed`, a mutation of
// the participant kind handing the service the caller's own account and the session id only (the side
// that failed is the server's reading of the caller, never the input), answering nothing. No limit of
// its own yet (the open question in R1b's lane C1 report): the signed-in default counts it.
describe("'sessions.encryptionFailed' (T084)", () => {
  const report = (caller: Caller, input: Record<string, unknown>) =>
    caller.sessions.encryptionFailed(input as never);

  it("refuses an anonymous caller UNAUTHENTICATED and a restricted account ACCOUNT_RESTRICTED before the service: 'sessions.encryptionFailed'", async () => {
    await expect(report(callerAs(null), { sessionId: SESSION })).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of RESTRICTED) {
      await expect(report(callerAs(sessionOf(who)), { sessionId: SESSION }), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the caller's own account and the session id, whatever else the input says, and answers nothing: 'sessions.encryptionFailed'", async () => {
    for (const who of ['student', 'teacher'] as const) {
      const answer = await report(callerAs(sessionOf(who)), {
        sessionId: SESSION,
        party: who === 'student' ? 'teacher' : 'student',
        userId: OTHER,
      });
      expect(answer).toBeUndefined();
    }
    expect(calls).toEqual([
      ['encryptionFailed', { userId: CALLER }, { sessionId: SESSION }],
      ['encryptionFailed', { userId: CALLER }, { sessionId: SESSION }],
    ]);
  });

  it("answers the service's NOT_FOUND with no field: 'sessions.encryptionFailed'", async () => {
    await expect(report(callerAs(sessionOf('student')), { sessionId: OTHER })).rejects.toEqual(
      refused('NOT_FOUND'),
    );
  });

  it("refuses a session id that is not one VALIDATION_FAILED before the service: 'sessions.encryptionFailed'", async () => {
    for (const input of [{}, { sessionId: 'not-an-id' }]) {
      const thrown: unknown = await report(callerAs(sessionOf('student')), input).catch(
        (error: unknown) => error,
      );
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
  });

  it("is a mutation of the participant kind: 'sessions.encryptionFailed'", () => {
    expect(metaOf('sessions.encryptionFailed')).toEqual({ surface: 'app', caller: 'participant' });
    expect(typeOf('sessions.encryptionFailed')).toBe('mutation');
  });

  it("refuses a call past the signed-in default RATE_LIMITED before the service, nothing reached: 'sessions.encryptionFailed'", async () => {
    const read: string[] = [];
    const rateLimiter = new RateLimiter({
      settings: {
        read: async (key, schema) => {
          read.push(key);
          return schema.parse({ limit: 1, window_seconds: 60 });
        },
      },
      counter: { hit: async () => 2 },
      subjectKey: Buffer.alloc(32, 7),
    });
    const services: AppServices = {
      settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      teacherProfile: unusedTeacherProfileServices,
      catalog: unusedCatalogServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions,
      chat: unusedChatServices,
      certification: unusedCertificationServices,
      moderation: unusedModerationServices,
    };
    const caller = callerFor(
      createAppContext({
        session: sessionOf('teacher'),
        log: createLogger({ level: 'info', destination: { write: () => undefined } }),
        rateLimiter,
        clientAddress: '203.0.113.9',
        services,
      }),
    );
    const thrown: unknown = await report(caller, { sessionId: SESSION }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(toErrorShape(thrown as never).body.code).toBe('RATE_LIMITED');
    expect(read).toEqual([SIGNED_IN_DEFAULT_RATE_LIMIT]);
    expect(calls).toEqual([]);
  });
});
