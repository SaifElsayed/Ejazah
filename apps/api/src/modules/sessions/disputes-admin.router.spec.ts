// T034 of specs/004-sessions (FR-421, FR-474, FR-475, FR-476, FR-480; research R-308) — the
// administrator surface's `disputes` procedures as they are served (admin-surface.md, "`disputes`").
// `disputes.list` audited `disputes.listed` on the reader, `disputes.get` `dispute.viewed` on the
// dispute, `disputes.resolve` `dispute.resolved` on the dispute with its mandatory reason; each
// refused to an anonymous caller and an unverified second factor, reaching and writing nothing; a
// resolution's input refused when it lacks what its resolution names (`consumed`, `against`,
// `party`); a service's refusal rolling its audit entry back. What each does is
// `dispute-queue.service.spec.ts`', `dispute-resolution.service.spec.ts`' and
// `tests/db-integrity/dispute-resolution.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { disputesAdminRouter } from './disputes-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ disputes: disputesAdminRouter }));

const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const CLOSED = '0199d0a0-0000-7000-8000-0000000000d2';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const PAGE = {
  items: [
    {
      disputeId: DISPUTE,
      sessionId: SESSION,
      raisedBy: 'student' as const,
      raisedAt: '2026-11-09T09:00:00.000Z',
      outcomeUnderDispute: 'teacher_no_show' as const,
      teacherNoShows: 5,
      repeatedAbsence: true,
    },
  ],
};
const VIEWED = {
  dispute: {
    disputeId: DISPUTE,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    raisedBy: 'student' as const,
    reason: 'لم يحضر المعلم',
    status: 'open' as const,
    raisedAt: '2026-11-09T09:00:00.000Z',
    outcomeUnderDispute: 'teacher_no_show' as const,
  },
  telemetry: {
    sessionId: SESSION,
    schedule: {
      localDate: '2026-11-08',
      startTimeLocal: '08:00',
      timezone: 'Africa/Cairo',
      startsAt: '2026-11-08T06:00:00.000Z',
      endsAt: '2026-11-08T07:00:00.000Z',
    },
    status: 'disputed' as const,
    events: [],
    intervals: { student: [], teacher: [], together: [] },
    simultaneousSeconds: 0,
    joined: { student: false, teacher: false },
    outages: [],
  },
  chatAvailable: true,
};
const RESOLVE = { disputeId: DISPUTE, resolution: 'upheld' as const, reason: 'ثبت غياب المعلم' };

function surface() {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    disputes: {
      list: async (_tx, adminId, input) => {
        reached.push(['list', adminId, input]);
        return PAGE;
      },
      get: async (_tx, adminId, input) => {
        reached.push(['get', adminId, input]);
        if (input.disputeId !== DISPUTE) throw new DomainError('NOT_FOUND');
        return VIEWED;
      },
      resolve: async (_tx, adminId, input) => {
        reached.push(['resolve', adminId, input]);
        if (input.disputeId === CLOSED) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'not_open' }],
          });
        }
        return { disputeId: input.disputeId, sessionStatus: 'teacher_no_show' };
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

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('disputes.list and disputes.get (FR-475)', () => {
  it('list answers the page and audits disputes.listed on the reader', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).disputes.list({})).toEqual(PAGE);
    expect(reached).toEqual([['list', SPEC_ADMIN, {}]]);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'disputes.listed', targetType: 'admin', targetId: SPEC_ADMIN },
    ]);
  });

  it('get answers the dispute as the schema names it and audits dispute.viewed on the dispute', async () => {
    const { as, written } = surface();
    expect(await as(VERIFIED).disputes.get({ disputeId: DISPUTE })).toEqual(VIEWED);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'dispute.viewed', targetType: 'dispute', targetId: DISPUTE },
    ]);
  });

  it('get of no dispute is NOT_FOUND and audits nothing', async () => {
    const { as, written } = surface();
    expect(await codeOf(as(VERIFIED).disputes.get({ disputeId: CLOSED }))).toBe('NOT_FOUND');
    expect(written).toEqual([]);
  });
});

describe('disputes.resolve (FR-476, FR-480)', () => {
  it('resolves as the session’s administrator and audits dispute.resolved on the dispute with the reason', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).disputes.resolve(RESOLVE)).toEqual({
      disputeId: DISPUTE,
      sessionStatus: 'teacher_no_show',
    });
    expect(reached).toEqual([['resolve', SPEC_ADMIN, RESOLVE]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'dispute.resolved',
        targetType: 'dispute',
        targetId: DISPUTE,
        reason: RESOLVE.reason,
      },
    ]);
  });

  it('a refused resolution is CONFLICT and audits nothing', async () => {
    const { as, written } = surface();
    expect(await codeOf(as(VERIFIED).disputes.resolve({ ...RESOLVE, disputeId: CLOSED }))).toBe(
      'CONFLICT',
    );
    expect(written).toEqual([]);
  });

  it.each([
    ['a blank reason', { ...RESOLVE, reason: ' ' }],
    ['no reason', { ...RESOLVE, reason: undefined }],
    ['an unknown resolution', { ...RESOLVE, resolution: 'enrollment_ended' }],
    ['a re-marking without consumed', { ...RESOLVE, resolution: 're_marked' }],
    ['a no-show recorded against no one', { ...RESOLVE, resolution: 'no_show_recorded' }],
    ['a suspension of no party', { ...RESOLVE, resolution: 'party_suspended' }],
    ['a ban of no party', { ...RESOLVE, resolution: 'party_banned' }],
    ['a party that is neither', { ...RESOLVE, resolution: 'party_banned', party: 'admin' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, input) => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(VERIFIED).disputes.resolve(input as unknown as typeof RESOLVE))).toBe(
      'VALIDATION_FAILED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it.each([
    ['a re-marking', { ...RESOLVE, resolution: 're_marked', consumed: false }],
    ['a recorded no-show', { ...RESOLVE, resolution: 'no_show_recorded', against: 'student' }],
    ['a ban', { ...RESOLVE, resolution: 'party_banned', party: 'teacher' }],
  ])('admits %s naming what it needs', async (_name, input) => {
    const { as, reached } = surface();
    await as(VERIFIED).disputes.resolve(input as unknown as typeof RESOLVE);
    expect(reached).toEqual([['resolve', SPEC_ADMIN, input]]);
  });
});

describe('the administrator kind', () => {
  it('list, get and resolve refuse an anonymous caller and an unverified second factor, reaching and writing nothing', async () => {
    const { as, written, reached } = surface();
    const unverified = as({ ...VERIFIED, mfaVerified: false });
    expect(await codeOf(as(null).disputes.list({}))).toBe('UNAUTHENTICATED');
    expect(await codeOf(unverified.disputes.list({}))).toBe('MFA_REQUIRED');
    expect(await codeOf(as(null).disputes.get({ disputeId: DISPUTE }))).toBe('UNAUTHENTICATED');
    expect(await codeOf(unverified.disputes.get({ disputeId: DISPUTE }))).toBe('MFA_REQUIRED');
    expect(await codeOf(as(null).disputes.resolve(RESOLVE))).toBe('UNAUTHENTICATED');
    expect(await codeOf(unverified.disputes.resolve(RESOLVE))).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});
