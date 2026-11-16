# ADR 0025 — The platform's commission, the teacher's share held to milestones, and the payment mode

**Status:** accepted · **Date:** 2026-11-17 · **Decided by:** the owner, 2026-11-05 (a commission, final), 2026-11-15 (the rate, who bears every cost, an administrator's setting, built on an assumption) and 2026-11-16/17 (the money rules, typed in track 2's review session, «موافق عالباقي»; the open points N1–N7, «التوصية بس تمام») · **Amends:** [ADR 0007](0007-direct-gateway-checkout.md) D1 (0% commission; no per-session deferred revenue share) and D5 (compensation executed outside the code path, as far as D3 and D4 below say); [ADR 0018](0018-package-tracks-make-up-sessions-and-student-suspension.md) (the recitation refund choice, D5 below); the SRS rows listed under «Documents amended» · **Replaces:** `specs/003-booking/tasks.md` T105 as first written (released session by session on the gateway's Sunday and Wednesday) and the monthly payout of 2026-11-15 · **Leaves:** ADR 0024's rules (its D4 is closed by SRS DEC-83); its instalments pay the commission of D1 (D6).

## Context

ADR 0007 D1 put the gross, less the gateway's fee, wholly on the teacher. The platform took 0% commission, computed no
share and held nothing.

On 2026-11-05 the owner decided the platform takes a commission (T104). The owner also asked that the teacher's share be
held, so that a student's money back is guaranteed (T105): with a plain split, the teacher withdraws a package's whole
share before its sessions end.

On 2026-11-15 the owner set the rate: «70 فالمية صافي للمعلم وال 30 فالمية بتتقسم بيننا وبين باي موب». The student
pays the listed price, and every cost comes from the platform's part. The rate is an administrator's setting.

On 2026-11-16/17 the owner replaced that day's monthly payout with release at milestones, and made several more
decisions:
- A missed session's remedy is a make-up only.
- How a teacher's dropout is refunded.
- A required payment mode.
- A one-week postponement (SRS DEC-86).

The gateway's answers on holding, releasing and the split per order are verbal (SRS OPEN-11). The owner decided to
build on them: «افترض ان الاسئلة دي نقدر».

## Decision

### D1 — The commission: the teacher's share, net, at a rate the administrator sets

- The student pays the listed price, nothing added.
- The teacher's share of each gateway order is the gross times the rate, **rounded up** to the piaster. The platform's
  part is the rest, and every cost comes out of it: the gateway's fee and its VAT, any instalment or subscription fee,
  and any tax on the commission.
- The rate is the teacher's share in whole percent: an administrator's setting (SRS §3.14, default 70, bounds 0–100),
  audit-logged, edited on the general settings page. It is read when an order is created and kept on the order with the
  share it gave, so a change reaches new orders only.
- Each order sends the share to the gateway as the split to the teacher's payout account (`split_amounts`). The share is
  computed in `packages/money` (R-MONEY-5) by `modules/payments` and recorded in `payments` (R-MONEY-6).
- The teacher sees the share beside the price: in the package editor and on each order. The Terms state the commission.

### D2 — The teacher's share is held at the gateway and released at milestones

There is no monthly payout. The gateway holds each order's teacher share until a milestone:
- **Recitation:** the package's whole share, when the package has ended, its last session's dispute window has passed
  and no case on it is open.
- **Ijazah:** 25% of the teacher's share of the programme's whole price (an administrator's setting, SRS §3.14),
  capped at what the gateway holds of the orders paid by then. It is released when half of the programme's sessions
  are delivered with no case open; sessions are counted, not calendar time, and a postponed or make-up session counts
  only once delivered. The rest is released at the programme's end, on the recitation condition.
- **The assessment fee's share:** released when its session's dispute window has passed with no case open.
- **A programme closed for non-renewal** (SRS FR-BOOK-18): the held share of the instalments paid, after the last
  delivered session's dispute window, with no case open.
- **A package closed on a complaint against the student** (SRS DEC-86): the share of the sessions delivered and of
  those the student missed up to the close (Student-No-Shows, consumed), after their dispute window, with no case open.
- **A recitation package closed on the teacher's dropout** (D4): the share of the sessions delivered, after the last
  delivered session's dispute window, with no case open («كان قيمة مقابل خدمة»). On the ijazah track a dropout
  releases nothing more (D4).

Execution:
- The app computes each release when it falls due and lists it for administrators: the teacher, the order or orders,
  the amount, and why it is due.
- An administrator executes it in the gateway's dashboard and marks it done; the mark is audit-logged and idempotent,
  records a fact and moves no money.
- The teacher sees each release due and done.
- The platform's code makes no release call. One may come if the gateway documents it, by a new ADR.

The platform holds nothing: the money stays at the gateway from the student's payment until a release. No wallet,
balance, escrow or ledger exists (R-MONEY-6).

### D3 — Every refund in the gateway's dashboard; a partial refund recorded with its amount

- Every refund is executed by an administrator in the gateway's dashboard. The platform records it from the gateway's
  signed event (FR-PAYG-7).
- Each event carries its amount. The order keeps its refunded total and becomes `refunded` only when that total reaches
  its gross.
- A failed refund or void is not the order's failure.

### D4 — What a closed enrollment refunds

- **The teacher's dropout, ijazah:** the student gets **all** the money back: every order's whole gross, the assessment
  fee included. It is made up of three parts:
  - the teacher's share the gateway still holds, refunded through the gateway;
  - the platform's own part (its commission), refunded through the gateway too;
  - the teacher's share already released, paid by the platform outside the code path («بندفع من جيبنا»).

  For example, of 10,000 paid: 5,250 held, 3,000 the platform's part and 1,750 released. «الكلام ده في مسار الاجازة
  فقط عشان كله مرتبط ببعضه وهو لازم يكون شيخ واحد المجيز».
- **The teacher's dropout, recitation:** the student gets back only the sessions not taken («بيرجعله الباقي فقط … كان قيمة
  مقابل خدمة»). The teacher's share of the sessions delivered is released to the teacher (D2).
- **A close on a complaint against the student** (DEC-86): the sessions after the close are refunded to the student.
  The sessions the student missed up to the close are consumed, and their share goes to the teacher (D2).
- The compensation case shows the amount its cause gives, computed in `packages/money` (a session's value: the order's
  gross ÷ its sessions, the last taking the remainder). The administrator decides the case and executes it (D3).

### D5 — A missed session's remedy is a make-up only

- In both tracks there is no money refund for a session.
- FR-MAKEUP-2's recitation refund choice is no longer offered. Existing data and the `refund` enum member are kept.
- A counter-proposal the teacher leaves unanswered books the system's proposal.
- A cleared, suspended student is owed a make-up only.

### D6 — The programme's orders (ADR 0024)

- D1 applies to every order of the programme: the assessment fee, the rest in full, and each instalment.
- A running programme keeps the rate and the 25% it started with (both fixed at its first order).

### D7 — The payment mode

- A required server setting, `PAYMENT_MODE`, is `test` or `live`, with no default. It is an environment value the owner
  sets; it replaces the refusals of the gateway and of its test keys outside development and test.
  - **`test`:** only the gateway's test keys, and every app shows a «نسخة تجريبية» banner.
  - **`live`:** only live keys, the split integration id, and a payee on every checkout. All three come from
    contracting.
- A mismatch refuses to start.
- Flipping to `live` during the closed test needs no code change: the owner sets the mode and the live values and
  restarts the server («تمام بس اهم حاجة نقدر نخليها حقيقية خلال فترة الاختبار»).
- Closed-test data is never carried to launch.
- The owner is reminded before launch, at the end of the closed test, to switch to `live`.

### D8 — Built on an assumption; what a «no» changes

The owner decided to build D1–D4 on the gateway's verbal answers (OPEN-11). Its written answers are asked at contracting:
1. A teacher's share is held and a set amount is released when the platform says, even months later.
2. A partial refund comes from the held share.
3. Both through the API.
4. The split is sent per order.

What a «no» changes:
- To (4): changes D1's transport only.
- To (1) or (2): supersedes D2–D4 by a new ADR. The fallback is custody, which needs counsel and an accountant and changes
  R-MONEY-6, SRS §7 and the ERD.
- To (3): keeps the dashboard steps of D2 and D3.

## Consequences

- `specs/003-booking/tasks.md` builds this in track 2:
  - T104, T101 and T109 in B-M1.
  - T102, T103, T105, T110 and T111 in B-M2.
  - T112 in B-M3, cut from `develop` after track 1's B48 merges.
  - T111's and T112's code is in `modules/sessions`, track 1's area, coordinated with it.
- `payments` gains the order's rate, the teacher's share, the refunded total and the release marks, with their
  migrations and ERD §7. The words the boundary lint refuses stay refused; the code speaks of a teacher's share and a
  release.
- `packages/config/eslint.boundaries.js`'s «net = gross − fee» stays forbidden: the share is computed from the gross.
- NFR-SCALE-2 («configuration and calculation changes only») is met.

## Documents amended

- `docs/SRS.md`: the amendment notes of 2026-11-16 and 2026-11-17; §2.2; §3.5.1; §3.6.0; FR-PAYG-1, FR-PAYG-7, FR-PAYG-9,
  FR-PAYG-10, FR-PAYG-11; FR-BOOK-13, FR-BOOK-16, FR-BOOK-18; FR-DISPUTE-5, FR-DISPUTE-6; FR-MAKEUP-2, FR-MAKEUP-3,
  FR-MAKEUP-5, FR-MAKEUP-6; FR-ADMIN-5; the new §3.8.6 (FR-POSTPONE-1 to FR-POSTPONE-6); §3.14; §7; §13; DEC-49; RISK-11;
  OPEN-11; OPEN-12; DEC-80 to DEC-87.
- [ADR 0024](0024-assessment-and-ijazah-programme-by-instalments.md): D4.
- `.specify/memory/constitution.md`: R-MONEY-6, R-MONEY-11.
- `docs/ERD.md`: §7.
- `PLAN.md`: open points 1 and 3, the owner's step on OPEN-12, and «After the MVP».
- `specs/003-booking/tasks.md`: T101–T105, T108–T112, and the batches.
