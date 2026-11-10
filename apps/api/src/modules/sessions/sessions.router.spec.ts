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
  counterparty: { displayName: 'أحمد سالم', deleted: false },
  join: { opensAt: '2026-11-12T06:45:00.000Z', closesAt: '2026-11-12T08:00:00.000Z' },
};

const joined = {
  sessionId: SESSION,
  serverUrl: 'wss://video-stand-in.invalid',
  token: 'fake_vtk_spec',
  validUntil: '2026-11-12T08:00:00.000Z',
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
};

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
