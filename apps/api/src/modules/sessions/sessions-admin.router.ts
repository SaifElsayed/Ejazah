// T016 of specs/004-sessions (FR-445, FR-480, FR-495; R-TIME-6; research R-307): the administrator
// surface's `sessions` namespace (admin-surface.md, "`sessions`"), its outage windows here; the
// monitor, the review queue, the cancellation and the restore join it in their tasks. Thin
// (R-API-1): the input validated, one service call on the call's transaction, the call's one audit
// entry described, the output parsed by its schema. The actor is the session's administrator, never
// the input's. Mounted under `sessions` by `admin.router.ts`.
//
// `sessions.outages.record` audits `provider_outage.recorded` on the window recorded, with the
// mandatory reason; `sessions.outages.list` audits `provider_outages.listed` on the reader, a list
// having no single target, as `payments.listed` does.
import {
  outagesListInput,
  outagesListOutput,
  outagesRecordInput,
  outagesRecordOutput,
} from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

const outagesRouter = createAdminRouter({
  record: adminProcedure({ input: outagesRecordInput, output: outagesRecordOutput }).mutation(
    async ({ ctx, input }) => {
      const recorded = await ctx.services.outages.record(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'provider_outage.recorded',
        targetType: 'provider_outage',
        targetId: recorded.outageId,
        reason: input.reason,
      });
      return recorded;
    },
  ),

  list: adminProcedure({ input: outagesListInput, output: outagesListOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({
        action: 'provider_outages.listed',
        targetType: 'admin',
        targetId: adminId,
      });
      return ctx.services.outages.list(ctx.tx, input);
    },
  ),
});

export const sessionsAdminRouter = createAdminRouter({ outages: outagesRouter });
