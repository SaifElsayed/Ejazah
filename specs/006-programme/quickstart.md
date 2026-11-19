# Quickstart: validating the programme

Run on `ijazah_integrity_b` only (`. ejazah-tools/test-env-b.sh`), with `PAYMENT_GATEWAY=fake`, `PAYMENT_MODE=test`
and `assessment_fee_piasters` set (e.g. 50,000 = 500 EGP). Contracts: [app-surface.md](contracts/app-surface.md),
[admin-surface.md](contracts/admin-surface.md), [jobs.md](contracts/jobs.md), [gateway.md](contracts/gateway.md).

## 1. The machines

- `pnpm typecheck`, `tsc -p apps/admin`, `pnpm contract:snapshot --check`.
- The changed modules' specs, `advance-programmes`'s double-run spec, `pnpm test:adversarial`.

## 2. The programme, end to end (the worked example: prices 250 / 320 / 400 for 30 / 45 / 60 min)

1. With the fee at 0, publish an ijazah-track package: refused `assessment_fee_unset`. Set 500; publish with the three
   prices. Discovery shows «500» and «250 – 400».
2. Book the assessment on a 60-min Monday 18:00 time; pay. Expect:
   - one `assessment` order of 500 with a 350 share at 70 %;
   - session 0 Monday 18:00–18:30;
   - the programme `awaiting_offer`;
   - the weekly time no longer offered.
3. Offer 40 sessions of 45 min. Total 12,800 (40 × 320); 10 months; `payBy` = session 0's end + 48 h. An offer of
   75 min is refused `length_exceeds_slot`.
4. Pay monthly with `saveCard`. Expect:
   - one `instalment` order, month 1, 1,280;
   - sessions 1–4 from the first Monday after `payBy`;
   - the card saved (last4 only on `programme.get`).
5. Run the clock past session 4's end: `advance-programmes` charges month 2 automatically. On paid, sessions 5–8 exist.
6. Month 3: answer a soft decline.
   - The student's `payment_failed` push.
   - Retries on days 1, 3, 5, 7.
   - Before the first retry, `programme.renew` pays by hand; the retry finds the month paid and does nothing.
7. Month 4: answer a hard decline. No retry. Let the next Monday 18:00 pass: the programme is `paused`, «late since» on
   both sides, no session 13. A stop request on day 3 is refused `too_early`; on day 8 it is accepted.
8. Renew month 4 by hand. Expect:
   - the stop request `withdrawn`, with one log line;
   - sessions 13–16 from the next Monday, the final session moved by the pause's weeks.
9. Releases (72 h dispute window):
   - the assessment's 350 after session 0's 72 h;
   - at session 20 delivered, the half: 25 % × 70 % × 12,800 = 2,240, capped at the held months' shares;
   - the rest at the end.
10. A second programme paused 8 days with a stop request approved:
    - the enrollment `cancelled` `programme_stopped`;
    - the slot free at once;
    - the card row gone;
    - the held months' share listed after the last delivered session's 72 h.
11. A teacher's dropout on a third programme: the case shows every order's gross, the assessment included (DEC-85).

## 3. The phone and the panel (after the design week)

- Student: the range and the fee; the assessment's booking; the offer; pay in full or monthly with consent; months,
  next due, «renew now» (3 days before), «pay now» / «change card» after a failure; paused.
- Teacher: the three prices with the average per length; the offer; «late since»; the stop and refusal requests.
- Panel: the queue (paused, stop, refusal) oldest first; decide; reopen; the monitor's kinds; the six settings.
