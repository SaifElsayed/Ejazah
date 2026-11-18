// 003:T105: the user surface's `teacher.dues`, the teacher's «مستحقاتي» (SRS DEC-89; ADR 0025 D2).
// Thin (R-API-1): an approved teacher only (`admits: 'approved'`), the caller's own id from the
// session, never from input, so another teacher's releases are never answered; one service call; the
// output parsed by its schema, which carries no order line and no student's name. Read-only, under the
// signed-in default limit. Mounted under `teacher.dues` by `app.router.ts` (the integration's line).
import { emptyInput, teacherDuesGetOutput } from '@ijazah/contracts';

import { DomainError } from '../../platform/errors/domain-error.js';
import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const teacherDuesRouter = createAppRouter({
  get: teacherProcedure({
    admits: 'approved',
    input: emptyInput,
    output: teacherDuesGetOutput,
  }).query(({ ctx }) => {
    // Unwired only on a surface built for a spec: fail closed rather than answer nothing.
    if (ctx.services.teacherDues === undefined) throw new DomainError('INTERNAL');
    return ctx.services.teacherDues.get(ctx.caller.userId);
  }),
});
