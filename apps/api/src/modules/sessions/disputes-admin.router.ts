// T034 of specs/004-sessions (FR-421, FR-474, FR-475, FR-476, FR-480; research R-308;
// contracts/admin-surface.md, "`disputes`"): the administrator surface's `disputes` namespace,
// sessions' procedures over moderation's rows. Thin (R-API-1): the input validated, one service
// call on the call's transaction, the call's one audit entry described, the output parsed by its
// schema. The actor is the session's administrator, never the input's. Mounted under `disputes` by
// `admin.router.ts`.
//
// `disputes.list` audits `disputes.listed` on the reader; `disputes.get` audits `dispute.viewed` on
// the dispute; `disputes.resolve` audits `dispute.resolved` on the dispute, with the mandatory
// reason and, as its `after`, the resolution, the party a `party_*` ruling suspends or bans, and the
// session's final status (PR #133's review, round 1, Minor 3). A refusal rolls the call back, its
// audit entry with it. What each does is
// `dispute-queue.service.ts`' and `dispute-resolution.service.ts`'.
//
// T059 (SRS FR-DISPUTE-7; FR-470, FR-472, FR-480): `disputes.revise` declares its own limit,
// `rate_limit_dispute_revision`, the administrator as subject, checked by the kind before its
// transaction opens and apart from the key; the call is keyed on the kind's transaction
// (`IdempotencyService.runOn`, the note under T059), and audits `dispute.revised` on the dispute
// with the reason on its first run only: a replay records no entry (`ctx.audit.replayed()`), the
// first call's being the record. What it does is `revision.service.ts`'.
import {
  disputesGetInput,
  disputesGetOutput,
  disputesListInput,
  disputesListOutput,
  disputesResolveInput,
  disputesResolveOutput,
  disputesReviseInput,
  disputesReviseOutput,
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
        after: {
          resolution: input.resolution,
          ...(input.party !== undefined && input.resolution.startsWith('party_')
            ? { party: input.party }
            : {}),
          sessionStatus: resolved.sessionStatus,
        },
      });
      return resolved;
    },
  ),

  revise: adminProcedure({
    input: disputesReviseInput,
    output: disputesReviseOutput,
    rateLimit: { key: 'rate_limit_dispute_revision', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { outcome, replayed } = await ctx.services.disputes.revise(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
    } else {
      ctx.audit.record({
        action: 'dispute.revised',
        targetType: 'dispute',
        targetId: outcome.disputeId,
        reason: input.reason,
      });
    }
    return outcome;
  }),
});
