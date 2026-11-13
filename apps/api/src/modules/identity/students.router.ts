// T005 of specs/004-sessions (`002:T144`; FR-421, FR-486; R-313): the administrator surface's
// `students` namespace (admin-surface.md "`students` — a student's standing"). Thin (R-API-1); the
// actor is the session's administrator. Each action's entry is on the person (`user`) with its
// mandatory reason and the account status it moved from and to as the standing answers them
// (`before` and `after`, as `teachers.router.ts`' do). Mounted under `students` by `admin.router.ts`.
//
// T072 of specs/004-sessions (FR-502; SRS FR-ADMIN-5 as amended; admin-surface.md, the lifts'
// rows): a lift keyed through the standing's `keyedLift` (the kernel's `runOn` on the kind's
// transaction, the scope its path), its own limit `rate_limit_ban_lift` checked before the
// transaction opens, and the kind's deadlock declaration as `sessions.restore`'s (the account it
// names the only id of its lines; a second deadlock `CONFLICT` `restore_failed`). Audited on the
// person on its first run only, with the reason, the standing before and after, and each
// enrollment's result; a replay records none (`ctx.audit.replayed()`).
import { banLiftOutput, studentsActionInput, studentsLiftBanInput } from '@ijazah/contracts/admin';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

/** T072: a second deadlock's refusal, the lift's own (`banLiftRefusalCause`). */
const restoreFailed = () =>
  markRefusalLogged(
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'restore_failed' }],
    }),
  );

export const studentsRouter = createAdminRouter({
  suspend: adminProcedure({ input: studentsActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.students.suspendStudent(
        ctx.tx,
        ctx.administrator.adminId,
        input.studentUserId,
      );
      ctx.audit.record({
        action: 'student.suspend',
        targetType: 'user',
        targetId: input.studentUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  ban: adminProcedure({ input: studentsActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.students.banStudent(
        ctx.tx,
        ctx.administrator.adminId,
        input.studentUserId,
      );
      ctx.audit.record({
        action: 'student.ban',
        targetType: 'user',
        targetId: input.studentUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  reinstate: adminProcedure({ input: studentsActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.students.reinstateStudent(
        ctx.tx,
        ctx.administrator.adminId,
        input.studentUserId,
      );
      ctx.audit.record({
        action: 'student.reinstate',
        targetType: 'user',
        targetId: input.studentUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  // T072.
  liftBan: adminProcedure({
    input: studentsLiftBanInput,
    output: banLiftOutput,
    rateLimit: { key: 'rate_limit_ban_lift', subject: 'caller' },
    deadlock: {
      operation: 'students.liftBan',
      ids: (input) => ({ userId: input.studentUserId }),
      refusal: restoreFailed,
    },
  }).mutation(async ({ ctx, input }) => {
    const { move, replayed } = await ctx.services.students.keyedLift(
      ctx.tx,
      ctx.administrator.adminId,
      {
        scope: 'students.liftBan',
        userId: input.studentUserId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    );
    // Each result as a plain object, a cause only where there is one (the audit's JSON).
    const answer = {
      enrollments: move.enrollments.map(({ enrollmentId, restored, cause }) =>
        cause === undefined ? { enrollmentId, restored } : { enrollmentId, restored, cause },
      ),
    };
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'student.ban_lifted',
      targetType: 'user',
      targetId: input.studentUserId,
      reason: input.reason,
      before: move.before,
      after: { ...move.after, enrollments: answer.enrollments },
    });
    return answer;
  }),
});
