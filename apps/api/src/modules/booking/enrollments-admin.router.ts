// T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9, DEC-69; contracts/admin-surface.md,
// "`enrollments`"): the administrator surface's `enrollments` namespace, booking's first
// administrator procedure. Thin (R-API-1): the input validated, one service call on the call's
// transaction, the call's one audit entry described, the output parsed by its schema. The actor is
// the session's administrator, never the input's. Mounted under `enrollments` by `admin.router.ts`
// (the integration's line, the note under T070, N9).
//
// `enrollments.releaseSlot` declares its own limit, `rate_limit_slot_release`, the administrator as
// subject, checked before the transaction opens and apart from the key; keyed on the kind's
// transaction (`runOn`), it audits `enrollment.slot_released` on the enrollment with the reason on
// its first run only, a replay recording none (`ctx.audit.replayed()`). A refusal rolls the call
// back, its audit entry with it. What it does is `slot-release.service.ts`'.
import { enrollmentsReleaseSlotInput, enrollmentsReleaseSlotOutput } from '@ijazah/contracts/admin';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const enrollmentsAdminRouter = createAdminRouter({
  releaseSlot: adminProcedure({
    input: enrollmentsReleaseSlotInput,
    output: enrollmentsReleaseSlotOutput,
    rateLimit: { key: 'rate_limit_slot_release', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { answer, replayed } = await ctx.services.enrollments.releaseSlot(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'enrollment.slot_released',
      targetType: 'enrollment',
      targetId: input.enrollmentId,
      reason: input.reason,
    });
    return answer;
  }),
});
