# moderation

## Owns

`disputes, gender_flags, user_reports`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Compensation cases

`disputes` holds session disputes and enrollment-level compensation cases (`kind`). Termination flows open compensation cases automatically (FR-DISPUTE-5). An admin's `compensation_ordered` resolution records the decision only; Platform Administration executes it through the gateway outside the code path, and `payments` records the gateway's refunded event (FR-DISPUTE-6). This module never references a money amount (R-MONEY-6).

## Never

Auto-resolve under_threshold or provider_outage sessions; those are terminal only by admin action (R-SESS-6).

## Shape

The rules live in the services: `compensation-case.service.ts` (the system's compensation case, `openCompensationCase`, T035). The queries live in the repositories: `compensation-case.repository.ts` (the open case of an enrollment and reason, its insert, and the enrollment's row lock the opening serialises on, T005). A router, when one arrives, is thin: validate, call one service method, return. `index.ts` is the only import path. The probe over the real tables, the race included, is `tests/db-integrity/compensation-case.spec.ts`.

## Requirement ids

FR-362, FR-375, FR-DISPUTE-5 (`openCompensationCase`: one open case per enrollment and reason, `slot_unavailable`, `party_restricted` or `duplicate_payment`; T035).
