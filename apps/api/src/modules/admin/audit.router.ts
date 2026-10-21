// T067: the administrator surface's `audit` namespace (admin-surface.md "`audit` and `home`"; FR-176,
// FR-181). Thin: the input validated, one service call on the call's transaction, the output parsed
// by its schema (R-API-1). Both procedures are reads, audited under `audit.read` naming the reader,
// since neither has a single target (owner's decision 2026-10-21). Mounted under `audit` by
// `admin.router.ts`.
import {
  auditGetInput,
  auditGetOutput,
  auditListInput,
  auditListOutput,
} from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const auditRouter = createAdminRouter({
  list: adminProcedure({ input: auditListInput, output: auditListOutput }).query(
    ({ ctx, input }) => {
      ctx.audit.record({
        action: 'audit.read',
        targetType: 'admin',
        targetId: ctx.administrator.adminId,
      });
      return ctx.services.audit.list(ctx.tx, input);
    },
  ),

  get: adminProcedure({ input: auditGetInput, output: auditGetOutput }).query(({ ctx, input }) => {
    ctx.audit.record({
      action: 'audit.read',
      targetType: 'admin',
      targetId: ctx.administrator.adminId,
    });
    return ctx.services.audit.get(ctx.tx, input.entryId);
  }),
});
