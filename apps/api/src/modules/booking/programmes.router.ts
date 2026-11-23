// 006:T007 of specs/006-programme (FR-705; R-505, R-506; contracts/app-surface.md `programme.offer`):
// the user surface's `programme` namespace. Thin (R-API-1): the teacher kind admitting an approved
// teacher, so an anonymous caller is UNAUTHENTICATED, a student and an applicant FORBIDDEN, and a
// suspended or banned teacher ACCOUNT_RESTRICTED before the service; the input validated; one service
// call with the session's own account, never anything the input says of a party (R-GENDER-4), and
// the request's after-commit list (`ctx.live`); the output parsed by its schema. Keyed
// (`idempotencyKey`, scope `programme.offer`). Another teacher's enrollment answers NOT_FOUND, as an
// unknown id (R-GENDER-2's shape). No limit of its own: the general limit covers it (NFR-SEC-12;
// the owner, 2026-11-23, FU-A2). Mounted under `programme` by `app.router.ts` (its `006:` block).
import {
  programmeActionInput,
  programmeActionOutput,
  programmeOfferInput,
  programmeOfferOutput,
  programmeRequestInput,
  programmeRequestOutput,
} from '@ijazah/contracts';

import { createAppRouter, studentProcedure, teacherProcedure } from '../../surfaces/procedures.js';

export const programmesRouter = createAppRouter({
  offer: teacherProcedure({
    admits: 'approved',
    input: programmeOfferInput,
    output: programmeOfferOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.booking.programme.offer(ctx.caller.userId, input, ctx.live),
  ),
  // 006:T008 (FR-706, R-505; contracts/app-surface.md `programme.cancel`): the student kind; the
  // student's own programme before any payment of the rest, keyed (`programme.cancel`).
  cancel: studentProcedure({ input: programmeActionInput, output: programmeActionOutput }).mutation(
    ({ ctx, input }) => ctx.services.booking.programme.cancel(ctx.caller.userId, input, ctx.live),
  ),
  // 006:T008 (FR-709, R-513; contracts/app-surface.md `programme.request`): the teacher kind
  // admitting an approved teacher, as the offer; keyed (`programme.request`). `stop` is T017's.
  request: teacherProcedure({
    admits: 'approved',
    input: programmeRequestInput,
    output: programmeRequestOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.booking.programme.request(ctx.caller.userId, input, ctx.live),
  ),
});
