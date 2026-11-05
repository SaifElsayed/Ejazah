// T052: the administrator surface's `payments` namespace, the read-only payments monitor
// (specs/003-booking/contracts/admin-surface.md; FR-400 to FR-402, FR-PAYG-11, FR-ADMIN-18,
// research R-220). Thin: the input validated, one service call on the call's transaction, the read's
// audit entry described, the output parsed by its schema (R-API-1), which strips any field it does
// not name.
//
// TWO READS AND NOTHING ELSE (FR-401). Both are queries; no procedure here creates, moves, refunds
// or confirms an order or an enrollment, and none ever will (FR-PAYG-8, FR-PAYG-11). Each call
// writes its one audit entry, as every administrator call must (`adminProcedure`, plan.md point 2):
// `payments.listed` naming the reader, a list having no single target, and `payments.viewed` naming
// the order. The actor is the session's administrator, never the input's (FR-402).
// Mounted under `payments` by `admin.router.ts`.
import {
  paymentsGetInput,
  paymentsGetOutput,
  paymentsListInput,
  paymentsListOutput,
} from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const paymentsAdminRouter = createAdminRouter({
  list: adminProcedure({ input: paymentsListInput, output: paymentsListOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({ action: 'payments.listed', targetType: 'admin', targetId: adminId });
      return ctx.services.payments.list(ctx.tx, input);
    },
  ),

  get: adminProcedure({ input: paymentsGetInput, output: paymentsGetOutput }).query(
    ({ ctx, input }) => {
      ctx.audit.record({
        action: 'payments.viewed',
        targetType: 'payment',
        targetId: input.paymentId,
      });
      return ctx.services.payments.get(ctx.tx, input.paymentId);
    },
  ),
});
