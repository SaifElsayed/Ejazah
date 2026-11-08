// T036, T037: the `checkout` namespace (app-surface.md "`checkout` — payments"; FR-351 to FR-358,
// FR-380 to FR-386, R-208). Thin: the student kind, so an anonymous caller, a teacher and a suspended
// or banned student are refused before the service is reached; `hold`, `pay` and `retry` counted
// under `rate_limit_payment_initiation` by the caller's own id (FR-357); the input validated, one
// service call with the session's account and gender (R-GENDER-4, R-GENDER-5), the output parsed by
// its schema (R-API-1). Mounted under `checkout` by `app.router.ts`.
import {
  checkoutContinueInput,
  checkoutContinueOutput,
  checkoutCurrentOutput,
  checkoutHoldInput,
  checkoutHoldOutput,
  checkoutPayInput,
  checkoutPayOutput,
  checkoutRetryInput,
  checkoutRetryOutput,
  checkoutStatusInput,
  checkoutStatusOutput,
  emptyInput,
} from '@ijazah/contracts';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { type UserCaller } from '../../surfaces/context.js';
import { createAppRouter, studentProcedure } from '../../surfaces/procedures.js';

const { paymentInitiation } = defaultRateLimits;

// The caller the student kind authenticated, never a value computed here (T062).
const initiation = { key: paymentInitiation, subject: 'caller' } as const;

const studentOf = (caller: UserCaller) => ({ userId: caller.userId, gender: caller.gender });

export const checkoutRouter = createAppRouter({
  hold: studentProcedure({
    input: checkoutHoldInput,
    output: checkoutHoldOutput,
    rateLimit: initiation,
  }).mutation(({ ctx, input }) => ctx.services.checkout.hold(studentOf(ctx.caller), input)),

  pay: studentProcedure({
    input: checkoutPayInput,
    output: checkoutPayOutput,
    rateLimit: initiation,
  }).mutation(({ ctx, input }) => ctx.services.checkout.pay(studentOf(ctx.caller), input)),

  retry: studentProcedure({
    input: checkoutRetryInput,
    output: checkoutRetryOutput,
    rateLimit: initiation,
  }).mutation(({ ctx, input }) => ctx.services.checkout.retry(studentOf(ctx.caller), input)),

  // T037: the reads, the student kind and no declared limit (app-surface.md).
  current: studentProcedure({
    input: emptyInput,
    output: checkoutCurrentOutput,
  }).query(({ ctx }) => ctx.services.checkout.current(studentOf(ctx.caller))),

  continue: studentProcedure({
    input: checkoutContinueInput,
    output: checkoutContinueOutput,
  }).query(({ ctx, input }) => ctx.services.checkout.continue(studentOf(ctx.caller), input)),

  status: studentProcedure({
    input: checkoutStatusInput,
    output: checkoutStatusOutput,
  }).query(({ ctx, input }) => ctx.services.checkout.status(studentOf(ctx.caller), input)),
});
