# T130 register: does every machine-enforced rule have a failing case? (SC-003)

T130, taken over `develop` at 626d443 on 2026-10-12. Each status below comes from reading the test, the script or the CI step, and from the "observed red" notes in `specs/001-foundations/tasks.md`. Two rows were corrected after the first pass: R-PROC-4 (the repository's ruleset was read; see its row) and R-DB-6 (T166, in the same batch). What happens to each open row is in "Decisions" at the end (owner, 2026-10-12). SC-003's count is not zero, so T130 stays open. Re-counted the same day after batch G (PR #63) and T167: see Summary, whose first paragraph keeps the first count.

## How to read the register

**Status values**
- **PROVEN.** A committed test or pipeline step fails on a violation, and it asserts the refusal.
- **PROVEN-ELSEWHERE-NAME.** Proven, but the test does not cite the rule id.
- **PARTIAL.** The rule has more than one mechanism or tier, and only some of them are proven.
- **UNPROVEN.** No committed failing case exists. "(recorded manually)" means tasks.md records a red run by hand, but nothing reproducible is committed.
- **NOT-YET-APPLICABLE.** The code that would violate the rule, or that holds the guard, arrives in a later phase.
- **SUPERSEDED** and **REVIEW (out of scope)** rows need no proof.

**Where each kind of proof runs in CI**
- **Lint.** `tests/violations/**` runs in CI stage 2 (`pnpm test`). Each case lints a fixture through the real `eslint.config.js` or `eslint.types.config.js`. It asserts a severity-2 report under the published rule id, with a message that ends in the constitution id (`tests/violations/harness.ts`, `assertRefused`). `tests/violations/completeness.spec.ts` (T027) checks that all 30 rule ids in `contracts/lint-rules.md` have a case. Each rule also has a RuleTester table in `tests/lint-plugin/<rule>.spec.ts`.
- **Type.** Proofs written with `@ts-expect-error` or `expectTypeOf` are enforced by `pnpm typecheck` (`tsc --build`) in CI stage 1. Each `tsconfig.json` includes `src/**`, so spec files are compiled. Under Vitest alone these lines do nothing.
- **Database.** `tests/db-integrity/**` runs in CI stage 4 (`pnpm test:db-integrity`) as the application role `ijazah_app`.
- **Pipeline scripts.** `tests/pipeline/**` runs in CI stage 2. The scripts it tests are called from stage 1 (branch check, suppression gate) or stage 3 (magic-number gate, migration check, schema check, contract snapshot, generated-file check).

**Two caveats that apply to every row**
1. **No CI gate blocks a merge yet.** A `CI` tier means "violation blocks the merge" (constitution line 266). That is true only when the branch rules require the check. The ruleset `main-protection` on `main` and `develop` requires a pull request with one approval and refuses deletion and non-fast-forward pushes, but it requires no status check (read through the GitHub API on 2026-10-12). Until T089 adds them, every CI proof below shows that the step goes red, not that the merge is blocked. That gap is R-PROC-4's missing half. **Since T089 (2026-10-12)**, the ruleset requires all eight jobs of `ci.yml` as status checks, so a red step now blocks the merge (see R-PROC-4's row).
2. **SC-003's wording is narrower than the tiers.** SC-003 (spec.md line 451) names "a compiler, a linter, a pipeline gate or a database privilege".
   - It does not name runtime guards (`RT`). The rules whose only machine tier is `RT` are R-API-8, R-API-12, R-SEC-3, R-SEC-9, R-SESS-3 and R-SESS-6. They are registered here but fall outside SC-003's literal text.
   - It does not name database constraints and unique indexes, which the `DB` tier includes (constitution line 267). Those rules are R-MONEY-8, R-TIME-3, R-DB-5, R-DB-8, R-SEC-8, R-SESS-1 and R-PROC-11. Only R-DB-3 is a privilege in the narrow sense.

---

## Register

### I. Money (R-MONEY)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-MONEY-1 | TYPE, LINT, CI | `packages/money/src/index.ts` (unexported `unique symbol` brand); `packages/config/eslint-plugin-ijazah/rules/no-number-in-money-position.js` | LINT: `tests/violations/money.spec.ts`, "T023 money violations", case `money/no-number-in-money-position names R-MONEY-1` (fixture `apps/api/src/modules/payments/package-price.ts`); `tests/lint-plugin/no-number-in-money-position.spec.ts`. TYPE: `packages/money/src/index.spec.ts`, describe "the brand makes a number and a piaster amount non-interchangeable" (5 `@ts-expect-error`, enforced by `pnpm typecheck`); also "refuses a fraction … (R-MONEY-1)". Extra: the schema check's `piasters-type` (`tests/db-integrity/schema-check.spec.ts`) **CI, since constitution 2.4.1 (T167)**: the schema gate; `tests/db-integrity/schema-check.spec.ts` refuses `piasters-type probe_violations.price_piasters`. | PROVEN |
| R-MONEY-2 | LINT | `rules/require-piaster-suffix.js` (type-aware) | `tests/violations/money.spec.ts`, case `money/require-piaster-suffix names R-MONEY-2` (fixture `payments/price-label.ts`, typeAware set); `tests/lint-plugin/require-piaster-suffix.spec.ts` | PROVEN |
| R-MONEY-3 | — | — | — | SUPERSEDED (ADR 0005) |
| R-MONEY-4 | — | — | — | SUPERSEDED (ADR 0005) |
| R-MONEY-5 | LINT | `rules/no-money-arithmetic.js` (`money/no-arithmetic-outside-package`, type-aware) | `tests/violations/money.spec.ts`, case `money/no-arithmetic-outside-package names R-MONEY-5` (fixture `payments/fee-check.ts`); `tests/lint-plugin/no-money-arithmetic.spec.ts` | PROVEN |
| R-MONEY-6 | LINT | `rules/no-money-vocabulary.js` + wall data `packages/config/eslint.boundaries.js` | `tests/violations/money.spec.ts`, two cases, one per half (fixtures `booking/wallet-ledger.ts` and `sessions/gateway-settlement.ts`); `tests/lint-plugin/no-money-vocabulary.spec.ts` | PROVEN |
| R-MONEY-7 | — | — | — | SUPERSEDED (ADR 0005) |
| R-MONEY-8 | DB | `payment_events.provider_event_id` UNIQUE NOT NULL (`prisma/migrations/20261007000000_init`) | `tests/db-integrity/replay.spec.ts`: "a duplicate provider_event_id on payment_events is refused as unique (FR-073, ERD section 15.13)" (23505) and "a NULL payment_events.provider_event_id is refused as not-null (FR-073)" (23502). Both cite FR-073, not R-MONEY-8. The second half of the rule, "a replayed event is acknowledged and ignored", is handler behaviour that arrives with the Phase 2 webhook ingestion | PROVEN-ELSEWHERE-NAME |
| R-MONEY-9 | RT, CI | `apps/api/src/platform/guards/webhook-signature.guard.ts` | `apps/api/src/platform/guards/webhook-signature.spec.ts`, "the webhook signature guard (T133, FR-074, R-MONEY-9)": `it.each` over unsigned, invalid and altered requests, each refused before the handler, through real HTTP. This one test is both the RT guard's proof and the CI test the cell names (stage 2) | PROVEN |
| R-MONEY-10 | — | — | — | SUPERSEDED (ADR 0005) |
| R-MONEY-11 | — | — | — | SUPERSEDED (ADR 0005) |
| R-MONEY-12 | CI, REVIEW | `scripts/magic-number-gate.ts`, ci.yml stage 3 step "Magic-number gate over the modules (R-MONEY-12)" | `tests/pipeline/magic-number-gate.spec.ts`, "a number used as a threshold, a limit or a window is refused, naming R-MONEY-12" (6 cases, plus exit codes). Supporting: `apps/api/src/modules/admin/settings.service.spec.ts` "fails closed on a key that is not stored" | PROVEN |

### II. Time (R-TIME)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-TIME-1 | LINT | `rules/no-datetime-outside-package.js` | `tests/violations/time.spec.ts`, two cases (fixtures `sessions/next-occurrence.ts` for `Date` arithmetic and `sessions/uses-datetime-library.ts` for a library); `tests/lint-plugin/no-datetime-outside-package.spec.ts` | PROVEN |
| R-TIME-2 | CI | `packages/time/src/resolve.ts`; stage 2 `pnpm test` | `packages/time/src/resolve.spec.ts`, "T029 weekly recurrence across a Cairo DST transition (FR-018, R-TIME-2)": spring-forward and fall-back cases, each explicitly refusing the instant a `7 × 24h` implementation would give | PROVEN |
| R-TIME-3 | CI, REVIEW | `local-time` rule in `scripts/schema-check.ts` (an `_local` column must be date or time with a `timezone` beside it); `packages/time` refuses offset zones | `tests/db-integrity/schema-check.spec.ts`, "names each one by rule, table and column …": expects `local-time probe_violations.lesson_local`. The spec header does not cite R-TIME-3; the script legend does. Also `packages/time/src/index.spec.ts` "refuses a fixed offset in place of a zone (R-TIME-3)". The refusal comes from the CI schema gate reading column types, not from the database engine. The cell's "column types" is a structural property, and the gate is what checks it **Re-count 2026-10-12, after batch G**: Since constitution 2.4.0 (T165) the cell names the CI schema gate, which is what this proof exercises. | PROVEN-ELSEWHERE-NAME |
| R-TIME-4 | CI | `scripts/schema-check.ts` `timestamp-without-zone`; ci.yml stage 3 "Schema check against the migrated catalogue" | `tests/db-integrity/schema-check.spec.ts`: expects `timestamp-without-zone probe_violations.created` (the header cites R-TIME-4) | PROVEN |
| R-TIME-5 | CI | `scripts/schema-check.ts` `timestamp-suffix`, `local-time` | `tests/db-integrity/schema-check.spec.ts`: expects `timestamp-suffix …starts`, `timestamp-suffix …ends_at` and `local-time …lesson_local` | PROVEN |
| R-TIME-6 | LINT, REVIEW | `time/no-client-timestamp` (`packages/config/eslint-plugin-ijazah/rules/no-client-timestamp.js`, T159) | **None.** The caller kinds in `apps/api/src/surfaces/procedures.ts` accept any `z.ZodType` input, so nothing refuses a write schema that carries a client timestamp. No type test exists. FR-021 puts this rule in Phase 0 **Re-count 2026-10-12, after batch G**: **T159**: `tests/violations/time.spec.ts`, case `time/no-client-timestamp` (fixture `packages/contracts/src/report-attendance.ts`, `joinedAt` as an instant), and `tests/lint-plugin/no-client-timestamp.spec.ts` (11 cases: the seven names, instants under any name, local wall-clock time accepted). | PROVEN |
| R-TIME-7 | CI | `packages/time/src/resolve.ts` (`disambiguation: 'compatible'`) | `packages/time/src/resolve.spec.ts`, "T029 Cairo gap and overlap (FR-019, R-TIME-7)": "shifts a local time that does not exist forward past the gap" and "takes the first of a local time that happens twice" | PROVEN |

R-TIME-6, what would prove it:
- Constrain the input generic of the caller kinds so that a key matching a timestamp shape (`*_at`, `*At`, `timestamp`) does not compile.
- Add `@ts-expect-error` cases in `apps/api/src/surfaces/procedures.spec.ts`.
- Or have `scripts/contract-snapshot.ts` refuse such input field names, with a case in `tests/pipeline/contract-snapshot.spec.ts`.

### III. Gender (R-GENDER)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-GENDER-1 | CI | `tests/adversarial/gender.spec.ts`, ci.yml job `adversarial-gender-suite` | The only subject is "SRS §3.7.1 as written", the reference predicate, which passes. No committed case shows the suite failing a leaky subject. The T087 note records that a v1.1-asymmetric copy failed 5 cases and a copy without the payout conjunct failed 4, but these were "checked, not committed". The crafted-pagination case is `it.todo` until Phase 2 | UNPROVEN (recorded manually) |
| R-GENDER-2 | CI | Adversarial suite (cell); kernel 404 mapping `apps/api/src/platform/errors/error-filter.ts` | Kernel half proven: `apps/api/src/platform/errors/error-filter.spec.ts`, "a forbidden profile is indistinguishable from an absent one (T094, R-GENDER-2)" > "answers 404 with the very body an absent profile gets, never 403". The adversarial-suite case the cell names is `it.todo` ("Phase 2: a direct request … 404 and never 403"), because no profile endpoint exists yet | PARTIAL |
| R-GENDER-3 | CI | `tests/adversarial/gender.spec.ts` | "answers the same, count included, however many teachers of the other gender exist (R-GENDER-3)" runs only against the reference subject. The bite was recorded under T087 but is not committed. The facets and totals case is `it.todo` (Phase 2) | UNPROVEN (recorded manually) |
| R-GENDER-4 | LINT, REVIEW | `gender/no-authority-in-input` (`packages/config/eslint-plugin-ijazah/rules/no-authority-in-input.js`, T159) | **None.** No type test shows that an input schema cannot carry `gender`, `role` or `userId`, and the caller kinds accept any schema. The lint rule `gender/require-requester-gender` (R-GENDER-5) holds only repository signatures. FR-046 and T106 put this in Phase 0 **Re-count 2026-10-12, after batch G**: **T159**: `tests/violations/gender.spec.ts`, case `gender/no-authority-in-input` (fixture `packages/contracts/src/search-teachers.ts`, `gender` in an input schema), and `tests/lint-plugin/no-authority-in-input.spec.ts` (11 cases). | PROVEN |
| R-GENDER-5 | LINT, REVIEW | `rules/require-requester-gender.js` (type-aware) | `tests/violations/gender.spec.ts`, case `gender/require-requester-gender names R-GENDER-5` (fixture `catalog/catalog.repository.ts`); `tests/lint-plugin/require-requester-gender.spec.ts` | PROVEN |
| R-GENDER-6 | TYPE, CI | "No such procedure exists on either router; CI test asserts absence" | No test asserts the absence. Both routers are empty today; identity procedures arrive in Phase 1, whose definition of done in PLAN.md includes "Gender is changeable only by an admin". No Phase 0 task or FR claims this rule (research.md line 40 lists it only among the TYPE rules) | NOT-YET-APPLICABLE |
| R-GENDER-7 | RT, CI | Video port `apps/api/src/platform/ports/video/video.port.ts` (binding); the cross-gender guard at token issuance does not exist yet | The binding half is proven at type level: `apps/api/src/platform/ports/video/fake.adapter.spec.ts`, "cannot represent a token bound to a session alone, or written by hand" (`@ts-expect-error … (R-GENDER-7)`), and "refuses to bind a token to an empty session or participant". The RT guard against cross-gender pairings and the adversarial token-replay case land in Phase 3 (PLAN.md Phase 3, "Server-side token minting and join window"). T118 in Phase 0 claimed only the binding | NOT-YET-APPLICABLE (binding half proven) |

What would prove the UNPROVEN and PARTIAL rows:
- **R-GENDER-1 and R-GENDER-3.** Commit the two leaky subjects as inverted cases in `tests/adversarial/gender.spec.ts`: drop the gender conjunct, and make the v1.1 rule asymmetric. Assert that each produces a mismatch, for example by computing the case comparisons and expecting at least one per direction to differ, in the way `tests/violations/harness.ts` inverts lint. The gate is then shown to bite in CI.
- **R-GENDER-2.** The kernel half is done. The adversarial `it.todo` becomes real when the Phase 2 profile endpoint exists.
- **R-GENDER-4.**
  - Add a type-level test in `apps/api/src/surfaces/procedures.spec.ts` or `surfaces.spec.ts` showing that the context factories take no request input: `expectTypeOf<Parameters<typeof createAppContext>[0]>` has keys `session`, `log` and the like.
  - Constrain the caller-kind input type, or the contract snapshot, so that an input field named `gender`, `role` or `userId` is refused, and prove it with `@ts-expect-error` or a contract-snapshot case.
- **R-GENDER-6.** This can be added now, ahead of Phase 1: a case in `apps/api/src/surfaces/surfaces.spec.ts` or `tests/pipeline/contract-snapshot.spec.ts` that refuses an app-surface procedure whose input carries `gender`. A refusal case can be built from a fixture router, as T098 did.

### IV. Mobile (R-MOBILE)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-MOBILE-1 | LINT | `rules/no-cross-role-import.js` + `eslint.boundaries.js` | `tests/violations/boundaries.spec.ts`, two cases, one per direction (`student/imports-teacher-tree.ts`, `teacher/imports-student-tree.ts`); `tests/lint-plugin/no-cross-role-import.spec.ts` | PROVEN |
| R-MOBILE-2 | LINT | `rules/no-role-import-in-shared.js` | `tests/violations/boundaries.spec.ts`, two cases (`shared/imports-student-tree.ts`, `shared/imports-teacher-tree.ts`); `tests/lint-plugin/no-role-import-in-shared.spec.ts` | PROVEN |
| R-MOBILE-3 | REVIEW | PR template | — | REVIEW (out of scope) |
| R-MOBILE-4 | LINT | `rules/no-raw-color.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-raw-color` (`student/teacher-card-styles.ts`); `tests/lint-plugin/no-raw-color.spec.ts` | PROVEN |
| R-MOBILE-5 | LINT | `rules/no-physical-direction.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-physical-direction` (`teacher/lesson-row.tsx`); `tests/lint-plugin/no-physical-direction.spec.ts` | PROVEN |
| R-MOBILE-6 | LINT | `rules/no-raw-control.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-raw-control` (`shared/search-field.tsx`); `tests/lint-plugin/no-raw-control.spec.ts` | PROVEN |
| R-MOBILE-7 | LINT, CI | LINT `rules/no-literal-string.js`; CI "key-parity check between the two files" | LINT proven: `tests/violations/mobile.spec.ts`, case `mobile/no-literal-string` (`student/empty-state.tsx`); `tests/lint-plugin/no-literal-string.spec.ts`. **The CI key-parity check does not exist.** There is no script, no ci.yml step and no task for it, yet spec.md US1 scenario 5 (line 89) requires it in Phase 0. `apps/mobile/src/i18n/ar.json` and `en.json` are both `{}` **Re-count 2026-10-12, after batch G**: **CI half, T161**: `scripts/i18n-key-parity.ts`, stage-1 step `i18n key parity between ar.json and en.json (R-MOBILE-7)`; `tests/pipeline/i18n-key-parity.spec.ts` refuses a key either file lacks, nested ones included (18 cases). | PROVEN |
| R-MOBILE-8 | LINT, REVIEW | `rules/no-translated-concat.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-translated-concat` (`shared/greeting.ts`); `tests/lint-plugin/no-translated-concat.spec.ts` | PROVEN |
| R-MOBILE-9 | LINT | `rules/no-manual-format.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-manual-format` (`teacher/session-date.ts`); `tests/lint-plugin/no-manual-format.spec.ts` | PROVEN |
| R-MOBILE-10 | LINT | `rules/no-insecure-storage.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-insecure-storage` (`student/session-token.ts`); `tests/lint-plugin/no-insecure-storage.spec.ts` | PROVEN |
| R-MOBILE-11 | LINT | `rules/no-direct-network.js` | `tests/violations/mobile.spec.ts`, case `mobile/no-direct-network` (`teacher/roster-refresh.ts`); `tests/lint-plugin/no-direct-network.spec.ts` | PROVEN |
| R-MOBILE-12 | REVIEW | PR template | — | REVIEW (out of scope) |
| R-MOBILE-13 | CI, REVIEW | "The corresponding server test must exist in the same PR" | **None.** No mechanism exists, and no task or FR in `specs/001-foundations` mentions R-MOBILE-13. Even so, the enforcement map lists it in the CI-gates row, which it says is built in Phase 0, workstream 1 **Re-count 2026-10-12, after batch G**: Constitution 2.4.0 (T165) places its gate with the first mobile feature, Phase 1, designed on T163's path-coupling script (PLAN.md). | NOT-YET-APPLICABLE (Phase 1) |
| R-MOBILE-14 | REVIEW | PR template | — | REVIEW (out of scope) |

What would prove the open mobile rows:
- **R-MOBILE-7.** Add a missing Phase 0 task: `scripts/i18n-parity-check.ts`, which compares the flattened key sets of `apps/mobile/src/i18n/ar.json` and `en.json` and names R-MOBILE-7. Give it a `check:i18n-parity` script, a ci.yml stage-1 step, and `tests/pipeline/i18n-parity.spec.ts` with three cases: a key present in one file only refused, a nested key missing refused, and matching files passing.
- **R-MOBILE-13.**
  - Either build a PR-level gate (for example, a changed mobile file that hides an action must reference a server spec), which is hard to make sound.
  - Or amend the constitution to make R-MOBILE-13 REVIEW-only, which would make thirteen checklist items.
  - Either way it is a decision for the owner. Mobile features start in Phase 1.

### V. API (R-API)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-API-1 | LINT, REVIEW | `rules/no-logic-in-router.js` (complexity ceiling 5) | `tests/violations/layers.spec.ts`, case `api/no-logic-in-router` (`surfaces/booking.router.ts`); `tests/lint-plugin/no-logic-in-router.spec.ts` | PROVEN |
| R-API-2 | LINT | `rules/no-orm-outside-repository.js` | `tests/violations/layers.spec.ts`, case `api/no-orm-outside-repository` (`booking/booking.service.ts`); `tests/lint-plugin/no-orm-outside-repository.spec.ts` | PROVEN |
| R-API-3 | LINT | `rules/no-deep-module-import.js` | `tests/violations/boundaries.spec.ts`, case `boundaries/no-deep-module-import` (`booking/imports-catalog-internals.ts`); `tests/lint-plugin/no-deep-module-import.spec.ts` | PROVEN |
| R-API-4 | LINT | `rules/no-adapter-import.js`, `rules/no-upward-admin-import.js` | `tests/violations/boundaries.spec.ts`, two cases, one per half (`payments/imports-adapter.ts`, `booking/imports-admin.ts`); `tests/lint-plugin/no-adapter-import.spec.ts`, `no-upward-admin-import.spec.ts` | PROVEN |
| R-API-5 | REVIEW | PR template | — (port-name type tests exist, e.g. the video `fake.adapter.spec.ts` "named for what the product does (R-API-5)", but the rule is REVIEW-only) | REVIEW (out of scope) |
| R-API-6 | LINT, REVIEW | `rules/table-ownership.js` + `packages/config/module-tables.json` (type-aware) | `tests/violations/layers.spec.ts`, case `api/table-ownership` (`booking/booking.repository.ts`, typeAware); `tests/lint-plugin/table-ownership.spec.ts` covers `$`-members and the `Unsafe` forms | PROVEN |
| R-API-7 | TYPE | `apps/api/src/surfaces/procedures.ts` (every caller kind requires `input`) | `apps/api/src/surfaces/procedures.spec.ts`, "the caller kinds (T107)" > "a kind cannot be declared without its input schema" (`@ts-expect-error -- T107 …`, enforced by `pnpm typecheck`). The test cites T107 and FR-050; R-API-7 is cited only in `procedures.ts` | PROVEN-ELSEWHERE-NAME |
| R-API-8 | RT | `apps/api/src/platform/errors/error-filter.ts`, `domain-error.ts` | `apps/api/src/platform/errors/error-filter.spec.ts`, "one shape out (T094, FR-041)": "never returns a database or vendor code", "maps an unhandled exception to the internal error …" | PROVEN |
| R-API-9 | CI | `scripts/contract-snapshot.ts`, ci.yml stage 3 "Contract snapshot diff against the base (R-API-9)" | `tests/pipeline/contract-snapshot.spec.ts`, "a removal or rename fails (R-API-9)" (11 cases), "a changed type, kind or requirement fails like a removal", and "fails a removal, naming R-API-9 …" through git | PROVEN |
| R-API-10 | LINT | `rules/require-escape-hatch-reason.js` | `tests/violations/security.spec.ts`, two cases (`notifications/payload-cast.ts` for `any`, `moderation/report-count.ts` for `@ts-ignore`); `tests/lint-plugin/require-escape-hatch-reason.spec.ts` | PROVEN |
| R-API-11 | TYPE, CI | `apps/api/src/surfaces/procedures.ts` (`SurfaceRecord`), `app.router.ts`, `admin.router.ts` | `apps/api/src/surfaces/surfaces.spec.ts`, "the two surfaces share nothing (T098)": three leak cases, each with `@ts-expect-error` (TYPE) and a runtime finding (CI); `apps/api/src/app.module.spec.ts` "serves an administrator procedure on the administrator surface only" | PROVEN |
| R-API-12 | RT | `apps/api/src/surfaces/procedures.ts` (administrator caller kind writes the audit row) | `apps/api/src/surfaces/admin-procedure.spec.ts`, "the administrator caller kind writes its own audit record (T099, FR-049)": "refuses an action that describes no audit record, and keeps none of its writes", "leaves none of the action's writes behind when the audit write fails", and others. The guard lives in `surfaces/`, not `platform/` | PROVEN |
| R-API-13 | CI, REVIEW | "Request-duration test on those endpoints" | No PDF-render or bulk-notification endpoint exists. The queue (T112) exists. The endpoints arrive in Phase 4 (PLAN.md Phase 4, "Delivery job with retry" and certificate rendering after the T124 spike). No Phase 0 task claimed the test. The cell still says "disbursement", which ADR 0005/0007 retired | NOT-YET-APPLICABLE |
| R-API-14 | CI | `apps/api/src/jobs/double-run.ts` (`runOnceAndTwice`) | `apps/api/src/jobs/double-run.spec.ts`, "shows a job that repeats its effect as two different worlds". Each existing job has its own double-run case: `expire-idempotency-keys.spec.ts` "leaves after two runs what it leaves after one (R-API-14)" and `reencrypt-columns.spec.ts` "is idempotent: two runs leave what one run leaves (R-API-14)". One caveat: nothing checks that each new job's spec contains such a case | PROVEN |
| R-API-15 | LINT | `rules/no-push-outside-job.js` | `tests/violations/layers.spec.ts`, case `api/no-push-outside-job` (`booking/notify-inline.ts`); `tests/lint-plugin/no-push-outside-job.spec.ts` | PROVEN |

Suggested strengthening for R-API-14: a completeness spec in the style of T027 that lists the registered jobs (the job registry in `apps/api/src/worker.ts` or `jobs/`) and fails when a job's spec file has no `runOnceAndTwice` or "two runs" case.

### VI. Database (R-DB)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-DB-1 | CI | `scripts/migration-check.ts`, ci.yml stage 3 "Migration checksum verification against the base (R-DB-1)" | `tests/pipeline/migration-check.spec.ts`, "a merged migration that changes fails, naming R-DB-1 (FR-037)" (6 cases) and "a new migration that sorts before the base's last one fails" | PROVEN |
| R-DB-2 | REVIEW | Runbook | — | REVIEW (out of scope) |
| R-DB-3 | DB | `prisma/migrations/20261007000100_roles_and_privileges` (REVOKE DELETE on 5 tables), `20261007000500_append_only_tables` | `tests/db-integrity/privileges.spec.ts`, "DELETE is refused to the application role (T050, SC-004)": `%s: DELETE refused ten times out of ten` and `%s: TRUNCATE refused` (42501), for users, sessions, enrollments, ijazahs and audit_logs. Also `audit.spec.ts` and `append-only.spec.ts`, and `soft-delete.spec.ts` "refuses a hard delete on each of the four tables". All cite SC-004 and FR-026, never R-DB-3 | PROVEN-ELSEWHERE-NAME |
| R-DB-4 | CI, REVIEW | ERD registry | — (the schema check machine-holds part of it: `derived-value` and `declared-cache` in `schema-check.spec.ts`; see the discrepancies at the end) **Re-count 2026-10-12, after batch G**: Since constitution 2.4.0 (T165): `CI`, the schema gate. `tests/db-integrity/schema-check.spec.ts` refuses `derived-value probe_violations.total_score` and `lesson_count` and checks the declared caches; whether any other value is derived stays on the PR checklist. | PROVEN |
| R-DB-5 | DB | Check constraints in `prisma/migrations/20261007000000_init` (hand-extended, T064) | `tests/db-integrity/constraints.spec.ts`, "ERD §15 rules 1–9, each refused by the database (T051, SC-007)". It covers all four invariants the rule names: "rule 1: a user with neither phone nor email", "rule 2: an enrollment whose student is its teacher", "rule 8: a chat message with neither body nor attachment" and "rule 9: a rating outside 1–5" (23514). It cites SC-007 and the ERD, not R-DB-5 | PROVEN-ELSEWHERE-NAME |
| R-DB-6 | RT, LINT | LINT `rules/no-weak-random.js`; RT `apps/api/src/platform/guards/identifiers.ts` | LINT proven: `tests/violations/security.spec.ts`, case `db/no-weak-random` (`certification/certificate-number.ts`); `tests/lint-plugin/no-weak-random.spec.ts`. RT not proven: `apps/api/src/platform/guards/identifiers.spec.ts` checks only format, distinctness over 10,000 draws and use of the whole alphabet, and calls itself "a smoke test of the source, not a proof of randomness". A zero-padded base32 counter, or a `Math.random` source, would pass every case. RT proven by T166: `identifiers.source.spec.ts` replaces `node:crypto`'s `randomBytes` with a fake and asserts each identifier is exactly the encoding of the bytes drawn; a `Math.random` token fails it (observed red) | PROVEN (RT by T166) |
| R-DB-7 | CI, REVIEW | `scripts/schema-check.ts` `secret-column`, `hash-type` | `tests/db-integrity/schema-check.spec.ts`: expects `secret-column …api_token`, `secret-column …reset_code` and `hash-type …code_hash` (the header cites R-DB-7) | PROVEN |
| R-DB-8 | CI | `bytea` `_encrypted` columns (ERD §0); `scripts/schema-check.ts` `encrypted-type` | `tests/db-integrity/schema-check.spec.ts`: expects `encrypted-type …note_encrypted` (not bytea) and `encrypted-type …blob` (bytea without the suffix) (the header cites R-DB-8). This is the CI schema gate reading column types; the database engine refuses nothing. Supporting: `tests/db-integrity/encrypted-columns.spec.ts`, `apps/api/src/platform/crypto/encryption.spec.ts` **Re-count 2026-10-12, after batch G**: Since constitution 2.4.0 (T165) the cell names the CI schema gate: `schema-check.spec.ts` refuses `encrypted-type probe_violations.note_encrypted` and `blob`. | PROVEN |
| R-DB-9 | REVIEW | — | — | REVIEW (out of scope) |

R-DB-6 RT, done by T166 in a file of its own, `identifiers.source.spec.ts`, as first proposed here: `vi.mock('node:crypto')` so that `randomBytes` or `randomInt` returns fixed bytes, and assert the exact expected certificate number and token. A generator that does not draw from `node:crypto` then fails. Alternatively, spy on the crypto call and assert that it was the source.

### VII. Security (R-SEC)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-SEC-1 | Gitleaks pre-commit, CI, REVIEW | `.husky/pre-commit` gitleaks line; ci.yml job `secret-scan` (full history) | `tests/pipeline/secret-scan.spec.ts`: "the local check (.husky/pre-commit, T082)" > "rejects a secret staged in %s" (including `specs/…`), and "the pipeline check (ci.yml secret-scan, T083)" > "rejects a secret committed in %s and removed in a later commit". Both cite SC-010 and FR-059, not R-SEC-1. The cell's "GitHub push protection" is not available on this private personal repository and was closed as not available (second note under T090) **Re-count 2026-10-12, after batch G**: Since constitution 2.4.0 (T165) the cell no longer names GitHub push protection, unavailable on this repository. | PROVEN-ELSEWHERE-NAME |
| R-SEC-2 | LINT, REVIEW | `rules/no-body-logging.js` | `tests/violations/security.spec.ts`, case `sec/no-body-logging` (`identity/otp-request-log.ts`); `tests/lint-plugin/no-body-logging.spec.ts`. Runtime redaction is also tested in `apps/api/src/platform/logging/logger.spec.ts`; that is not a claimed tier | PROVEN |
| R-SEC-3 | RT | `apps/api/src/platform/ports/storage/storage.port.ts` (no public-path method) | `apps/api/src/platform/ports/storage/storage.spec.ts`, "has exactly four operations, none of which hands out a lasting path" (`expectTypeOf<keyof StoragePort>`, enforced by tsc), and per implementation "every link expires: honoured within its lifetime, refused once it has passed" | PROVEN |
| R-SEC-4 | RT, CI | `apps/api/src/platform/guards/upload.middleware.ts` | `apps/api/src/platform/guards/upload.spec.ts`, "content sniffing (T097, FR-044)": "judges a renamed image by its content", "refuses the renamed image on a path that accepts PDF only", and `@ts-expect-error` "discards the declaration rather than comparing it" | PROVEN |
| R-SEC-5 | RT, CI | Upload sniffing (R-SEC-4) applied to the chat attachment path | No chat attachment path exists; it arrives in Phase 3 (PLAN.md Phase 3, "In-session chat with document attachments", "Image rejection by server-side content sniffing"). The mechanism it will reuse is proven by `upload.spec.ts` "refuses the renamed image on a path that accepts PDF only". No Phase 0 task claimed the chat case | NOT-YET-APPLICABLE |
| R-SEC-6 | RT, CI | `apps/api/src/platform/guards/rate-limit.guard.ts` | `apps/api/src/platform/guards/rate-limit.spec.ts`, "rate limiting (T137, FR-043, R-SEC-6)": "throttles the $path path beyond its configured limit" (4 default paths) and "names the four default paths by the settings keys the seed plants" (limits exist) | PROVEN |
| R-SEC-7 | REVIEW | — | — | REVIEW (out of scope) |
| R-SEC-8 | TYPE, REVIEW | `admin_users` separate from `users` (schema); `AppContext` and `AdminContext` in `apps/api/src/surfaces/context.ts`; two tRPC instances in `procedures.ts` | **None direct.** No db-integrity probe or schema-check rule shows that the two identities share no table. No type test shows that `AppContext` and `AdminContext` are mutually unassignable, although `context.ts` claims they are. `surfaces.spec.ts` "a procedure built on another tRPC instance does not compile on either surface" is indirect evidence only: it rests on the surface meta and would not fail if the two contexts were made one type. FR-032 and US2 scenario 11 (spec.md line 137) put this rule in Phase 0 **Re-count 2026-10-12, after batch G**: **T162**: `apps/api/src/surfaces/context.spec.ts`, `@ts-expect-error` in both directions over the `surface` discriminant, enforced by `pnpm typecheck`; observed red before it (a user context with the admin fields was assignable). The separate tables are review's since constitution 2.4.0 (T165). | PROVEN |
| R-SEC-9 | RT | `apps/api/src/platform/errors/error-filter.ts` | `apps/api/src/platform/errors/error-filter.spec.ts`: "maps an unhandled exception to the internal error, with no stack, query or path" and "never carries a domain error's cause, stack or extra fields"; `apps/api/src/app.module.spec.ts` "sends an unexpected failure as the internal error …" | PROVEN |
| R-SEC-10 | REVIEW | `docs/RUNBOOK.md` | — **Re-count 2026-10-12, after batch G**: Since constitution 2.4.0 (T165) the cell carries the `REVIEW` tag. | REVIEW (out of scope; the cell says "Runbook - process rule", with no REVIEW tag) |
| R-SEC-11 | LINT | `rules/no-disabled-tls.js` | `tests/violations/security.spec.ts`, case `sec/no-disabled-tls` (`platform/ports/sms/sms.transport.ts`, `rejectUnauthorized: false`); `tests/lint-plugin/no-disabled-tls.spec.ts`, including `insecureHTTPParser` | PROVEN |
| R-SEC-12 | CI | ci.yml job `dependency-alerts` (`pnpm audit --audit-level critical` and the Dependabot REST read, both failing closed) | No committed failing case, and the step logic is inline bash with no spec. The note under T090 records local red runs: an empty token, a bogus token (401), stand-in `gh` with two alerts (exit 1), no page (exit 1), a 403 (exit 1), and `--audit-level high` exiting 1. None of these is reproducible from the repository **Re-count 2026-10-12, after batch G**: **T160**: the logic is `scripts/dependency-alerts.ts`; `tests/pipeline/dependency-alerts.spec.ts` (22 cases over stand-ins) exits 1 on an open critical alert, a critical audit advisory, a missing token, a 401/403/404/500, a non-list answer and a missing page. | PROVEN |

What would prove the open security rows:
- **R-SEC-8.**
  - A db-integrity probe, or a new `schema-check` rule with a case, asserting that no foreign key joins `admin_users` and `users` and that no session or token table is shared.
  - In `surfaces.spec.ts`, `expectTypeOf<AppContext>().not.toMatchTypeOf<AdminContext>()` and the reverse, or an `@ts-expect-error` assignment each way.
- **R-SEC-12.** Move both steps' logic into `scripts/dependency-alerts.ts`, or a checked-in shell script, and add `tests/pipeline/dependency-alerts.spec.ts`. It runs the script with a stand-in `gh` and `pnpm` on `PATH` and asserts exit 1 for: one open critical alert, no page, a non-list answer, an empty token, and an audit exiting non-zero. It asserts exit 0 for an empty list.

### VIII. Sessions (R-SESS)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-SESS-1 | TYPE, DB | DB: `session_participant_events.provider_event_id` unique. TYPE: no client-writable attendance field | DB proven: `tests/db-integrity/replay.spec.ts`, "a duplicate provider_event_id on session_participant_events is refused as unique (FR-036, ERD section 15.4)", and `constraints.spec.ts` "rule 4: a replayed provider attendance event is refused" (23505). Neither cites R-SESS-1. TYPE not yet applicable: no attendance procedure or write schema exists until Phase 3 ("Attendance webhooks into participant events"). The video port's `ParticipantEvent` is reachable only through `verifyAndParseParticipantEvent(Buffer)` (`fake.adapter.spec.ts`) | PARTIAL (DB proven; TYPE not yet applicable) |
| R-SESS-2 | CI | Test: "a session with a missing end-webhook still settles" | The evaluation job does not exist; it arrives in Phase 3 ("Evaluation job at scheduled end plus two minutes"). No Phase 0 task claimed it | NOT-YET-APPLICABLE |
| R-SESS-3 | RT | Guard in the evaluation job | Phase 3 (same job). Not a `platform/` guard | NOT-YET-APPLICABLE |
| R-SESS-4 | CI | Mandatory reconnection test | Phase 3 ("Simultaneous time accumulated across reconnections") | NOT-YET-APPLICABLE |
| R-SESS-5 | RT, CI | Guard at token issuance | Phase 3 ("Server-side token minting and join window"). T118 built only the port's binding | NOT-YET-APPLICABLE |
| R-SESS-6 | RT | No automatic transition out of `under_threshold` and `provider_outage` | Phase 3 ("Admin review queues for under-threshold and outage") | NOT-YET-APPLICABLE |

### IX. Product honesty (R-HONEST)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-HONEST-1 | CI, REVIEW | Test that `confirmed_at` has one write path and that no proof-upload endpoint exists | Phase 2: its definition of done reads "`confirmed_at` has exactly one write path and no proof-upload or manual-paid endpoint exists". Related Phase 0 work: `apps/api/src/platform/config/config.spec.ts` "refuses the payment stand-in in production only … (T146, R-HONEST-1)". That is not the mechanism the cell names. The "no proof-upload endpoint" half could already be asserted against the contract snapshot | NOT-YET-APPLICABLE |
| R-HONEST-2 | CI | Component test on the chain display | Phase 4 ("Chain of transmission", mobile component) | NOT-YET-APPLICABLE |
| R-HONEST-3 | CI | Verification-page test per mode | Phase 4 ("Public certificate verification page", Mode B) | NOT-YET-APPLICABLE |
| R-HONEST-4 | TYPE, CI | Output schemas; field-leak test | Phase 1 builds `is_minor`, date of birth and documents. The owner decided on 2026-10-10 that the Phase 1 spec must require `.output(schema)` on every procedure. No procedure has an output today | NOT-YET-APPLICABLE |
| R-HONEST-5 | TYPE, REVIEW | `apps/api/src/platform/ports/push/push.port.ts` (`PushPayload` holds ids only) | `apps/api/src/platform/ports/push/fake.adapter.spec.ts`, "carries identifiers for deep-linking only (R-HONEST-5)": `expectTypeOf<keyof PushPayload>` plus `@ts-expect-error -- T119: a push payload has no field for a message's text (R-HONEST-5)` | PROVEN |
| R-HONEST-6 | CI | Test on all three surfaces | Phase 4 (revocation, profile, verification page, PDF link) | NOT-YET-APPLICABLE |

### X. Process (R-PROC)

| Rule | Tiers | Mechanism (file) | Failing case | Status |
|---|---|---|---|---|
| R-PROC-1 | CI | `scripts/branch-spec-check.ts`, ci.yml stage 1 `pnpm check:branch` | `tests/pipeline/branch-spec-check.spec.ts`, "any other name is refused, naming R-PROC-1 and the expected form" (`it.each`) and "refuses a task branch that targets main, naming R-PROC-1 and develop" | PROVEN |
| R-PROC-2 | REVIEW | — | — | REVIEW (out of scope) |
| R-PROC-3 | REVIEW | — | — | REVIEW (out of scope) |
| R-PROC-4 | CI | Branch protection on `main` and `develop` (a GitHub setting) | Two of the three prohibitions are held by the ruleset `main-protection` (active, no bypass actor, on `refs/heads/develop` and `refs/heads/main`): a direct push is refused because a pull request is required, a merge needs one approving review (stale approvals dismissed on push), and deletion and non-fast-forward pushes are refused (GitHub API, 2026-10-12). The third, "merge red CI", is not held: the ruleset has no `required_status_checks` rule, which T089 adds. Not probed by pushing to either branch, on purpose **T089, 2026-10-12**: the owner added `required_status_checks` to the same ruleset: the five stage jobs, `secret-scan`, `adversarial-gender-suite` and `dependency-alerts`, each bound to the GitHub Actions app, with the up-to-date policy on (GitHub API, 2026-10-12; tasks.md, note under T089). All three prohibitions are now configured. What the row still lacks is SC-009's evidence: a recorded refused direct push and a recorded refused merge, because a setting has no unit test | PARTIAL (configured; SC-009's attempts not yet recorded) |
| R-PROC-5 | CI | `packages/config/vitest.base.ts` per-path 80% floors; ci.yml stage 2 "Unit and property tests with the 80% coverage floor (R-PROC-5)" | No committed failing case. The note under T086 records a red run made by hand ("with `reporting.spec.ts` moved aside for one local run, the errors path fell to 55.6 / 62.5 / 50 / 58.1 and Vitest failed …"), but it is not committed. The cell's "suite gates" (a gender or time change must update its adversarial or DST tests) have no mechanism; the adversarial and DST suites run, but nothing checks that they were updated **Re-count 2026-10-12, after batch G**: **T163**: `scripts/suite-gate.ts` (stage 3) refuses a gender or time change without its adversarial or DST specs; `tests/pipeline/suite-gate.spec.ts` (36 cases) also runs the real `vitest.base.ts` over `tests/violations/fixtures/packages/money/src/under-floor.ts` and asserts exit 1 (red with the floor lowered to 10%). | PROVEN |
| R-PROC-6 | REVIEW | — | — | REVIEW (out of scope) |
| R-PROC-7 | LINT, CI | `rules/require-suppression-reason.js`; `scripts/suppression-gate.ts` (stage 1); `reportUnusedDisableDirectives: 'error'` in the type-aware set | LINT: `tests/violations/security.spec.ts`, case `proc/require-suppression-reason` (`verification/review-code.ts`); `tests/lint-plugin/require-suppression-reason.spec.ts`. CI: `tests/pipeline/suppression-gate.spec.ts`, "the gate refuses it, in each spelling ESLint reads (T140)", "an unused directive fails `pnpm lint:types`" and "exits 1 naming R-PROC-7" | PROVEN |
| R-PROC-8 | LINT | `rules/no-bare-marker.js` | `tests/violations/security.spec.ts`, two cases (`booking/hold-expiry.ts` for a bare TODO, `chat/attachment-filter.ts` for commented-out code); `tests/lint-plugin/no-bare-marker.spec.ts` | PROVEN |
| R-PROC-9 | CI | `scripts/generated-file-check.ts`, ci.yml stage 3 "Generated-file drift check (R-PROC-9)" | `tests/pipeline/generated-file-check.spec.ts`: "fails a copy that differs, naming R-PROC-9 …", "fails a lockfile that no longer matches a manifest", "fails a lockfile edited by hand …" | PROVEN |
| R-PROC-10 | LINT, REVIEW | `rules/no-focused-or-skipped-test.js` (and Vitest refuses `.only` in CI) | `tests/violations/security.spec.ts`, two cases (`reviews/reviews.service.spec.ts` with `.only`, `notifications/notifications.service.spec.ts` with `.skip`); `tests/lint-plugin/no-focused-or-skipped-test.spec.ts` | PROVEN |
| R-PROC-11 | LINT, REVIEW | `api/table-ownership` (R-API-6): only the admin module reaches `settings` (constitution 2.4.0, T165) | **None.** The application role is granted SELECT, INSERT, UPDATE and DELETE on all tables (`prisma/migrations/20261007000100_roles_and_privileges/migration.sql` line 26, default privileges line 39), so the database refuses no write to `settings`. The repository comment in `apps/api/src/modules/admin/settings.repository.ts` ("never writes it") is not enforced. `tests/seed/seed.spec.ts` shows only that a re-seed leaves a changed setting alone. FR-034 ("writable only through the administrative surface") puts this rule in Phase 0 **Re-count 2026-10-12, after batch G**: `tests/lint-plugin/table-ownership.spec.ts`, case "all 33 manifest tables, each reached through the delegate Prisma would generate", refuses `prisma.setting` from a file outside its owner. The case cites R-API-6. | PROVEN-ELSEWHERE-NAME |

