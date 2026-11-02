// T017: the `teacher.profile` namespace (app-surface.md "`teacher.profile` — identity"; FR-310,
// FR-PROFILE-1, R-GENDER-6, R-218). Thin: both procedures the teacher kind admitting an approved
// teacher, the payout account verified or not (FR-315: the profile is drafted before payout
// verification), so an applicant, a student or an anonymous caller is refused before the service is
// reached and a suspended or banned account is `ACCOUNT_RESTRICTED`; the input validated, one
// service call on the caller's own profile, the output parsed by its schema (R-API-1). `update`'s
// schema names the bio and the qualification summary only, so a sent gender is stripped before the
// service (R-GENDER-6). Mounted under `teacher.profile` by `app.router.ts`.
import {
  teacherProfileGetOutput,
  teacherProfileUpdateInput,
  teacherProfileUpdateOutput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const teacherProfileRouter = createAppRouter({
  get: teacherProcedure({
    admits: 'approved',
    input: z.void(),
    output: teacherProfileGetOutput,
  }).query(({ ctx }) => ctx.services.teacherProfile.get(ctx.caller.userId, ctx.caller.gender)),

  update: teacherProcedure({
    admits: 'approved',
    input: teacherProfileUpdateInput,
    output: teacherProfileUpdateOutput,
  }).mutation(({ ctx, input }) => ctx.services.teacherProfile.update(ctx.caller.userId, input)),
});
