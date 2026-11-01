# Quickstart: Validating Phase 2

**Feature**: `specs/003-booking/` · **Date**: 2026-10-31

How to prove Phase 2 works: **a student buys a package on the phone and the gateway's signed event alone confirms
it**, and **the machines refuse what they refuse** — a leak across genders, a forged event, a second hold, a
confirmation from anywhere but the job. Each section names the success criteria of [spec.md](./spec.md) it proves.
The device run is the owner's, on the Android phone (as Phase 1 was proved on one device).

---

## Prerequisites

- Phase 1's quickstart prerequisites, on `develop` after this phase's batches merge.
- Tests and probes run on the integrity database only (`ijazah_integrity`, both URLs checked), never on `ijazah`, until
  T124 lands. The database is migrated and seeded fresh, not reset (the owner's decision of 2026-10-29, B19d).
- A spec that writes to a database runs only with `IJAZAH_DB_SPECS=1` set beside the two `ijazah_integrity` URLs in the
  environment (T124, the owner's decision of 2026-11-01): the specs never read the URLs from `.env`, and a missing URL
  refuses the run, naming it. Without the variable, 47 files and the database describes of four `tests/dev` files
  report skipped and nothing connects.
- `PAYMENT_GATEWAY=fake` and `API_PUBLIC_ORIGIN` reachable from the phone on the LAN, so the stand-in's hosted page opens
  in the phone's browser sheet. No gateway credential (SC-302).
- A development build of the app with `expo-web-browser` installed (`docs/RUNBOOK.md`, the mobile section).

---

## 1. The machines first (SC-304, SC-305, SC-306, SC-307, SC-308, SC-311, SC-313, SC-314)

```text
pnpm typecheck && pnpm lint                       # R-GENDER-5 on identity's visible-teacher repository; R-MONEY-5/6; R-TIME-1
pnpm test                                         # unit, contract, the double-run specs of the four jobs
pnpm test:db-integrity                            # rules 36–39, the hold races, the generation constraints, the fold
pnpm test:adversarial                             # the procedure harness, both directions, T143's standing cases
pnpm contract:snapshot --check --base origin/develop
pnpm check:authz && pnpm check:i18n
```

Expected:

- The adversarial suite covers every Phase 2 student procedure and fails if any one leaks (SC-304); the inverted
  subjects still bite.
- The confirmation-path test finds exactly one writer of `confirmed_at` (SC-307).
- The stand-in harness's forged events are refused with nothing written; a doubled paid event, events in reverse order
  and a paid event after its hold expired leave the outcomes FR-373 states (SC-311); 100 replays leave one
  confirmation (SC-305).
- Two hundred concurrent holds on one slot leave one; on one student's two slots, one (SC-306).
- Every confirmation, failure, expiry and refusal in the suite has its `enrollment_events` row (SC-313).
- The name search returns every visible spelling variant and no excluded teacher (SC-314).

## 2. Time across Cairo's changes (SC-303)

```text
pnpm --filter @ijazah/time test                   # the properties over every listed zone; Cairo 2026/2027 examples
```

Then, with the stand-in: a teacher in `Africa/Cairo` with a Thursday 23:30 slot of 60 minutes and an 8-session package
bought on a date whose sessions straddle the spring change. Every session's local date is a Thursday, its local start
23:30, and its instant the one `packages/time` resolves; the one in the gap's week (if any) is `shifted_forward` and
keeps 23:30 as requested.

## 3. The teacher's side (US1)

On the phone, as an approved teacher whose payout is **not** verified:

1. Write the profile (bio, qualification); the display name from the account tab (T158).
2. Create a recitation package and an ijazah-track package (lengths 30, 45, 60 offered; a price of 0 refused); see
   «غير منشورة» and the banner to payout setup.
3. Add Sunday 23:30 for 60 minutes; adding Monday 00:00 is refused as overlapping (FR-317).
4. As a same-gender student, the teacher is absent from Discovery. Verify the payout with the harness
   (`recipientVerified`) and see the teacher appear with no action by the teacher.

## 4. The purchase, end to end on the phone (SC-301 against the stand-in, SC-309, SC-312)

1. As a student, open Discovery: the tabs' counts, the card's nearest slot and lowest price per session. Search the
   teacher by a spelling variant of the name.
2. Open the profile (no chain shown), pick a package, pick a slot; see the first and last session dates.
3. «متابعة إلى الدفع»: the hold and its countdown. Pay: the stand-in's page opens; press «ادفع».
4. Processing reads the server; the success screen shows the receipt and the sessions. If the first session moved
   (a late confirmation), it says so.
5. Repeat with «فشل الدفع»: PaymentFailed, Retry on the same hold, then pay.
6. Repeat and wait past the hold's expiry: CheckoutExpired; the enrollment is cancelled `payment_expired`.
7. Start a checkout, leave it, start another on a different slot: FR-BOOK-12's branches (with the harness's
   `onCancel` in a second run for `in_progress`).
8. Kill the app on Processing, reopen: the Confirming badge, cleared within 30 s of confirmation or on return to the
   app; with no confirmation for 10 minutes, FR-384's message (SC-312).
9. «اشتراكاتي» and the home show the sessions in both zones; «طلابي» on the teacher's phone finds the student by a
   spelling variant of the name.

If the gateway's written answers arrived before the last batch, steps 3 to 5 are repeated on the gateway's sandbox
(SC-301); otherwise that run is FR-371's numbered task.

## 5. The admin's monitor (US5)

In the panel, `/payments`: every order of §4 with its amounts as the stand-in reported them, its status, its timeline;
the paid order cancelled `slot_unavailable` (produced in §1's suite data, or by delivering a paid event after the slot
was re-held) shows its link state; no control writes. The audit log shows a `payments.viewed` entry per order opened.

## 6. The register and the close

Each batch records its run in its tasks' notes; the phase closes with a run of §1 to §5 on the last batch's commit, the
first-batch follow-ups checked (FR-301), and PLAN.md's Phase 2 section updated with the close date.
