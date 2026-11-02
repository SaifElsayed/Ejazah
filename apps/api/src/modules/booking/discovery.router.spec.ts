// T026 — the `discovery` namespace as the user surface serves it (app-surface.md "`discovery` —
// booking's router over catalog's service"; R-204, R-205, R-GENDER-4, R-GENDER-5).
//
// Both procedures are the student kind: an anonymous caller is UNAUTHENTICATED, a teacher FORBIDDEN,
// a suspended or banned student ACCOUNT_RESTRICTED, and none of them reaches the service. Every
// admitted call is counted under `rate_limit_search` by the caller's own id before the service is
// reached, and a call past the limit is RATE_LIMITED with nothing read. The service is handed the
// session's gender, in both directions, never anything the input says. The authorization gate
// (R-MOBILE-13, `pnpm check:authz`) reads these cases by path. What the service answers is
// discovery.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import {
  unusedCatalogServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { discoveryRouter } from './discovery.router.js';
import type { DiscoveryServices } from './index.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000000f1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000f2';

const surfaceRouter = createAppRouter({ discovery: discoveryRouter });
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Who = 'student' | 'teacher' | 'suspended student' | 'banned student';

function sessionOf(who: Who, gender: 'male' | 'female' = 'female'): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000f9',
    gender,
    preferredLanguage: 'ar' as const,
  };
  if (who === 'teacher') {
    return {
      ...base,
      role: 'teacher',
      accountStatus: 'active',
      teacher: {
        verificationStatus: 'approved',
        payoutVerified: true,
        applicationStatus: 'approved',
      },
    };
  }
  const accountStatus =
    who === 'suspended student' ? 'suspended' : who === 'banned student' ? 'banned' : 'active';
  return { ...base, role: 'student', accountStatus };
}

let calls: unknown[][];
let limited: unknown[][];
let refuseAtLimit: boolean;

const discovery: DiscoveryServices = {
  browse: async (...args) => {
    calls.push(['browse', ...args]);
    return { cards: [] };
  },
  filters: async (...args) => {
    calls.push(['filters', ...args]);
    return { riwayas: [] };
  },
};

beforeEach(() => {
  calls = [];
  limited = [];
  refuseAtLimit = false;
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
    discovery,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = {
    check: vi.fn(async (...args: unknown[]) => {
      limited.push(args);
      if (refuseAtLimit) throw new DomainError('RATE_LIMITED');
    }),
  } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

function callsOf(caller: Caller) {
  return {
    'discovery.browse': () => caller.discovery.browse({}),
    'discovery.filters': () => caller.discovery.filters({ subjectId: SUBJECT }),
  };
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe('the namespace', () => {
  it("refuses an anonymous caller UNAUTHENTICATED: 'discovery.browse', 'discovery.filters'", async () => {
    for (const [path, call] of Object.entries(callsOf(callerAs(null)))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a teacher FORBIDDEN: 'discovery.browse', 'discovery.filters'", async () => {
    for (const [path, call] of Object.entries(callsOf(callerAs(sessionOf('teacher'))))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned student ACCOUNT_RESTRICTED: 'discovery.browse', 'discovery.filters'", async () => {
    for (const who of ['suspended student', 'banned student'] as const) {
      for (const [path, call] of Object.entries(callsOf(callerAs(sessionOf(who))))) {
        await expect(call(), `${who} ${path}`).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(calls).toEqual([]);
  });

  it("counts every call under rate_limit_search by the caller's id: 'discovery.browse', 'discovery.filters'", async () => {
    const caller = callerAs(sessionOf('student'));
    await caller.discovery.browse({ query: 'محمد' });
    await caller.discovery.filters({ subjectId: SUBJECT });
    expect(limited).toEqual([
      ['rate_limit_search', CALLER],
      ['rate_limit_search', CALLER],
    ]);
  });

  it("refuses a call past the limit RATE_LIMITED before the service: 'discovery.browse', 'discovery.filters'", async () => {
    refuseAtLimit = true;
    for (const [path, call] of Object.entries(callsOf(callerAs(sessionOf('student'))))) {
      await expect(call(), path).rejects.toEqual(refused('RATE_LIMITED'));
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the session's gender, in both directions, whatever the input says", async () => {
    for (const gender of ['female', 'male'] as const) {
      const caller = callerAs(sessionOf('student', gender));
      const other = gender === 'female' ? 'male' : 'female';
      await caller.discovery.browse({ subjectId: SUBJECT, gender: other } as never);
      await caller.discovery.filters({ subjectId: SUBJECT, gender: other } as never);
    }
    expect(calls).toEqual([
      ['browse', 'female', { subjectId: SUBJECT }],
      ['filters', 'female', { subjectId: SUBJECT }],
      ['browse', 'male', { subjectId: SUBJECT }],
      ['filters', 'male', { subjectId: SUBJECT }],
    ]);
  });
});
