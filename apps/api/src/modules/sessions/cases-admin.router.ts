// T035 of specs/004-sessions (FR-422, FR-478, FR-480; R-MONEY-6; research R-312; contracts/admin-
// surface.md, "`cases`"): the administrator surface's `cases` namespace, the compensation-case queue.
// Thin (R-API-1): the input validated, one service call on the call's transaction, the call's one
// audit entry described, the output parsed by its schema. The actor is the session's administrator,
// never the input's. Mounted under `cases` by `admin.router.ts`.
//
// `cases.list` audits `cases.listed` on the reader, a list having no single target, as
// `payments.listed` does; `cases.get` audits `case.viewed`, `cases.resolve` `case.resolved` and
// `cases.dismiss` `case.dismissed`, each on the case (`dispute`, T002's target type), the closing's
// mandatory note as the entry's reason. A refusal rolls the call back, its audit entry with it.
import {
  casesDismissInput,
  casesDismissOutput,
  casesGetInput,
  casesGetOutput,
  casesListInput,
  casesListOutput,
  casesOpenManualInput,
  casesOpenManualOutput,
  casesResolveInput,
  casesResolveOutput,
} from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const casesAdminRouter = createAdminRouter({
  list: adminProcedure({ input: casesListInput, output: casesListOutput }).query(
    async ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      const page = await ctx.services.cases.list(ctx.tx, adminId, input);
      ctx.audit.record({ action: 'cases.listed', targetType: 'admin', targetId: adminId });
      return page;
    },
  ),

  get: adminProcedure({ input: casesGetInput, output: casesGetOutput }).query(
    async ({ ctx, input }) => {
      const answer = await ctx.services.cases.get(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({ action: 'case.viewed', targetType: 'dispute', targetId: input.caseId });
      return answer;
    },
  ),

  resolve: adminProcedure({ input: casesResolveInput, output: casesResolveOutput }).mutation(
    async ({ ctx, input }) => {
      const resolved = await ctx.services.cases.resolve(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'case.resolved',
        targetType: 'dispute',
        targetId: input.caseId,
        reason: input.note,
      });
      return resolved;
    },
  ),

  dismiss: adminProcedure({ input: casesDismissInput, output: casesDismissOutput }).mutation(
    async ({ ctx, input }) => {
      const dismissed = await ctx.services.cases.dismiss(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'case.dismissed',
        targetType: 'dispute',
        targetId: input.caseId,
        reason: input.note,
      });
      return dismissed;
    },
  ),

  // T064 (FR-493; research R-326): the manual case, its own limit checked before the transaction
  // (R-321), keyed on the call's transaction; a replay records no second entry (the note under
  // T064, Q1 (a)), the first call's being the record. Audited `case.opened_manually` on the case
  // opened or joined, with the reason, the party, `joined` and the remedy handed.
  openManual: adminProcedure({
    input: casesOpenManualInput,
    output: casesOpenManualOutput,
    rateLimit: { key: 'rate_limit_manual_compensation_case', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { answer, replayed } = await ctx.services.cases.openManual(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'case.opened_manually',
      targetType: 'dispute',
      targetId: answer.caseId,
      reason: input.reason,
      after: {
        party: answer.party,
        joined: answer.joined,
        handedRemedy: answer.handedRemedy === undefined ? null : { ...answer.handedRemedy },
      },
    });
    return answer;
  }),
});
