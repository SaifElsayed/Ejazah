// T016 of specs/004-sessions (FR-445, FR-480, FR-495; R-TIME-6; research R-307): the administrator
// surface's `sessions` namespace (admin-surface.md, "`sessions`"), its outage windows here; the
// monitor, the review queue, the cancellation and the restore join it in their tasks. Thin
// (R-API-1): the input validated, one service call on the call's transaction, the call's one audit
// entry described, the output parsed by its schema. The actor is the session's administrator, never
// the input's. Mounted under `sessions` by `admin.router.ts`.
//
// `sessions.outages.record` audits `provider_outage.recorded` on the window recorded, with the
// mandatory reason; `sessions.outages.list` audits `provider_outages.listed` on the reader, a list
// having no single target, as `payments.listed` does.
//
// T023 (FR-460, FR-480; SC-413): `sessions.cancel` audits `session.cancelled` on the session, with
// the mandatory reason. T024 (FR-479, FR-480; R-SEC-6): `sessions.monitor.list` audits
// `sessions.monitor.listed` on the reader and declares Phase 1's `rate_limit_search`, the
// administrator as subject, checked before the transaction and failing closed (T062's kind; the
// owner's decision of 2026-11-06 on the fourth analysis, C2); `sessions.monitor.get` audits
// `sessions.monitor.viewed` on the enrollment. A refusal rolls the call back, its audit entry with it.
//
// T033 (FR-446, FR-450, FR-477, FR-480; R-SESS-6): `sessions.review.list` audits
// `sessions.review.listed` on the reader; `sessions.review.get` audits `sessions.review.viewed` on the
// session; `sessions.review.resolve` audits `session.review_resolved` on the session, with the
// mandatory reason. What each does is `review.service.ts`'.
//
// T059 (spec FR-439; FR-470, FR-480): `sessions.review.revise` declares its own limit,
// `rate_limit_outcome_correction`, the administrator as subject, checked before the transaction
// opens and apart from the key; keyed on the kind's transaction (`IdempotencyService.runOn`), it
// audits `session.outcome_corrected` on the session with the reason on its first run only, a
// replay recording none (`ctx.audit.replayed()`). What it does is `revision.service.ts`'.
//
// T061 (FR-454, FR-455, FR-470; L5): `sessions.restore` declares its own limit,
// `rate_limit_enrollment_restore`, the administrator as subject, checked before the transaction
// opens and apart from the key, and the kind's deadlock retry: the whole transaction, the key's claim
// and the audit entry with it, rerun once on a deadlock, a second answering `RESTORE_REFUSED`
// `time_taken` (T002's lines are the refusal's log, so the error is marked «logged»). Keyed on the
// kind's transaction (`runOn`), it audits `enrollment.restored` on the enrollment with the reason on
// its first run only. What it does is `restore.service.ts`'.
//
// T082 (FR-513; SRS FR-CANCEL-10, DEC-68): `sessions.endEnrollment` declares its own limit,
// `rate_limit_enrollment_end`, the administrator as subject, checked before the transaction opens and
// apart from the key; keyed on the kind's transaction (`runOn`), it audits `enrollment.ended_by_admin`
// on the enrollment on its first run only, with the reason both parties are shown as the entry's
// reason and the internal note and the slot's choice in `after` (the note is kept there only). What
// it does is `enrollment-end.service.ts`'.
import {
  outagesListInput,
  outagesListOutput,
  outagesRecordInput,
  outagesRecordOutput,
  sessionsCancelInput,
  sessionsCancelOutput,
  sessionsMonitorGetInput,
  sessionsMonitorGetOutput,
  sessionsMonitorListInput,
  sessionsMonitorListOutput,
  sessionsReviewGetInput,
  sessionsReviewGetOutput,
  sessionsReviewListInput,
  sessionsReviewListOutput,
  sessionsReviewResolveInput,
  sessionsReviewResolveOutput,
  sessionsReviewReviseInput,
  sessionsReviewReviseOutput,
  // T061.
  sessionsRestoreInput,
  sessionsRestoreOutput,
  // T082.
  sessionsEndEnrollmentInput,
  sessionsEndEnrollmentOutput,
} from '@ijazah/contracts/admin';

import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

const outagesRouter = createAdminRouter({
  record: adminProcedure({ input: outagesRecordInput, output: outagesRecordOutput }).mutation(
    async ({ ctx, input }) => {
      const recorded = await ctx.services.outages.record(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'provider_outage.recorded',
        targetType: 'provider_outage',
        targetId: recorded.outageId,
        reason: input.reason,
      });
      return recorded;
    },
  ),

  list: adminProcedure({ input: outagesListInput, output: outagesListOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({
        action: 'provider_outages.listed',
        targetType: 'admin',
        targetId: adminId,
      });
      return ctx.services.outages.list(ctx.tx, input);
    },
  ),
});

