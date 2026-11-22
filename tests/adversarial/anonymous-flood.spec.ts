// 002:T172 — one address cannot spend the platform's sign-in and one-time-code budgets (the
// full-codebase review of 2026-11-20, M1 and m3; SRS NFR-SEC-10 as amended, DEC-100, DEC-103).
//
// The anonymous paths count the e-mail the caller typed, so made-up e-mails from one address are
// each a new subject, and only the platform-wide budget stopped them: 1,000 sign-ins in 15 minutes
// closed e-mail sign-in, password reset and Google sign-in for everyone, and 300 code requests in
// an hour closed every code. Each such path now counts the client's address first, under one of
// two keys, sized so that ten addresses are needed to fill the budget it guards; a call refused
// there spends nothing of the budget.
//
// The real surface and the real web deletion page are called in process over one limiter, as the
// process runs them: the real `RateLimiter` over an in-memory counter, its limits the registry's
// defaults, which `tests/seed/settings-registry.spec.ts` holds equal to what the seed plants. The
// services stand in: a sign-in that reaches its service answers that service's refusal, so
// "answered" is any answer but `RATE_LIMITED`. The deletion page is driven through its handler:
// its own per-address page limit (`rate_limit_public_page`, T019) is a minute's window, which a
// flood paced under it passes, so the budget is what this case is about. No harness registration:
// `auth.*` is exempt there (`procedure-harness.ts`).
import { describe, expect, it } from 'vitest';

import {
  deleteAccountRoutes,
  type IdentityServices,
} from '../../apps/api/src/modules/identity/index.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import {
  defaultRateLimits,
  type RateLimitCounter,
  RateLimiter,
  rateLimitSetting,
} from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { SETTINGS_REGISTRY } from '../../apps/api/src/platform/settings/registry.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { appRouter } from '../../apps/api/src/surfaces/app.router.js';
import { createAppContext } from '../../apps/api/src/surfaces/context.js';
import { createAppCallerFactory } from '../../apps/api/src/surfaces/procedures.js';
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
} from '../../apps/api/src/surfaces/services.fixtures.js';

const FLOOD = 1_000;
const FLOODING_ADDRESS = '203.0.113.66';
const SECOND_ADDRESS = '198.51.100.21';
/** Where the deletion page's email step is served (public-pages.md). */
const DELETE_ACCOUNT_PAGE = '/delete-account';
const log = createLogger({ level: 'fatal' });

/** Every setting at the default the registry carries (equal to the seed's). */
const defaults: SettingsReader = {
  // Typed by `SettingsReader` (no `zod` import: `tests/` does not resolve it under `pnpm typecheck`).
  read: async (key, schema) => {
    const entry = SETTINGS_REGISTRY[key];
    if (entry === undefined) throw new SettingError(key, 'missing');
    return schema.parse(entry.default);
  },
};

/** A rate limit's seeded count. */
const limitOf = (key: string): number =>
  rateLimitSetting.parse(SETTINGS_REGISTRY[key]?.default).limit;

/** Counts per key; no window elapses, so no case depends on the clock. */
function counter(): RateLimitCounter {
  const counts = new Map<string, number>();
  return {
    hit: async (key) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    },
  };
}

function overriding<T extends object>(unused: T, given: Partial<T>): T {
  return new Proxy(unused, {
    get: (target, name, receiver) =>
      typeof name === 'string' && name in given
        ? given[name as keyof T]
        : Reflect.get(target, name, receiver),
  });
}

const identity = overriding<IdentityServices>(unusedIdentityServices, {
  emailAuth: overriding(unusedIdentityServices.emailAuth, {
    signIn: async () => {
      throw new DomainError('SIGN_IN_FAILED');
    },
    requestSignUpCode: async () => undefined,
  }),
});

const callApp = createAppCallerFactory(appRouter);

/** The surface and the deletion page over one limiter, as one process serves them. */
function platform() {
  const rateLimiter = new RateLimiter({
    settings: defaults,
    counter: counter(),
    subjectKey: Buffer.alloc(32, 5),
  });
  const services = {
    settings: defaults,
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity,
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const deletionPage = deleteAccountRoutes({
    deletion: {
      requestWebCode: async () => undefined,
      confirmWebDeletion: async () => false,
    },
    supportEmail: 'support@ijazah.invalid',
    rateLimiter,
  })[DELETE_ACCOUNT_PAGE];
  if (deletionPage === undefined) throw new Error('the deletion page is not served');
  return {
    app: (clientAddress: string) =>
      callApp(createAppContext({ session: null, log, rateLimiter, clientAddress, services })),
    postDeletionEmail: (clientAddress: string, email: string) =>
      deletionPage.handle({
        method: 'POST',
        lang: 'ar',
        clientAddress,
        query: new URLSearchParams(),
        form: new URLSearchParams({ email }),
        correlationId: '0199d0a0-0000-7000-8000-000000000001',
        log,
      }),
  };
}

/**
 * The code a call answered with; `ANSWERED` when it resolved. The surface's caller rejects with
 * tRPC's error around the domain one, the page's handler with the domain error itself.
 */
async function codeOf(call: () => unknown): Promise<string> {
  try {
    await call();
    return 'ANSWERED';
  } catch (error: unknown) {
    if (error instanceof DomainError) return error.code;
    const { cause } = error as { readonly cause?: unknown };
    if (cause instanceof DomainError) return cause.code;
    throw error;
  }
}

/** How many of `answers` were not refused by a rate limit. */
const answeredOf = (answers: readonly string[]) =>
  answers.filter((answer) => answer !== 'RATE_LIMITED').length;

describe('one address cannot spend the platform’s budgets (002:T172, DEC-103)', () => {
  it('1,000 sign-ins with made-up e-mails from one address leave a second address able to sign in', async () => {
    const p = platform();
    const flood: string[] = [];
    for (let n = 0; n < FLOOD; n += 1) {
      flood.push(
        await codeOf(() =>
          p.app(FLOODING_ADDRESS).auth.email.signIn({
            email: `made-up-${String(n)}@example.com`,
            password: 'a wrong password',
          }),
        ),
      );
    }
    // Refused at the address's own limit, a tenth of the budget, which is left unspent.
    expect(answeredOf(flood)).toBe(limitOf(defaultRateLimits.addressAuthentication));
    expect(limitOf(defaultRateLimits.addressAuthentication)).toBeLessThan(
      limitOf(defaultRateLimits.authenticationBudget),
    );

    expect(
      await codeOf(() =>
        p.app(SECOND_ADDRESS).auth.email.signIn({
          email: 'someone@example.com',
          password: 'a wrong password',
        }),
      ),
    ).toBe('SIGN_IN_FAILED');
  });

  it('1,000 made-up e-mails posted to the web deletion page from one address leave a second address able to request a sign-up code', async () => {
    const p = platform();
    const flood: string[] = [];
    for (let n = 0; n < FLOOD; n += 1) {
      flood.push(
        await codeOf(() =>
          p.postDeletionEmail(FLOODING_ADDRESS, `made-up-${String(n)}@example.com`),
        ),
      );
    }
    expect(answeredOf(flood)).toBe(limitOf(defaultRateLimits.addressOneTimeCode));
    expect(limitOf(defaultRateLimits.addressOneTimeCode)).toBeLessThan(
      limitOf(defaultRateLimits.oneTimeCodeBudget),
    );

    expect(
      await codeOf(() =>
        p.app(SECOND_ADDRESS).auth.email.requestSignUpCode({ email: 'someone@example.com' }),
      ),
    ).toBe('ANSWERED');
  });
});
