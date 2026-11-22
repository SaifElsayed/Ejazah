// T024 of specs/005-certification: the administrator surface's `settings` namespace
// (contracts/admin-surface.md, `settings.list` and `settings.update`; FR-624; SRS FR-ADMIN-9,
// §3.14, DEC-73; research R-410; the note under T024, Q-X1 (a)). Thin (R-API-1): the administrator
// kind refuses an anonymous caller and an unverified second factor, runs one transaction, writes
// the call's audit entry on it; one service call with the session's administrator; the output
// parsed by its schema. `list` runs under the signed-in default limit (admin-surface.md:
// «default»); `update` is counted under `rate_limit_settings_update` (10 per 60 s, DEC-73), the
// administrator as subject, before the transaction, keyed (`idempotencyKey`, `runOn` on the kind's
// transaction), and a replay records no second entry (`audit.replayed()`). Its refusals are the
// service's (`settingRefusal`, VALIDATION_FAILED, one code per reason).
//
// THE AUDIT. `settings.listed` on the reader (the other list reads' `admin` target);
// `setting.changed` on the key (`setting` + the key, a settings key being a target id, T172), with
// the reason and the value before and after (FR-624: «audited with the old and new values»).
// ⚠️ A change applies from the next read of the key, for every caller.
// 006:T002 (SRS DEC-110; the note under T002, Q-3 (a)(a)): turning `programme_enabled` on also
// records `packages.retired_by_switch` on the same key, with the count of old-style ijazah
// packages the turn-on deactivated (`after: { count }`). ⚠️ No way back: turning it off
// reactivates none.
// Mounted under `settings` by `admin.router.ts` (the integration's line).
import {
  adminSettingsListOutput,
  adminSettingsUpdateInput,
  adminSettingsUpdateOutput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

/** The limit of a settings change, per administrator (SRS §3.14, DEC-73). */
export const SETTINGS_UPDATE_LIMIT = {
  key: 'rate_limit_settings_update',
  subject: 'caller',
} as const;

export const settingsAdminRouter = createAdminRouter({
  list: adminProcedure({
    input: z.void(),
    output: adminSettingsListOutput,
  }).query(async ({ ctx }) => {
    const { adminId } = ctx.administrator;
    const listed = await ctx.services.settings.list(ctx.tx, adminId);
    ctx.audit.record({ action: 'settings.listed', targetType: 'admin', targetId: adminId });
    return listed;
  }),

  update: adminProcedure({
    input: adminSettingsUpdateInput,
    output: adminSettingsUpdateOutput,
    rateLimit: SETTINGS_UPDATE_LIMIT,
  }).mutation(async ({ ctx, input }) => {
    const change = await ctx.services.settings.update(ctx.tx, ctx.administrator.adminId, input);
    const { key, before, after, replayed } = change;
    // 006:T002: the count the service answers on a turn-on (`SettingChange.retiredPackages`),
    // read by its presence: `surfaces/context.ts`'s answer type does not name it yet.
    const retiredPackages =
      'retiredPackages' in change && typeof change.retiredPackages === 'number'
        ? change.retiredPackages
        : undefined;
    if (replayed) ctx.audit.replayed();
    else {
      ctx.audit.record({
        action: 'setting.changed',
        targetType: 'setting',
        targetId: key,
        reason: input.reason,
        before: { value: before },
        after: { value: after },
      });
      // 006:T002 (DEC-110, Q-3 (a)(a)): the switch's turn-on, its own entry with the count.
      if (retiredPackages !== undefined) {
        ctx.audit.record({
          action: 'packages.retired_by_switch',
          targetType: 'setting',
          targetId: key,
          reason: input.reason,
          after: { count: retiredPackages },
        });
      }
    }
    return { key, value: after };
  }),
});
