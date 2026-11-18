// T013 of specs/005-certification — `genderFlags.raise` as the user surface serves it (FR-613, FR-614;
// contracts/app-surface.md, `genderFlags.raise`; R-MOBILE-13). The authorization-test gate
// (`scripts/authz-test-gate.ts`) reads module specs, so the path's refusals are named here, beside
// the attacks of `tests/adversarial/gender-flags.attacks.ts`. Written before the router, run red.
//
// The user kind: an anonymous caller UNAUTHENTICATED, a suspended or banned account
// ACCOUNT_RESTRICTED, none of them reaching the service; a student and a teacher both reach it with
// the session's own account, role and gender, never the input's (R-GENDER-4). Every call is counted
// under `rate_limit_gender_flag` by the caller before the service (FR-613). The answer is parsed by
// its schema: `{ received: true }` and nothing else. What the service decides is
// `gender-flag.service.spec.ts`'s.
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
import { genderFlagsRouter } from './gender-flags.router.js';

const CALLER = '0199d0a0-0000-7000-8000-00000000c0a1';
const REPORTED = '0199d0a0-0000-7000-8000-00000000c0a2';
const KEY = 'flag-key-for-the-spec-0001';
const REASON = 'الصوت لا يطابق الجنس المعلن';

const callerFor = createAppCallerFactory(createAppRouter({ genderFlags: genderFlagsRouter }));
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
    genderFlags: {
      raise: async (...args: unknown[]) => {
        reached.push(args.slice(0, 2));
        return { received: true, flagId: REPORTED, status: 'open' };
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

const FLAG = { flaggedUserId: REPORTED, reason: REASON, idempotencyKey: KEY };

describe('genderFlags.raise (T013 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED, reaching nothing', async () => {
    await expect(callerAs(null).genderFlags.raise(FLAG)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses a suspended or a banned account ACCOUNT_RESTRICTED, reaching nothing', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(callerAs(sessionOf(standing)).genderFlags.raise(FLAG), standing).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(reached).toEqual([]);
  });

  it('refuses a flag with no person BAD_REQUEST before the service', async () => {
    const { flaggedUserId: _none, ...noPerson } = FLAG;
    await expect(
      callerAs(sessionOf('student')).genderFlags.raise(noPerson as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(reached).toEqual([]);
  });

  it('counts the call under rate_limit_gender_flag by the caller, and a refusal reaches nothing', async () => {
    await callerAs(sessionOf('student')).genderFlags.raise(FLAG);
    expect(counted).toEqual([
      ['rate_limit_gender_flag', { kind: 'user', userId: CALLER }, 'genderFlags.raise'],
    ]);
    reached = [];
    await expect(callerAs(sessionOf('student'), true).genderFlags.raise(FLAG)).rejects.toEqual(
      refused('RATE_LIMITED'),
    );
    expect(reached).toEqual([]);
  });

  it('hands the service the session’s own account, role and gender, never the input’s', async () => {
    for (const standing of ['student', 'teacher'] as const) {
      reached = [];
      await callerAs(sessionOf(standing)).genderFlags.raise({
        ...FLAG,
        userId: REPORTED,
        role: 'teacher',
        gender: 'male',
      } as never);
      expect(reached, standing).toEqual([
        [{ userId: CALLER, role: standing, gender: 'female' }, FLAG],
      ]);
    }
  });

  it('answers received and nothing else, whatever the service returns', async () => {
    expect(await callerAs(sessionOf('student')).genderFlags.raise(FLAG)).toEqual({
      received: true,
    });
  });
});
