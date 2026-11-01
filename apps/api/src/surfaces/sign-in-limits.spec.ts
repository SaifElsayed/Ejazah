// T133 — one flood never locks the other surface's sign-in (the full review of 2026-10-24, M1;
// NFR-SEC-10, ADR 0011 D3). The administrator's sign-in charged the same platform-wide budget as the
// app's, and counted its subject under the same key, so a flood of the app's sign-in spread over
// many addresses, or aimed at one address, refused every administrator; `auth.providerNonce` spent
// that budget too. The administrator surface now counts under a subject key and a budget of its
// own, and `auth.providerNonce` under a budget of its own.
//
// Both real surfaces are called in process through the caller kinds' middleware, as over HTTP,
// sharing one limiter as the process does: the real `RateLimiter` over an in-memory counter and
// a settings fake holding every key these paths read. The services stand in: a sign-in that reaches
// its service answers that service's refusal, so "answering" is any answer but `RATE_LIMITED`.
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { IdentityServices } from '../modules/identity/index.js';
import { DomainError } from '../platform/errors/domain-error.js';
import { type RateLimitCounter, RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { adminRouter } from './admin.router.js';
import { appRouter } from './app.router.js';
import { type AdminSurfaceServices, createAdminContext, createAppContext } from './context.js';
import { createAdminCallerFactory, createAppCallerFactory, toErrorShape } from './procedures.js';
import {
  unusedAdminServices,
  unusedIdentityServices,
  unusedVerificationServices,
} from './services.fixtures.js';

const ADMINISTRATOR = 'admin@ijazah.invalid';
const NONCE = { nonce: 'n-0199d0a0', expiresAt: '2026-10-27T10:00:00.000Z' };
const log = createLogger({ level: 'fatal' });

/** The settings store, as the admin module answers it: a missing row fails closed. */
function settingsOf(values: Readonly<Record<string, unknown>>): SettingsReader {
  return {
    read: async <T>(key: string, schema: z.ZodType<T>): Promise<T> => {
      if (!(key in values)) throw new SettingError(key, 'missing');
      return schema.parse(values[key]);
    },
  };
}

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
  signIn: {
    providerNonce: async () => NONCE,
    signInWithProvider: async () => {
      throw new DomainError('SIGN_IN_FAILED');
    },
  },
  emailAuth: overriding(unusedIdentityServices.emailAuth, {
    signIn: async () => {
      throw new DomainError('SIGN_IN_FAILED');
    },
  }),
});

const administrators = overriding<AdminSurfaceServices>(unusedAdminServices, {
  auth: overriding(unusedAdminServices.auth, {
    signIn: async () => {
      throw new DomainError('ADMIN_SIGN_IN_FAILED');
    },
  }),
});

const callApp = createAppCallerFactory(appRouter);
const callAdmin = createAdminCallerFactory(adminRouter);

/** Both surfaces over one limiter: every per-subject limit at `subject`, every budget at `budget`. */
function surfaces({ subject, budget }: { readonly subject: number; readonly budget: number }) {
  const per = (limit: number) => ({ limit, window_seconds: 900 });
  const rateLimiter = new RateLimiter({
    settings: settingsOf({
      rate_limit_authentication: per(subject),
      rate_limit_authentication_budget: per(budget),
      rate_limit_admin_authentication: per(subject),
      rate_limit_admin_authentication_budget: per(budget),
      rate_limit_provider_nonce: per(subject),
      rate_limit_provider_nonce_budget: per(budget),
    }),
    counter: counter(),
    subjectKey: Buffer.alloc(32, 3),
  });
  const services = {
    settings: settingsOf({}),
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity,
    verification: unusedVerificationServices,
  };
  const administration = {
    transactions: { run: () => Promise.reject(new Error('no transaction is expected here')) },
    auditWriter: { write: () => Promise.reject(new Error('no audit write is expected here')) },
  };
  return {
    app: (clientAddress = '203.0.113.7') =>
      callApp(createAppContext({ session: null, log, rateLimiter, clientAddress, services })),
    admin: () =>
      callAdmin(
        createAdminContext({
          session: null,
          log,
          administration,
          services: administrators,
          rateLimiter,
          clientAddress: '203.0.113.8',
        }),
      ),
  };
}

/** The code a call answered with, as the surface sends it; `ANSWERED` when it resolved. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'ANSWERED';
  } catch (error: unknown) {
    if (!(error instanceof TRPCError)) throw error;
    return toErrorShape(error).body.code;
  }
}

const appSignIn = (s: ReturnType<typeof surfaces>, email: string) =>
  codeOf(s.app().auth.email.signIn({ email, password: 'a wrong password' }));

const adminSignIn = (s: ReturnType<typeof surfaces>, email = ADMINISTRATOR) =>
  codeOf(s.admin().auth.signIn({ email, password: 'a wrong password' }));

describe('one flood never locks the other surface’s sign-in (T133)', () => {
  it('exhausting the app’s budget over many addresses leaves the administrator’s sign-in answering', async () => {
    const s = surfaces({ subject: 10, budget: 3 });
    const flood = [];
    for (let n = 0; n < 4; n += 1) flood.push(await appSignIn(s, `student${n}@example.com`));
    expect(flood).toEqual(['SIGN_IN_FAILED', 'SIGN_IN_FAILED', 'SIGN_IN_FAILED', 'RATE_LIMITED']);

    expect(await adminSignIn(s)).toBe('ADMIN_SIGN_IN_FAILED');
  });

  it('exhausting the administrator’s budget leaves the app’s sign-in answering', async () => {
    const s = surfaces({ subject: 10, budget: 3 });
    const flood = [];
    for (let n = 0; n < 4; n += 1) flood.push(await adminSignIn(s, `admin${n}@example.com`));
    expect(flood).toEqual([
      'ADMIN_SIGN_IN_FAILED',
      'ADMIN_SIGN_IN_FAILED',
      'ADMIN_SIGN_IN_FAILED',
      'RATE_LIMITED',
    ]);

    expect(await appSignIn(s, 'student@example.com')).toBe('SIGN_IN_FAILED');
  });

  it('exhausting the app’s limit for the administrator’s own address leaves their sign-in answering', async () => {
    const s = surfaces({ subject: 2, budget: 100 });
    const flood = [];
    for (let n = 0; n < 3; n += 1) flood.push(await appSignIn(s, ADMINISTRATOR));
    expect(flood).toEqual(['SIGN_IN_FAILED', 'SIGN_IN_FAILED', 'RATE_LIMITED']);

    expect(await adminSignIn(s)).toBe('ADMIN_SIGN_IN_FAILED');
  });

  it('exhausting the provider nonce’s budget over many addresses leaves both sign-ins answering', async () => {
    const s = surfaces({ subject: 10, budget: 3 });
    const flood = [];
    for (let n = 0; n < 4; n += 1) {
      flood.push(await codeOf(s.app(`198.51.100.${n}`).auth.providerNonce({})));
    }
    expect(flood).toEqual(['ANSWERED', 'ANSWERED', 'ANSWERED', 'RATE_LIMITED']);

    expect(await appSignIn(s, 'student@example.com')).toBe('SIGN_IN_FAILED');
    expect(await adminSignIn(s)).toBe('ADMIN_SIGN_IN_FAILED');
  });
});
