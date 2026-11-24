// T049 — the teacher's «طلابي» and «اليوم» as the user surface serves them (app-surface.md
// "`enrollments` and the teacher's lists"; FR-391, FR-392, FR-393, FR-395, M3).
//
// `teacher.students.list`, `teacher.students.get` and `teacher.today` are the teacher kind admitting
// an approved teacher (`admits: 'approved'`): an anonymous caller is UNAUTHENTICATED, a student and
// an applicant FORBIDDEN, a suspended or banned teacher ACCOUNT_RESTRICTED, and none of them reaches
// the service. The service is handed the session's own account, never anything the input says, so
// a teacher asks only for their own students; another teacher's enrollment is NOT_FOUND with no
// field. The output schema strips what R-HONEST-4 keeps from the teacher, a date of birth, a minor
// flag, documents, a dispute history, an id or a photo key, should a service ever return one. The
// authorization gate (R-MOBILE-13, `pnpm check:authz`) reads these cases by path.
//
// T007: `teacher.students.list` is counted under `rate_limit_search` by the teacher's own id and
// refused RATE_LIMITED past it before the service; a deleted student is answered deleted, with no
// name.
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
import type { BookingServices } from './index.js';
import { teacherStudentsRouter, teacherTodayProcedure } from './teacher-students.router.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000000f1';
const OWN = '0199d0a0-0000-7000-8000-0000000000f2';
const OTHERS = '0199d0a0-0000-7000-8000-0000000000f3';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000f4';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000f5';

const surfaceRouter = createAppRouter({
  teacher: createAppRouter({ students: teacherStudentsRouter, today: teacherTodayProcedure }),
});
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Who = 'student' | 'applicant' | 'approved' | 'suspended teacher' | 'banned teacher';

function sessionOf(who: Who): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000f9',
    gender: 'male' as const,
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

const session = {
  sessionId: '0199d0a0-0000-7000-8000-000000000d02',
  sequenceNumber: 2,
  localDate: '2026-11-12',
  startTimeLocal: '09:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-12T07:00:00.000Z',
  endsAt: '2026-11-12T08:00:00.000Z',
  status: 'scheduled' as const,
  pendingCancellation: false,
  disputed: false,
};

