// T061 of specs/004-sessions (FR-454, FR-470, FR-480; SC-416; contracts/admin-surface.md,
// `sessions.restore`) — the administrator surface's `sessions.restore` as it is served, over a
// recorded service. The administrator kind (an anonymous caller and an unverified second factor
// refused, nothing reached or written); the restore audited `enrollment.restored` on the enrollment
// with the reason; a keyed call's replay answering the first result with no second entry; the input
// schema refusing a blank or over-long reason, a malformed key and an id that is not one; a refusal
// writing no entry, one per error the service answers; its own limit,
// `rate_limit_enrollment_restore`, refusing a call over it before the transaction opens; and the
// kind's deadlock declaration: a deadlock retried once with one entry kept, a second answering
// `RESTORE_REFUSED` `time_taken` with nothing kept. What the service does is
// `restore.service.spec.ts`' and `tests/db-integrity/restore.spec.ts`'.
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
import { sessionsAdminRouter } from './sessions-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ sessions: sessionsAdminRouter }));

const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000e01';
const CASE = '0199d0a0-0000-7000-8000-000000000c01';
const SESSION = '0199d0a0-0000-7000-8000-000000000501';
const KEY = 'restore-attempt-00000001';
const REASON = 'إنهاء الاشتراك كان خطأ';

type Restore = AdminSurfaceServices['restore']['restore'];
type Answer = Awaited<ReturnType<Restore>>;

const RESTORED: Answer = {
  answer: {
    enrollmentId: ENROLLMENT,
    status: 'confirmed',
    sessionsCreated: [
      {
        sessionId: SESSION,
        sequenceNumber: 6,
        localDate: '2026-11-12',
        startTimeLocal: '09:00',
        timezone: 'Africa/Cairo',
        startsAt: '2026-11-12T07:00:00.000Z',
      },
    ],
    remediesOffered: 1,
    caseId: CASE,
  },
  replayed: false,
};

/** The adapter's deadlock refusal, as `db-errors.ts` reads it. */
const deadlock = () =>
  Object.assign(new Error('deadlock detected'), {
    name: 'DriverAdapterError',
    cause: { originalCode: '40P01', originalMessage: 'deadlock detected' },
  });

function surface(answers: readonly (Answer | Error)[]) {
  const reached: unknown[][] = [];
  const queue = [...answers];
  const restore: Restore = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('no answer');
    return next;
  };
  const contexts = adminContextsOver({ restore: { restore } });
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

const ASKED = { enrollmentId: ENROLLMENT, reason: REASON, idempotencyKey: KEY };

const ENTRY = {
  adminId: SPEC_ADMIN,
  action: 'enrollment.restored',
  targetType: 'enrollment',
  targetId: ENROLLMENT,
  reason: REASON,
};

describe('the administrator kind', () => {
  it('sessions.restore refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface([RESTORED]);
    expect((await shapeOf(as(null).sessions.restore(ASKED))).code).toBe('UNAUTHENTICATED');
    expect(
      (await shapeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.restore(ASKED))).code,
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.restore (FR-454, FR-455)', () => {
  it('restores with the actor and audits enrollment.restored on the enrollment with the reason', async () => {
    const { as, written, reached } = surface([RESTORED]);
    expect(await as(VERIFIED).sessions.restore(ASKED)).toEqual(RESTORED.answer);
    expect(reached).toEqual([[SPEC_ADMIN, ASKED]]);
    expect(written).toEqual([ENTRY]);
  });

  it('answers a replay the first result and records no second entry', async () => {
    const { as, written } = surface([{ ...RESTORED, replayed: true }]);
    expect(await as(VERIFIED).sessions.restore(ASKED)).toEqual(RESTORED.answer);
    expect(written).toEqual([]);
  });

  it.each([
    ['a blank reason', { reason: '   ' }],
    ['a reason of 1001 characters', { reason: 'ب'.repeat(1001) }],
    ['a malformed key', { idempotencyKey: 'short' }],
    ['no key', { idempotencyKey: undefined }],
    ['an enrollment id that is not one', { enrollmentId: 'enrollment-1' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, change) => {
    const { as, written, reached } = surface([RESTORED]);
    expect(
      (await shapeOf(as(VERIFIED).sessions.restore({ ...ASKED, ...change } as typeof ASKED))).code,
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('a refusal writes no audit entry', () => {
  it.each([
    new DomainError('RESTORE_REFUSED', undefined, {
      details: [{ path: 'cause', code: 'slot_taken' }],
    }),
    new DomainError('NOT_FOUND'),
    new DomainError('CONFLICT'),
  ])('sessions.restore answers the service’s $code and keeps no entry', async (error) => {
    const { as, written } = surface([error]);
    expect((await shapeOf(as(VERIFIED).sessions.restore(ASKED))).code).toBe(error.code);
    expect(written).toEqual([]);
  });
});

describe('the deadlock (L5; research R-321)', () => {
  it('retries a deadlock once, the restore kept with one audit entry', async () => {
    const { as, written, reached } = surface([deadlock(), RESTORED]);
    expect(await as(VERIFIED).sessions.restore(ASKED)).toEqual(RESTORED.answer);
    expect(reached).toHaveLength(2);
    expect(written).toEqual([ENTRY]);
  });

  it('answers a second deadlock RESTORE_REFUSED time_taken, nothing kept', async () => {
    const { as, written, reached } = surface([deadlock(), deadlock()]);
    expect(await shapeOf(as(VERIFIED).sessions.restore(ASKED))).toMatchObject({
      code: 'RESTORE_REFUSED',
      details: [{ path: 'cause', code: 'time_taken' }],
    });
    expect(reached).toHaveLength(2);
    expect(written).toEqual([]);
  });
});

describe('its own limit (FR-470; T062, R-321)', () => {
  it('refuses a call over rate_limit_enrollment_restore RATE_LIMITED before the transaction opens', async () => {
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
    const restore: Restore = async (_tx, adminId) => {
      reached.push(adminId);
      return RESTORED;
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
            name === 'restore' ? { restore } : Reflect.get(target, name, receiver),
        }),
        rateLimiter,
        clientAddress: '203.0.113.9',
      });
    await callerFor(context()).sessions.restore(ASKED);
    expect((await shapeOf(callerFor(context()).sessions.restore(ASKED))).code).toBe('RATE_LIMITED');
    expect(keysRead).toContain('rate_limit_enrollment_restore');
    expect(transactions).toBe(1);
    expect(reached).toEqual([SPEC_ADMIN]);
    expect(written).toHaveLength(1);
  });
});
