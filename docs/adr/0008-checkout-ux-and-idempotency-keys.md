# ADR 0008 — Checkout user experience and the `idempotency_keys` table

**Status:** accepted · **Date:** 2026-09-06 · **Addendum to:** [ADR 0007](0007-direct-gateway-checkout.md)

## Context

Two gaps surfaced after ADR 0007 landed:

1. `docs/design/screens.md` described the booking sheet as returning to a
   "waiting for confirmation" state until the webhook lands. That projected the
   backend sequence onto the screen. No requirement mandates a pending screen;
   FR-PAYG-3 only says the client redirect never *confirms* a payment. The
   product needs a standard e-commerce checkout: review, pay, brief processing,
   instant confirmation.
2. Research R-14 and FR-042 require the kernel's idempotency mechanism to be
   keyed in PostgreSQL, but no table in the ERD held those records — the former
   dependency was the ledger's key column, removed by ADR 0005. Task T102 had
   nothing to write to.

## Decisions

### D1 — Standard checkout flow, driven by server state

The student experiences: **Checkout** (order summary, payment method, Pay) →
**gateway hosted checkout** (card data never touches the app) → **Processing**
("Confirming your payment", the app subscribes to the enrollment's status) →
**Payment successful, enrollment confirmed** (receipt and generated sessions).
The success screen renders only when the server reports `status = confirmed`,
which is set only by the `confirm-enrollment` job on a persisted, signed
webhook event (R-HONEST-1, FR-PAYG-3/5). Webhooks arrive in one to three
seconds, so the processing state is brief. If confirmation exceeds a
configurable threshold (`checkout_confirmation_timeout_seconds`, default 15),
the student is released to the app with "Payment received, finalising your
sessions", the enrollment shows a "Confirming" badge, and the existing
payment-confirmed push resolves it. Failure or cancellation at the gateway shows
"Payment not completed" with Retry or Choose another slot (FR-PAYG-6).
Requirements FR-PAYG-17 and FR-PAYG-18 state this.

### D2 — `idempotency_keys` owned by `platform`

A small table, `idempotency_keys` — `(scope, key)` unique, `request_hash`,
`response` (jsonb), `status in_progress · completed`, `created_at`, `expires_at`
— owned by the platform kernel, in `prisma/schema/platform.prisma`. It backs
FR-042 and R-API-14 for client-retried mutations. It is **not** how webhooks are
made replay-safe; that remains the unique provider event id on `payment_events`
and `session_participant_events`. Rows expire after `idempotency_key_ttl_hours`
(default 24), swept by the `expire-idempotency-keys` job. The manifest gains a
`platform` entry; the ERD grows to 33 tables. Task T134 models it; T102 depends
on T134.

## Documents amended

`docs/design/screens.md`, `docs/design/frames/flows/README.md`, `docs/SRS.md`
(FR-PAYG-17/18, §3.14, §6.1, UC-2), `docs/ARCHITECTURE.md` (§4, §5, §8.1),
`docs/ERD.md` (§1, §12, §15, changelog), `specs/001-foundations/{spec,plan,
research,data-model,tasks,quickstart}.md`, `contracts/kernel.md`,
`packages/config/module-tables.json`, `prisma/schema/platform.prisma`,
`apps/api/src/jobs/README.md`, `ADR 0007` consequences.
