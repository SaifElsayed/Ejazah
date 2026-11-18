// T003 of specs/005-certification — `teacher.signature.get` as the user surface serves it (FR-601,
// SRS FR-IJAZAH-12; research R-411; R-SEC-3; contracts/app-surface.md). The teacher kind admitting an
// approved teacher, payout account verified or not (R-106): an anonymous caller UNAUTHENTICATED, a
// student and an applicant FORBIDDEN, a suspended or banned teacher ACCOUNT_RESTRICTED, none reaching
// the service. The admitted call asks for the caller's own signature, never an id from the input, and
// the answer is the output schema's two fields: a signed link and its instant, never a storage key.
// What the service answers is teacher-signature.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { teacherSignatureRouter } from './teacher-signature.router.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000005b1';
const LINK = 'http://link.invalid/files/sig?expires=2026-11-17T10%3A00%3A00.000Z&signature=s1';
const UPLOADED_AT = '2026-11-17T09:30:00.000Z';

const surfaceRouter = createAppRouter({
  teacher: createAppRouter({ signature: teacherSignatureRouter }),
});
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Standing = 'student' | 'applicant' | 'approved' | 'publishable' | 'suspended' | 'banned';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000005b9',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  const applicant = standing === 'applicant';
  return {
    ...base,
    role: 'teacher',
    accountStatus: standing === 'suspended' || standing === 'banned' ? standing : 'active',
    teacher: {
      verificationStatus: applicant ? 'pending' : 'approved',
      payoutVerified: standing === 'publishable',
      applicationStatus: applicant ? 'in_review' : 'approved',
    },
  };
}

let asked: string[];
let answer: unknown;

beforeEach(() => {
  asked = [];
  answer = { link: LINK, uploadedAt: UPLOADED_AT };
});

function callerAs(session: UserSession | null): Caller {
  const signature = {
    get: async (teacherUserId: string) => {
      asked.push(teacherUserId);
      return answer;
    },
  };
  const catalog = new Proxy(unusedCatalogServices, {
    get: (target, service) => (service === 'signature' ? signature : Reflect.get(target, service)),
  });
  const services: AppServices = {
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
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
    catalog,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe('teacher.signature.get (T003 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED', async () => {
    await expect(callerAs(null).teacher.signature.get()).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(asked).toEqual([]);
  });

  it('refuses a student FORBIDDEN', async () => {
    await expect(callerAs(sessionOf('student')).teacher.signature.get()).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect(asked).toEqual([]);
  });

  it('refuses an applicant FORBIDDEN (R-106)', async () => {
    await expect(callerAs(sessionOf('applicant')).teacher.signature.get()).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect(asked).toEqual([]);
  });

  it('refuses a suspended or a banned teacher ACCOUNT_RESTRICTED', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(callerAs(sessionOf(standing)).teacher.signature.get(), standing).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(asked).toEqual([]);
  });

  it('answers an approved teacher’s own signature, the payout account verified or not', async () => {
    for (const standing of ['approved', 'publishable'] as const) {
      await expect(callerAs(sessionOf(standing)).teacher.signature.get()).resolves.toStrictEqual({
        link: LINK,
        uploadedAt: UPLOADED_AT,
      });
    }
    expect(asked).toEqual([CALLER, CALLER]);
  });

  it('answers the null pair while no signature is held', async () => {
    answer = { link: null, uploadedAt: null };
    await expect(callerAs(sessionOf('approved')).teacher.signature.get()).resolves.toStrictEqual({
      link: null,
      uploadedAt: null,
    });
  });

  it('never answers a storage key, whatever the service hands back (R-SEC-3)', async () => {
    answer = { link: LINK, uploadedAt: UPLOADED_AT, storageKey: 'signatures/x/y.png' };
    await expect(callerAs(sessionOf('approved')).teacher.signature.get()).resolves.toStrictEqual({
      link: LINK,
      uploadedAt: UPLOADED_AT,
    });
  });
});
