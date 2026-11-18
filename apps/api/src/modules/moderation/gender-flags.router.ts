// T013 of specs/005-certification: the user surface's `genderFlags` namespace, `genderFlags.raise`
// (contracts/app-surface.md; FR-613, FR-614; SRS FR-GENDER-3; research R-409). Thin (R-API-1): the
// user kind, so an anonymous caller and a suspended or banned account are refused before the
// service; every call counted under `rate_limit_gender_flag` by the caller (FR-613; the first refusal
// of a window logged with ids by the limiter); the input validated; one service call with the
// session's own account, role and gender, never anything the input says (R-GENDER-4); the output
// parsed by its schema, so the caller reads `{ received: true }` and nothing else. Mounted under
// `genderFlags` by `app.router.ts` (the integration's line); the administrator's `genderFlags.*` are
// the admin module's router (Q-G1 (a)).
import { genderFlagsRaiseInput, genderFlagsRaiseOutput } from '@ijazah/contracts';

import type { RateLimitKey } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, userProcedure } from '../../surfaces/procedures.js';

/** The settings key of the flag limit (SRS §3.14 as amended by DEC-71, FR-613). */
export const GENDER_FLAG_RATE_LIMIT = 'rate_limit_gender_flag' satisfies RateLimitKey;

export const genderFlagsRouter = createAppRouter({
  raise: userProcedure({
    input: genderFlagsRaiseInput,
    output: genderFlagsRaiseOutput,
    rateLimit: { key: GENDER_FLAG_RATE_LIMIT, subject: 'caller' },
  }).mutation(({ ctx, input }) =>
    ctx.services.moderation.genderFlags.raise(
      { userId: ctx.caller.userId, role: ctx.caller.role, gender: ctx.caller.gender },
      input,
      ctx.log,
    ),
  ),
});
