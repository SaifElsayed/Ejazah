// T049: the teacher's «طلابي» and «اليوم» (app-surface.md "`enrollments` and the teacher's lists";
// FR-391, FR-392, FR-393, FR-395). Thin: the teacher kind admitting an approved teacher, so an
// anonymous caller, a student, an applicant and a suspended or banned teacher are refused before the
// service is reached; the input validated, one service call with the session's own account, never
// anything the input says (M3), the output parsed by its schema, which strips anything R-HONEST-4
// keeps from the teacher (R-API-1). Another teacher's enrollment answers NOT_FOUND with no field.
// Mounted by `app.router.ts` as `teacher.students` and `teacher.today`.
//
// THE NAME SEARCH'S LIMIT (T007; specs/004-sessions/contracts/app-surface.md, Phase 2's lists;
// R-SEC-6; plan.md, C2): `teacher.students.list`, the teacher's search of their students by name,
// is counted under Phase 1's `rate_limit_search` by the teacher's own id, as `booking.slots` is, a
// declared limit failing closed; past it RATE_LIMITED before the service. T062 moves the
// declaration to `subject: 'caller'`.
import {
  emptyInput,
  teacherStudentsGetInput,
  teacherStudentsGetOutput,
  teacherStudentsListInput,
  teacherStudentsListOutput,
  teacherTodayOutput,
} from '@ijazah/contracts';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

const { search } = defaultRateLimits;

export const teacherStudentsRouter = createAppRouter({
  list: teacherProcedure({
    admits: 'approved',
    input: teacherStudentsListInput,
    output: teacherStudentsListOutput,
    rateLimit: { key: search, subject: 'caller' },
  }).query(({ ctx, input }) => ctx.services.booking.students(ctx.caller.userId, input)),

  get: teacherProcedure({
    admits: 'approved',
    input: teacherStudentsGetInput,
    output: teacherStudentsGetOutput,
  }).query(({ ctx, input }) => ctx.services.booking.student(ctx.caller.userId, input)),
});

export const teacherTodayProcedure = teacherProcedure({
  admits: 'approved',
  input: emptyInput,
  output: teacherTodayOutput,
}).query(({ ctx }) => ctx.services.booking.today(ctx.caller.userId));
