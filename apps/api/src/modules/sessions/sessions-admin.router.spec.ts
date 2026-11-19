// T016 of specs/004-sessions (FR-445, FR-480; R-TIME-6; research R-307) — the administrator
// surface's `sessions.outages` procedures as they are served (admin-surface.md, "`sessions`"). Each
// is the administrator kind (an anonymous caller and an unverified second factor refused, nothing
// reached or written); the record takes local wall clocks and a zone, never an instant, and a
// mandatory reason, audited `provider_outage.recorded` on the window with the reason; the list is
// audited `provider_outages.listed` on the reader. What the record does is
// `outages.service.spec.ts`' and `tests/db-integrity/outages.spec.ts`'.
//
// T023 and T024 (FR-460, FR-479, FR-480; R-SEC-6): `sessions.cancel` audited `session.cancelled` on
// the session with its mandatory reason; `sessions.monitor.list` audited `sessions.monitor.listed` on
// the reader and counted under `rate_limit_search` before any transaction opens;
// `sessions.monitor.get` audited `sessions.monitor.viewed` on the enrollment, nothing when refused.
// What each does is `session-cancel.service.spec.ts`', `sessions-monitor.service.spec.ts`' and
// `tests/db-integrity/session-cancel.spec.ts`' and `sessions-monitor.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import { type AdminSurfaceServices, createAdminContext } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { sessionsAdminRouter } from './sessions-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ sessions: sessionsAdminRouter }));

const OUTAGE = '0199d0a0-0000-7000-8000-0000000000c1';
const RECORDED = {
  outageId: OUTAGE,
  startsAt: '2026-11-08T08:00:00.000Z',
  endsAt: '2026-11-08T09:30:00.000Z',
  reclassified: 2,
};
const PAGE = {
  items: [
    {
      outageId: OUTAGE,
      startsAt: '2026-11-08T08:00:00.000Z',
      endsAt: '2026-11-08T09:30:00.000Z',
      reason: 'انقطاع لدى المزود',
      recordedBy: { adminId: SPEC_ADMIN, displayName: 'Spec admin' },
    },
  ],
};
const INPUT = {
  start: { localDate: '2026-11-08', localTime: '10:00' },
  end: { localDate: '2026-11-08', localTime: '11:30' },
  timezone: 'Africa/Cairo',
  reason: 'انقطاع لدى المزود',
};

