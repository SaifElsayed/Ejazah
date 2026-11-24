# ADR 0026 — The gateway's authenticated answer to the platform's own inquiry confirms an automatic charge

**Status:** accepted · **Date:** 2026-11-24 · **Decided by:** the owner, 2026-11-24 («(a) ADR 0026», typed in B-P3's
review session, on PR #160's first review, Major 1) · **Amends:** constitution R-HONEST-1 (MINOR: 2.7.0 at the integration's version pass), SRS
FR-PAYG-3, ERD `payment_events.signature_verified_at` · **Rests on:** SRS DEC-110 (2), DEC-113 (1)

## Context

R-HONEST-1 says a payment is confirmed only by the gateway's signed webhook. Every manual checkout still works that
way.

An automatic charge of the ijazah programme (`specs/006-programme`, T014 and T015) can lose its callback. SRS DEC-110
(the owner, 2026-11-22) decided the platform never charges again while an earlier attempt's status is unknown. It asks
the gateway first, and a «paid» answer is recorded paid with no new charge. DEC-113 (2026-11-24) set how and when it
asks.

PR #160 built that: an inquiry's paid answer is recorded through the webhook's own branch, under the callback's provider
event id. PR #160's first review found that R-HONEST-1, FR-PAYG-3 and the ERD column still say «only the signed
webhook». DEC-110 and DEC-113 do not list them among what they amend. The constitution's amendment procedure
(`.specify/memory/constitution.md`, Governance) needs an ADR when an amendment weakens a prohibition, recording what
replaces the protection. This is that record.

**Worked example.** Month 2 of a programme, 1,000 EGP, is charged on Thursday at 18:31. The callback never arrives. At
19:45 the inquiry answers «paid». The order is recorded paid, month 2's sessions are generated, and the teacher's 700 EGP
share counts toward the releases. When the callback arrives later, it is a replay.

## Decision

### D1 — A second confirmation source, for automatic charges only

A payment is confirmed by the gateway's signed webhook, **or**, for an automatic charge only, by the gateway's
authenticated answer to the platform's own inquiry about that charge (DEC-110, DEC-113). Every other order, manual
checkouts included, is confirmed by the signed callback alone, as before. A client redirect, a return URL, an
app-reported status, a manual toggle, an administrator's override or an upload never confirms a payment.

### D2 — What replaces the signature

The answer is taken as a confirmation only when all of these hold:

- **The platform asks.** The answer is to the platform's own request, sent by the order's own gateway id (the
  `intention_order_id` written right after the intention step). It is never matched by the merchant reference the
  platform sends, which is never trusted (DEC-113 (2)).
- **The channel is authenticated.** The request goes over TLS to the gateway's host, with an auth token made from the
  gateway's API key (`PAYMENT_GATEWAY_API_KEY`) for that inquiry. Without the key the live inquiry is off.
- **Only a final state is read.** A transaction still pending, voided or refunded is not «paid». An authorisation alone
  (`is_auth` without a capture) is ignored. Anything else, unreadable or unknown, is «no answer», and no answer means no
  new charge (DEC-110 (4)).
- **It is the order's own transaction.** It is on one of the adapter's own integrations, and its amount and currency
  are checked against the order.
- **It is recorded as an event.** The row goes in through the webhook's branch, under the callback's provider event id,
  so the signed callback that follows is a replay and nothing is recorded twice (R-MONEY-8). The row's
  `signature_verified_at` is the answer's instant. Whether the row should be told apart from a signed one (a column or
  an event-id suffix) is a follow-up for the owner, not decided here.

### D3 — The open check, and the fallback

The gateway's own written answers are pending: Paymob question 11 in `ejazah-tools\paymob-questions-additions.md`, and
the closed-test checklist under T014.

- Is the inquiry's `success: true` / `pending: false` as final as the signed callback?
- Can a transaction it reports paid be voided, refunded or charged back with no signed callback following?

If the answer is not reassuring, the inquiry stops recording «paid». An inquiry that finds a paid transaction then opens
the `charge_unknown` item, and the order waits for the signed callback. This changes DEC-110 (2) and needs the owner's
word. Recording a failure or «no transaction» from the inquiry is not affected.

## Consequences

- The constitution's R-HONEST-1 and its «five rules» paragraph name the second source. The amendment is MINOR and takes
  2.7.0 at the integration's version pass (`tracks-coordination.md` §3; the owner, 2026-11-24, «Yes, keep 2.6.2»); the
  version line stays 2.6.2 until then.
- SRS FR-PAYG-3 and the ERD's `signature_verified_at` carry the same sentence.
- The CI test that holds R-HONEST-1 (one write path to `confirmed_at`) is unchanged. The inquiry moves a payment to
  `paid` through the webhook's own branch and does not write `confirmed_at`; the confirm step does, as for every order.
- A month whose callback is lost is generated after an inquiry instead of waiting forever. The protection the signature
  gave (no outsider can make a payment «paid») is held by D2: only the platform asks, about its own order, over an
  authenticated channel.
