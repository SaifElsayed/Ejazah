// T023 — a stand-in for `@ijazah/money`, so the type-aware money fixtures resolve.
// `tests/violations/fixtures/` carries no package.json, so pnpm links no workspace dependency
// into it and `@ijazah/money` resolves to nothing from here. `money/require-piaster-suffix`
// (R-MONEY-2) and `money/no-arithmetic-outside-package` (R-MONEY-5) both decide from the
// resolved type, and neither can decide anything against `any` — so the brand is declared here
// the way `types/prisma-client.d.ts` declares the generated database client for R-API-6.
// The shape mirrors `packages/money/src/index.ts`: a `unique symbol` declared and never
// exported, which is what makes a plain number and a piaster value mutually unassignable
// (FR-012, research R-3).
declare module '@ijazah/money' {
  const piastersBrand: unique symbol;

  export type Piasters = number & { readonly [piastersBrand]: true };
}