function surface() {
  const reached: unknown[][] = [];
  const outages: AdminSurfaceServices['outages'] = {
    record: async (_tx, adminId, input) => {
      reached.push(['record', adminId, input]);
      return RECORDED;
    },
    list: async (_tx, input) => {
      reached.push(['list', input]);
      return PAGE;
    },
  };
  const contexts = adminContextsOver({ outages });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('the administrator kind', () => {
  it('sessions.outages.record refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(null).sessions.outages.record(INPUT))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.outages.record(INPUT)),
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('sessions.outages.list refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(null).sessions.outages.list({}))).toBe('UNAUTHENTICATED');
    expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.outages.list({}))).toBe(
      'MFA_REQUIRED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.outages.record (FR-445, R-TIME-6)', () => {
  it('records the window with the actor and audits provider_outage.recorded on it with the reason', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).sessions.outages.record(INPUT)).toEqual(RECORDED);
    expect(reached).toEqual([['record', SPEC_ADMIN, INPUT]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'provider_outage.recorded',
        targetType: 'provider_outage',
        targetId: OUTAGE,
        reason: INPUT.reason,
      },
    ]);
  });

  it.each([
    ['a blank reason', { ...INPUT, reason: ' ' }],
    ['no reason', { ...INPUT, reason: undefined }],
    ['an instant in place of a wall clock', { ...INPUT, start: '2026-11-08T08:00:00Z' }],
    ['a time with seconds', { ...INPUT, end: { localDate: '2026-11-08', localTime: '11:30:00' } }],
    ['no zone', { ...INPUT, timezone: undefined }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, input) => {
    const { as, written, reached } = surface();
    expect(
      await codeOf(as(VERIFIED).sessions.outages.record(input as unknown as typeof INPUT)),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.outages.list', () => {
  it('lists a page and audits provider_outages.listed on the reader', async () => {
    const { as, written, reached } = surface();
    const answer = await as(VERIFIED).sessions.outages.list({ cursor: OUTAGE });
    expect(answer).toEqual(PAGE);
    expect(reached).toEqual([['list', { cursor: OUTAGE }]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'provider_outages.listed',
        targetType: 'admin',
        targetId: SPEC_ADMIN,
      },
    ]);
  });
});

// T023 and T024.
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const CASE = '0199d0a0-0000-7000-8000-0000000000c2';
const CANCEL = { sessionId: SESSION, reason: 'المعلم مريض' };
const MONITOR_PAGE = { items: [] };
const UNKNOWN_ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e2';
const party = (userId: string, displayName: string) => ({ userId, displayName, deleted: false });
const VIEWED = {
  enrollment: {
    enrollmentId: ENROLLMENT,
    student: party('0199d0a0-0000-7000-8000-0000000000b1', 'آمال'),
    teacher: party('0199d0a0-0000-7000-8000-0000000000b2', 'سارة'),
    status: 'confirmed' as const,
    track: 'recitation' as const,
    sessionCount: 8,
    completed: 1,
    remaining: 7,
    teacherNoShows: 0,
    repeatedAbsence: false,
    // T082 (rule d): the monitor's window days (Q-O1 (a)).
    enrollmentRestoreWindowDays: 14,
  },
  sessions: [],
  cases: [],
  cancellationRequests: [],
  events: [],
};

function monitorSurface() {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    sessionCancel: {
      cancel: async (_tx, adminId, input) => {
        reached.push(['cancel', adminId, input]);
        return { sessionId: input.sessionId, status: 'cancelled_by_admin', caseId: CASE };
      },
    },
    monitor: {
      list: async (_tx, adminId, input) => {
        reached.push(['list', adminId, input]);
        return MONITOR_PAGE;
      },
      get: async (_tx, adminId, input) => {
        reached.push(['get', adminId, input]);
        if (input.enrollmentId !== ENROLLMENT) throw new DomainError('NOT_FOUND');
        return VIEWED;
      },
    },
  });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

describe('sessions.cancel (T023, FR-460, FR-480)', () => {
  it('cancels as the session’s administrator and audits session.cancelled on the session with the reason', async () => {
    const { as, written, reached } = monitorSurface();
    expect(await as(VERIFIED).sessions.cancel(CANCEL)).toEqual({
      sessionId: SESSION,
      status: 'cancelled_by_admin',
      caseId: CASE,
    });
    expect(reached).toEqual([['cancel', SPEC_ADMIN, CANCEL]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'session.cancelled',
        targetType: 'session',
        targetId: SESSION,
        reason: CANCEL.reason,
      },
    ]);
  });

  it('refuses an anonymous caller, an unverified second factor and a blank or missing reason, reaching and writing nothing', async () => {
    const { as, written, reached } = monitorSurface();
    expect(await codeOf(as(null).sessions.cancel(CANCEL))).toBe('UNAUTHENTICATED');
    expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.cancel(CANCEL))).toBe(
      'MFA_REQUIRED',
    );
    expect(await codeOf(as(VERIFIED).sessions.cancel({ ...CANCEL, reason: ' ' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await codeOf(
        as(VERIFIED).sessions.cancel({ sessionId: SESSION } as unknown as typeof CANCEL),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.monitor (T024, FR-479, FR-480)', () => {
  it('list audits sessions.monitor.listed on the reader; get audits nothing when refused', async () => {
    const { as, written, reached } = monitorSurface();
    expect(await as(VERIFIED).sessions.monitor.list({ student: 'آمال' })).toEqual(MONITOR_PAGE);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'sessions.monitor.listed',
        targetType: 'admin',
        targetId: SPEC_ADMIN,
      },
    ]);
    expect(
      await codeOf(as(VERIFIED).sessions.monitor.get({ enrollmentId: UNKNOWN_ENROLLMENT })),
    ).toBe('NOT_FOUND');
    expect(written).toHaveLength(1);
    expect(reached.at(-1)).toEqual(['get', SPEC_ADMIN, { enrollmentId: UNKNOWN_ENROLLMENT }]);
  });

  it('get answers the enrollment as the schema names it and audits sessions.monitor.viewed on it', async () => {
    const { as, written, reached } = monitorSurface();
    expect(await as(VERIFIED).sessions.monitor.get({ enrollmentId: ENROLLMENT })).toEqual(VIEWED);
    expect(reached).toEqual([['get', SPEC_ADMIN, { enrollmentId: ENROLLMENT }]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'sessions.monitor.viewed',
        targetType: 'enrollment',
        targetId: ENROLLMENT,
      },
    ]);
  });

  it('monitor.list and monitor.get refuse an anonymous caller and an unverified second factor, reaching and writing nothing', async () => {
    const { as, written, reached } = monitorSurface();
    const unverified = as({ ...VERIFIED, mfaVerified: false });
    expect(await codeOf(as(null).sessions.monitor.list({}))).toBe('UNAUTHENTICATED');
    expect(await codeOf(unverified.sessions.monitor.list({}))).toBe('MFA_REQUIRED');
    expect(await codeOf(as(null).sessions.monitor.get({ enrollmentId: ENROLLMENT }))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await codeOf(unverified.sessions.monitor.get({ enrollmentId: ENROLLMENT }))).toBe(
      'MFA_REQUIRED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('list over rate_limit_search is refused RATE_LIMITED, opening no transaction and writing nothing (R-SEC-6, C2)', async () => {
    const counted: unknown[][] = [];
    let opened = 0;
    const rateLimiter = {
      check: async (key: string, subject: unknown, procedure: string) => {
        counted.push([key, subject, procedure]);
        throw new DomainError('RATE_LIMITED');
      },
    } as unknown as RateLimiter;
    const context = createAdminContext({
      session: VERIFIED,
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      administration: {
        transactions: {
          run: async () => {
            opened += 1;
            throw new Error('no transaction may open');
          },
        },
        auditWriter: { write: async () => undefined },
      },
      services: unusedAdminServices,
      rateLimiter,
      clientAddress: '203.0.113.9',
    });
    expect(await codeOf(callerFor(context).sessions.monitor.list({ teacher: 'سارة' }))).toBe(
      'RATE_LIMITED',
    );
    expect(counted).toEqual([
      ['rate_limit_search', { kind: 'administrator', adminId: SPEC_ADMIN }, 'sessions.monitor.list'],
    ]);
    expect(opened).toBe(0);
  });
});

// T033 (FR-446, FR-450, FR-477, FR-480; R-SESS-6): `sessions.review.list` audited
// `sessions.review.listed` on the reader, `sessions.review.get` `sessions.review.viewed` on the
// session, `sessions.review.resolve` `session.review_resolved` on the session with its mandatory
// reason; each refused to an anonymous caller and an unverified second factor, a service's refusal
// rolling its audit entry back. What each does is `review.service.spec.ts`' and
// `tests/db-integrity/session-review.spec.ts`'.
const REVIEW_PAGE = {
  items: [
    {
      sessionId: SESSION,
      enrollmentId: ENROLLMENT,
      status: 'under_threshold' as const,
      startsAt: '2026-11-01T06:00:00.000Z',
      endsAt: '2026-11-01T07:00:00.000Z',
      simultaneousSeconds: 900,
      parties: {
        student: party('0199d0a0-0000-7000-8000-0000000000b1', 'آمال'),
        teacher: {
          userId: '0199d0a0-0000-7000-8000-0000000000b2',
          displayName: null,
          deleted: true,
        },
      },
    },
  ],
};
const TELEMETRY = {
  sessionId: SESSION,
  schedule: {
    localDate: '2026-11-01',
    startTimeLocal: '08:00',
    timezone: 'Africa/Cairo',
    startsAt: '2026-11-01T06:00:00.000Z',
    endsAt: '2026-11-01T07:00:00.000Z',
  },
  status: 'under_threshold' as const,
  events: [
    {
      party: 'teacher' as const,
      type: 'joined' as const,
      occurredAt: '2026-11-01T06:00:05.000Z',
      connectionRef: 'PA_t1',
    },
    { party: 'room' as const, type: 'room_ended' as const, occurredAt: '2026-11-01T07:00:00.000Z' },
  ],
  intervals: {
    student: [],
    teacher: [{ startsAt: '2026-11-01T06:00:05.000Z', endsAt: '2026-11-01T07:00:00.000Z' }],
    together: [],
  },
  simultaneousSeconds: 0,
  joined: { student: false, teacher: true },
  outages: [],
};
const RESOLVE = {
  sessionId: SESSION,
  outcome: 'done' as const,
  reason: 'انقطع الاتصال عند الطالب',
};
const SCHEDULED = '0199d0a0-0000-7000-8000-000000000052';

function reviewSurface() {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    review: {
      // T059's `revise` has its own surface below.
      revise: async () => {
        throw new Error('revise is not reached here');
      },
      list: async (_tx, adminId, input) => {
        reached.push(['list', adminId, input]);
        return REVIEW_PAGE;
      },
      get: async (_tx, adminId, input) => {
        reached.push(['get', adminId, input]);
        if (input.sessionId === SCHEDULED) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'not_settled' }],
          });
        }
        return TELEMETRY;
      },
      resolve: async (_tx, adminId, input) => {
        reached.push(['resolve', adminId, input]);
        if (input.sessionId === SCHEDULED) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'not_under_review' }],
          });
        }
        return { sessionId: input.sessionId, status: input.outcome };
      },
    },
  });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

