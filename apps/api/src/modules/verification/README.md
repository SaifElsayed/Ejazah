# verification

## Owns

`verification_documents, verification_requests`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Serve a document from a durable public path (R-SEC-3). Trust a declared upload type over its content (R-SEC-4).

## Shape

`verification.service.ts` holds every rule. `verification.repository.ts` holds every query. `verification.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
