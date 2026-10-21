// T067: the administrator surface's `home` namespace (admin-surface.md "`audit` and `home`"; FR-176).
// Thin: one service call on the call's transaction, the output parsed by its schema (R-API-1). A
// read, audited under `home.read` naming the reader (owner's decision 2026-10-21). Mounted under
// `home` by `admin.router.ts`.
import { homeSummaryOutput } from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const homeRouter = createAdminRouter({
  summary: adminProcedure({ input: z.void(), output: homeSummaryOutput }).query(({ ctx }) => {
    ctx.audit.record({
      action: 'home.read',
      targetType: 'admin',
      targetId: ctx.administrator.adminId,
    });
    return ctx.services.home.summary(ctx.tx);
  }),
});
