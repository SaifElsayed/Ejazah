// T019: the `teacher.slots` namespace (app-surface.md "`teacher.slots` — catalog"; FR-313, FR-314,
// FR-317, FR-318). Thin: every procedure the teacher kind admitting an approved teacher, payout
// verified or not (FR-315), so a student, an applicant or an anonymous caller is refused before the
// service is reached and a suspended or banned account is `ACCOUNT_RESTRICTED`; the input validated,
// one service call on the caller's own slots, the output parsed by its schema (R-API-1). `create` is
// keyed (`idempotent-procedures.ts`). `list`'s `published` is the visibility predicate's answer, asked
// with the session's gender, as `teacher.packages.list`'s (T069, FR-315). Mounted under
// `teacher.slots` by `app.router.ts`.
import {
  slotsCreateInput,
  slotsListOutput,
  slotsUpdateInput,
  teacherSlot,
} from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const slotsRouter = createAppRouter({
  list: teacherProcedure({
    admits: 'approved',
    input: z.void(),
    output: slotsListOutput,
  }).query(({ ctx }) => ctx.services.catalog.slots.list(ctx.caller.userId, ctx.caller.gender)),

  create: teacherProcedure({
    admits: 'approved',
    input: slotsCreateInput,
    output: teacherSlot,
  }).mutation(({ ctx, input }) => ctx.services.catalog.slots.create(ctx.caller.userId, input)),

  update: teacherProcedure({
    admits: 'approved',
    input: slotsUpdateInput,
    output: teacherSlot,
  }).mutation(({ ctx, input }) => ctx.services.catalog.slots.update(ctx.caller.userId, input)),
});
