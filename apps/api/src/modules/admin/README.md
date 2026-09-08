# admin

## Owns

`admin_users, audit_logs, settings`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Be imported by any other module (R-API-4). Expose a procedure on the user surface (R-API-11). Delete an audit row, and no `deleted_at` exists to set (R-DB-3). Write an operational number from application code (R-PROC-11, FR-034).

## Shape

`admin.service.ts` holds every rule. `admin.repository.ts` holds every query. `admin.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
