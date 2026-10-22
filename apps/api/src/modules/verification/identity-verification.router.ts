// T068: the user surface's `account.identityVerification` namespace (app-surface.md; FR-166), the
// `VerifyIdentity` screen of either role. A router of this module merged under `account` by
// `app.router.ts`, since identity imports nothing of verification (R-121). Both procedures admit a
// restricted account: the request is what a person under one must answer. Thin (R-API-1).
import { identityVerificationGetOutput, identityVerificationSubmitInput } from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, userProcedure } from '../../surfaces/procedures.js';

export const identityVerificationRouter = createAppRouter({
  get: userProcedure({
    input: z.void(),
    output: identityVerificationGetOutput,
    admitsRestricted: true,
  }).query(({ ctx }) => ctx.services.verification.identityVerification.get(ctx.caller.userId)),

  submit: userProcedure({
    input: identityVerificationSubmitInput,
    output: z.void(),
    admitsRestricted: true,
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.verification.identityVerification.submit(ctx.caller.userId, input);
  }),
});
