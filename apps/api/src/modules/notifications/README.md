# notifications

## Owns

`notifications`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Deliver push outside the queued job (R-API-15). Put personal content in a push payload; identifiers for deep-linking only (R-HONEST-5).

## Shape

`notifications.service.ts` holds every rule. `notifications.repository.ts` holds every query. `notifications.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