describe('sessions.review (T033, FR-477, FR-480)', () => {
  it('list answers the page and audits sessions.review.listed on the reader', async () => {
    const { as, written, reached } = reviewSurface();
    expect(await as(VERIFIED).sessions.review.list({ cursor: SESSION })).toEqual(REVIEW_PAGE);
    expect(reached).toEqual([['list', SPEC_ADMIN, { cursor: SESSION }]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'sessions.review.listed',
        targetType: 'admin',
        targetId: SPEC_ADMIN,
      },
    ]);
  });

  it('get answers the telemetry as the schema names it and audits sessions.review.viewed on the session', async () => {
    const { as, written } = reviewSurface();
    expect(await as(VERIFIED).sessions.review.get({ sessionId: SESSION })).toEqual(TELEMETRY);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'sessions.review.viewed',
        targetType: 'session',
        targetId: SESSION,
      },
    ]);
  });

  it('get of a scheduled session is CONFLICT and audits nothing', async () => {
    const { as, written } = reviewSurface();
    expect(await codeOf(as(VERIFIED).sessions.review.get({ sessionId: SCHEDULED }))).toBe(
      'CONFLICT',
    );
    expect(written).toEqual([]);
  });

  it('resolve writes the outcome as the session’s administrator and audits session.review_resolved on the session with the reason', async () => {
    const { as, written, reached } = reviewSurface();
    expect(await as(VERIFIED).sessions.review.resolve(RESOLVE)).toEqual({
      sessionId: SESSION,
      status: 'done',
    });
    expect(reached).toEqual([['resolve', SPEC_ADMIN, RESOLVE]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'session.review_resolved',
        targetType: 'session',
        targetId: SESSION,
        reason: RESOLVE.reason,
      },
    ]);
  });

  it('resolve of a session not under review is CONFLICT and audits nothing', async () => {
    const { as, written } = reviewSurface();
    expect(
      await codeOf(as(VERIFIED).sessions.review.resolve({ ...RESOLVE, sessionId: SCHEDULED })),
    ).toBe('CONFLICT');
    expect(written).toEqual([]);
  });

  it.each([
    ['a blank reason', { ...RESOLVE, reason: ' ' }],
    ['no reason', { ...RESOLVE, reason: undefined }],
    ['an outcome under review', { ...RESOLVE, outcome: 'under_threshold' }],
    ['a disputed outcome', { ...RESOLVE, outcome: 'disputed' }],
    ['no outcome', { ...RESOLVE, outcome: undefined }],
  ])('resolve refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, input) => {
    const { as, written, reached } = reviewSurface();
    expect(
      await codeOf(as(VERIFIED).sessions.review.resolve(input as unknown as typeof RESOLVE)),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('list, get and resolve refuse an anonymous caller and an unverified second factor, reaching and writing nothing', async () => {
    const { as, written, reached } = reviewSurface();
    const unverified = as({ ...VERIFIED, mfaVerified: false });
    expect(await codeOf(as(null).sessions.review.list({}))).toBe('UNAUTHENTICATED');
    expect(await codeOf(unverified.sessions.review.list({}))).toBe('MFA_REQUIRED');
    expect(await codeOf(as(null).sessions.review.get({ sessionId: SESSION }))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await codeOf(unverified.sessions.review.get({ sessionId: SESSION }))).toBe(
      'MFA_REQUIRED',
    );
    expect(await codeOf(as(null).sessions.review.resolve(RESOLVE))).toBe('UNAUTHENTICATED');
    expect(await codeOf(unverified.sessions.review.resolve(RESOLVE))).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

// T059: `sessions.review.revise`, keyed on the kind's transaction and counted under its own limit
// (`rate_limit_outcome_correction`), audited `session.outcome_corrected` on its first run only, a replay recording no entry.
const CORRECT = {
  sessionId: SESSION,
  outcome: 'both_no_show' as const,
  reason: 'لم يحضر أحد',
  idempotencyKey: 'spec-revise-key-0001',
};

function correctSurface(replayed = false) {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    review: {
      revise: async (_tx: unknown, adminId: string, given: { readonly reason: string }) => {
        reached.push(['revise', adminId, given]);
        if (given.reason === 'refuse') {
          throw new DomainError('RULING_FINAL', undefined, {
            details: [{ path: 'cause', code: 'remedy_offered' }],
          });
        }
        return {
          outcome: { sessionId: SESSION, sessionStatus: 'both_no_show', previousStatus: 'done' },
          replayed,
        };
      },
    } as never,
  });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

describe('sessions.review.revise (T059)', () => {
  it('answers the first run’s result and audits session.outcome_corrected on the session with the reason', async () => {
    const { as, written, reached } = correctSurface();
    expect(await as(VERIFIED).sessions.review.revise(CORRECT)).toEqual({
      sessionId: SESSION,
      sessionStatus: 'both_no_show',
      previousStatus: 'done',
    });
    expect(reached).toEqual([['revise', SPEC_ADMIN, CORRECT]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'session.outcome_corrected',
        targetType: 'session',
        targetId: SESSION,
        reason: CORRECT.reason,
      },
    ]);
  });

  it('answers a replay from the key’s row and records no second entry, the kind admitting it', async () => {
    const { as, written } = correctSurface(true);
    expect(await as(VERIFIED).sessions.review.revise(CORRECT)).toEqual({
      sessionId: SESSION,
      sessionStatus: 'both_no_show',
      previousStatus: 'done',
    });
    expect(written).toEqual([]);
  });

  it('a refusal of the service audits nothing', async () => {
    const { as, written } = correctSurface();
    expect(
      await codeOf(as(VERIFIED).sessions.review.revise({ ...CORRECT, reason: 'refuse' })),
    ).toBe('RULING_FINAL');
    expect(written).toEqual([]);
  });

  it.each([
    ['no key', { ...CORRECT, idempotencyKey: undefined }],
    ['a blank reason', { ...CORRECT, reason: ' ' }],
    ['a disputed outcome', { ...CORRECT, outcome: 'disputed' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, given) => {
    const { as, written, reached } = correctSurface();
    expect(
      await codeOf(as(VERIFIED).sessions.review.revise(given as unknown as typeof CORRECT)),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('refuses an anonymous caller and an unverified second factor, reaching and writing nothing', async () => {
    const { as, written, reached } = correctSurface();
    expect(await codeOf(as(null).sessions.review.revise(CORRECT))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.review.revise(CORRECT)),
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('over rate_limit_outcome_correction is refused RATE_LIMITED, opening no transaction and writing nothing (FR-470)', async () => {
    const counted: unknown[][] = [];
    let opened = 0;
    const rateLimiter = {
      check: async (key: string, subject: unknown, procedure: string) => {
        counted.push([key, subject, procedure]);
        throw new DomainError('RATE_LIMITED');
      },
    } as unknown as RateLimiter;
    const context = createAdminContext({
      session: VERIFIED,
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      administration: {
        transactions: {
          run: async () => {
            opened += 1;
            throw new Error('no transaction may open');
          },
        },
        auditWriter: { write: async () => undefined },
      },
      services: unusedAdminServices,
      rateLimiter,
      clientAddress: '203.0.113.9',
    });
    expect(await codeOf(callerFor(context).sessions.review.revise(CORRECT))).toBe('RATE_LIMITED');
    expect(counted).toEqual([
      [
        'rate_limit_outcome_correction',
        { kind: 'administrator', adminId: SPEC_ADMIN },
        'sessions.review.revise',
      ],
    ]);
    expect(opened).toBe(0);
  });
});

// T082's follow-up (PR #141's review, round 1, nit 3): `internalNote` is trimmed by the contract, so a
// note of blanks arrives as `''`; the audit entry keeps none for it, as for a note left out. The rest of
// `sessions.endEnrollment` is `sessions-end-enrollment.router.spec.ts`'.
function endSurface() {
  const contexts = adminContextsOver({
    enrollmentEnd: {
      endEnrollment: async () => ({
        answer: { enrollmentId: ENROLLMENT, caseId: CASE, slot: 'hold', cancelledSessions: 3 },
        replayed: false,
      }),
    },
  } as never);
  return {
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

describe('sessions.endEnrollment’s internal note (T082, nit 3)', () => {
  it('audits a note of blanks, trimmed to nothing, as none', async () => {
    const { as, written } = endSurface();
    await as(VERIFIED).sessions.endEnrollment({
      enrollmentId: ENROLLMENT,
      partyReason: 'تعذر استمرار الاشتراك',
      internalNote: '   ',
      idempotencyKey: 'spec-end-key-0001',
    });
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'enrollment.ended_by_admin',
        targetType: 'enrollment',
        targetId: ENROLLMENT,
        reason: 'تعذر استمرار الاشتراك',
        // 003:T112 (rule d): the end's cause, the schema's default.
        after: { status: 'cancelled', slot: 'hold', internalNote: null, cause: 'admin_ended' },
      },
    ]);
  });
});
