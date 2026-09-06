---

description: "Task list for Phase 0 — Foundations"
---

# Tasks: Phase 0 — Foundations

**Input**: Design documents from `/specs/001-foundations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included, and not optional here. The specification requires them by name — SC-003 requires a reproducible failing case for every machine-enforced rule, FR-019 makes two DST edge-case tests mandatory, and SC-005 requires the whole suite to pass with no credential present. In this phase a test that *fails on purpose* is the deliverable, not a check on one.

**Organization**: Grouped by the seven user stories in spec.md, in priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: US1–US7, mapping to spec.md
- Every task names its file path

## Path Conventions

Three applications from one monorepo, per plan.md: `apps/mobile/`, `apps/admin/`, `apps/api/` (whose worker is a second process at `src/worker.ts`, not a fourth application; routers live under `src/surfaces/`), plus `packages/` and `prisma/` at the root. Task branches are cut from `develop` and named `Ejazah_app/<phase>/<task id or range>`, e.g. `Ejazah_app/001-foundations/T001`; they open pull requests into `develop` (ADR 0005 D9). Commit subjects: `Ejazah_app(<phase>): <task id or range> description`, e.g. `Ejazah_app(001-foundations): T001 create the pnpm workspace root`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The workspace every later task is written inside.

- [ ] T001 Create pnpm workspace root with `pnpm-workspace.yaml` and root `package.json` declaring the scripts named in quickstart.md
- [ ] T002 [P] Create strict TypeScript base config in `packages/config/tsconfig.base.json` with `strict` and `noUncheckedIndexedAccess` enabled per research R-2
- [ ] T003 [P] Create formatter config in `packages/config/prettier.config.js`
- [ ] T004 [P] Create base ESLint config in `packages/config/eslint.base.js`, wired to consume the internal plugin added in T034
- [ ] T005 [P] Create shared test-runner config in `packages/config/vitest.base.ts` with per-path coverage thresholds left empty for now, filled in T086
- [ ] T006 [P] Scaffold the user application at `apps/mobile/` with the route-group tree (`src/app/(auth)`, `(student)`, `(teacher)`) and empty `src/features/{student,teacher,shared}/`
- [ ] T007 [P] Scaffold the administrator application at `apps/admin/` with `src/` and its build config
- [ ] T008 [P] Scaffold the backend at `apps/api/` with `src/main.ts` and `src/worker.ts` entrypoints sharing `src/modules/`
- [ ] T009 [P] Scaffold `packages/contracts/` as the only shared type surface
- [ ] T010 Create `.env.example` covering every configuration value, with no real secret in it, and `.gitignore` excluding `.env`
- [ ] T011 Install and configure a native pre-commit hook manager at repository root, with no hooks registered yet (filled by T048 and T082)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure without which no user story can start or be tested.

**⚠️ CRITICAL**: No user story work begins until this phase completes.

- [ ] T012 Create `docker-compose.yml` at repository root running PostgreSQL 18 and Redis with health checks — required by US2 to test against a real database and by US3 to run the stack
- [ ] T013 Initialise the ORM with a multi-file schema layout in `prisma/schema/base.prisma`, holding the datasource, generator and every centrally declared enum per data-model.md §2
- [ ] T014 Define both database connection strings in `.env.example` — a migration URL for the owner role and a runtime URL for the application role, per research R-5
- [ ] T015 Create the configuration schema and startup loader in `apps/api/src/platform/config/env.schema.ts` and `config.module.ts`, validating every value before the process accepts traffic
- [ ] T016 [P] Create the domain-to-module ownership manifest in `packages/config/module-tables.json` from data-model.md §1 (twelve modules: identity, verification, catalog, booking, payments, sessions, chat, certification, reviews, moderation, notifications, admin — ADR 0005 D2, ADR 0007 D4), consumed later by the ownership lint rule in T047
- [ ] T017 [P] Create the twelve empty backend module folders under `apps/api/src/modules/`, each with `index.ts` and a `README.md` stating what it owns and what it must never do
- [ ] T018 Create the pipeline skeleton in `.github/workflows/ci.yml` with the five stages of research R-13 ordered by how fast they fail, each stage a no-op placeholder

**Checkpoint**: Workspace builds, database runs, configuration validates. User stories can begin.

---

## Phase 3: User Story 1 — A violation is refused before a human has to notice it (Priority: P1) 🎯 MVP

**Goal**: An engineer who breaks a project rule is stopped in the editor, at the commit, or in the pipeline, and the refusal names the constitution rule.

**Independent Test**: For each rule with a build-time or compile-time mechanism, introduce a deliberate violation on a throwaway branch and confirm it is refused and the message names the rule. Run `pnpm test:violations`.

### Tests for User Story 1 ⚠️

> Write these first. Each asserts a violation is **refused** — they must fail while the rule is missing, then pass once it exists.

- [ ] T019 [P] [US1] Create the inverted-test harness in `tests/violations/harness.ts` that lints a fixture and asserts both failure and the rule identifier in the message
- [ ] T020 [P] [US1] Boundary violation fixtures and assertions in `tests/violations/boundaries.spec.ts` covering R-MOBILE-1, R-MOBILE-2, R-API-3, R-API-4
- [ ] T021 [P] [US1] Layer violation fixtures in `tests/violations/layers.spec.ts` covering R-API-1, R-API-2 and R-API-6
- [ ] T022 [P] [US1] Design and localisation fixtures in `tests/violations/mobile.spec.ts` covering R-MOBILE-4 through R-MOBILE-11
- [ ] T023 [P] [US1] Money fixtures in `tests/violations/money.spec.ts` covering R-MONEY-1, R-MONEY-2, R-MONEY-5 and R-MONEY-6
- [ ] T024 [P] [US1] Time fixtures in `tests/violations/time.spec.ts` covering R-TIME-1
- [ ] T025 [P] [US1] Gender fixture in `tests/violations/gender.spec.ts` covering R-GENDER-5 — an unfiltered repository method must be refused
- [ ] T026 [P] [US1] Security and process fixtures in `tests/violations/security.spec.ts` covering R-SEC-2, R-SEC-11, R-DB-6, R-API-10, R-PROC-7, R-PROC-8, R-PROC-10
- [ ] T027 [P] [US1] Coverage assertion in `tests/violations/completeness.spec.ts` asserting every rule id in `contracts/lint-rules.md` has a fixture, so SC-003's count of unproven rules stays zero
- [ ] ~~T028~~ Retired (ADR 0005 D1): share splitting no longer exists. Id kept so citations resolve.
- [ ] T029 [P] [US1] DST tests in `packages/time/src/resolve.spec.ts` against real Cairo transition dates: weekly recurrence across spring-forward and fall-back, a nonexistent local time, and an ambiguous one (FR-018, FR-019)

### Implementation for User Story 1

- [ ] T030 [US1] Implement the branded money type and constructors in `packages/money/src/index.ts` using a non-exported `unique symbol`, making plain numbers and piasters mutually unassignable (FR-012, research R-3)
- [ ] ~~T031~~ Retired (ADR 0005 D1): share splitting no longer exists.
- [ ] T032 [US1] Implement the time package in `packages/time/src/index.ts` over `@js-temporal/polyfill`, exposing the project's own types and never a Temporal object (FR-017, research R-4)
- [ ] T033 [US1] Implement per-occurrence recurrence resolution in `packages/time/src/resolve.ts` — each occurrence from its own local date and the slot's local time, never by adding intervals (FR-018)
- [ ] T034 [US1] Scaffold the internal lint plugin at `packages/config/eslint-plugin-ijazah/index.js`, with the naming convention that every rule is named for its constitution rule and every message ends with that identifier (FR-011)
- [ ] T035 [P] [US1] Implement boundary rules in `packages/config/eslint.boundaries.js` — `boundaries/no-cross-role-import`, `boundaries/no-role-import-in-shared`, `boundaries/no-deep-module-import`, `boundaries/no-adapter-import`, `boundaries/no-upward-admin-import` (FR-004), plus `boundaries/no-money-vocabulary` refusing piaster, wallet or ledger vocabulary outside `payments` (FR-016) (`boundaries/no-money-vocabulary` now refuses wallet, ledger, balance, escrow, payout and withdrawal vocabulary anywhere under `apps/**`, per R-MONEY-6 as redefined by ADR 0005)
- [ ] T036 [P] [US1] Implement `api/no-orm-outside-repository` in `packages/config/eslint-plugin-ijazah/rules/no-orm-outside-repository.js` (FR-005), and `api/no-logic-in-router` in `rules/no-logic-in-router.js` as a complexity ceiling on `*.router.ts` (FR-071)
- [ ] T037 [P] [US1] Implement the design and direction rules — `mobile/no-raw-color`, `mobile/no-physical-direction`, `mobile/no-raw-control` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-006, FR-007)
- [ ] T038 [P] [US1] Implement the localisation rules — `mobile/no-literal-string`, `mobile/no-translated-concat`, `mobile/no-manual-format` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-006)
- [ ] T039 [P] [US1] Implement the client-side safety rules — `mobile/no-insecure-storage`, `mobile/no-direct-network` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-006)
- [ ] T040 [P] [US1] Implement the security rules — `sec/no-disabled-tls`, `db/no-weak-random`, `sec/no-body-logging` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-009, FR-010, FR-044)
- [ ] T041 [P] [US1] Implement the escape-hatch and process rules — `api/require-escape-hatch-reason` for `any` and `@ts-ignore` (R-API-10), `proc/require-suppression-reason` for `eslint-disable` (R-PROC-7), `proc/no-focused-or-skipped-test`, `proc/no-bare-marker` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-008)
- [ ] T042 [P] [US1] Implement `api/no-push-outside-job` in `packages/config/eslint-plugin-ijazah/rules/no-push-outside-job.js` (FR-057)
- [ ] T131 [P] [US1] Implement `money/no-number-in-money-position` in `packages/config/eslint-plugin-ijazah/rules/no-number-in-money-position.js`, refusing a declared money position typed as plain `number` rather than the branded type (FR-072)
- [ ] T132 [P] [US1] Implement `time/no-datetime-outside-package` in `packages/config/eslint-plugin-ijazah/rules/no-datetime-outside-package.js`, refusing `Date` arithmetic and datetime library imports outside `packages/time` (FR-017)
- [ ] T043 [US1] Enable type-aware linting in `packages/config/eslint.base.js` by pointing the parser at the project, and split the configuration into fast and type-aware sets per research R-10
- [ ] T044 [P] [US1] Implement `money/no-arithmetic-outside-package` in `packages/config/eslint-plugin-ijazah/rules/no-money-arithmetic.js`, flagging any binary-expression operand carrying the brand (FR-013)
- [ ] T045 [P] [US1] Implement `money/require-piaster-suffix` in `packages/config/eslint-plugin-ijazah/rules/require-piaster-suffix.js`, resolving the identifier's type rather than guessing from its name (FR-014)
- [ ] T046 [P] [US1] Implement `gender/require-requester-gender` in `packages/config/eslint-plugin-ijazah/rules/require-requester-gender.js`, refusing a repository method returning teachers whose signature omits the requester's gender (FR-005)
- [ ] T047 [P] [US1] Implement `api/table-ownership` in `packages/config/eslint-plugin-ijazah/rules/table-ownership.js`, reading the manifest from T016 (FR-005)
- [ ] T048 [US1] Register the fast rule set in the pre-commit hook and both sets in the pipeline, in `.husky/pre-commit` and `.github/workflows/ci.yml`

**Checkpoint**: Every deliberate violation is refused and names its rule. `pnpm test:violations` is green, meaning every red case went red for the right reason.

---

## Phase 4: User Story 2 — The database refuses what the rules forbid (Priority: P1)

**Goal**: An attempt to delete an audit record, hard-delete a protected row, or replay a provider attendance event is rejected by the database itself, with no application code in the path.

**Independent Test**: Connect as the application role and attempt each forbidden statement directly. Run `pnpm test:db-integrity`.

### Tests for User Story 2 ⚠️

- [ ] T049 [P] [US2] Create the integrity-probe harness in `tests/db-integrity/harness.ts` that connects **as the application role**, not the owner
- [ ] T050 [P] [US2] Privilege probes in `tests/db-integrity/privileges.spec.ts`: delete on users, sessions, enrollments, ijazahs and audit logs — all refused (SC-004)
- [ ] T051 [P] [US2] Constraint probes in `tests/db-integrity/constraints.spec.ts` covering all nine original integrity rules of the model (SC-007)
- [ ] T052 [P] [US2] Replay probes in `tests/db-integrity/replay.spec.ts`: a duplicate `provider_event_id` on `session_participant_events` and on `payment_events` refused as unique, a NULL `payment_events.provider_event_id` refused as not-null, a duplicate `payments.gateway_order_id` refused (FR-036, FR-073, ERD §15.4/13/14)
- [ ] T053 [P] [US2] Soft-deletion behaviour in `tests/db-integrity/soft-delete.spec.ts`: marked rows absent from reads and counts, a deleted user's phone number reusable, a soft-deleted enrollment absent from reads and not reviewable (ADR 0006)
- [ ] T054 [P] [US2] Audit append-only probe in `tests/db-integrity/audit.spec.ts`: deletion refused and no deletion column exists to set instead

### Implementation for User Story 2

- [ ] T055 [P] [US2] Model the identity and verification domains in `prisma/schema/identity.prisma` and `verification.prisma` per ERD §2–3, with `deleted_at` on users, the encrypted and hashed columns of data-model.md §7, and the payout readiness columns on `teacher_profiles` (FR-075)
- [ ] T056 [P] [US2] Model the catalog domain in `prisma/schema/catalog.prisma` per ERD §4, with availability stored as local wall-clock beside a zone column
- [ ] T057 [P] [US2] Model the booking domain in `prisma/schema/booking.prisma` (`slot_holds`, `enrollments` with `deleted_at`, `confirmed_at` and `cancellation_reason`) and the sessions domain in `prisma/schema/sessions.prisma` (`sessions` with `deleted_at`, `session_participant_events`, `cancellation_requests`) per ERD §5, with no client-writable attendance field
- [ ] T058 [P] [US2] Model the chat domain in `prisma/schema/chat.prisma` per ERD §6
- [ ] T059 [P] [US2] Model the payments domain in `prisma/schema/payments.prisma` per ERD §7 — `payments` and `payment_events`, unique gateway identifiers, unique NOT NULL provider event id, and no balance column anywhere (FR-027, FR-073; reinstated by ADR 0007 after ADR 0005 retired the escrow version)
- [ ] T060 [P] [US2] Model the certification domain in `prisma/schema/certification.prisma` per ERD §8, with the hashed verification token and `deleted_at` on ijazahs
- [ ] T061 [P] [US2] Model the community and moderation domains in `prisma/schema/reviews.prisma` and `moderation.prisma` per ERD §9–10
- [ ] T062 [P] [US2] Model the notification domain in `prisma/schema/notifications.prisma` per ERD §11
- [ ] T063 [P] [US2] Model the admin domain in `prisma/schema/admin.prisma` per ERD §12 — administrator identity sharing no table with users, and audit logs with no deletion column
- [ ] T134 [P] [US2] Model the platform kernel domain in `prisma/schema/platform.prisma` per ERD §12 — `idempotency_keys` with unique `(scope, key)`, `request_hash`, `response`, `status`, `expires_at` (FR-042, ADR 0008 D2)
- [ ] T064 [US2] Create the initial migration from the schema, then extend it by hand with the check constraints of data-model.md §6 that the schema language cannot express (research R-6)
- [ ] T065 [US2] Add the role and privilege migration in `prisma/migrations/` — create both roles, revoke delete on the five tables (users, sessions, enrollments, ijazahs, audit_logs), and set default privileges so the next migration cannot silently reopen the door (FR-025, FR-026)
- [ ] T066 [US2] Add the two partial unique indexes as raw SQL — `users.phone` and `users.email`, each `WHERE deleted_at IS NULL` (data-model.md §4). `reviews.enrollment_id` stays a plain unique constraint (ADR 0006 D3)
- [ ] T067 [US2] Add the partial index on scheduled sessions declared in ERD §14, and no index beyond that section (FR-035)
- [ ] T068 [P] [US2] Implement column encryption in `apps/api/src/platform/crypto/encryption.ts` — authenticated encryption above the database so the key never enters a query (FR-031, research R-8)
- [ ] T069 [P] [US2] Implement hashing in `apps/api/src/platform/crypto/hashing.ts` — a memory-hard function for passwords and one-time codes, a fast unsalted hash for lookup tokens (research R-9)
- [ ] T070 [US2] Implement the schema-check script in `scripts/schema-check.ts`, querying the live catalogue for timezone-less timestamps, wrong column-name suffixes, bare secret columns, the two `users` partial indexes missing or `reviews.enrollment_id` made partial (ADR 0006), and a cached-derived-value count other than two (FR-024, SC-014)
- [ ] T071 [US2] Wire migration checksum verification and the schema check into the pipeline in `.github/workflows/ci.yml` (FR-037)

**Checkpoint**: Every forbidden statement is refused by the database as the application role. The revocations are real, not conventional.

---

## Phase 5: User Story 3 — An engineer reaches an identical running system in one sitting (Priority: P1)

**Goal**: A clone, a documented sequence, and a running system holding data identical to every teammate's — with no credential requested.

**Independent Test**: On a machine that has never seen the project, follow only the written steps. Then compare the seed checksum with a teammate on a different date in a different timezone.

### Tests for User Story 3 ⚠️

- [ ] T072 [P] [US3] Determinism test in `tests/seed/determinism.spec.ts` — seeding twice produces an identical checksum, and seeding under a shifted clock and timezone produces the same one
- [ ] T073 [P] [US3] Clean-migrate test in `tests/seed/migrate-from-empty.spec.ts` — the full history applies to an empty database in one run and yields every table in the model and none outside it (SC-006)

### Implementation for User Story 3

- [ ] T074 [US3] Implement the deterministic seed in `prisma/seed.ts` — subjects in both languages, settings keys with defaults, one administrator, and nothing else — with fixed identifiers and no dependence on the machine clock or zone (FR-038, data-model.md §10)
- [ ] T075 [P] [US3] Implement the seed checksum tool in `scripts/seed-checksum.ts` and wire `db:seed:checksum` into the root scripts
- [ ] T076 [P] [US3] Wire the development orchestration script so one command starts all three applications and the worker process
- [ ] T077 [US3] Write the local setup and database reset procedure in `docs/RUNBOOK.md`, including the rule that a diverged database is rebuilt from migrations rather than patched (R-DB-2)
- [ ] T078 [US3] Document the migration workflow in `docs/RUNBOOK.md` — generated, extended by hand, reviewed, merged, then never touched — and state explicitly why this does not conflict with the ban on editing generated files (plan.md post-design re-check item 1)

**Checkpoint**: A new engineer reaches a running seeded system from the runbook alone, and two machines hold identical data.

---

## Phase 6: User Story 4 — A proven change reaches staging with nobody deploying it (Priority: P2)

**Goal**: The pipeline proves a change, the branch refuses what it should refuse, and a merge becomes live on staging with no human action.

**Independent Test**: Merge a trivial visible change and watch it reach staging. Attempt each forbidden merge path and confirm refusal.

### Tests for User Story 4 ⚠️

- [ ] T079 [P] [US4] Contract snapshot diff test in `tests/pipeline/contract-snapshot.spec.ts` — a removal or rename fails, an addition passes without comment (FR-063)
- [ ] T080 [P] [US4] Secret-scanning test in `tests/pipeline/secret-scan.spec.ts` asserting the local check and the pipeline check each reject a planted secret independently, including one placed under `specs/` (SC-010)

### Implementation for User Story 4

- [ ] T081 [US4] Fill the pipeline stages in `.github/workflows/ci.yml` — typecheck and fast lint, then tests, then type-aware lint with schema and snapshot checks, then database probes, then build (research R-13)
- [ ] T082 [P] [US4] Configure Gitleaks as a pre-commit hook in `.husky/pre-commit` (FR-059)
- [ ] T083 [P] [US4] Add Gitleaks to the pipeline in `.github/workflows/ci.yml` scanning the full history including `specs/`, as a net independent of the hook (FR-059)
- [ ] T084 [P] [US4] Implement the contract snapshot generator in `scripts/contract-snapshot.ts`, recording every procedure path and enum member (FR-063)
- [ ] T085 [P] [US4] Implement the generated-file drift check in `scripts/generated-file-check.ts` (FR-062)
- [ ] T086 [US4] Configure per-path coverage thresholds in `packages/config/vitest.base.ts` — the 80% floor on `packages/money`, `packages/time` and the kernel's guard and error paths, and nowhere else yet (FR-062)
- [ ] T087 [P] [US4] Wire the gender-enforcement suite as a blocking gate in `.github/workflows/ci.yml` with its harness at `tests/adversarial/gender.spec.ts`, running from this phase even while its case coverage is small (FR-064). The harness runs every case in both directions against the SRS §3.7.1 visibility predicate (ADR 0006)
- [ ] T088 [P] [US4] Create the review template at `.github/pull_request_template.md` carrying the twelve review-only checklist items verbatim and no other rule (FR-065)
- [ ] T089 [US4] Configure branch protection on `main` and `develop` — no direct push, one approving review, green pipeline required (FR-058, ADR 0005 D9)
- [ ] T090 [P] [US4] Enable dependency alerting and push protection, and add the critical-alert merge block to the pipeline (FR-060)
- [ ] T091 [US4] Implement the branch-to-spec-directory check in `scripts/branch-spec-check.ts` and wire it into the pipeline (FR-061); `develop` and `main` are exempt as the integration and release branches (ADR 0005 D9); every other branch must be named `Ejazah_app/<phase>/<task id or range>` with the phase segment matching a `specs/NNN-*` folder, and pull requests must target `develop`
- [ ] T092 [US4] Provision the staging environment and the deploy-on-merge workflow in `.github/workflows/deploy-staging.yml` — **blocked on the staging host and data residency decisions in research R-18 and R-19** (FR-066)

**Checkpoint**: Every forbidden merge path fails, and a merge reaches staging unaided within fifteen minutes.

---

## Phase 7: User Story 5 — Every request inherits safe behaviour from the kernel (Priority: P2)

**Goal**: Configuration, logging, error shape, idempotency, throttling, sniffing, auditing and health — all inherited, none re-implemented per module.

**Independent Test**: Start with an invalid configuration and confirm refusal. Drive a request that fails deep in the stack and inspect exactly what the client receives and what the log recorded.

### Tests for User Story 5 ⚠️

- [ ] T093 [P] [US5] Configuration refusal test in `apps/api/src/platform/config/config.spec.ts` — a missing or malformed value exits naming it, before traffic is accepted (FR-039)
- [ ] T094 [P] [US5] Error shape test in `apps/api/src/platform/errors/error-filter.spec.ts` — one shape out, no stack trace, query text or internal path, and a forbidden profile answering 404 rather than 403 (FR-041)
- [ ] T095 [P] [US5] Redaction test in `apps/api/src/platform/logging/logger.spec.ts` — a sensitive value nested inside a legitimately passed object is still absent from the record (FR-040)
- [ ] T096 [P] [US5] Idempotency test in `apps/api/src/platform/idempotency/idempotency.spec.ts` — a repeated operation returns the first outcome and does not repeat the effect (FR-042)
- [ ] T097 [P] [US5] Sniffing test in `apps/api/src/platform/guards/upload.spec.ts` using a renamed image — content decides, the declaration is discarded rather than compared (FR-044)
- [ ] T098 [P] [US5] Surface disjointness test in `apps/api/src/surfaces/surfaces.spec.ts` — the two capability sets share nothing, and the user surface's generated types carry zero administrative capabilities (FR-048, SC-012)
- [ ] T099 [P] [US5] Audit test in `apps/api/src/surfaces/admin-procedure.spec.ts` — an administrative action cannot complete without its audit record, because the caller kind writes it (FR-049)

### Implementation for User Story 5

- [ ] T100 [P] [US5] Implement the structured logger with its declared redaction list in `apps/api/src/platform/logging/logger.ts` (FR-040, research R-17)
- [ ] T101 [P] [US5] Implement the global error filter and single error shape in `apps/api/src/platform/errors/error-filter.ts` and `domain-error.ts` (FR-041)
- [ ] T102 [P] [US5] Implement the idempotency mechanism in `apps/api/src/platform/idempotency/idempotency.service.ts` over the `idempotency_keys` table (T134), keyed in the database rather than the cache so one transaction covers key and effect, with the `expire-idempotency-keys` job sweeping expired rows (FR-042, research R-14, ADR 0008)
- [ ] T103 [P] [US5] Implement rate limiting in `apps/api/src/platform/guards/rate-limit.guard.ts`, available to any endpoint and applied by default to authentication, one-time-code and search paths (FR-043)
- [ ] T104 [P] [US5] Implement upload content sniffing in `apps/api/src/platform/guards/upload.middleware.ts` (FR-044)
- [ ] T105 [P] [US5] Implement cryptographic identifier generation in `apps/api/src/platform/guards/identifiers.ts` for certificate numbers and verification tokens (FR-045)
- [ ] T133 [P] [US5] Implement the webhook signature guard in `apps/api/src/platform/guards/webhook-signature.guard.ts`, verifying on the raw body before any handler and rejecting unsigned or invalid requests; test in `webhook-signature.spec.ts` against the payment stand-in's valid and invalid signatures (FR-074, R-MONEY-9)
- [ ] T106 [US5] Implement the request context in `apps/api/src/surfaces/context.ts` — identity, role, gender, locale and correlation identifier, all server-resolved, with no client-supplied timestamp or authorization field expressible (FR-046)
- [ ] T107 [US5] Implement the four caller kinds in `apps/api/src/surfaces/procedures.ts`, each requiring an input schema so validation cannot be skipped (FR-047, FR-050)
- [ ] T108 [US5] Make the administrator caller kind write its own audit record in `apps/api/src/surfaces/procedures.ts`, leaving no administrative route around it (FR-049)
- [ ] T109 [US5] Mount both surfaces separately in `apps/api/src/surfaces/app.router.ts` and `admin.router.ts` (FR-048)
- [ ] T110 [P] [US5] Implement liveness and readiness endpoints in `apps/api/src/platform/health/health.controller.ts`, answering different questions (FR-051)
- [ ] T111 [P] [US5] Wire error reporting in `apps/api/src/platform/errors/reporting.ts` (FR-051)
- [ ] T112 [US5] Implement the queue and the double-run assertion pattern in `apps/api/src/worker.ts` and `apps/api/src/jobs/`, sharing the modules rather than holding a second copy of any rule (FR-052)
- [ ] T113 [US5] Implement settings reading in `apps/api/src/modules/admin/settings.service.ts` — every operational number read from the store, none written from application code (FR-034)

**Checkpoint**: A request inherits every guarantee without its author writing one.

---

## Phase 8: User Story 6 — Nothing in the domain knows a vendor's name (Priority: P2)

**Goal**: Five ports (payment, storage, video, push, sms) named in the project's own terms, each with a stand-in, and a suite that passes with no credential present.

**Independent Test**: Clear every third-party credential and run the complete suite.

### Tests for User Story 6 ⚠️

- [ ] T114 [P] [US6] No-credential suite run in `tests/ports/no-credentials.spec.ts` asserting the full suite passes with every provider variable unset (SC-005)
- [ ] T115 [P] [US6] Storage contract test in `apps/api/src/platform/ports/storage/storage.spec.ts` asserting no operation returns a durable public path and every link expires (FR-055)

### Implementation for User Story 6

- [ ] T116 [P] [US6] Define the storage port and both real implementations in `apps/api/src/platform/ports/storage/` — local and remote, selected by configuration (FR-055)
- [ ] T117 [P] [US6] Define the payment port and its stand-in in `apps/api/src/platform/ports/payment/` — create checkout, verify and parse an inbound event, register a payout recipient, report recipient status; no balance, transfer or refund operation exists (contracts/ports.md, ADR 0007). The stand-in can emit valid and invalid signatures so FR-074 is testable
- [ ] T118 [P] [US6] Define the video port and its stand-in in `apps/api/src/platform/ports/video/`, with a join token bound to one session **and** one participant so an unbound token is unrepresentable (R-GENDER-7)
- [ ] T119 [P] [US6] Define the push port and its stand-in in `apps/api/src/platform/ports/push/`, with payloads carrying identifiers for deep-linking only (R-HONEST-5)
- [ ] T120 [P] [US6] Define the messaging port and its stand-in in `apps/api/src/platform/ports/sms/` (contracts/ports.md)
- [ ] T121 [US6] Implement provider selection at startup in `apps/api/src/platform/ports/ports.module.ts`, so switching is configuration and no calling module branches on which provider is active (FR-056)
- [ ] T122 [US6] Make each stand-in record what it was asked to do and support induced failure, so failure paths are exercised without a network (contracts/ports.md)

**Checkpoint**: The whole suite passes on a machine holding no credential.

---

## Phase 9: User Story 7 — Two named risks are closed with written evidence (Priority: P3)

**Goal**: Two technical unknowns tested on real hardware and closed with a recorded decision.

**Independent Test**: Read the two written outcomes. Each states what was tested, on what hardware and network, what was observed and what was decided.

- [ ] T123 [P] [US7] Run the video baseline spike between physical devices over a mobile network and record the outcome in `docs/adr/0003-video-baseline.md` (FR-069)
- [ ] T124 [P] [US7] Render an Arabic right-to-left certificate carrying a twenty-five entry chain, inspect layout, letter shaping and pagination, and record the outcome in `docs/adr/0004-arabic-certificate-rendering.md` (FR-070)

**Checkpoint**: Both spikes closed with decisions, not notes.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] ~~T125~~ Removed (ADR 0005 D8): ARCHITECTURE §9 already states local wall-clock plus zone; the premise was stale.
- [x] T126 [P] Record every amendment this phase made to a governing document in `docs/adr/0005-phase-0-document-amendments.md` (FR-068) — done 2026-09-05
- [ ] T127 [P] Write the leaked-credential procedure in `docs/RUNBOOK.md` — rotate first, investigate second (FR-067, R-SEC-10)
- [ ] T128 [P] Add the module authoring guide to `docs/RUNBOOK.md`, so a new module arrives with its ownership statement and its manifest entry rather than without them
- [ ] T129 Run the full `quickstart.md` validation end to end, including the checks that must fail
- [ ] T130 Confirm every rule in `.specify/memory/constitution.md` with a machine tier has a proven failing case, and that the count of unproven ones is zero (SC-003)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — blocks every user story
- **US1, US2, US3 (P1)**: All depend on Foundational; independent of each other
- **US4, US5, US6 (P2)**: Depend on Foundational. US4's pipeline stages reference gates built in US1 and US2, so US4 is most usefully done after them
- **US7 (P3)**: Depends only on Setup — the spikes need devices, not the kernel
- **Polish (Phase 10)**: Depends on the stories it validates

### Cross-story notes

- **US1 owns `packages/money` and `packages/time`.** Both are placed here rather than in Foundational because their reason for existing in this phase is the rules they make enforceable — a branded type nothing checks is decoration.
- **US4 consumes what US1 and US2 build.** Its pipeline stages wire gates those stories create. It can start in parallel with placeholder stages, but T081 is only meaningful once they exist.
- **US7 is genuinely independent.** It needs physical devices and can run at any point, including first — useful if a device is only briefly available.
- **T092 is blocked externally.** The staging deploy waits on the host and data-residency decisions in research R-18 and R-19. Everything else in US4 proceeds without them.

### Within each story

- Tests first, and confirm each fails for the right reason before implementing
- Packages before the rules that depend on their types
- Schema before migrations before probes
- Kernel before the surfaces that mount it

### Parallel Opportunities

- Setup: T002–T009 all parallel
- US1: all nine test tasks parallel; then the syntax rules T035–T042 and T131–T132 parallel; then the type-aware rules T044–T047 parallel
- US2: all six probe suites parallel; the nine schema-domain files T055–T063 parallel
- US5: all seven test tasks parallel; the kernel components T100–T105 parallel
- US6: all five port definitions parallel (payment, storage, video, push, sms)
- US7: both spikes parallel, and parallel with everything else

---

## Parallel Example: User Story 1

```bash
# Write all the inverted tests together — each must fail before its rule exists:
Task: "Boundary violation fixtures in tests/violations/boundaries.spec.ts"
Task: "Layer violation fixtures in tests/violations/layers.spec.ts"
Task: "Design and localisation fixtures in tests/violations/mobile.spec.ts"
Task: "Money fixtures in tests/violations/money.spec.ts"
Task: "Time fixtures in tests/violations/time.spec.ts"
Task: "Gender fixture in tests/violations/gender.spec.ts"
Task: "Security and process fixtures in tests/violations/security.spec.ts"

# Then the syntax-only rules, one file each:
Task: "Implement mobile/no-raw-color, no-physical-direction, no-raw-control"
Task: "Implement mobile/no-literal-string, no-translated-concat, no-manual-format"
Task: "Implement sec/no-disabled-tls, db/no-weak-random, sec/no-body-logging"
Task: "Implement api/require-escape-hatch-reason, proc/require-suppression-reason, no-focused-or-skipped-test, no-bare-marker"
```

---

## Implementation Strategy

### MVP scope

**US1 alone is the MVP**, and it is a real one. With Setup, Foundational and US1 complete, the wall exists: every boundary, money, time, design, localisation and process rule refuses a violation and names it. From that moment no later phase can quietly cross a line, which is the whole argument for building this phase separately.

The order that follows is not arbitrary. US1 first because a rule that arrives after the code it governs arrives to find violations already in place. US2 second because the database revocations must exist before the first row is written. US3 third because it is the phase's usability, not its correctness.

### Incremental delivery

1. Setup + Foundational → the workspace builds and the database runs
2. **US1** → the wall stands. Stop and validate: try to break each rule by hand
3. **US2** → history becomes unalterable. Stop and validate: probe as the application role
4. **US3** → a new engineer can join in an afternoon
5. **US5** → requests inherit their guarantees
6. **US6** → the suite runs with no credentials
7. **US4** → gates and staging, wiring what the earlier stories built
8. **US7** → the two spikes, at any point devices are available

### Parallel team strategy

After Foundational, three tracks run cleanly with little contention:

- **Track A**: US1, then US4's gate wiring — the enforcement thread
- **Track B**: US2, then US3 — the data thread
- **Track C**: US5, then US6 — the runtime thread

US7 belongs to whoever has physical devices, at whatever moment they have them.

---

## Notes

- Every task names a file path, and every user-story task carries its story label
- In this phase, a test that fails on purpose is a deliverable. Confirm each red case is red for the right reason before making it green — a violation test that passes because the fixture is malformed proves nothing
- Commit per task or per logical group; stop at any checkpoint to validate a story alone
- T092 is the only externally blocked task. If the staging decisions are slow, everything else in US4 still lands
