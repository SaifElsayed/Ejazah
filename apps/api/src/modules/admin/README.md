# admin

## Owns

`admin_users, audit_logs, settings, admin_sessions, admin_recovery_codes`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Be imported by any other module (R-API-4): only `main.ts`, `worker.ts` and `admin.router.ts` import `index.ts` (T143). Expose a procedure on the user surface (R-API-11). Share a table, a token or a session with a user's sign-in (R-SEC-8, FR-170). Delete an audit row, and no `deleted_at` exists to set (R-DB-3). Write an operational number from application code (R-PROC-11, FR-034). Hold the rule of an application, a credential or an account's standing: those are the owners' services, which this module composes, their locks with them.

## Composition

`createAdminServices` builds the services of the administrator surface. Its own are `auth` (sign-in, the second factor, recovery, the password set from an invite), `sessions`, `admins`, `audit` and `home`. The others are the owners', composed here over one consequences registry shared with identity's deletion (FR-142): `credentials` is catalog's credential review, `applications` and `documents` verification's review and identity requests, `teachers` identity's `StandingService`. Each runs on the administrator kind's transaction and takes the locks its owner's README states, the account's before the application's wherever it takes both (T164). The home's two queue cards read identity's and catalog's tables through their entries (T065).

## Shape

The rules live in the services: `admin-auth.service.ts` (sign-in, the lockout, the second factor, recovery codes, T066), `admin-session.service.ts` (the administrator's session and its resolver), `admin-invite.ts` (the invite link the `deliver-admin-invite` job sends), `admins.service.ts` (the admins page, FR-173, FR-174), `audit-query.service.ts` (the audit log as the pages read it), `home.service.ts` (the admin home) and `labels/` (the audit label written once and the target's name resolved at read time, T021). The queries live in `admin-users.repository.ts`, `admin-sessions.repository.ts`, `admin-recovery-codes.repository.ts`, `audit.repository.ts` and `settings.repository.ts`. A router is thin: validate, call one service method, return: `auth.router.ts`, `admins.router.ts`, `audit.router.ts` and `home.router.ts`, mounted by `admin.router.ts`. `index.ts` is the only import path.

`settings.service.ts` and `settings.repository.ts` implement the kernel's `SettingsReader` (`platform/settings/settings-reader.ts`, T113). `index.ts` exports it as `createSettingsReader`, and `main.ts` and `worker.ts` bind it (T143). A missing or invalid key throws `SettingError` and is never replaced by a constant.

`audit.repository.ts` implements the kernel's `AuditWriter` (`platform/audit/audit-writer.ts`, T108): it inserts one `audit_logs` row on the transaction it is handed, the administrative action's own. `index.ts` exports it as `createAuditWriter`, and `main.ts` binds it. The administrator caller kind writes through it; no handler does.

## Requirement ids

- FR-034: settings reading behind `SettingsReader` (T113).
- FR-049: the audit record of every administrative action behind `AuditWriter` (T108).
- FR-170 to FR-173 (the separate sign-in, the second factor, the lockout, a reset): `admin-auth.service.ts`, `admin-session.service.ts`, `auth.router.ts`.
- FR-174 (the admins page and the invite): `admins.service.ts`, `admin-invite.ts`, `admins.router.ts`.
- FR-176 (the admin home): `home.service.ts`, `home.router.ts`.
- FR-180, FR-181 (the audit label and the name resolved at read time): `labels/`, `audit.repository.ts`, `audit-query.service.ts`.
- FR-614 to FR-617 (the gender flags' queue, the correction and the fraud ban, composed over moderation's flags, identity's administrators-only gender setter, booking's enrollment side and holds, certification's re-render of a party's unsigned ijazahs and the standing service's bans; 005:T013 to T015, B47): `gender-decisions.service.ts`, `gender-flags.router.ts`.
