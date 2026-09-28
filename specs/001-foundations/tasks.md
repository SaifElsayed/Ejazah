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

- [x] T001 Create pnpm workspace root with `pnpm-workspace.yaml` and root `package.json` declaring the scripts named in quickstart.md
- [x] T002 [P] Create strict TypeScript base config in `packages/config/tsconfig.base.json` with `strict` and `noUncheckedIndexedAccess` enabled per research R-2
- [x] T003 [P] Create formatter config in `packages/config/prettier.config.js`
- [x] T004 [P] Create base ESLint config in `packages/config/eslint.base.js`, wired to consume the internal plugin added in T034
- [x] T005 [P] Create shared test-runner config in `packages/config/vitest.base.ts` with per-path coverage thresholds left empty for now, filled in T086
- [x] T006 [P] Scaffold the user application at `apps/mobile/` with the route-group tree (`src/app/(auth)`, `(student)`, `(teacher)`) and empty `src/features/{student,teacher,shared}/` — done 2026-09-06
- [x] T007 [P] Scaffold the administrator application at `apps/admin/` with `src/` and its build config — done 2026-09-06
- [x] T008 [P] Scaffold the backend at `apps/api/` with `src/main.ts` and `src/worker.ts` entrypoints sharing `src/modules/` — done 2026-09-06

