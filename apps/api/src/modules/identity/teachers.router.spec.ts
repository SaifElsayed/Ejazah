// T068 — the administrator surface's `teachers` namespace as it is served (admin-surface.md
// "`teachers`"; FR-165). Every procedure is the administrator kind (refusals, one transaction, the
// entry with the session's actor, nothing of a refused call); each action is audited on the person
// with its mandatory reason, the standing it moved from as `before` (T116) and the one it moved to
// as `after`, both as the standing answers them. What the standing does is
// `standing.service.spec.ts`'s.
import { describe, expect, it } from 'vitest';

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
import { studentsRouter } from './students.router.js';
import { teachersRouter } from './teachers.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ teachers: teachersRouter }));

const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';

/** What the standing answers it moved; a reinstatement under an identity request (T113). */
const MOVES = {
  suspend: {
    before: { accountStatus: 'verification_required' },
    after: { accountStatus: 'suspended' },
  },
  revokeApproval: {
    before: { verificationStatus: 'approved' },
    after: { verificationStatus: 'revoked' },
  },
  ban: { before: { accountStatus: 'suspended' }, after: { accountStatus: 'banned' } },
  reinstate: {
    before: { accountStatus: 'suspended' },
    after: { accountStatus: 'verification_required' },
  },
} as const;

function surface() {
  const reached: unknown[][] = [];
  const record =
    <T>(name: string, move: T) =>
    async (...args: unknown[]): Promise<T> => {
      reached.push([name, ...args.slice(1)]);
      return move;
    };
  const teachers: AdminSurfaceServices['teachers'] = {
    suspend: record('suspend', MOVES.suspend),
    revokeApproval: record('revokeApproval', MOVES.revokeApproval),
    ban: record('ban', MOVES.ban),
    reinstate: record('reinstate', MOVES.reinstate),
    // T072: the lifts have their own router spec.
    keyedLift: async () => {
      throw new Error('unused');
    },
    // T077: the kept data has its own cases (`teachers.keptData.*`), not this spec's.
    keptData: {
      documentLink: async () => {
        throw new Error('unused');
      },
      setEraseDate: async () => {
        throw new Error('unused');
      },
      eraseNow: async () => {
        throw new Error('unused');
      },
    },
  };
  const contexts = adminContextsOver({ teachers });
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

const ACTIONS = [
  ['teachers.suspend', 'suspend', 'teacher.suspend', MOVES.suspend],
  ['teachers.revokeApproval', 'revokeApproval', 'teacher.revoke', MOVES.revokeApproval],
  ['teachers.ban', 'ban', 'teacher.ban', MOVES.ban],
  ['teachers.reinstate', 'reinstate', 'teacher.reinstate', MOVES.reinstate],
] as const;

describe('the administrator kind', () => {
  it.each(ACTIONS)(
    '%s refuses an anonymous caller and an unverified second factor, writing nothing',
    async (_path, procedure) => {
      const { as, written, reached } = surface();
      const input = { teacherUserId: TEACHER, reason: 'سبب' };
      expect(await codeOf(as(null).teachers[procedure](input))).toBe('UNAUTHENTICATED');
      expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).teachers[procedure](input))).toBe(
        'MFA_REQUIRED',
      );
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );
});

describe('the audit entries', () => {
  it.each(ACTIONS)(
    '%s audits %s on the person with the reason, the standing before and after (T116)',
    async (_path, procedure, action, { before, after }) => {
      const { as, written, reached } = surface();
      await as(VERIFIED).teachers[procedure]({ teacherUserId: TEACHER, reason: 'شكوى موثّقة' });
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action,
          targetType: 'user',
          targetId: TEACHER,
          reason: 'شكوى موثّقة',
          before,
          after,
        },
      ]);
      expect(reached[0]?.slice(0, 3)).toEqual([procedure, SPEC_ADMIN, TEACHER]);
    },
  );

  it('revokeApproval hands the reason to the standing, as the note the teacher reads', async () => {
    const { as, reached } = surface();
    await as(VERIFIED).teachers.revokeApproval({ teacherUserId: TEACHER, reason: 'شكوى موثّقة' });
    expect(reached).toEqual([['revokeApproval', SPEC_ADMIN, TEACHER, 'شكوى موثّقة']]);
  });

  it.each(ACTIONS)(
    '%s needs a reason: a blank one is VALIDATION_FAILED',
    async (_path, procedure) => {
      const { as, written, reached } = surface();
      expect(
        await codeOf(as(VERIFIED).teachers[procedure]({ teacherUserId: TEACHER, reason: ' ' })),
      ).toBe('VALIDATION_FAILED');
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );
});

