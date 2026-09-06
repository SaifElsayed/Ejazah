# catalog

## Owns

`subjects, teacher_subjects, packages, availability_slots, isnad_entries, teacher_signatures`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Store an availability slot as an absolute instant; it is wall-clock plus IANA zone (R-TIME-3). Return teachers without the requester's gender in the repository signature (R-GENDER-5).

## Also owns: discovery

Search and browse are a filtered query over this module's own tables, so discovery is a service here, not a module (ADR 0005 D2). Every teacher-returning repository method takes the requester's gender and filters in SQL (R-GENDER-5); no unfiltered method exists. The predicate is: same gender, verification approved, not soft-deleted, payout verified (SRS §3.7.1, ADR 0006, ADR 0007).

## Shape

`catalog.service.ts` holds every rule. `catalog.repository.ts` holds every query. `catalog.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
