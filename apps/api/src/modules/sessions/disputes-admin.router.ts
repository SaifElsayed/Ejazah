// T034 of specs/004-sessions (FR-421, FR-474, FR-475, FR-476, FR-480; research R-308;
// contracts/admin-surface.md, "`disputes`"): the administrator surface's `disputes` namespace,
// sessions' procedures over moderation's rows. Thin (R-API-1): the input validated, one service
// call on the call's transaction, the call's one audit entry described, the output parsed by its
// schema. The actor is the session's administrator, never the input's. Mounted under `disputes` by
// `admin.router.ts`.
//
// `disputes.list` audits `disputes.listed` on the reader; `disputes.get` audits `dispute.viewed` on
// the dispute; `disputes.resolve` audits `dispute.resolved` on the dispute, with the mandatory
// reason. A refusal rolls the call back, its audit entry with it. What each does is
// `dispute-queue.service.ts`' and `dispute-resolution.service.ts`'.
import {
  disputesGetInput,
  disputesGetOutput,
  disputesListInput,
  disputesListOutput,
  disputesResolveInput,
  disputesResolveOutput,
} from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const disputesAdminRouter = createAdminRouter({
  list: adminProcedure({ input: disputesListInput, output: disputesListOutput }).query(
    async ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      const page = await ctx.services.disputes.list(ctx.tx, adminId, input);
      ctx.audit.record({ action: 'disputes.listed', targetType: 'admin', targetId: adminId });
      return page;
    },
  ),

  get: adminProcedure({ input: disputesGetInput, output: disputesGetOutput }).query(
    async ({ ctx, input }) => {
      const answer = await ctx.services.disputes.get(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'dispute.viewed',
        targetType: 'dispute',
        targetId: input.disputeId,
      });
      return answer;
    },
  ),

  resolve: adminProcedure({ input: disputesResolveInput, output: disputesResolveOutput }).mutation(
    async ({ ctx, input }) => {
      const resolved = await ctx.services.disputes.resolve(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'dispute.resolved',
        targetType: 'dispute',
        targetId: resolved.disputeId,
        reason: input.reason,
      });
      return resolved;
    },
  ),
});
