// T077: the `teacher.payout` namespace (app-surface.md "`teacher.payout` — payout setup"; FR-190 to
// FR-194). Thin: every procedure the teacher kind admitting an approved teacher (R-106), so an
// applicant, a student or an anonymous caller is refused before the service is reached and a
// suspended or banned account is `ACCOUNT_RESTRICTED`; the input validated, one service call on the
// caller's own payout account, the output parsed by its schema (R-API-1). Mounted under
// `teacher.payout` by `app.router.ts`.
import { payoutGetOutput, payoutRegisterInput } from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const payoutRouter = createAppRouter({
  get: teacherProcedure({
    admits: 'approved',
    input: z.void(),
    output: payoutGetOutput,
  }).query(({ ctx }) => ctx.services.identity.payout.get(ctx.caller.userId)),

  register: teacherProcedure({
    admits: 'approved',
    input: payoutRegisterInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.payout.register(ctx.caller.userId, input);
  }),
});
