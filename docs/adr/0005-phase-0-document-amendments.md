# ADR 0005 — Phase 0 document amendments

**Status:** accepted; decision D1 superseded by [ADR 0007](0007-direct-gateway-checkout.md), and with it D1's "no `PaymentPort`", "four ports" and "no `payments` module" (ADR 0007 D4 returned both, so the counts of D2 read "twelve modules", and the ports are seven: email since [ADR 0012](0012-sign-in-with-google-apple-or-email.md), sign-in since the Phase 1 ports contract, `specs/002-identity/contracts/ports.md`) · **Date:** 2026-09-05 · **Task:** T126

## Context

A cross-document audit before Phase 0 implementation found the governing documents
disagreeing with each other and with the Phase 0 design (`specs/001-foundations/`).
ARCHITECTURE v3.0, PLAN.md and README predate the Phase 0 plan; the constitution,
ERD and SRS carried a managed-payment model the business has since withdrawn.
This ADR records every decision taken to reconcile them, so a reader of any single
document can trace why it changed.

## Decisions

### D1 — No payment processing. Payment is arranged directly between teacher and student.

The platform does not process, hold, transmit, verify or record payment amounts.
The teacher tells the student how they prefer to be paid; the student pays them
directly; the teacher marks the enrollment paid as their own private record
(SRS FR-PAYA-1 to FR-PAYA-8). What was "Mode A" is now the only model. "Mode B"
(managed escrow via a gateway) is **retired**, not deferred.

Consequences:

- **No `PaymentPort`.** ARCHITECTURE §3.1's own rule applies: a port with one
  implementation forever is speculative generality. Four ports remain: storage,
  video, push, sms.
- **No `payments` module** and **no money tables.** `wallets`, `ledger_entries`,
  `payments`, `payout_destinations`, `withdrawal_requests` are removed from the
  ERD. `enrollments.payment_mode` and `sessions.escrow_share_piasters` are removed.
  The ERD now defines **30 tables**, not 35.
- **`packages/money` shrinks to the branded type.** Package prices are still
  integer piasters (`price_piasters`, `snapshot_price_piasters`) and still typed
  as `Piasters` so a plain number cannot reach a price position (R-MONEY-1/2/5).
  Share splitting (FR-015, R-MONEY-11) is retired with the escrow it served.
- **Constitution R-MONEY rules 3, 4, 7, 8, 9, 10, 11 are retired** (ids kept,
  marked superseded per the governance rule). R-MONEY-6 is redefined to forbid
  wallet, ledger, balance, escrow and payout vocabulary anywhere. R-MONEY-12
  keeps its meaning (operational numbers come from `settings`) with its gate
  widened from `payments/` to every module.
- **Enrollment status `refunded_remaining` becomes `terminated_no_show`.**
  Termination at the teacher no-show threshold is a scheduling outcome; any
  refund is between the parties.
- **SRS FR-PAY-1 to FR-PAY-22 are retired**, along with the wallet, withdrawal
  queue, ledger view and payout-budget requirements that depended on them.
  Requirements that mentioned escrow consequences keep their ids with the
  monetary clause removed.
- **PLAN.md Phase 5 (Mode B payments) is retired.**

### D2 — Eleven modules, table ownership unified

Two module lists existed: ARCHITECTURE §4 (twelve modules plus platform, with
`discovery` and `sessions` and no `payments`) and data-model §1 (eleven, with
`payments`, without `discovery` or `sessions`). The adopted list is:

`identity`, `verification`, `catalog`, `booking`, `sessions`, `chat`,
`certification`, `reviews`, `moderation`, `notifications`, `admin`.

- **`sessions` is a module**, owning `sessions`, `session_participant_events` and
  `cancellation_requests`. Live lifecycle, attendance evidence and mutual
  cancellation are one concern (Phase 3), distinct from purchase and scheduling
  (Phase 2). `booking` keeps `slot_holds` and `enrollments`; session generation
  goes through the `sessions` module's public entry.
- **`discovery` is not a module.** Search is a filtered query over catalog tables
  (ARCHITECTURE §3.2), and a module owning no tables would have to read another
  module's tables to do anything, which R-API-6 forbids. Discovery is a service
  inside `catalog`; the gender filter is enforced in catalog's repository
  signatures (R-GENDER-5).
- **`teacher_profiles` stays in `identity`** and **`isnad_entries` and
  `teacher_signatures` stay in `catalog`**, as the ERD's domain map has always
  said. Certification reads the chain through catalog's public entry.
- The ERD domain names now match the module names exactly: `MONEY` is gone,
  `COMMUNITY` is `REVIEWS`, `NOTIFICATION` is `NOTIFICATIONS`, `SESSIONS` is added.
  `packages/config/module-tables.json` is the machine-readable form.

### D3 — The worker is a second process of `apps/api`

`apps/api/src/worker.ts` with jobs under `apps/api/src/jobs/`. There is no
`apps/worker`. Three deployable applications: mobile, admin, api (two processes).

### D4 — Slot holds live in PostgreSQL

`slot_holds` is a table owned by `booking`. Redis is restricted to BullMQ queues
and rate limiting; nothing whose loss would diverge from the database goes there.

### D5 — Router directory is `apps/api/src/surfaces/`

Chosen over `trpc/` because the folder is named for what it holds (two
separately mounted surfaces, FR-048) rather than for the transport library.

### D6 — Schema inventory

`prisma/schema/base.prisma` plus one file per module: `identity`, `verification`,
`catalog`, `booking`, `sessions`, `chat`, `certification`, `reviews`,
`moderation`, `notifications`, `admin`.

### D7 — Coverage floor is per path

80% on `packages/money`, `packages/time` and the kernel's guard and error paths in
Phase 0, widening to each domain module as it is created. No blanket floor.

### D8 — Task T125 removed

ARCHITECTURE §9 already states that availability slots are local wall-clock plus
zone. The task described an error that does not exist.

### D9 — Git flow: `develop` is the integration branch

Spec-named feature branches (`001-foundations`) open pull requests into
`develop`. `develop` merges into `main` through a release pull request. Direct
pushes to `main` and `develop` are blocked once branch protection is enabled.
Bootstrap commits made before protection was enabled went to `main` directly and
are recorded as such.

### Minor

- ARCHITECTURE §15 matches quickstart: `pnpm infra:up` for services, `pnpm dev`
  for applications.
- PLAN.md's "five external applications" becomes the three deployables.

## Documents amended by this ADR

`docs/ARCHITECTURE.md` (v3.0 → v3.1), `docs/ERD.md` (v1.1 → v1.2),
`docs/SRS.md` (v1.2 → v1.3), `.specify/memory/constitution.md` (1.1.0 → 2.0.0),
`PLAN.md`, `README.md`, `docs/RUNBOOK.md`, `docs/adr/0001`,
`docs/design/screens.md`, `specs/001-foundations/{spec,plan,research,data-model,
tasks,quickstart}.md` and `contracts/`, the three agent definitions, and the
scaffold under `apps/`, `packages/`, `prisma/`, `tests/`.

## Consequences

- The model is smaller and every remaining rule has a caller. Nothing in the
  system can imply that money moved through it, which is the product-honesty
  guarantee R-HONEST-1 exists for.
- Reintroducing managed payments later is a new spec, a new ADR and a MAJOR
  constitution amendment, not a flag flip. That is deliberate: a half-built
  ledger is worse than none (PLAN.md, former Phase 5).
- Identifiers that were retired (rule ids, requirement ids, task ids) are never
  reused, so citations in old logs and reviews still resolve.
