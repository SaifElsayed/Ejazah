// T067: the administrator surface's `admins` namespace (admin-surface.md "`admins` — the admins page";
// FR-173, FR-174). Thin: the input validated, one service call on the call's transaction, the
// action's audit entry described, the output parsed by its schema (R-API-1). The actor is the
// session's administrator, never the input's. A destructive action's reason, mandatory in the
// schema (screens.md §24), goes into its entry as typed; the list is a read (`admins.read`) naming
// the reader, which no audit list shows (owner's decision 2026-10-21). Mounted under `admins` by
// `admin.router.ts`.
import {
  adminEmptyInput,
  adminRecoveryCodesOutput,
  adminRegenerateRecoveryCodesInput,
  adminsAddInput,
  adminsAddOutput,
  adminsDisableInput,
  adminsListInput,
  adminsListOutput,
  adminsResetMfaInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const adminsRouter = createAdminRouter({
  list: adminProcedure({ input: adminsListInput, output: adminsListOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({ action: 'admins.read', targetType: 'admin', targetId: adminId });
      return ctx.services.admins.list(ctx.tx, adminId, input);
    },
  ),

  add: adminProcedure({ input: adminsAddInput, output: adminsAddOutput }).mutation(
    async ({ ctx, input }) => {
      const added = await ctx.services.admins.add(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({ action: 'admin.add', targetType: 'admin', targetId: added.adminId });
      return added;
    },
  ),

  disable: adminProcedure({ input: adminsDisableInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.admins.disable(ctx.tx, ctx.administrator.adminId, input.adminId);
      ctx.audit.record({
        action: 'admin.disable',
        targetType: 'admin',
        targetId: input.adminId,
        reason: input.reason,
        before: { isActive: true },
        after: { isActive: false },
      });
    },
  ),

  resetMfa: adminProcedure({ input: adminsResetMfaInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.admins.resetMfa(ctx.tx, ctx.administrator.adminId, input.adminId);
      ctx.audit.record({
        action: 'admin.reset_mfa',
        targetType: 'admin',
        targetId: input.adminId,
        reason: input.reason,
      });
    },
  ),

  /**
   * Deprecated by T096: new codes ask a current code of one's second factor, which this procedure's
   * input has no room for, and its contract stays as published (R-API-9: additive only). It refuses
   * every call, as a wrong code is refused, and writes nothing; `recoveryCodes.regenerate` replaces
   * it. Removed once no client can call it (the panel never shipped a caller). Its void input became
   * the empty object in T099, by the owner's one-time exception, since a mutation sent without a
   * body never reached it over HTTP.
   */
  regenerateRecoveryCodes: adminProcedure({
    input: adminEmptyInput,
    output: adminRecoveryCodesOutput,
  }).mutation((): never => {
    throw new DomainError('CODE_INVALID');
  }),

  recoveryCodes: createAdminRouter({
    /** `admins.recoveryCodes.regenerate` (T096): the caller's new set for a current code. */
    regenerate: adminProcedure({
      input: adminRegenerateRecoveryCodesInput,
      output: adminRecoveryCodesOutput,
    }).mutation(async ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      const codes = await ctx.services.admins.regenerateRecoveryCodes(ctx.tx, adminId, input.code);
      ctx.audit.record({
        action: 'admin.regenerate_recovery_codes',
        targetType: 'admin',
        targetId: adminId,
      });
      return codes;
    }),
  }),
});
