// T036, T037: the `checkout` namespace (app-surface.md "`checkout` — payments"; FR-351 to FR-358,
// FR-380 to FR-386, R-208). Thin: the student kind, so an anonymous caller, a teacher and a suspended
// or banned student are refused before the service is reached; `hold`, `pay` and `retry` counted
// under `rate_limit_payment_initiation` by the caller's own id (FR-357); the input validated, one
// service call with the session's account and gender (R-GENDER-4, R-GENDER-5), the output parsed by
// its schema (R-API-1). Mounted under `checkout` by `app.router.ts`.
import {
  checkoutHoldInput,
  checkoutHoldOutput,
  checkoutPayInput,
  checkoutPayOutput,
  checkoutRetryInput,
  checkoutRetryOutput,
} from '@ijazah/contracts';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { type AppContext, type UserCaller } from '../../surfaces/context.js';
import { createAppRouter, studentProcedure } from '../../surfaces/procedures.js';

const { paymentInitiation } = defaultRateLimits;

const initiation = {
  key: paymentInitiation,
  subjectOf: ({ ctx }: { ctx: AppContext & { caller: UserCaller } }) => ctx.caller.userId,
};

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
});