const monitorRouter = createAdminRouter({
  list: adminProcedure({
    input: sessionsMonitorListInput,
    output: sessionsMonitorListOutput,
    rateLimit: { key: 'rate_limit_search', subject: 'caller' },
  }).query(async ({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    const page = await ctx.services.monitor.list(ctx.tx, adminId, input);
    ctx.audit.record({
      action: 'sessions.monitor.listed',
      targetType: 'admin',
      targetId: adminId,
    });
    return page;
  }),

  get: adminProcedure({ input: sessionsMonitorGetInput, output: sessionsMonitorGetOutput }).query(
    async ({ ctx, input }) => {
      const answer = await ctx.services.monitor.get(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'sessions.monitor.viewed',
        targetType: 'enrollment',
        targetId: input.enrollmentId,
      });
      return answer;
    },
  ),
});

const reviewRouter = createAdminRouter({
  list: adminProcedure({ input: sessionsReviewListInput, output: sessionsReviewListOutput }).query(
    async ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      const page = await ctx.services.review.list(ctx.tx, adminId, input);
      ctx.audit.record({
        action: 'sessions.review.listed',
        targetType: 'admin',
        targetId: adminId,
      });
      return page;
    },
  ),

  get: adminProcedure({ input: sessionsReviewGetInput, output: sessionsReviewGetOutput }).query(
    async ({ ctx, input }) => {
      const answer = await ctx.services.review.get(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'sessions.review.viewed',
        targetType: 'session',
        targetId: input.sessionId,
      });
      return answer;
    },
  ),

  resolve: adminProcedure({
    input: sessionsReviewResolveInput,
    output: sessionsReviewResolveOutput,
  }).mutation(async ({ ctx, input }) => {
    const resolved = await ctx.services.review.resolve(ctx.tx, ctx.administrator.adminId, input);
    ctx.audit.record({
      action: 'session.review_resolved',
      targetType: 'session',
      targetId: resolved.sessionId,
      reason: input.reason,
    });
    return resolved;
  }),

  revise: adminProcedure({
    input: sessionsReviewReviseInput,
    output: sessionsReviewReviseOutput,
    rateLimit: { key: 'rate_limit_outcome_correction', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { outcome, replayed } = await ctx.services.review.revise(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
    } else {
      ctx.audit.record({
        action: 'session.outcome_corrected',
        targetType: 'session',
        targetId: outcome.sessionId,
        reason: input.reason,
      });
    }
    return outcome;
  }),
});

export const sessionsAdminRouter = createAdminRouter({
  outages: outagesRouter,
  monitor: monitorRouter,
  review: reviewRouter,
  cancel: adminProcedure({ input: sessionsCancelInput, output: sessionsCancelOutput }).mutation(
    async ({ ctx, input }) => {
      const cancelled = await ctx.services.sessionCancel.cancel(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'session.cancelled',
        targetType: 'session',
        targetId: cancelled.sessionId,
        reason: input.reason,
      });
      return cancelled;
    },
  ),

  // T061.
  restore: adminProcedure({
    input: sessionsRestoreInput,
    output: sessionsRestoreOutput,
    rateLimit: { key: 'rate_limit_enrollment_restore', subject: 'caller' },
    deadlock: {
      operation: 'sessions.restore',
      ids: (input) => ({ enrollmentId: input.enrollmentId }),
      refusal: () =>
        markRefusalLogged(
          new DomainError('RESTORE_REFUSED', undefined, {
            details: [{ path: 'cause', code: 'time_taken' }],
          }),
        ),
    },
  }).mutation(async ({ ctx, input }) => {
    const { answer, replayed } = await ctx.services.restore.restore(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'enrollment.restored',
      targetType: 'enrollment',
      targetId: input.enrollmentId,
      reason: input.reason,
    });
    return answer;
  }),
  // T082.
  endEnrollment: adminProcedure({
    input: sessionsEndEnrollmentInput,
    output: sessionsEndEnrollmentOutput,
    rateLimit: { key: 'rate_limit_enrollment_end', subject: 'caller' },
  }).mutation(async ({ ctx, input }) => {
    const { answer, replayed } = await ctx.services.enrollmentEnd.endEnrollment(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'enrollment.ended_by_admin',
      targetType: 'enrollment',
      targetId: input.enrollmentId,
      reason: input.partyReason,
      // 003:T112 (the owner's Q-D (a)): the end's cause beside the slot's choice.
      after: {
        status: 'cancelled',
        slot: input.slot,
        internalNote: input.internalNote || null,
        cause: input.cause,
      },
    });
    return answer;
  }),
});
