// T034 of specs/004-sessions (FR-421, FR-474, FR-475, FR-476, FR-480; research R-308) — the
// administrator surface's `disputes` procedures as they are served (admin-surface.md, "`disputes`").
// `disputes.list` audited `disputes.listed` on the reader, `disputes.get` `dispute.viewed` on the
// dispute, `disputes.resolve` `dispute.resolved` on the dispute with its mandatory reason, the
// resolution, the party a standing ruling reaches and the session's final status (PR #133's review,
// round 1, Minor 3); each refused to an anonymous caller and an unverified second factor, reaching
// and writing nothing; a resolution's input refused when it lacks what its resolution names
// (`consumed`, `against`, `party`); a service's refusal rolling its audit entry back. What each does is
// `dispute-queue.service.spec.ts`', `dispute-resolution.service.spec.ts`' and
// `tests/db-integrity/dispute-resolution.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import { createAdminContext } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
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
  revisable: false,
  revisions: [],
};
const RESOLVE = { disputeId: DISPUTE, resolution: 'upheld' as const, reason: 'ثبت غياب المعلم' };

function surface() {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    disputes: {
      // T059's `revise` has its own surface below.
      revise: async () => {
        throw new Error('revise is not reached here');
      },
      // T040's three reads have their own specs (`disputes-held-files.router.spec.ts`,
      // `disputes-chat.router.spec.ts`).
      heldFiles: async () => {
        throw new Error('heldFiles is not reached here');
      },
      heldFileLink: async () => {
        throw new Error('heldFileLink is not reached here');
      },
      chat: async () => {
        throw new Error('chat is not reached here');
      },
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
        after: { resolution: 'upheld', sessionStatus: 'teacher_no_show' },
      },
    ]);
  });

  it.each([
    ['party_suspended', 'student'],
    ['party_banned', 'teacher'],
  ] as const)('audits a %s ruling with the party it reaches', async (resolution, party) => {
    const { as, written } = surface();
    await as(VERIFIED).disputes.resolve({ ...RESOLVE, resolution, party });
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'dispute.resolved',
        targetType: 'dispute',
        targetId: DISPUTE,
        reason: RESOLVE.reason,
        after: { resolution, party, sessionStatus: 'teacher_no_show' },
      },
    ]);
  });

  it('names no party for a ruling that reaches none, whatever the input carries', async () => {
    const { as, written } = surface();
    await as(VERIFIED).disputes.resolve({ ...RESOLVE, party: 'teacher' });
    expect(written[0]?.after).toEqual({ resolution: 'upheld', sessionStatus: 'teacher_no_show' });
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

// T059: `disputes.revise`, keyed on the kind's transaction and counted under its own limit
// (`rate_limit_dispute_revision`), audited `dispute.revised` on its first run only, a replay recording no entry.
const REVISE = {
  disputeId: DISPUTE,
  outcome: 'done' as const,
  reason: 'أخطأ الحكم',
  idempotencyKey: 'spec-revise-key-0001',
};

function reviseSurface(replayed = false) {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    disputes: {
      revise: async (_tx: unknown, adminId: string, given: { readonly reason: string }) => {
        reached.push(['revise', adminId, given]);
        if (given.reason === 'refuse') {
          throw new DomainError('RULING_FINAL', undefined, {
            details: [{ path: 'cause', code: 'window_closed' }],
          });
        }
        return {
          outcome: {
            disputeId: DISPUTE,
            sessionStatus: 'done',
            previousStatus: 'teacher_no_show',
            notUndone: ['party_suspended'],
          },
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

describe('disputes.revise (T059)', () => {
  it('answers the first run’s result and audits dispute.revised on the dispute with the reason', async () => {
    const { as, written, reached } = reviseSurface();
    expect(await as(VERIFIED).disputes.revise(REVISE)).toEqual({
      disputeId: DISPUTE,
      sessionStatus: 'done',
      previousStatus: 'teacher_no_show',
      notUndone: ['party_suspended'],
    });
    expect(reached).toEqual([['revise', SPEC_ADMIN, REVISE]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'dispute.revised',
        targetType: 'dispute',
        targetId: DISPUTE,
        reason: REVISE.reason,
      },
    ]);
  });

  it('answers a replay from the key’s row and records no second entry, the kind admitting it', async () => {
    const { as, written } = reviseSurface(true);
    expect(await as(VERIFIED).disputes.revise(REVISE)).toEqual({
      disputeId: DISPUTE,
      sessionStatus: 'done',
      previousStatus: 'teacher_no_show',
      notUndone: ['party_suspended'],
    });
    expect(written).toEqual([]);
  });

  it('a refusal of the service audits nothing', async () => {
    const { as, written } = reviseSurface();
    expect(await codeOf(as(VERIFIED).disputes.revise({ ...REVISE, reason: 'refuse' }))).toBe(
      'RULING_FINAL',
    );
    expect(written).toEqual([]);
  });

  it.each([
    ['no key', { ...REVISE, idempotencyKey: undefined }],
    ['a short key', { ...REVISE, idempotencyKey: 'short' }],
    ['a blank reason', { ...REVISE, reason: ' ' }],
    ['an outcome under review', { ...REVISE, outcome: 'under_threshold' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, given) => {
    const { as, written, reached } = reviseSurface();
    expect(await codeOf(as(VERIFIED).disputes.revise(given as unknown as typeof REVISE))).toBe(
      'VALIDATION_FAILED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('refuses an anonymous caller and an unverified second factor, reaching and writing nothing', async () => {
    const { as, written, reached } = reviseSurface();
    expect(await codeOf(as(null).disputes.revise(REVISE))).toBe('UNAUTHENTICATED');
    expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).disputes.revise(REVISE))).toBe(
      'MFA_REQUIRED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('over rate_limit_dispute_revision is refused RATE_LIMITED, opening no transaction and writing nothing (FR-470)', async () => {
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
    expect(await codeOf(callerFor(context).disputes.revise(REVISE))).toBe('RATE_LIMITED');
    expect(counted).toEqual([
      [
        'rate_limit_dispute_revision',
        { kind: 'administrator', adminId: SPEC_ADMIN },
        'disputes.revise',
      ],
    ]);
    expect(opened).toBe(0);
  });
});
