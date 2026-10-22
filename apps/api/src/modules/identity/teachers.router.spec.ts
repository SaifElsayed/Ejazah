// T068 — the administrator surface's `teachers` namespace as it is served (admin-surface.md
// "`teachers`"; FR-165). Every procedure is the administrator kind (refusals, one transaction, the
// entry with the session's actor, nothing of a refused call); each action is audited on the person
// with its mandatory reason and the standing it moved to. What the standing does is
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

function surface() {
  const reached: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<void> => {
      reached.push([name, ...args.slice(1)]);
    };
  const teachers: AdminSurfaceServices['teachers'] = {
    suspend: record('suspend'),
    revokeApproval: record('revokeApproval'),
    ban: record('ban'),
    reinstate: record('reinstate'),
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
  ['teachers.suspend', 'suspend', 'teacher.suspend', { accountStatus: 'suspended' }],
  [
    'teachers.revokeApproval',
    'revokeApproval',
    'teacher.revoke',
    { verificationStatus: 'revoked' },
  ],
  ['teachers.ban', 'ban', 'teacher.ban', { accountStatus: 'banned' }],
  ['teachers.reinstate', 'reinstate', 'teacher.reinstate', { accountStatus: 'active' }],
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
    '%s audits %s on the person with the reason',
    async (_path, procedure, action, after) => {
      const { as, written, reached } = surface();
      await as(VERIFIED).teachers[procedure]({ teacherUserId: TEACHER, reason: 'شكوى موثّقة' });
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action,
          targetType: 'user',
          targetId: TEACHER,
          reason: 'شكوى موثّقة',
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
