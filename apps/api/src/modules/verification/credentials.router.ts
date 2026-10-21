// T057: the `teacher.credentials` namespace (app-surface.md "`teacher.credentials` — after
// approval"; FR-153). A router of this module over the catalog module's credential rows (R-121),
// merged under `teacher.credentials` by `app.router.ts`. Thin, as every router (R-API-1): the
// teacher kind admitting an approved teacher, except `list`, which admits an applicant (the
// credentials page is reachable before approval); one service call on the caller's own rows.
import {
  credentialsAddInput,
  credentialsAddOutput,
  credentialsDocumentLinkInput,
  credentialsDocumentLinkOutput,
  credentialsListOutput,
  credentialsReplaceDocumentInput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const credentialsRouter = createAppRouter({
  list: teacherProcedure({
    admits: 'applicant',
    input: z.void(),
    output: credentialsListOutput,
  }).query(({ ctx }) => ctx.services.verification.credentials.list(ctx.caller.userId)),

  add: teacherProcedure({
    admits: 'approved',
    input: credentialsAddInput,
    output: credentialsAddOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.verification.credentials.add(ctx.caller.userId, input),
  ),

  replaceDocument: teacherProcedure({
    admits: 'approved',
    input: credentialsReplaceDocumentInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.verification.credentials.replaceDocument(ctx.caller.userId, input);
  }),

  documentLink: teacherProcedure({
    admits: 'approved',
    input: credentialsDocumentLinkInput,
    output: credentialsDocumentLinkOutput,
  }).query(({ ctx, input }) =>
    ctx.services.verification.credentials.documentLink(ctx.caller.userId, input),
  ),
});
