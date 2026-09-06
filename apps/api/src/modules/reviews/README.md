# reviews

## Owns

`reviews`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Enforce one-review-per-enrollment in application code; the partial unique index does (R-DB-5). Alter a star on moderation.

## Shape

`reviews.service.ts` holds every rule. `reviews.repository.ts` holds every query. `reviews.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
