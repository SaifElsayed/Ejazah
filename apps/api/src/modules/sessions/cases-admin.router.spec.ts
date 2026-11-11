// T035 of specs/004-sessions (FR-422, FR-478, FR-480; contracts/admin-surface.md, "`cases`") — the
// administrator surface's `cases` procedures as they are served. Each is the administrator kind (an
// anonymous caller and an unverified second factor refused, nothing reached or written); the list is
// audited `cases.listed` on the reader, the detail `case.viewed` on the case, the closings
// `case.resolved` and `case.dismissed` on the case with the mandatory note as the reason; a refusal
// writes no audit entry, a refusal test per procedure; a blank note, a malformed cursor and an id
// that is not one are refused VALIDATION_FAILED before the service. What each does is
// `case-queue.service.spec.ts`', `case-closing.service.spec.ts`' and `tests/db-integrity/case-*.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { casesAdminRouter } from './cases-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ cases: casesAdminRouter }));

const CASE = '0199d0a0-0000-7000-8000-000000000500';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const PARTY = '0199d0a0-0000-7000-8000-000000000901';

const PAGE = {
  items: [
    {
      caseId: CASE,
      kind: 'compensation_case' as const,
      enrollmentId: ENROLLMENT,
      reason: 'student_suspended' as const,
      status: 'open' as const,
      openedAt: '2026-11-01T10:00:00.000Z',
      teacherNoShows: 0,
      repeatedAbsence: false,
    },
  ],
  nextCursor: `first:${CASE}`,
};
const DETAIL = {
  case: {
    caseId: CASE,
    kind: 'compensation_case' as const,
    enrollmentId: ENROLLMENT,
    reason: 'student_suspended' as const,
    status: 'open' as const,
    openedAt: '2026-11-01T10:00:00.000Z',
  },
  enrollment: {
    enrollmentId: ENROLLMENT,
    student: { userId: PARTY, displayName: 'طالب', deleted: false },
    teacher: { userId: PARTY, displayName: null, deleted: true },
    status: 'confirmed' as const,
    track: 'recitation' as const,
    teacherNoShows: 0,
    repeatedAbsence: false,
  },
  covers: [],
  paymentsLink: { enrollmentId: ENROLLMENT },
};

function surface(refuse?: DomainError) {
  const reached: unknown[][] = [];
  const answer = <T>(value: T): Promise<T> =>
    refuse === undefined ? Promise.resolve(value) : Promise.reject(refuse);
  const cases: AdminSurfaceServices['cases'] = {
    list: async (_tx, adminId, input) => {
      reached.push(['list', adminId, input]);
      return answer(PAGE);
    },
    get: async (_tx, adminId, input) => {
      reached.push(['get', adminId, input]);
      return answer(DETAIL);
    },
    resolve: async (_tx, adminId, input) => {
      reached.push(['resolve', adminId, input]);
      return answer({ caseId: input.caseId, status: 'resolved' as const });
    },
    dismiss: async (_tx, adminId, input) => {
      reached.push(['dismiss', adminId, input]);
      return answer({ caseId: input.caseId, status: 'dismissed' as const });
    },
    // T064's procedure has its own spec (`cases-open-manual.router.spec.ts`).
    openManual: () => Promise.reject(new Error('cases.openManual: not reached by this spec')),
    // T060's procedure has its own spec (`cases-decide-complaint.router.spec.ts`).
    decideComplaint: () =>
      Promise.reject(new Error('cases.decideComplaint: not reached by this spec')),
  };
  const contexts = adminContextsOver({ cases });
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

const CALLS = {
  list: (caller: ReturnType<ReturnType<typeof surface>['as']>) => caller.cases.list({}),
  get: (caller: ReturnType<ReturnType<typeof surface>['as']>) => caller.cases.get({ caseId: CASE }),
  resolve: (caller: ReturnType<ReturnType<typeof surface>['as']>) =>
    caller.cases.resolve({ caseId: CASE, note: 'أُعيد المبلغ' }),
  dismiss: (caller: ReturnType<ReturnType<typeof surface>['as']>) =>
    caller.cases.dismiss({ caseId: CASE, note: 'لا شيء مستحق' }),
} as const;

describe('the administrator kind', () => {
  it.each(Object.keys(CALLS) as (keyof typeof CALLS)[])(
    'cases.%s refuses an anonymous caller and an unverified second factor, writing nothing',
    async (name) => {
      const { as, written, reached } = surface();
      expect(await codeOf(CALLS[name](as(null)))).toBe('UNAUTHENTICATED');
      expect(await codeOf(CALLS[name](as({ ...VERIFIED, mfaVerified: false })))).toBe(
        'MFA_REQUIRED',
      );
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );
});

describe('cases.list (FR-478)', () => {
  it('lists a page with the actor and audits cases.listed on the reader', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).cases.list({ status: 'open', cursor: `rest:${CASE}` })).toEqual(PAGE);
    expect(reached).toEqual([['list', SPEC_ADMIN, { status: 'open', cursor: `rest:${CASE}` }]]);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'cases.listed', targetType: 'admin', targetId: SPEC_ADMIN },
    ]);
  });

  it.each([
    ['a malformed cursor', { cursor: CASE }],
    ['a cursor of no part', { cursor: `middle:${CASE}` }],
    ['an unknown status', { status: 'closed' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, input) => {
    const { as, written, reached } = surface();
    expect(
      await codeOf(as(VERIFIED).cases.list(input as unknown as { cursor?: string })),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('cases.get (FR-478; R-MONEY-6)', () => {
  it('answers the case and audits case.viewed on it', async () => {
    const { as, written } = surface();
    expect(await as(VERIFIED).cases.get({ caseId: CASE })).toEqual(DETAIL);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'case.viewed', targetType: 'dispute', targetId: CASE },
    ]);
  });
});

describe('cases.resolve and cases.dismiss (FR-422)', () => {
  it.each([
    ['resolve', 'case.resolved', 'resolved', 'أُعيد المبلغ'],
    ['dismiss', 'case.dismissed', 'dismissed', 'لا شيء مستحق'],
  ] as const)('%s closes the case and audits %s on it with the note', async (name, action, status, note) => {
    const { as, written, reached } = surface();
    expect(await CALLS[name](as(VERIFIED))).toEqual({ caseId: CASE, status });
    expect(reached).toEqual([[name, SPEC_ADMIN, { caseId: CASE, note }]]);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action, targetType: 'dispute', targetId: CASE, reason: note },
    ]);
  });

  it.each(['resolve', 'dismiss'] as const)(
    '%s refuses a blank note and a case id that is not one VALIDATION_FAILED, reaching nothing',
    async (name) => {
      const { as, written, reached } = surface();
      const caller = as(VERIFIED);
      expect(await codeOf(caller.cases[name]({ caseId: CASE, note: ' ' }))).toBe('VALIDATION_FAILED');
      expect(await codeOf(caller.cases[name]({ caseId: 'case-1', note: 'n' }))).toBe(
        'VALIDATION_FAILED',
      );
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );
});

describe('a refusal per procedure writes no audit entry', () => {
  it.each([
    ['list', new DomainError('RATE_LIMITED')],
    ['get', new DomainError('NOT_FOUND')],
    ['resolve', new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: 'not_open' }] })],
    ['dismiss', new DomainError('NOT_FOUND')],
  ] as const)('cases.%s answers the service’s %s and keeps no entry', async (name, error) => {
    const { as, written } = surface(error);
    expect(await codeOf(CALLS[name](as(VERIFIED)))).toBe(error.code);
    expect(written).toEqual([]);
  });
});
