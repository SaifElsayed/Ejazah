// T064 of specs/004-sessions (FR-471 (c), FR-493, FR-470, FR-480; contracts/admin-surface.md,
// `cases.openManual`) — the administrator surface's `cases.openManual` as it is served, over a
// recorded service. The administrator kind (an anonymous caller and an unverified second factor
// refused, nothing reached or written); the case opened or joined audited `case.opened_manually` on
// the case (`dispute`) with the reason, and the party, `joined` and the remedy handed in `after`; a
// keyed call's replay answers the first result with no second entry (`AuditTrail.replayed()`); the
// input schema refusing, before the service, a `remedyId` with `party: 'teacher'`, a blank or
// over-long reason, a malformed key and an id that is not one; a refusal writing no entry, one per
// error the service answers; its own limit, `rate_limit_manual_compensation_case`, the administrator
// as subject, refusing a call over it before the transaction opens. What the service does is
// `manual-case.service.spec.ts`' and `tests/db-integrity/manual-case.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../platform/audit/audit-writer.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import { type AdminSurfaceServices, createAdminContext } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { casesAdminRouter } from './cases-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ cases: casesAdminRouter }));

const CASE = '0199d0a0-0000-7000-8000-000000000500';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const REMEDY = '0199d0a0-0000-7000-8000-000000000700';
const SESSION = '0199d0a0-0000-7000-8000-000000000600';
const KEY = 'manual-case-attempt-0001';
const REASON = 'شكوى الطالب عبر الهاتف';

type OpenManual = AdminSurfaceServices['cases']['openManual'];
type Answer = Awaited<ReturnType<OpenManual>>;

const OPENED: Answer = {
  answer: {
    caseId: CASE,
    enrollmentId: ENROLLMENT,
    party: 'teacher',
    status: 'open',
    joined: false,
  },
  replayed: false,
};
const HANDED: Answer = {
  answer: {
    caseId: CASE,
    enrollmentId: ENROLLMENT,
    party: 'student',
    status: 'open',
    joined: true,
    handedRemedy: { remedyId: REMEDY, sessionId: SESSION },
  },
  replayed: false,
};

function surface(answer: Answer | DomainError) {
  const reached: unknown[][] = [];
  const openManual: OpenManual = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    if (answer instanceof DomainError) throw answer;
    return answer;
  };
  const cases = { ...unusedAdminServices.cases, openManual } as AdminSurfaceServices['cases'];
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

const ASKED = {
  enrollmentId: ENROLLMENT,
  party: 'teacher' as const,
  reason: REASON,
  idempotencyKey: KEY,
};

describe('the administrator kind', () => {
  it('cases.openManual refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface(OPENED);
    expect(await codeOf(as(null).cases.openManual(ASKED))).toBe('UNAUTHENTICATED');
    expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).cases.openManual(ASKED))).toBe(
      'MFA_REQUIRED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('cases.openManual (FR-493, R-326)', () => {
  it('opens the case with the actor and audits case.opened_manually on it', async () => {
    const { as, written, reached } = surface(OPENED);
    expect(await as(VERIFIED).cases.openManual(ASKED)).toEqual(OPENED.answer);
    expect(reached).toEqual([[SPEC_ADMIN, ASKED]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'case.opened_manually',
        targetType: 'dispute',
        targetId: CASE,
        reason: REASON,
        after: { party: 'teacher', joined: false, handedRemedy: null },
      },
    ]);
  });

  it('audits the remedy handed and the join', async () => {
    const { as, written } = surface(HANDED);
    const asked = { ...ASKED, party: 'student' as const, remedyId: REMEDY };
    expect(await as(VERIFIED).cases.openManual(asked)).toEqual(HANDED.answer);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'case.opened_manually',
        targetType: 'dispute',
        targetId: CASE,
        reason: REASON,
        after: {
          party: 'student',
          joined: true,
          handedRemedy: { remedyId: REMEDY, sessionId: SESSION },
        },
      },
    ]);
  });

  it('answers a replay the first result and records no second entry', async () => {
    const { as, written } = surface({ ...OPENED, replayed: true });
    expect(await as(VERIFIED).cases.openManual(ASKED)).toEqual(OPENED.answer);
    expect(written).toEqual([]);
  });

  it.each([
    ['a remedyId with party teacher (a remedy is owed to the student)', { remedyId: REMEDY }],
    ['a blank reason', { reason: '   ' }],
    ['a reason of 501 characters', { reason: 'ب'.repeat(501) }],
    ['a malformed key', { idempotencyKey: 'short' }],
    ['an enrollment id that is not one', { enrollmentId: 'enrollment-1' }],
    ['a remedy id that is not one', { party: 'student', remedyId: 'remedy-1' }],
    ['an unknown party', { party: 'admin' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, change) => {
    const { as, written, reached } = surface(OPENED);
    expect(
      await codeOf(as(VERIFIED).cases.openManual({ ...ASKED, ...change } as typeof ASKED)),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('admits a reason of 500 characters and a remedyId with party student', async () => {
    const { as, reached } = surface(HANDED);
    const asked = {
      ...ASKED,
      party: 'student' as const,
      remedyId: REMEDY,
      reason: 'ب'.repeat(500),
    };
    await as(VERIFIED).cases.openManual(asked);
    expect(reached).toEqual([[SPEC_ADMIN, asked]]);
  });
});

describe('a refusal writes no audit entry', () => {
  it.each([
    new DomainError('NOT_FOUND'),
    new DomainError('REMEDY_NOT_OPEN'),
    new DomainError('CONFLICT'),
  ])('cases.openManual answers the service’s $code and keeps no entry', async (error) => {
    const { as, written } = surface(error);
    expect(await codeOf(as(VERIFIED).cases.openManual(ASKED))).toBe(error.code);
    expect(written).toEqual([]);
  });
});

describe('its own limit (FR-470; T062, R-321)', () => {
  it('refuses a call over rate_limit_manual_compensation_case RATE_LIMITED before the transaction opens', async () => {
    const keysRead: string[] = [];
    const counts = new Map<string, number>();
    const rateLimiter = new RateLimiter({
      settings: {
        read: async (key, schema) => {
          keysRead.push(key);
          return schema.parse({ limit: 1, window_seconds: 60 });
        },
      },
      counter: {
        hit: async (key) => {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return count;
        },
      },
      subjectKey: Buffer.alloc(32, 3),
    });
    let transactions = 0;
    const written: AuditRecord[] = [];
    const reached: unknown[] = [];
    const openManual: OpenManual = async (_tx, adminId) => {
      reached.push(adminId);
      return OPENED;
    };
    const context = () =>
      createAdminContext({
        session: VERIFIED,
        log: createLogger({ level: 'info', destination: { write: () => undefined } }),
        administration: {
          transactions: {
            run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
              transactions += 1;
              return work({} as Transaction);
            },
          },
          auditWriter: { write: async (_tx, record) => void written.push(record) },
        },
        services: new Proxy(unusedAdminServices, {
          get: (target, name, receiver) =>
            name === 'cases'
              ? { ...unusedAdminServices.cases, openManual }
              : Reflect.get(target, name, receiver),
        }),
        rateLimiter,
        clientAddress: '203.0.113.9',
      });
    await callerFor(context()).cases.openManual(ASKED);
    expect(await codeOf(callerFor(context()).cases.openManual(ASKED))).toBe('RATE_LIMITED');
    expect(keysRead).toContain('rate_limit_manual_compensation_case');
    expect(transactions).toBe(1);
    expect(reached).toEqual([SPEC_ADMIN]);
    expect(written).toHaveLength(1);
  });
});
