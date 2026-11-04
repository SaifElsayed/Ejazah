// T049: the `enrollments` namespace (app-surface.md "`enrollments` and the teacher's lists"; FR-390,
// FR-392, FR-393, FR-395). Thin: the student kind, so an anonymous caller, a teacher and a suspended
// or banned student are refused before the service is reached; the input validated, one service
// call with the session's own account, never anything the input says (M3), the output parsed by its
// schema, which strips a field it does not name (R-API-1, R-HONEST-4). Another student's enrollment
// answers NOT_FOUND with no field. Mounted under `enrollments` by `app.router.ts`.
import {
  enrollmentsGetInput,
  enrollmentsGetOutput,
  enrollmentsListInput,
  enrollmentsListOutput,
} from '@ijazah/contracts';

import { createAppRouter, studentProcedure } from '../../surfaces/procedures.js';

export const enrollmentsRouter = createAppRouter({
  list: studentProcedure({ input: enrollmentsListInput, output: enrollmentsListOutput }).query(
    ({ ctx, input }) => ctx.services.booking.enrollments(ctx.caller.userId, input),
  ),

  get: studentProcedure({ input: enrollmentsGetInput, output: enrollmentsGetOutput }).query(
    ({ ctx, input }) => ctx.services.booking.enrollment(ctx.caller.userId, input),
  ),
});
