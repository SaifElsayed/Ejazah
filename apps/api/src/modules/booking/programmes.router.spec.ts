// 006:T007 — `programme.offer` as the user surface serves it (contracts/app-surface.md; FR-705).
//
// The teacher kind admitting an approved teacher: an anonymous caller is UNAUTHENTICATED, a student
// and an applicant FORBIDDEN, a suspended or banned teacher ACCOUNT_RESTRICTED, and none of them
// reaches the service. The service is handed the session's own account, the validated input
// (anything else the input says dropped) and the request's after-commit list; the output schema
// strips a field it does not name. Another teacher's enrollment is NOT_FOUND with no field, and a
// refusal is CONFLICT with its cause. The authorization gate (R-MOBILE-13, `pnpm check:authz`) reads
// these cases by path.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
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
import type { BookingServices } from './index.js';
import { programmesRouter } from './programmes.router.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000009f1';
const OWN = '0199d0a0-0000-7000-8000-0000000009f2';
const OTHERS = '0199d0a0-0000-7000-8000-0000000009f3';
const KEY = '0199d0a0-0000-7000-8000-0000000009f4';
const REQUEST = '0199d0a0-0000-7000-8000-0000000009f5';

const surfaceRouter = createAppRouter({ programme: programmesRouter });
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Who = 'student' | 'applicant' | 'approved' | 'suspended teacher' | 'banned teacher';

function sessionOf(who: Who): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000009f9',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (who === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  const applicant = who === 'applicant';
  return {
    ...base,
    role: 'teacher',
    accountStatus:
      who === 'suspended teacher' ? 'suspended' : who === 'banned teacher' ? 'banned' : 'active',
    teacher: {
      verificationStatus: applicant ? 'pending' : 'approved',
      payoutVerified: !applicant,
      applicationStatus: applicant ? 'in_review' : 'approved',
    },
  };
}

const INPUT = {
  enrollmentId: OWN,
  level: 'يحفظ جزء عم',
  readiness: 'جاهز',
  expectedLength: 'عشرة أشهر',
  durationMinutes: 45 as const,
  sessionCount: 40,
  idempotencyKey: KEY,
};
const ANSWER = { total_piasters: 1_000_000, sessionPrice_piasters: 25_000, monthCount: 10 };

const unreached = (name: string) => () => Promise.reject(new Error(`${name} is not reached here`));

function callerAs(who: UserSession | null) {
  const calls: unknown[][] = [];
  const booking = {
    slots: unreached('booking.slots'),
    enrollments: unreached('enrollments.list'),
    enrollment: unreached('enrollments.get'),
    students: unreached('teacher.students.list'),
    student: unreached('teacher.students.get'),
    today: unreached('teacher.today'),
    programme: {
      offer: async (...args: unknown[]) => {
        calls.push(['offer', ...args]);
        const [, input] = args as [string, typeof INPUT];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        if (input.sessionCount === 1) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'offer_due_passed' }],
          });
        }
        // A field no schema names, as a careless service might add it: stripped.
        return { ...ANSWER, teacherUserId: CALLER } as never;
      },
      // 006:T008: the cancellation and the request, each recorded; another's enrollment NOT_FOUND.
      cancel: async (...args: unknown[]) => {
        calls.push(['cancel', ...args]);
        const [, input] = args as [string, { enrollmentId: string }];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        return { ok: true, studentUserId: CALLER } as never;
      },
      request: async (...args: unknown[]) => {
        calls.push(['request', ...args]);
        const [, input] = args as [string, { enrollmentId: string }];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        return { requestId: REQUEST, teacherUserId: CALLER } as never;
      },
    },
  } as unknown as BookingServices;
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    catalog: unusedCatalogServices,
    discovery: unusedDiscoveryServices,
    booking,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: async () => undefined } as unknown as RateLimiter;
  const caller: Caller = callerFor(
    createAppContext({ session: who, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
  return { caller, calls };
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe("'programme.offer' callers (006:T007)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'programme.offer'", async () => {
    const { caller, calls } = callerAs(null);
    await expect(caller.programme.offer(INPUT)).rejects.toEqual(refused('UNAUTHENTICATED'));
    expect(calls).toEqual([]);
  });

  it("refuses a student and an applicant FORBIDDEN before the service: 'programme.offer'", async () => {
    for (const who of ['student', 'applicant'] as const) {
      const { caller, calls } = callerAs(sessionOf(who));
      await expect(caller.programme.offer(INPUT), who).rejects.toEqual(refused('FORBIDDEN'));
      expect(calls).toEqual([]);
    }
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED before the service: 'programme.offer'", async () => {
    for (const who of ['suspended teacher', 'banned teacher'] as const) {
      const { caller, calls } = callerAs(sessionOf(who));
      await expect(caller.programme.offer(INPUT), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
      expect(calls).toEqual([]);
    }
  });
});

describe("'programme.offer' (006:T007, FR-705)", () => {
  it("hands the service the session's own account, the validated input and the after-commit list", async () => {
    const { caller, calls } = callerAs(sessionOf('approved'));
    await caller.programme.offer({ ...INPUT, teacherUserId: OTHERS, price: 1 } as never);
    expect(calls).toHaveLength(1);
    const [name, account, input, live] = calls[0] ?? [];
    expect([name, account, input]).toEqual(['offer', CALLER, INPUT]);
    expect(live).toHaveProperty('afterCommit');
  });

  it('answers the amounts alone: a field the schema does not name is stripped', async () => {
    const { caller } = callerAs(sessionOf('approved'));
    await expect(caller.programme.offer(INPUT)).resolves.toStrictEqual(ANSWER);
  });

  it('sends another teacher’s enrollment NOT_FOUND with no field', async () => {
    const { caller } = callerAs(sessionOf('approved'));
    const thrown: unknown = await caller.programme
      .offer({ ...INPUT, enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0])).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found.' },
      unexpected: false,
    });
  });

  it('answers a refusal CONFLICT with its cause', async () => {
    const { caller } = callerAs(sessionOf('approved'));
    const thrown: unknown = await caller.programme
      .offer({ ...INPUT, sessionCount: 1 })
      .catch((error: unknown) => error);
    const shape = toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
    expect(shape.status).toBe(409);
    expect(shape.body).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'offer_due_passed' }],
    });
  });

  it.each([0, 201])(
    'refuses a count of %i VALIDATION_FAILED before the service (the contract’s 1 to 200)',
    async (sessionCount) => {
      const { caller, calls } = callerAs(sessionOf('approved'));
      const thrown: unknown = await caller.programme
        .offer({ ...INPUT, sessionCount })
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
      expect(calls).toEqual([]);
    },
  );
});

