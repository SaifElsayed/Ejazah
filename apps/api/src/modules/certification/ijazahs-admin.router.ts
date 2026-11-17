// T010 of specs/005-certification: the administrator surface's `ijazahs` namespace
// (contracts/admin-surface.md, `ijazahs.*`; FR-609, FR-610; research R-412). Thin (R-API-1): the
// administrator kind refuses an anonymous caller and an unverified second factor, runs one
// transaction, writes the call's audit entry on it and runs its after-commit list once it has
// committed; one service call with the session's administrator; the output parsed by its schema,
// which strips the PDF's key and the token's hash (R-SEC-3, R-DB-7). `revoke`, `bar` and `liftBar`
// are keyed (`idempotencyKey`, `runOn` on the kind's transaction) and counted under
// `rate_limit_ijazah_decision`, the administrator as subject, checked before the transaction; a
// replay records no second entry (`audit.replayed()`). The audit target is a kind word and an id,
// never a name (admin-surface.md): an ijazah by its certificate number (`IJAZAH_TARGET`, T007's
// kind), a bar on the `user` it names. `get` gives a signed link to the PDF, so every call is an
// opening of it and records `ijazah.viewed`. Mounted under `ijazahs` by `admin.router.ts` (the
// integration's line).
import {
  adminIjazahBarInput,
  adminIjazahsGetInput,
  adminIjazahsGetOutput,
  adminIjazahsListInput,
  adminIjazahsListOutput,
  adminIjazahsRevokeInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';
import { IJAZAH_TARGET } from './ijazah-requests-admin.router.js';

const DECISION_LIMIT = { key: 'rate_limit_ijazah_decision', subject: 'caller' } as const;

export const ijazahsAdminRouter = createAdminRouter({
  list: adminProcedure({
    input: adminIjazahsListInput,
    output: adminIjazahsListOutput,
  }).query(async ({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    const page = await ctx.services.ijazahs.list(ctx.tx, adminId, input);
    ctx.audit.record({ action: 'ijazahs.listed', targetType: 'admin', targetId: adminId });
    return page;
  }),

  get: adminProcedure({
    input: adminIjazahsGetInput,
    output: adminIjazahsGetOutput,
  }).query(async ({ ctx, input }) => {
    const detail = await ctx.services.ijazahs.get(ctx.tx, ctx.administrator.adminId, input);
    ctx.audit.record({
      action: 'ijazah.viewed',
      targetType: IJAZAH_TARGET,
      targetId: detail.certificateNumber,
    });
    return detail;
  }),

  revoke: adminProcedure({
    input: adminIjazahsRevokeInput,
    output: z.void(),
    rateLimit: DECISION_LIMIT,
  }).mutation(async ({ ctx, input }) => {
    const { certificateNumber, replayed } = await ctx.services.ijazahs.revoke(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return;
    }
    ctx.audit.record({
      action: 'ijazah.revoked',
      targetType: IJAZAH_TARGET,
      targetId: certificateNumber,
      reason: input.reason,
    });
  }),

  bar: adminProcedure({
    input: adminIjazahBarInput,
    output: z.void(),
    rateLimit: DECISION_LIMIT,
  }).mutation(async ({ ctx, input }) => {
    const { replayed } = await ctx.services.ijazahs.bar(ctx.tx, ctx.administrator.adminId, input);
    if (replayed) {
      ctx.audit.replayed();
      return;
    }
    ctx.audit.record({
      action: 'ijazah_bar.set',
      targetType: 'user',
      targetId: input.targetUserId,
      reason: input.reason,
    });
  }),

  liftBar: adminProcedure({
    input: adminIjazahBarInput,
    output: z.void(),
    rateLimit: DECISION_LIMIT,
  }).mutation(async ({ ctx, input }) => {
    const { replayed } = await ctx.services.ijazahs.liftBar(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return;
    }
    ctx.audit.record({
      action: 'ijazah_bar.lifted',
      targetType: 'user',
      targetId: input.targetUserId,
      reason: input.reason,
    });
  }),
});
