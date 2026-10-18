---
description: 'Task list for Phase 1 — Identity and teacher onboarding'
---

# Tasks: Phase 1 — Identity and teacher onboarding

**Input**: Design documents from `/specs/002-identity/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included, and not optional: the working method of Phase 0's final week continues (PLAN.md, "How a phase is run"): tests before implementation, each observed red for the right reason; every new gate proven by a fixture that fails it; every job with its double-run assertion (R-API-14); every procedure under the coverage floor the phase widens (FR-213).

**Organization**: Setup, then the foundational work no story can start without (the ERD pass, the document pass, the kernel changes, the two ports, the two apps' foundations), then the five person-stories of spec.md in priority order, then the proofs and the owner's device runs. The batches at the end are the unit of delivery: one branch, one pull request, one review by Saif's review session, at most six tasks (PLAN.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: US1–US5, mapping to spec.md; `[ERD]`, `[KERNEL]`, `[MOBILE]`, `[ADMIN]`, `[PROOF]` for the cross-story groups
- Every task names its file path

## Path Conventions

Three applications from one monorepo (plan.md, "Source Code"): `apps/mobile/src/` (Expo Router under `app/`, the trees under `features/`, the design under `design/`), `apps/admin/src/` (Vite, `pages/`), `apps/api/src/` (`modules/<module>/`, `platform/`, `surfaces/`, `jobs/`), `packages/`, `prisma/`, `scripts/`, `tests/`. Task branches are cut from `develop` and named `Ejazah_app/002-identity/<task id or range>`, e.g. `Ejazah_app/002-identity/T001-T006`; each opens a pull request to `develop`. A task's note goes under its line as Phase 0's did.

---

## Phase 1: Setup

**Purpose**: What every later task is written against.

- [ ] T001 Declare the phase's configuration in `apps/api/src/platform/config/env.schema.ts` and `.env.example` together (`config.spec.ts` keeps them equal): `SUPPORT_EMAIL` (required, a valid address, no default; FR-145), `SIGN_IN_PROVIDER` (`z.enum(['fake'])`, default `fake`, refused outside development and test as every stand-in), `EMAIL_PROVIDER` (the same), `EMAIL_FROM` (an address, default a local one), the optional platform key `TRUSTED_PROXY` (the one proxy header whose last hop — the one the single trusted proxy appended, never the first — is the client address; set only with exactly one proxy in front; absent before launch, so the socket's peer is used; kernel.md), and the optional provider keys `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, each classified in `envKeyKinds` (platform or provider) so the test setup strips the provider ones (contracts/ports.md)
- [ ] T002 [P] Plant the twenty-six settings rows of data-model.md §4 in `prisma/seed.ts` at their defaults, update the row count in `tests/seed/seed.spec.ts`, and list the ones a person changes in `docs/SRS.md` §3.14 (R-MONEY-12)
- [ ] T003 [P] Add the six new tables to `packages/config/module-tables.json` under their owners (`user_sessions`, `auth_identities` → identity; `admin_sessions`, `admin_recovery_codes` → admin; `teacher_credentials` → catalog; `session_remedies` → sessions), and extend `tests/lint-plugin/table-ownership.spec.ts`'s "all manifest tables" case to thirty-nine (R-API-6)
- [ ] T004 [P] Make `scripts/build-tokens.ts` also write `apps/api/src/platform/web/assets/tokens.css` and copy `docs/design/frames/ds/ijazah/components.css` to `apps/api/src/platform/web/assets/components.css`, both under `check:generated` (`scripts/generated-file-check.ts`, `tests/pipeline/generated-file-check.spec.ts`) (research R-111, ADR 0020 D2)
- [ ] T005 [P] Add the three HKDF labels `ijazah:access-token:v1`, `ijazah:onboarding-token:v1`, `ijazah:admin-invite:v1` to the list in `apps/api/src/platform/crypto/encryption.ts` with a `deriveSubkey(label)` helper each caller uses, and the spec that two labels derive different keys (data-model §7)
- [ ] T006 [P] Install the phone app's dependencies in `apps/mobile/package.json`, pinned exactly and recorded in this task's note: Expo and Expo Router, NativeWind, `lucide-react-native`, `expo-secure-store`, `expo-document-picker`, `expo-crypto`, `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `intl-messageformat`, `@formatjs/intl-pluralrules`, the tRPC client and TanStack Query; the app must build with `expo prebuild` on both platforms (research R-112)
- [ ] T007 [P] Install the admin panel's dependencies in `apps/admin/package.json`, pinned exactly and recorded in this task's note: React, `react-router`, TanStack Query, the tRPC client, shadcn/ui's primitives (Radix), `intl-messageformat`; `vite build` green (research R-113)

---

## Phase 2: Foundational — the ERD pass, the document pass, the kernel, the ports, the two apps' foundations

**Purpose**: Infrastructure without which no story can start. The ERD pass comes first (R-PROC-2: before any identity code).

**⚠️ CRITICAL**: No story work begins until T008–T041 are merged.

### The ERD pass (data-model.md)

- [ ] T008 [P] [ERD] Write the integrity probes first, in `tests/db-integrity/phase1-rules.spec.ts`: rules 22 to 32 of data-model.md §5, each a refused insert as the application role, and the DELETE grants on `auth_identities`, `user_sessions`, `admin_sessions`, `admin_recovery_codes` and `otp_codes` as the application role; observed red before the migrations (SC-113)
- [ ] T009 [ERD] Migration `20261018000000_identity_sessions_and_providers`: `UserSession` and `AuthIdentity` in `prisma/schema/identity.prisma` with the enums in `base.prisma`, `users.certificate_name`, `users.photo_key`, `display_name` and `date_of_birth` nullable with rule 32 and the phone-or-email check rewritten for deleted rows (rule 1), `account_deletion` on `OtpPurpose`, the `user_roles (user_id)` unique, the `otp_codes (destination, purpose)` index, the partial index `user_sessions (user_id) WHERE revoked_at IS NULL`; the ERD §2 text follows in the same change
- [ ] T010 [ERD] Migration `20261018000100_admin_sessions_mfa_lockout`: `AdminSession`, `AdminRecoveryCode` in `prisma/schema/admin.prisma`, the `admin_users` columns of data-model §2 with `password_hash` nullable and `mfa_last_accepted_step`, check rules 30 and 31; ERD §12 follows
- [ ] T011 [ERD] Migration `20261018000200_teacher_credentials`: `TeacherCredential` in `prisma/schema/catalog.prisma`, `IsnadEntry` re-keyed with `names text[]`, the `teacher_profiles` application and payout columns (data-model §2, §3) in `identity.prisma`, the `revoked` member on `TeacherVerificationStatus` in `base.prisma`, `teacher_profiles.approved_shown_at`, and `verification_requests.document_id` and `document_type` in `verification.prisma`, the partial uniques of rules 23 and 27; ERD §3, §4 follow (ADR 0017 D5, ADR 0019 D1)
- [ ] T012 [ERD] Migration `20261018000300_audit_target_label`: `audit_logs.target_label text NOT NULL` with the check of rule 29; migration `20261018000400_idempotency_actor`: `actor_id text NOT NULL` and the `(scope, actor_id, key)` unique replacing `(scope, key)` in `platform.prisma`; migration `20261018000500_tracks_remedies_account_deleted`: ADR 0018's columns, `SessionRemedy` in `sessions.prisma`, `account_deleted` on the cancellation reason enum; ERD §5, §12, §15 follow. After T009–T011 (migration order, R-DB-1)
- [ ] T013 [ERD] Extend the schema check's `secret-column` and `encrypted-type` expectations and the derived-value allow-list in `tests/db-integrity/schema-check.spec.ts` for the new columns, add `auth_identities.provider_refresh_token_encrypted` to the identity repository's `reencrypt-columns` pages in `apps/api/src/modules/identity/identity.repository.ts` with its spec, and run `pnpm db:schema:check` green against the six migrations

### The document pass (FR-110, FR-111)

- [ ] T014 [P] [ERD] Amend `docs/ERD.md`'s §1 domain map and count (39), §14 indexes, §15 rule 1 (the phone-or-email check holds for live rows only; rule 32 beside it), and add the "v1.3 → v1.4" changelog naming each migration; amend `docs/SRS.md` §6.2 (the new entities), §2.5 (a team of one since 2026-10-08, PLAN.md) and the text conflicts the closure review listed (§6.2 and §3.14 against the ERD, the rule count); amend `docs/ARCHITECTURE.md` §3.2 (the sign-in port row, seven ports), §3.4 (the two folders), §4 (the six tables under their modules), §7.2 (the teacher kind's `admits`, the admin public kind); record each (R-PROC-2)
- [ ] T015 [P] [ERD] Correct ADR 0001 (the payment port's place), ADR 0005 (the superseded decisions), ADR 0012 D5's parenthesis, the order of the DEC rows in `docs/SRS.md` §14, `/ready` and Redis in `docs/ARCHITECTURE.md` §12, NFR-SEC-7's push protection sentence, and the stray spaces the reviews of PR #70 to #72 listed; add the pointer to `specs/002-identity/contracts/kernel.md` and `ports.md` in `specs/001-foundations/contracts/kernel.md` and `ports.md`

### The kernel (contracts/kernel.md)

- [ ] T016 [P] [KERNEL] Write the kernel specs first: `apps/api/src/surfaces/procedures.spec.ts` gains the cases "`userProcedure` admits either role and refuses an anonymous caller", "a teacher kind cannot be declared without `admits`" (`@ts-expect-error`), "an applicant is refused by `admits: 'approved'`", "a suspended account is refused with `ACCOUNT_RESTRICTED` unless the procedure `admitsRestricted`", "an admin procedure refuses a session whose second factor is unverified with `MFA_REQUIRED`", "`adminPublicProcedure` requires a rate limit and exists only on the admin instance"; `apps/api/src/surfaces/context.spec.ts` gains the resolver cases; `apps/api/src/platform/idempotency/idempotency.spec.ts` gains "two actors, one key, one scope: both accepted; one actor twice: the first outcome"; observed red
- [ ] T017 [KERNEL] Implement the kinds' declarations and the new `userProcedure` (either role) in `apps/api/src/surfaces/procedures.ts` and the richer `UserSession`/`UserCaller` (`role`, `accountStatus`, `teacher?`) and `AdminSession` (`mfaVerified`) in `surfaces/context.ts`; `createApplication` in `app.module.ts` takes `sessions: { user: resolveUserSession, admin: resolveAdminSession }` and calls them per request from the `Authorization` header; the admin context gains the rate limiter for `adminPublicProcedure`; both contexts gain `clientAddress` from the socket or the last hop of the `TRUSTED_PROXY` header (the socket's peer when the key is set but the header absent; kernel.md), redacted to its network in the logs; a test asserts a client-supplied first hop is never the subject. After T016
- [ ] T018 [P] [KERNEL] Implement the per-actor idempotency key in `apps/api/src/platform/idempotency/idempotency.service.ts` and `idempotency.repository.ts` (`actor_id` from the resolved principal; the keyed procedures listed in `packages/contracts/src/idempotent-procedures.ts`, the only scopes the service accepts; T027's pipeline case asserts none of them has a token in its output, so `onboarding.complete` is not keyed), with the error codes of contracts/README.md added to `apps/api/src/platform/errors/domain-error.ts` and mapped in `error-filter.ts` with their specs. After T012
- [ ] T019 [P] [KERNEL] Write `apps/api/src/platform/web/html.ts` (the escaping tagged template with `raw()`), `web/page.ts` (the layout: `lang`, `dir`, the stylesheet links, no inline script), `web/route.ts` (the helper: `rate_limit_public_page`, the strict CSP over `security-headers.middleware.ts`, `Set-Cookie` stripped, `?lang=en`), and `web/assets/` served under `/public/design/`; specs first in `web/html.spec.ts` (every interpolation escaped; `raw()` only) and `web/route.spec.ts` (the header set, no cookie, the limit, through real HTTP); observed red (research R-111)
- [ ] T020 [P] [KERNEL] Extend `apps/api/src/platform/guards/upload.middleware.ts` with upload kinds (`identity`, `credential`: PDF only; `photo`: JPEG and PNG), `upload_max_bytes` read through the settings reader, and `rate_limit_upload` per user; spec first in `upload.spec.ts` (a renamed image refused on a PDF kind, an oversized file refused with the one error shape, the limit read from settings)
- [ ] T021 [P] [KERNEL] The audit writer renders the label: `apps/api/src/modules/admin/labels/target-label.ts` (`targetLabel(type, id)`: `user` → «حساب · {user id}», `teacher_application` → «طلب انضمام · {teacher user id}», `credential` → «إجازة معلم · {credential id}», `document` → «وثيقة · {document id}», `verification_request` → «طلب إثبات هوية · {request id}», `admin` → «مشرف · {admin id}», `setting` → «إعداد · {key}»; empty or over `AUDIT_LABEL_MAX_LENGTH` of `packages/contracts` (200) refused) and `labels/target-name.ts` (`resolveTargetName(tx, type, id)` with the fused form, the role word for a deleted person); `audit.repository.ts` writes `target_label`; `platform/audit/audit-writer.ts`'s `AuditEntry` cannot carry a label; the three catalogue keys (`admin.audit.targets.*`, `admin.credentials.a11y.documentPage`, `admin.dialogs.mfaReset.title`) move from `apps/admin/src/i18n/*.json` to the renderer's Arabic source with `check:i18n:admin` following; specs first in `labels/target-label.spec.ts` (never a name, the length refusal, the fused forms) and `surfaces/admin-procedure.spec.ts` ("an empty label rolls the action back") (ADR 0021 D2, research R-108). After T012

### The two ports and the uploads route (contracts/ports.md, contracts/public-pages.md)

- [ ] T022 [P] [KERNEL] Define the sign-in port in `apps/api/src/platform/ports/sign-in/sign-in.port.ts` (`verifyIdentityToken`, `exchangeAuthorization`, `revoke`; `ProviderIdentity` with `emailVerified` separate), its stand-in `fake.adapter.ts` (the documented unsigned fake token shape, no key on the device, the nonce still compared with the token's field while the service consumes the mark, records, can be told to fail) and `index.ts` selecting by `SIGN_IN_PROVIDER`; `ports.module.ts` selects it; `platform/ports/README.md` gains the row; specs first in `fake.adapter.spec.ts` (a wrong nonce refused, an unverified email reported as such, the port names no vendor: `expectTypeOf<keyof SignInPort>`) (research R-103, R-API-5)
- [ ] T023 [P] [KERNEL] Define the email port in `apps/api/src/platform/ports/email/email.port.ts` (`deliver({ to, subject, text, html? })`), its stand-in `fake.adapter.ts` (records; writes each mail to `.storage/mail/` in development; logs no body) and `index.ts` selecting by `EMAIL_PROVIDER` with `EMAIL_FROM`; the logger's redaction list in `platform/logging/logger.ts` gains `text`, `html` and `subject` under a mail object; specs first (research R-110, R-SEC-2)
- [ ] T024 [KERNEL] The uploads route `POST /uploads/documents` in `apps/api/src/modules/verification/uploads.controller.ts` behind T020's middleware and the user bearer: stores through the storage port under a minted key, writes `verification_documents` with the key encrypted answers `{ documentId }`; the photo has its own route `POST /uploads/photos` in `apps/api/src/modules/identity/photo-upload.controller.ts`, behind the same middleware with image kinds, which writes `users.photo_key` through identity's repository and answers `{ photoUrl }`, a signed link; `documentLinkFor(tx, documentId, viewer)` in `verification.service.ts` mints a signed expiring link for the owner or an admin and refuses anyone else; specs first in `uploads.controller.spec.ts` and `verification.service.spec.ts` (ownership, the sniffing kinds, a link that expires). After T017, T020

### The jobs, the lint rule, the two gates

- [ ] T025 [P] [KERNEL] The three sweeps in `apps/api/src/jobs/purge-otp-codes.ts`, `purge-stale-push-tokens.ts`, `purge-expired-sessions.ts` (user and admin rows; a revoked row kept `session_purge_after_days`), each reading its window through the settings reader, registered in `scheduleSweeps`, with its spec's `runOnceAndTwice` case first (R-API-14, research R-118)
- [ ] T026 [P] [KERNEL] The lint rule `db/no-unfiltered-relation-read` in `packages/config/eslint-plugin-ijazah/rules/no-unfiltered-relation-read.js` (an `include`/`select` of a relation to a soft-deletable model without `where: { deletedAt: null }`, in a `*.repository.ts`), registered in `eslint.base.js`, its RuleTester table in `tests/lint-plugin/no-unfiltered-relation-read.spec.ts`, its fixture case in `tests/violations/layers.spec.ts` naming R-DB-3, and the row in `specs/001-foundations/contracts/lint-rules.md` (`completeness.spec.ts` counts thirty-one) (research R-116)
- [ ] T027 [P] [KERNEL] The output leak test `tests/pipeline/output-leak.spec.ts` over `contract-snapshot.json`: the forbidden field names with the reason for each in `tests/pipeline/output-leak.names.ts`; `account.me`'s own `dateOfBirth` the one allowed occurrence; a second case over `packages/contracts/src/idempotent-procedures.ts` asserts no keyed procedure's output names `accessToken`, `refreshToken`, `sessionToken` or `onboardingToken` (kernel.md Idempotency); a fixture snapshot with a leaking output fails it naming R-HONEST-4; wired into stage 2 of `.github/workflows/ci.yml` (FR-138)
- [ ] T028 [P] [KERNEL] The authorization-test gate `scripts/authz-test-gate.ts` (every non-public user-surface procedure in the snapshot has a module spec naming its path and asserting the kind's refusal), its spec `tests/pipeline/authz-test-gate.spec.ts` (a fixture procedure with no refusal spec fails naming R-MOBILE-13 and the path), the `check:authz` script, and a stage-3 step named for R-MOBILE-13; `scripts/suite-gate.paths.ts` gains the mobile coupling (`apps/mobile/src/features/**` to the module specs) and `tests/pipeline/suite-gate.spec.ts` its cases (research R-115, FR-210)
- [ ] T029 [P] [KERNEL] The gender-input test `apps/api/src/surfaces/surfaces.spec.ts` gains "no user-surface input carries `gender` but `onboarding.complete`": `packages/config/eslint-plugin-ijazah/rules/no-authority-in-input.js` gains a per-schema, per-field allow-list read from `packages/contracts/src/authority-allow-list.ts` keyed by the exported schema name (`onboardingCompleteInput`: `gender`, `role`), since the lint sees schema objects and not procedure paths; the test maps the schema to `onboarding.complete` through the snapshot and asserts the list holds that one schema with those two fields and nothing else; wired as a CI test (R-GENDER-6, FR-139)

### The phone app's foundation (ADR 0020 D7; research R-112)

- [ ] T030 [P] [MOBILE] The i18n runtime in `apps/mobile/src/i18n/index.ts`: `t(key, values)` over `ar.json`/`en.json` through `intl-messageformat`, the active locale, the guarded `@formatjs/intl-pluralrules` load, a `useT()` hook; spec in `i18n/index.spec.ts` (the five Arabic forms and zero where drawn; a missing key is a test failure, never a fallback string) (ADR 0020 D6)
- [ ] T031 [P] [MOBILE] The theme and direction providers in `apps/mobile/src/design/theme.tsx` (light/dark from the system, direction from the locale through `I18nManager` with the reload), `lib/direction.ts` and `lib/formatters.ts` (numerals, dates, times through `Intl` by locale; the only formatting layer, R-MOBILE-9); NativeWind wired in `design/tailwind.config.js` over the generated theme; specs
- [ ] T032 [MOBILE] The primitives' React Native code in `apps/mobile/src/design/primitives/*.tsx`, one file per contract group (Text, Icon over `lucide-react-native` and `icons.ts`, Button, IconButton, TextLink, Segmented, Chip, CheckRow, Choice, Picker, Select, Badge, Banner, Toast, EmptyState, Skeleton, Spinner, Card, Section, List, Summary, Avatar, IconTile, Field, Input, InputGroup, Otp, Upload, FileRow, Steps, Timeline, Sheet, Dialog, AppHeader, NavHeader, PageIntro, Brand, ActionBar, TabBar, SearchRow), each matching its block of `docs/design/components.md` and `components.css`, tokens only, logical direction only; a render test per primitive in both directions (R-MOBILE-4/5/6). After T030, T031
- [ ] T033 [P] [MOBILE] The client and storage in `apps/mobile/src/lib/client.ts` (the tRPC client with the bearer, the refresh on 401 through `auth.refresh` against the schema T038 publishes, sign-out on a refused refresh; the one network path) and `lib/storage.ts` (`expo-secure-store` for the two tokens; the one sensitive store); the `platform.publicConfig` cache; specs (R-MOBILE-10, R-MOBILE-11)
- [ ] T034 [MOBILE] The root layout `apps/mobile/src/app/_layout.tsx` (providers: theme, direction, i18n, query, client; the session guard that lands by `landing` (against the schemas T038 publishes; wired to the procedures in B10): no session → `(auth)/welcome`; student → `(student)/(tabs)`; teacher → by `teacher.applicationStatus`; restricted → `restricted`), the three group layouts, and the shell of the tab bars with the drawn empty and locked states for the tabs of later phases (`StudentHomeEmpty`, `TeacherHomeEmpty`, `PackagesLocked`, `AvailabilityEmpty`, `TeacherStudentsEmpty`, `DiscoveryNoTeachers`), and the generic states every tab root and list uses (`Skeleton`, `EmptyState`, the danger `Banner` with retry, the offline pattern; FR-205) (FR-202). After T032, T033

### The admin panel's foundation (ADR 0014; research R-113)

- [ ] T035 [P] [ADMIN] The admin i18n runtime `apps/admin/src/i18n/index.ts` over the admin catalogue, `dir`/`lang` on the root, `<bdi>` for user content (a `UserText` component); the language is client-side, kept in `localStorage` and never on the account (FR-175); spec
- [ ] T036 [P] [ADMIN] The design components in `apps/admin/src/design/components/`: the primitives on shadcn/ui at compact density themed by `tokens.css`, and the console pieces (Console, Sidebar/NavItem, Page/PageHeader/Toolbar, Split, DataTable, Panel, KeyValue, DocThumb, QueueCard, Pager, AuthCard), each matching `components.md`; render tests in both directions
- [ ] T037 [ADMIN] The client, session guard and router in `apps/admin/src/lib/client.ts` (the bearer from `sessionStorage`, cleared on 401), `App.tsx` (`react-router` with the paths of screens.md, the guard that sends an unverified or absent session to `/sign-in`, `/mfa` or `/mfa/setup` by the error code) and `main.tsx`; the `AdminNav` with the entries of this phase only (FR-176). After T035, T036

### The catalogue and the public configuration

- [ ] T038 [P] [KERNEL] `platform.publicConfig` (`{ supportEmail, termsVersion }`, public, `rate_limit_public_page`, cacheable) in `apps/api/src/platform/public-config.router.ts` mounted on the user surface, and `catalog.subjects.list` in `apps/api/src/modules/catalog/catalog.router.ts` with `catalog.service.ts`/`catalog.repository.ts` (active subjects, both names); schemas in `packages/contracts/src/platform.ts` and `catalog.ts`; and, contracts first, the schemas of `auth`, `onboarding` and `account` in `packages/contracts/src/auth.ts`, `onboarding.ts` and `account.ts` as contracts/app-surface.md lists them, so the phone foundation codes against them before T048 and T049 implement; a test in `packages/contracts` that no value of either phone catalogue equals a seeded subject name (FR-182; the two hint strings' render-time interpolation lands with Discovery in Phase 2); specs first (FR-145, FR-182)
- [ ] T039 [P] [KERNEL] The Terms route `GET /terms` in `apps/api/src/platform/web/terms/terms.controller.ts` inserting `apps/api/src/platform/web/terms/ar.html` and `en.html` (pre-rendered fragments, placeholder bodies marked for counsel, with the sections the drawn board lists; server-built files passed through `raw()`, no Markdown dependency) with the `terms_version` setting; spec through real HTTP (headers, escaping, `?lang=en`) (FR-127). After T019
- [ ] T040 [P] [KERNEL] The breached-password list: `scripts/dev/build-breached-list.ts` generating `apps/api/src/platform/crypto/breached-passwords/top-100k.bin` (sorted SHA-1 prefixes) from a published list recorded in the script's header, `breached-passwords/index.ts` with `isBreached(password)` by binary search (the kernel, outside the gate's root), and the password bounds as `packages/contracts/src/password.ts` (`min 8`, `max 128`, the one home of those two numbers); specs with known entries (research R-105, FR-128)
- [ ] T041 [KERNEL] The register's Phase 0 rows that this foundation touches: `specs/001-foundations/checklists/rule-proofs.md` rows R-HONEST-4 (T027), R-MOBILE-13 (T028), R-GENDER-6 (T029) cite their tests; the note under T130 in `specs/001-foundations/tasks.md` records the partial re-count. After T027–T029

**Checkpoint**: Foundation ready — the stories can begin.

---

## Phase 3: User Story 1 — A person signs in once and becomes exactly one account (Priority: P1) 🎯 MVP

**Goal**: The three sign-in paths, onboarding with the single transaction, sessions with rotation and revocation, password reset, the landing by standing, the language and time zone on the account tab.

**Independent Test**: quickstart §2 — each path to the home; an abandoned flow leaves zero rows; a returning person lands with no question asked twice.

### Tests for User Story 1 ⚠️

- [ ] T042 [P] [US1] `apps/api/src/modules/identity/sign-in.service.spec.ts`: a provider token verified through the stand-in with a nonce the server minted (`auth.providerNonce`), consumed once, a reused or unknown nonce refused; an unverified email treated as absent; a new identity yields an onboarding token, an existing one a session and its landing; `EMAIL_IN_USE_BY_OTHER_METHOD` with the method in all three directions (FR-120 to FR-123)
- [ ] T043 [P] [US1] `apps/api/src/modules/identity/onboarding.service.spec.ts`: the token's form and expiry; `complete` writes `users`, `auth_identities` (with the Apple refresh token decrypted from the token's blob) or the password hash, `user_roles`, `terms_acceptances` and a session in one transaction; a failure mid-way leaves zero rows; a second presentation of the `jti` is refused; `termsVersion` must equal the setting; an identity without a verified email requires `email` and `emailCode`; an abandoned flow leaves zero rows in every table (a sweep over the schema); `password` required exactly when the identity is an email and refused otherwise (FR-124 to FR-127, SC-103)
- [ ] T044 [P] [US1] `apps/api/src/modules/identity/session.service.spec.ts`: the access token's HMAC and expiry; refresh rotation; a reused refresh token within the grace answered once, after it revokes the session; sign-out revokes one row; `revokeAll(userId, reason)` revokes every row; `resolveUserSession` yields the standing of data-model §6 (FR-135, FR-108)
- [ ] T045 [P] [US1] `apps/api/src/modules/identity/email-auth.service.spec.ts`: the sign-up code sent for every well-formed address with the same `void` answer; `EMAIL_IN_USE_BY_OTHER_METHOD` answered by `verifySignUpCode` only after the code verifies, so no address is enumerated; code verification with the attempt cap and single use; sign-in with the decoy verify for an unknown email (`SIGN_IN_FAILED`, one timing); the reset request with the same sentence, the decoy hash on an unknown or provider address and the mail dispatched after commit without being awaited, so the timings agree; a reset signs in and revokes the other sessions; the mail recorded by the email stand-in carries the code (FR-120, FR-129, research R-104)
- [ ] T046 [P] [US1] `packages/contracts/src/auth.spec.ts` and `onboarding.spec.ts`: the schemas of contracts/app-surface.md; no input names `userId` or a timestamp; `gender` and `role` only on `onboarding.complete` (the allow-list); the password schema's bounds; `password` optional on `onboarding.complete`'s schema (the service requires it for an email identity) (R-TIME-6, R-GENDER-4)

### Implementation for User Story 1

- [ ] T047 [US1] `apps/api/src/modules/identity/sign-in.service.ts` (the nonce mint and its single-use Redis mark, the provider verification, the Apple exchange whose refresh token rides in the onboarding token as a cipher blob), `onboarding.service.ts` (the signed token under `ijazah:onboarding-token:v1`, the Redis mark through `platform/`'s Redis client, the one transaction), `session.service.ts` (the access token, rotation, `resolveUserSession`, `revokeAll`), `email-auth.service.ts`, with `identity.repository.ts` extended by the queries each needs; `identity/index.ts` exports `resolveUserSession` and `revokeAll` (FR-120 to FR-129, FR-135). After T042–T045
- [ ] T048 [US1] The routers: `apps/api/src/modules/identity/auth.router.ts` and `onboarding.router.ts` (thin: validate, one service call, return) with the schemas in `packages/contracts/src/auth.ts` and `onboarding.ts`, mounted on `app.router.ts`; each public procedure with its rate limit; the contract snapshot regenerated; each non-public procedure with its refusal case for T028's gate. After T047
- [ ] T049 [P] [US1] `account.me` (no count over another module's table: the credentials badge reads `teacher.credentials.list`), `account.setLanguage`, `account.setTimezone`, `account.reportDeviceTimezone`, `account.updateProfile` in `apps/api/src/modules/identity/account.router.ts` and `account.service.ts` with their schemas in `packages/contracts/src/account.ts`; `me`'s output names every field of contracts/app-surface.md and nothing else; specs first (FR-131, FR-132)
- [ ] T050 [US1] The sign-in screens in `apps/mobile/src/features/shared/auth/`: `Welcome` (language segmented, the three buttons; Apple on iOS only; the fake-provider button behind the development flag), `EmailSignIn` with its error state, `EmailSignUp`, `Otp` (six cells, resend countdown), `ForgotPassword`, `ResetPassword`, the `SignInConflict` sheet with its three bodies; routes under `app/(auth)/`; `api.ts` calling T048's procedures; render tests in both languages against the boards (FR-120 to FR-123, FR-129). After T034, T048
- [ ] T051 [US1] The onboarding screens in `apps/mobile/src/features/shared/onboarding/`: `Role`, `OnboardProfile` (terms unchecked, «متابعة» disabled until ticked; the email and code fields shown only when the token's identity has no verified email), `TimeZonePicker` (`time-zone` modal over the IANA city list of `@ijazah/time`), `Terms` (`terms` modal, a WebView of `/terms?lang=`), `ConfirmGender` and `ConfirmGenderTeacher`; `onboarding.complete` (not keyed; its `jti` is its single use); the landing after completion; render tests (FR-124 to FR-127). After T050
- [ ] T052 [US1] The account tab in `apps/mobile/src/features/student/account/` (`StudentAccount`: profile row, language segmented in place, time zone row → the picker, sign-in method, gender read-only, Terms, sign-out, delete row) and `shared/account/` (`SignOutSheet`), with `account.me` driving the landing in T034's guard; the teacher's `TeacherAccount` tab in `features/teacher/account/` with the same rows plus the teaching list's entries (credentials, payout; profile and signature as later-phase rows); render tests (FR-131). After T049, T051

**Checkpoint**: A person signs in by each path, onboards once, lands by standing, and can switch language and time zone.

---

## Phase 4: User Story 2 — A teacher applies with credentials only, and is reviewed by a person (Priority: P1)

**Goal**: The application with its documents, the status screen in every state, resubmission and reapplication, credentials after approval.

**Independent Test**: quickstart §3's device side — apply with two subjects; see each state as the admin acts (the admin's side is US3; until it lands, the service specs drive the states).

### Tests for User Story 2 ⚠️

- [ ] T053 [P] [US2] `apps/api/src/modules/verification/application.service.spec.ts`: submit refused without a credential per chosen subject (`APPLICATION_INCOMPLETE`); a foreign document (`DOCUMENT_NOT_OWNED`); submit writes `in_review`, the identity document and one pending credential per subject with `submitted_with_application`; resubmit from `needs_document` returns to `in_review`; reapply from `rejected` only; `banned` refused; `get` yields every drawn state (FR-150, FR-152, FR-155)
- [ ] T054 [P] [US2] `apps/api/src/modules/verification/credentials.service.spec.ts`: `add` refused for a subject with an approved or pending credential; `list` carries the chain on approved credentials only; `replaceDocument` only from `needs_document`; `documentLink` for the owner only (FR-153, FR-ISNAD-5)
- [ ] T055 [P] [US2] `packages/contracts/src/teacher-application.spec.ts`: no field of any application schema names a payout, bank, wallet or account (a test over the schema's keys), the subject count bound, the qualification length bound (FR-150, FR-VERIFY-11)

### Implementation for User Story 2

- [ ] T056 [US2] `apps/api/src/modules/verification/application.service.ts` and `verification.repository.ts`, writing the profile's application columns (data-model §3) through `identity/index.ts` (`setApplication`, added to `identity.service.ts` in this task) and reading a credential through `catalog/index.ts` (research R-121), `application.router.ts` (`teacher.application.*`, all `admits: 'applicant'`) with `packages/contracts/src/teacher-application.ts`; the refusal cases for the gate. After T053, T055
- [ ] T057 [US2] `apps/api/src/modules/verification/credentials.service.ts` and `credentials.router.ts` (`teacher.credentials.*`, merged under its namespace by `app.router.ts`) over `apps/api/src/modules/catalog/credentials.repository.ts` and the entry functions `catalog/index.ts` exports for the credential rows (`addCredential`, `listCredentials`, `replaceCredentialDocument`; `grantSubjects`), the documents and their links verification's own (R-121); schemas in `packages/contracts/src/teacher-credentials.ts`. After T054
- [ ] T058 [US2] The application screens in `apps/mobile/src/features/teacher/application/`: `ApplySubjects` (chips from `catalog.subjects.list`, the qualification field), `ApplyDocuments` (type segmented, the upload through `POST /uploads/documents` with `expo-document-picker`, the file row), `ApplyIjazah` (one upload per subject, submit disabled until complete), `ApplicationStatus` with `ApplicationRejected` (a banned account lands on `TeacherRestricted` through the guard, never here), `ApplicationApproved` (once, then the tabs; the profile-editor link marked Phase 2), `ApplicationMoreInfo` (the note, replace, resubmit); routes under `app/(teacher)/application/`; render tests (FR-150, FR-152). After T034, T056
- [ ] T059 [US2] The credentials screens in `apps/mobile/src/features/teacher/credentials/`: `TeacherCredentials` (the cards, the read-only `Chain` feature component in `features/shared/credentials/components/Chain.tsx`), `CredentialNeedsDocument`, `AddSubject`, the `SubjectPicker` sheet; routes under `app/(teacher)/credentials/`; render tests (FR-153). After T057

**Checkpoint**: A teacher applies end to end against the stand-ins and sees every state the services can produce.

---

## Phase 5: User Story 3 — An admin is a different kind of principal, and leaves a record (Priority: P1)

**Goal**: Admin sign-in with the second factor, lockout and recovery; the applications queue and its decisions; the credential review and corrections; documents and identity demands; a teacher's standing; the admins page; the audit log and the home.

**Independent Test**: quickstart §3 (the admin side) and §4.

### Tests for User Story 3 ⚠️

- [ ] T060 [P] [US3] `apps/api/src/modules/admin/admin-auth.service.spec.ts`: TOTP against RFC 6238's vectors; sign-in's one answer for an unknown email, a wrong password, a disabled account, an unset password and a locked account, with the decoy verify so the timings agree within tolerance; the lockout pair against the two settings; a wrong code counts; recovery codes single-use and regenerable; setup confirms and enrolls; `resetMfa` clears, rotates, deletes the codes and revokes the sessions; the invite link single use by `password_set_at`; the throttle before the lockout (FR-170 to FR-174, SC-109)
- [ ] T061 [P] [US3] `apps/api/src/modules/admin/admin-session.service.spec.ts`: the opaque token's hash; `mfa_verified_at` null until verified; idle and absolute limits from settings; `resolveAdminSession` yields `mfaVerified`; sign-out and revoke-all (FR-170)
- [ ] T062 [P] [US3] `apps/api/src/modules/verification/application-review.service.spec.ts`: the queue's three tabs and search; `recordCall`; `approve` refused with each `APPROVAL_BLOCKED` reason (call not recorded, a credential undecided, none approved) and allowed once all hold, granting the approved credentials' subjects through `catalog/index.ts` (`grantSubjects`); `reject`, `requestInfo` (sets `needs_document`), `ban` (the account banned, sessions revoked); each described on `ctx.audit` with its reason (FR-160 to FR-162)
- [ ] T063 [P] [US3] `apps/api/src/modules/catalog/credential-review.service.spec.ts`: `approve` writes the chain origin first as `isnad_entries` and refuses a second approved credential for the subject; `reject` and `requestDocument` need a reason; `correct` records the chain before and after (FR-163, FR-164)
- [ ] T064 [P] [US3] `apps/api/src/modules/verification/verification-request.service.spec.ts` and `apps/api/src/modules/identity/standing.service.spec.ts`: `requireIdentity` opens the request and sets `verification_required`; `accept` closes and reactivates; `requestAnother` keeps it open; the user's `submit` attaches the document; `suspend`/`revokeApproval`/`ban`/`reinstate` change the standing, revoke the sessions and call the one consequences entry (`onAccountTerminated(tx, userId, cause)`, a registry Phase 2 and 3 subscribe to; empty now) (FR-165, FR-166, FR-142)
- [ ] T065 [P] [US3] `apps/api/src/modules/admin/audit-query.service.spec.ts` and `home.service.spec.ts`: the list with the stored label and the resolved name; a renamed target changes no label; a deleted person resolves to the role word; the home's two queue cards and seven latest actions (FR-176, FR-181)

### Implementation for User Story 3

- [ ] T066 [US3] `apps/api/src/modules/admin/admin-auth.service.ts` (TOTP through `otplib` behind `apps/api/src/platform/crypto/totp.ts`, the lockout, the decoy, recovery codes through the identifiers module (`admin_recovery_code_count` of them; the symbol count is the kernel's format constant), the lock expiry resetting the count, the accepted TOTP step recorded, the invite token under `ijazah:admin-invite:v1`), `admin-session.service.ts`, `admins.service.ts` (add → `deliver-admin-invite` queued in `apps/api/src/jobs/deliver-admin-invite.ts` with its double-run case; disable; resetMfa; regenerate), `admin-users.repository.ts` extended; `admin/index.ts` exports `resolveAdminSession`. After T060, T061
- [ ] T067 [US3] The admin routers: `apps/api/src/modules/admin/auth.router.ts` (`adminPublicProcedure` for `auth.signIn`, `auth.mfa.*`, `auth.setPassword`; `adminProcedure` for `signOut`, `me`), `admins.router.ts`, `audit.router.ts`, `home.router.ts` with `audit-query.service.ts` and `home.service.ts`; schemas in `packages/contracts/src/admin/*.ts` exported separately from the user surface (R-API-11); mounted on `admin.router.ts`; a test that the admin surface's public procedures are exactly `auth.*`. After T065, T066
- [ ] T068 [US3] `apps/api/src/modules/verification/application-review.service.ts` with `applications.router.ts` (the profile and the account status written through `identity/index.ts`; the decision history served by `audit.list` filtered on the target), `verification-request.service.ts` with `documents.router.ts` and the user-side `identity-verification.router.ts` (`account.identityVerification.*`, merged under `account` by `app.router.ts`; identity imports nothing of verification, R-121) (`documents.link` audited as `document.view`, `users.requireIdentity`, `documents.accept`, `documents.requestAnother`); `apps/api/src/modules/identity/standing.service.ts` with `teachers.router.ts` (`teachers.suspend`, `revokeApproval`, `ban`, `reinstate`) and the consequences registry in `identity/consequences.ts`; schemas. After T062, T064
- [ ] T069 [US3] `apps/api/src/modules/catalog/credential-review.service.ts` and `credentials-admin.router.ts` (`credentials.list`, `get`, `approve`, `reject`, `requestDocument`, `correct`); schemas. After T063
- [ ] T070 [ADMIN] The sign-in pages in `apps/admin/src/pages/sign-in/`, `pages/mfa/` (`AdminMfa`, `AdminMfaRecovery`, `AdminMfaSetup` with the QR, the manual key, the ten codes and the checkbox, the download), `pages/set-password/` (from the invite link); `AdminSignInError`; render tests in both languages (FR-170 to FR-174). After T037, T067
- [ ] T071 [ADMIN] `pages/applications/` (`AdminApplications` with its three tabs, search, table, detail panel, the call record form, the four actions), the `AdminDecisionDialog` with its three segments (reject, request info, ban) from screens.md §24, the `approveApplication` confirm variant, and `AdminDocumentViewer` as the overlay with its `context` parameter (user, application, credential) over `documents.link`; render tests (FR-160 to FR-162, FR-166). After T037, T068
- [ ] T072 [ADMIN] `pages/credentials/` (`AdminCredentials` with its four tabs, the transcription panel: holder name, riwaya, tariq, the chain generations with `ChainInput`; the three actions; `AdminCredentialCorrect` with the before/after line), the `approveCredential`, `requestCredentialDocument`, `rejectCredential` and `saveCredentialCorrection` confirm variants; render tests (FR-163, FR-164). After T037, T069
- [ ] T073 [ADMIN] `pages/settings/admins/` (`AdminAdmins` with the two tabs, the table, the detail; `AdminAddAdminDialog`; `AdminMfaResetDialog`; disable with its confirm; regenerate recovery codes on the own account), `pages/audit/` (`AdminAudit` with search, the date chip, the table with the stored label and the resolved name, the detail with before/after), `pages/home/` (`AdminHome` with the two queue cards of this phase and the latest actions; `AdminHomeEn`), the `AdminSuspendDialog` family (suspend, revoke, ban) and `teachers.reinstate` (the drawn «إعادة تفعيل» dialog) reached from the applicant's or teacher's detail; `AdminQueueEmpty` and `AdminLoadError` patterns; render tests (FR-173 to FR-176, FR-181). After T037, T067, T068
- [ ] T074 [US3] The restricted and identity screens on the phone: `restricted` (`AccountRestricted`, `TeacherRestricted` with the banned title; a revoked approval lands on `ApplicationRejected` through `reapply`, so decision 34's revoked title is retired) in `features/shared/account/`, `VerifyIdentity` in `features/shared/account/` at the route `verify-identity` outside the role groups (either role under a verification request) over `account.identityVerification.*` and the uploads route, the `mailto:` of «تواصل مع الدعم» from the cached `supportEmail`; the guard in T034 lands a restricted session here; render tests (FR-137, FR-145, FR-166). After T034, T068

**Checkpoint**: An admin signs in with the second factor, decides an application, transcribes a chain, and every action is in the log with a non-personal label.

---

## Phase 6: User Story 4 — An approved teacher sets up payout and stays invisible until the gateway says so (Priority: P2)

**Goal**: Payout registration through the port, the recipient events routed by hash, the four payout screens, the standing that refuses publishing.

**Independent Test**: quickstart §6.

### Tests for User Story 4 ⚠️

- [ ] T075 [P] [US4] `apps/api/src/modules/identity/payout.service.spec.ts` and `apps/api/src/modules/payments/recipient-events.spec.ts`: `register` stores the reference encrypted and row-bound with its hash and `payout_configured_at`, clears `payout_verified_at` (first setup and replacement); a signed `recipient_verified` event sets the instant, a `recipient_rejected` the reason; a replayed event id changes nothing; an unknown hash is recorded, reported and changes no row; no raw account number in any column, log line or response (a sweep over the stand-in's records) (FR-190 to FR-194)
- [ ] T076 [P] [US4] `apps/api/src/surfaces/procedures.spec.ts` gains "`admits: 'publishable'` refuses an approved teacher whose payout is unverified and admits one whose payout is verified" (FR-192)

### Implementation for User Story 4

- [ ] T077 [US4] `apps/api/src/modules/identity/payout.service.ts` (the port's `registerPayoutRecipient`, the reference encrypted with its lookup hash on identity's own table, `markPayoutVerified(hash)` / `markPayoutRejected(hash, reason)` exported from `identity/index.ts`), and the webhook branch in `payments/webhook.controller.ts` with `payments/recipient-events.service.ts`, which records the signed event and calls identity's two entries (payments → identity, never back; research R-121), `PayoutDetails` published as provisional in `packages/contracts/src/payout.ts`; `teacher.payout.get` and `register` in `identity/payout.router.ts` (`admits: 'approved'`); the refusal cases. After T075, T076
- [ ] T078 [US4] The payout screens in `apps/mobile/src/features/teacher/payout/`: `PayoutStart` (the button calls `register` with the provisional details on a development build; the hosted onboarding is Phase 2's), `PayoutSetup`, `PayoutVerified`, `PayoutRejected` (the gateway's reason, the support line from the cached `supportEmail`); routes under `app/(teacher)/payout/`; the `ApplicationApproved` row 1 and the `TeacherAccount` payout row land here; render tests (FR-190 to FR-194). After T034, T077
- [ ] T079 [P] [US4] `scripts/dev/emit-recipient-event.ts`: drives the stand-in's signed webhook with a verified or rejected verdict for a teacher (quickstart §6), reusing the stand-in's derived secret; a spec that a replay is a no-op end to end

**Checkpoint**: An approved teacher registers, is rejected with a reason, is verified, and is refused by a publishable kind in between.

---

## Phase 7: User Story 5 — A person deletes their account, in the app or on the web (Priority: P2)

**Goal**: The in-app deletion with its three steps and the one transaction, the web deletion, the confirmation mail, the public routes with their headers.

**Independent Test**: quickstart §5.

### Tests for User Story 5 ⚠️

- [ ] T080 [P] [US5] `apps/api/src/modules/identity/deletion.service.spec.ts`: the typed word in either language; re-authentication by a fresh provider token (nonce) whose subject is one of the caller's own `auth_identities` rows, or the password against the caller's own hash; a valid token of another identity refused; the one transaction erasing every personal field of ADR 0015 D3, deleting `auth_identities`, revoking every session (`account_deleted`), removing push tokens, erasing a teacher's bio, documents and payout columns, keeping the audit rows; the Apple revoke through the port with the stored refresh token; the email freed (a new sign-up with it succeeds); the consequences registry called with `account_deleted`; the confirmation mail after commit (FR-140 to FR-142, SC-111)
- [ ] T081 [P] [US5] `apps/api/src/modules/identity/web/delete-account.spec.ts` through real HTTP: the email step answers one page for every address with the same timing (the decoy hash on an unknown address, the mail dispatched after commit) and writes an `account_deletion` code only for an account; the confirm step runs the deletion and renders the done page with the address and the support address; a wrong code renders the code step with the generic error; the CSP and the header set on every response, no `Set-Cookie`, `?lang=en`, the email never in a URL (FR-143, FR-144)

### Implementation for User Story 5

- [ ] T082 [US5] `apps/api/src/modules/identity/deletion.service.ts` and `account.delete` in `account.router.ts` with its schema (`admitsRestricted`, `rate_limit_authentication` by the caller, the idempotency key); the identity repository's erasure query; the mail templates in `identity/mail/` (the deletion confirmation, the one-time code, the password reset) in both languages through the escaping renderer. After T080
- [ ] T083 [US5] The web deletion routes in `apps/api/src/modules/identity/web/delete-account.controller.ts` (`GET /delete-account`, `POST /delete-account`, `POST /delete-account/confirm`) over T019's helper, rendering `DeleteAccountWeb`, `DeleteAccountWebCode` and `DeleteAccountWebDone` from the `web.deleteAccount.*` catalogue keys (the phone catalogue's `web` group is the source; a build step copies the two groups the API renders into `apps/api/src/platform/web/i18n/` under `check:generated`). After T081, T082
- [ ] T084 [US5] The deletion screens on the phone: `DeleteAccount` and `DeleteAccountSheet` in `features/student/account/` (the warning with the enrollment count, zero in this phase; the typed word; the sheet's provider or password re-authentication), `DeleteAccountTeacher` and its sheet in `features/teacher/account/`, `StudentProfileEditor` (the name, and the photo through `POST /uploads/photos`, date of birth and gender locked) in `features/student/account/`; routes; render tests (FR-140, FR-141). After T052, T082

**Checkpoint**: A deleted account is erased, its tokens dead, its email free; the web page does the same under the strict headers.

---

## Phase 8: Proofs, the register and the owner's runs

**Purpose**: What closes the phase: the adversarial subjects, the floor, the register's re-count, the dev scripts the quickstart names, the runbook, and the two device steps that are the owner's.

- [ ] T085 [P] [PROOF] The two inverted subjects in `tests/adversarial/gender.spec.ts` (`noGenderConjunct`, `asymmetricV11`) with the `expectToBite` block asserting each disagrees with the case table in both directions, and nothing else red (FR-211, research R-119)
- [ ] T086 [P] [PROOF] Widen the coverage floor in `packages/config/vitest.base.ts` to `apps/api/src/modules/identity/**`, `verification/**`, `catalog/**`, `admin/**` at 80 on all four measures; `tests/pipeline/suite-gate.spec.ts`'s floor case follows (FR-213, R-PROC-5)
- [ ] T087 [P] [PROOF] The dev scripts of quickstart.md in `scripts/dev/`: `count-person.ts` (rows of a person across every table, by email or id), `audit-tail.ts`, `admin-lockout-probe.ts` (the timing comparison with its tolerance), each read-only against the local database and never shipped (SC-103, SC-108, SC-109)
- [ ] T088 [P] [PROOF] `docs/RUNBOOK.md` gains the mobile section of "Local setup" (the development client on a physical device, the fake-provider flag, where the mails land) and "Common operations" gains the admin invite and the second-factor reset; `docs/design/screens.md`'s "web (where it is served is an open decision)" cells say the API (ADR 0021 D5)
- [ ] T089 [PROOF] Re-count T130's register `specs/001-foundations/checklists/rule-proofs.md`: R-GENDER-1, R-GENDER-3 (T085), R-GENDER-6 (T029), R-MOBILE-13 (T028), R-HONEST-4 (T027) proven with their tests cited; the Summary's counts and lists updated; Phase 1's own count zero; the note under T130 in `specs/001-foundations/tasks.md` records it and the rows that remain name Phases 2 to 4 only (FR-217, SC-112). After T085
- [ ] T090 [PROOF] The owner's device run of SC-101: on the owner's iOS and Android devices, from a fresh install, the end-to-end teacher application timed and recorded in this task's note (the owner's step; quickstart §3). After T058, T074
- [ ] T091 [PROOF] The owner's device run of SC-105: every screen of this phase in Arabic and in English on both devices against its board, the result recorded per screen in this task's note (the owner's step; quickstart §7). After T084
- [ ] T092 [PROOF] Run quickstart.md end to end on `develop` after the last batch merges, record the outcome under this line, and state in `PLAN.md` the day the phase closed and, if the seven days were exceeded, the overflow and its cause and what went to the descope ladder (SC-115). After T089–T091

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001–T007 in one batch
- **Foundational (Phase 2)**: Depends on Setup; blocks every story. Within it: the ERD pass (T008–T013) first, in migration order; the document pass (T014–T015) beside it; the kernel (T016–T021) after T012; the ports and uploads (T022–T024); the jobs and gates (T025–T029); the two foundations (T030–T037) after T006/T007; T038–T040 beside them; T041 last
- **US1 (P1)**: After Foundational; the services (T042–T049) before the screens (T050–T052)
- **US2 (P1)**: After Foundational; independent of US1's services, but its screens need T034 and the teacher landing of T052
- **US3 (P1)**: After Foundational; T064's standing service is what US4's `publishable` and US5's consequences registry build on, so US3's services come before US4 and US5
- **US4 (P2)**: After US3's T068 (the standing) and US2's T057 (the approved teacher)
- **US5 (P2)**: After US1's T047 (sessions, the provider port's revoke) and US3's T068 (the registry)
- **Proofs (Phase 8)**: T085–T088 any time after Foundational; T089 after T085; T090 after the teacher flow; T091 after every screen; T092 last

### Cross-story notes

- **The one consequences entry.** `identity/consequences.ts` (T068) is the seam deletion, suspension, revocation and ban all call; it is empty in this phase and Phase 2 and Phase 3 register their enrollment and session consequences on it. Nothing in this phase cancels a session or an enrollment, because none exists.
- **The profile editor and the payout row.** `ApplicationApproved` links to three next steps; row 1 (payout) is T078's, row 2 (the public profile editor, FR-PROFILE-1) is Phase 2's and the link lands then, row 3 (`PackagesLocked`) is T034's locked state.
- **No notification row is written** (FR-154): the status, payout and credentials screens carry the state on the next open.
- **The admin invite needs the email stand-in's mail folder** to be read by the owner (quickstart §4); the first admin is the seed's.

### Within each story

- Tests first, observed red for the right reason; then the service, then the router with its schemas and refusal cases, then the screens from their boards
- A screen task names its board and reads `docs/design/screens.md`'s row and `components.md`'s contracts; copy from the catalogue only
- Every public procedure declares its rate limit; every procedure its output; every non-public procedure its refusal spec for the gate (T028)

### Parallel Opportunities

- Setup: T002–T007 parallel after T001
- Foundational: T008, T014, T015 parallel with T009; T016, T018–T023, T025–T029 parallel after T012; T030, T031, T033, T035, T036, T038–T040 parallel
- US1: T042–T046 parallel; T049 beside T047
- US2: T053–T055 parallel; T056 and T057 parallel
- US3: T060–T065 parallel; T066–T069 parallel after their specs; T070–T073 parallel after their routers
- US4: T075, T076, T079 parallel
- US5: T080, T081 parallel

---

## Batches (PLAN.md: at most six tasks, one branch, one pull request, one review)

The order is the dependency order above; a batch is cut from `develop` after the one before it merges. Two batches in flight never write the same file or mark adjacent lines of this file.

| Batch                       | Tasks                                                                                                    | Branch                              | What it leaves                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| B1 Setup                    | T001–T006                                                                                                | `Ejazah_app/002-identity/T001-T006` | the keys, the rows, the manifest, the assets, the labels, the phone dependencies                                              |
| B2 Setup and the ERD pass   | T007, T008–T012                                                                                          | `…/T007-T012`                       | the admin dependencies; the six migrations with their probes                                                                  |
| B3 The passes               | T013–T015                                                                                                | `…/T013-T015`                       | the schema check green; the documents amended; the pointers                                                                   |
| B4 The kernel               | T016–T021                                                                                                | `…/T016-T021`                       | the kinds, the resolvers, the idempotency actor, the web helper, the upload kinds, the audit label                            |
| B5 Ports, uploads, jobs     | T022–T025, T038, T039                                                                                    | `…/T022-T039`                       | the two ports, the uploads route, the sweeps, the public configuration, the Terms page                                        |
| B6 Rules and gates          | T026–T029, T040, T041                                                                                    | `…/T026-T029`                       | the lint rule, the leak test, the authorization gate, the gender-input test, the breached list, the first register rows       |
| B7 The phone's foundation   | T030–T034                                                                                                | `…/T030-T034`                       | the runtime, the providers, the primitives, the client, the root layout and shells                                            |
| B8 The admin's foundation   | T035–T037                                                                                                | `…/T035-T037`                       | the runtime, the components, the router and guard                                                                             |
| B9 US1 services             | T042–T047                                                                                                | `…/T042-T047`                       | sign-in, onboarding, sessions, email auth                                                                                     |
| B10 US1 surface and screens | T048–T052                                                                                                | `…/T048-T052`                       | the routers, the account procedures, the auth, onboarding and account screens                                                 |
| B11 US2                     | T053–T059 (seven: the three specs are one review unit with their services; stated here as the real need) | `…/T053-T059`                       | the application and credentials, services to screens                                                                          |
| B12 US3 services            | T060, T061, T065, T066, T067                                                                             | `…/T060-T067`                       | the admin's own sign-in, sessions, invite, audit and home: specs, services and routers, green                                 |
| B13 US3 API                 | T062, T063, T064, T068, T069                                                                             | `…/T062-T069`                       | the application review, the credential review, the standing and the verification requests: specs, services and routers, green |
| B14 US3 panel               | T070–T074                                                                                                | `…/T070-T074`                       | the admin pages and the restricted screens                                                                                    |
| B15 US4                     | T075–T079                                                                                                | `…/T075-T079`                       | payout, end to end against the stand-in                                                                                       |
| B16 US5                     | T080–T084                                                                                                | `…/T080-T084`                       | deletion in the app and on the web                                                                                            |
| B17 Proofs                  | T085–T089                                                                                                | `…/T085-T089`                       | the subjects, the floor, the scripts, the runbook, the register                                                               |
| B18 Close                   | T090–T092                                                                                                | `…/T090-T092`                       | the owner's runs and the quickstart on `develop`                                                                              |

A branch is named by the first and last task id of its batch; where a batch is not contiguous (B5, B12, B13) the tasks column is the list, and no batch is specs alone: every batch merges green (R-PROC-4). Eighteen batches for seven working days is the honest count; PLAN.md's rule applies: an overflow is stated the day it is seen, with its cause, and goes to the descope ladder rather than being absorbed. The batches most likely to be the overflow's cause, in order, are B14 (the admin pages), B10 (the phone screens) and B4 (the kernel); the specification's Risk assumption names the same three.

---

## Implementation Strategy

### MVP scope

B1–B10: a person signs in by each path, onboards once, lands by standing, and manages language and time zone. Everything a later batch needs from the kernel exists after B6.

### Incremental delivery

- B11 adds the teacher's application and credentials; B12–B14 the admin who decides them — the first full journey (SC-101) is demonstrable after B14.
- B15 adds payout; B16 deletion; B17 the proofs; B18 the owner's runs and the close.

### Notes

- A task's note goes under its line, as in Phase 0; a decision taken while implementing is recorded there with the owner's word where one was asked.
- Jira is a read-only archive (owner's decision, 2026-10-17): no card is created, moved or commented for any task here.
- The branch rule (`pnpm check:branch`) reads this folder's name: every batch branch is `Ejazah_app/002-identity/<ids>`.
