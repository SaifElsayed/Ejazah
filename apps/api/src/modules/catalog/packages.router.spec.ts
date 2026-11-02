// T018 — the `teacher.packages` namespace as the user surface serves it (app-surface.md
// "`teacher.packages` — catalog"; FR-311 to FR-315, R-106, R-218).
//
// The three procedures are the teacher kind admitting an approved teacher, whose payout account may
// be unverified, since drafting comes before publishing (FR-315): an anonymous caller is
// UNAUTHENTICATED, a student and an applicant FORBIDDEN, a suspended or banned teacher
// ACCOUNT_RESTRICTED, and none of them reaches the service. The admitted call passes the caller's
// own id, never one from the input, and the list passes the caller's payout state as `published`.
// The authorization gate (T028, R-MOBILE-13) reads these cases by path. What the service answers is
// packages.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import {
  unusedCatalogServices,
  unusedIdentityServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import type { CatalogServices } from './index.js';
import { packagesRouter } from './packages.router.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000000e1';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000000e2';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-0000000000e3', nameAr: 'حفص', nameEn: 'Hafs' };
const KEY = 'spec-packages-key-0002';

const ANSWER = {
  id: PACKAGE,
  subject: SUBJECT,
  track: 'recitation',
  sessionCount: 4,
  sessionDurationMinutes: 60,
  price_piasters: 100_000,
  perSession_piasters: 25_000,
  isActive: true,
  activeEnrollmentCount: 0,
  frozen: false,
} as const;

const CREATE = {
  subjectId: SUBJECT.id,
  track: 'recitation',
  sessionCount: 4,
  sessionDurationMinutes: 60,
  price_piasters: 100_000,
  isActive: true,
  idempotencyKey: KEY,
} as const;

const surfaceRouter = createAppRouter({
  teacher: createAppRouter({ packages: packagesRouter }),
});
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Standing =
  'student' | 'applicant' | 'approved' | 'publishable' | 'suspended teacher' | 'banned teacher';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000e9',
    gender: 'female' as const,
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

let calls: unknown[][];
let packages: CatalogServices['packages'];

beforeEach(() => {
  calls = [];
  packages = {
    list: async (...args) => {
      calls.push(['list', ...args]);
      return { published: args[1], packages: [ANSWER] };
    },
    create: async (...args) => {
      calls.push(['create', ...args]);
      return ANSWER;
    },
    update: async (...args) => {
      calls.push(['update', ...args]);
      return ANSWER;
    },
  } as CatalogServices['packages'];
});

function callerAs(session: UserSession | null): Caller {
  const catalog = new Proxy(unusedCatalogServices, {
    get: (target, service) => (service === 'packages' ? packages : Reflect.get(target, service)),
  });
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    catalog,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

function callsOf(caller: Caller) {
  return {
    'teacher.packages.list': () => caller.teacher.packages.list(),
    'teacher.packages.create': () => caller.teacher.packages.create(CREATE),
    'teacher.packages.update': () =>
      caller.teacher.packages.update({ packageId: PACKAGE, isActive: false }),
  };
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe('the namespace', () => {
  it("refuses an anonymous caller UNAUTHENTICATED: 'teacher.packages.list', 'teacher.packages.create', 'teacher.packages.update'", async () => {
    for (const [path, call] of Object.entries(callsOf(callerAs(null)))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a student and an applicant FORBIDDEN: 'teacher.packages.list', 'teacher.packages.create', 'teacher.packages.update'", async () => {
    for (const standing of ['student', 'applicant'] as const) {
      for (const [path, call] of Object.entries(callsOf(callerAs(sessionOf(standing))))) {
        await expect(call(), `${standing} ${path}`).rejects.toEqual(refused('FORBIDDEN'));
      }
    }
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED: 'teacher.packages.list', 'teacher.packages.create', 'teacher.packages.update'", async () => {
    for (const standing of ['suspended teacher', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(callsOf(callerAs(sessionOf(standing))))) {
        await expect(call(), `${standing} ${path}`).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(calls).toEqual([]);
  });

  it('admits an approved teacher whose payout account is not verified, and lists with `published` false (FR-315)', async () => {
    const caller = callerAs(sessionOf('approved'));
    await expect(caller.teacher.packages.list()).resolves.toEqual({
      published: false,
      packages: [ANSWER],
    });
    await expect(caller.teacher.packages.create(CREATE)).resolves.toEqual(ANSWER);
    await expect(
      caller.teacher.packages.update({ packageId: PACKAGE, price_piasters: 120_000 }),
    ).resolves.toEqual(ANSWER);
    expect(calls).toEqual([
      ['list', CALLER, false],
      ['create', CALLER, CREATE],
      ['update', CALLER, { packageId: PACKAGE, price_piasters: 120_000 }],
    ]);
  });

  it('lists a verified payout account’s packages with `published` true', async () => {
    await expect(callerAs(sessionOf('publishable')).teacher.packages.list()).resolves.toMatchObject(
      { published: true },
    );
    expect(calls).toEqual([['list', CALLER, true]]);
  });

  it('refuses a length outside 30, 45 and 60, a price of zero and more than 52 sessions VALIDATION_FAILED before the service', async () => {
    const caller = callerAs(sessionOf('approved'));
    for (const call of [
      caller.teacher.packages.create({ ...CREATE, sessionDurationMinutes: 50 } as never),
      caller.teacher.packages.create({ ...CREATE, price_piasters: 0 }),
      caller.teacher.packages.update({ packageId: PACKAGE, sessionCount: 0 }),
      // At most 52 sessions (the owner's decision of 2026-11-02).
      caller.teacher.packages.create({ ...CREATE, sessionCount: 53 }),
      caller.teacher.packages.update({ packageId: PACKAGE, sessionCount: 53 }),
    ]) {
      const thrown: unknown = await call.catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(calls).toEqual([]);
  });
});
