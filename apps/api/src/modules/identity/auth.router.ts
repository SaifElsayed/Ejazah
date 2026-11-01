// T048: the `auth` namespace (app-surface.md "`auth` — sign-in" and "Rate-limit subjects";
// FR-120 to FR-123, FR-129, FR-135). Thin: the input validated, the declared rate limit, one
// service call, the output parsed by its schema (R-API-1). Mounted under `auth` by `app.router.ts`.
//
// Each public procedure counts the subject the contract names, after its budget where it has one:
// the client address for a nonce (nothing else is known yet), the nonce for a provider sign-in (one
// per mint, so `providerNonce`'s limit bounds it), the address in lower case for a code or a
// password, and the SHA-256 of a refresh token, never the client address, so one carrier's NAT
// does not throttle everyone behind it. A procedure whose output carries a token is never keyed
// through the idempotency table (app-surface.md: the table stores the outcome in plain JSON).
import {
  emailSignInInput,
  emptyInput,
  providerNonceOutput,
  refreshInput,
  refreshOutput,
  requestPasswordResetInput,
  requestSignUpCodeInput,
  resetPasswordInput,
  sessionOutput,
  signInWithProviderInput,
  signInWithProviderOutput,
  verifySignUpCodeInput,
  verifySignUpCodeOutput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { hashLookupToken } from '../../platform/crypto/hashing.js';
import { defaultRateLimits, type RateLimitKey } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, publicProcedure, userProcedure } from '../../surfaces/procedures.js';
import { normalizeEmail } from './one-time-codes.js';

/** `auth.providerNonce`'s own limit (app-surface.md), a seeded setting. */
export const PROVIDER_NONCE_RATE_LIMIT = 'rate_limit_provider_nonce' satisfies RateLimitKey;

/**
 * `auth.providerNonce`'s own platform-wide budget (T133), a seeded setting: a mint flood spread
 * over many addresses stops here and spends nothing of the sign-in's budget.
 */
export const PROVIDER_NONCE_BUDGET = 'rate_limit_provider_nonce_budget' satisfies RateLimitKey;

/** `auth.refresh`'s own limit (research R-101), a seeded setting. */
export const TOKEN_REFRESH_RATE_LIMIT = 'rate_limit_token_refresh' satisfies RateLimitKey;

const { authentication, authenticationBudget, oneTimeCode, oneTimeCodeBudget } = defaultRateLimits;

/** The subject of an address-keyed limit: the address as it is stored and compared. */
const byAddress = ({ input }: { readonly input: { readonly email: string } }) =>
  normalizeEmail(input.email);

const email = createAppRouter({
  requestSignUpCode: publicProcedure({
    input: requestSignUpCodeInput,
    output: z.void(),
    rateLimit: { key: oneTimeCode, budget: oneTimeCodeBudget, subjectOf: byAddress },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.emailAuth.requestSignUpCode(input.email);
  }),

  verifySignUpCode: publicProcedure({
    input: verifySignUpCodeInput,
    output: verifySignUpCodeOutput,
    rateLimit: { key: oneTimeCode, subjectOf: byAddress },
  }).mutation(({ ctx, input }) =>
    ctx.services.identity.emailAuth.verifySignUpCode(input.email, input.code),
  ),

  signIn: publicProcedure({
    input: emailSignInInput,
    output: sessionOutput,
    rateLimit: { key: authentication, budget: authenticationBudget, subjectOf: byAddress },
  }).mutation(({ ctx, input }) =>
    ctx.services.identity.emailAuth.signIn(input.email, input.password),
  ),

  requestPasswordReset: publicProcedure({
    input: requestPasswordResetInput,
    output: z.void(),
    rateLimit: { key: oneTimeCode, budget: oneTimeCodeBudget, subjectOf: byAddress },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.identity.emailAuth.requestPasswordReset(input.email);
  }),

  resetPassword: publicProcedure({
    input: resetPasswordInput,
    output: sessionOutput,
    rateLimit: { key: authentication, budget: authenticationBudget, subjectOf: byAddress },
  }).mutation(({ ctx, input }) =>
    ctx.services.identity.emailAuth.resetPassword(input.email, input.code, input.newPassword),
  ),
});

export const authRouter = createAppRouter({
  providerNonce: publicProcedure({
    input: emptyInput,
    output: providerNonceOutput,
    rateLimit: {
      key: PROVIDER_NONCE_RATE_LIMIT,
      budget: PROVIDER_NONCE_BUDGET,
      subjectOf: ({ ctx }) => ctx.clientAddress,
    },
  }).mutation(({ ctx }) => ctx.services.identity.signIn.providerNonce()),

  signInWithProvider: publicProcedure({
    input: signInWithProviderInput,
    output: signInWithProviderOutput,
    rateLimit: {
      key: authentication,
      budget: authenticationBudget,
      subjectOf: ({ input }) => input.nonce,
    },
  }).mutation(({ ctx, input }) => ctx.services.identity.signIn.signInWithProvider(input)),

  email,

  refresh: publicProcedure({
    input: refreshInput,
    output: refreshOutput,
    rateLimit: {
      key: TOKEN_REFRESH_RATE_LIMIT,
      subjectOf: ({ input }) => hashLookupToken(input.refreshToken),
    },
  }).mutation(({ ctx, input }) => ctx.services.identity.sessions.refresh(input.refreshToken)),

  // A restricted account signs out like any other (FR-137).
  signOut: userProcedure({ input: emptyInput, output: z.void(), admitsRestricted: true }).mutation(
    async ({ ctx }) => {
      await ctx.services.identity.sessions.signOut(ctx.caller.sessionId);
    },
  ),
});
