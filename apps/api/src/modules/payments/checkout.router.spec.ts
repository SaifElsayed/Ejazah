// T036, T037 — the `checkout` namespace as the user surface serves it (app-surface.md "`checkout` —
// payments"; FR-351 to FR-357, FR-380 to FR-386, R-GENDER-4, M3).
//
// Every procedure is the student kind: an anonymous caller is UNAUTHENTICATED, a teacher FORBIDDEN,
// a suspended or banned student ACCOUNT_RESTRICTED, and none of them reaches the service. `hold`,
// `pay` and `retry` are counted under `rate_limit_payment_initiation` by the caller's own id before
// the service is reached (FR-357). The service is handed the session's account and gender, in both
// directions, never anything the input says. The authorization gate (R-MOBILE-13,
// `pnpm check:authz`) reads these cases by path. What the services answer is
// checkout.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { checkoutRouter } from './checkout.router.js';
import type { CheckoutServices } from './index.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000000e1';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000000e2';
const SLOT = '0199d0a0-0000-7000-8000-0000000000e3';
const HOLD = '0199d0a0-0000-7000-8000-0000000000e4';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e5';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000e6';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000e7';
const KEY = 'checkout-attempt-0001';

const surfaceRouter = createAppRouter({ checkout: checkoutRouter });
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Who = 'student' | 'teacher' | 'suspended student' | 'banned student';

function sessionOf(who: Who, gender: 'male' | 'female' = 'female'): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000e9',
    gender,
    preferredLanguage: 'ar' as const,
  };
  if (who === 'teacher') {
    return {
      ...base,
      role: 'teacher',
      accountStatus: 'active',
      teacher: {
        verificationStatus: 'approved',
        payoutVerified: true,
        applicationStatus: 'approved',
      },
    };
  }
  const accountStatus =
    who === 'suspended student' ? 'suspended' : who === 'banned student' ? 'banned' : 'active';
  return { ...base, role: 'student', accountStatus };
}

const summary = {
  teacher: { teacherId: TEACHER, displayName: 'الشيخ' },
  subject: { id: SUBJECT, nameAr: 'تجويد', nameEn: 'Tajweed' },
  track: 'recitation' as const,
  sessionCount: 4,
  sessionDurationMinutes: 60 as const,
  price_piasters: 100_000,
};
const handover = {
  checkoutUrl: 'https://pay.example/order',
  orderExpiresAt: '2026-11-03T08:10:00.000Z',
};

let calls: unknown[][];
let limited: unknown[][];
let refuseAtLimit: boolean;

