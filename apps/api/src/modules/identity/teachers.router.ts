// T068: the administrator surface's `teachers` namespace (admin-surface.md "`teachers` — an approved
// teacher's standing"; FR-165, FR-142). Thin (R-API-1); the actor is the session's administrator.
// Each action's entry is on the person (`user`) with its mandatory reason, and the standing it moved
// from and to as the standing answers them (`before` and `after`, T116).
// Mounted under `teachers` by `admin.router.ts`.
//
// T072 of specs/004-sessions (FR-502; SRS FR-ADMIN-5 as amended; admin-surface.md, the lifts'
// rows): a lift keyed through the standing's `keyedLift` (the kernel's `runOn` on the kind's
// transaction, the scope its path), its own limit `rate_limit_ban_lift` checked before the
// transaction opens, and the kind's deadlock declaration as `sessions.restore`'s (the account it
// names the only id of its lines; a second deadlock `CONFLICT` `restore_failed`). Audited on the
// person on its first run only, with the reason, the standing before and after, and each
// enrollment's result; a replay records none (`ctx.audit.replayed()`).
//
// T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077, Q-R3 (a)):
// `teachers.keptData.*`, an administrator's control of a deleted teacher's kept data, served by
// verification's kept-data service (composed into the surface's `teachers` by the admin module).
// Each declares its own limit (T069's keys), the administrator as subject, checked before the
// transaction opens. `documentLink` is audited `kept_document.view` on the document with the reason
// (and the teacher in `after`); `setEraseDate` `teacher.kept_data.erase_date_set` (a date set or
// changed) or `.erase_date_cleared` on the person, the date before and after; `eraseNow` ⚠️ final
// `teacher.kept_data.erased` on the person, what it erased in `after` (a count and whether a payout
// reference went, never a value). The two writes are keyed through `runOn`; a replay records none.
//
// 005:T031 of specs/005-certification (FR-631; R-411; the note under T031, Q-D2 (a)):
// `teachers.keptData.signatureLink` opens a deleted teacher's kept signature by one signed link per
// press, under `rate_limit_kept_document_link` (the documents' limit, the administrator as subject),
// audited `kept_signature.view` on the person with the reason: a signature is no document, so the
// entry's target is the user, as the kept data's other entries are.
import {
  banLiftOutput,
  teachersActionInput,
  teachersKeptDocumentLinkInput,
  teachersKeptDocumentLinkOutput,
  teachersKeptEraseDateInput,
  teachersKeptEraseNowInput,
  teachersKeptSignatureLinkInput,
  teachersKeptSignatureLinkOutput,
  teachersLiftInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

/** T072: a second deadlock's refusal, the lift's own (`banLiftRefusalCause`). */
const restoreFailed = () =>
  markRefusalLogged(
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'restore_failed' }],
    }),
  );

