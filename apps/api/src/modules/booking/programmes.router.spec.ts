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

type Who =
  | 'student'
  | 'applicant'
  | 'approved'
  | 'suspended teacher'
  | 'banned teacher'
  // 006:T009: programme.pay's caller kind.
  | 'suspended student';

function sessionOf(who: Who): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000009f9',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (who === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  if (who === 'suspended student') return { ...base, role: 'student', accountStatus: 'suspended' };
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

// 006:T018: `programme.get`'s answer, as the service would give it to the student.
const GET_ANSWER = {
  state: 'active',
  offerDueAt: null,
  payBy: '2026-10-03T10:00:00.000Z',
  offer: null,
  plan: 'monthly',
  monthsPaid: 2,
  monthCount: 10,
  nextDueAt: '2026-12-12T18:00:00.000Z',
  paused: null,
  renewOpen: false,
  chargePending: false,
  payeePending: false,
  payBlocked: false,
  teacherUnavailable: false,
  card: { last4: '4242', brand: 'Visa' },
  // 006:T019, T020 (B-P4, rule d): neither instant on an active programme.
  stopRequestFrom: null,
  payReminderFrom: null,
} as const;

const unreached = (name: string) => () => Promise.reject(new Error(`${name} is not reached here`));

function callerAs(who: UserSession | null) {
  const calls: unknown[][] = [];
  const limited: unknown[][] = [];
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
      // 006:T018: the read, recorded; another's enrollment NOT_FOUND; a field no schema names
      // (a card's token, as a careless service might add it) stripped.
      get: async (...args: unknown[]) => {
        calls.push(['get', ...args]);
        const [, input] = args as [string, { enrollmentId: string }];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        return {
          ...GET_ANSWER,
          card: { ...GET_ANSWER.card, token: 'placeholder-card-token' },
        } as never;
      },
      // 006:T016: the automatic renewal off, recorded; another's enrollment NOT_FOUND.
      autoRenewOff: async (...args: unknown[]) => {
        calls.push(['autoRenewOff', ...args]);
        const [, input] = args as [string, { enrollmentId: string }];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        return { ok: true, studentUserId: CALLER } as never;
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
    // 006:T009: programme.pay reaches payments' checkout, which owns the orders and the gateway.
    checkout: {
      ...unusedCheckoutServices,
      programmePay: async (...args: unknown[]) => {
        calls.push(['programmePay', ...args]);
        const [, input] = args as [unknown, typeof PAY_INPUT];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        if (input.plan === 'in_full' && input.saveCard) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'pay_by_passed' }],
          });
        }
        return { checkoutUrl: PAY_URL, paymentId: 'never shown' } as never;
      },
      // 006:T016: programme.renew reaches payments' checkout too; a saved-card renewal refused.
      programmeRenew: async (...args: unknown[]) => {
        calls.push(['programmeRenew', ...args]);
        const [, input] = args as [unknown, typeof RENEW_INPUT];
        if (input.enrollmentId === OTHERS) throw new DomainError('NOT_FOUND');
        if (input.saveCard) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'charge_pending' }],
          });
        }
        return { checkoutUrl: PAY_URL, paymentId: 'never shown' } as never;
      },
    } as AppServices['checkout'],
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = {
    check: async (...args: unknown[]) => void limited.push(args),
  } as unknown as RateLimiter;
  const caller: Caller = callerFor(
    createAppContext({ session: who, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
  return { caller, calls, limited };
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
  // SRS DEC-112: `stop` alone (T017's).
  kind: 'stop' as const,
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

  // 006:T008 (SRS DEC-112): no refusal request in the teacher's app; the input takes `stop` only.
  it("refuses the refusal kind VALIDATION_FAILED before the service: 'programme.request'", async () => {
    const { caller, calls } = callerAs(sessionOf('approved'));
    const thrown: unknown = await caller.programme
      .request({ ...REQUESTED, kind: 'refusal' } as never)
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
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

// ---------------------------------------------------------------------------------------------
// 006:T009 (FR-710 to FR-713; R-509): programme.pay, the student kind, counted as a payment's start.

const PAY_INPUT = {
  enrollmentId: OWN,
  plan: 'monthly' as 'in_full' | 'monthly',
  saveCard: true,
  idempotencyKey: KEY,
};
const PAY_URL = 'https://pay.example/programme';

describe("'programme.pay' callers (006:T009)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a teacher FORBIDDEN before the service: 'programme.pay'", async () => {
    await expect(callerAs(null).caller.programme.pay(PAY_INPUT)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    const { caller, calls } = callerAs(sessionOf('approved'));
    await expect(caller.programme.pay(PAY_INPUT)).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it("refuses a suspended student ACCOUNT_RESTRICTED before the service: 'programme.pay'", async () => {
    const { caller, calls } = callerAs(sessionOf('suspended student'));
    await expect(caller.programme.pay(PAY_INPUT)).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    expect(calls).toEqual([]);
  });
});

describe("'programme.pay' (006:T009, FR-710)", () => {
  it("hands payments' checkout the session's own account and gender, the validated input and the request's log", async () => {
    const { caller, calls } = callerAs(sessionOf('student'));
    await caller.programme.pay({ ...PAY_INPUT, studentUserId: OTHERS, amount: 1 } as never);
    expect(calls).toHaveLength(1);
    const [name, student, input, log] = calls[0] ?? [];
    expect([name, student, input]).toEqual([
      'programmePay',
      { userId: CALLER, gender: 'female' },
      PAY_INPUT,
    ]);
    expect(log).toHaveProperty('info');
  });

  it('answers the hosted checkout alone: a field the schema does not name is stripped', async () => {
    const { caller } = callerAs(sessionOf('student'));
    await expect(caller.programme.pay(PAY_INPUT)).resolves.toStrictEqual({ checkoutUrl: PAY_URL });
  });

  it("counts the call under rate_limit_payment_initiation by the caller's id, as checkout.pay", async () => {
    const { caller, limited } = callerAs(sessionOf('student'));
    await caller.programme.pay(PAY_INPUT);
    expect(limited).toContainEqual([
      'rate_limit_payment_initiation',
      { kind: 'user', userId: CALLER },
      'programme.pay',
    ]);
  });

  it('sends another student’s enrollment NOT_FOUND, and a refusal CONFLICT with its cause', async () => {
    const { caller } = callerAs(sessionOf('student'));
    const missing: unknown = await caller.programme
      .pay({ ...PAY_INPUT, enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(missing as Parameters<typeof toErrorShape>[0]).status).toBe(404);
    const late: unknown = await caller.programme
      .pay({ ...PAY_INPUT, plan: 'in_full' })
      .catch((error: unknown) => error);
    expect(toErrorShape(late as Parameters<typeof toErrorShape>[0]).body).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'pay_by_passed' }],
    });
  });

  it('refuses a plan outside in_full and monthly VALIDATION_FAILED before the service', async () => {
    const { caller, calls } = callerAs(sessionOf('student'));
    const thrown: unknown = await caller.programme
      .pay({ ...PAY_INPUT, plan: 'weekly' } as never)
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });
});

// 006:T016 (FR-713a, DEC-95; contracts/app-surface.md `programme.autoRenewOff`): the student kind,
// handed the session's own account, the validated input and the request's after-commit list;
// another's enrollment NOT_FOUND with no field.
describe("'programme.autoRenewOff' callers (006:T016)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a teacher FORBIDDEN before the service: 'programme.autoRenewOff'", async () => {
    const anonymous = callerAs(null);
    await expect(anonymous.caller.programme.autoRenewOff(ACTION)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    const teacher = callerAs(sessionOf('approved'));
    await expect(teacher.caller.programme.autoRenewOff(ACTION)).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect([...anonymous.calls, ...teacher.calls]).toEqual([]);
  });

  it("refuses a suspended student ACCOUNT_RESTRICTED before the service: 'programme.autoRenewOff'", async () => {
    const { caller, calls } = callerAs(sessionOf('suspended student'));
    await expect(caller.programme.autoRenewOff(ACTION)).rejects.toEqual(
      refused('ACCOUNT_RESTRICTED'),
    );
    expect(calls).toEqual([]);
  });

  it("red first: hands the service the student's own account, the validated input and the after-commit list: 'programme.autoRenewOff'", async () => {
    const { caller, calls } = callerAs(sessionOf('student'));
    await expect(
      caller.programme.autoRenewOff({ ...ACTION, studentUserId: OTHERS } as never),
    ).resolves.toStrictEqual({ ok: true });
    const [name, account, input, live] = calls[0] ?? [];
    expect([name, account, input]).toEqual(['autoRenewOff', CALLER, ACTION]);
    expect(live).toHaveProperty('afterCommit');
  });

  it("red first: sends another student's enrollment NOT_FOUND with no field: 'programme.autoRenewOff'", async () => {
    const { caller } = callerAs(sessionOf('student'));
    const thrown: unknown = await caller.programme
      .autoRenewOff({ ...ACTION, enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body).toEqual({
      code: 'NOT_FOUND',
      message: 'Not found.',
    });
  });
});

// 006:T016 (FR-713a, FR-715, FR-716; contracts/app-surface.md `programme.renew`): the student kind,
// counted under `rate_limit_payment_initiation` as `programme.pay` (it creates a gateway order); one
// call of payments' checkout with the session's own account and gender, the validated input and the
// request's log; another's enrollment NOT_FOUND, a refusal CONFLICT with its cause.
const RENEW_INPUT = { enrollmentId: OWN, saveCard: false, idempotencyKey: KEY };

describe("'programme.renew' callers (006:T016)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a teacher FORBIDDEN before the service: 'programme.renew'", async () => {
    await expect(callerAs(null).caller.programme.renew(RENEW_INPUT)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    const { caller, calls } = callerAs(sessionOf('approved'));
    await expect(caller.programme.renew(RENEW_INPUT)).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it("refuses a suspended student ACCOUNT_RESTRICTED before the service: 'programme.renew'", async () => {
    const { caller, calls } = callerAs(sessionOf('suspended student'));
    await expect(caller.programme.renew(RENEW_INPUT)).rejects.toEqual(
      refused('ACCOUNT_RESTRICTED'),
    );
    expect(calls).toEqual([]);
  });
});

describe("'programme.renew' (006:T016, FR-715, FR-716)", () => {
  it("red first: hands payments' checkout the session's own account and gender, the validated input and the request's log", async () => {
    const { caller, calls } = callerAs(sessionOf('student'));
    await caller.programme.renew({ ...RENEW_INPUT, studentUserId: OTHERS, amount: 1 } as never);
    expect(calls).toHaveLength(1);
    const [name, student, input, log] = calls[0] ?? [];
    expect([name, student, input]).toEqual([
      'programmeRenew',
      { userId: CALLER, gender: 'female' },
      RENEW_INPUT,
    ]);
    expect(log).toHaveProperty('info');
  });

  it('red first: answers the hosted checkout alone: a field the schema does not name is stripped', async () => {
    const { caller } = callerAs(sessionOf('student'));
    await expect(caller.programme.renew(RENEW_INPUT)).resolves.toStrictEqual({
      checkoutUrl: PAY_URL,
    });
  });

  it("counts the call under rate_limit_payment_initiation by the caller's id, as programme.pay", async () => {
    const { caller, limited } = callerAs(sessionOf('student'));
    await caller.programme.renew(RENEW_INPUT);
    expect(limited).toContainEqual([
      'rate_limit_payment_initiation',
      { kind: 'user', userId: CALLER },
      'programme.renew',
    ]);
  });

  it('red first: sends another student’s enrollment NOT_FOUND, and a refusal CONFLICT with its cause', async () => {
    const { caller } = callerAs(sessionOf('student'));
    const missing: unknown = await caller.programme
      .renew({ ...RENEW_INPUT, enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(missing as Parameters<typeof toErrorShape>[0]).status).toBe(404);
    const pending: unknown = await caller.programme
      .renew({ ...RENEW_INPUT, saveCard: true })
      .catch((error: unknown) => error);
    expect(toErrorShape(pending as Parameters<typeof toErrorShape>[0]).body).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'charge_pending' }],
    });
  });
});

// 006:T018 (FR-726; contracts/app-surface.md `programme.get`): the participant kind, either party
// reaching the service with the session's own account; another's enrollment NOT_FOUND with no field;
// no card token ever crosses (SC-707).
describe("'programme.get' callers (006:T018)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED and a suspended account ACCOUNT_RESTRICTED before the service: 'programme.get'", async () => {
    const anonymous = callerAs(null);
    await expect(anonymous.caller.programme.get({ enrollmentId: OWN })).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    const suspended = callerAs(sessionOf('suspended student'));
    await expect(suspended.caller.programme.get({ enrollmentId: OWN })).rejects.toEqual(
      refused('ACCOUNT_RESTRICTED'),
    );
    expect([...anonymous.calls, ...suspended.calls]).toEqual([]);
  });

  it("red first: hands the service the caller's own account, the student's and the teacher's alike, and strips any card token: 'programme.get'", async () => {
    for (const who of ['student', 'approved'] as const) {
      const { caller, calls } = callerAs(sessionOf(who));
      const answer = await caller.programme.get({ enrollmentId: OWN, userId: OTHERS } as never);
      expect(answer).toStrictEqual(GET_ANSWER);
      expect(JSON.stringify(answer)).not.toMatch(/placeholder-card-token/);
      expect(calls).toEqual([['get', CALLER, { enrollmentId: OWN }]]);
    }
  });

  it("red first: sends another party's enrollment NOT_FOUND with no field: 'programme.get'", async () => {
    const { caller } = callerAs(sessionOf('student'));
    const thrown: unknown = await caller.programme
      .get({ enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body).toEqual({
      code: 'NOT_FOUND',
      message: 'Not found.',
    });
  });
});
