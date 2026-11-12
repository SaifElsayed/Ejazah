// T068: the administrator surface's `documents` and `users` namespaces (admin-surface.md
// "`documents`"; FR-160, FR-166). Thin (R-API-1); the actor is the session's administrator. Viewing
// a document is an action worth its entry (`document.view`, NFR-SEC-3), unlike a list read; the
// identity request's three actions are audited on the person (`user.require_identity`, with the
// reason) and on the request (`verification_request.accept`, `.request_another`, with the note; the
// latter's entry names the document turned away and the request that replaces it).
// Mounted under `documents` and `users` by `admin.router.ts`.
import {
  documentsAcceptInput,
  documentsLinkInput,
  documentsLinkOutput,
  documentsRequestAnotherInput,
  usersGetInput,
  usersGetOutput,
  usersListInput,
  usersListOutput,
  usersRequireIdentityInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const documentsRouter = createAdminRouter({
  link: adminProcedure({ input: documentsLinkInput, output: documentsLinkOutput }).mutation(
    async ({ ctx, input }) => {
      const link = await ctx.services.documents.link(
        ctx.tx,
        ctx.administrator.adminId,
        input.documentId,
      );
      ctx.audit.record({
        action: 'document.view',
        targetType: 'document',
        targetId: input.documentId,
      });
      return link;
    },
  ),

  accept: adminProcedure({ input: documentsAcceptInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.documents.accept(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'verification_request.accept',
        targetType: 'verification_request',
        targetId: input.requestId,
        ...(input.note === undefined ? {} : { reason: input.note }),
      });
    },
  ),

  requestAnother: adminProcedure({
    input: documentsRequestAnotherInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    const { requestId, documentId } = await ctx.services.documents.requestAnother(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    ctx.audit.record({
      action: 'verification_request.request_another',
      targetType: 'verification_request',
      targetId: input.requestId,
      reason: input.note,
      before: { documentId },
      after: { requestId },
    });
  }),
});

export const usersRouter = createAdminRouter({
  requireIdentity: adminProcedure({ input: usersRequireIdentityInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { requestId } = await ctx.services.documents.requireIdentity(
        ctx.tx,
        ctx.administrator.adminId,
        { userId: input.targetUserId, reason: input.reason },
      );
      ctx.audit.record({
        action: 'user.require_identity',
        targetType: 'user',
        targetId: input.targetUserId,
        reason: input.reason,
        after: { requestId },
      });
    },
  ),

  // T058 of specs/004-sessions (FR-481, FR-459; SRS FR-ADMIN-4; admin-surface.md, "`users`"): the
  // user directory, read by the verification module over identity's and sessions' entries. The list
  // is a name search under Phase 1's `rate_limit_search`, the administrator as subject, checked
  // before the transaction (R-SEC-6; C2); the record's entry names the user and carries no before or
  // after, so no date of birth can reach it (PDPL).
  list: adminProcedure({
    input: usersListInput,
    output: usersListOutput,
    rateLimit: { key: 'rate_limit_search', subject: 'caller' },
  }).query(async ({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    const page = await ctx.services.users.list(ctx.tx, adminId, input);
    ctx.audit.record({ action: 'users.listed', targetType: 'admin', targetId: adminId });
    return page;
  }),

  get: adminProcedure({ input: usersGetInput, output: usersGetOutput }).query(
    async ({ ctx, input }) => {
      const record = await ctx.services.users.get(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({ action: 'user.viewed', targetType: 'user', targetId: input.targetUserId });
      return record;
    },
  ),
});