const summary = {
  subject: { id: SUBJECT, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
  track: 'ijazah_track' as const,
  sessionCount: 4,
  sessionDurationMinutes: 60 as const,
};

const item = {
  enrollmentId: OWN,
  student: {
    studentId: STUDENT,
    displayName: 'يوسف علي',
    displayNameOrNull: 'يوسف علي',
    deleted: false,
  },
  summary,
  status: 'confirmed' as const,
  next: session,
  upcoming: 3,
  completed: 1,
  remaining: 3,
  // 004:T074 (FR-506): additively, rule d.
  paused: false,
};

/** What R-HONEST-4 keeps from the teacher, as a careless service might add it. */
const leaked = {
  dateOfBirth: '2012-01-01',
  isMinor: true,
  documents: [{ id: STUDENT }],
  disputes: [{ kind: 'session_dispute' }],
  genderFlags: [{ status: 'pending' }],
  photoKey: 'photos/1',
  userId: STUDENT,
};

let calls: unknown[][];
/** Each `check` the rate limiter was asked, and whether it refuses (T007). */
let limited: unknown[][];
let refuseAtLimit: boolean;

const unreached = (name: string) => () => Promise.reject(new Error(`${name} is not reached here`));

const booking: BookingServices = {
  slots: unreached('booking.slots'),
  // 006:T007 (rule d): the programme's services, which no case here reaches.
  // 006:T008 (rule d): `programme.cancel` and `programme.request` too.
  programme: {
    offer: unreached('programme.offer'),
    cancel: unreached('programme.cancel'),
    request: unreached('programme.request'),
    // 006:T016 (rule d): `programme.autoRenewOff` too.
    autoRenewOff: unreached('programme.autoRenewOff'),
  },
  enrollments: unreached('enrollments.list'),
  enrollment: unreached('enrollments.get'),
  students: async (...args) => {
    calls.push(['students', ...args]);
    return {
      items: [{ ...item, ...leaked, student: { ...item.student, ...leaked } }],
    } as never;
  },
  student: async (...args) => {
    calls.push(['student', ...args]);
    if (args[1].enrollmentId !== OWN) throw new DomainError('NOT_FOUND');
    return {
      ...item,
      ...leaked,
      student: { ...item.student, ...leaked },
      sessions: [session],
      ijazahRequest: null,
    } as never;
  },
  today: async (...args) => {
    calls.push(['today', ...args]);
    return {
      localDate: '2026-11-12',
      timezone: 'Africa/Cairo',
      sessions: [
        { ...session, enrollmentId: OWN, student: { ...item.student, ...leaked }, summary },
      ],
    } as never;
  },
};

beforeEach(() => {
  calls = [];
  limited = [];
  refuseAtLimit = false;
});

function callerAs(who: UserSession | null, bookingServices: BookingServices = booking): Caller {
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    catalog: unusedCatalogServices,
    discovery: unusedDiscoveryServices,
    booking: bookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = {
    check: vi.fn(async (...args: unknown[]) => {
      limited.push(args);
      if (refuseAtLimit) throw new DomainError('RATE_LIMITED');
    }),
  } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session: who, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

/** The three procedures, each called as the phone calls it. */
function procedures(caller: Caller) {
  return {
    'teacher.students.list': () => caller.teacher.students.list({ tab: 'active' }),
    'teacher.students.get': () => caller.teacher.students.get({ enrollmentId: OWN }),
    'teacher.today': () => caller.teacher.today({}),
  };
}

describe("the teacher's lists' callers (T049)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'teacher.students.list', 'teacher.students.get', 'teacher.today'", async () => {
    for (const [path, call] of Object.entries(procedures(callerAs(null)))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a student FORBIDDEN before the service: 'teacher.students.list', 'teacher.students.get', 'teacher.today'", async () => {
    for (const [path, call] of Object.entries(procedures(callerAs(sessionOf('student'))))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses an applicant FORBIDDEN, since students follow approval: 'teacher.students.list', 'teacher.students.get', 'teacher.today'", async () => {
    for (const [path, call] of Object.entries(procedures(callerAs(sessionOf('applicant'))))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED before the service: 'teacher.students.list', 'teacher.students.get', 'teacher.today'", async () => {
    for (const who of ['suspended teacher', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(procedures(callerAs(sessionOf(who))))) {
        await expect(call(), `${who} ${path}`).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(calls).toEqual([]);
  });
});

describe("'teacher.students.list' and 'teacher.students.get' (T049)", () => {
  it("hands the service the session's own account and the tab, the name typed trimmed, whatever else the input says", async () => {
    await callerAs(sessionOf('approved')).teacher.students.list({
      tab: 'ended',
      query: '  يوس ',
      cursor: OWN,
      teacherUserId: OTHERS,
      userId: OTHERS,
    } as never);
    expect(calls).toEqual([['students', CALLER, { tab: 'ended', query: 'يوس', cursor: OWN }]]);
  });

  it('answers the student by display name alone: R-HONEST-4’s fields stripped', async () => {
    const answer = await callerAs(sessionOf('approved')).teacher.students.list({ tab: 'active' });
    expect(answer).toEqual({ items: [item] });
    const detail = await callerAs(sessionOf('approved')).teacher.students.get({
      enrollmentId: OWN,
    });
    expect(detail).toEqual({ ...item, sessions: [session], ijazahRequest: null });
  });

  it('sends another teacher’s enrollment NOT_FOUND with no field: the code and its message alone', async () => {
    const thrown: unknown = await callerAs(sessionOf('approved'))
      .teacher.students.get({ enrollmentId: OTHERS })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0])).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found.' },
      unexpected: false,
    });
    expect(calls).toEqual([['student', CALLER, { enrollmentId: OTHERS }]]);
  });

  // T091: the phone reads no enrollment without an id (`TeacherEnrollment`); the server refuses
  // one that is not an id all the same, before the service.
  it.each(['', 'not-an-enrollment'])(
    'refuses an enrollment id that is not one (%j) VALIDATION_FAILED before the service',
    async (enrollmentId) => {
      const thrown: unknown = await callerAs(sessionOf('approved'))
        .teacher.students.get({ enrollmentId })
        .catch((error: unknown) => error);
      expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'VALIDATION_FAILED',
      );
      expect(calls).toEqual([]);
    },
  );

  // T007 (contracts/app-surface.md, Phase 2's lists; R-SEC-6; C2): the teacher's name search
  // declares Phase 1's `rate_limit_search`, the teacher's own id as subject; `get` declares none.
  it("counts every call under rate_limit_search by the teacher's own id, and refuses one past it RATE_LIMITED before the service: 'teacher.students.list'", async () => {
    const caller = callerAs(sessionOf('approved'));
    await caller.teacher.students.list({ tab: 'active', query: 'يوس' });
    expect(limited).toEqual([
      ['rate_limit_search', { kind: 'user', userId: CALLER }, 'teacher.students.list'],
    ]);
    refuseAtLimit = true;
    calls = [];
    await expect(caller.teacher.students.list({ tab: 'active' })).rejects.toEqual(
      refused('RATE_LIMITED'),
    );
    expect(calls).toEqual([]);
  });

  it("counts no call of 'teacher.students.get' or 'teacher.today' under rate_limit_search", async () => {
    const caller = callerAs(sessionOf('approved'));
    await caller.teacher.students.get({ enrollmentId: OWN });
    await caller.teacher.today({});
    // Declaring none, both are counted by the signed-in default only (T062, FR-470).
    const teacher = { kind: 'user', userId: CALLER };
    expect(limited).toEqual([
      ['rate_limit_signed_in_default', teacher, 'teacher.students.get'],
      ['rate_limit_signed_in_default', teacher, 'teacher.today'],
    ]);
  });

  it('answers a deleted student deleted, with no name, the deprecated name empty (T007, FR-426)', async () => {
    const deleted = { studentId: STUDENT, displayName: '', displayNameOrNull: null, deleted: true };
    const answer = await callerAs(sessionOf('approved'), {
      ...booking,
      students: async () => ({ items: [{ ...item, student: { ...deleted, ...leaked } }] }) as never,
    }).teacher.students.list({ tab: 'active' });
    expect(answer.items.map(({ student }) => student)).toEqual([deleted]);
  });

  it('refuses a blank name VALIDATION_FAILED before the service', async () => {
    const thrown: unknown = await callerAs(sessionOf('approved'))
      .teacher.students.list({ tab: 'active', query: '   ' })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });
});

describe("'teacher.today' (T049)", () => {
  it("hands the service the session's own account and answers the day with R-HONEST-4’s fields stripped", async () => {
    const answer = await callerAs(sessionOf('approved')).teacher.today({});
    expect(calls).toEqual([['today', CALLER]]);
    expect(answer).toEqual({
      localDate: '2026-11-12',
      timezone: 'Africa/Cairo',
      sessions: [{ ...session, enrollmentId: OWN, student: item.student, summary }],
    });
  });

  it('takes nothing: an input naming another teacher is refused before the service', async () => {
    const thrown: unknown = await callerAs(sessionOf('approved'))
      .teacher.today({ teacherUserId: OTHERS } as never)
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(calls).toEqual([]);
  });
});
