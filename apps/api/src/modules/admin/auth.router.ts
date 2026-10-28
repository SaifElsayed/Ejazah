// T067: the administrator surface's `auth` namespace (admin-surface.md "`auth` — sign-in and the
// second factor" and "Rate-limit subjects"; FR-170 to FR-172). Thin: the input validated, the
// declared rate limit, one service call, the output parsed by its schema (R-API-1). Mounted under
// `auth` by `admin.router.ts`.
//
// The six sign-in procedures are the surface's only anonymous ones. Each counts the subject the
// contract names under `rate_limit_authentication`: the address in lower case after the budget for
// a password, the SHA-256 of the session token for the second factor, of the invite token for the
// password-set link. The throttle runs before the handler, so a refused attempt never reaches the
// password and never counts toward the lockout (FR-172). `signOut` and `me` are the administrator
// kind's, audited like any call: the sign-out under `admin.sign_out`, `me` as a read (`auth.read`)
// naming the reader, which no audit list shows (owner's decision 2026-10-21).
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
import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import {
  adminProcedure,
  adminPublicProcedure,
  createAdminRouter,
} from '../../surfaces/procedures.js';
import { normalizeAdminEmail } from './admin-auth.service.js';

const { authentication, authenticationBudget } = defaultRateLimits;

/** The subject of the second factor's limit: the session token's hash, never the token. */
const bySessionToken = ({ input }: { readonly input: { readonly sessionToken: string } }) =>
  hashLookupToken(input.sessionToken);

const setup = createAdminRouter({
  begin: adminPublicProcedure({
    input: adminMfaSetupBeginInput,
    output: adminMfaSetupBeginOutput,
    rateLimit: { key: authentication, subjectOf: bySessionToken },
  }).mutation(({ ctx, input }) => ctx.services.auth.beginSetup(input.sessionToken)),

  confirm: adminPublicProcedure({
    input: adminMfaSetupConfirmInput,
    output: adminRecoveryCodesOutput,
    rateLimit: { key: authentication, subjectOf: bySessionToken },
  }).mutation(({ ctx, input }) => ctx.services.auth.confirmSetup(input.sessionToken, input.code)),
});

const mfa = createAdminRouter({
  verify: adminPublicProcedure({
    input: adminMfaVerifyInput,
    output: z.void(),
    rateLimit: { key: authentication, subjectOf: bySessionToken },
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.auth.verifyMfa(input.sessionToken, input.code);
  }),

  recover: adminPublicProcedure({
    input: adminMfaRecoverInput,
    output: adminMfaRecoverOutput,
    rateLimit: { key: authentication, subjectOf: bySessionToken },
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
      key: authentication,
      budget: authenticationBudget,
      subjectOf: ({ input }) => normalizeAdminEmail(input.email),
    },
  }).mutation(({ ctx, input }) => ctx.services.auth.signIn(input.email, input.password)),

  mfa,

  setPassword: adminPublicProcedure({
    input: adminSetPasswordInput,
    output: z.void(),
    rateLimit: {
      key: authentication,
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
