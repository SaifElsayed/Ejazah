// T068: the administrator surface's `teachers` namespace (admin-surface.md "`teachers` — an approved
// teacher's standing"; FR-165, FR-142). Thin (R-API-1); the actor is the session's administrator.
// Each action's entry is on the person (`user`) with its mandatory reason, and the standing it moved.
// Mounted under `teachers` by `admin.router.ts`.
import { teachersActionInput } from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const teachersRouter = createAdminRouter({
  suspend: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.teachers.suspend(ctx.tx, ctx.administrator.adminId, input.teacherUserId);
      ctx.audit.record({
        action: 'teacher.suspend',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        after: { accountStatus: 'suspended' },
      });
    },
  ),

  revokeApproval: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.teachers.revokeApproval(
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
        after: { verificationStatus: 'revoked' },
      });
    },
  ),

  ban: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.teachers.ban(ctx.tx, ctx.administrator.adminId, input.teacherUserId);
      ctx.audit.record({
        action: 'teacher.ban',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        after: { accountStatus: 'banned' },
      });
    },
  ),

  reinstate: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.teachers.reinstate(ctx.tx, ctx.administrator.adminId, input.teacherUserId);
      ctx.audit.record({
        action: 'teacher.reinstate',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        after: { accountStatus: 'active' },
      });
    },
  ),
});
