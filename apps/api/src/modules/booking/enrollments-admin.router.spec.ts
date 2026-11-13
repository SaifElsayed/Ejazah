// T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9; contracts/admin-surface.md,
// `enrollments.releaseSlot`) — the administrator surface's `enrollments.releaseSlot` as it is served,
// over a recorded service. The administrator kind (an anonymous caller and an unverified second
// factor refused, nothing reached or written); the release audited `enrollment.slot_released` on the
// enrollment with the reason; a keyed call's replay answering the first result with no second entry;
// the input schema refusing a blank or over-long reason, a malformed or missing key and an id that
// is not one; a refusal (`CONFLICT` `slot_not_held`, `NOT_FOUND`) writing no entry; and its own
// limit, `rate_limit_slot_release`, refusing a call over it before the transaction opens. What the
// service does is `slot-release.service.spec.ts`' and `tests/db-integrity/slot-hold.spec.ts`'.
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
import { enrollmentsAdminRouter } from './enrollments-admin.router.js';

const callerFor = createAdminCallerFactory(
  createAdminRouter({ enrollments: enrollmentsAdminRouter }),
);

const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000e01';
const KEY = 'release-attempt-0000001';
const REASON = 'الطالب لن يعود، والموعد مطلوب لغيره';

type ReleaseSlot = AdminSurfaceServices['enrollments']['releaseSlot'];
type Answer = Awaited<ReturnType<ReleaseSlot>>;

const RELEASED: Answer = {
  answer: { enrollmentId: ENROLLMENT, slotReleasedAt: '2026-11-13T09:00:00.000Z' },
  replayed: false,
};

function surface(answer: Answer | Error) {
  const reached: unknown[][] = [];
  const releaseSlot: ReleaseSlot = async (_tx, adminId, input) => {
    reached.push([adminId, input]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const contexts = adminContextsOver({ enrollments: { releaseSlot } });
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
  action: 'enrollment.slot_released',
  targetType: 'enrollment',
  targetId: ENROLLMENT,
  reason: REASON,
};

describe('the administrator kind', () => {
  it('enrollments.releaseSlot refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface(RELEASED);
    expect((await shapeOf(as(null).enrollments.releaseSlot(ASKED))).code).toBe('UNAUTHENTICATED');
    expect(
      (await shapeOf(as({ ...VERIFIED, mfaVerified: false }).enrollments.releaseSlot(ASKED))).code,
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('enrollments.releaseSlot (FR-503; SRS FR-CANCEL-9)', () => {
  it('releases with the actor and audits enrollment.slot_released on the enrollment with the reason', async () => {
    const { as, written, reached } = surface(RELEASED);
    expect(await as(VERIFIED).enrollments.releaseSlot(ASKED)).toEqual(RELEASED.answer);
    expect(reached).toEqual([[SPEC_ADMIN, ASKED]]);
    expect(written).toEqual([ENTRY]);
  });

  it('answers a replay the first result and records no second entry', async () => {
    const { as, written } = surface({ ...RELEASED, replayed: true });
    expect(await as(VERIFIED).enrollments.releaseSlot(ASKED)).toEqual(RELEASED.answer);
    expect(written).toEqual([]);
  });

  it.each([
    ['a blank reason', { reason: '   ' }],
    ['a reason of 1001 characters', { reason: 'ب'.repeat(1001) }],
    ['a malformed key', { idempotencyKey: 'short' }],
    ['no key', { idempotencyKey: undefined }],
    ['an enrollment id that is not one', { enrollmentId: 'enrollment-1' }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, change) => {
    const { as, written, reached } = surface(RELEASED);
    expect(
      (await shapeOf(as(VERIFIED).enrollments.releaseSlot({ ...ASKED, ...change } as typeof ASKED)))
        .code,
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('a refusal writes no audit entry', () => {
  it.each([
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'slot_not_held' }],
    }),
    new DomainError('NOT_FOUND'),
  ])('enrollments.releaseSlot answers the service’s $code and keeps no entry', async (error) => {
    const { as, written } = surface(error);
    const shape = await shapeOf(as(VERIFIED).enrollments.releaseSlot(ASKED));
    expect(shape.code).toBe(error.code);
    if (error.code === 'CONFLICT') {
      expect(shape.details).toEqual([{ path: 'cause', code: 'slot_not_held' }]);
    }
    expect(written).toEqual([]);
  });
});

describe('its own limit (FR-503; T062)', () => {
  it('refuses a call over rate_limit_slot_release RATE_LIMITED before the transaction opens', async () => {
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
    const releaseSlot: ReleaseSlot = async (_tx, adminId) => {
      reached.push(adminId);
      return RELEASED;
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
            name === 'enrollments' ? { releaseSlot } : Reflect.get(target, name, receiver),
        }),
        rateLimiter,
        clientAddress: '203.0.113.9',
      });
    await callerFor(context()).enrollments.releaseSlot(ASKED);
    expect((await shapeOf(callerFor(context()).enrollments.releaseSlot(ASKED))).code).toBe(
      'RATE_LIMITED',
    );
    expect(keysRead).toContain('rate_limit_slot_release');
    expect(transactions).toBe(1);
    expect(reached).toEqual([SPEC_ADMIN]);
    expect(written).toHaveLength(1);
  });
});
