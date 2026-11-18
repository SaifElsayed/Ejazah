// 003:T105: the administrator surface's `payouts` namespace, «تحويلات المعلمين» (SRS DEC-89; ADR
// 0025 D2; the note under T105). Thin (R-API-1): the administrator kind refuses an anonymous caller
// and an unverified second factor, runs one transaction and writes the call's audit entry on it; one
// service call with the session's administrator; the output parsed by its schema.
//
// TWO READS AND ONE MARK. `list` and `get` are audited as the payments monitor's reads are (T053):
// `payouts.listed` naming the reader (`admin`), `payouts.viewed` naming the teacher (`user`). `mark`
// («تم الصرف») records that an administrator executed a due release by hand in the gateway's
// dashboard; it moves no money and calls nothing (N1, FR-PAYG-11). Keyed (`idempotencyKey`, `runOn`
// on the kind's transaction): a replay records no second entry (`audit.replayed()`); the mark is
// audited `payout_release.marked` on the teacher (`user` target). Mounted under `payouts` by
// `admin.router.ts` (the integration's line).
import {
  payoutsGetInput,
  payoutsGetOutput,
  payoutsListInput,
  payoutsListOutput,
  payoutsMarkInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const payoutsAdminRouter = createAdminRouter({
  list: adminProcedure({ input: payoutsListInput, output: payoutsListOutput }).query(
    async ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      const page = await ctx.services.payouts.list(ctx.tx, adminId, input);
      ctx.audit.record({ action: 'payouts.listed', targetType: 'admin', targetId: adminId });
      return page;
    },
  ),

  get: adminProcedure({ input: payoutsGetInput, output: payoutsGetOutput }).query(
    async ({ ctx, input }) => {
      const detail = await ctx.services.payouts.get(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'payouts.viewed',
        targetType: 'user',
        targetId: input.teacherUserId,
      });
      return detail;
    },
  ),

  // Its own limit, the administrator as subject, checked before the transaction opens (the admin
  // actions' precedent, `enrollments.releaseSlot`'s `rate_limit_slot_release`).
  mark: adminProcedure({
    input: payoutsMarkInput,
    output: z.void(),
    rateLimit: { key: 'rate_limit_payout_mark', subject: 'caller' },
  }).mutation(
    async ({ ctx, input }) => {
      const { teacherUserId, replayed } = await ctx.services.payouts.mark(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      if (replayed) {
        ctx.audit.replayed();
        return;
      }
      ctx.audit.record({
        action: 'payout_release.marked',
        targetType: 'user',
        targetId: teacherUserId,
      });
    },
  ),
});
