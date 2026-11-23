// T049 — the `enrollments` namespace as the user surface serves it (app-surface.md "`enrollments`
// and the teacher's lists"; FR-390, FR-392, FR-393, FR-395, M3).
//
// `enrollments.list` and `enrollments.get` are the student kind: an anonymous caller is
// UNAUTHENTICATED, a teacher FORBIDDEN, a suspended or banned student ACCOUNT_RESTRICTED, and none of
// them reaches the service. The service is handed the session's own account, never anything the
// input says, so a student asks only for their own enrollments; another student's enrollment is
// NOT_FOUND with no field. What the service answers is parsed by the output schema, which strips
// any field it does not name. The authorization gate (R-MOBILE-13, `pnpm check:authz`) reads these
// cases by path. What the lists answer is enrollment-lists.service.spec.ts's and the database's.
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
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { enrollmentsRouter } from './enrollments.router.js';
import type { BookingServices } from './index.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000000e1';
const OWN = '0199d0a0-0000-7000-8000-0000000000e2';
const OTHERS = '0199d0a0-0000-7000-8000-0000000000e3';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000e4';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000e5';

const surfaceRouter = createAppRouter({ enrollments: enrollmentsRouter });
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

const item = {
  enrollmentId: OWN,
  teacher: {
    teacherId: TEACHER,
    displayName: 'أحمد سالم',
    displayNameOrNull: 'أحمد سالم',
    deleted: false,
  },
  summary: {
    subject: { id: SUBJECT, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
    track: 'recitation' as const,
    sessionCount: 4,
    sessionDurationMinutes: 60 as const,
  },
  status: 'confirmed' as const,
  next: {
    sessionId: '0199d0a0-0000-7000-8000-000000000d01',
    sequenceNumber: 1,
    localDate: '2026-11-12',
    startTimeLocal: '09:00',
    timezone: 'Africa/Cairo',
    startsAt: '2026-11-12T07:00:00.000Z',
    endsAt: '2026-11-12T08:00:00.000Z',
    status: 'scheduled' as const,
    pendingCancellation: false,
    disputed: false,
  },
  upcoming: 4,
  completed: 0,
  remaining: 4,
  // 004:T074 (FR-506): additively, rule d.
  paused: false,
};

let calls: unknown[][];
/** What `enrollments.get`'s service answers in a spec that sets it, else the own enrollment. */
let enrollmentAnswer: Awaited<ReturnType<BookingServices['enrollment']>> | undefined;

const unreached = (name: string) => () => Promise.reject(new Error(`${name} is not reached here`));

const booking: BookingServices = {
  slots: unreached('booking.slots'),
  // 006:T007 (rule d): the programme's services, which no case here reaches.
  programme: { offer: unreached('programme.offer') },
  enrollments: async (...args) => {
    calls.push(['enrollments', ...args]);
    // A field no schema names, as a careless service might add it: stripped (R-HONEST-4).
    return { items: [{ ...item, price_piasters: 100_000 }] } as never;
  },
  enrollment: async (...args) => {
    calls.push(['enrollment', ...args]);
    if (args[1].enrollmentId !== OWN) throw new DomainError('NOT_FOUND');
    return (
      enrollmentAnswer ?? {
        ...item,
        sessions: [item.next],
        complaintOpen: false,
        ijazahRequest: null,
      }
    );
  },
  students: unreached('teacher.students.list'),
  student: unreached('teacher.students.get'),
  today: unreached('teacher.today'),
};

beforeEach(() => {
  calls = [];
  enrollmentAnswer = undefined;
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
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const calls$ = {
  list: (caller: Caller) => caller.enrollments.list({ tab: 'active' }),
  get: (caller: Caller) => caller.enrollments.get({ enrollmentId: OWN }),
};

describe("'enrollments.list' (T049)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'enrollments.list'", async () => {
    await expect(calls$.list(callerAs(null))).rejects.toEqual(refused('UNAUTHENTICATED'));
    expect(calls).toEqual([]);
  });

  it("refuses a teacher FORBIDDEN before the service: 'enrollments.list'", async () => {
    await expect(calls$.list(callerAs(sessionOf('teacher')))).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned student ACCOUNT_RESTRICTED before the service: 'enrollments.list'", async () => {
    for (const who of ['suspended student', 'banned student'] as const) {
      await expect(calls$.list(callerAs(sessionOf(who))), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it("hands the service the session's own account, whatever the input says, in both directions", async () => {
    for (const gender of ['female', 'male'] as const) {
      await callerAs(sessionOf('student', gender)).enrollments.list({
        tab: 'ended',
        cursor: OWN,
        userId: OTHERS,
        studentUserId: OTHERS,
        gender: gender === 'female' ? 'male' : 'female',
      } as never);
    }
    expect(calls).toEqual([
      ['enrollments', CALLER, { tab: 'ended', cursor: OWN }],
      ['enrollments', CALLER, { tab: 'ended', cursor: OWN }],
    ]);
  });

  it('answers the items parsed by the output schema, which strips a field it does not name', async () => {
    const answer = await calls$.list(callerAs(sessionOf('student')));
    expect(answer).toEqual({ items: [item] });
  });

  it('refuses a tab it does not know VALIDATION_FAILED before the service', async () => {
    const thrown: unknown = await callerAs(sessionOf('student'))
      .enrollments.list({ tab: 'cancelled' } as never)
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });
});

describe("'enrollments.get' (T049)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'enrollments.get'", async () => {
    await expect(calls$.get(callerAs(null))).rejects.toEqual(refused('UNAUTHENTICATED'));
    expect(calls).toEqual([]);
  });

  it("refuses a teacher FORBIDDEN before the service: 'enrollments.get'", async () => {
    await expect(calls$.get(callerAs(sessionOf('teacher')))).rejects.toEqual(refused('FORBIDDEN'));
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned student ACCOUNT_RESTRICTED before the service: 'enrollments.get'", async () => {
    for (const who of ['suspended student', 'banned student'] as const) {
      await expect(calls$.get(callerAs(sessionOf(who))), who).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(calls).toEqual([]);
  });

  it('answers the student’s own enrollment with its sessions, asked as the session’s account', async () => {
    const answer = await calls$.get(callerAs(sessionOf('student')));
    expect(answer.sessions).toEqual([item.next]);
    expect(calls).toEqual([['enrollment', CALLER, { enrollmentId: OWN }]]);
  });

  it('answers a deleted teacher deleted, with no name, the deprecated name empty (T007, FR-426)', async () => {
    const deleted = { teacherId: TEACHER, displayName: '', displayNameOrNull: null, deleted: true };
    enrollmentAnswer = {
      ...item,
      teacher: deleted,
      sessions: [item.next],
      complaintOpen: false,
      ijazahRequest: null,
    };
    const answer = await calls$.get(callerAs(sessionOf('student')));
    expect(answer.teacher).toEqual(deleted);
  });

  it('sends another student’s enrollment NOT_FOUND with no field: the code and its message alone', async () => {
    const thrown: unknown = await callerAs(sessionOf('student'))
      .enrollments.get({ enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0])).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found.' },
      unexpected: false,
    });
  });

  it('refuses an enrollment id that is not a UUID VALIDATION_FAILED before the service', async () => {
    const thrown: unknown = await callerAs(sessionOf('student'))
      .enrollments.get({ enrollmentId: 'not-an-id' })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });
});
