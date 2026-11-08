// T099 — the mutations that take nothing reach their procedures over real HTTP, through the tRPC
// client the apps use. tRPC 11.19's client sends a mutation whose input is `undefined` with no body
// and its server cannot read one, so each of these answered 500 INTERNAL from the phone and the
// panel; each now takes the contracts' empty object and its client sends `{}`.
//
// The application is built as main.ts builds it, with the real routers of both surfaces, and
// listened on an ephemeral port. The sessions resolve from fixed bearers, and the services are
// stand-ins that record what reached them, so each call's answer and record prove the body was read
// and the procedure ran: `auth.providerNonce`, both `auth.signOut`s and
// `teacher.application.markApprovedShown` answer success; the deprecated
// `admins.regenerateRecoveryCodes` answers its own refusal, `CODE_INVALID`, which only its
// procedure gives.
import type { INestApplication } from '@nestjs/common';
import { createTRPCUntypedClient, httpLink } from '@trpc/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication, surfacePaths } from '../app.module.js';
import type { CatalogServices } from '../modules/catalog/index.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { VerificationServices } from '../modules/verification/index.js';
import { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import type { AdminSession, AdminSurfaceServices, UserSession } from './context.js';
import {
  unusedBookingServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
} from './services.fixtures.js';

const NONCE = { nonce: 'n-0199d0a0', expiresAt: '2026-10-27T10:00:00.000Z' };

const STUDENT: UserSession = {
  userId: '0199d0a0-0000-7000-8000-000000000001',
  sessionId: '0199d0a0-0000-7000-8000-0000000000s1',
  role: 'student',
  gender: 'male',
  preferredLanguage: 'ar',
  accountStatus: 'active',
};
const APPLICANT: UserSession = {
  userId: '0199d0a0-0000-7000-8000-000000000002',
  sessionId: '0199d0a0-0000-7000-8000-0000000000s2',
  role: 'teacher',
  gender: 'female',
  preferredLanguage: 'ar',
  accountStatus: 'active',
  teacher: { verificationStatus: 'pending', payoutVerified: false, applicationStatus: 'approved' },
};
const ADMINISTRATOR: AdminSession = {
  adminId: '0199d0a0-0000-7000-8000-000000000003',
  sessionId: '0199d0a0-0000-7000-8000-0000000000s3',
  mfaVerified: true,
};
const userSessions: Readonly<Record<string, UserSession>> = {
  'student-bearer': STUDENT,
  'applicant-bearer': APPLICANT,
};
const adminSessions: Readonly<Record<string, AdminSession>> = { 'admin-bearer': ADMINISTRATOR };

/** What reached a stand-in service, in order. */
let reached: string[] = [];

/** A module's services with only `members` answering; any other call fails loudly. */
function only<T>(module: string, members: Record<string, object>): T {
  return new Proxy(members, {
    get: (target, service: string) =>
      target[service] ??
      new Proxy(
        {},
        {
          get: (_inner, method) => () => {
            throw new Error(`${module}.${service}.${String(method)}: not reached by this spec`);
          },
        },
      ),
  }) as T;
}

const identity = only<IdentityServices>('identity', {
  signIn: {
    providerNonce: async () => {
      reached.push('identity.signIn.providerNonce');
      return NONCE;
    },
  },
  sessions: {
    signOut: async (sessionId: string) => {
      reached.push(`identity.sessions.signOut ${sessionId}`);
    },
  },
});
const verification = only<VerificationServices>('verification', {
  application: {
    markApprovedShown: async (userId: string) => {
      reached.push(`verification.application.markApprovedShown ${userId}`);
    },
  },
});
const catalog = only<CatalogServices>('catalog', {});
const adminServices = only<AdminSurfaceServices>('admin', {
  sessions: {
    signOut: async (sessionId: string) => {
      reached.push(`admin.sessions.signOut ${sessionId}`);
    },
  },
});

// Every public procedure declares a limit (T170); the limits are tested in platform/guards, so
// this limiter admits every call.
const rateLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32),
});

// The administrator kind runs each call in a transaction and audits it (T108); the stand-ins run
// the work and record the audit, so `auth.signOut`'s record shows it ran.
const administration = {
  transactions: { run: <T>(work: (tx: never) => Promise<T>) => work(undefined as never) },
  auditWriter: {
    write: async (_tx: unknown, record: { readonly action: string }) => {
      reached.push(`audit ${record.action}`);
    },
  },
};

const unexpected: string[] = [];
let application: INestApplication;
let origin: string;

