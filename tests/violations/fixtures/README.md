# Violation fixtures (T019)

Deliberately illegal code. Every file here breaks exactly one rule of
`.specify/memory/constitution.md`, and `tests/violations/*.spec.ts` asserts that the
project's own ESLint configuration refuses it and names the rule (SC-003, FR-011).

The tree mirrors the real one — `apps/mobile/src/features/{student,teacher,shared}/`,
`apps/api/src/modules/<module>/`, `apps/api/src/platform/ports/<port>/`,
`apps/api/src/surfaces/` — because every rule these fixtures exercise decides from the
file's path. A fixture at a path the rule cannot recognise proves nothing.

Nothing here is compiled by `tsc --build`, linted by `pnpm lint`, or collected by Vitest: the
root `tsconfig.json` excludes the directory, `packages/config/eslint.base.js` ignores it, and the
root `vitest.config.ts` excludes it from `include`. The harness lints it anyway, with the ignore
list switched off, through the same configuration the pipeline uses.

The runner exclusion is not cosmetic. T026's R-PROC-10 fixtures are real `*.spec.ts` files
carrying `.only` and `.skip` — the prohibition itself — and a collected `.only` would silence
every other test in the run.

Imports resolve inside this tree so a rule that classifies an import by resolving it reaches a
real file rather than nothing.
