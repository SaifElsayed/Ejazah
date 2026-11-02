// T018: the `teacher.packages` namespace (app-surface.md "`teacher.packages` — catalog"; FR-311 to
// FR-315, R-218). Thin: every procedure the teacher kind admitting an approved teacher, payout
// account verified or not (R-106, FR-315), so an applicant, a student or an anonymous caller is
// refused before the service is reached and a suspended or banned account is `ACCOUNT_RESTRICTED`;
// the input validated, one service call on the caller's own packages, the output parsed by its
// schema (R-API-1). `published` is the visibility predicate's answer, asked with the session's
// gender (the owner's decision of 2026-11-02). Mounted under `teacher.packages` by `app.router.ts`.
import {
  packagesCreateInput,
  packagesListOutput,
  packagesUpdateInput,
  teacherPackage,
} from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const packagesRouter = createAppRouter({
  list: teacherProcedure({
    admits: 'approved',
    input: z.void(),
    output: packagesListOutput,
  }).query(({ ctx }) => ctx.services.catalog.packages.list(ctx.caller.userId, ctx.caller.gender)),

  create: teacherProcedure({
    admits: 'approved',
    input: packagesCreateInput,
    output: teacherPackage,
  }).mutation(({ ctx, input }) => ctx.services.catalog.packages.create(ctx.caller.userId, input)),

  update: teacherProcedure({
    admits: 'approved',
    input: packagesUpdateInput,
    output: teacherPackage,
  }).mutation(({ ctx, input }) => ctx.services.catalog.packages.update(ctx.caller.userId, input)),
});
