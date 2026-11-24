// 006:T007 of specs/006-programme (FR-705; R-505, R-506; contracts/app-surface.md `programme.offer`):
// the user surface's `programme` namespace. Thin (R-API-1): the teacher kind admitting an approved
// teacher, so an anonymous caller is UNAUTHENTICATED, a student and an applicant FORBIDDEN, and a
// suspended or banned teacher ACCOUNT_RESTRICTED before the service; the input validated; one service
// call with the session's own account, never anything the input says of a party (R-GENDER-4), and
// the request's after-commit list (`ctx.live`); the output parsed by its schema. Keyed
// (`idempotencyKey`, scope `programme.offer`). Another teacher's enrollment answers NOT_FOUND, as an
// unknown id (R-GENDER-2's shape). No limit of its own: the general limit covers it (NFR-SEC-12;
// the owner, 2026-11-23, FU-A2). Mounted under `programme` by `app.router.ts` (its `006:` block).
//
// 006:T009 (FR-710 to FR-713; R-509; contracts/app-surface.md `programme.pay`): `programme.pay`, the
// student kind (an anonymous caller UNAUTHENTICATED, a teacher FORBIDDEN, a suspended or banned
// student ACCOUNT_RESTRICTED before the service), counted under `rate_limit_payment_initiation` by
// the caller's own id as `checkout.pay` is (FR-357: it creates a gateway order); one call of
// payments' checkout, which owns the orders and the gateway (R-208), with the session's account and
// gender and the request's log for its refusals' lines (`chat.router.ts`' precedent). Keyed (scope
// `programme.pay`). Another student's enrollment answers NOT_FOUND.
import {
  programmeActionInput,
  programmeActionOutput,
  programmeCheckoutOutput,
  programmeGetInput,
  programmeGetOutput,
  programmeOfferInput,
  programmeOfferOutput,
  programmePayInput,
  programmeRenewInput,
  programmeRequestInput,
  programmeRequestOutput,
} from '@ijazah/contracts';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import {
  createAppRouter,
  participantProcedure,
  studentProcedure,
  teacherProcedure,
} from '../../surfaces/procedures.js';

// The caller the student kind authenticated, never a value computed here (T062).
const initiation = { key: defaultRateLimits.paymentInitiation, subject: 'caller' } as const;

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

  pay: studentProcedure({
    input: programmePayInput,
    output: programmeCheckoutOutput,
    rateLimit: initiation,
  }).mutation(({ ctx, input }) =>
    ctx.services.checkout.programmePay(
      { userId: ctx.caller.userId, gender: ctx.caller.gender },
      input,
      ctx.log,
    ),
  ),

  // 006:T018 (FR-726; contracts/app-surface.md `programme.get`): the participant kind, either party,
  // the service handed the session's own account; anyone else NOT_FOUND as an unknown id. A query:
  // no key, no limit of its own (the general limit covers it).
  get: participantProcedure({ input: programmeGetInput, output: programmeGetOutput }).query(
    ({ ctx, input }) => ctx.services.booking.programme.get(ctx.caller.userId, input),
  ),

  // 006:T016 (FR-713a, DEC-95; contracts/app-surface.md `programme.autoRenewOff`): the student kind,
  // at any time; keyed (`programme.autoRenewOff`); another student's enrollment NOT_FOUND.
  autoRenewOff: studentProcedure({
    input: programmeActionInput,
    output: programmeActionOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.booking.programme.autoRenewOff(ctx.caller.userId, input, ctx.live),
  ),

  // 006:T016 (FR-713a, FR-715, FR-716; contracts/app-surface.md `programme.renew`): the student kind,
  // counted under `rate_limit_payment_initiation` by the caller's own id as `programme.pay` is (it
  // creates a gateway order); one call of payments' checkout with the session's account and gender
  // and the request's log. Keyed (scope `programme.renew`). Another student's enrollment NOT_FOUND.
  renew: studentProcedure({
    input: programmeRenewInput,
    output: programmeCheckoutOutput,
    rateLimit: initiation,
  }).mutation(({ ctx, input }) =>
    ctx.services.checkout.programmeRenew(
      { userId: ctx.caller.userId, gender: ctx.caller.gender },
      input,
      ctx.log,
    ),
  ),
});
