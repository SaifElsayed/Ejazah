// T068: the administrator surface's `teachers` namespace (admin-surface.md "`teachers` — an approved
// teacher's standing"; FR-165, FR-142). Thin (R-API-1); the actor is the session's administrator.
// Each action's entry is on the person (`user`) with its mandatory reason, and the standing it moved
// from and to as the standing answers them (`before` and `after`, T116).
// Mounted under `teachers` by `admin.router.ts`.
import { teachersActionInput } from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const teachersRouter = createAdminRouter({
  suspend: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.suspend(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'teacher.suspend',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  revokeApproval: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.revokeApproval(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
        input.reason,
      );
      ctx.audit.record({
        action: 'teacher.revoke',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  ban: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.ban(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'teacher.ban',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  reinstate: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.reinstate(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'teacher.reinstate',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),
});
