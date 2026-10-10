# admin

## Owns

`admin_users, audit_logs, settings`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Be imported by any other module (R-API-4). Expose a procedure on the user surface (R-API-11). Delete an audit row, and no `deleted_at` exists to set (R-DB-3). Write an operational number from application code (R-PROC-11, FR-034).

## Shape

`admin.service.ts` holds every rule. `admin.repository.ts` holds every query. `admin.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

`settings.service.ts` and `settings.repository.ts` implement the kernel's `SettingsReader` (`platform/settings/settings-reader.ts`, T113). `index.ts` exports it as `createSettingsReader`, and `main.ts` and `worker.ts` bind it (T143). A missing or invalid key throws `SettingError` and is never replaced by a constant.

`audit.repository.ts` implements the kernel's `AuditWriter` (`platform/audit/audit-writer.ts`, T108): it inserts one `audit_logs` row on the transaction it is handed, the administrative action's own. `index.ts` exports it as `createAuditWriter`, and `main.ts` binds it. The administrator caller kind writes through it; no handler does.

## Requirement ids

- FR-034: settings reading behind `SettingsReader` (T113).
- FR-049: the audit record of every administrative action behind `AuditWriter` (T108).
