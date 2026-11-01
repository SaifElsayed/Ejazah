// T067: the administrator surface's `auth` namespace (admin-surface.md "`auth` — sign-in and the
// second factor" and "Rate-limit subjects"; FR-170 to FR-172). Thin: the input validated, the
// declared rate limit, one service call, the output parsed by its schema (R-API-1). Mounted under
// `auth` by `admin.router.ts`.
//
// The six sign-in procedures are the surface's only anonymous ones. Each counts the subject the
// contract names under `rate_limit_admin_authentication`: the address in lower case after the
// surface's own budget for a password, the SHA-256 of the session token for the second factor, of
// the invite token for the password-set link. Both keys are the surface's own, never the app's
// (T133): a flood of the app's sign-in, spread over many addresses or aimed at an administrator's,
// spends nothing an administrator's sign-in counts. The throttle runs before the handler, so a
// refused attempt never reaches the password and never counts toward the lockout (FR-172).
// `signOut` and `me` are the administrator kind's, audited like any call: the sign-out under
// `admin.sign_out`, `me` as a read (`auth.read`) naming the reader, which no audit list shows
// (owner's decision 2026-10-21).
import {
  adminEmptyInput,
  adminMeOutput,
  adminMfaRecoverInput,
  adminMfaRecoverOutput,
  adminMfaSetupBeginInput,
  adminMfaSetupBeginOutput,
  adminMfaSetupConfirmInput,
  adminMfaVerifyInput,
  adminRecoveryCodesOutput,
  adminSetPasswordInput,
  adminSignInInput,
  adminSignInOutput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { hashLookupToken } from '../../platform/crypto/hashing.js';
import type { RateLimitKey } from '../../platform/guards/rate-limit.guard.js';
import {
  adminProcedure,
  adminPublicProcedure,
  createAdminRouter,
} from '../../surfaces/procedures.js';
import { normalizeAdminEmail } from './admin-auth.service.js';

/** The surface's own per-subject limit for its six sign-in procedures (T133), a seeded setting. */
export const ADMIN_AUTHENTICATION_RATE_LIMIT =
  'rate_limit_admin_authentication' satisfies RateLimitKey;

/** `auth.signIn`'s platform-wide budget, the surface's own (T133), a seeded setting. */
export const ADMIN_AUTHENTICATION_BUDGET =
  'rate_limit_admin_authentication_budget' satisfies RateLimitKey;

/** The subject of the second factor's limit: the session token's hash, never the token. */
const bySessionToken = ({ input }: { readonly input: { readonly sessionToken: string } }) =>
  hashLookupToken(input.sessionToken);

const setup = createAdminRouter({
  begin: adminPublicProcedure({
    input: adminMfaSetupBeginInput,
    output: adminMfaSetupBeginOutput,
    rateLimit: { key: ADMIN_AUTHENTICATION_RATE_LIMIT, subjectOf: bySessionToken },
  }).mutation(({ ctx, input }) => ctx.services.auth.beginSetup(input.sessionToken)),

  confirm: adminPublicProcedure({
    input: adminMfaSetupConfirmInput,
    output: adminRecoveryCodesOutput,
    rateLimit: { key: ADMIN_AUTHENTICATION_RATE_LIMIT, subjectOf: bySessionToken },
  }).mutation(({ ctx, input }) => ctx.services.auth.confirmSetup(input.sessionToken, input.code)),
});

const mfa = createAdminRouter({
  verify: adminPublicProcedure({
    input: adminMfaVerifyInput,
    output: z.void(),
    rateLimit: { key: ADMIN_AUTHENTICATION_RATE_LIMIT, subjectOf: bySessionToken },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.auth.verifyMfa(input.sessionToken, input.code);
  }),

  recover: adminPublicProcedure({
    input: adminMfaRecoverInput,
    output: adminMfaRecoverOutput,
    rateLimit: { key: ADMIN_AUTHENTICATION_RATE_LIMIT, subjectOf: bySessionToken },
  }).mutation(({ ctx, input }) =>
    ctx.services.auth.recover(input.sessionToken, input.recoveryCode),
  ),

  setup,
});

export const authRouter = createAdminRouter({
  signIn: adminPublicProcedure({
    input: adminSignInInput,
    output: adminSignInOutput,
    rateLimit: {
      key: ADMIN_AUTHENTICATION_RATE_LIMIT,
      budget: ADMIN_AUTHENTICATION_BUDGET,
      subjectOf: ({ input }) => normalizeAdminEmail(input.email),
    },
  }).mutation(({ ctx, input }) => ctx.services.auth.signIn(input.email, input.password)),

  mfa,

  setPassword: adminPublicProcedure({
    input: adminSetPasswordInput,
    output: z.void(),
    rateLimit: {
      key: ADMIN_AUTHENTICATION_RATE_LIMIT,
      subjectOf: ({ input }) => hashLookupToken(input.inviteToken),
    },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.auth.setPassword(input.inviteToken, input.password);
  }),

  signOut: adminProcedure({ input: adminEmptyInput, output: z.void() }).mutation(
    async ({ ctx }) => {
      const { adminId, sessionId } = ctx.administrator;
      await ctx.services.sessions.signOut(sessionId, ctx.tx);
      ctx.audit.record({ action: 'admin.sign_out', targetType: 'admin', targetId: adminId });
    },
  ),

  me: adminProcedure({ input: z.void(), output: adminMeOutput }).query(({ ctx }) => {
    const { adminId } = ctx.administrator;
    ctx.audit.record({ action: 'auth.read', targetType: 'admin', targetId: adminId });
    return ctx.services.admins.me(ctx.tx, adminId);
  }),
});
