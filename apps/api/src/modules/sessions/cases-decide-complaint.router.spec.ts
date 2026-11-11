// T060 of specs/004-sessions (FR-453, FR-480; SC-415; contracts/admin-surface.md,
// `cases.decideComplaint`) — the administrator surface's `cases.decideComplaint` as it is served,
// over a recorded service. The administrator kind (an anonymous caller and an unverified second
// factor refused, nothing reached or written); each decision audited `complaint.decided` on the
// complaint (`dispute`) with the note as the reason and the decision in `after`; the input schema
// refusing an unknown decision, a blank or over-long note and an id that is not one before the
// service; a refusal writing no entry, one per error the service answers. What the service does is
// `complaint-decision.service.spec.ts`' and `tests/db-integrity/absence-complaint.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { casesAdminRouter } from './cases-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ cases: casesAdminRouter }));

const COMPLAINT = '0199d0a0-0000-7000-8000-000000000c01';
const NEW_CASE = '0199d0a0-0000-7000-8000-000000000c02';
const NOTE = 'ثبت الغياب من سجل الحضور';

type DecideComplaint = AdminSurfaceServices['cases']['decideComplaint'];
type Answer = Awaited<ReturnType<DecideComplaint>>;

const ENDED: Answer = {
  caseId: COMPLAINT,
  status: 'resolved',
  enrollmentStatus: 'terminated_no_show',
  newCaseId: NEW_CASE,
};

function surface(answer: Answer | DomainError) {
  const reached: unknown[][] = [];
  const decideComplaint: DecideComplaint = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    if (answer instanceof DomainError) throw answer;
    return answer;
  };
  const cases = { ...unusedAdminServices.cases, decideComplaint } as AdminSurfaceServices['cases'];
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

const ASKED = { caseId: COMPLAINT, decision: 'end_enrollment' as const, note: NOTE };

describe('the administrator kind', () => {
  it('cases.decideComplaint refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface(ENDED);
    expect(await codeOf(as(null).cases.decideComplaint(ASKED))).toBe('UNAUTHENTICATED');
    expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).cases.decideComplaint(ASKED))).toBe(
      'MFA_REQUIRED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('cases.decideComplaint (FR-453)', () => {
  it.each([
    ['end_enrollment', ENDED],
    [
      'suspend_teacher',
      { caseId: COMPLAINT, status: 'resolved', enrollmentStatus: 'cancelled' } as Answer,
    ],
    ['close', { caseId: COMPLAINT, status: 'dismissed', enrollmentStatus: 'confirmed' } as Answer],
  ] as const)('decides %s with the actor and audits complaint.decided on the complaint with the note and the decision', async (decision, answer) => {
    const { as, written, reached } = surface(answer);
    const asked = { ...ASKED, decision };
    expect(await as(VERIFIED).cases.decideComplaint(asked)).toEqual(answer);
    expect(reached).toEqual([[SPEC_ADMIN, asked]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'complaint.decided',
        targetType: 'dispute',
        targetId: COMPLAINT,
        reason: NOTE,
        after: { decision },
      },
    ]);
  });

  it.each([
    ['an unknown decision', { decision: 'refund' }],
    ['a blank note', { note: '   ' }],
    ['a note of 1001 characters', { note: 'ب'.repeat(1001) }],
    ['no note', { note: undefined }],
    ['a case id that is not one', { caseId: 'case-1' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, change) => {
    const { as, written, reached } = surface(ENDED);
    expect(
      await codeOf(as(VERIFIED).cases.decideComplaint({ ...ASKED, ...change } as typeof ASKED)),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('a refusal writes no audit entry', () => {
  it.each([new DomainError('NOT_FOUND'), new DomainError('CONFLICT')])(
    'cases.decideComplaint answers the service’s $code and keeps no entry',
    async (error) => {
      const { as, written } = surface(error);
      expect(await codeOf(as(VERIFIED).cases.decideComplaint(ASKED))).toBe(error.code);
      expect(written).toEqual([]);
    },
  );
});
