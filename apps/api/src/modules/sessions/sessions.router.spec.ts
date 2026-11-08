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
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
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
import type { SessionsServices } from './sessions.service.js';

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
});
