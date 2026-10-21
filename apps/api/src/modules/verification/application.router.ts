// T056: the `teacher.application` namespace (app-surface.md "`teacher.application` — applying";
// FR-150, FR-152, FR-155). Thin: every procedure the teacher kind admitting an applicant (R-106),
// so a student or an anonymous caller is refused before the service is reached and a suspended or
// banned account is `ACCOUNT_RESTRICTED`; the input validated, one service call on the caller's own
// application, the output parsed by its schema (R-API-1). Mounted under `teacher.application` by
// `app.router.ts`.
import {
  applicationGetOutput,
  applicationReapplyInput,
  applicationResubmitInput,
  applicationSubmitInput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const applicationRouter = createAppRouter({
  get: teacherProcedure({
    admits: 'applicant',
    input: z.void(),
    output: applicationGetOutput,
  }).query(({ ctx }) => ctx.services.verification.application.get(ctx.caller.userId)),

  submit: teacherProcedure({
    admits: 'applicant',
    input: applicationSubmitInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.verification.application.submit(ctx.caller.userId, input);
  }),

  resubmit: teacherProcedure({
    admits: 'applicant',
    input: applicationResubmitInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.verification.application.resubmit(ctx.caller.userId, input);
  }),

  reapply: teacherProcedure({
    admits: 'applicant',
    input: applicationReapplyInput,
    output: z.void(),
  }).mutation(async ({ ctx, input }) => {
    await ctx.services.verification.application.reapply(ctx.caller.userId, input);
  }),

  markApprovedShown: teacherProcedure({
    admits: 'applicant',
    input: z.void(),
    output: z.void(),
  }).mutation(async ({ ctx }) => {
    await ctx.services.verification.application.markApprovedShown(ctx.caller.userId);
  }),
});
