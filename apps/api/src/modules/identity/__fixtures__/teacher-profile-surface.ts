// T017: the `teacher.profile` namespace as the user surface serves it, for the profile specs. Each
// call goes through the caller kinds' middleware exactly as over HTTP (the input schema, the teacher
// kind's refusals, the output schema), over the service the spec hands in: a recording one for the
// router's refusals, the real one over the spec database for what is written. The session is
// written here by standing, for the user id and the gender the spec names.
import { vi } from 'vitest';

import type { RateLimiter } from '../../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../../surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedVerificationServices,
} from '../../../surfaces/services.fixtures.js';
import type { TeacherProfileServices } from '../index.js';
import { teacherProfileRouter } from '../teacher-profile.router.js';

export const PROFILE_CALLER = '0199d0a0-0000-7000-8000-0000000000d1';

/** The namespace, mounted as `app.router.ts` mounts it. */
const profileSurfaceRouter = createAppRouter({
  teacher: createAppRouter({ profile: teacherProfileRouter }),
});

/** A procedure's meta, as the contract snapshot and the gates read it. */
export function metaOf(path: string): unknown {
  const procedures = profileSurfaceRouter._def.procedures as unknown as Record<
    string,
    { readonly _def: { readonly meta?: unknown } }
  >;
  return procedures[path]?._def.meta;
}

/** The standings a spec signs in as. */
export type Standing =
  'student' | 'applicant' | 'approved' | 'publishable' | 'suspended teacher' | 'banned teacher';

/** The session of `userId` at `standing`, of `gender`, as the resolver would answer it. */
export function sessionOf(
  standing: Standing,
  userId: string = PROFILE_CALLER,
  gender: 'male' | 'female' = 'male',
): UserSession {
  const base = {
    userId,
    sessionId: '0199d0a0-0000-7000-8000-0000000000d2',
    gender,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  const applicant = standing === 'applicant';
  return {
    ...base,
    role: 'teacher',
    accountStatus:
      standing === 'suspended teacher'
        ? 'suspended'
        : standing === 'banned teacher'
          ? 'banned'
          : 'active',
    teacher: {
      verificationStatus: applicant ? 'pending' : 'approved',
      payoutVerified: standing === 'publishable',
      applicationStatus: applicant ? 'in_review' : 'approved',
    },
  };
}

const callerFor = createAppCallerFactory(profileSurfaceRouter);

/** A caller of the namespace. */
export type ProfileCaller = ReturnType<typeof callerFor>;

/** A profile service that records each call and answers what the contract's output takes. */
export function recordingProfile() {
  const calls: unknown[][] = [];
  const teacherProfile: TeacherProfileServices = {
    get: async (...args) => {
      calls.push(['get', ...args]);
      return {
        displayName: 'Spec Teacher',
        bio: '',
        qualificationSummary: 'Spec qualification',
        gender: 'male',
        published: false,
      };
    },
    update: async (...args) => {
      calls.push(['update', ...args]);
      const [, input] = args;
      return { bio: input.bio, qualificationSummary: input.qualificationSummary };
    },
  };
  return { calls, teacherProfile };
}

/** The namespace's callers over `teacherProfile`; every other service answers by throwing. */
export function profileSurfaceOf(teacherProfile: TeacherProfileServices) {
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
  };
  const as = (session: UserSession | null) =>
    callerFor(
      createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
    );
  return {
    anonymous: () => as(null),
    as: (standing: Standing) => as(sessionOf(standing)),
    session: (session: UserSession) => as(session),
  };
}

/** The body a refused call answers over HTTP (R-API-8); a call that is not refused fails the spec. */
export async function refusalOf(call: Promise<unknown>): Promise<unknown> {
  const error: unknown = await call.then(
    () => {
      throw new Error('the call was not refused');
    },
    (thrown: unknown) => thrown,
  );
  return toErrorShape(error as Parameters<typeof toErrorShape>[0]).body;
}
