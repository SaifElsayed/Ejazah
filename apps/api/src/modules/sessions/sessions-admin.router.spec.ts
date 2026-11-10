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
