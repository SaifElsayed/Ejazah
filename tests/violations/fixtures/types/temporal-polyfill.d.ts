// T024 — a stand-in for `@js-temporal/polyfill`, so the fixture program compiles.
// The library is confined to `packages/time` (research R-4) and is not linked into
// `tests/violations/fixtures/`, which carries no package.json. The R-TIME-1 fixture that
// imports it is a `fast` case and never needs the type; this declaration only keeps the
// fixture tree's promise that each file is broken by one lint rule, not by the compiler.
// Only the member the fixture touches is declared.
declare module '@js-temporal/polyfill' {
  export namespace Temporal {
    export const Instant: {
      from(value: string): { toString(): string };
    };
  }
}