What would prove the open process rows:
- **R-PROC-4.** Do T089: add to the ruleset `main-protection` the stage, adversarial, secret-scan and dependency-alerts jobs as required checks, then record SC-009's attempts as evidence. A recorded refused push or merge is the failing case, because a setting has no unit test.
- **R-PROC-5.** Add `tests/pipeline/coverage-floor.spec.ts`. It runs Vitest with the base config over a small fixture under a covered path, with an uncovered branch, and asserts a non-zero exit and the threshold message. A spec that goes red if `vitest.base.ts` loses its thresholds is cheaper: it reads the config and asserts all four covered paths at 80 on all four measures. That proves the floor is configured, but not that it bites.
- **R-PROC-11.**
  - At type level, `expectTypeOf<keyof SettingsRepository>()` and `keyof SettingsReader` hold read methods only, with `@ts-expect-error` on a write.
  - At database level, revoke INSERT, UPDATE and DELETE on `settings` from `ijazah_app` until the admin write path exists. Add a probe in `tests/db-integrity/privileges.spec.ts`.
  - Or amend the cell to name the real mechanism: table ownership in `module-tables.json` plus review.

---

## Summary

### Counts per status (99 rule ids), re-counted 2026-10-12 after batch G

Batch G (T159 to T163, T165) and T166 proved or re-tiered fourteen rows. The first count, over `develop` at 626d443, was 55 proven, 4 partial, 9 unproven and 14 not yet applicable, among 82 machine-tier rules.

