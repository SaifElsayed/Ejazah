// 006:T008 of specs/006-programme (Q-7 (a); R-API-12; contracts/admin-surface.md
// `programmes.decide`) — the administrator surface's `programmes.decide` as it is served, over a
// recorded service. The administrator kind (an anonymous caller and an unverified second factor
// refused, nothing reached or written); the decision handed the session's administrator and the
// validated input on the kind's transaction, and audited `programme_request.approved`, `.declined` or
// `.extended` on the item's enrollment, with the note as written when one is given; a keyed call's
// replay answering the first result with no second entry; a refusal writing no entry. What the
// service does is `tests/db-integrity/programme-windows.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { programmesAdminRouter } from './programmes-admin.router.js';

const callerFor = createAdminCallerFactory(
  createAdminRouter({ programmes: programmesAdminRouter }),
);

const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000e81';
const REQUEST = '0199d0a0-0000-7000-8000-000000000e82';
const KEY = 'programme-decision-000001';
const NOTE = 'الحساب لم يُوثَّق بعد؛ مهلة أخرى';

type Decide = AdminSurfaceServices['programmes']['decide'];
type Answer = Awaited<ReturnType<Decide>>;

const decided = (status: 'approved' | 'declined' | 'extended', replayed = false): Answer => ({
  answer: { status },
  replayed,
  enrollmentId: ENROLLMENT,
});

/** 006:T017: a service no case of `programmes.decide` reaches. */
const notReached = async (): Promise<never> => {
  throw new Error('not reached');
};

