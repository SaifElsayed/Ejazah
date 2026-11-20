# Implementation Plan: The ijazah programme — the assessment and prepaid monthly instalments

**Branch**: `Ejazah_app/003-booking/T108` (the cycle). The batches run as `Ejazah_app/006-programme/<task ids>`, cut
from `develop` after T108's PR merges (`tracks-coordination.md` §1). | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-programme/spec.md` (clarified 2026-11-19, SRS DEC-92 and DEC-93)

## Summary

The ijazah track's programme on top of what track 2 built:
- **The assessment:** a paid order of kind `assessment` on today's checkout; its session is the enrollment's
  session 1, the offer's sessions 2..N+1 (DEC-94: the half counts it).
- **The switch:** `programme_enabled`, off until B-P4 merges, so ijazah packages sell as today until then (I-3, DEC-94).
- **The offer:** the length fits the reserved weekly time; the total = count × the teacher's price for that length.
- **Paying:** the rest in full, or prepaid months of 4 sessions generated one month at a time.
- **Renewal:** an automatic charge on a saved card when a paid month ends, or a manual renewal from 3 days before.
  A failed charge is retried on a soft decline only (days 1, 3, 5, 7).
- **The pause:** an unpaid month at its first occurrence. A late payment generates the month from the next
  occurrence, so the missed sessions fall at the end by construction.
- **Requests:** the teacher's stop request after 7 days, and the refusal request after the assessment, both decided
  by an administrator.
- **Releases (DEC-94):** the assessment's share on its own only when the student does not continue. Otherwise:
  - 25 % of the share of the programme's whole price (in full: the offer's total; by months: the total and the fee) at half the N+1 sessions;
  - the rest at the end;
  - the paid share at a stop.
- **The closes' amounts:** each session valued by its own order.

No subscription service; every charge is an ordinary order with the split, recorded by the one signed webhook. The
decisions are in [research.md](research.md), R-501 to R-517.

## Technical Context

- **Language and dependencies:** TypeScript (strict). NestJS API with tRPC; Prisma 7 on PostgreSQL; BullMQ on Redis;
  Expo phone app; React (Vite) admin panel; zod contracts; vitest and jest. No new dependency.
- **Storage:** PostgreSQL only:
  - new: `programmes`, `programme_requests`, `programme_cards`;
  - new columns: `payments.kind`, `instalment_month`, `attempt`, `automatic`, `decline_kind`, `confirmed_at`;
    `packages.is_programme`, `price_30/45/60_piasters`; `sessions.programme_month`;
  - `payments.gateway_order_id` NULL-able for an automatic order not yet answered;
  - three package columns made nullable;
  - new members: `order_kind`, `cancellation_reason`, `share_release_milestone`, the programme's enums.
- **Gateway:** `PaymentPort.chargeSavedCard` and the `card_saved` event (R-509, R-510). The live adapter stays off
  until the gateway's written answers (OPEN-11). The stand-in runs every path.
- **Testing:** full TDD (red first, named mutants) for money and time (R-517); lighter specs for ordinary screens;
  DB specs on `ijazah_integrity_b`.
- **Target:** Android first; the panel in a desktop browser.
- **Scale:** one sweep a minute over active programmes (MVP: hundreds).
- **Constraints:**
  - no refund or release call in code (R-MONEY-6, DEC-81/82);
  - no card detail in a log, response or audit entry;
  - additive contracts (R-API-9);
  - gender rules on every new read;
  - every number a setting (R-MONEY-12).

## Constitution Check

| Rule | How this plan holds it |
|---|---|
| R-MONEY-6, ADR 0025 | The platform holds nothing; each month is an order with the split. Releases and refunds are listed and executed by hand (DEC-81, DEC-82). The automatic charge is the student's consented payment, not a transfer |
| R-MONEY-9 | The `card_saved` callback and every order event pass the webhook's signature check first; a token callback the live adapter cannot verify is refused (R-510) |
| R-MONEY-12 | Eight settings (R-515); retry days and bounds from the registry; «4 sessions a month» is DEC-93's definition, not an operational number |
| R-DB-8 (R-DB-7 does not fit a token used again) | The card token is encrypted by `ColumnCipher`, as `payments.checkout_url_encrypted` is, rotated by `reencrypt-columns`, never logged |
| R-SEC-2 | No card detail (token, number, expiry) in a log, an audit entry or a response; last4 and brand to the student only |
| R-GENDER-1, 2; R-PROC-5 | Every new read and mutation registered in the adversarial harness, both directions, in the batch that adds it. Every programme procedure lives under one `programme` router, which joins the harness's both-directions reach whatever the caller kind (as `SESSION_ROUTERS`) and its never-exempt `ATTACKED_ROUTERS` (`procedure-harness.ts:268`, `:287-291`, `:305`, `:333-342`; #142 r1 Major 1's precedent) |
| R-API-9 | The package output becomes a union by track; recitation's fields stay non-null |
| R-API-1…6, 12, 14 | Thin routers, services decide, each module its own tables; administrator decisions audited; `advance-programmes` has its double-run spec |
| R-PROC-1 | This spec folder; batch branches `Ejazah_app/006-programme/<ids>` |
| R-PROC-6 | Merged by 12/4, else v1.1 (DEC-92) |