> **Note on T006–T008 dependencies (PR #3, 2026-09-07).** PR #2 declared Expo, React, Vite, Nest, tRPC, BullMQ and Zod under these three tasks; that was outside their text and was reverted in PR #3. `pnpm-lock.yaml` was **not changed** by the revert: regenerating it from the restored manifests produced the file already on `develop`. A dependency is declared by the task that first imports it, in the package that imports it, with the lockfile committed in the same commit.
- [x] T009 [P] Scaffold `packages/contracts/` as the only shared type surface — done 2026-09-07
- [x] T010 Create `.env.example` covering every configuration value, with no real secret in it, and `.gitignore` excluding `.env` — done 2026-09-07
- [x] T011 Install and configure a native pre-commit hook manager at repository root, with no hooks registered yet (filled by T048 and T082) — done 2026-09-07
  > **Note under T010 (PR #4, 2026-09-07).** T010 changed only comments: the file already covered every value the Phase 0 documents name. Two further values are *described* by the documents but not *named* by any of them (an externally reachable origin for webhooks, ARCHITECTURE §15; a video-provider webhook signing secret, kernel.md guards); they are deliberately not invented here and are named by **T015**, which owns the configuration schema. **T014** is already satisfied: both connection strings are present per research R-5, so T014 is a verification-only task for its owner.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure without which no user story can start or be tested.

**⚠️ CRITICAL**: No user story work begins until this phase completes.

- [x] T012 Create `docker-compose.yml` at repository root running PostgreSQL 18 and Redis with health checks — required by US2 to test against a real database and by US3 to run the stack — done 2026-09-07
  > **Note under T012 (PR #7, 2026-09-07).** Verification-only: the baseline file already ran PostgreSQL 18 and Redis with health checks; no change.
- [x] T013 Initialise the ORM with a multi-file schema layout in `prisma/schema/base.prisma`, holding the datasource, generator and every centrally declared enum per data-model.md §2 — done 2026-09-07
  > **Note under T013 (PR #7).** `PaymentGateway` is deliberately not declared: the ERD allows only integrated gateways, none exists (OPEN-11), Prisma cannot declare an empty enum, and members are permanent (R-API-9). T059 declares it. Two decisions travel with it to T059: whether the test stand-in adapter gets its own member, and whether config must refuse the stand-in when `NODE_ENV=production` (R-HONEST-1).
- [x] T014 Define both database connection strings in `.env.example` — a migration URL for the owner role and a runtime URL for the application role, per research R-5 — done 2026-09-07
- [x] T015 Create the configuration schema and startup loader in `apps/api/src/platform/config/env.schema.ts` and `config.module.ts`, validating every value before the process accepts traffic. The schema must cover every key in `.env.example` and name the two values T010 left unnamed (public webhook origin, video-provider webhook secret). `ENCRYPTION_KEY` is required in every environment, development included; there is no development bypass and no unencrypted code path (decided 2026-09-07). quickstart §1 carries the generate step — done 2026-09-07
  > **Note under T015 (PR #7, 2026-09-07).** Entrypoint wiring of `loadConfigOrExit` into `apps/api/src/main.ts` and `worker.ts` is owned by whichever of T109/T110/T112 lands first; it must be the first call, before anything listens. Until then neither entrypoint calls it.
- [x] T016 [P] Create the domain-to-module ownership manifest in `packages/config/module-tables.json` from data-model.md §1 (twelve modules: identity, verification, catalog, booking, payments, sessions, chat, certification, reviews, moderation, notifications, admin — ADR 0005 D2, ADR 0007 D4), consumed later by the ownership lint rule in T047 — done 2026-09-07
  > **Note under T016 (PR #8, 2026-09-07).** Verification-only: the manifest already matched ERD v1.3 / data-model §1 (33 tables, each under exactly one owner, `idempotency_keys` under `platform`). Two lines outside this task’s paths were reconciled in the same PR on the author’s decision: research R-11 and plan.md still said "eleven domains" from before ADR 0007 D4 / ADR 0008 and now say twelve (plus the platform kernel). For **T047**: the manifest carries a `$comment` key; the rule must skip `$`-prefixed keys or it will treat them as a fourteenth owner.
- [x] T017 [P] Create the twelve empty backend module folders under `apps/api/src/modules/`, each with `index.ts` and a `README.md` stating what it owns and what it must never do — done 2026-09-07
- [x] T018 Create the pipeline skeleton in `.github/workflows/ci.yml` with the five stages of research R-13 ordered by how fast they fail, each stage a no-op placeholder — done 2026-09-07

**Checkpoint**: Workspace builds, database runs, configuration validates. User stories can begin.

---

## Phase 3: User Story 1 — A violation is refused before a human has to notice it (Priority: P1) 🎯 MVP

**Goal**: An engineer who breaks a project rule is stopped in the editor, at the commit, or in the pipeline, and the refusal names the constitution rule.

**Independent Test**: For each rule with a build-time or compile-time mechanism, introduce a deliberate violation on a throwaway branch and confirm it is refused and the message names the rule. Run `pnpm test:violations`.

### Tests for User Story 1 ⚠️

> Write these first. Each asserts a violation is **refused** — they must fail while the rule is missing, then pass once it exists.

- [x] T019 [P] [US1] Create the inverted-test harness in `tests/violations/harness.ts` that lints a fixture and asserts both failure and the rule identifier in the message — done 2026-09-08
- [x] T020 [P] [US1] Boundary violation fixtures and assertions in `tests/violations/boundaries.spec.ts` covering R-MOBILE-1, R-MOBILE-2, R-API-3, R-API-4 — done 2026-09-08
- [x] T021 [P] [US1] Layer violation fixtures in `tests/violations/layers.spec.ts` covering R-API-1, R-API-2 and R-API-6 — done 2026-09-08 (R-API-15 case added to the same file with T027, see its note)
  > **Note under T019–T021 (PR #9, 2026-09-08).** `pnpm test` on `develop` is red by exactly ten cases on purpose, and stays red until T035, T036 and T047 land. That is what SC-003 asks for: a rule claiming a machine mechanism with no reproducible failing case is unproven, and these ten are the proof. Do not silence one with `.skip` or `.only` — R-PROC-10 exists to keep that route closed — and do not weaken an assertion. The harness prints `the rule did not refuse the fixture` for the expected state and `HARNESS BROKEN` when the fixture never reached the linter; only the second is a defect.
  >
  > Fixtures are real files under `tests/violations/fixtures/`, mirroring the real tree, because `api/table-ownership` is type-aware and cannot resolve a query target in a string no TypeScript program has seen. The directory is excluded from `pnpm lint` (`packages/config/eslint.base.js` `ignores`) and from `tsc --build` (root `tsconfig.json` `exclude`); the harness reads it with ESLint's ignore list switched off. Four decisions travel from here to later tasks and are repeated under each: **T035** path matching, **T036** the ceiling and the client specifier, **T047** the delegate-to-table mapping, **T055–T063** the ambient client shim.
- [x] T022 [P] [US1] Design and localisation fixtures in `tests/violations/mobile.spec.ts` covering R-MOBILE-4 through R-MOBILE-11 — done 2026-09-08
- [x] T023 [P] [US1] Money fixtures in `tests/violations/money.spec.ts` covering R-MONEY-1, R-MONEY-2, R-MONEY-5 and R-MONEY-6 — done 2026-09-08
- [x] T024 [P] [US1] Time fixtures in `tests/violations/time.spec.ts` covering R-TIME-1 — done 2026-09-08
- [x] T025 [P] [US1] Gender fixture in `tests/violations/gender.spec.ts` covering R-GENDER-5 — an unfiltered repository method must be refused — done 2026-09-09
- [x] T026 [P] [US1] Security and process fixtures in `tests/violations/security.spec.ts` covering R-SEC-2, R-SEC-11, R-DB-6, R-API-10, R-PROC-7, R-PROC-8, R-PROC-10 — done 2026-09-09
  > **Note under T025–T026 (PR pending, 2026-09-09).** Eleven more cases, so `pnpm test` on `develop` is now red by thirty-six on purpose. All eleven report `the rule did not refuse the fixture`; none reports `HARNESS BROKEN`. Four decisions travel to later tasks.
  >
  > **The runner now excludes the fixture tree.** R-PROC-10's two fixtures are real `*.spec.ts` files carrying `.only` and `.skip` — that is the prohibition — and `tests/**/*.spec.ts` in the root `vitest.config.ts` would have collected them. A collected fixture runs as a real test: the `.only` one passes and the `.skip` one reports skipped, and in CI Vitest refuses a `.only` outright (`allowOnly`), failing the run. `vitest.config.ts` gained `exclude: [...configDefaults.exclude, 'tests/violations/fixtures/**']`, the runner's half of the exclusion `tsconfig.json` and `packages/config/eslint.base.js` already carried. Keep fixture test files named `*.spec.ts`: **T041** has to recognise them as test files, and renaming them to dodge collection would make the rule's own path matching untestable.
  >
  > **T041** gets one fixture per half, as T024 did for R-TIME-1: R-API-10 is `modules/notifications/payload-cast.ts` (`any`) and `modules/moderation/report-count.ts` (`@ts-ignore`); R-PROC-8 is `modules/booking/hold-expiry.ts` (bare TODO) and `modules/chat/attachment-filter.ts` (commented-out block); R-PROC-10 is `modules/reviews/reviews.service.spec.ts` (`.only`) and `modules/notifications/notifications.service.spec.ts` (`.skip`). The justification-comment and ticket syntax that satisfies R-API-10 and R-PROC-7 is deliberately not invented here — no fixture carries a passing example — so T041 picks it and records it in the rule files. R-PROC-7's fixture (`modules/verification/review-code.ts`) suppresses `ijazah/db/no-weak-random` on a line that genuinely violates it, so once **T040** lands the directive is used and R-PROC-7 is the only error left; until then the harness prints a severity-1 `Unused eslint-disable directive` beside it, which is not a failure.
  >
  > **T040** owns how wide `sec/no-disabled-tls` reaches. `platform/ports/sms/sms.transport.ts` carries `rejectUnauthorized: false`, the only spelling the constitution names; the "and equivalents" of contracts/lint-rules.md (a `NODE_TLS_REJECT_UNAUTHORIZED` assignment, an agent accepting any certificate) is one prohibition expressed differently and was not guessed at in a fixture. R-SEC-2's fixture passes `req.body` to a logger imported from `platform/logging/logger.ts`, a support file declaring the logger shape T100 will implement.
  >
  > **T046** must not need a query. `modules/catalog/catalog.repository.ts` returns teachers and imports no database client on purpose: SRS §3.7.1 puts the predicate in catalog's repository, but `teacher_profiles` belongs to `identity` in `packages/config/module-tables.json`, so a query there would let `api/table-ownership` (R-API-6) refuse the same file a second time. The rule therefore has to decide from the resolved return type and the parameter list, which is what makes it type-aware. The legal counterpart — the same method taking the requester's gender — is deliberately absent from the fixture, so a rule that merely greps the file for the word cannot go green.
- [x] T027 [P] [US1] Coverage assertion in `tests/violations/completeness.spec.ts` asserting every rule id in `contracts/lint-rules.md` has a fixture, so SC-003's count of unproven rules stays zero — done 2026-09-09
  > **Note under T027 (2026-09-09).** The completeness check found a rule the contract publishes that no fixture task named: `api/no-push-outside-job` (R-API-15, "never send a notification inline"). T020–T026 between them cover the other 29 ids. On the author's decision the missing case was added to `tests/violations/layers.spec.ts` (the `api/*` family) with fixture `apps/api/src/modules/booking/notify-inline.ts` and a support port stub `platform/ports/push/push.port.ts`, so this check can reach zero once T025 and T026 land. The fixture imports the port's public entry, not an adapter, so R-API-4 does not double-flag it.
- [ ] ~~T028~~ Retired (ADR 0005 D1): share splitting no longer exists. Id kept so citations resolve.
- [x] T029 [P] [US1] DST tests in `packages/time/src/resolve.spec.ts` against real Cairo transition dates: weekly recurrence across spring-forward and fall-back, a nonexistent local time, and an ambiguous one (FR-018, FR-019) — done 2026-09-09
  > **Note under T029 (2026-09-09).** The tests fix the public API that T032 and T033 have to satisfy, so neither has to guess it. Two exported functions, reached through `src/index.ts`, which already re-exports `src/resolve.ts`: `resolveLocalDateTime({ localDate, localTime, timezone }) → ResolvedInstant` and `resolveOccurrences(slot, { fromLocalDate, count }) → readonly Occurrence[]`. Three exported types: `RecurringSlot` (`dayOfWeek`, `startTimeLocal`, `durationMinutes`, `timezone` — the four `availability_slots` columns the ERD lists), `ResolvedInstant` (`localDate`, `startTimeLocal`, `timezone`, `startsAt`, `utcOffsetMinutes`, `disambiguation`), and `Occurrence`, a `ResolvedInstant` plus `endsAt`. Five decisions travel with it. **Canonical strings, not objects** — `LocalDate` is `YYYY-MM-DD`, `LocalTime` is `HH:MM:SS` (how Postgres renders a `time` column), `UtcInstant` is `YYYY-MM-DDTHH:MM:SSZ` with no fractional seconds and no offset suffix other than `Z`. A comparable canonical form is what makes FR-017 cheap: nothing has to leak a Temporal object to be asserted on or stored. **`dayOfWeek` is 0–6 with 0 = Sunday** — the ERD gives the range and no anchor, so this pins it to Postgres `EXTRACT(DOW)`, which is what a query will eventually compare against. **The local fields on `ResolvedInstant` are where the instant landed, not what was asked for** — in the gap case `startTimeLocal` comes back `01:30:00` for a requested `00:30:00`, which is how a caller can tell a student what actually happens rather than what they typed. **`disambiguation` is `exact` | `shifted_forward` | `first_of_two`** so FR-019 is asserted as a stated outcome instead of being inferred from an instant that could be right by accident; Temporal's `getPossibleInstantsFor` already returns zero, one or two candidates, so this costs T032 nothing. **`endsAt` is `startsAt` plus `durationMinutes` of elapsed time**, added to the instant and never to the wall clock, because a lesson's length is a duration and not a calendar step.
  >
  > Two mechanical points for whoever picks up T032. The spec declares that API locally and casts the module namespace to it rather than importing named exports, because `pnpm typecheck` is green on `develop` and must stay green — a named import from a module that still reads `export {}` would be a build error rather than a failing test, and the violation fixtures are the only compile-red files here precisely because `tsc` excludes them. When T032 and T033 land the cast is a no-op and the file goes green with no edit. And the import is the relative `./index.js`, not `@ijazah/time`: no workspace package declares a dependency on another yet, so nothing links `@ijazah/time` into `node_modules` and the bare specifier would fail to resolve for a reason that has nothing to do with the implementation.
  >
  > The Cairo dates are 2025 and were read out of the IANA data shipped with the runtime (Node 24, ICU 77.1) by scanning `Africa/Cairo` for offset changes, not recalled: the gap is at `2025-04-24T22:00:00Z` (local 00:00 becomes 01:00 on Friday 25 April, +02:00 → +03:00) and the overlap at `2025-10-30T21:00:00Z` (local Friday 31 October 00:00 becomes Thursday 30 October 23:00, +03:00 → +02:00). Egypt's rule since 2023 is forward on April's last Friday and back on October's last Thursday at 24:00, suspended over Ramadan; Ramadan 2025 ended on 30 March, so neither transition fell inside the suspension window and both follow the plain rule. The recurrence cases use a Friday 09:00 slot so the transition sits inside the week rather than beside it, and each asserts both halves of R-TIME-2 separately — the local hour is preserved, the offset moves — plus an explicit refusal of the instant a `7 × 24h` implementation would produce (`2025-04-25T07:00:00Z`, which is 10:00 in Cairo, and `2025-10-31T06:00:00Z`, which is 08:00). `pnpm test` is now red by forty-one on purpose: thirty-seven lint fixtures plus these four, which report `resolveOccurrences is not a function` and `resolveLocalDateTime is not a function` until T032 and T033 land.

### Implementation for User Story 1

- [x] T030 [US1] Implement the branded money type and constructors in `packages/money/src/index.ts` using a non-exported `unique symbol`, making plain numbers and piasters mutually unassignable (FR-012, research R-3) — done 2026-09-09
  > **Note under T030 (2026-09-09).** The published surface is five names: `Piasters`, `piasters`, `isPiasters`, `toPlainNumber`, `MoneyError`. Four decisions the task line left open:
  > **What a piaster amount is.** `Number.isSafeInteger(value) && value >= 0`, shared by guard and constructor; money columns are `bigint`, so unsafe integers are refused rather than rounded, and `-0` normalises to `0`.
  > **Throws, not a result type.** Every call site is a validated boundary or a database row, where a failure is a bug or corrupt data (R-API-8); a caller that wants to branch asks `isPiasters` first.
  > **No arithmetic helpers.** Under ADR 0007 the domain does no money arithmetic (gateway amounts are "as reported, never computed here", ERD §7); the first task that needs an operation adds it here with its own test.
  > **The serialisation unwrap does not defeat FR-012.** A branded intersection widens to `number` by itself; `toPlainNumber` only gives that widening one greppable call site. The type system holds one direction (a number never becomes `Piasters` without the constructor); the reverse is closed by the R-MONEY-1 lint rule (FR-072, T131), not here. quickstart §7 and research R-3 were reconciled to say so.
  > **Scope.** `packages/money/src/index.spec.ts` travels with this task because quickstart §7 and T086 require it and no other task names it. It holds the `@ts-expect-error` type-level assertions and a syntax-tree check that the brand is declared once and never exported.
- [ ] ~~T031~~ Retired (ADR 0005 D1): share splitting no longer exists.
- [x] T032 [US1] Implement the time package in `packages/time/src/index.ts` over `@js-temporal/polyfill`, exposing the project's own types and never a Temporal object (FR-017, research R-4) — done 2026-09-09
- [x] T033 [US1] Implement per-occurrence recurrence resolution in `packages/time/src/resolve.ts` — each occurrence from its own local date and the slot's local time, never by adding intervals (FR-018) — done 2026-09-09
  > **Note under T032 and T033 (2026-09-09).** The four T029 cases pass unchanged; `pnpm test` is red by thirty-seven, the lint fixtures alone. Three decisions travel to whoever calls this package next, which the architecture names as `sessions.generateForEnrollment` (Architecture §8).
  >
  > **The polyfill is confined to two files.** `@js-temporal/polyfill` is a dependency of `packages/time` only and is imported in `src/index.ts` and `src/resolve.ts` and nowhere else in the repository, which is what makes the eventual swap to native Temporal an internal change (research R-4). The emitted `dist/*.d.ts` mentions `Temporal` only inside prose comments — no parameter, return type or re-export refers to it — so a consumer never depends on the library to hold a value this package produced (FR-017). Everything that crosses the boundary is a canonical string or a number, and canonically *in* as well as out: `2025-4-18`, `20250418` and `09:00` are refused rather than normalised, so a `LocalDate` that goes in comes back out comparable with `===`.
  >
  > **What `disambiguation` cost.** `disambiguation: 'compatible'` is R-TIME-7 in one option, as R-4 promised. Reporting *which* of the three outcomes happened cost two further conversions per resolution. Version 0.5 of the polyfill — the version installed, and the shape native Temporal ships — dropped `Temporal.TimeZone` and with it `getPossibleInstantsFor`, which the note under T029 expected to answer this by returning zero, one or two candidates; there is no replacement on the reduced surface, so building on it would have bought a rewrite at the swap. Reading the same wall-clock time under `earlier` and under `later` answers it with methods that survive: the two agree exactly when the local time happened once, `compatible` matches `earlier` over an overlap, and matches `later` — the far side of the gap — when the local time never happened at all. Three conversions per occurrence, no dependency on a removed type.
  >
  > **Validation refuses, it never repairs.** A malformed or impossible `localDate`, `localTime` or `fromLocalDate`, a `timezone` that is an offset string, is not in the IANA database, or is not a continent/city zone, a `dayOfWeek` outside 0–6, and a `count` or `durationMinutes` that is not a whole number ≥ 1, all throw a named `TimeError` carrying `offendingField` and `offendingValue` — the shape the kernel's `ConfigError` and `packages/money`'s `MoneyError` already use, so the error filter has one thing to map (R-API-8) and no caller matches on message text. Three of those deserve their reason recorded. `Temporal.PlainDate.from` is called with `overflow: 'reject'`, because its default would read `2025-02-30` as `2025-02-28` and move a lesson two days with nobody told. An offset string such as `+02:00` parses as a zone and then never observes a transition, so a slot stored with one would keep its summer offset all winter — exactly what R-TIME-3 exists to prevent — and only a named identifier is accepted. A slot's zone must also be a place, so it follows that place's clock law summer and winter: after the conversion succeeds, the first segment must be one of IANA's continent or ocean areas (`Africa`, `America`, `Antarctica`, `Arctic`, `Asia`, `Atlantic`, `Australia`, `Europe`, `Indian`, `Pacific`). This follows W3C "Working with Time Zones" §3.3.3 ("Avoid special purpose time zone IDs, such as those beginning with Etc/"; prefer continent/city over legacy ids) and IANA theory.html (names are AREA/LOCATION), so `Etc/GMT-2`, `Etc/UTC`, `UTC`, `GMT`, `EST`, `Egypt`, `US/Eastern` and `africa/cairo` are refused even though Temporal resolves them; decided by Amr in the #19 review. The zone is stored as given, not canonicalised: `Intl` maps `Asia/Kolkata` to `Asia/Calcutta` on Node 24, so a canonical form would depend on the server's ICU. Two area-form spellings of one zone (`Asia/Kolkata` and its link `Asia/Calcutta`) therefore both pass, so compare zones with Temporal (`ZonedDateTime.equals`), never `===`. And `count: 0` is refused rather than answered with an empty list: the caller is session generation for a paid enrollment, and a zero that quietly produced no sessions is the kind of state that looks successful and is not. One helper, `assertLocalDate(field, value)`, is exported so `resolve.ts` applies the identical rule to `fromLocalDate` under its own field name; it takes and returns a plain string, so it carries nothing of Temporal with it.
  >
  > **Two things a later task inherits.** `endsAt` is `startsAt` plus `durationMinutes` of elapsed time added to the *instant*: a two-hour lesson beginning inside the October overlap ends 22:30Z having crossed only one hour of wall clock, which is what a lesson is. And `day_of_week` 0 = Sunday is now stated in the ERD row itself rather than only in the note under T029, which is where the next reader looks.
  >
  > **Scope.** `packages/time/src/index.spec.ts` travels with these tasks because T086 puts the 80% floor on `packages/time` and no other task names it.
- [x] T034 [US1] Scaffold the internal lint plugin at `packages/config/eslint-plugin-ijazah/index.js`, with the naming convention that every rule is named for its constitution rule and every message ends with that identifier (FR-011) (the convention is built into the rule factory `packages/config/eslint-plugin-ijazah/rule.js`, which the 24 placeholder rule stubs under `rules/` adopt, each one implemented by its own later task) — done 2026-09-09
  > **Note under T034 (PR #16, 2026-09-09).** Four decisions travel from here to every task that writes a rule. **Declare rules only through `defineRule`** in `packages/config/eslint-plugin-ijazah/rule.js`, never as a hand-written object: it is what makes FR-011 true by construction rather than by memory. **Write message text without the identifier** — the factory appends it, and a text ending with its own identifier is refused, because that is the doubled-identifier mistake; citing another rule mid-text is allowed and the contract does it (R-API-10 and R-PROC-7). **Pass `fixable` and `hasSuggestions` to `defineRule`** if the rule fixes or suggests: ESLint throws at the first fix produced without them, and the factory refuses any key it does not know rather than dropping it, so an unrecognised key is a load failure with a name in it. **The six `boundaries/*` ids the contract publishes are rules of this plugin since T035**: they were planned as `eslint-plugin-boundaries` configuration, but that library cannot report under a published id, so they are declared like every other rule and `packages/config/eslint.boundaries.js` holds only the wall data they read (see the note under T035); the plugin/contract comparison now runs over all thirty in both directions. The convention self-check and the factory's own tests live in `tests/lint-plugin/`, not beside the plugin, because `packages/config` is a JavaScript package belonging to no TypeScript project — a `.spec.ts` inside it fails the type-aware lint run, while `tests/**/*.ts` is already covered by the root `tsconfig.json` and by the Vitest include.
- [x] T035 [P] [US1] Implement boundary rules in `packages/config/eslint.boundaries.js` — `boundaries/no-cross-role-import`, `boundaries/no-role-import-in-shared`, `boundaries/no-deep-module-import`, `boundaries/no-adapter-import`, `boundaries/no-upward-admin-import` (FR-004), plus `boundaries/no-money-vocabulary` enforcing R-MONEY-6 as redefined by ADR 0007 (FR-016): (a) wallet, ledger, balance, escrow or platform-held-funds vocabulary anywhere; (b) gateway order, gross, fee and net amounts referenced outside `modules/payments` and `platform/ports/payment`. `payout` on its own is legal (teacher payout accounts are part of the ADR 0007 model) (the six are rules of `packages/config/eslint-plugin-ijazah`; `eslint.boundaries.js` holds the wall data they read — see the note below) — done 2026-09-09
  > **Note under T035 (2026-09-09).** The six `boundaries/*` ids are implemented as rules of the internal plugin, registered under exactly those ids and declared through `defineRule`, not as `eslint-plugin-boundaries` configuration. That library reports under its own rule ids (`boundaries/element-types`), and `tests/violations/harness.ts` credits a case only when the reported id equals the published id and the message ends with the constitution id — configuration of it could satisfy neither half, so FR-011 decided it. `packages/config/eslint.boundaries.js` stays the file this task names and is now the single place the wall *data* lives: the role-tree root, the module root, the port root, the admin module name, the banned vocabulary, the gateway words and the payment folders, exported as flat-config `settings.ijazah.boundaries`, which `eslint.base.js` already spreads into both sets. The rules share one copy of it through `eslint-plugin-ijazah/specifiers.js` (superseded in detail by the notes below). `eslint-plugin-boundaries` stays declared as a dependency; removing it is a follow-up, not this task *(done 2026-09-28 in the develop health-check PR after #20; the package is no longer declared)*. Half (a) of `boundaries/no-money-vocabulary` reads a string literal only where one names a thing — a quoted property key or a computed member access — so a configured word list, this contract and the rule headers do not report themselves; half (b) reads identifiers and property names only, so `it.todo('… gateway_order_id …')` in `tests/db-integrity/` describes a constraint without breaching one. `pnpm test` drops from 35 red violation cases to 26: the seven T020 boundary cases and the two R-MONEY-6 cases are green, and R-MONEY-1, R-MONEY-2 and R-MONEY-5 stay red for T131, T045 and T044.
  > **Note under T035 (PR #16, 2026-09-09), for T035–T047, T131 and T132.** Declare every plugin rule through `defineRule` (see the note under T034).
  > **Note under T035 (PR #9, 2026-09-08).** Match a file by its path segments, not by an anchor at the repository root. T020's fixtures mirror the real tree exactly (`apps/mobile/src/features/{student,teacher,shared}/`, `apps/api/src/modules/*/`, `apps/api/src/platform/ports/payment/`) but sit under `tests/violations/fixtures/`, so a rule testing for `apps/mobile/src/features/student/` *within* the filename works and one comparing a root-relative path for equality does not. The alternative is putting deliberately broken files into the real application trees, which is worse. Both directions of R-MOBILE-1 and R-MOBILE-2 have a fixture, so a rule that refuses one direction and shrugs at the other stays red.
> **Note under T035 (PR #11, 2026-09-08).** Match identifiers, imports and table access, not comments or free text, so a word like "balance" in prose is not a false positive. T023 declares one fixture per half (`booking/wallet-ledger.ts`, `sessions/gateway-settlement.ts`). T021's `booking/booking.repository.ts` fixture used to read `payments` and name `gross`; PR #12 changed it to read `reviews` so it stays a one-rule fixture.
  > **Note under T035 (PR #20 review, 2026-09-09).** Six decisions from the review, each recorded in full in the rule headers. **The path alias is part of the wall**: `apps/mobile/tsconfig.json` declares `"@/*": ["src/*"]`, so `@/features/teacher/x` named the same file as `../teacher/x` and lint clean; `aliases` is now wall data in `eslint.boundaries.js` and is expanded before the relative check. **The helpers live once**, in `packages/config/eslint-plugin-ijazah/specifiers.js` (`segmentsOf`, `after`, `resolveTarget`, `isRequireCall`, `onEverySpecifier`, `settingsFor`), and the wall object is exported from `eslint.boundaries.js` as the default `settingsFor` falls back to, so the six private copies are gone and a wall change is one edit. **The confined identifiers are the ERD's own columns** on the `payments` row — `amount_piasters`, `gateway_fee_piasters`, `net_piasters` — not the invented `gross_piasters`/`fee_piasters` *(superseded by the note under T035 and T036 below: the ERD column is now `gross_piasters` and the rule keeps no list of names)*. **A gateway order id is not an amount** and is no longer banned: ARCHITECTURE hands the client a `CheckoutRef` carrying it, so `packages/contracts` and the checkout screen name it legitimately; half (b) of R-MONEY-6 is about amounts. **`boundaries/no-upward-admin-import` refuses every importer outside `modules/admin`**, the kernel and the shared packages included, because they sit below the modules and the import is as upward from there. **Half (a) of `no-money-vocabulary` reads every specifier syntax** (`require`, `import =` included) and `JSXIdentifier`, reports once per binding rather than at every use, and singularises both sides of a word match so `heldFund` is refused. Each of the eight rules with real logic now has a `RuleTester` table in `tests/lint-plugin/<rule>.spec.ts`, loaded through `tests/support/rule-tester.ts`.
  > **Note under T035 and T036 (PR #20 second review, 2026-09-28).** **The gross column is `gross_piasters`**, decided by Amr: the ERD had `amount_piasters`, which carries no gateway word, so the rule needed a list of special names and then refused any generic `amountPiasters`, first in `packages/money` (T030) and next in any display formatter. Renamed in the ERD and SRS before T059 models `payments`, the rule now recognises all three gateway columns by their words (gross, fee, net plus an amount marker) and has no special-name list; `amountPiasters` is legal everywhere. **No folder beyond `modules/payments` and `platform/ports/payment` is exempt**, and the `packages/money` exemption recorded on 2026-09-27 is withdrawn: the money package is where R-MONEY-5 allows arithmetic, so it is exactly where a forbidden `net = gross - fee` would otherwise go unseen. **`api/no-orm-outside-repository` applies inside `apps/api` only** (R-API-2 is about services and repositories), so `prisma/seed.ts` (T074) and `tests/seed/` (T072, T073) may create a client. **The inline type import `type T = import('…').X` is read by every wall rule** through `specifiers.js`.
- [x] T036 [P] [US1] Implement `api/no-orm-outside-repository` in `packages/config/eslint-plugin-ijazah/rules/no-orm-outside-repository.js` (FR-005), and `api/no-logic-in-router` in `rules/no-logic-in-router.js` as a complexity ceiling on `*.router.ts` (FR-071) — done 2026-09-09
  > **Note under T036 (2026-09-09).** The two values the note below left open are now decided, and both are recorded in full in the rule file headers. **The complexity ceiling is 5**, measured as cyclomatic complexity per function on any file whose basename ends `.router`: a procedure that validates, calls one service method and returns is 1, and five leaves room for the two or three request-shaped decisions a thin procedure may honestly need (an optional input's default, a narrow error guard, a cursor present or absent) and no room for a domain rule. It is exposed as the `max` option with 5 as the default, so a later task tunes it from `packages/config/eslint.base.js` rather than by editing the rule; raising it is a spec decision and belongs in review. **The database-client specifier is `@prisma/client`**, the canonical name T021's fixture already uses, so no fixture changed. The generated output path `.prisma/client` (`prisma/schema/base.prisma` writes the client there) is banned alongside it, matched at the end of a deeper relative path too, so renaming the import does not walk around the rule. A re-export through a module of one's own is deliberately not chased: resolving that needs the program this fast rule does not have, and `api/table-ownership` (R-API-6, type-aware, T047) catches a query by what it touches instead. Both rules match the file by basename, never by a root-anchored path (note under T035), and both are declared through `defineRule` (note under T034). `tests/violations/layers.spec.ts` is now green for R-API-1 and R-API-2 and stays red for R-API-6 (T047) and R-API-15 (T042).
  > **Note under T036 (PR #9, 2026-09-08).** Two values no Phase 0 document fixes, deliberately left for this task rather than invented in T021. **The complexity ceiling**: the constitution, contracts/lint-rules.md and this task line all say "complexity ceiling" and none names a number; record the value and the reasoning in the rule file. T021's fixture carries more than twenty independent decisions in one procedure, so it stays over any defensible ceiling. **The database-client specifier**: `prisma/schema/base.prisma` uses the `prisma-client` generator writing to `node_modules/.prisma/client`, and no repository file exists yet to settle what a repository actually imports. T021's fixture assumes `@prisma/client`, the canonical name; if this task bans a different specifier, update `tests/violations/fixtures/apps/api/src/modules/booking/booking.service.ts` in the same commit rather than leaving a mystery red.
  > **Note under T036 (PR #20 review, 2026-09-09).** Four decisions, recorded in full in the two rule headers. **The client specifier is matched by prefix**, `@prisma/client(/…)` and `.prisma/client(/…)`, because `@prisma/client/edge` and `@prisma/client/runtime/library` hand a service the same client under a longer name. **Both type-only forms are refused** — `import type { PrismaClient } from '@prisma/client'` and `type C = import('@prisma/client').PrismaClient` — since a service that names the client's type knows the database's shape, which is what R-API-2 keeps behind the repository. **The one-client-per-process Prisma singleton lives at `apps/api/src/platform/db/prisma.repository.ts`**: a `*.repository` file, so it needs no allowlist, no settings exception and no second idea of a privileged path, and the first repository task creates it (this task only names it). **`api/no-logic-in-router` counts the file's top level and each class static block** as bodies of their own and counts a default value on a parameter or destructured property, because a six-way `if / else if` chain outside any function is the same rule in the same wrong file; the ceiling stays 5 and the `max` option is validated by the schema alone.
- [x] T037 [P] [US1] Implement the design and direction rules — `mobile/no-raw-color`, `mobile/no-physical-direction`, `mobile/no-raw-control` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-006, FR-007) — done 2026-09-28
  > **Note under T037 (2026-09-28).** Three decisions, each recorded in full in the rule header. **`mobile/no-raw-color` reads every file under `apps/mobile/src` outside `design/`**, the constitution's own scope, so a colour in a route file under `app/` is refused with one in `features/`; a colour is a whole `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` token or a functional notation (`rgb(`, `hsl(`, `oklch(`, …), including inside a Tailwind arbitrary value (`bg-[#0f766e]`); raw spacing is a non-zero numeric literal on a margin, padding, gap, inset or offset style key in every React Native spelling, or an arbitrary spacing class (`p-[12px]`); zero is not spacing, and width, height, radii and font sizes are left to review. **`mobile/no-physical-direction` reads every string in `features/**`**, not only `className`, splits it into class tokens, strips variant prefixes and a leading minus, and refuses the constitution's eight families plus the `border-`, `rounded-`, `scroll-m`/`scroll-p`, `float-` and `clear-` physical forms; the React Native style keys `marginLeft`, `paddingRight`, `left`, `right`, `border*Left*`/`border*Right*` and `textAlign: 'left' | 'right'` are refused too, each message naming the logical spelling. **`mobile/no-raw-control` refuses `Pressable`, the four `Touchable*`, `Button`, `TextInput`, `Switch` and `Modal`** imported from `react-native` or `react-native-gesture-handler` in `features/**`, and a JSX element of that name reached another way (`RN.TextInput`); `View`, `Text`, `ScrollView`, `FlatList` and `Image` are layout, not controls, so a card — a `View` with a token border — stays a review matter. Each rule has a `RuleTester` table in `tests/lint-plugin/`, as do all eighteen rules of T037–T042, T131 and T132.
- [ ] T038 [P] [US1] Implement the localisation rules — `mobile/no-literal-string`, `mobile/no-translated-concat`, `mobile/no-manual-format` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-006)
- [ ] T039 [P] [US1] Implement the client-side safety rules — `mobile/no-insecure-storage`, `mobile/no-direct-network` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-006)
  > **Note under T039 (PR #11, 2026-09-08).** R-MOBILE-10 names `lib/storage` as the secure layer; the scaffold has `apps/mobile/src/lib/secure-storage.ts`. Pick one path here and make the constitution wording, the rule and T022's `session-token.ts` fixture agree.
- [ ] T040 [P] [US1] Implement the security rules — `sec/no-disabled-tls`, `db/no-weak-random`, `sec/no-body-logging` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-009, FR-010, FR-044)
- [ ] T041 [P] [US1] Implement the escape-hatch and process rules — `api/require-escape-hatch-reason` for `any` and `@ts-ignore` (R-API-10), `proc/require-suppression-reason` for `eslint-disable` (R-PROC-7), `proc/no-focused-or-skipped-test`, `proc/no-bare-marker` — under `packages/config/eslint-plugin-ijazah/rules/` (FR-008)
- [ ] T042 [P] [US1] Implement `api/no-push-outside-job` in `packages/config/eslint-plugin-ijazah/rules/no-push-outside-job.js` (FR-057)
- [ ] T131 [P] [US1] Implement `money/no-number-in-money-position` in `packages/config/eslint-plugin-ijazah/rules/no-number-in-money-position.js`, refusing a declared money position typed as plain `number` rather than the branded type (FR-072)
- [ ] T132 [P] [US1] Implement `time/no-datetime-outside-package` in `packages/config/eslint-plugin-ijazah/rules/no-datetime-outside-package.js`, refusing `Date` arithmetic and datetime library imports outside `packages/time` (FR-017)
- [x] T043 [US1] Enable type-aware linting in `packages/config/eslint.base.js` by pointing the parser at the project, and split the configuration into fast and type-aware sets per research R-10 — done 2026-09-28
  > **Note under T043 (2026-09-28).** Mostly already in place from T004, so this task finished and proved the wiring rather than redoing it. **What T004 had built**: `eslint.base.js` exports `{ fast, typeAware }`; `typeAware` spreads `fast` and adds `projectService` with `tsconfigRootDir` at the repository root and `allowDefaultProject` for the per-package Vitest configs; the root `eslint.config.js` is the fast set and `eslint.types.config.js` the type-aware set behind `pnpm lint` and `pnpm lint:types`; the plugin derives both rule lists from one catalog. A probe over the tree confirmed the project service already hands a program to every one of the 121 TypeScript files `pnpm lint:types` reads and, with the ignore list off as the harness runs it, to all 53 files under `tests/violations/fixtures/` through their own `tsconfig.json`, with no file rejected as outside every project. **What T043 added**: the three blocks in `eslint.base.js` named three different extension lists (parser `{ts,tsx,mts,cts}`, fast rules `{ts,tsx,js,jsx,mjs,cjs}`, type-aware `{ts,tsx}`), so a `.mts` or `.cts` file was parsed and then checked against no plugin rule in either set; the blocks now share one `typescriptFiles` list and one `lintedFiles` list, and the two stale "T043 completes the wiring" comments are replaced by a description of what the wiring does. No file with those extensions exists today, so `pnpm lint` and `pnpm lint:types` report the same result before and after. **The proof** is `tests/lint-plugin/rule-sets.spec.ts`, which reads the two root configuration files rather than the exports behind them and asserts: each root file is the very array `eslint.base.js` exports for its set; the fast set enables exactly the catalog's FAST ids and the type-aware set the FAST ids plus the TYPE_AWARE ids, as ESLint resolves them for a real file; every extension the parser block names receives the same rules under both sets; and, through a throwaway rule that records `parserServices.program` as it runs, the fast set hands every file `null` while the type-aware set hands a program that contains the linted file, for a real file and for the R-MONEY-5 fixture alike, with no parse error. **Scope**: `packages/config/eslint.base.js`, the new spec under `tests/lint-plugin/` (the agreed home for plugin specs, note under T034), and this line. No rule body, fixture, contract row, hook or workflow changed; T044–T047 implement the four type-aware rules and T048 registers the sets in the hook and the pipeline.
- [ ] T044 [P] [US1] Implement `money/no-arithmetic-outside-package` in `packages/config/eslint-plugin-ijazah/rules/no-money-arithmetic.js`, flagging any binary-expression operand carrying the brand (FR-013)
- [ ] T045 [P] [US1] Implement `money/require-piaster-suffix` in `packages/config/eslint-plugin-ijazah/rules/require-piaster-suffix.js`, resolving the identifier's type rather than guessing from its name (FR-014)
> **Note under T045 and T131 (PR #11, 2026-09-08).** Money identifiers use the constitution's literal form, `snake_case` with the `_piasters` suffix (`price_piasters`, `gross_piasters`, `fee_piasters`, `net_piasters`), the same spelling as the database columns (ERD section 0), so a name can be traced from schema to code without translation. The T023 fixtures are written in that form; if either rule keys on a different casing, change the rule, not the fixtures.
- [ ] T046 [P] [US1] Implement `gender/require-requester-gender` in `packages/config/eslint-plugin-ijazah/rules/require-requester-gender.js`, refusing a repository method returning teachers whose signature omits the requester's gender (FR-005)
- [ ] T047 [P] [US1] Implement `api/table-ownership` in `packages/config/eslint-plugin-ijazah/rules/table-ownership.js`, reading the manifest from T016 (FR-005)
  > **Note under T047 (PR #9, 2026-09-08).** Two things T021's fixture makes concrete, in addition to the `$comment` key T016's note already flags. The rule must **map a Prisma delegate to a manifest table name**: the fixture calls `prisma.review.findMany` and the manifest lists `reviews`; models are PascalCase and `@@map` to snake_case plural per `base.prisma`. And the fixture is deliberately a `*.repository.ts` file, so holding the client there is legal and the only prohibition it breaks is the ownership one — `reviews` belongs to the reviews module and the fixture queries it from booking.
  > **Note under T047 (PR #12, 2026-09-08).** The fixture read `payments` until this change. `boundaries/no-money-vocabulary` (R-MONEY-6, the ADR 0007 half) would have refused the same file a second time once T035 lands — a booking file reading the payments table and naming `gross` — which breaks the one-rule-per-file convention the fixture tree relies on and would let the R-API-6 case go green on the wrong rule. `reviews` is owned by another module and carries no money vocabulary. Keep any future edit to this fixture money-free for the same reason.
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
  > **Note under T055–T063 (PR #9, 2026-09-08).** Once the real Prisma client is generated, delete `tests/violations/fixtures/types/prisma-client.d.ts`. It is an ambient `declare module '@prisma/client'` shim T021 added because `api/table-ownership` is type-aware and cannot resolve a query target through `any`; left in place beside a real client it will collide.
- [ ] T056 [P] [US2] Model the catalog domain in `prisma/schema/catalog.prisma` per ERD §4, with availability stored as local wall-clock beside a zone column
- [ ] T057 [P] [US2] Model the booking domain in `prisma/schema/booking.prisma` (`slot_holds`, `enrollments` with `deleted_at`, `confirmed_at` and `cancellation_reason`) and the sessions domain in `prisma/schema/sessions.prisma` (`sessions` with `deleted_at`, `session_participant_events`, `cancellation_requests`) per ERD §5, with no client-writable attendance field
- [ ] T058 [P] [US2] Model the chat domain in `prisma/schema/chat.prisma` per ERD §6
- [ ] T059 [P] [US2] Model the payments domain in `prisma/schema/payments.prisma` per ERD §7 — `payments` and `payment_events`, unique gateway identifiers, unique NOT NULL provider event id, and no balance column anywhere (FR-027, FR-073; reinstated by ADR 0007 after ADR 0005 retired the escrow version). Also declares the `PaymentGateway` enum deferred from T013 (see its note) and settles the two decisions recorded there.
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
- [ ] T070 [US2] Implement the schema-check script in `scripts/schema-check.ts`, querying the live catalogue for timezone-less timestamps, wrong column-name suffixes, bare secret columns, the two `users` partial indexes missing or `reviews.enrollment_id` made partial (ADR 0006), and any cached derived value outside the four columns R-DB-4 declares (FR-024, SC-014; ADR 0009)
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
  > **Note under T081 (PR #11, 2026-09-08).** The R-MONEY-12 magic-number gate must exclude `tests/violations/fixtures/**`, as lint and tsc already do: T024's `sessions/next-occurrence.ts` carries `7 * 24 * 60 * 60 * 1000` under a `modules/` path on purpose.
- [ ] T082 [P] [US4] Configure Gitleaks as a pre-commit hook in `.husky/pre-commit` (FR-059)
- [ ] T083 [P] [US4] Add Gitleaks to the pipeline in `.github/workflows/ci.yml` scanning the full history including `specs/`, as a net independent of the hook (FR-059)
- [ ] T084 [P] [US4] Implement the contract snapshot generator in `scripts/contract-snapshot.ts`, recording every procedure path and enum member (FR-063)
- [ ] T085 [P] [US4] Implement the generated-file drift check in `scripts/generated-file-check.ts` (FR-062)
- [ ] T086 [US4] Configure per-path coverage thresholds in `packages/config/vitest.base.ts` — the 80% floor on `packages/money`, `packages/time` and the kernel's guard and error paths, and nowhere else yet (FR-062)
- [ ] T087 [P] [US4] Wire the gender-enforcement suite as a blocking gate in `.github/workflows/ci.yml` with its harness at `tests/adversarial/gender.spec.ts`, running from this phase even while its case coverage is small (FR-064). The harness runs every case in both directions against the SRS §3.7.1 visibility predicate (ADR 0006)
- [x] T088 [P] [US4] Create the review template at `.github/pull_request_template.md` carrying the twelve review-only checklist items verbatim and no other rule (FR-065) — done 2026-09-07 (restored; deleted in PR #2, decision reversed)
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
- [ ] T135 [P] [US5] Headers and origin test in `apps/api/src/platform/guards/security-headers.spec.ts` — a browser-facing response carries the security headers, an allowlisted origin is answered, an unlisted origin is refused, a wildcard origin is refused by the configuration schema at startup, and Strict-Transport-Security is asserted in production mode only (FR-076)
- [ ] T137 [P] [US5] Rate-limit test in `apps/api/src/platform/guards/rate-limit.spec.ts` — each of the four default paths (authentication, one-time-code, search, payment initiation) is throttled beyond its configured limit, an endpoint outside the four is untouched unless it opts in, and the limit is read from settings rather than a constant (FR-043, R-SEC-6, NFR-SEC-10)

### Implementation for User Story 5

- [ ] T100 [P] [US5] Implement the structured logger with its declared redaction list in `apps/api/src/platform/logging/logger.ts` (FR-040, research R-17)
- [ ] T101 [P] [US5] Implement the global error filter and single error shape in `apps/api/src/platform/errors/error-filter.ts` and `domain-error.ts` (FR-041)
- [ ] T102 [P] [US5] Implement the idempotency mechanism in `apps/api/src/platform/idempotency/idempotency.service.ts` over the `idempotency_keys` table (T134), keyed in the database rather than the cache so one transaction covers key and effect, with the `expire-idempotency-keys` job sweeping expired rows (FR-042, research R-14, ADR 0008)
- [ ] T103 [P] [US5] Implement rate limiting in `apps/api/src/platform/guards/rate-limit.guard.ts`, available to any endpoint and applied by default to authentication, one-time-code, search and payment-initiation paths (FR-043, NFR-SEC-10)
- [ ] T136 [P] [US5] Implement browser security headers and the CORS origin allowlist in `apps/api/src/platform/guards/security-headers.middleware.ts`, headers set once by a proven middleware; origins read from the configuration value `ADMIN_ALLOWED_ORIGINS`, declared in `env.schema.ts` and added empty to `.env.example` (T015), with the no-wildcard rule in the schema itself; Strict-Transport-Security sent only outside development; applied to every browser-facing surface. Where the Admin panel's HTML is served by a host other than the API, that host sends the same headers and research R-18 records it as part of the staging decision (FR-076, NFR-SEC-11)
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
- US5: all nine test tasks parallel; the kernel components T100–T105, T133 and T136 parallel
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
