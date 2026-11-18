// 003:T105 — `teacher.dues.get` as the user surface serves it (SRS DEC-89). The teacher kind admitting
// an approved teacher (R-106): an anonymous caller UNAUTHENTICATED, a student and an applicant
// FORBIDDEN, none reaching the service. The admitted call asks for the caller's own releases, never an
// id from the input, and the answer is the output schema's: no order, enrollment or student id and no
// name. A surface built without the service fails closed. What the service answers is
// `payouts.service.spec.ts`'s; another teacher's rows never answered over the real tables is
// `tests/adversarial/teacher-dues.spec.ts`'s.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedModerationServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { teacherDuesRouter } from './teacher-dues.router.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000005c1';

const surfaceRouter = createAppRouter({ teacher: createAppRouter({ dues: teacherDuesRouter }) });
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Standing = 'student' | 'applicant' | 'approved';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000005c9',
    gender: 'male' as const,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  const applicant = standing === 'applicant';
  return {
    ...base,
    role: 'teacher',
    accountStatus: 'active',
    teacher: {
      verificationStatus: applicant ? 'pending' : 'approved',
      payoutVerified: true,
      applicationStatus: applicant ? 'in_review' : 'approved',
    },
  };
}

const ANSWER = {
  held_piasters: 700_000,
  paid_piasters: 0,
  releases: [
    {
      part: 'recitation_end',
      amount_piasters: 700_000,
      state: 'held',
      fallsDueAt: '2026-10-13T10:00:00.000Z',
      waitsForCase: false,
      enrollmentId: '0199d0a0-0000-7000-8000-000000000101',
      student: { displayName: 'آمال' },
    },
  ],
  deductions: [{ share_piasters: 70_000, paymentId: '0199d0a0-0000-7000-8000-000000000901' }],
};

let asked: string[];

beforeEach(() => {
  asked = [];
});

function callerAs(session: UserSession | null, wired = true): Caller {
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
    catalog: unusedCatalogServices,
    ...(wired
      ? {
          teacherDues: {
            get: async (teacherUserId: string) => {
              asked.push(teacherUserId);
              return ANSWER as never;
            },
          },
        }
      : {}),
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe('teacher.dues.get (003:T105)', () => {
  it('refuses an anonymous caller, a student and an applicant, reaching nothing', async () => {
    await expect(callerAs(null).teacher.dues.get({})).rejects.toEqual(refused('UNAUTHENTICATED'));
    await expect(callerAs(sessionOf('student')).teacher.dues.get({})).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    await expect(callerAs(sessionOf('applicant')).teacher.dues.get({})).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect(asked).toEqual([]);
  });

  it('asks for the caller’s own releases and answers no id and no name', async () => {
    const answer = await callerAs(sessionOf('approved')).teacher.dues.get({});

    expect(asked).toEqual([CALLER]);
    expect(answer).toEqual({
      held_piasters: 700_000,
      paid_piasters: 0,
      releases: [
        {
          part: 'recitation_end',
          amount_piasters: 700_000,
          state: 'held',
          fallsDueAt: '2026-10-13T10:00:00.000Z',
          waitsForCase: false,
        },
      ],
      deductions: [{ share_piasters: 70_000 }],
    });
  });

  it('refuses an input naming another teacher', async () => {
    await expect(
      callerAs(sessionOf('approved')).teacher.dues.get({ teacherUserId: 'x' } as never),
    ).rejects.toEqual(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(asked).toEqual([]);
  });

  it('fails closed on a surface built without the service', async () => {
    await expect(callerAs(sessionOf('approved'), false).teacher.dues.get({})).rejects.toEqual(
      refused('INTERNAL'),
    );
  });
});
