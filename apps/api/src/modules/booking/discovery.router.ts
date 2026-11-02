// T026: the `discovery` namespace (app-surface.md "`discovery` — booking's router over catalog's
// service"; FR-330 to FR-338, R-204, R-205). Thin: every procedure the student kind, so an anonymous
// caller, a teacher and a suspended or banned student are refused before the service is reached;
// every call counted under `rate_limit_search` by the caller's own id; the input validated, one
// service call with the session's gender (R-GENDER-4, R-GENDER-5), the output parsed by its schema
// (R-API-1). Mounted under `discovery` by `app.router.ts`; T027 adds `teacher`.
import {
  discoveryBrowseInput,
  discoveryBrowseOutput,
  discoveryFiltersInput,
  discoveryFiltersOutput,
} from '@ijazah/contracts';

import { defaultRateLimits } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, studentProcedure } from '../../surfaces/procedures.js';

const { search } = defaultRateLimits;

export const discoveryRouter = createAppRouter({
  browse: studentProcedure({
    input: discoveryBrowseInput,
    output: discoveryBrowseOutput,
    rateLimit: { key: search, subjectOf: ({ ctx }) => ctx.caller.userId },
  }).query(({ ctx, input }) => ctx.services.discovery.browse(ctx.caller.gender, input)),

  filters: studentProcedure({
    input: discoveryFiltersInput,
    output: discoveryFiltersOutput,
    rateLimit: { key: search, subjectOf: ({ ctx }) => ctx.caller.userId },
  }).query(({ ctx, input }) => ctx.services.discovery.filters(ctx.caller.gender, input)),
});
