// T011 of specs/005-certification: the user surface's `reports` namespace, `reports.create`
// (contracts/app-surface.md, `reports.create`; FR-611, FR-613; research R-408). Thin (R-API-1): the
// user kind, so an anonymous caller and a suspended or banned account are refused before the
// service; every call counted under `rate_limit_user_report` by the caller (FR-613; the first
// refusal of a window logged with ids by the limiter); the input validated; one service call with
// the session's own account, role and gender, never anything the input says (R-GENDER-4); the
// output parsed by its schema, so the reporter reads `{ received: true }` and nothing else
// (spec.md:305). Mounted under `reports` by `app.router.ts` (the integration's line).
import { reportsCreateInput, reportsCreateOutput } from '@ijazah/contracts';

import type { RateLimitKey } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, userProcedure } from '../../surfaces/procedures.js';

/** The settings key of the report limit (SRS §3.14 as amended by DEC-71, FR-613). */
export const USER_REPORT_RATE_LIMIT = 'rate_limit_user_report' satisfies RateLimitKey;

export const reportsRouter = createAppRouter({
  create: userProcedure({
    input: reportsCreateInput,
    output: reportsCreateOutput,
    rateLimit: { key: USER_REPORT_RATE_LIMIT, subject: 'caller' },
  }).mutation(({ ctx, input }) =>
    ctx.services.moderation.reports.create(
      { userId: ctx.caller.userId, role: ctx.caller.role, gender: ctx.caller.gender },
      input,
      ctx.log,
    ),
  ),
});
