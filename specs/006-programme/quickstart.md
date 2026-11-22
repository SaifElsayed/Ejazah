# Quickstart: validating the programme

Run on `ijazah_integrity_b` only (`. ejazah-tools/test-env-b.sh`), with `PAYMENT_GATEWAY=fake`, `PAYMENT_MODE=test`,
`programme_enabled` on and `assessment_price_piasters` set (e.g. 50,000 = 500 EGP). Contracts:
[app-surface.md](contracts/app-surface.md), [admin-surface.md](contracts/admin-surface.md),
[jobs.md](contracts/jobs.md), [gateway.md](contracts/gateway.md).

## 1. The machines

- `pnpm typecheck`, `tsc -p apps/admin`, `pnpm contract:snapshot --check`.
- The changed modules' specs, `advance-programmes`'s double-run spec, `pnpm test:adversarial` (every new procedure
  registered).

## 2. The programme, end to end (prices 250 / 320 / 400 for 30 / 45 / 60 min; fee 500)

1. **The switch and the package.**
   - With `programme_enabled` off: an ijazah-track package is created and sold as today.
   - Turn it on: the old ijazah packages are deactivated (one audit entry, one log line).
   - With the fee at 0, publishing a programme package is refused `assessment_fee_unset`.
   - Set 500 and publish with the three prices: discovery shows «500» and «250 – 400».
2. **The assessment.** Book it on a 60-min Monday 18:00 time and pay. Expect:
   - one `assessment` order of 500 (share 350 at 70 %);
   - session 1, Monday 18:00–18:30;
   - the programme `awaiting_offer`;
   - the weekly time no longer offered.
3. **The offer.**
   - Before session 1 is `done`: refused `assessment_not_delivered`.
   - After it: offer 40 sessions of 45 min. Total 12,800 (40 × 320), 10 months, snapshot count 41, `payBy` = the offer + 48 h (the offer itself within
     24 h of session 1's delivered end; with no offer by then, a `no_offer` administrator item, never a lapse).
   - FR-706b, by its specs where the payment mode cannot be set live: `payBy` passed unpaid with the teacher's payout
     account unverified in live mode → a `pay_blocked` item, no lapse; extend, then pay.
   - An offer of 75 min is refused `length_exceeds_slot`.
4. **Month 1, monthly with `saveCard`.** Expect:
   - one `instalment` order, month 1, 1,280;
   - sessions 2–5 (`programme_month` 1) from the first Monday after `payBy`;
   - the card saved (last4 only, the student only).
5. **Month 2, charged automatically.** Run the clock past month 1's last session: `advance-programmes` records an
   automatic order `created` and then charges it. On paid, sessions 6–9 exist.
6. **Month 3, a soft decline.**
   - The student gets the `payment_failed` push.
   - Retries fall on days 1, 3, 5, 7.
   - `programme.renew` is refused `charge_pending` while a retry order is `created`. Once it fails, the student pays by
     hand, and the next retry finds the month paid and does nothing.
7. **Month 4, a hard decline.**
   - No retry.
   - Let the next Monday 18:00 pass: `paused`, «late since» on both sides, no session for month 4.
   - A stop request on day 3 is refused `too_early`; on day 8 it is accepted.
8. **A late renewal.** Renew month 4 by hand. Expect:
   - the stop request `withdrawn` (one log line);
   - month 4's sessions from the next Monday, numbered from max + 1, with `programme_month` 4.
9. **Completion gate.** Before the late renewal in step 8 (month 3 settled, month 4 unpaid, 72 h past), the
   enrollment is NOT completed.
10. **Releases (DEC-94; dispute window 72 h).**
    - No `assessment` release on this continued programme.
    - Once session 21 of 41 is delivered (the assessment + 20), the half: 25 % × 70 % × (12,800 + 500) = 2,327.50,
      capped at the paid orders' shares.
    - The rest at the end.
11. **A programme that does not continue.** The student cancels after the offer. Expect:
    - `offer_declined`;
    - the weekly time free at once;
    - the `assessment` release of 350 once `payBy` and session 1's 72 h have passed.
12. **A stop.** A programme paused 8 days with a stop request approved. Expect:
    - `programme_stopped`;
    - the slot free;
    - the card row gone;
    - the paid share − releases listed after the last delivered session's 72 h.
    - Reopen: `paused`, with `paused_at` = now.
    - Restore on it is refused `programme_enrollment`.
13. **A ban of the teacher on a programme.** The case shows every order's gross, the assessment included (DEC-85). A
    complaint close values each untaken session by its own order (1,280 ÷ 4 = 320 for a month's session).
14. **The automatic renewal off.** On a programme with a saved card, `programme.autoRenewOff`. Expect: the card row
    gone; at the next month's end no automatic order; «renew now» from 3 days before (FR-713a, DEC-95).

## 3. The phone and the panel (after the design week)

- **Student:**
  - the range and the fee;
  - the assessment's booking with each time's length;
  - the offer with its 48 h deadline;
  - pay in full or monthly, with the consent line;
  - months paid and next due;
  - «renew now» (3 days before, no card), «pay now» and «change card» after a failure;
  - turn the automatic renewal off: the card gone, the next month by hand; while a charge is under way, the line saying so;
  - paused;
  - «the teacher is unavailable».
- **Teacher:**
  - the three prices with the average per length;
  - the offer;
  - «late since»;
  - the stop and refusal requests.
- **Panel:**
  - the queue (paused, stop, refusal, no offer, pay blocked) oldest first;
  - decide, extend, reopen;
  - the monitor's kinds;
  - the eight settings, the switch's label explaining it.
- SC-703 and SC-706 timed by hand.
