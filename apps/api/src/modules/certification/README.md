# certification

## Owns

`ijazahs, ijazah_bars`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Write `isnad_entries` or `teacher_signatures`; both stay in `catalog` and the chain is read through its public entry (ADR 0005 D2, ERD §1). Generate a certificate number or token from weak randomness (R-DB-6). Store the verification token bare (R-DB-7).

## Shape

`certification.service.ts` holds every rule. `certification.repository.ts` holds every query. `certification.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
