# moderation

## Owns

`disputes, gender_flags, user_reports`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Compensation cases

`disputes` holds session disputes and enrollment-level compensation cases (`kind`). Termination flows open compensation cases automatically (FR-DISPUTE-5). An admin's `compensation_ordered` resolution records the decision only; Platform Administration executes it through the gateway outside the code path, and `payments` records the gateway's refunded event (FR-DISPUTE-6). This module never references a money amount (R-MONEY-6).

## Never

Auto-resolve under_threshold or provider_outage sessions; those are terminal only by admin action (R-SESS-6).

## Shape

`moderation.service.ts` holds every rule. `moderation.repository.ts` holds every query. `moderation.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