const checkout: CheckoutServices = {
  hold: async (...args) => {
    calls.push(['hold', ...args]);
    return {
      holdId: HOLD,
      expiresAt: '2026-11-03T08:15:00.000Z',
      payBy: '2026-11-03T08:10:00.000Z',
      summary,
      firstSession: { localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00.000Z' },
      lastSession: { localDate: '2026-11-26', startsAt: '2026-11-26T07:00:00.000Z' },
    };
  },
  pay: async (...args) => {
    calls.push(['pay', ...args]);
    return { enrollmentId: ENROLLMENT, ...handover };
  },
  retry: async (...args) => {
    calls.push(['retry', ...args]);
    return handover;
  },
  current: async (...args) => {
    calls.push(['current', ...args]);
    return {
      hold: {
        holdId: HOLD,
        expiresAt: '2026-11-03T08:15:00.000Z',
        payBy: '2026-11-03T08:10:00.000Z',
        enrollmentId: ENROLLMENT,
        summary,
        lastOrder: { status: 'created', expiresAt: handover.orderExpiresAt, canContinue: true },
      },
    };
  },
  continue: async (...args) => {
    calls.push(['continue', ...args]);
    return handover;
  },
  status: async (...args) => {
    calls.push(['status', ...args]);
    return {
      status: 'pending_payment',
      lastOrder: { status: 'created', reference: 'ord-1' },
      summary,
    };
  },
};

const quoted = {
  price_piasters: 100_000,
  sessionCount: 4,
  sessionDurationMinutes: 60 as const,
  track: 'recitation' as const,
};

beforeEach(() => {
  calls = [];
  limited = [];
  refuseAtLimit = false;
});

function callerAs(session: UserSession | null): Caller {
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    catalog: unusedCatalogServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = {
    check: vi.fn(async (...args: unknown[]) => {
      limited.push(args);
      if (refuseAtLimit) throw new DomainError('RATE_LIMITED');
    }),
  } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

/** Each procedure with a valid input, as the phone sends it. */
const procedures = {
  hold: (caller: Caller) =>
    caller.checkout.hold({ packageId: PACKAGE, slotId: SLOT, idempotencyKey: KEY }),
  pay: (caller: Caller) => caller.checkout.pay({ holdId: HOLD, quoted, idempotencyKey: KEY }),
  retry: (caller: Caller) =>
    caller.checkout.retry({ enrollmentId: ENROLLMENT, idempotencyKey: KEY }),
};

describe.each(Object.entries(procedures))("'checkout.%s' (T036)", (name, call) => {
  it(`refuses an anonymous caller UNAUTHENTICATED and a teacher FORBIDDEN before the service: 'checkout.${name}'`, async () => {
    await expect(call(callerAs(null))).rejects.toEqual(refused('UNAUTHENTICATED'));
    await expect(call(callerAs(sessionOf('teacher')))).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it(`refuses a suspended or a banned student ACCOUNT_RESTRICTED before the service: 'checkout.${name}'`, async () => {
    for (const who of ['suspended student', 'banned student'] as const) {
      await expect(call(callerAs(sessionOf(who))), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it(`counts every call under rate_limit_payment_initiation by the caller's id, and refuses one past it RATE_LIMITED before the service: 'checkout.${name}'`, async () => {
    const caller = callerAs(sessionOf('student'));
    await call(caller);
    expect(limited).toEqual([['rate_limit_payment_initiation', CALLER]]);
    refuseAtLimit = true;
    calls = [];
    await expect(call(caller)).rejects.toEqual(refused('RATE_LIMITED'));
    expect(calls).toEqual([]);
  });
});

// The authorization gate reads one path per test: `checkout.hold` and `checkout.retry` named here.
describe('the student kind on each keyed procedure (R-MOBILE-13)', () => {
  it("refuses 'checkout.hold' UNAUTHENTICATED and FORBIDDEN", async () => {
    await expect(
      callerAs(null).checkout.hold({ packageId: PACKAGE, slotId: SLOT, idempotencyKey: KEY }),
    ).rejects.toEqual(refused('UNAUTHENTICATED'));
    await expect(
      callerAs(sessionOf('teacher')).checkout.hold({
        packageId: PACKAGE,
        slotId: SLOT,
        idempotencyKey: KEY,
      }),
    ).rejects.toEqual(refused('FORBIDDEN'));
  });

  it("refuses 'checkout.pay' UNAUTHENTICATED and FORBIDDEN", async () => {
    await expect(
      callerAs(null).checkout.pay({ holdId: HOLD, quoted, idempotencyKey: KEY }),
    ).rejects.toEqual(refused('UNAUTHENTICATED'));
    await expect(
      callerAs(sessionOf('teacher')).checkout.pay({ holdId: HOLD, quoted, idempotencyKey: KEY }),
    ).rejects.toEqual(refused('FORBIDDEN'));
  });

  it("refuses 'checkout.retry' UNAUTHENTICATED and FORBIDDEN", async () => {
    await expect(
      callerAs(null).checkout.retry({ enrollmentId: ENROLLMENT, idempotencyKey: KEY }),
    ).rejects.toEqual(refused('UNAUTHENTICATED'));
    await expect(
      callerAs(sessionOf('teacher')).checkout.retry({
        enrollmentId: ENROLLMENT,
        idempotencyKey: KEY,
      }),
    ).rejects.toEqual(refused('FORBIDDEN'));
  });
});

describe('the session, never the input (R-GENDER-4)', () => {
  it("hands 'checkout.hold', 'checkout.pay' and 'checkout.retry' the session's account and gender, in both directions, whatever the input says", async () => {
    for (const gender of ['female', 'male'] as const) {
      const other = gender === 'female' ? 'male' : 'female';
      const caller = callerAs(sessionOf('student', gender));
      await caller.checkout.hold({
        packageId: PACKAGE,
        slotId: SLOT,
        idempotencyKey: KEY,
        gender: other,
        userId: TEACHER,
      } as never);
      await caller.checkout.pay({
        holdId: HOLD,
        quoted,
        idempotencyKey: KEY,
        gender: other,
      } as never);
      await caller.checkout.retry({
        enrollmentId: ENROLLMENT,
        idempotencyKey: KEY,
        gender: other,
      } as never);
    }
    expect(calls).toEqual([
      [
        'hold',
        { userId: CALLER, gender: 'female' },
        { packageId: PACKAGE, slotId: SLOT, idempotencyKey: KEY },
      ],
      ['pay', { userId: CALLER, gender: 'female' }, { holdId: HOLD, quoted, idempotencyKey: KEY }],
      [
        'retry',
        { userId: CALLER, gender: 'female' },
        { enrollmentId: ENROLLMENT, idempotencyKey: KEY },
      ],
      [
        'hold',
        { userId: CALLER, gender: 'male' },
        { packageId: PACKAGE, slotId: SLOT, idempotencyKey: KEY },
      ],
      ['pay', { userId: CALLER, gender: 'male' }, { holdId: HOLD, quoted, idempotencyKey: KEY }],
      [
        'retry',
        { userId: CALLER, gender: 'male' },
        { enrollmentId: ENROLLMENT, idempotencyKey: KEY },
      ],
    ]);
  });

  it("answers 'checkout.hold' and 'checkout.retry' parsed by their output schemas", async () => {
    const caller = callerAs(sessionOf('student'));
    await expect(procedures.hold(caller)).resolves.toMatchObject({ holdId: HOLD, summary });
    await expect(procedures.pay(caller)).resolves.toEqual({
      enrollmentId: ENROLLMENT,
      ...handover,
    });
    await expect(procedures.retry(caller)).resolves.toEqual(handover);
  });
});

/** The three reads (T037): the student kind, no rate limit declared (app-surface.md). */
const reads = {
  current: (caller: Caller) => caller.checkout.current({}),
  continue: (caller: Caller) => caller.checkout.continue({ enrollmentId: ENROLLMENT }),
  status: (caller: Caller) => caller.checkout.status({ enrollmentId: ENROLLMENT }),
};

describe('the reads of T037 (FR-BOOK-12 (c), FR-380 to FR-386, M3)', () => {
  it("refuses 'checkout.current' UNAUTHENTICATED and FORBIDDEN before the service", async () => {
    await expect(callerAs(null).checkout.current({})).rejects.toEqual(refused('UNAUTHENTICATED'));
    await expect(callerAs(sessionOf('teacher')).checkout.current({})).rejects.toEqual(
      refused('FORBIDDEN'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses 'checkout.continue' UNAUTHENTICATED and FORBIDDEN before the service", async () => {
    await expect(callerAs(null).checkout.continue({ enrollmentId: ENROLLMENT })).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    await expect(
      callerAs(sessionOf('teacher')).checkout.continue({ enrollmentId: ENROLLMENT }),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it("refuses 'checkout.status' UNAUTHENTICATED and FORBIDDEN before the service", async () => {
    await expect(callerAs(null).checkout.status({ enrollmentId: ENROLLMENT })).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    await expect(
      callerAs(sessionOf('teacher')).checkout.status({ enrollmentId: ENROLLMENT }),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it('refuses a suspended or a banned student ACCOUNT_RESTRICTED before the service, each read', async () => {
    for (const call of Object.values(reads)) {
      for (const who of ['suspended student', 'banned student'] as const) {
        await expect(call(callerAs(sessionOf(who))), who).rejects.toEqual(
          refused('ACCOUNT_RESTRICTED'),
        );
      }
    }
    expect(calls).toEqual([]);
  });

  it('hands each read the session’s account and gender, in both directions, and counts none of them', async () => {
    for (const gender of ['female', 'male'] as const) {
      const caller = callerAs(sessionOf('student', gender));
      for (const call of Object.values(reads)) await call(caller);
    }
    expect(calls).toEqual([
      ['current', { userId: CALLER, gender: 'female' }],
      ['continue', { userId: CALLER, gender: 'female' }, { enrollmentId: ENROLLMENT }],
      ['status', { userId: CALLER, gender: 'female' }, { enrollmentId: ENROLLMENT }],
      ['current', { userId: CALLER, gender: 'male' }],
      ['continue', { userId: CALLER, gender: 'male' }, { enrollmentId: ENROLLMENT }],
      ['status', { userId: CALLER, gender: 'male' }, { enrollmentId: ENROLLMENT }],
    ]);
    expect(limited).toEqual([]);
  });

  it('answers each read parsed by its output schema', async () => {
    const caller = callerAs(sessionOf('student'));
    await expect(reads.current(caller)).resolves.toMatchObject({ hold: { holdId: HOLD } });
    await expect(reads.continue(caller)).resolves.toEqual(handover);
    await expect(reads.status(caller)).resolves.toMatchObject({ status: 'pending_payment' });
  });
});
