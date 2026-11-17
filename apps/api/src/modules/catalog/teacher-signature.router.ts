// T003 of specs/005-certification: the `teacher.signature` namespace (FR-601, SRS FR-IJAZAH-12;
// research R-411; R-SEC-3; contracts/app-surface.md, `teacher.signature.get`). Thin: the teacher kind
// admitting an approved teacher, payout account verified or not (R-106), so an applicant, a student
// or an anonymous caller is refused before the service is reached and a suspended or banned account
// is `ACCOUNT_RESTRICTED`; one service call on the caller's own signature, the output parsed by its
// schema, so a signed link and its instant leave and never a storage key. Mounted under
// `teacher.signature` by `app.router.ts`.
import { teacherSignatureGetOutput } from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const teacherSignatureRouter = createAppRouter({
  get: teacherProcedure({
    admits: 'approved',
    input: z.void(),
    output: teacherSignatureGetOutput,
  }).query(({ ctx }) => ctx.services.catalog.signature.get(ctx.caller.userId)),
});