| Status | Count |
|---|---|
| PROVEN | 56 |
| PROVEN-ELSEWHERE-NAME | 7 |
| PARTIAL | 3 |
| UNPROVEN | 2 (both recorded manually, not reproducible) |
| NOT-YET-APPLICABLE | 15 |
| SUPERSEDED | 5 |
| REVIEW (out of scope) | 11 |
| **Total** | **99** (83 with a machine tier, 5 superseded, 11 REVIEW-only) |

R-DB-4 left the REVIEW-only count when constitution 2.4.0 gave it `CI`; it stays on the PR checklist, which keeps twelve items. Of the 83 rules that claim a machine tier, 63 are proven (56 + 7), 5 are partial or unproven, and 15 hold mechanisms later phases build. A strict SC-003 count is therefore 20, and Phase 0's own count, the rules whose mechanism Phase 0 was to build, is 5. Neither is zero, so T130 stays open.

### The lists

- **PROVEN-ELSEWHERE-NAME** (proven, but the test does not cite the id):
  - R-MONEY-8 (`replay.spec.ts`)
  - R-TIME-3 (`schema-check.spec.ts` `local-time`)
  - R-API-7 (`procedures.spec.ts` T107 `@ts-expect-error`)
  - R-DB-3 (`privileges.spec.ts`, `audit.spec.ts`, `append-only.spec.ts`, `soft-delete.spec.ts`)
  - R-DB-5 (`constraints.spec.ts` rules 1, 2, 8, 9)
  - R-SEC-1 (`secret-scan.spec.ts`)
  - R-PROC-11 (`table-ownership.spec.ts`, the case over all 33 tables)