**Gate: passes.** No new dependency.

## Project Structure

### Documentation (this feature)

```text
specs/006-programme/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── contracts/ (app-surface.md, admin-surface.md, jobs.md, gateway.md)
└── checklists/requirements.md
```

### Source code touched (repository root)

```text
prisma/schema/{base,booking,catalog,payments,sessions}.prisma; prisma/migrations/<stamp>_ijazah_programme/; prisma/seed.ts
packages/contracts/src/{programme.ts, admin/programme.ts}; packages/money/src/index.ts (month amounts)
apps/api/src/platform/ports/payment/{payment.port.ts, paymob.adapter.ts, fake.adapter.ts}
apps/api/src/platform/settings/registry.ts
apps/api/src/modules/catalog/       packages (three prices), discovery (range), the average per length
apps/api/src/modules/booking/       programmes, requests, the assessment's slots, confirm by kind, recordOrderFailed by kind
apps/api/src/modules/payments/      checkout by kind, rates copied, saved cards, chargeSavedCard, releases, monitor's kind
apps/api/src/modules/sessions/      generation by month (programme_month, from max+1), the completion gate, restore refused
apps/api/src/jobs/advance-programmes.ts; jobs/confirm-enrollment.ts
apps/mobile/src/features/{student,teacher}/programme/; teacher/packages (prices)
apps/admin/src/pages/programmes/; settings labels
tests/adversarial, tests/db-integrity (on _b)
```

**Structure decision.** Each part lives in the module that owns its table (`module-tables.json`):
- `programmes` and `programme_requests` → booking;
- `programme_cards` → payments;
- the prices → catalog.

The integration wires `context.ts`, `app.router.ts`, `admin.router.ts`, `main.ts` and `worker.ts` in a `006:` block.

## Batches (track 2; at most six tasks each; ids in tasks.md)

| Batch | When (DEC-92) | Tasks (summary) |
|---|---|---|
| B-P1 | 11/21–11/22, beside the design week (Q-1) | Migration, schema, ERD; settings; contracts; the three prices and the catalogue; the assessment's booking and confirmation; order kinds in the confirm step |
| B-P2 | 11/22–11/24 | The offer; the 48 hours and the refusal request; paying in full or a month (rates copied, generation by month); the completion gate; the releases (the assessment when not continued, the half on the programme's whole price, the end); the case amounts per order |
| B-P3 | 11/24–11/26 | Saved cards (port, adapters, encrypted rows, erasure); the automatic charge; `advance-programmes` (due, charge, retry, pause, lapse); manual renewal; the stop request, the close and its release; reopen |
| B-P4 | 11/26–12/3, after the design week, on the new design | Phone (student, teacher), panel pages, adversarial registrations and i18n, the quickstart run and the documents |

Whatever is not merged and green by 12/4 moves to v1.1, and an ijazah package is sold as today until it lands
(DEC-92). The programme's server code gets its own money review lane at the full review's depth once merged.

## The owner's answers (2026-11-19, SRS DEC-94; no open question)

- **P1 (a):** the assessment fee is seeded 0 = unset; no programme package is published until an administrator sets it.
- **P2 (a), with the switch:** turning `programme_enabled` on deactivates every old-style ijazah-track package
  (closed-test data), their enrollments untouched; the migration changes no row, so «sold as today» holds until then.
- **The analysis's I-2 (a):** the offer within 24 h of the delivered assessment (`programme_offer_hours`); with no offer by
  then, an Administrator item, never a lapse, the weekly time reserved meanwhile.
- **R-505:** the 48 hours run from the offer («ال 48 ساعة دي بتبدأ من وقت عرض الباقة»); the first regular session is the
  first weekly occurrence after them.
- Settled by the review session on recorded precedents, written in DEC-94:
  - G-4: as today (FR-SESS-16), a suspension pauses (no due, no charge, no retry, no pause; the card deleted); a ban, a departure or an Administrator's end of a suspended programme ends it, with DEC-85's full refund; a restore after a suspension is deferred.
  - I-3: `programme_enabled`, off by default, turned on when B-P4 lands.
  - U-1: the student's own weekly time is protected.
  - I-1: FR-PROFILE-8 amended for the programme as A-2 (a)'s consequence.
  - K-2: «4 sessions a month» is a definition.
- **PR #153's review, round 1 (the owner's «Approve all», 2026-11-20):** the student can turn the automatic renewal
  off at any time, which deletes the card (Major 4 (a), DEC-95).

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| Three nullable package columns | Q-C1's three prices | A child table adds a join to every discovery read for three fixed values |
| A new port method and event | DEC-92's automatic charge without a subscription | A subscription is what DEC-92 removed |
| Generation by month | No session unpaid (DEC-92) | Generating all sessions and cancelling unpaid ones touches evaluation, release and reminders |
