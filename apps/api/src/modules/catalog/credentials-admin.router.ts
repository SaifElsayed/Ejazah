// T069: the administrator surface's `credentials` namespace (admin-surface.md "`credentials` — the
// credential review"; FR-163, FR-164). Thin: the input validated, one service call on the call's
// transaction, the action's audit entry described, the output parsed by its schema (R-API-1). The
// actor is the session's administrator, never the input's. The reason of a rejection, of a request
// for another document and of a correction is mandatory in the schema and goes into the entry as
// typed; an approval's optional note goes there too, the transcription it wrote is the entry's
// after and the pending one's, none of it written, its before (T116); a correction's entry holds
// the transcription before and after (FR-164); a request for another document's, the application it
// set waiting on the applicant, when it set one, as its before and after (T155). The list and the
// panel are reads (`credentials.read`) naming the reader, which no audit list shows (owner's
// decision 2026-10-21).
// Mounted under `credentials` by `admin.router.ts`.
import {
  adminCredentialsApproveInput,
  adminCredentialsCorrectInput,
  adminCredentialsGetInput,
  adminCredentialsGetOutput,
  adminCredentialsListInput,
  adminCredentialsListOutput,
  adminCredentialsRejectInput,
  adminCredentialsRequestDocumentInput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { adminProcedure, createAdminRouter } from '../../surfaces/procedures.js';

export const credentialsAdminRouter = createAdminRouter({
  list: adminProcedure({
    input: adminCredentialsListInput,
    output: adminCredentialsListOutput,
  }).query(({ ctx, input }) => {
    const { adminId } = ctx.administrator;
    ctx.audit.record({ action: 'credentials.read', targetType: 'admin', targetId: adminId });
    return ctx.services.credentials.list(ctx.tx, input);
  }),

  get: adminProcedure({ input: adminCredentialsGetInput, output: adminCredentialsGetOutput }).query(
    ({ ctx, input }) => {
      const { adminId } = ctx.administrator;
      ctx.audit.record({ action: 'credentials.read', targetType: 'admin', targetId: adminId });
      return ctx.services.credentials.get(ctx.tx, input.credentialId);
    },
  ),

  approve: adminProcedure({ input: adminCredentialsApproveInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.credentials.approve(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'credential.approve',
        targetType: 'credential',
        targetId: input.credentialId,
        ...(input.note === undefined ? {} : { reason: input.note }),
        before,
        after,
      });
    },
  ),

  reject: adminProcedure({ input: adminCredentialsRejectInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      await ctx.services.credentials.reject(ctx.tx, ctx.administrator.adminId, input);
      ctx.audit.record({
        action: 'credential.reject',
        targetType: 'credential',
        targetId: input.credentialId,
        reason: input.reason,
      });
    },
  ),

  requestDocument: adminProcedure({
    input: adminCredentialsRequestDocumentInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    const move = await ctx.services.credentials.requestDocument(
      ctx.tx,
      ctx.administrator.adminId,
      input,
    );
    ctx.audit.record({
      action: 'credential.request_document',
      targetType: 'credential',
      targetId: input.credentialId,
      reason: input.reason,
      ...move,
    });
  }),

  correct: adminProcedure({ input: adminCredentialsCorrectInput, output: z.void() }).mutation(
    async ({ ctx, input }) => {
      const { before, after } = await ctx.services.credentials.correct(
        ctx.tx,
        ctx.administrator.adminId,
        input,
      );
      ctx.audit.record({
        action: 'credential.correct',
        targetType: 'credential',
        targetId: input.credentialId,
        reason: input.reason,
        before,
        after,
      });
    },
  ),
});
