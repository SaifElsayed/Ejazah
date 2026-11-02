// T032 — the `booking` namespace as the user surface serves it (app-surface.md "`booking` — the
// booking sheet"; R-205, R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-350).
//
// `booking.slots` is the student kind: an anonymous caller is UNAUTHENTICATED, a teacher FORBIDDEN, a
// suspended or banned student ACCOUNT_RESTRICTED, and none of them reaches the service. Every
// admitted call is counted under `rate_limit_search` by the caller's own id before the service is
// reached, and a call past the limit is RATE_LIMITED with nothing read. The service is handed the
// session's account and gender, in both directions, never anything the input says. The
// authorization gate (R-MOBILE-13, `pnpm check:authz`) reads these cases by path. What the service
// answers is booking-slots.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { bookingRouter } from './booking.router.js';
import type { BookingServices } from './index.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000000e1';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000000e2';
const SLOT = '0199d0a0-0000-7000-8000-0000000000e3';
const UNKNOWN = '0199d0a0-0000-7000-8000-0000000000e4';

const surfaceRouter = createAppRouter({ booking: bookingRouter });
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

let calls: unknown[][];
let limited: unknown[][];
let refuseAtLimit: boolean;

const booking: BookingServices = {
  slots: async (...args) => {
    calls.push(['slots', ...args]);
    if (args[1].packageId !== PACKAGE) throw new DomainError('NOT_FOUND');
    return {
      teacherTimezone: 'Africa/Cairo',
      slots: [
        {
          slotId: SLOT,
          dayOfWeek: 4,
          startTimeLocal: '09:00',
          durationMinutes: 60,
          firstSession: { localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00Z' },
          lastSession: { localDate: '2026-11-26', startsAt: '2026-11-26T07:00:00Z' },
        },
      ],
    };
  },
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
    booking,
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

describe("'booking.slots' (T032)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'booking.slots'", async () => {
    await expect(callerAs(null).booking.slots({ packageId: PACKAGE })).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a teacher FORBIDDEN before the service: 'booking.slots'", async () => {
    await expect(
      callerAs(sessionOf('teacher')).booking.slots({ packageId: PACKAGE }),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned student ACCOUNT_RESTRICTED before the service: 'booking.slots'", async () => {
    for (const who of ['suspended student', 'banned student'] as const) {
      await expect(
        callerAs(sessionOf(who)).booking.slots({ packageId: PACKAGE }),
        who,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(calls).toEqual([]);
  });

  it("counts every call under rate_limit_search by the caller's id, and refuses one past it RATE_LIMITED before the service: 'booking.slots'", async () => {
    const caller = callerAs(sessionOf('student'));
    await caller.booking.slots({ packageId: PACKAGE });
    expect(limited).toEqual([['rate_limit_search', CALLER]]);
    refuseAtLimit = true;
    calls = [];
    await expect(caller.booking.slots({ packageId: PACKAGE })).rejects.toEqual(
      refused('RATE_LIMITED'),
    );
    expect(calls).toEqual([]);
  });

  it("hands the service the session's account and gender, in both directions, whatever the input says", async () => {
    for (const gender of ['female', 'male'] as const) {
      const other = gender === 'female' ? 'male' : 'female';
      await callerAs(sessionOf('student', gender)).booking.slots({
        packageId: PACKAGE,
        gender: other,
        userId: UNKNOWN,
      } as never);
    }
    expect(calls).toEqual([
      ['slots', { userId: CALLER, gender: 'female' }, { packageId: PACKAGE }],
      ['slots', { userId: CALLER, gender: 'male' }, { packageId: PACKAGE }],
    ]);
  });

  it("answers the service's slots, parsed by the output schema", async () => {
    const answer = await callerAs(sessionOf('student')).booking.slots({ packageId: PACKAGE });
    expect(answer.teacherTimezone).toBe('Africa/Cairo');
    expect(answer.slots.map(({ slotId }) => slotId)).toEqual([SLOT]);
  });

  it('sends an excluded teacher’s or an unknown package NOT_FOUND with no field: the code and its message alone', async () => {
    const thrown: unknown = await callerAs(sessionOf('student'))
      .booking.slots({ packageId: UNKNOWN })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0])).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found.' },
      unexpected: false,
    });
  });

  it('refuses a package id that is not a UUID VALIDATION_FAILED before the service', async () => {
    const thrown: unknown = await callerAs(sessionOf('student'))
      .booking.slots({ packageId: 'not-an-id' })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });
});