// T072 of specs/004-sessions (FR-502; SRS FR-ADMIN-5 as amended; admin-surface.md,
// `students.liftBan`, `teachers.liftBan`, `teachers.liftRevocation`): the three lifts as they are
// served, over a recorded standing (the students' router mounted beside this one). Each keyed
// through the standing's `keyedLift` with its scope, the actor and the input; audited
// `student.ban_lifted`, `teacher.ban_lifted` or `teacher.revocation_lifted` on the person with the
// reason, the standing before and after and each enrollment's result; a replay answering the first
// result with no second entry; a refusal writing no entry; the key required; `rate_limit_ban_lift`
// refusing a call over it before the transaction opens; and the kind's deadlock declaration, a second
// deadlock answering `CONFLICT` `restore_failed`. What a lift does is `standing.service.spec.ts`',
// `ban-lift.service.spec.ts`' and `tests/db-integrity/ban-lift.spec.ts`'.
describe('T072: the lifts', () => {
  const liftsCallerFor = createAdminCallerFactory(
    createAdminRouter({ students: studentsRouter, teachers: teachersRouter }),
  );
  const KEY = 'lift-attempt-0000000001';
  const LIFT_REASON = 'ثبت أن الحظر كان خطأ';
  const ENROLLMENTS = [
    { enrollmentId: '0199d0a0-0000-7000-8000-0000000000e1', restored: true },
    {
      enrollmentId: '0199d0a0-0000-7000-8000-0000000000e2',
      restored: false,
      cause: 'slot_taken',
    },
  ];
  const LIFTS = [
    [
      'students.liftBan',
      'students',
      'liftBan',
      'studentUserId',
      'student.ban_lifted',
      { before: { accountStatus: 'banned' }, after: { accountStatus: 'active' } },
    ],
    [
      'teachers.liftBan',
      'teachers',
      'liftBan',
      'teacherUserId',
      'teacher.ban_lifted',
      {
        before: {
          accountStatus: 'banned',
          verificationStatus: 'banned',
          applicationStatus: 'approved',
        },
        after: {
          accountStatus: 'active',
          verificationStatus: 'approved',
          applicationStatus: 'approved',
        },
      },
    ],
    [
      'teachers.liftRevocation',
      'teachers',
      'liftRevocation',
      'teacherUserId',
      'teacher.revocation_lifted',
      {
        before: { verificationStatus: 'revoked', applicationStatus: 'rejected' },
        after: { verificationStatus: 'approved', applicationStatus: 'approved' },
      },
    ],
  ] as const;

  type Lifted = { move: unknown; replayed: boolean };

  function liftSurface(answer: (attempt: number) => Lifted | Error) {
    const reached: unknown[][] = [];
    const keyedLift = async (_tx: unknown, adminId: string, request: unknown) => {
      reached.push([adminId, request]);
      const outcome = answer(reached.length);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    };
    const contexts = adminContextsOver({
      students: { keyedLift } as never,
      teachers: { keyedLift } as never,
    });
    return {
      reached,
      written: contexts.written,
      as: (session: Parameters<typeof contexts.contextFor>[0]) =>
        liftsCallerFor(contexts.contextFor(session)),
    };
  }

  // A recorded call through the surface's two routers, by namespace and procedure.
  const call = (
    caller: ReturnType<typeof liftsCallerFor>,
    namespace: 'students' | 'teachers',
    procedure: 'liftBan' | 'liftRevocation',
    input: Record<string, unknown>,
  ): Promise<unknown> =>
    (caller as unknown as Record<string, Record<string, (input: unknown) => Promise<unknown>>>)[
      namespace
    ]![procedure]!(input);

  async function liftShapeOf(attempt: Promise<unknown>) {
    const thrown: unknown = await attempt.then(
      () => undefined,
      (error: unknown) => error,
    );
    if (thrown === undefined) throw new Error('expected a refusal');
    return toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as {
      code: string;
      details?: unknown;
    };
  }

  it.each(LIFTS)(
    '%s is keyed through the standing with its scope and the actor, audited on the person with the reason, the standing and each enrollment’s result',
    async (scope, namespace, procedure, field, action, move) => {
      const { as, written, reached } = liftSurface(() => ({
        move: { ...move, enrollments: ENROLLMENTS },
        replayed: false,
      }));
      const input = { [field]: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY };
      expect(await call(as(VERIFIED), namespace, procedure, input)).toEqual({
        enrollments: ENROLLMENTS,
      });
      expect(reached).toEqual([
        [SPEC_ADMIN, { scope, userId: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY }],
      ]);
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action,
          targetType: 'user',
          targetId: TEACHER,
          reason: LIFT_REASON,
          before: move.before,
          after: { ...move.after, enrollments: ENROLLMENTS },
        },
      ]);
    },
  );

  it.each(LIFTS)(
    '%s answers a replay the first result and records no second entry',
    async (_scope, namespace, procedure, field, _action, move) => {
      const { as, written } = liftSurface(() => ({
        move: { ...move, enrollments: ENROLLMENTS },
        replayed: true,
      }));
      const input = { [field]: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY };
      expect(await call(as(VERIFIED), namespace, procedure, input)).toEqual({
        enrollments: ENROLLMENTS,
      });
      expect(written).toEqual([]);
    },
  );

  it.each(LIFTS)(
    '%s refuses an anonymous caller, a missing key and a blank reason, reaching and writing nothing',
    async (_scope, namespace, procedure, field) => {
      const { as, written, reached } = liftSurface(() => new Error('unreached'));
      const input = { [field]: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY };
      expect((await liftShapeOf(call(as(null), namespace, procedure, input))).code).toBe(
        'UNAUTHENTICATED',
      );
      for (const change of [{ idempotencyKey: undefined }, { reason: '  ' }]) {
        expect(
          (await liftShapeOf(call(as(VERIFIED), namespace, procedure, { ...input, ...change })))
            .code,
        ).toBe('VALIDATION_FAILED');
      }
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );

  it.each(LIFTS)(
    '%s answers the standing’s refusal and keeps no entry',
    async (_scope, namespace, procedure, field) => {
      const refusal = new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'not_banned' }],
      });
      const { as, written } = liftSurface(() => refusal);
      const input = { [field]: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY };
      expect(await liftShapeOf(call(as(VERIFIED), namespace, procedure, input))).toMatchObject({
        code: 'CONFLICT',
        details: [{ path: 'cause', code: 'not_banned' }],
      });
      expect(written).toEqual([]);
    },
  );

  it.each(LIFTS)(
    '%s retries a deadlocked transaction once, and a second deadlock answers CONFLICT restore_failed',
    async (_scope, namespace, procedure, field) => {
      const deadlock = () =>
        Object.assign(new Error('deadlock detected'), {
          name: 'DriverAdapterError',
          cause: { originalCode: '40P01', originalMessage: 'deadlock detected' },
        });
      const { as, written, reached } = liftSurface(() => deadlock());
      const input = { [field]: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY };
      expect(await liftShapeOf(call(as(VERIFIED), namespace, procedure, input))).toMatchObject({
        code: 'CONFLICT',
        details: [{ path: 'cause', code: 'restore_failed' }],
      });
      expect(reached).toHaveLength(2);
      expect(written).toEqual([]);
    },
  );

  it.each(LIFTS)(
    '%s refuses a call over rate_limit_ban_lift RATE_LIMITED before the transaction opens',
    async (_scope, namespace, procedure, field, _action, move) => {
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
      const reached: unknown[] = [];
      const keyedLift = async (_tx: unknown, adminId: string) => {
        reached.push(adminId);
        return { move: { ...move, enrollments: [] }, replayed: false };
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
            auditWriter: { write: async () => undefined },
          },
          services: new Proxy(unusedAdminServices, {
            get: (target, name, receiver) =>
              name === 'students' || name === 'teachers'
                ? { keyedLift }
                : Reflect.get(target, name, receiver),
          }),
          rateLimiter,
          clientAddress: '203.0.113.9',
        });
      const input = { [field]: TEACHER, reason: LIFT_REASON, idempotencyKey: KEY };
      await call(liftsCallerFor(context()), namespace, procedure, input);
      expect(
        (await liftShapeOf(call(liftsCallerFor(context()), namespace, procedure, input))).code,
      ).toBe('RATE_LIMITED');
      expect(keysRead).toContain('rate_limit_ban_lift');
      expect(transactions).toBe(1);
      expect(reached).toEqual([SPEC_ADMIN]);
    },
  );
});

