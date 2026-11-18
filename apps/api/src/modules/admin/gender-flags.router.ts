// T013 of specs/005-certification: the administrator surface's `genderFlags` namespace
// (contracts/admin-surface.md, `genderFlags.*`; FR-614, FR-615; SRS FR-GENDER-4, FR-ADMIN-8;
// research R-409; the note under T013, Q-G1 (a): this module's router serves all six). Thin
// (R-API-1): the administrator kind refuses an anonymous caller and an unverified second factor,
// runs one transaction, writes the call's audit entry on it and runs its after-commit list once it
// has committed; one service call with the session's administrator; the output parsed by its schema.
// Reads (`list`, `get`) run under the signed-in default limit (admin-surface.md: «default»); every
// mutation is counted under `rate_limit_gender_decision`, the administrator as subject, before the
// transaction, keyed (`idempotencyKey`, `runOn` on the kind's transaction), and a replay records no
// second entry (`audit.replayed()`).
//
// THE AUDIT. The target is a kind word and an id, never a name: `gender_flags.listed` on the reader
// (the other list reads' `admin` target); `gender_flag.viewed`, `gender_flag.raised` and
// `gender_flag.dismissed` (with the reason) on the flagged person (`user` + their id), the subject of
// the flag, as a standing action names its person; each of the three names the flag in
// `after: { flagId }` (the review's ruling 3(1)). No entry and no line carries a gender.
// Mounted under `genderFlags` by `admin.router.ts` (the integration's line).
import {
  adminGenderFlagsDismissInput,
  adminGenderFlagsGetInput,
  adminGenderFlagsGetOutput,
  adminGenderFlagsListInput,
  adminGenderFlagsListOutput,
  adminGenderFlagsRaiseInput,
  adminGenderFlagsRaiseOutput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

/** The limit of every flag decision, per administrator (SRS §3.14, DEC-73). */
export const GENDER_DECISION_LIMIT = {
  key: 'rate_limit_gender_decision',
  subject: 'caller',
} as const;

/** The flagged person, as an audit entry names them. */
const PERSON_TARGET = 'user';

export const genderFlagsAdminRouter = createAdminRouter({
  list: adminProcedure({
    input: adminGenderFlagsListInput,
    output: adminGenderFlagsListOutput,
  }).query(async ({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    const page = await ctx.services.genderFlags.list(ctx.tx, adminId, input);
    ctx.audit.record({ action: 'gender_flags.listed', targetType: 'admin', targetId: adminId });
    return page;
  }),

  get: adminProcedure({
    input: adminGenderFlagsGetInput,
    output: adminGenderFlagsGetOutput,
  }).query(async ({ ctx, input }) => {
    const detail = await ctx.services.genderFlags.get(ctx.tx, ctx.administrator.adminId, input);
    ctx.audit.record({
      action: 'gender_flag.viewed',
      targetType: PERSON_TARGET,
      targetId: detail.flaggedUserId,
      after: { flagId: detail.flagId },
    });
    return detail;
  }),

  raise: adminProcedure({
    input: adminGenderFlagsRaiseInput,
    output: adminGenderFlagsRaiseOutput,
    rateLimit: GENDER_DECISION_LIMIT,
  }).mutation(async ({ ctx, input }) => {
    const { flagId, replayed } = await ctx.services.genderFlags.raise(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) ctx.audit.replayed();
    else {
      ctx.audit.record({
        action: 'gender_flag.raised',
        targetType: PERSON_TARGET,
        targetId: input.targetUserId,
        reason: input.reason,
        after: { flagId },
      });
    }
    return { flagId };
  }),

  dismiss: adminProcedure({
    input: adminGenderFlagsDismissInput,
    output: z.void(),
    rateLimit: GENDER_DECISION_LIMIT,
  }).mutation(async ({ ctx, input }) => {
    const { flaggedUserId, replayed } = await ctx.services.genderFlags.dismiss(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return;
    }
    ctx.audit.record({
      action: 'gender_flag.dismissed',
      targetType: PERSON_TARGET,
      targetId: flaggedUserId,
      reason: input.reason,
      after: { flagId: input.flagId },
    });
  }),
});
