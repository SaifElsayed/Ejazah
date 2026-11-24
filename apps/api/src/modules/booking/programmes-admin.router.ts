// 006:T008 of specs/006-programme (FR-706a, FR-706b, FR-709; R-505, R-513; I-2 (a); B-P2's conflict
// check, Q-7 (a); contracts/admin-surface.md `programmes.decide`): the administrator surface's
// `programmes` namespace, mounted under `programmes` by `admin.router.ts` (its `006:` block); T017
// (`programmes.reopen`, below) and T018 add their procedures here. Thin (R-API-1): the input validated, one service call on the
// kind's transaction with the session's administrator, never the input's; the call's one audit entry
// (R-API-12) on the item's enrollment, `programme_request.approved`, `.declined` or `.extended`, the
// note as written as its reason when one is given (no other row keeps it); the output parsed by its
// schema. Keyed on the kind's transaction (`runOn`, scope `programmes.decide`): a replay answers the
// first result with no second entry (`ctx.audit.replayed()`). A refusal rolls the call back, its
// entry with it. No limit of its own: the administrator kind's general limit covers it
// (admin-surface.md). What it decides is `programme-requests.service.ts`'.
import {
  programmesDecideInput,
  programmesDecideOutput,
  programmesGetInput,
  programmesGetOutput,
  programmesQueueInput,
  programmesQueueOutput,
  programmesReopenInput,
  programmesReopenOutput,
} from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const programmesAdminRouter = createAdminRouter({
  // 006:T018 (FR-727; admin-surface.md `programmes.queue`; Q-f4 (a), the owner, 2026-11-24): the
  // queue, oldest first, on the call's transaction; audited `programmes.listed` naming the reader, as
  // `payments.list` is (a queue has no single target).
  queue: adminProcedure({ input: programmesQueueInput, output: programmesQueueOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({ action: 'programmes.listed', targetType: 'admin', targetId: adminId });
      return ctx.services.programmes.queue(ctx.tx, input);
    },
  ),
  // 006:T018 (FR-727; admin-surface.md `programmes.get`; Q-f4 (a)): one programme's page, audited
  // `programmes.viewed` on the enrollment, as `payments.get` names its order.
  get: adminProcedure({ input: programmesGetInput, output: programmesGetOutput }).query(
    ({ ctx, input }) => {
      ctx.audit.record({
        action: 'programmes.viewed',
        targetType: 'enrollment',
        targetId: input.enrollmentId,
      });
      return ctx.services.programmes.get(ctx.tx, input.enrollmentId);
    },
  ),
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
  // 006:T017 (FR-725, FR-727; R-513; admin-surface.md `programmes.reopen`): a stopped programme
  // back to `paused`, keyed on the kind's transaction (scope `programmes.reopen`); its one entry
  // `programme.reopened` on the enrollment, the administrator's reason as written.
  reopen: adminProcedure({ input: programmesReopenInput, output: programmesReopenOutput }).mutation(
    async ({ ctx, input }) => {
      const { answer, replayed, enrollmentId } = await ctx.services.programmes.reopen(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      if (replayed) {
        ctx.audit.replayed();
        return answer;
      }
      ctx.audit.record({
        action: 'programme.reopened',
        targetType: 'enrollment',
        targetId: enrollmentId,
        reason: input.reason,
      });
      return answer;
    },
  ),
});
