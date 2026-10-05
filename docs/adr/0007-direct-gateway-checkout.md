# ADR 0007 — Direct gateway checkout with post-approval teacher payout configuration

**Status:** accepted · **Date:** 2026-09-06 · **Supersedes:** ADR 0005 decision D1 (the off-platform direct-payment model) and the parts of ADR 0006 D1 that stated the visibility predicate without payout readiness. · **Amended by:** [ADR 0010](0010-database-refuses-double-booking.md), two points of D4: the hold timing (the slot hold outlives the gateway order by a grace) and the port's operations (the port also cancels an unpaid order, which moves no money).

## Context

ADR 0005 retired the managed escrow model ("Mode B") and made off-platform
direct payment between teacher and student ("Mode A") the only model. That
left the platform blind: a teacher's manual "paid" toggle gated session
generation, which is honest but unverifiable, and it left the student with no
protection at all. The business has now finalised a third model that keeps the
one property both earlier models fought over — the platform never holds money —
while making payment confirmation automatic and tamper-proof.

## Decision

### D1 — Direct gateway checkout, 0% commission, zero custody

The student pays through a payment gateway at checkout. The gateway deducts its
own fee and settles **100% of the net proceeds directly to the teacher's payout
account**. The platform takes no commission. At no moment does the platform hold,
route, or have a claim on the funds. Consequently there is **no wallet, no
escrow, no ledger (`ledger_entries`), no balance, and no per-session deferred
revenue share** anywhere in the system. What the platform keeps is a *record* of
each gateway order: gross amount, gateway fee, net amount, gateway identifiers,
status, and the signed events that produced them.

### D2 — Automated confirmation by signed webhook

Confirming an enrollment creates a gateway order and hands the student to the
gateway's hosted checkout. The enrollment sits in `pending_payment`. The only
thing that confirms payment is the gateway's **signed webhook**: the signature
is verified before any handler runs (R-MONEY-9 reinstated), every event carries
a provider event id that is unique and non-null so a replay is acknowledged and
ignored (R-MONEY-8 reinstated), and the event is persisted before it is acted
on. A confirmed payment enqueues an idempotent `confirm-enrollment` job that
transitions the enrollment to `confirmed`, converts the slot hold, generates all
sessions and notifies both parties. There is no manual reference handshake, no
teacher confirmation toggle, no proof-of-payment upload, and a client redirect
or return URL is never trusted (R-HONEST-1 redefined).

### D3 — Post-approval payout onboarding as a bookability gate

A teacher applies with identity and academic credentials only. Payout setup
happens in the app **strictly after** admin approval: the teacher registers a
payout account with the gateway, the platform stores only the gateway's
recipient reference, encrypted (R-DB-8), plus `payout_configured_at` and
`payout_verified_at` on `teacher_profiles`. Until the gateway verifies the
account, the teacher **cannot publish availability or packages, does not appear
in discovery, and cannot be booked**. The visibility predicate of ADR 0006 gains
a fourth conjunct: `teacher_profile.payout_verified_at IS NOT NULL`.

### D4 — Module and port shape

- `PaymentPort` returns as the fifth port. It speaks the domain — create a
  checkout for an enrollment, verify and parse an inbound event, register a
  payout recipient, report a recipient's verification status — and never a
  vendor's vocabulary. It ships in Phase 0 as an interface plus a recording
  stand-in; the real adapter lands in Phase 2.
- A `payments` module returns, owning two tables: `payments` (one row per
  gateway order) and `payment_events` (one row per inbound signed event, keyed by
  the provider's event id). It owns the raw-body webhook ingestion endpoint,
  which lives outside tRPC because gateways POST plain HTTP.
- `teacher_profiles` stays owned by `identity`; the payments module records
  payout readiness through identity's public entry.
- Two jobs: `confirm-enrollment` (idempotent, double-run safe) and
  `expire-pending-payments` (releases the hold and cancels the enrollment when
  the gateway order lapses with the slot-hold TTL).

### D5 — Compensation is an admin matter; one item stays open

- **Refunds and compensation (was OPEN-10, now resolved).** The platform never
  holds funds, so it cannot refund in code. Reimbursement is strictly an
  administrative matter between the student and Platform Administration:
  every termination that leaves paid-for sessions undelivered opens a
  compensation case in the moderation queue automatically, an admin decides it
  with a recorded reason, and Platform Administration executes it through the
  gateway outside the platform's code path. The platform records the decision
  (`disputes.resolution = compensation_ordered`) and the outcome
  (`payments.status = refunded`, from the gateway's signed event). It is never
  a negotiation between student and teacher (SRS FR-DISPUTE-5/6, DEC-50).
- **OPEN-11 Gateway selection.** The gateway must offer hosted checkout, direct
  settlement to individually onboarded recipients with no platform custody,
  recipient onboarding for individuals without a commercial register, and
  signed webhooks. No vendor is named in normative text.

## Consequences

- The ERD grows from 30 to 32 tables (33 with ADR 0008's `idempotency_keys`); the constitution moves to 2.1.0 (rules
  reinstated and redefined, none removed); SRS v1.4; ERD v1.3; ARCHITECTURE
  v3.2. Retired identifiers (FR-PAY-*, FR-PAYA-*, R-MONEY-3/4/7/10/11) stay
  retired; the new requirements are the `FR-PAYG-*` family.
- Product honesty is now mechanical: a "paid" state can only come from a
  verified gateway event, and there is no code path that can set it otherwise.
- The gateway's KYC of individual teachers becomes a launch dependency again
  (RISK-10), which is the price of automated settlement.

## Documents amended

`docs/SRS.md`, `docs/ERD.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`,
`docs/design/screens.md`, `docs/adr/0005`, `docs/adr/0006`, `PLAN.md`,
`README.md`, `.specify/memory/constitution.md`,
`specs/001-foundations/{spec,plan,research,data-model,tasks,quickstart}.md`,
`specs/001-foundations/contracts/{README,ports,kernel,lint-rules}.md`, the three
agent definitions, and the scaffold under `apps/`, `packages/`, `prisma/`,
`tests/`.
