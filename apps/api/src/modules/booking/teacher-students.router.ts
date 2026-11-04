// T049: the teacher's «طلابي» and «اليوم» (app-surface.md "`enrollments` and the teacher's lists";
// FR-391, FR-392, FR-393, FR-395). Thin: the teacher kind admitting an approved teacher, so an
// anonymous caller, a student, an applicant and a suspended or banned teacher are refused before the
// service is reached; the input validated, one service call with the session's own account, never
// anything the input says (M3), the output parsed by its schema, which strips anything R-HONEST-4
// keeps from the teacher (R-API-1). Another teacher's enrollment answers NOT_FOUND with no field.
// Mounted by `app.router.ts` as `teacher.students` and `teacher.today`.
import {
  emptyInput,
  teacherStudentsGetInput,
  teacherStudentsGetOutput,
  teacherStudentsListInput,
  teacherStudentsListOutput,
  teacherTodayOutput,
} from '@ijazah/contracts';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const teacherStudentsRouter = createAppRouter({
  list: teacherProcedure({
    admits: 'approved',
    input: teacherStudentsListInput,
    output: teacherStudentsListOutput,
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