export const teachersRouter = createAdminRouter({
  suspend: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.suspend(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'teacher.suspend',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  revokeApproval: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.revokeApproval(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
        input.reason,
      );
      ctx.audit.record({
        action: 'teacher.revoke',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  ban: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.ban(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'teacher.ban',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  reinstate: adminProcedure({ input: teachersActionInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.teachers.reinstate(
        ctx.tx,
        ctx.administrator.adminId,
        input.teacherUserId,
      );
      ctx.audit.record({
        action: 'teacher.reinstate',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),

  // T072: a teacher's or an applicant's ban lifted (`ban` serves both), and a revocation.
  liftBan: adminProcedure({
    input: teachersLiftInput,
    output: banLiftOutput,
    rateLimit: { key: 'rate_limit_ban_lift', subject: 'caller' },
    deadlock: {
      operation: 'teachers.liftBan',
      ids: (input) => ({ userId: input.teacherUserId }),
      refusal: restoreFailed,
    },
  }).mutation(async ({ ctx, input }) => {
    const { move, replayed } = await ctx.services.teachers.keyedLift(
      ctx.tx,
      ctx.administrator.adminId,
      {
        scope: 'teachers.liftBan',
        userId: input.teacherUserId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    );
    // Each result as a plain object, a cause only where there is one (the audit's JSON).
    const answer = {
      enrollments: move.enrollments.map(({ enrollmentId, restored, cause }) =>
        cause === undefined ? { enrollmentId, restored } : { enrollmentId, restored, cause },
      ),
    };
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'teacher.ban_lifted',
      targetType: 'user',
      targetId: input.teacherUserId,
      reason: input.reason,
      before: move.before,
      after: { ...move.after, enrollments: answer.enrollments },
    });
    return answer;
  }),

  liftRevocation: adminProcedure({
    input: teachersLiftInput,
    output: banLiftOutput,
    rateLimit: { key: 'rate_limit_ban_lift', subject: 'caller' },
    deadlock: {
      operation: 'teachers.liftRevocation',
      ids: (input) => ({ userId: input.teacherUserId }),
      refusal: restoreFailed,
    },
  }).mutation(async ({ ctx, input }) => {
    const { move, replayed } = await ctx.services.teachers.keyedLift(
      ctx.tx,
      ctx.administrator.adminId,
      {
        scope: 'teachers.liftRevocation',
        userId: input.teacherUserId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    );
    // Each result as a plain object, a cause only where there is one (the audit's JSON).
    const answer = {
      enrollments: move.enrollments.map(({ enrollmentId, restored, cause }) =>
        cause === undefined ? { enrollmentId, restored } : { enrollmentId, restored, cause },
      ),
    };
    if (replayed) {
      ctx.audit.replayed();
      return answer;
    }
    ctx.audit.record({
      action: 'teacher.revocation_lifted',
      targetType: 'user',
      targetId: input.teacherUserId,
      reason: input.reason,
      before: move.before,
      after: { ...move.after, enrollments: answer.enrollments },
    });
    return answer;
  }),

  // T077 of specs/004-sessions (this file's head).
  keptData: createAdminRouter({
    documentLink: adminProcedure({
      input: teachersKeptDocumentLinkInput,
      output: teachersKeptDocumentLinkOutput,
      rateLimit: { key: 'rate_limit_kept_document_link', subject: 'caller' },
    }).mutation(async ({ ctx, input }) => {
      const link = await ctx.services.teachers.keptData.documentLink(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'kept_document.view',
        targetType: 'document',
        targetId: input.documentId,
        reason: input.reason,
        after: { teacherUserId: input.teacherUserId },
      });
      return link;
    }),

    setEraseDate: adminProcedure({
      input: teachersKeptEraseDateInput,
      output: z.void(),
      rateLimit: { key: 'rate_limit_kept_data_erase_date', subject: 'caller' },
    }).mutation(async ({ ctx, input }) => {
      const { before, after, replayed } = await ctx.services.teachers.keptData.setEraseDate(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      if (replayed) {
        ctx.audit.replayed();
        return;
      }
      ctx.audit.record({
        action:
          input.eraseAt === null
            ? 'teacher.kept_data.erase_date_cleared'
            : 'teacher.kept_data.erase_date_set',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        before: { eraseAt: before },
        after: { eraseAt: after },
      });
    }),

    eraseNow: adminProcedure({
      input: teachersKeptEraseNowInput,
      output: z.void(),
      rateLimit: { key: 'rate_limit_kept_data_erase_now', subject: 'caller' },
    }).mutation(async ({ ctx, input }) => {
      const { documents, payout, replayed } = await ctx.services.teachers.keptData.eraseNow(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      if (replayed) {
        ctx.audit.replayed();
        return;
      }
      ctx.audit.record({
        action: 'teacher.kept_data.erased',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
        after: { documents, payout },
      });
    }),

    // 005:T031 (this file's head).
    signatureLink: adminProcedure({
      input: teachersKeptSignatureLinkInput,
      output: teachersKeptSignatureLinkOutput,
      rateLimit: { key: 'rate_limit_kept_document_link', subject: 'caller' },
    }).mutation(async ({ ctx, input }) => {
      const link = await ctx.services.teachers.keptData.signatureLink(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'kept_signature.view',
        targetType: 'user',
        targetId: input.teacherUserId,
        reason: input.reason,
      });
      return link;
    }),
  }),
});
