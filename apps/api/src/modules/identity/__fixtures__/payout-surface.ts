// B15 (T077): the `teacher.payout` namespace as the user surface serves it, for the payout specs.
// Each call goes through the caller kinds' middleware exactly as over HTTP (the input schema, the
// teacher kind's refusals, the output schema). The session is either written here by standing, or
// the one the identity module's own resolver reads from a bearer. Every line the request's logger
// writes is kept, so a spec can sweep it; the other identity services answer every call by throwing.
import { vi } from 'vitest';

import type { RateLimiter } from '../../../platform/guards/rate-limit.guard.js';
import { createLogger, type Logger } from '../../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCheckoutServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../../surfaces/services.fixtures.js';
import type { IdentityServices } from '../index.js';
import { payoutRouter } from '../payout.router.js';
import type { SessionService } from '../session.service.js';

export const PAYOUT_CALLER = '0199d0a0-0000-7000-8000-0000000000b1';

/** The namespace, mounted as `app.router.ts` mounts it. */
const payoutSurfaceRouter = createAppRouter({
  teacher: createAppRouter({ payout: payoutRouter }),
});

/** A procedure's meta, as the contract snapshot and the gates read it. */
export function metaOf(path: string): unknown {
  const procedures = payoutSurfaceRouter._def.procedures as unknown as Record<
    string,
    { readonly _def: { readonly meta?: unknown } }
  >;
  return procedures[path]?._def.meta;
}

/** The standings a spec signs in as. */
export type Standing =
  'student' | 'applicant' | 'approved' | 'publishable' | 'suspended teacher' | 'banned teacher';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: PAYOUT_CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000c2',
    gender: 'male' as const,
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

const callerFor = createAppCallerFactory(payoutSurfaceRouter);

/** A caller of the namespace. */
export type PayoutCaller = ReturnType<typeof callerFor>;

export interface PayoutSurface {
  readonly anonymous: () => PayoutCaller;
  readonly as: (standing: Standing) => PayoutCaller;
  /** The caller a bearer resolves to; anonymous when the resolver refuses it. */
  readonly bearing: (accessToken: string) => Promise<PayoutCaller>;
  /** Every line the logger wrote. */
  readonly logs: () => readonly string[];
  /** The logger the surface writes through, for a spec that logs a failure as the HTTP handler does. */
  readonly log: Logger;
}

/** Payout services that record each call and answer what the contract's output takes. */
export function recordingPayout() {
  const calls: unknown[][] = [];
  const payout: IdentityServices['payout'] = {
    get: async (...args) => {
      calls.push(['payout.get', ...args]);
      return { state: 'pending_verification', configuredAt: '2026-10-26T09:00:00.000Z' };
    },
    register: async (...args) => {
      calls.push(['payout.register', ...args]);
    },
  };
  return { calls, payout };
}

/**
 * The user surface's context for a session, as the HTTP application builds one, carrying `payout`
 * (the others answer every call by throwing) and writing its log lines through `log`.
 */
export function appContextFor(
  session: UserSession | null,
  payout: IdentityServices['payout'] = unusedIdentityServices.payout,
  log: Logger = createLogger({ level: 'info', destination: { write: () => undefined } }),
) {
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  const identity = new Proxy(unusedIdentityServices, {
    get: (target, service) => (service === 'payout' ? payout : Reflect.get(target, service)),
  });
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity,
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
  };
  return createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services });
}

export function payoutSurfaceOf(
  payout: IdentityServices['payout'],
  sessions?: Pick<SessionService, 'resolveUserSession'>,
): PayoutSurface {
  const lines: string[] = [];
  const log = createLogger({ level: 'trace', destination: { write: (line) => lines.push(line) } });
  const as = (session: UserSession | null) => callerFor(appContextFor(session, payout, log));
  return {
    anonymous: () => as(null),
    as: (standing: Standing) => as(sessionOf(standing)),
    bearing: async (accessToken: string) => {
      if (sessions === undefined) throw new Error('this surface resolves no bearer');
      return as(await sessions.resolveUserSession(accessToken));
    },
    logs: () => [...lines],
    log,
  };
}