function surface(answer: Answer | Error) {
  const reached: unknown[][] = [];
  const decide: Decide = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const contexts = adminContextsOver({ programmes: { decide, reopen: notReached } });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

async function shapeOf(call: Promise<unknown>) {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as {
    code: string;
    details?: unknown;
  };
}

const ASKED = { requestId: REQUEST, decision: 'approve' as const, idempotencyKey: KEY };

describe('the administrator kind', () => {
  it('programmes.decide refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface(decided('approved'));
    expect((await shapeOf(as(null).programmes.decide(ASKED))).code).toBe('UNAUTHENTICATED');
    expect(
      (await shapeOf(as({ ...VERIFIED, mfaVerified: false }).programmes.decide(ASKED))).code,
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('programmes.decide (006:T008, R-API-12)', () => {
  it.each([
    ['approve', 'approved'],
    ['decline', 'declined'],
    ['extend', 'extended'],
  ] as const)(
    '%s: hands the administrator and the input on, audits programme_request.%s on the enrollment',
    async (decision, status) => {
      const { as, written, reached } = surface(decided(status));
      const asked = { ...ASKED, decision };
      expect(await as(VERIFIED).programmes.decide(asked)).toEqual({ status });
      expect(reached).toEqual([[SPEC_ADMIN, asked]]);
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action: `programme_request.${status}`,
          targetType: 'enrollment',
          targetId: ENROLLMENT,
        },
      ]);
    },
  );

  it('records the note as written as the entry’s reason', async () => {
    const { as, written } = surface(decided('extended'));
    await as(VERIFIED).programmes.decide({ ...ASKED, decision: 'extend', note: NOTE });
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'programme_request.extended',
        targetType: 'enrollment',
        targetId: ENROLLMENT,
        reason: NOTE,
      },
    ]);
  });

  it('answers a replay the first result and records no second entry', async () => {
    const { as, written } = surface(decided('approved', true));
    expect(await as(VERIFIED).programmes.decide(ASKED)).toEqual({ status: 'approved' });
    expect(written).toEqual([]);
  });

  it.each([
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'decision_not_allowed' }],
    }),
    new DomainError('NOT_FOUND'),
  ])('programmes.decide answers the service’s $code and keeps no entry', async (error) => {
    const { as, written } = surface(error);
    expect((await shapeOf(as(VERIFIED).programmes.decide(ASKED))).code).toBe(error.code);
    expect(written).toEqual([]);
  });

  // 006:T008 (SRS DEC-112): the reason a `no_offer` decision records, 1 to 500 characters.
  it('refuses a blank or over-long reason VALIDATION_FAILED, reaching nothing', async () => {
    for (const reason of ['   ', 'ب'.repeat(501)]) {
      const { as, reached } = surface(decided('extended'));
      expect(
        (await shapeOf(as(VERIFIED).programmes.decide({ ...ASKED, decision: 'extend', reason })))
          .code,
      ).toBe('VALIDATION_FAILED');
      expect(reached).toEqual([]);
    }
  });

  it('hands the reason on with the input', async () => {
    const { as, reached } = surface(decided('extended'));
    const asked = { ...ASKED, decision: 'extend' as const, reason: 'أبلغ المعلم الدعم' };
    await as(VERIFIED).programmes.decide(asked);
    expect(reached).toEqual([[SPEC_ADMIN, asked]]);
  });

  it('refuses a request id that is not one VALIDATION_FAILED, reaching nothing', async () => {
    const { as, reached } = surface(decided('approved'));
    expect(
      (await shapeOf(as(VERIFIED).programmes.decide({ ...ASKED, requestId: 'request-1' }))).code,
    ).toBe('VALIDATION_FAILED');
    expect(reached).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T017 (FR-725, FR-727; R-513; admin-surface.md `programmes.reopen`): the reopen handed the
// session's administrator and the validated input on the kind's transaction, audited
// `programme.reopened` on the enrollment with the administrator's reason as written; a replay with
// no second entry; a refusal with none. What it does is `programme-requests.service.ts`' and
// `tests/db-integrity/programme-stop.spec.ts`'.
type Reopen = AdminSurfaceServices['programmes']['reopen'];
type Reopened = Awaited<ReturnType<Reopen>>;

const REOPEN_REASON = 'سدد الطالب المتأخرات خارج التطبيق';
const REOPEN = { enrollmentId: ENROLLMENT, reason: REOPEN_REASON, idempotencyKey: KEY };
const reopened = (replayed = false): Reopened => ({
  answer: { state: 'paused' },
  replayed,
  enrollmentId: ENROLLMENT,
});

function reopenSurface(answer: Reopened | Error) {
  const reached: unknown[][] = [];
  const reopen: Reopen = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const contexts = adminContextsOver({ programmes: { decide: notReached, reopen } });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

describe('programmes.reopen (006:T017, R-API-12)', () => {
  it('refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = reopenSurface(reopened());
    expect((await shapeOf(as(null).programmes.reopen(REOPEN))).code).toBe('UNAUTHENTICATED');
    expect(
      (await shapeOf(as({ ...VERIFIED, mfaVerified: false }).programmes.reopen(REOPEN))).code,
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('hands the administrator and the input on, audits programme.reopened on the enrollment with the reason', async () => {
    const { as, written, reached } = reopenSurface(reopened());
    expect(await as(VERIFIED).programmes.reopen(REOPEN)).toEqual({ state: 'paused' });
    expect(reached).toEqual([[SPEC_ADMIN, REOPEN]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'programme.reopened',
        targetType: 'enrollment',
        targetId: ENROLLMENT,
        reason: REOPEN_REASON,
      },
    ]);
  });

  it('answers a replay the first result and records no second entry', async () => {
    const { as, written } = reopenSurface(reopened(true));
    expect(await as(VERIFIED).programmes.reopen(REOPEN)).toEqual({ state: 'paused' });
    expect(written).toEqual([]);
  });

  it.each([
    new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: 'slot_taken' }] }),
    new DomainError('NOT_FOUND'),
  ])('answers the service’s $code and keeps no entry', async (error) => {
    const { as, written } = reopenSurface(error);
    expect((await shapeOf(as(VERIFIED).programmes.reopen(REOPEN))).code).toBe(error.code);
    expect(written).toEqual([]);
  });

  it('refuses a missing reason or an enrollment id that is not one VALIDATION_FAILED, reaching nothing', async () => {
    const { as, reached } = reopenSurface(reopened());
    expect((await shapeOf(as(VERIFIED).programmes.reopen({ ...REOPEN, reason: '' }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await shapeOf(as(VERIFIED).programmes.reopen({ ...REOPEN, enrollmentId: 'enrollment-1' })))
        .code,
    ).toBe('VALIDATION_FAILED');
    expect(reached).toEqual([]);
  });
});
