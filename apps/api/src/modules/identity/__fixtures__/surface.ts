// T048, T049: the identity module's routers as the user surface serves them, for the router specs.
// Each call goes through the caller kinds' middleware exactly as over HTTP: the input schema, the
// kind's refusals, the declared rate limit, the output schema. The limiter records what it was
// asked to count and refuses nothing, so a spec reads the key and the subject of every count; a
// signed-in caller is the one the identity module's own resolver reads from a bearer, as the HTTP
// application resolves it.
import { vi } from 'vitest';

import type { RateLimiter, RateLimitSubject } from '../../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../../surfaces/procedures.js';
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
} from '../../../surfaces/services.fixtures.js';
import { accountRouter } from '../account.router.js';
import { authRouter } from '../auth.router.js';
import { onboardingRouter } from '../onboarding.router.js';
import type { Identity } from './identity.js';

export const SPEC_CLIENT = '203.0.113.9';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });

/** The three namespaces, mounted as `app.router.ts` mounts them. */
export const identityRouter = createAppRouter({
  auth: authRouter,
  onboarding: onboardingRouter,
  account: accountRouter,
});

/** A procedure's meta, as the contract snapshot and the gates read it. */
export function metaOf(path: string): unknown {
  const procedures = identityRouter._def.procedures as unknown as Record<
    string,
    { readonly _def: { readonly meta?: unknown } }
  >;
  return procedures[path]?._def.meta;
}

const callerFor = createAppCallerFactory(identityRouter);

/** A caller of the three namespaces. */
export type IdentityCaller = ReturnType<typeof callerFor>;

export interface IdentitySurface {
  /** Every count asked for, as `[key, subject]`, in order. */
  readonly counts: () => unknown[][];
  readonly anonymous: () => IdentityCaller;
  /** The caller a bearer resolves to; anonymous when the resolver refuses it. */
  readonly bearing: (accessToken: string) => Promise<IdentityCaller>;
}

export function surfaceOf(
  identity: Identity,
  overrides: {
    readonly deletion?: AppServices['identity']['deletion'];
    // T004 of specs/005-certification (rule d): the certificate name's service, a recording one.
    readonly certificateName?: AppServices['identity']['certificateName'];
    // T005 of specs/005-certification (rule d): the push token's service, a recording one.
    readonly pushTokens?: AppServices['identity']['pushTokens'];
  } = {},
): IdentitySurface {
  const check = vi.fn(
    async (_key: string, _subject: RateLimitSubject, _procedure: string) => undefined,
  );
  const rateLimiter = { check } as unknown as RateLimiter;
  const services: AppServices = {
    settings: identity.settings,
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    // The payout namespace has its own fixture (T077), and `account.delete` reaches the deletion,
    // which deletion.service.spec.ts builds its own over; a router spec hands in a recording one.
    identity: {
      ...identity,
      payout: unusedIdentityServices.payout,
      deletion: overrides.deletion ?? unusedIdentityServices.deletion,
      certificateName: overrides.certificateName ?? unusedIdentityServices.certificateName,
      pushTokens: overrides.pushTokens ?? unusedIdentityServices.pushTokens,
    },
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
  };
  const as = (session: UserSession | null) =>
    callerFor(
      createAppContext({ session, log, rateLimiter, clientAddress: SPEC_CLIENT, services }),
    );
  return {
    // Each subject read back as the text it is counted under (T062): the budget's `*`, an identifier
    // itself, a user by id.
    counts: () => check.mock.calls.map(([key, subject]) => [key, countedText(subject)]),
    anonymous: () => as(null),
    bearing: async (accessToken: string) =>
      as(await identity.sessions.resolveUserSession(accessToken)),
  };
}

/** The text a subject is counted under, as the endpoints named it before T062's subject kinds. */
function countedText(subject: RateLimitSubject): string {
  switch (subject.kind) {
    case 'budget':
      return '*';
    case 'identifier':
      return subject.value;
    case 'user':
      return subject.userId;
    case 'administrator':
      return subject.adminId;
  }
}
