// T068: the administrator surface's `applications` namespace (admin-surface.md "`applications` — the
// verification queue"; FR-160 to FR-162). Thin: the input validated, one service call on the call's
// transaction, the action's audit entry described, the output parsed by its schema (R-API-1). The
// actor is the session's administrator, never the input's. Each decision's entry targets the
// application (`teacher_application`, the applicant's id), so its history is `audit.list` filtered on
// that target; the note the applicant sees is the entry's reason, the status the decision moved from
// its before, and the status it moved to beside the dialog's choice its after. The call's entry holds
// its day and outcome before and after. Each as the review answers it (T116).
// The list and the detail are reads (`applications.read`) naming the reader. Mounted under
// `applications` by `admin.router.ts`.
import {
  applicationsApproveInput,
  applicationsBanInput,
  applicationsGetInput,
  applicationsGetOutput,
  applicationsListInput,
  applicationsListOutput,
  applicationsRecordCallInput,
  applicationsRejectInput,
  applicationsRequestInfoInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

const TARGET = 'teacher_application';

export const applicationsRouter = createAdminRouter({
  list: adminProcedure({ input: applicationsListInput, output: applicationsListOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({ action: 'applications.read', targetType: 'admin', targetId: adminId });
      return ctx.services.applications.list(ctx.tx, input);
    },
  ),

  get: adminProcedure({ input: applicationsGetInput, output: applicationsGetOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({ action: 'applications.read', targetType: 'admin', targetId: adminId });
      return ctx.services.applications.get(ctx.tx, input.teacherUserId);
    },
  ),

  recordCall: adminProcedure({ input: applicationsRecordCallInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.applications.recordCall(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'application.record_call',
        targetType: TARGET,
        targetId: input.teacherUserId,
        before,
        after,
      });
    },
  ),

  approve: adminProcedure({ input: applicationsApproveInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after, subjectIds } = await ctx.services.applications.approve(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'application.approve',
        targetType: TARGET,
        targetId: input.teacherUserId,
        ...(input.note === undefined ? {} : { reason: input.note }),
        before,
        after: { ...after, subjectIds },
      });
    },
  ),

  reject: adminProcedure({ input: applicationsRejectInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.applications.reject(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'application.reject',
        targetType: TARGET,
        targetId: input.teacherUserId,
        reason: input.note,
        before,
        after: { ...after, reasonChoice: input.reasonChoice },
      });
    },
  ),

  requestInfo: adminProcedure({ input: applicationsRequestInfoInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.applications.requestInfo(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'application.request_info',
        targetType: TARGET,
        targetId: input.teacherUserId,
        reason: input.note,
        before,
        after: { ...after, needed: input.needed },
      });
    },
  ),

  ban: adminProcedure({ input: applicationsBanInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.applications.ban(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'application.ban',
        targetType: TARGET,
        targetId: input.teacherUserId,
        reason: input.note,
        before,
        after: { ...after, reasonChoice: input.reasonChoice },
      });
    },
  ),
});