- **Proven by batch G and T166**: R-TIME-6 and R-GENDER-4 (T159), R-SEC-12 (T160), R-MOBILE-7's CI half (T161), R-SEC-8 (T162), R-PROC-5 (T163), R-DB-6's runtime half (T166); and, by constitution 2.4.0's tiers, R-DB-4 and R-DB-8 (the schema gate) and R-PROC-11 (table ownership).
- **PARTIAL:**
  - R-GENDER-2: the kernel 404 is proven; the adversarial case is `it.todo` until Phase 2.
  - R-PROC-4: the ruleset holds all three halves since T089 (2026-10-12); SC-009's refused attempts are not yet recorded.
  - R-SESS-1: DB is proven; TYPE is not yet applicable.
- **UNPROVEN, recorded manually in tasks.md but not committed:**
  - R-GENDER-1 and R-GENDER-3 (T087 note): a condition of the Phase 1 teacher-list task (PLAN.md).
- **NOT-YET-APPLICABLE**, by the phase where the code lands (constitution 2.4.0's second CI row):
  - **Phase 1:** R-GENDER-6, R-MOBILE-13, R-HONEST-4.
  - **Phase 2:** R-HONEST-1.
  - **Phase 3:**
    - R-GENDER-7 (the binding half is already proven)
    - R-SEC-5
    - R-SESS-2, R-SESS-3, R-SESS-4, R-SESS-5, R-SESS-6
  - **Phase 4:** R-API-13, R-HONEST-2, R-HONEST-3, R-HONEST-6.

### Why `completeness.spec.ts` stays green

T027 (`tests/violations/completeness.spec.ts`) checks only the 30 lint rule ids in `contracts/lint-rules.md`. Nothing machine-checks the TYPE, DB, CI and RT tiers. That is how 14 open rows coexist with a green suite. If T130 is to hold the count at zero, it needs an equivalent register. One option is a table in the spec folder mapping each rule id to a test id, read by a spec that parses the constitution's tier column.

### Discrepancies between the enforcement map (constitution lines 281–288) and the per-rule tier cells

Every rule in the per-rule cells appears in the matching map rows, and the "Rules held elsewhere" table in `contracts/lint-rules.md` repeats the map exactly. The differences found:

1. **R-SEC-1 appears in the `eslint-plugin-ijazah` row of the map**, but its cell names no LINT tier (Gitleaks pre-commit, CI, REVIEW), and `contracts/lint-rules.md` publishes no lint rule for it.
2. **R-DB-4 is listed as REVIEW-only**, in the map's PR-checklist row and in the checklist itself. Yet `scripts/schema-check.ts` machine-checks part of it (`derived-value`, `declared-cache`), and `schema-check.spec.ts` cites R-DB-4.
3. **The schema check is a CI gate that also holds rules whose cells and map rows name no CI tier.** These are R-TIME-3 (`local-time`), R-DB-8 (`encrypted-type`) and R-MONEY-1 (`piasters-type`). Conversely, the proofs of R-TIME-3 and R-DB-8 are this CI gate, not a refusal by the database engine. The cells say DB.
4. **R-SEC-10 is counted among "the twelve REVIEW-only rules"**, but its cell reads "Runbook - process rule" with no `REVIEW` tag.
5. **R-PROC-4 is in the CI-gates row, but its mechanism is a GitHub repository setting**, branch protection, not a pipeline gate. It is half built (the ruleset requires a reviewed pull request but no status check; T089 open), so the meaning of the CI tier ("violation blocks the merge") holds for no CI rule today.
6. **R-SEC-1's cell names "GitHub push protection"**, which is not available on this repository (second note under T090). The cell overclaims.
7. **The `RT` tag means "a runtime guard in `platform/`"**, and the map row is labelled "(`platform/`)". But R-API-12's guard is in `apps/api/src/surfaces/procedures.ts`, and R-SESS-3's is "in the evaluation job".
8. **The map says the CI-gates row is "Phase 0, workstream 1" and calls itself "the build list for Phase 0".** It includes R-MOBILE-13, R-API-13, R-SESS-2/4/5 and R-HONEST-1/2/3/4/6, whose gates cannot be built until Phases 1–4.
9. **R-MOBILE-13 is in the CI-gates row**, but no Phase 0 task, FR or spec scenario mentions it.
10. **R-MOBILE-7's CI half (key-parity check) is in the map's CI row and in spec.md US1 scenario 5**, but `tasks.md` has no task for it. This is a gap in the task list, not only in the proof.
11. **R-API-13's cell still lists "disbursement"** as heavy work, which ADR 0005 and 0007 retired (R-MONEY-7 is superseded).
12. **SC-003 (spec.md line 451) is narrower than the tiers.** It names compiler, linter, pipeline gate and "database privilege". It omits runtime guards: the RT-only rules R-API-8, R-API-12, R-SEC-3, R-SEC-9, R-SESS-3 and R-SESS-6 fall outside its wording. It also omits database constraints and unique indexes: the DB-tier rules R-MONEY-8, R-TIME-3, R-DB-5, R-DB-8, R-SEC-8, R-SESS-1 and R-PROC-11 are not privileges. Only R-DB-3 is a privilege.
13. **Arithmetic check.** "Roughly 88% of the active rules are held by machines" is 82 of 94, which is 87.2%. That is consistent.

---

## Decisions (owner, 2026-10-12)

Each open row takes one of two paths: a task that proves it with a tool that exists today, or a correction of the constitution where the tier names a mechanism that nothing holds. A correction lowers the count as honestly as a proof does.

| Rule | Status | Path |
|---|---|---|
| R-TIME-6, R-GENDER-4 | UNPROVEN | T159: a lint rule over the input schemas of `packages/contracts`; T165 records the `LINT` tier |
| R-SEC-12 | UNPROVEN (manual) | T160: the job's logic moves to `scripts/dependency-alerts.ts` with a spec |
| R-MOBILE-7 (CI half) | PARTIAL | T161: the key-parity script, spec and step |
| R-SEC-8 | UNPROVEN | T162: a `surface` discriminant and a type test for the `TYPE` half; T165 corrects the `DB` half to the ERD and `REVIEW` |
| R-PROC-5 | UNPROVEN (manual) | T163: the suite gate, and a spec that runs the coverage command over a fixture below the floor |
| R-DB-6 (RT half) | PARTIAL | T166, this batch: proven |
| R-PROC-11 | UNPROVEN | T165: `DB` corrected to `LINT` (table ownership, R-API-6) and `REVIEW` |
| R-PROC-4 | PARTIAL | T089 (owner): the required status checks |
| R-MOBILE-13 | UNPROVEN | Phase 1 cycle; stays `CI`, designed on T163's path-coupling script; T165 moves its build to Phase 1. The PR checklist stays at twelve |
| R-GENDER-1, R-GENDER-3 | UNPROVEN (manual) | Phase 1 cycle: a condition of the teacher-list task, whose procedure is the first that returns teacher data (PLAN.md) |
| R-GENDER-2, R-SESS-1 (TYPE half) | PARTIAL | With the code of Phases 2 and 3 |
| The 14 NOT-YET-APPLICABLE rows | — | T165 splits the map's CI row by the phase that builds each gate, so Phase 0's count no longer claims them |

The discrepancies above are corrected by T165 as one MINOR amendment (2.4.0, no ADR: no prohibition is weakened), classified as index errors (the map follows the rule cells: items 1, 4, 7, 8, 11), tiers claimed without a mechanism (items 3 for R-TIME-3 and R-DB-8, 6, 9, and R-PROC-11 and R-SEC-8 above), and a mechanism the cell omits (item 2). Item 5 needs no text change once T089 lands, item 10 is T161, item 12 is SC-003's wording, which T130's note records, and item 13 is a confirmation. T130 stays open until the count is zero and is carried to the Phase 1 cycle.

**After batch G (re-count, 2026-10-12).** Closed: R-TIME-6, R-GENDER-4, R-SEC-12, R-MOBILE-7, R-SEC-8, R-PROC-5, R-PROC-11, and by 2.4.0's tiers R-DB-4 and R-DB-8; R-MOBILE-13 moved to its Phase 1 build; R-MONEY-1's cell names the schema gate since 2.4.1 (T167, noticed in the review of PR #63). Still open: R-GENDER-1 and R-GENDER-3 (the Phase 1 teacher-list condition), R-GENDER-2 and R-SESS-1 (their code arrives in Phases 2 and 3), R-PROC-4 (T089, the owner's), and the fifteen rows later phases build. The discrepancies above are all corrected by constitution 2.4.0 and 2.4.1.
