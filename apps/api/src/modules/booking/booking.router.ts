// T032: the `booking` namespace (app-surface.md "`booking` — the booking sheet"; FR-350, FR-386,
// R-205). Thin: the student kind, so an anonymous caller, a teacher and a suspended or banned
// student are refused before the service is reached; every call counted under `rate_limit_search`
// by the caller's own id; the input validated, one service call with the session's account and
// gender (R-GENDER-4, R-GENDER-5), the output parsed by its schema (R-API-1). An excluded teacher's
// package, and an unknown or inactive one, answer NOT_FOUND with no field (R-GENDER-2). Mounted
// under `booking` by `app.router.ts`.
import { bookingSlotsInput, bookingSlotsOutput } from '@ijazah/contracts';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, studentProcedure } from '../../surfaces/procedures.js';

const { search } = defaultRateLimits;

export const bookingRouter = createAppRouter({
  slots: studentProcedure({
    input: bookingSlotsInput,
    output: bookingSlotsOutput,
    rateLimit: { key: search, subject: 'caller' },
  }).query(({ ctx, input }) =>
    ctx.services.booking.slots({ userId: ctx.caller.userId, gender: ctx.caller.gender }, input),
  ),
});
