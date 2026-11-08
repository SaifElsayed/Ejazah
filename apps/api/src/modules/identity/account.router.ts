// T049: the `account` namespace (app-surface.md "`account` — the signed-in person"; FR-131,
// FR-132, FR-137). Thin: the input validated, one service call on the caller's own account, the
// output parsed by its schema (R-API-1), so `me` answers the fields the contract names and nothing
// else. Every procedure is the user kind; `me` and `setLanguage` admit a suspended or banned account
// (the restricted screen reads its standing and switches its language), the rest do not. Mounted
// under `account` by `app.router.ts`; `account.identityVerification` is the verification module's
// router, merged there. `account.delete` (T082) admits a restricted account (a suspended person may
// still leave, FR-140), counts the caller's attempts on the authentication budget, and is keyed.
import {
  deleteAccountInput,
  meOutput,
  reportDeviceTimezoneInput,
  setLanguageInput,
  setTimezoneInput,
  updateProfileInput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, userProcedure } from '../../surfaces/procedures.js';

const { authentication, authenticationBudget } = defaultRateLimits;

export const accountRouter = createAppRouter({
  me: userProcedure({ input: z.void(), output: meOutput, admitsRestricted: true }).query(
    ({ ctx }) => ctx.services.identity.account.me(ctx.caller.userId),
  ),

  updateProfile: userProcedure({ input: updateProfileInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.identity.account.updateProfile(ctx.caller.userId, input);
    },
  ),

  setLanguage: userProcedure({
    input: setLanguageInput,
    output: z.void(),
    admitsRestricted: true,
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.account.setLanguage(ctx.caller.userId, input.language);
  }),

  setTimezone: userProcedure({ input: setTimezoneInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.identity.account.setTimezone(ctx.caller.userId, input.timezone);
    },
  ),

  reportDeviceTimezone: userProcedure({
    input: reportDeviceTimezoneInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.account.reportDeviceTimezone(ctx.caller.userId, input.timezone);
  }),

  delete: userProcedure({
    input: deleteAccountInput,
    output: z.void(),
    admitsRestricted: true,
    rateLimit: { key: authentication, budget: authenticationBudget, subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.deletion.deleteAccount(ctx.caller.userId, input);
  }),
});
