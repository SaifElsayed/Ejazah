// 006:T008 of specs/006-programme (FR-706a, FR-706b, FR-709; R-505, R-513; I-2 (a); B-P2's conflict
// check, Q-7 (a); contracts/admin-surface.md `programmes.decide`): the administrator surface's
// `programmes` namespace, mounted under `programmes` by `admin.router.ts` (its `006:` block); T017
// and T018 add their procedures here. Thin (R-API-1): the input validated, one service call on the
// kind's transaction with the session's administrator, never the input's; the call's one audit entry
// (R-API-12) on the item's enrollment, `programme_request.approved`, `.declined` or `.extended`, the
// note as written as its reason when one is given (no other row keeps it); the output parsed by its
// schema. Keyed on the kind's transaction (`runOn`, scope `programmes.decide`): a replay answers the
// first result with no second entry (`ctx.audit.replayed()`). A refusal rolls the call back, its
// entry with it. No limit of its own: the administrator kind's general limit covers it
// (admin-surface.md). What it decides is `programme-requests.service.ts`'.
import { programmesDecideInput, programmesDecideOutput } from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const programmesAdminRouter = createAdminRouter({
  decide: adminProcedure({ input: programmesDecideInput, output: programmesDecideOutput }).mutation(
    async ({ ctx, input }) => {
      const { answer, replayed, enrollmentId } = await ctx.services.programmes.decide(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      if (replayed) {
        ctx.audit.replayed();
        return answer;
      }
      ctx.audit.record({
        action: `programme_request.${answer.status}`,
        targetType: 'enrollment',
        targetId: enrollmentId,
        ...(input.note === undefined ? {} : { reason: input.note }),
      });
      return answer;
    },
  ),
});
