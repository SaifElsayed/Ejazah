// T011 of specs/005-certification — `reports.create` as the user surface serves it (FR-611, FR-613;
// contracts/app-surface.md, `reports.create`; R-MOBILE-13). The authorization-test gate
// (`scripts/authz-test-gate.ts`) reads module specs, so the path's refusals are named here, beside
// the attacks of `tests/adversarial/reports.attacks.ts`.
//
// The user kind: an anonymous caller UNAUTHENTICATED, a suspended or banned account
// ACCOUNT_RESTRICTED, none of them reaching the service; a student and a teacher both reach it with
// the session's own account, role and gender, never the input's (R-GENDER-4). Every call is counted
// under `rate_limit_user_report` by the caller before the service (FR-613). The answer is parsed by
// its schema: `{ received: true }` and nothing else. What the service decides is
// `user-report.service.spec.ts`'s.
import { beforeEach, describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { reportsRouter } from './reports.router.js';

const CALLER = '0199d0a0-0000-7000-8000-00000000c0a1';
const REPORTED = '0199d0a0-0000-7000-8000-00000000c0a2';
const SESSION = '0199d0a0-0000-7000-8000-00000000c0d1';
const KEY = 'report-key-for-the-spec-0001';
const REASON = 'كلام غير لائق';

const callerFor = createAppCallerFactory(createAppRouter({ reports: reportsRouter }));
type Caller = ReturnType<typeof callerFor>;

type Standing = 'student' | 'teacher' | 'suspended' | 'banned';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-00000000c0c9',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  return {
    ...base,
    role: 'teacher',
    accountStatus: standing === 'teacher' ? 'active' : standing,
    teacher: {
      verificationStatus: 'approved',
      payoutVerified: true,
      applicationStatus: 'approved',
    },
  };
}

let reached: unknown[][];
let counted: unknown[][];

beforeEach(() => {
  reached = [];
  counted = [];
});

function callerAs(session: UserSession | null, limited = false): Caller {
  const moderation = {
    reports: {
      create: async (...args: unknown[]) => {
        reached.push(args.slice(0, 2));
        return { received: true, reportId: REPORTED, status: 'open' };
      },
    },
  };
  const services = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    catalog: unusedCatalogServices,
    moderation,
  } as unknown as AppServices;
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = {
    check: async (key: string, subject: unknown, procedure: string) => {
      counted.push([key, subject, procedure]);
      if (limited) throw new DomainError('RATE_LIMITED');
    },
  } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const SESSION_REPORT = {
  reportedUserId: REPORTED,
  context: 'session' as const,
  sessionId: SESSION,
  reason: REASON,
  idempotencyKey: KEY,
};

describe('reports.create (T011 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED, reaching nothing', async () => {
    await expect(callerAs(null).reports.create(SESSION_REPORT)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses a suspended or a banned account ACCOUNT_RESTRICTED, reaching nothing', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(
        callerAs(sessionOf(standing)).reports.create(SESSION_REPORT),
        standing,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(reached).toEqual([]);
  });

  it('refuses a session report with no session BAD_REQUEST before the service', async () => {
    const { sessionId: _none, ...noSession } = SESSION_REPORT;
    await expect(callerAs(sessionOf('student')).reports.create(noSession)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(reached).toEqual([]);
  });

  it('counts the call under rate_limit_user_report by the caller, and a refusal reaches nothing', async () => {
    await callerAs(sessionOf('student')).reports.create(SESSION_REPORT);
    expect(counted).toEqual([
      ['rate_limit_user_report', { kind: 'user', userId: CALLER }, 'reports.create'],
    ]);
    reached = [];
    await expect(
      callerAs(sessionOf('student'), true).reports.create(SESSION_REPORT),
    ).rejects.toEqual(refused('RATE_LIMITED'));
    expect(reached).toEqual([]);
  });

  it('hands the service the session’s own account, role and gender, never the input’s', async () => {
    for (const standing of ['student', 'teacher'] as const) {
      reached = [];
      await callerAs(sessionOf(standing)).reports.create({
        ...SESSION_REPORT,
        userId: REPORTED,
        role: 'teacher',
        gender: 'male',
      } as never);
      expect(reached, standing).toEqual([
        [{ userId: CALLER, role: standing, gender: 'female' }, SESSION_REPORT],
      ]);
    }
  });

  it('answers received and nothing else, whatever the service returns', async () => {
    expect(await callerAs(sessionOf('student')).reports.create(SESSION_REPORT)).toEqual({
      received: true,
    });
  });
});
