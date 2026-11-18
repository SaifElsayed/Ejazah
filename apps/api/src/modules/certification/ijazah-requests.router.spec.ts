// T006 of specs/005-certification — `teacher.ijazahRequests.*` as the user surface serves it (FR-603,
// FR-628; contracts/app-surface.md:11-13; R-MOBILE-13). The follow-up under T006 (B46's integration):
// the authorization-test gate (`scripts/authz-test-gate.ts`, T028) reads module specs only, so each
// path's refusals are named here, beside the attacks of `tests/adversarial/ijazah-requests.attacks.spec.ts`.
//
// The teacher kind: an anonymous caller UNAUTHENTICATED, a student FORBIDDEN, a suspended or banned
// teacher ACCOUNT_RESTRICTED; `preview` and `send` admit an approved teacher only (an applicant
// FORBIDDEN), `get` any teacher-role holder (a request outlives the teacher's standing, FR-628). None
// of the refused calls reaches the service. What the service answers is ijazah-request.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  unusedModerationServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import type { CertificationServices } from './index.js';
import { ijazahRequestsRouter } from './ijazah-requests.router.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000006c1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000006e1';
const PREVIEW = { enrollmentId: ENROLLMENT, completionDate: '2026-11-16', language: 'ar' } as const;
const SEND = { ...PREVIEW, idempotencyKey: 'spec-router-0000-0000-0000' } as const;
const GET = { enrollmentId: ENROLLMENT } as const;

const surfaceRouter = createAppRouter({
  teacher: createAppRouter({ ijazahRequests: ijazahRequestsRouter }),
});
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Standing = 'student' | 'applicant' | 'approved' | 'suspended' | 'banned';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000006c9',
    gender: 'male' as const,
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
      payoutVerified: true,
      applicationStatus: applicant ? 'in_review' : 'approved',
    },
  };
}

/** Every call that reached the service, by method. */
let reached: string[];

beforeEach(() => {
  reached = [];
});

function callerAs(session: UserSession | null): Caller {
  const unreachedService = (method: string) => () => {
    reached.push(method);
    return Promise.reject(new Error(`spec: ${method} reached`));
  };
  const certification = {
    ijazahRequests: {
      preview: unreachedService('preview'),
      send: unreachedService('send'),
      get: unreachedService('get'),
    },
  } as unknown as CertificationServices;
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
    catalog: unusedCatalogServices,
    certification,
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

describe('teacher.ijazahRequests.preview (T006 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED', async () => {
    await expect(callerAs(null).teacher.ijazahRequests.preview(PREVIEW)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses a student FORBIDDEN', async () => {
    await expect(
      callerAs(sessionOf('student')).teacher.ijazahRequests.preview(PREVIEW),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(reached).toEqual([]);
  });

  it('refuses an applicant FORBIDDEN: only an approved teacher previews', async () => {
    await expect(
      callerAs(sessionOf('applicant')).teacher.ijazahRequests.preview(PREVIEW),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(reached).toEqual([]);
  });

  it('refuses a suspended or a banned teacher ACCOUNT_RESTRICTED', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(
        callerAs(sessionOf(standing)).teacher.ijazahRequests.preview(PREVIEW),
        standing,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(reached).toEqual([]);
  });
});

describe('teacher.ijazahRequests.send (T006 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED', async () => {
    await expect(callerAs(null).teacher.ijazahRequests.send(SEND)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses a student FORBIDDEN', async () => {
    await expect(callerAs(sessionOf('student')).teacher.ijazahRequests.send(SEND)).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses an applicant FORBIDDEN: only an approved teacher sends', async () => {
    await expect(
      callerAs(sessionOf('applicant')).teacher.ijazahRequests.send(SEND),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(reached).toEqual([]);
  });

  it('refuses a suspended or a banned teacher ACCOUNT_RESTRICTED', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(
        callerAs(sessionOf(standing)).teacher.ijazahRequests.send(SEND),
        standing,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(reached).toEqual([]);
  });
});

describe('teacher.ijazahRequests.get (T006 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED', async () => {
    await expect(callerAs(null).teacher.ijazahRequests.get(GET)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses a student FORBIDDEN', async () => {
    await expect(callerAs(sessionOf('student')).teacher.ijazahRequests.get(GET)).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect(reached).toEqual([]);
  });

  it('admits an applicant to its service: a request outlives the teacher’s standing (FR-628)', async () => {
    await expect(callerAs(sessionOf('applicant')).teacher.ijazahRequests.get(GET)).rejects.toThrow(
      'spec: get reached',
    );
    expect(reached).toEqual(['get']);
  });
});