// 006:T008 (FR-706, FR-709; contracts/app-surface.md `programme.cancel`, `programme.request`): the
// student's cancellation (the student kind) and the teacher's refusal request (the teacher kind
// admitting an approved teacher), each handed the session's own account, the validated input and
// the request's after-commit list; another's enrollment NOT_FOUND with no field.
const ACTION = { enrollmentId: OWN, idempotencyKey: KEY };
const REQUESTED = {
  enrollmentId: OWN,
  kind: 'refusal' as const,
  reason: 'غير مستعد',
  idempotencyKey: KEY,
};

describe("'programme.cancel' callers (006:T008)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a teacher FORBIDDEN before the service: 'programme.cancel'", async () => {
    const anonymous = callerAs(null);
    await expect(anonymous.caller.programme.cancel(ACTION)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    const teacher = callerAs(sessionOf('approved'));
    await expect(teacher.caller.programme.cancel(ACTION)).rejects.toEqual(refused('FORBIDDEN'));
    expect([...anonymous.calls, ...teacher.calls]).toEqual([]);
  });

  it("hands the service the student's own account, the validated input and the after-commit list: 'programme.cancel'", async () => {
    const { caller, calls } = callerAs(sessionOf('student'));
    await expect(
      caller.programme.cancel({ ...ACTION, studentUserId: OTHERS } as never),
    ).resolves.toStrictEqual({ ok: true });
    const [name, account, input, live] = calls[0] ?? [];
    expect([name, account, input]).toEqual(['cancel', CALLER, ACTION]);
    expect(live).toHaveProperty('afterCommit');
  });

  it("sends another student's enrollment NOT_FOUND with no field: 'programme.cancel'", async () => {
    const { caller } = callerAs(sessionOf('student'));
    const thrown: unknown = await caller.programme
      .cancel({ ...ACTION, enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body).toEqual({
      code: 'NOT_FOUND',
      message: 'Not found.',
    });
  });
});

describe("'programme.request' callers (006:T008)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED, a student and an applicant FORBIDDEN before the service: 'programme.request'", async () => {
    const anonymous = callerAs(null);
    await expect(anonymous.caller.programme.request(REQUESTED)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    for (const who of ['student', 'applicant'] as const) {
      const { caller, calls } = callerAs(sessionOf(who));
      await expect(caller.programme.request(REQUESTED), who).rejects.toEqual(refused('FORBIDDEN'));
      expect(calls).toEqual([]);
    }
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED before the service: 'programme.request'", async () => {
    for (const who of ['suspended teacher', 'banned teacher'] as const) {
      const { caller, calls } = callerAs(sessionOf(who));
      await expect(caller.programme.request(REQUESTED), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
      expect(calls).toEqual([]);
    }
  });

  it("hands the service the teacher's own account, the validated input and the after-commit list: 'programme.request'", async () => {
    const { caller, calls } = callerAs(sessionOf('approved'));
    await expect(
      caller.programme.request({ ...REQUESTED, teacherUserId: OTHERS } as never),
    ).resolves.toStrictEqual({ requestId: REQUEST });
    const [name, account, input, live] = calls[0] ?? [];
    expect([name, account, input]).toEqual(['request', CALLER, REQUESTED]);
    expect(live).toHaveProperty('afterCommit');
  });

  it("refuses a blank or over-long reason VALIDATION_FAILED before the service: 'programme.request'", async () => {
    for (const reason of ['   ', 'x'.repeat(501)]) {
      const { caller, calls } = callerAs(sessionOf('approved'));
      const thrown: unknown = await caller.programme
        .request({ ...REQUESTED, reason })
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
      expect(calls).toEqual([]);
    }
  });
});
