// T082 of specs/004-sessions (FR-513; SRS FR-CANCEL-10, DEC-68; contracts/admin-surface.md,
// `sessions.endEnrollment`) — the administrator surface's `sessions.endEnrollment` as it is served,
// over a recorded service. The administrator kind (an anonymous caller and an unverified second factor
// refused, nothing reached or written); the end audited `enrollment.ended_by_admin` on the enrollment
// with both texts and the slot's choice; a keyed call's replay answering the first result with no
// second entry; the input schema refusing a blank or over-long party reason, an over-long note, another
// slot choice, a malformed key and an id that is not one; a refusal writing no entry; and its own
// limit, `rate_limit_enrollment_end`, refusing a call over it before the transaction opens. What the
// service does is `enrollment-end.service.spec.ts`' and `tests/db-integrity/enrollment-end.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../platform/audit/audit-writer.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import { createAdminContext } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import type { EnrollmentEnd } from './enrollment-end.service.js';
import { sessionsAdminRouter } from './sessions-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ sessions: sessionsAdminRouter }));

const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000e01';
const CASE = '0199d0a0-0000-7000-8000-000000000c01';
const KEY = 'end-attempt-0000000001';
const PARTY_REASON = 'تعذر استمرار الاشتراك';
const INTERNAL_NOTE = 'ملاحظة داخلية';

type EndEnrollment = EnrollmentEnd['endEnrollment'];
type Answer = Awaited<ReturnType<EndEnrollment>>;

const ENDED: Answer = {
  answer: { enrollmentId: ENROLLMENT, caseId: CASE, slot: 'hold', cancelledSessions: 3 },
  replayed: false,
};

function surface(answer: Answer | Error) {
  const reached: unknown[][] = [];
  const endEnrollment: EndEnrollment = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  // The services member is the integration's line in `surfaces/context.ts` (T082's wiring).
  const contexts = adminContextsOver({ enrollmentEnd: { endEnrollment } } as never);
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

const ASKED = {
  enrollmentId: ENROLLMENT,
  partyReason: PARTY_REASON,
  internalNote: INTERNAL_NOTE,
  idempotencyKey: KEY,
};

const ENTRY = {
  adminId: SPEC_ADMIN,
  action: 'enrollment.ended_by_admin',
  targetType: 'enrollment',
  targetId: ENROLLMENT,
  reason: PARTY_REASON,
  // 003:T112 (the owner's Q-D (a)): the end's cause in its audit entry.
  after: { status: 'cancelled', slot: 'hold', internalNote: INTERNAL_NOTE, cause: 'admin_ended' },
};

describe('the administrator kind', () => {
  it('sessions.endEnrollment refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface(ENDED);
    expect((await shapeOf(as(null).sessions.endEnrollment(ASKED))).code).toBe('UNAUTHENTICATED');
    expect(
      (await shapeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.endEnrollment(ASKED))).code,
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.endEnrollment (FR-513)', () => {
  it('ends with the actor, the slot held by default, and audits enrollment.ended_by_admin with both texts and the slot', async () => {
    const { as, written, reached } = surface(ENDED);
    expect(await as(VERIFIED).sessions.endEnrollment(ASKED)).toEqual(ENDED.answer);
    // 003:T112 (rule d): the cause the schema defaults, today's end.
    expect(reached).toEqual([[SPEC_ADMIN, { ...ASKED, slot: 'hold', cause: 'admin_ended' }]]);
    expect(written).toEqual([ENTRY]);
  });

  it('audits the release chosen, and a note left out as none', async () => {
    const released: Answer = { ...ENDED, answer: { ...ENDED.answer, slot: 'release' } };
    const { as, written } = surface(released);
    const { internalNote: _note, ...noNote } = ASKED;
    await as(VERIFIED).sessions.endEnrollment({ ...noNote, slot: 'release' });
    expect(written).toEqual([
      // 003:T112 (rule d): the cause the schema defaults.
      {
        ...ENTRY,
        after: { status: 'cancelled', slot: 'release', internalNote: null, cause: 'admin_ended' },
      },
    ]);
  });

  // 003:T112, PR #151's review, round 1, Major 2 (a): an end on a complaint against the student always
  // releases the slot; the entry records the release made, not the hold the schema defaults.
  it('audits the release an end on a complaint against the student makes, the default hold not recorded', async () => {
    const released: Answer = { ...ENDED, answer: { ...ENDED.answer, slot: 'release' } };
    const { as, written, reached } = surface(released);
    await as(VERIFIED).sessions.endEnrollment({ ...ASKED, cause: 'student_complaint_ended' });
    expect(reached).toEqual([
      [SPEC_ADMIN, { ...ASKED, slot: 'hold', cause: 'student_complaint_ended' }],
    ]);
    expect(written).toEqual([
      {
        ...ENTRY,
        after: {
          status: 'cancelled',
          slot: 'release',
          internalNote: INTERNAL_NOTE,
          cause: 'student_complaint_ended',
        },
      },
    ]);
  });

  it('answers a replay the first result and records no second entry', async () => {
    const { as, written } = surface({ ...ENDED, replayed: true });
    expect(await as(VERIFIED).sessions.endEnrollment(ASKED)).toEqual(ENDED.answer);
    expect(written).toEqual([]);
  });

  it.each([
    ['a blank party reason', { partyReason: '   ' }],
    ['a party reason of 501 characters', { partyReason: 'ب'.repeat(501) }],
    ['an internal note of 501 characters', { internalNote: 'ب'.repeat(501) }],
    ['another slot choice', { slot: 'keep' }],
    ['a malformed key', { idempotencyKey: 'short' }],
    ['no key', { idempotencyKey: undefined }],
    ['an enrollment id that is not one', { enrollmentId: 'enrollment-1' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, change) => {
    const { as, written, reached } = surface(ENDED);
    expect(
      (await shapeOf(as(VERIFIED).sessions.endEnrollment({ ...ASKED, ...change } as typeof ASKED)))
        .code,
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('a refusal writes no audit entry', () => {
  it.each([
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'enrollment_not_confirmed' }],
    }),
    new DomainError('CONFLICT', undefined, {
      details: [
        { path: 'cause', code: 'complaint_open' },
        { path: 'caseId', code: CASE },
      ],
    }),
    new DomainError('NOT_FOUND'),
  ])('sessions.endEnrollment answers the service’s $code and keeps no entry', async (error) => {
    const { as, written } = surface(error);
    expect(await shapeOf(as(VERIFIED).sessions.endEnrollment(ASKED))).toMatchObject({
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    expect(written).toEqual([]);
  });
});

describe('its own limit (FR-513; SRS §3.14, DEC-68)', () => {
  it('refuses a call over rate_limit_enrollment_end RATE_LIMITED before the transaction opens', async () => {
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
    const endEnrollment: EndEnrollment = async (_tx, adminId) => {
      reached.push(adminId);
      return ENDED;
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
            name === 'enrollmentEnd' ? { endEnrollment } : Reflect.get(target, name, receiver),
        }),
        rateLimiter,
        clientAddress: '203.0.113.9',
      });
    await callerFor(context()).sessions.endEnrollment(ASKED);
    expect((await shapeOf(callerFor(context()).sessions.endEnrollment(ASKED))).code).toBe(
      'RATE_LIMITED',
    );
    expect(keysRead).toContain('rate_limit_enrollment_end');
    expect(transactions).toBe(1);
    expect(reached).toEqual([SPEC_ADMIN]);
    expect(written).toHaveLength(1);
  });
});
