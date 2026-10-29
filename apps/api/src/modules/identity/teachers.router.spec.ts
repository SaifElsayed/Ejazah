// T068 — the administrator surface's `teachers` namespace as it is served (admin-surface.md
// "`teachers`"; FR-165). Every procedure is the administrator kind (refusals, one transaction, the
// entry with the session's actor, nothing of a refused call); each action is audited on the person
// with its mandatory reason, the standing it moved from as `before` (T116) and the one it moved to
// as `after`, both as the standing answers them. What the standing does is
// `standing.service.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
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
