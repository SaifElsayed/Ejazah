// T056, T057, T068: the verification module's namespaces of the user surface as it serves them, for
// the router specs. Each call goes through the caller kinds' middleware exactly as over HTTP (the input
// schema, the kind's refusals, the output schema); the session is the one a bearer would resolve
// to, written here by standing, and the services record what reached them.
import { vi } from 'vitest';

import type { RateLimiter } from '../../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../../surfaces/procedures.js';
import {
  unusedCatalogServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
} from '../../../surfaces/services.fixtures.js';
import { applicationRouter } from '../application.router.js';
import { credentialsRouter } from '../credentials.router.js';
import { identityVerificationRouter } from '../identity-verification.router.js';
import type { VerificationServices } from '../index.js';

export const CALLER = '0199d0a0-0000-7000-8000-00000000000a';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });

/** The namespaces, mounted as `app.router.ts` mounts them. */
const teacherRouter = createAppRouter({
  teacher: createAppRouter({ application: applicationRouter, credentials: credentialsRouter }),
  account: createAppRouter({ identityVerification: identityVerificationRouter }),
});

/** A procedure's meta, as the contract snapshot and the gates read it. */
export function metaOf(path: string): unknown {
  const procedures = teacherRouter._def.procedures as unknown as Record<
    string,
    { readonly _def: { readonly meta?: unknown } }
  >;
  return procedures[path]?._def.meta;
}

/** The standings a spec signs in as. */
export type Standing =
  'student' | 'applicant' | 'approved' | 'suspended applicant' | 'banned teacher';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000c1',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  const approved = standing === 'approved';
  return {
    ...base,
    role: 'teacher',
    accountStatus:
      standing === 'suspended applicant'
        ? 'suspended'
        : standing === 'banned teacher'
          ? 'banned'
          : 'active',
    teacher: {
      verificationStatus: approved ? 'approved' : 'pending',
      payoutVerified: false,
      applicationStatus: approved ? 'approved' : 'in_review',
    },
  };
}

const callerFor = createAppCallerFactory(teacherRouter);

/** A caller of the two namespaces. */
export type TeacherCaller = ReturnType<typeof callerFor>;

export interface VerificationSurface {
  readonly anonymous: () => TeacherCaller;
  readonly as: (standing: Standing) => TeacherCaller;
}

/** Services that record each call and answer what the contract's output takes. */
export function recordingServices() {
  const calls: unknown[][] = [];
  const recorded =
    <T>(name: string, answer: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push([name, ...args]);
      return answer;
    };
  const verification: VerificationServices = {
    application: {
      get: recorded('application.get', {
        status: 'in_review',
        submittedAt: '2026-10-21T09:00:00.000Z',
        subjectCount: 2,
        callRecorded: false,
        approvedShown: false,
      }),
      submit: recorded('application.submit', undefined),
      resubmit: recorded('application.resubmit', undefined),
      reapply: recorded('application.reapply', undefined),
      markApprovedShown: recorded('application.markApprovedShown', undefined),
    },
    credentials: {
      list: recorded('credentials.list', []),
      add: recorded('credentials.add', { credentialId: '0199d0a0-0000-7000-8000-0000000000e1' }),
      replaceDocument: recorded('credentials.replaceDocument', undefined),
      documentLink: recorded('credentials.documentLink', {
        url: 'https://storage.invalid/documents/one.pdf?signature=abc',
        expiresAt: '2026-10-21T09:05:00.000Z',
      }),
    },
    identityVerification: {
      get: recorded('identityVerification.get', { open: false }),
      submit: recorded('identityVerification.submit', undefined),
    },
  };
  return { calls, verification };
}

export function surfaceOf(verification: VerificationServices): VerificationSurface {
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
  };
  const as = (session: UserSession | null) =>
    callerFor(
      createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
    );
  return {
    anonymous: () => as(null),
    as: (standing: Standing) => as(sessionOf(standing)),
  };
}
