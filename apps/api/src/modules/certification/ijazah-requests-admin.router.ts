// T007 of specs/005-certification: the administrator surface's `ijazahRequests` namespace
// (contracts/admin-surface.md, `ijazahRequests.*`; FR-604, FR-605, FR-628; research R-402). Thin
// (R-API-1): the administrator kind refuses an anonymous caller and an unverified second factor,
// runs one transaction, writes the call's audit entry on it and runs its after-commit list once it
// has committed; one service call with the session's administrator; the output parsed by its schema,
// which strips the copy's key (R-SEC-3). `approve` and `reject` are keyed (`idempotencyKey`, `runOn`
// on the kind's transaction) and counted under `rate_limit_ijazah_decision`, the administrator as
// subject, checked before the transaction; a replay records no second entry (`audit.replayed()`).
// The audit target is a kind word and an id, never a name (admin-surface.md); `ijazah.issued`
// names the ijazah by its public number (docs/ERD.md:806's label). `get` is the admin module's
// composition, the standing's reason read from its audit log (Q10 (a)). Mounted under
// `ijazahRequests` by `admin.router.ts` (the integration's line).
import {
  adminIjazahRequestsApproveInput,
  adminIjazahRequestsApproveOutput,
  adminIjazahRequestsGetInput,
  adminIjazahRequestsGetOutput,
  adminIjazahRequestsListInput,
  adminIjazahRequestsListOutput,
  adminIjazahRequestsRejectInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

/**
 * The audit targets of the review's entries (Q-C3, waiting for the owner): a request by its id, an
 * ijazah by its certificate number. Named once, so the answer changes these two lines only.
 */
export const IJAZAH_REQUEST_TARGET = 'ijazah_request';
export const IJAZAH_TARGET = 'ijazah';

export const ijazahRequestsAdminRouter = createAdminRouter({
  list: adminProcedure({
    input: adminIjazahRequestsListInput,
    output: adminIjazahRequestsListOutput,
  }).query(async ({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    const page = await ctx.services.ijazahRequests.list(ctx.tx, adminId, input);
    ctx.audit.record({ action: 'ijazah_requests.listed', targetType: 'admin', targetId: adminId });
    return page;
  }),

  get: adminProcedure({
    input: adminIjazahRequestsGetInput,
    output: adminIjazahRequestsGetOutput,
  }).query(async ({ ctx, input }) => {
    const detail = await ctx.services.ijazahRequests.get(ctx.tx, ctx.administrator.adminId, input);
    ctx.audit.record({
      action: 'ijazah_request.viewed',
      targetType: IJAZAH_REQUEST_TARGET,
      targetId: input.requestId,
    });
    return detail;
  }),

  approve: adminProcedure({
    input: adminIjazahRequestsApproveInput,
    output: adminIjazahRequestsApproveOutput,
    rateLimit: { key: 'rate_limit_ijazah_decision', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { answer, replayed } = await ctx.services.ijazahRequests.approve(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'ijazah.issued',
      targetType: IJAZAH_TARGET,
      targetId: answer.certificateNumber,
    });
    return answer;
  }),

  reject: adminProcedure({
    input: adminIjazahRequestsRejectInput,
    output: z.void(),
    rateLimit: { key: 'rate_limit_ijazah_decision', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { replayed } = await ctx.services.ijazahRequests.reject(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return;
    }
    ctx.audit.record({
      action: 'ijazah_request.rejected',
      targetType: IJAZAH_REQUEST_TARGET,
      targetId: input.requestId,
      reason: input.reason,
    });
  }),
});
