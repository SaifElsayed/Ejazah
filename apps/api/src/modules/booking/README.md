# booking

## Owns

`slot_holds, enrollments, enrollment_events`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Write the `sessions` table; session generation is requested through the sessions module's public entry (R-API-6, ADR 0005 D2). Reference a wallet, ledger, balance, escrow or a money amount (R-MONEY-6). Set `confirmed_at` from anything but the `payments` module's public call made by the `confirm-enrollment` job on a persisted paid event; no client, teacher or admin path exists (R-HONEST-1, FR-PAYG-8). Read a `payments` row (R-API-6). Hold a slot anywhere but the `slot_holds` table (ADR 0005 D4).

## Shape

`booking.service.ts` holds every rule. `booking.repository.ts` holds every query. `booking.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

`catalog-use.repository.ts` (T020) answers catalog's `CatalogUse` port, bound in `main.ts` through `createCatalogUse`: whether a package has an enrollment, and the enrollment count of each package; whether a slot is in use is `slot-occupancy.service.ts`'s since T026. Queries only, on the caller's transaction and with no lock: the caller holds its locks before it asks (T005's rule 1).

`slot-occupancy.service.ts` and `slot-occupancy.repository.ts` (T026) are a slot's occupancy (R-205): taken by an active hold or an enrollment `pending_payment`; held by a `confirmed` enrollment on every local date before its release, the week after its final session (read through the sessions module's entry) plus `slot_release_buffer_weeks`. `nearest-slot.service.ts` is the discovery card's nearest free slot per teacher of a page, by `firstOccurrenceAfter` with `first_session_lead_hours`, over catalog's offered slots and identity's predicate with `purpose: 'book'`. `discovery.service.ts` composes catalog's discovery service (the `DiscoveryCatalog` seam) with it, and `discovery.router.ts` serves `discovery.browse` and `discovery.filters` to a student under `rate_limit_search`. Read-only: no lock.

`booking-slots.service.ts` (T032) is the booking sheet's slots of one package: the package read through catalog's entry for its teacher alone, identity's predicate with `purpose: 'book'` asked of that teacher before anything else (NOT_FOUND otherwise), catalog's offered slots of exactly the package's length, free by the occupancy above on their first session's date, less those any of whose sessions overlaps the student's or the teacher's own sessions (`session-overlap.service.ts`, the one check the hold applies too; read through the sessions module's entry, T033); each with its first session by `firstOccurrenceAfter` and its last by `resolveOccurrences`, the calls generation makes. `booking.router.ts` serves `booking.slots` to a student under `rate_limit_search`. Read-only: no lock, nothing written.

`holds.service.ts` and `holds.repository.ts` (T033) are holds, functions of the entry on the caller's transaction: `placeHold` (FR-351 to FR-353: the predicate, the student's account and the slot decided after both accounts and the slot are locked; the slot's and the student's expired holds released first; the insert for `slot_hold_ttl_minutes` plus `slot_hold_grace_minutes`; every one of the package's sessions checked against both parties' own; a refusal thrown, so the caller keeps nothing), `releaseHolds` and `releaseExpiredHolds` (FR-363: the holds, then their enrollments, then payments' order standing, each locked in id order; an enrollment awaiting payment cancelled with its reason and one event row, one with a `paid` order left awaiting payment except under `slot_unavailable`), and `reholdEnrollment` (FR-PAYG-19, for the confirm job). The order standing is payments' `orderStandingsOf`, handed in by the caller: booking reads no `payments` row and does not import payments. `enrollment-events.repository.ts` is booking's one writer of `enrollment_events` rows (R-216).

`confirmation.service.ts` and `confirmation.repository.ts` (T039) are the `confirm-enrollment` job's booking, on its transaction: `lockForConfirmation` takes every lock in T005's order (both accounts, the slot, the active holds on the slot and of the student, their enrollments with this one, then payments' orders through the `orders` handed in) and reads the enrollment under them; `confirmEnrollment` converts the enrollment's hold by a conditional update and only then confirms it from `pending_payment` or `cancelled`, with one `confirmed` row naming the order, the only writer of `confirmed_at` (R-HONEST-1); `refuseEnrollment` releases what it holds through `releaseHolds` under `slot_unavailable` and cancels it, `slot_unavailable` or, refused for a party while already cancelled, its own reason, with one `cancelled` row (FR-362).

## Requirement ids

- FR-312, FR-318 (a package with an enrollment and a slot in use keep their terms; R-207): `catalog-use.repository.ts`, `slot-occupancy.service.ts`.
- FR-394, FR-BOOK-10 (a slot offered again from the week after its final session plus the buffer; R-205): `slot-occupancy.service.ts`.
- FR-335 (the card's nearest free slot; R-205): `nearest-slot.service.ts`, `discovery.service.ts`, `discovery.router.ts`.
- FR-365, FR-385 (a failed order's `order_failed` outcome, appended by the payments module's order branch on its transaction; R-214, R-216): `order-failed.repository.ts`, until B29's integration makes booking's one writer of `enrollment_events`.
- FR-350, FR-386 (the booking sheet's slots and their first and last sessions; R-205, R-209): `booking-slots.service.ts`, `booking.router.ts`.
- FR-351 to FR-353, FR-363, FR-PAYG-19, FR-BOOK-5 (holds, their releases and the one overlap check; R-208): `holds.service.ts`, `holds.repository.ts`, `session-overlap.service.ts`.
- FR-385 (the outcomes' rows; R-216): `enrollment-events.repository.ts`.
- FR-361, FR-362, FR-375, FR-PAYG-19 (the confirmation and the refusal of a paid order, for `confirm-enrollment`; R-215): `confirmation.service.ts`, `confirmation.repository.ts`.
