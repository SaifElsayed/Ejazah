# booking

## Owns

`slot_holds, enrollments, enrollment_events`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Write the `sessions` table; session generation is requested through the sessions module's public entry (R-API-6, ADR 0005 D2). Reference a wallet, ledger, balance, escrow or a money amount (R-MONEY-6). Set `confirmed_at` from anything but the `payments` module's public call made by the `confirm-enrollment` job on a persisted paid event; no client, teacher or admin path exists (R-HONEST-1, FR-PAYG-8). Read a `payments` row (R-API-6). Hold a slot anywhere but the `slot_holds` table (ADR 0005 D4).

## Shape

`booking.service.ts` holds every rule. `booking.repository.ts` holds every query. `booking.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

`catalog-use.repository.ts` (T020) answers catalog's `CatalogUse` port, bound in `main.ts`: whether a slot is in use (an active hold, or an enrollment `pending_payment` or `confirmed`), whether a package has an enrollment, and the enrollment count of each package. Queries only, on the caller's transaction and with no lock: the caller holds its locks before it asks (T005's rule 1).

## Requirement ids

- FR-312, FR-318 (a package with an enrollment and a slot in use keep their terms; R-207): `catalog-use.repository.ts`.
