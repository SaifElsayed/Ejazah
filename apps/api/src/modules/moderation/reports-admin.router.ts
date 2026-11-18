// T011 of specs/005-certification: the administrator surface's `reports` namespace
// (contracts/admin-surface.md, `reports.list`, `.get`, `.resolve`; FR-612; research R-408; the note
// under T011, Q-R3 (a)). Thin (R-API-1): the administrator kind refuses an anonymous caller and an
// unverified second factor, runs one transaction and writes the call's audit entry on it; one
// service call with the session's administrator; the output parsed by its schema, so the queue never
// carries the reporter's reason. All three under the signed-in default limit (admin-surface.md:
// «default»). The audit target is a kind word and an id, never a name: `reports.listed` on the
// reader (the other list reads' `admin` target), `report.viewed` and `report.resolved` (with the
// administrator's note as its reason) on the report (`user_report` + its id). `resolve` is keyed
// (`idempotencyKey`, `runOn` on the kind's transaction); a replay records no second entry
// (`audit.replayed()`). Mounted under `reports` by `admin.router.ts` (the integration's line).
import {
  adminReportsGetInput,
  adminReportsGetOutput,
  adminReportsListInput,
  adminReportsListOutput,
  adminReportsResolveInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

/** A report as an audit entry names it (`admin/labels/target-label.ts`). */
const REPORT_TARGET = 'user_report';

export const reportsAdminRouter = createAdminRouter({
  list: adminProcedure({
    input: adminReportsListInput,
    output: adminReportsListOutput,
  }).query(async ({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    const page = await ctx.services.reports.list(ctx.tx, adminId, input, ctx.log);
    ctx.audit.record({ action: 'reports.listed', targetType: 'admin', targetId: adminId });
    return page;
  }),

  get: adminProcedure({
    input: adminReportsGetInput,
    output: adminReportsGetOutput,
  }).query(async ({ ctx, input }) => {
    const detail = await ctx.services.reports.get(
      ctx.tx,
      ctx.administrator.adminId,
      input,
      ctx.log,
    );
    ctx.audit.record({
      action: 'report.viewed',
      targetType: REPORT_TARGET,
      targetId: detail.reportId,
    });
    return detail;
  }),

  resolve: adminProcedure({
    input: adminReportsResolveInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    const { replayed } = await ctx.services.reports.resolve(
      ctx.tx,
      ctx.administrator.adminId,
      input,
      ctx.log,
    );
    if (replayed) {
      ctx.audit.replayed();
      return;
    }
    ctx.audit.record({
      action: 'report.resolved',
      targetType: REPORT_TARGET,
      targetId: input.reportId,
      reason: input.note,
    });
  }),
});