beforeAll(async () => {
  const log = createLogger({
    level: 'info',
    destination: {
      write: (line) => {
        if (line.includes('Unexpected')) unexpected.push(line);
      },
    },
  });
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 64 * 1024,
    administration,
    rateLimiter,
    sessions: {
      user: async (bearer) => userSessions[bearer] ?? null,
      admin: async (bearer) => adminSessions[bearer] ?? null,
    },
    services: {
      settings: {
        read: async () => {
          throw new Error('no setting is read here');
        },
      },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity,
      verification,
      catalog,
      teacherProfile: unusedTeacherProfileServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions: unusedSessionsServices,
    },
    adminServices,
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

beforeEach(() => {
  reached = [];
  unexpected.length = 0;
});

/** What went over the wire for one call: the body sent, and the status and body answered. */
interface Exchange {
  readonly sent: unknown;
  readonly status: number;
  readonly answer: unknown;
}

/** A real tRPC client of one surface, as apps/mobile and apps/admin build theirs, with a bearer. */
function clientOf(surface: keyof typeof surfacePaths, bearer?: string) {
  const exchanges: Exchange[] = [];
  const client = createTRPCUntypedClient({
    links: [
      httpLink({
        url: `${origin}${surfacePaths[surface]}`,
        headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
        fetch: async (input, init) => {
          // As apps/mobile and apps/admin hand the link their transport (`asFetchEsque`).
          const response = await fetch(input, init as RequestInit | undefined);
          exchanges.push({
            sent: init?.body ?? null,
            status: response.status,
            answer: await response.clone().json(),
          });
          return response;
        },
      }),
    ],
  });
  return {
    /** Sends `path` as the app's client does, with the empty input, and keeps what came back. */
    async mutateEmpty(path: string): Promise<Exchange> {
      await client.mutation(path, {}).catch(() => undefined);
      const exchange = exchanges.at(-1);
      if (exchange === undefined) throw new Error(`${path}: nothing was sent`);
      return exchange;
    },
  };
}

describe('a mutation that takes nothing reaches its procedure over HTTP (T099)', () => {
  it('auth.providerNonce answers a nonce to an anonymous caller', async () => {
    const exchange = await clientOf('app').mutateEmpty('auth.providerNonce');
    expect(exchange).toEqual({ sent: '{}', status: 200, answer: { result: { data: NONCE } } });
    expect(reached).toEqual(['identity.signIn.providerNonce']);
  });

  it('the user surface’s auth.signOut ends the caller’s session', async () => {
    const exchange = await clientOf('app', 'student-bearer').mutateEmpty('auth.signOut');
    expect(exchange).toEqual({ sent: '{}', status: 200, answer: { result: {} } });
    expect(reached).toEqual([`identity.sessions.signOut ${STUDENT.sessionId}`]);
  });

  it('teacher.application.markApprovedShown marks the applicant’s own screen shown', async () => {
    const exchange = await clientOf('app', 'applicant-bearer').mutateEmpty(
      'teacher.application.markApprovedShown',
    );
    expect(exchange).toEqual({ sent: '{}', status: 200, answer: { result: {} } });
    expect(reached).toEqual([`verification.application.markApprovedShown ${APPLICANT.userId}`]);
  });

  it('the administrator surface’s auth.signOut ends the session and audits it', async () => {
    const exchange = await clientOf('admin', 'admin-bearer').mutateEmpty('auth.signOut');
    expect(exchange).toEqual({ sent: '{}', status: 200, answer: { result: {} } });
    expect(reached).toEqual([
      `admin.sessions.signOut ${ADMINISTRATOR.sessionId}`,
      'audit admin.sign_out',
    ]);
  });

  it('admins.regenerateRecoveryCodes answers its own refusal, CODE_INVALID', async () => {
    const exchange = await clientOf('admin', 'admin-bearer').mutateEmpty(
      'admins.regenerateRecoveryCodes',
    );
    expect(exchange).toEqual({
      sent: '{}',
      status: 400,
      answer: { error: { code: 'CODE_INVALID', message: 'The code is not valid.' } },
    });
  });

  it('logs no unexpected failure for any of them', async () => {
    await clientOf('app').mutateEmpty('auth.providerNonce');
    await clientOf('app', 'student-bearer').mutateEmpty('auth.signOut');
    await clientOf('app', 'applicant-bearer').mutateEmpty('teacher.application.markApprovedShown');
    await clientOf('admin', 'admin-bearer').mutateEmpty('auth.signOut');
    await clientOf('admin', 'admin-bearer').mutateEmpty('admins.regenerateRecoveryCodes');
    expect(unexpected).toEqual([]);
  });
});
