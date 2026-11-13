// T005 of specs/004-sessions (`002:T144`; FR-421, FR-486; R-313) — the administrator surface's
// `students` namespace as it is served (admin-surface.md "`students`"). Every procedure is the
// administrator kind (refusals, the entry with the session's actor, nothing of a refused call) with a
// mandatory reason and no answer (`.output(z.void())`); each action is audited on the person with the
// reason and the standing it moved from and to (`student.suspend`, `student.ban`,
// `student.reinstate`). What the standing does is `standing.service.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { studentsRouter } from './students.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ students: studentsRouter }));

const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';

/** What the standing answers it moved; a reinstatement under an identity request. */
const MOVES = {
  suspendStudent: { before: { accountStatus: 'active' }, after: { accountStatus: 'suspended' } },
  banStudent: { before: { accountStatus: 'suspended' }, after: { accountStatus: 'banned' } },
  reinstateStudent: {
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
  const students: AdminSurfaceServices['students'] = {
    suspendStudent: record('suspendStudent', MOVES.suspendStudent),
    banStudent: record('banStudent', MOVES.banStudent),
    reinstateStudent: record('reinstateStudent', MOVES.reinstateStudent),
    // T072: the lift has its own router spec.
    keyedLift: async () => {
      throw new Error('unused');
    },
  };
  const contexts = adminContextsOver({ students });
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
  ['students.suspend', 'suspend', 'suspendStudent', 'student.suspend'],
  ['students.ban', 'ban', 'banStudent', 'student.ban'],
  ['students.reinstate', 'reinstate', 'reinstateStudent', 'student.reinstate'],
] as const;

describe('the administrator kind', () => {
  it.each(ACTIONS)(
    '%s refuses an anonymous caller and an unverified second factor, writing nothing',
    async (_path, procedure) => {
      const { as, written, reached } = surface();
      const input = { studentUserId: STUDENT, reason: 'سبب' };
      expect(await codeOf(as(null).students[procedure](input))).toBe('UNAUTHENTICATED');
      expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).students[procedure](input))).toBe(
        'MFA_REQUIRED',
      );
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );

  it.each(ACTIONS)(
    '%s needs a reason: a blank or missing one is VALIDATION_FAILED',
    async (_path, procedure) => {
      const { as, written, reached } = surface();
      expect(
        await codeOf(as(VERIFIED).students[procedure]({ studentUserId: STUDENT, reason: ' ' })),
      ).toBe('VALIDATION_FAILED');
      expect(
        await codeOf(
          as(VERIFIED).students[procedure]({ studentUserId: STUDENT } as {
            studentUserId: string;
            reason: string;
          }),
        ),
      ).toBe('VALIDATION_FAILED');
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );
});

describe('the audit entries', () => {
  it.each(ACTIONS)(
    '%s calls the standing with the actor and audits %s on the person with the reason, before and after, answering nothing',
    async (_path, procedure, method, action) => {
      const { as, written, reached } = surface();
      const answer = await as(VERIFIED).students[procedure]({
        studentUserId: STUDENT,
        reason: 'شكوى موثّقة',
      });
      expect(answer).toBeUndefined();
      expect(reached).toEqual([[method, SPEC_ADMIN, STUDENT]]);
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action,
          targetType: 'user',
          targetId: STUDENT,
          reason: 'شكوى موثّقة',
          ...MOVES[method],
        },
      ]);
    },
  );
});
