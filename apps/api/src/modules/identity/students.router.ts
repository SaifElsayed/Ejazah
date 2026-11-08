// T005 of specs/004-sessions (`002:T144`; FR-421, FR-486; R-313): the administrator surface's
// `students` namespace (admin-surface.md "`students` — a student's standing"). Thin (R-API-1); the
// actor is the session's administrator. Each action's entry is on the person (`user`) with its
// mandatory reason and the account status it moved from and to as the standing answers them
// (`before` and `after`, as `teachers.router.ts`' do). Mounted under `students` by `admin.router.ts`.
import { studentsActionInput } from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

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
});