// T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077, Q-R3 (a), Q-R5 (a)):
// `teachers.keptData.documentLink`, `.setEraseDate` and `.eraseNow` as they are served, over a
// recorded kept-data service. Each is the administrator kind with its own limit (T069's keys,
// `subject: 'caller'`) checked before the transaction opens; the link is audited
// `kept_document.view` on the document with the reason; the date `teacher.kept_data.erase_date_set`
// or `.erase_date_cleared` on the person with the date before and after; the erasure
// `teacher.kept_data.erased` on the person with what it erased; a keyed replay records no second
// entry; a refusal keeps none. What each does is `verification/kept-data.service.spec.ts`'.
describe('T077: teachers.keptData', () => {
  const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d1';
  const KEY = 'kept-data-attempt-000001';
  const KEPT_REASON = 'شكوى احتيال موثّقة';
  const LINK = { url: 'https://storage.invalid/k', expiresAt: '2026-11-14T10:05:00Z' };

  type Answer = (procedure: string, input: unknown) => unknown;
  type KeptCaller = {
    teachers: { keptData: Record<string, (input: unknown) => Promise<unknown>> };
  };

  function keptSurface(answer: Answer) {
    const reached: unknown[][] = [];
    const recorded =
      (procedure: string) =>
      async (_tx: unknown, adminId: string, input: unknown): Promise<unknown> => {
        reached.push([procedure, adminId, input]);
        const outcome = answer(procedure, input);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      };
    const keptData = {
      documentLink: recorded('documentLink'),
      setEraseDate: recorded('setEraseDate'),
      eraseNow: recorded('eraseNow'),
    };
    const contexts = adminContextsOver({ teachers: { keptData } as never });
    return {
      reached,
      written: contexts.written,
      as: (session: Parameters<typeof contexts.contextFor>[0]) =>
        callerFor(contexts.contextFor(session)) as unknown as KeptCaller,
    };
  }

  const SET_AT = '2026-12-20T08:00:00.000Z';
  const ANSWERS: Answer = (procedure, input) =>
    procedure === 'documentLink'
      ? LINK
      : procedure === 'setEraseDate'
        ? {
            before: '2026-12-01T08:00:00.000Z',
            // The service answers the instant it resolved (Q-K1 (a)).
            after: (input as { eraseAt: object | null }).eraseAt === null ? null : SET_AT,
            replayed: false,
          }
        : { documents: 2, payout: true, replayed: false };

  it('documentLink answers one link, audited kept_document.view on the document with the reason', async () => {
    const { as, written, reached } = keptSurface(ANSWERS);
    const input = { teacherUserId: TEACHER, documentId: DOCUMENT, reason: KEPT_REASON };
    expect(await as(VERIFIED).teachers.keptData['documentLink']?.(input)).toEqual(LINK);
    expect(reached).toEqual([['documentLink', SPEC_ADMIN, input]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'kept_document.view',
        targetType: 'document',
        targetId: DOCUMENT,
        reason: KEPT_REASON,
        after: { teacherUserId: TEACHER },
      },
    ]);
  });

  it.each([
    [
      'a wall clock',
      'teacher.kept_data.erase_date_set',
      { localDate: '2026-12-20', localTime: '10:00', timezone: 'Africa/Cairo' },
      SET_AT,
    ],
    ['null', 'teacher.kept_data.erase_date_cleared', null, null],
  ] as const)(
    'setEraseDate to %s audits %s on the person with the instant before and after',
    async (_name, action, eraseAt, after) => {
      const { as, written } = keptSurface(ANSWERS);
      await as(VERIFIED).teachers.keptData['setEraseDate']?.({
        teacherUserId: TEACHER,
        eraseAt,
        reason: KEPT_REASON,
        idempotencyKey: KEY,
      });
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action,
          targetType: 'user',
          targetId: TEACHER,
          reason: KEPT_REASON,
          before: { eraseAt: '2026-12-01T08:00:00.000Z' },
          after: { eraseAt: after },
        },
      ]);
    },
  );

  it('eraseNow audits teacher.kept_data.erased on the person with what it erased', async () => {
    const { as, written } = keptSurface(ANSWERS);
    await as(VERIFIED).teachers.keptData['eraseNow']?.({
      teacherUserId: TEACHER,
      reason: KEPT_REASON,
      idempotencyKey: KEY,
    });
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'teacher.kept_data.erased',
        targetType: 'user',
        targetId: TEACHER,
        reason: KEPT_REASON,
        after: { documents: 2, payout: true },
      },
    ]);
  });

  it.each(['setEraseDate', 'eraseNow'])(
    '%s records no second entry for a replay',
    async (procedure) => {
      const { as, written } = keptSurface((name, input) => ({
        ...(ANSWERS(name, input) as object),
        replayed: true,
      }));
      await as(VERIFIED).teachers.keptData[procedure]?.({
        teacherUserId: TEACHER,
        ...(procedure === 'setEraseDate' ? { eraseAt: null } : {}),
        reason: KEPT_REASON,
        idempotencyKey: KEY,
      });
      expect(written).toEqual([]);
    },
  );

  const INPUTS = {
    documentLink: { teacherUserId: TEACHER, documentId: DOCUMENT, reason: KEPT_REASON },
    setEraseDate: {
      teacherUserId: TEACHER,
      eraseAt: null,
      reason: KEPT_REASON,
      idempotencyKey: KEY,
    },
    eraseNow: { teacherUserId: TEACHER, reason: KEPT_REASON, idempotencyKey: KEY },
  } as const;
  const PROCEDURES = ['documentLink', 'setEraseDate', 'eraseNow'] as const;

  it.each(PROCEDURES)(
    '%s refuses an anonymous caller and a blank reason, and keeps no entry for the service refusal',
    async (procedure) => {
      const refusal = new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'already_erased' }],
      });
      const { as, written, reached } = keptSurface(() => refusal);
      const call = (caller: KeptCaller, input: unknown) =>
        caller.teachers.keptData[procedure]?.(input) ?? Promise.resolve();
      expect(await codeOf(call(as(null), INPUTS[procedure]))).toBe('UNAUTHENTICATED');
      expect(await codeOf(call(as(VERIFIED), { ...INPUTS[procedure], reason: ' ' }))).toBe(
        'VALIDATION_FAILED',
      );
      expect(reached).toEqual([]);
      expect(await codeOf(call(as(VERIFIED), INPUTS[procedure]))).toBe('CONFLICT');
      expect(written).toEqual([]);
    },
  );

  it.each([
    ['documentLink', 'rate_limit_kept_document_link'],
    ['setEraseDate', 'rate_limit_kept_data_erase_date'],
    ['eraseNow', 'rate_limit_kept_data_erase_now'],
  ] as const)(
    '%s refuses a call over %s RATE_LIMITED before the transaction opens',
    async (procedure, key) => {
      const keysRead: string[] = [];
      const counts = new Map<string, number>();
      const rateLimiter = new RateLimiter({
        settings: {
          read: async (read, schema) => {
            keysRead.push(read);
            return schema.parse({ limit: 1, window_seconds: 60 });
          },
        },
        counter: {
          hit: async (counted) => {
            const count = (counts.get(counted) ?? 0) + 1;
            counts.set(counted, count);
            return count;
          },
        },
        subjectKey: Buffer.alloc(32, 3),
      });
      let transactions = 0;
      const reached: string[] = [];
      const answering = (name: string, outcome: unknown) => async (): Promise<unknown> => {
        reached.push(name);
        return outcome;
      };
      const keptData = {
        documentLink: answering('documentLink', LINK),
        setEraseDate: answering('setEraseDate', { before: null, after: null, replayed: false }),
        eraseNow: answering('eraseNow', { documents: 0, payout: false, replayed: false }),
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
            auditWriter: { write: async () => undefined },
          },
          services: new Proxy(unusedAdminServices, {
            get: (target, name, receiver) =>
              name === 'teachers' ? { keptData } : Reflect.get(target, name, receiver),
          }),
          rateLimiter,
          clientAddress: '203.0.113.9',
        });
      const callOnce = () =>
        (callerFor(context()) as unknown as KeptCaller).teachers.keptData[procedure]?.(
          INPUTS[procedure],
        ) ?? Promise.resolve();
      await callOnce();
      expect(await codeOf(callOnce())).toBe('RATE_LIMITED');
      expect(keysRead).toContain(key);
      expect(transactions).toBe(1);
      expect(reached).toEqual([procedure]);
    },
  );
});
