# Implementation Plan: The ijazah programme — the assessment and prepaid monthly instalments

**Branch**: `Ejazah_app/003-booking/T108` (the cycle). The batches run as `Ejazah_app/006-programme/<task ids>`, cut
from `develop` after T108's PR merges (`tracks-coordination.md` §1). | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-programme/spec.md` (clarified 2026-11-19, SRS DEC-92 and DEC-93)

## Summary

The ijazah track's programme on top of what track 2 built:
- **The assessment:** a paid order of kind `assessment` on today's checkout; its session is the enrollment's
  session 0.
- **The offer:** the length fits the reserved weekly time; the total = count × the teacher's price for that length.
- **Paying:** the rest in full, or prepaid months of 4 sessions generated one month at a time.
- **Renewal:** an automatic charge on a saved card when a paid month ends, or a manual renewal from 3 days before.
  A failed charge is retried on a soft decline only (days 1, 3, 5, 7).
- **The pause:** an unpaid month at its first occurrence. A late payment generates the month from the next
  occurrence, so the missed sessions fall at the end by construction.
- **Requests:** the teacher's stop request after 7 days, and the refusal request after the assessment, both decided
  by an administrator.
- **Releases:** the assessment's share after its 72 h; 25 % of the offer's share at half; the rest at the end; the
  months' share at a stop.

No subscription service; every charge is an ordinary order with the split, recorded by the one signed webhook. The
decisions are in [research.md](research.md), R-501 to R-517.

## Technical Context

- **Language and dependencies:** TypeScript (strict). NestJS API with tRPC; Prisma 7 on PostgreSQL; BullMQ on Redis;
  Expo phone app; React (Vite) admin panel; zod contracts; vitest and jest. No new dependency.
- **Storage:** PostgreSQL only:
  - new: `programmes`, `programme_requests`, `programme_cards`;
  - new columns: `payments.kind`, `payments.instalment_month`, `packages.price_30/45/60_piasters`;
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
| R-MONEY-12 | Six settings (R-515); retry days and bounds from the registry |
| R-SEC (column encryption) | The card token is encrypted by `ColumnCipher`, rotated by `reencrypt-columns`, never logged |
| R-GENDER-1, 2 | Every new read and mutation registered in the adversarial harness, both directions |
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
prisma/schema/{base,booking,catalog,payments}.prisma; prisma/migrations/<stamp>_ijazah_programme/; prisma/seed.ts
packages/contracts/src/{programme.ts, admin/programme.ts}; packages/money/src/index.ts (month amounts)
apps/api/src/platform/ports/payment/{payment.port.ts, paymob.adapter.ts, fake.adapter.ts}
apps/api/src/platform/settings/registry.ts
apps/api/src/modules/catalog/       packages (three prices), discovery (range), the average per length
apps/api/src/modules/booking/       programmes, requests, the assessment's slots, confirm by kind, recordOrderFailed by kind
apps/api/src/modules/payments/      checkout by kind, rates copied, saved cards, chargeSavedCard, releases, monitor's kind
apps/api/src/modules/sessions/      generation by month, counts >= 1
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
| B-P1 | 11/20–11/22, beside the design week | Migration, schema, ERD; settings; contracts; the three prices and the catalogue; the assessment's booking and confirmation; order kinds in the confirm step |
| B-P2 | 11/22–11/24 | The offer; the 48 hours and the refusal request; paying in full or a month (rates copied, generation by month); counts from session 1; the releases (assessment, half on the offer's total, end) |
| B-P3 | 11/24–11/26 | Saved cards (port, adapters, encrypted rows, erasure); the automatic charge; `advance-programmes` (due, charge, retry, pause, lapse); manual renewal; the stop request, the close and its release; reopen |
| B-P4 | 11/26–12/3, after the design week, on the new design | Phone (student, teacher), panel pages, adversarial registrations and i18n, the quickstart run and the documents |

Whatever is not merged and green by 12/4 moves to v1.1, and an ijazah package is sold as today until it lands
(DEC-92). The programme's server code gets its own money review lane at the full review's depth once merged.

## Plan questions for the owner

- **P1 — The assessment fee's amount** (R-515). The owner set it as «ours» but gave no figure.
  - (a) The setting is seeded 0 = unset; no ijazah-track package can be published until an administrator sets it on
    the settings page.
  - (b) A figure the owner gives now is seeded.
  - **Recommend (a)**, unless he has the figure.
- **P2 — Existing ijazah-track packages at the migration** (R-503). They have a count, a length and a total, not three
  prices.
  - (a) The migration deactivates them; their enrollments are untouched and keep B-M2's one-order rule. It is
    closed-test data (DEC-87), and the teacher re-creates the package with three prices.
  - (b) It fills the package's own length price from total ÷ count and leaves the other two empty, which breaks the
    check.
  - **Recommend (a).**

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| Three nullable package columns | Q-C1's three prices | A child table adds a join to every discovery read for three fixed values |
| A new port method and event | DEC-92's automatic charge without a subscription | A subscription is what DEC-92 removed |
| Generation by month | No session unpaid (DEC-92) | Generating all sessions and cancelling unpaid ones touches evaluation, release and reminders |
