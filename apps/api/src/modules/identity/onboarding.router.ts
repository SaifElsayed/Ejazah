// T048: the `onboarding` namespace (app-surface.md "`onboarding` — the first sign-in" and
// "Rate-limit subjects"; FR-124 to FR-127). Thin: the input validated, the declared rate limit, one
// service call, the output parsed by its schema (R-API-1). Mounted under `onboarding` by
// `app.router.ts`.
//
// `complete` counts the SHA-256 of the onboarding token (no parse in `subjectOf`), is not keyed
// through the idempotency table (its output carries tokens; the `jti` mark is its single use), and
// writes the account in the request's language, which for an anonymous caller is the default; the
// phone sets the language the person chose on Welcome once it has landed (`account.setLanguage`).
import {
  onboardingCompleteInput,
  onboardingCompleteOutput,
  requestEmailCodeInput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { hashLookupToken } from '../../platform/crypto/hashing.js';
import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, publicProcedure } from '../../surfaces/procedures.js';
import { normalizeEmail } from './one-time-codes.js';

const { authentication, oneTimeCode, oneTimeCodeBudget, addressOneTimeCode } = defaultRateLimits;

export const onboardingRouter = createAppRouter({
  // T172 (DEC-103): the client address first, so one address cannot spend the code budget.
  requestEmailCode: publicProcedure({
    input: requestEmailCodeInput,
    output: z.void(),
    rateLimit: {
      key: oneTimeCode,
      budget: oneTimeCodeBudget,
      addressKey: addressOneTimeCode,
      subjectOf: ({ input }) => normalizeEmail(input.email),
    },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.onboarding.requestEmailCode(input.onboardingToken, input.email);
  }),

  complete: publicProcedure({
    input: onboardingCompleteInput,
    output: onboardingCompleteOutput,
    rateLimit: {
      key: authentication,
      subjectOf: ({ input }) => hashLookupToken(input.onboardingToken),
    },
  }).mutation(({ ctx, input }) =>
    // R3 T189: the request's log, for a minor's refusal without the guardian's tick.
    ctx.services.identity.onboarding.complete(input, ctx.locale, ctx.log),
  ),
});
