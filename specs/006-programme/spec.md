# Feature Specification: The ijazah programme — the assessment and prepaid monthly instalments

**Feature Branch**: `Ejazah_app/003-booking/T108` (the cycle, `specs/003-booking/tasks.md` T108); the programme's batches then run as `Ejazah_app/006-programme/<task ids>`

**Created**: 2026-11-19

**Status**: Clarified (2026-11-19)

**Input**: User description: "The programme of ADR 0024 as amended by DEC-83 and DEC-92: the assessment and the ijazah-track programme paid by prepaid monthly instalments (SRS §3.5.1 FR-BOOK-13..19, FR-PAYG-19 as amended, §3.14 programme rows, DEC-63, DEC-80, DEC-81, DEC-83, DEC-85, DEC-86, DEC-90, DEC-92; ADR 0024; ADR 0025 D2, D6). specs/003-booking/tasks.md T108."

## Overview

**Objective, from SRS §3.5.1 and DEC-92.** Let a student join a teacher's ijazah track through a paid assessment,
receive one offer sized to them, and pay for it in full or month by month in advance, so that no session is ever held
unpaid and nothing closes by force.

Today a student buys a package from the catalogue in one order and all of its sessions are generated at once (Phase 2).
On the ijazah track that changes:
- The student first books and pays an **assessment session**; its fee is never refunded, except on a teacher's dropout
  (DEC-85).
- After it, the teacher sets the student's level, readiness, the programme's expected length and the number of
  sessions, and sends **one offer with one total price**.
- The student has **48 hours** to cancel or to pay: either the rest in full, or the **first month**, which saves their
  card.
- Each later month falls due **right after the paid month's last session**. A saved card is charged then,
  automatically. A student without one (a wallet, another method) renews by hand, and may do so from **3 days** before.
- A failed charge is shown to the student with «pay now» and «change card». It is retried on a soft decline only, at
  most **4 times** (1, 3, 5 and 7 days after the failure), and never on a hard decline.
- A month still unpaid at its **first session** pauses the package. Its sessions do not open, the slots stay reserved,
  the teacher sees «late since», and after **7 days** the teacher may ask an administrator to stop it. A late renewal
  pays the full month, and the sessions missed in the pause are added at the end.
- The money follows Phase 2's and track 2's rules unchanged. Each payment is an ordinary gateway order carrying the
  split. The teacher's share is **70 %** of each order, held at the gateway. Releases:
  - the assessment's share on its own only when the student does not continue, after the 48 hours and its
    **72-hour** dispute window; when the student continues, the assessment is the package's first session;
  - **25 %** of the teacher's share of everything paid, the assessment included, at half the sessions delivered (the
    assessment counted);
  - the rest at the end, or at a close as DEC-81 lists.

**Scope boundary.** The programme is the **ijazah track's** (DEC-92): every ijazah-track package starts with the
assessment. A recitation package is bought exactly as today.
- This specification delivers:
  - the assessment (FR-BOOK-13);
  - the offer (FR-BOOK-14);
  - the 48 hours (FR-BOOK-15);
  - in full or monthly, prepaid (FR-BOOK-16 as amended by DEC-92);
  - the pause (FR-BOOK-17 as amended);
  - the stop request (FR-BOOK-18);
  - the reminders and the administrators' view (FR-BOOK-19 as amended);
  - the order's kind (FR-PAYG-19 as amended; `003 spec.md` FR-312 and FR-375 as amended);
  - the releases and refunds of the programme's orders (DEC-81, DEC-85; ADR 0025 D2, D4, D6).
- It moves no money in code. Every refund and every release is executed by an administrator in the gateway's dashboard
  (DEC-82, DEC-81). The automatic charge is the one payment the platform starts. It is the student's own monthly
  payment, made with their consent, as an ordinary order.

**When** (DEC-92, Q-1): this cycle on 2026-11-19. The server code beside the design week (11/21–11/25). The screens
after it, on the new design. Everything merged by 2026-12-04, or it moves to v1.1; until then an ijazah package is sold
as today (one order, 25 % at half; `003 tasks.md` T105's B-M2 note).

**Given, not re-specified.**
- Phase 2: the catalogue, the package editor, holds, checkout, the signed webhook and the confirm-enrollment step
  (FR-PAYG-19).
- Track 2:
  - the commission and the share kept on each order (T104, DEC-80);
  - the payee split per order (T101);
  - partial refunds (T102, DEC-82);
  - the release list, «مستحقاتي» and «تحويلات المعلمين» with the mark and its undo (T105, DEC-81, DEC-89);
  - what a closed enrollment refunds (T110, DEC-85, DEC-86, DEC-91);
  - make-up only (T111, DEC-84);
  - the postponement (T112, DEC-86, DEC-90);
  - the payment mode (T109, DEC-87).
- Phase 3: sessions, attendance, compensation cases, the live channel.
- Phase 4: push for DEC-70's kinds, among them the payment's result.

**Provenance.** Every requirement traces to SRS §3.5.1, FR-PAYG-19, §3.14, DEC-63, DEC-80 to DEC-92, ADR 0024 as
amended, ADR 0025, the owner's words (`ejazah-tools\track2\owner-words.md`), or B-M4's conflict check. Requirements come
from the SRS, never from the design boards.

**Numbering.** Phase 4's requirements run to FR-631 and its criteria to SC-609. This specification numbers from FR-701
and SC-701.

## Clarifications

### Session 2026-11-19

The owner's answers, relayed by the review session and recorded as SRS DEC-93. The worked example throughout is
40 sessions at 250 EGP = 10,000 EGP, with the assessment fee written F.

- Q: What does an ijazah-track package publish before the offer, and who sets the assessment fee? → A: The owner's own
  model: «سعر الاختبار ثابت ملهوش علاقة بالمعلم احنا اللي بنحدده وسعر ال 45 و ال 60 والنص ساعة هو اللي بيحدده … بتبقى في
  الرينج ده».
  - The assessment fee is one platform-wide amount, an Administrator's §3.14 setting; the teacher does not set it.
  - The teacher's ijazah-track package sets a price per session for each of 30, 45 and 60 minutes.
  - Before booking, the student sees the teacher's per-session range (e.g. «250 – 400 للحصة»).
  - The offer picks the length and the count (FR-BOOK-14 as written; on who picks the length: «خليها زي ما هي»), and the
    total is the count × that length's price, so it is always inside the range.
  - DEC-88's average stays per length, beside each of the three prices (FR-701, FR-704, FR-705).
- Q: Is the assessment fee deducted when paying in full or by months? → A: (a) Deducted when paying in full
  (F + (10,000 − F) = 10,000), not when paying by months (F + 10 × 1,000 = 10,000 + F). «Costs a little more» is the
  fee (FR-711).
- Q: What is «a month»? → A: (a) 4 consecutive sessions of the weekly time, a fixed amount (4 × 250 = 1,000); the last
  month takes the remainder (42 sessions = 10 × 1,000 + a last month of 2 sessions, 500) (FR-711).
- Q: What is the base of the 25 % released at half? → A: (a) The offer's total, the assessment excluded:
  25 % × 70 % × 10,000 = 1,750, the same in full or by months, capped at what is held. The assessment's share is
  released on its own after its 72 hours (FR-728). *(Superseded by the owner's re-answer below, DEC-94.)*
- Q: An Administrator approves a teacher's refusal after the assessment: the fee? → A: (a) Kept: the assessment was
  delivered (FR-BOOK-13), and its teacher share (70 % of F) is released after its 72 hours (FR-709).
- Assumption approved (A-1): the assessment session's own length is an Administrator's §3.14 setting beside the fee,
  default 30 minutes, the shortest weekly time a teacher can publish, so it fits any of them (FR-701).
- Assumption approved (A-2 (a)): the offer may pick only a length that fits inside the reserved weekly time (60 → 30, 45
  or 60; 45 → 30 or 45; 30 → 30), each session from the time's start; the reservation, the overlap refusals and the
  release stay as built (FR-705).
- Q (the owner's re-answer, recorded as SRS DEC-94; it replaces the Q-C4 answer above and the 11/17 rule N3 (a)): when
  is the teacher paid for the assessment? → A: «المعلم مبياخدش فلوس جلسة الاختبار الا في حالة واحدة لو العرض اترفض من
  الطالب ومكملش … انما لو هيكمل ودفع هو بالنسباله كانها من ضمن الباقة … وحساب النص بيتحسب من ضمنه حصة الاختبار», and
  «Approve» on the reading and on the refusal case.
  - **The student does not continue** (declines, does not pay within the 48 hours, or an Administrator approves the
    teacher's refusal): the assessment's order is released as any order, 350 of a 500 fee, once the 48 hours have
    ended and its 72 hours have passed with no case open. The fee is never refunded.
  - **The student continues:** the assessment is the package's first session. Its share is held with the package,
    the half counts it (40 + 1 = 41, so the half falls at 21), and the 25 % is taken on the share of everything paid
    (1,750 in full, 1,837.50 by months), capped at what is held (FR-703, FR-709, FR-728).
- Q (2026-11-19, the owner's answers, «Approve all», DEC-94): when do the 48 hours start, and how long does the teacher
  have to send the offer? → A:
  - The 48 hours start when the offer is sent («ال 48 ساعة دي بتبدأ من وقت عرض الباقة»); the first regular session is
    the first weekly occurrence after them (FR-706, FR-707).
  - The teacher sends the offer within 24 hours of the delivered assessment, an Administrator setting. With none by
    then, it becomes an Administrator item and never lapses on its own (FR-706a).
  - The fee is seeded 0 = unset; no programme package is published until an Administrator sets it (FR-704).
  - The migration deactivates the existing ijazah-track packages (test data); their enrollments are untouched.
- Settled by the review session on recorded precedents (DEC-94):
  - A teacher's suspension, ban or departure ends the programme as today (FR-SESS-16): the remaining sessions are
    cancelled by an Administrator, the case of FR-DISPUTE-5 opens with DEC-85's full refund, the automatic charges
    stop at once and the token is deleted; a restore after a suspension on a programme is deferred (FR-729).
  - The switch `programme_enabled`, off by default, turned on when the programme's screens land, keeps ijazah packages
    sold as today until then (DEC-92's 12/4 fallback).
  - The student's own weekly time is protected: a booking overlapping it is refused (FR-701).
  - FR-PROFILE-8 is amended for the programme (A-2 (a)'s consequence).
  - «4 sessions a month» is a definition.
- Not given by the owner, written as an assumption: the assessment fee's amount. The §3.14 row has no default; an
  ijazah-track package cannot be published until an Administrator sets it (FR-704).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A student books and pays an assessment (Priority: P1)

A student opens an ijazah-track teacher's profile, chooses the assessment at one of the teacher's weekly times, and pays
its fee through today's checkout. The weekly time is held, then reserved for the programme.

**Why this priority**: Every ijazah programme starts here (FR-BOOK-13); nothing else can be tested without it.

**Independent Test**: With a seeded ijazah-track package, book and pay the assessment; one paid order of kind
«assessment» exists; one session is generated; the weekly time is no longer offered to others.

**Acceptance Scenarios**:

1. **Given** an ijazah-track package and the assessment fee set by an Administrator, **When** the student pays it, **Then** one order of kind
   «assessment» is paid with its 70 % share kept, one assessment session exists at the chosen weekly time, and the
   time is reserved for this enrollment.
2. **Given** a recitation package, **When** the student buys it, **Then** nothing changes from today: one order, every
   session generated, no assessment.
3. **Given** a paid assessment and a student who does not continue, **When** the 48 hours have ended and the session's
   72 hours have passed with no case open, **Then** its share (70 % of the fee) is listed as a release due; **Given** a
   student who continues, **Then** no assessment release is listed: its share is held with the package (DEC-94).
4. **Given** a teacher's three prices (30: 250, 45: 320, 60: 400), **When** the student opens the profile, **Then** they
   see the assessment's fee and «250 – 400 للحصة» before booking.

---

### User Story 2 - The teacher makes one offer; the student pays within 48 hours (Priority: P1)

After the assessment, the teacher records the student's level, readiness and the programme's expected length, and
sends one offer: the number of sessions and one total price. The student has 48 hours to cancel or pay the rest in full
or the first month.

**Why this priority**: The offer is what the student buys (FR-BOOK-14, FR-BOOK-15).

**Independent Test**: Make an offer of 40 sessions; pay the first month within 48 hours; the first regular session is the
first weekly occurrence after the 48 hours; the month's 4 sessions exist; the card is saved.

**Acceptance Scenarios**:

1. **Given** a delivered assessment, **When** the teacher sends the offer, **Then** its count and length are frozen and
   the student sees one total price, a session's price derived from it.
2. **Given** an offer, **When** the student pays the rest in full within 48 hours, **Then** every regular session is
   generated from the first weekly occurrence after the 48 hours end, even when the student paid on the first day.
3. **Given** an offer, **When** the student pays the first month by card within 48 hours, **Then** that month's sessions
   are generated, the card is saved with the student's consent to the automatic charge, and later months are not.
4. **Given** an offer, **When** the student cancels or 48 hours pass unpaid, **Then** the reserved weekly time is offered
   to anyone again, and the assessment fee is kept (FR-BOOK-13).
5. **Given** an assessment, **When** the teacher does not want to continue with the student, **Then** they cannot
   refuse alone: they send an administrator a reason, and the administrator decides.

---

### User Story 3 - Each month is renewed in advance, automatically or by hand (Priority: P1)

When a paid month's last session ends, the next month falls due. A saved card is charged at once. A student without one
renews by hand, from 3 days before. A failed charge is shown with «pay now» and «change card» and retried on a soft
decline.

**Why this priority**: The owner's rule: no session is ever held unpaid («مفيش ميزة تبدا من غير دفع»).

**Independent Test**: On the payment stand-in, run three months: one charged automatically, one declined softly then
paid on the first retry, one declined hard and paid by hand; each month has exactly one paid order and its sessions.

**Acceptance Scenarios**:

1. **Given** a saved card, **When** the paid month's last session ends, **Then** one order of kind «instalment» for the
   next month is charged, and on its paid event that month's sessions open.
2. **Given** a soft decline (e.g. insufficient funds), **When** the charge fails, **Then** the student is told
   (`payment_failed` push and on screen) with «pay now» and «change card», and it is retried 1, 3, 5 and 7 days after
   the failure, at most 4 times, then only by hand.
3. **Given** a hard decline (a stolen card, a closed account), **When** the charge fails, **Then** it is never retried;
   the student pays by hand or changes the card.
4. **Given** a student without a saved card, **When** 3 days remain before the paid month's end, **Then** «renew now»
   appears; a card holder is charged automatically instead, and sees «pay now» only after a failed charge, never while
   an automatic charge is pending.
5. **Given** a manual payment and an automatic retry landing for the same month, **When** both are paid, **Then** the
   second opens a compensation case (FR-PAYG-19), and an administrator refunds it in the gateway's dashboard.

---

### User Story 4 - An unpaid month pauses the package; a teacher may ask to stop it (Priority: P1)

A month still unpaid when its first session starts pauses the package. Slots stay reserved, nothing closes by force, and
the student can renew at any time. After 7 days the teacher may ask an administrator to stop it.

**Why this priority**: FR-BOOK-17 and FR-BOOK-18; the only way a programme ends early without a complaint.

**Independent Test**: Leave month 3 unpaid past its first session; the session is not held or evaluated; on day 8 the
teacher's request is accepted; a renewal withdraws it; an approved request closes the package and frees its slots.

**Acceptance Scenarios**:

1. **Given** month n unpaid, **When** its first session's start arrives, **Then** the package is paused, the session is
   not opened and never evaluated as a no-show, the teacher sees «late since», and one log line records the pause.
2. **Given** a pause of fewer than 7 days, **When** the teacher asks to stop, **Then** it is refused; after 7 days, with a
   mandatory reason, one open request per package, it reaches the administrators.
3. **Given** a paused package, **When** the student renews late, **Then** they pay the full month, the sessions missed in
   the pause are added at the end at the same weekly time, the final session and the slot's release move with them, and
   an open stop request is withdrawn with one log line.
4. **Given** an approved stop request, **When** the package closes, **Then** all of its slots are free at once, the saved
   card is deleted, and the teacher's held share of the months paid is released after the last delivered session's
   72-hour window with no case open.

---

### User Story 5 - The programme's money is released and refunded by the existing rules (Priority: P1)

Every order of the programme carries the rate (70 %) and the 25 % the programme started with. The releases and the
compensation amounts follow DEC-81 and DEC-85.

**Why this priority**: Money rules are the owner's firmest (ADR 0025); a wrong release cannot be taken back in code.

**Independent Test**: For a 10,000 EGP offer at 250 a session, paid monthly with a 500 fee: no assessment release;
1,837.50 (25 % × 70 % × 10,500) once the assessment and 20 sessions are delivered (21 of 41), capped at what is held; the rest at the end; on a teacher's dropout the case shows
every order's whole gross.

**Acceptance Scenarios**:

1. **Given** a programme started at 70 % and 25 %, **When** an administrator later sets 65 % or 30 %, **Then** every later
   order of this programme still carries 70 % and 25 %.
2. **Given** half the sessions delivered with no case open, **When** the 72 hours after the session that reached half have
   passed, **Then** 25 % of the teacher's share of everything paid for the programme, the assessment included, is due,
   capped at what the gateway holds of the orders paid by then; the half counts the assessment (DEC-94).
3. **Given** a teacher's dropout on the programme, **When** the case opens, **Then** it shows all the money paid back,
   the assessment fee included (DEC-85); a teacher suspended, banned or gone opens this case too (DEC-92).
4. **Given** a close on a complaint against the student, or a ban, **When** the case opens, **Then** DEC-86's and
   DEC-91's amounts apply as for any package.

---

### User Story 6 - Administrators see and decide what waits on them (Priority: P2)

Administrators see paused packages and stop requests, oldest first, with how late the student is and the teacher's
reason, and decide each. They see a teacher's request to refuse a student after the assessment. They can reopen a closed
package.

**Why this priority**: FR-BOOK-19 and the owner's admin-control rule; no student flow depends on it.

**Independent Test**: Create two paused packages and a stop request; the list is ordered oldest first; approving closes,
declining keeps the pause; a reopen restores the package as paused, awaiting payment.

**Acceptance Scenarios**:

1. **Given** paused packages and stop requests, **When** an administrator opens the queue, **Then** they are oldest
   first, each with how late and the teacher's reason; each decision is audited.
2. **Given** a closed package, **When** an administrator reopens it, **Then** it is paused awaiting the student's payment
   by hand (the card was deleted at the close).

---

### Edge Cases

- A session of a paid month postponed (DEC-86, DEC-90) or made up (DEC-84) belongs to its original month: it is paid,
  wherever it lands, and needs no new payment.
- The paid month's last session, for the next month's due time, is the latest end among that month's sessions,
  make-ups and postponed sessions placed later included (research R-507).
- A teacher's no-show at the assessment: remedied by a make-up only (DEC-84); the fee is not refunded.
- A teacher suspended, banned or gone during a pause: the compensation case of FR-DISPUTE-5 opens (DEC-92); no return.
- A student who wants to continue after a close starts as a new student, with a new assessment (DEC-83).
- A refund recorded for an instalment: the order's refunded total moves as T102 records it; the share released stays.
- The card expires between months: the charge fails as a hard decline, and the student pays by hand or changes the card.
- The automatic charge is unavailable in an environment (the gateway's written answers pending): every month is renewed
  by hand there, under the same deadline.
- Two ijazah programmes of one student with two teachers: each has its own months, card consent and pauses.

## Requirements _(mandatory)_

### Functional Requirements

**The assessment**

- **FR-701**: Every ijazah-track package MUST start with an assessment session paid as its own gateway order of kind
  «assessment», through today's checkout and hold; a recitation package MUST be bought as today (DEC-92, FR-BOOK-13).
  The assessment MAY be booked on any of the teacher's weekly times at least as long as it (FR-PROFILE-8 as amended by
  DEC-94). A student's booking of another package MUST be refused on a weekly time overlapping their active
  programme's (DEC-94). While the setting `programme_enabled` is off, an ijazah-track package is sold as today
  (DEC-92's fallback).
- **FR-702**: The assessment's fee MUST NOT be refunded, except as part of an ijazah teacher's dropout (DEC-85); its
  order MUST carry the rate in force (70 % by default) and the 25 % in force, which become the programme's for every
  later order (ADR 0025 D6, Q6).
- **FR-703**: The assessment's teacher share MUST be listed as a release due on its own only when the student does not
  continue (the offer declined or unpaid within the 48 hours, or an approved refusal), once the 48 hours have ended and
  its session's dispute window (72 h) has passed with no case open. When the student continues, the assessment is the
  package's first session and its share is held with the package (DEC-94).
- **FR-704**: The assessment's fee MUST be one platform-wide amount and its session length one length, both §3.14
  settings an Administrator sets (the length 30 minutes by default; the fee with no default). An ijazah-track package
  MUST NOT be published while the fee is unset. The teacher's ijazah-track package MUST set a price per session for
  each of 30, 45 and 60 minutes; the catalogue MUST show the student the assessment's fee and the teacher's
  per-session range (lowest to highest of the three) before booking (DEC-93).
- **FR-704a**: The package editor's average price (DEC-88) MUST be shown per length on the ijazah track, beside each of
  the three prices, over the other teachers' ijazah-track prices for that length.

**The offer and the 48 hours**

- **FR-705**: After the assessment session is delivered, the teacher MUST be able to send one offer recording the
  student's level, readiness, the programme's expected length, the session length and the number of sessions; the
  total MUST be the count × the teacher's price for that length at the offer, so it lies inside the range. The length
  MUST fit inside the reserved weekly time (60 → 30, 45 or 60; 45 → 30 or 45; 30 → 30), each session starting at the
  time's start. The count, the length and the total are frozen from then on; a later change of the teacher's prices
  reaches later offers only (FR-BOOK-14, `003` FR-312 as amended, DEC-93).
- **FR-706**: The package's weekly time MUST stay reserved from the assessment until the student cancels, or until
  48 hours (§3.14) after the offer is sent pass with the rest unpaid («ال 48 ساعة دي بتبدأ من وقت عرض الباقة», DEC-94);
  then it is offered to anyone again, and the fee is kept (FR-BOOK-15, research R-505).
- **FR-706a**: The teacher MUST send the offer within 24 hours (§3.14) of the assessment session's end as delivered (a
  make-up of it moves them). With no offer by then, the programme MUST become an Administrator item, never lapse on its
  own, and the weekly time stays reserved; the Administrator decides a refusal (FR-709) or 24 more hours (DEC-94,
  I-2 (a)).
- **FR-707**: The first regular session MUST be the first weekly occurrence of the package's time after the 48 hours end,
  even when the student pays on the first day (FR-BOOK-15).
- **FR-708**: The student MUST be reminded on screen before the 48 hours end (rule 17; push for it is v1.1, DEC-70).
- **FR-709**: A teacher MUST NOT refuse a student on their own after the assessment; they MAY send an administrator a
  refusal request with a mandatory reason, and the administrator decides; an approved refusal ends the programme before
  any offer, freeing the time. The assessment fee is kept, and its teacher share is released once the 48 hours have
  ended and its 72 hours have passed (DEC-93, DEC-94).

**Paying: in full or monthly, prepaid**

- **FR-710**: The student MUST be able to pay the rest in full or by months, within the 48 hours (FR-BOOK-16,
  DEC-92). Each payment MUST be an ordinary gateway order carrying the payee split (T101) and the programme's rate
  (FR-702), of kind «rest in full» or «instalment» for a numbered month.
- **FR-711**: A month MUST be 4 consecutive sessions of the weekly time, its amount 4 × the offer's session price; the
  last month takes the remainder (the sessions and the amount left). Paying in full MUST cost the offer's total less
  the assessment fee; paying by months MUST cost the offer's total, the fee not deducted (DEC-93).
- **FR-712**: A month's sessions MUST open only when its order is paid (FR-BOOK-4 as amended).
- **FR-713**: Paying the first month by card MUST save the card for the automatic charge, with the student's explicit
  consent in words at that moment; a student MAY instead choose to renew by hand each month.

**Renewal**

- **FR-714**: Each later month MUST fall due right after the paid month's last session ends; with a saved card the
  platform MUST charge it then, as an ordinary order for that month (DEC-92).
- **FR-715**: A student without a saved card MUST be able to renew by hand from §3.14's early-renewal days
  (3 by default) before the paid month's end; «renew now» MUST NOT be offered while an automatic charge for that month is
  pending (DEC-92).
- **FR-716**: A failed automatic charge MUST be shown to the student with a push of DEC-70's payment result
  (`payment_failed`) and on screen, with «pay now» (any method today's checkout offers) and «change card» (paying by hand
  with a new card, which then replaces the saved one).
- **FR-717**: A failed charge MUST be retried only on a soft decline, at most 4 times, 1, 3, 5 and 7 days after the
  failure (§3.14), then only by hand; a hard decline MUST never be retried (DEC-92).
- **FR-718**: At most one paid order MUST cover a month. A second paid order for a month already paid MUST be treated as
  FR-PAYG-19's unexpected payment: recorded, the enrollment unchanged, a compensation case opened (`003` FR-375 as
  amended).
- **FR-719**: The saved card's token MUST be stored encrypted, never logged, never sent to the app, and deleted at a
  close, at the programme's end and at the account's deletion (DEC-92).
- **FR-720**: The automatic charge MUST run on the payment stand-in until the gateway's written answers are in (OPEN-11:
  the saved-card integration, the split on such a charge, the token's issue and its signed callback, retry fees and
  decline codes); every month MUST be renewable by hand in any environment.

**The pause and the stop request**

- **FR-721**: A month unpaid when its first session's start arrives MUST pause the package: its sessions do not open and
  never reach the attendance evaluation as no-shows; the slots stay reserved; nothing closes it by force; one log line of
  ids and a reason records the pause (FR-BOOK-17 as amended, FR-BOOK-19).
- **FR-722**: A late renewal MUST pay the full month; the sessions that fell inside the pause MUST be added at the end of
  the package at the same weekly time, moving the final session and the slot's release (FR-BOOK-17, FR-BOOK-10).
- **FR-723**: For 7 days (§3.14) after a pause begins the teacher MUST NOT be able to ask
  to stop; after them the teacher MAY raise one open request per package, with a mandatory reason (FR-BOOK-18).
- **FR-724**: A renewal while a stop request is open MUST withdraw it automatically, with one log line administrators
  can see; the teacher MAY raise a new one if the student is late again (FR-BOOK-18).
- **FR-725**: An administrator's approval MUST close the package and free all of its slots at once; the saved card is
  deleted; there is no return (DEC-83). The held share of the months paid is released after the last delivered
  session's dispute window with no case open (DEC-81).

**The teacher's and the administrators' screens**

- **FR-726**: The teacher MUST see, per programme, the months paid, the next month due, and when paused that the student
  is late and since when (FR-BOOK-19). The student MUST see the same and the next due date, and, where the teacher is
  suspended, banned or gone, that the teacher is unavailable (FR-BOOK-19).
- **FR-727**: Administrators MUST see paused packages, stop requests and refusal requests oldest first, with how late
  the student is and the teacher's reason, MUST decide each (audited), and MUST be able to reopen a closed package, which
  returns paused, awaiting a payment by hand (FR-BOOK-19).

**Money**

- **FR-728**: The 25 % release MUST be 25 % of the teacher's share of everything paid for the programme, the
  assessment included (1,750 on a 10,000 offer paid in full; 1,837.50 by months with a 500 fee; at 70 %), capped at
  what the gateway holds of the orders paid by then, at half the programme's sessions delivered with no case open,
  the assessment counted as its first session (41 sessions: the half at 21), counted by sessions (a postponed or
  make-up session counted once delivered); the rest at the end (DEC-81, N2, DEC-94).
- **FR-729**: A teacher's dropout on the programme, including a teacher suspended, banned or gone, MUST open the
  compensation case of FR-DISPUTE-5, showing every order's whole gross, the assessment included (DEC-85, DEC-92). The
  programme ends as any enrollment does today (FR-SESS-16); its automatic charges stop at once and its saved card is
  deleted (DEC-94).
- **FR-730**: A close on a complaint against the student, a ban or a confirmed fault MUST follow DEC-86 and DEC-91 as
  for any package.
- **FR-731**: Code MUST NOT refund or release money; the automatic charge is the only payment the platform starts,
  and it is the student's own consented monthly payment (FR-PAYG-10, R-MONEY-6).

**Settings and proofs**

- **FR-732**: Every number above MUST be a §3.14 setting read from `settings` (R-MONEY-12): the switch, the assessment's fee
  and length (30 min), the offer's 24 h, 48 h, 7 days, 3 days, the 4 retries and their days.
- **FR-733**: Every refusal MUST write nothing and log one line of ids and a reason; every automatic action (charge,
  retry, pause, withdrawal) MUST log one line of ids and a reason; no line carries a card detail.
- **FR-734**: No user MUST be able to read or act on another's programme, offer, months or card, in both gender
  directions (R-GENDER).

### Key Entities _(include if feature involves data)_

- **Ijazah-track prices**: a teacher's price per session for 30, 45 and 60 minutes on their ijazah-track package.
- **Programme**: the ijazah enrollment with its offer (level, readiness, expected length, count, length, total price,
  sent and frozen times), its rate and 25 % fixed at the assessment, its state (awaiting offer, offered, active, paused,
  closed), and when paused, since when.
- **Order kind**: on each gateway order, «assessment», «rest in full» or «instalment», and for an instalment its month.
- **Month**: a numbered month of a programme, its sessions and amount, due when the previous paid month's last session
  ends, paid by one order.
- **Saved card**: a programme's (or student's) card token, encrypted, with the consent's time; deleted at a close, the
  end, or the account's deletion.
- **Charge attempt**: an automatic charge or retry for a month, its result (paid, soft decline, hard decline) and time.
- **Stop request**: package, teacher, reason, raised, decided (administrator, time, approved or declined), or withdrawn
  by a renewal.
- **Refusal request**: after the assessment, teacher, reason, decision.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-701**: In 100 % of runs on the stand-in, no regular session is held or opened for a month without a paid order.
- **SC-702**: In 100 % of runs, no month has two paid orders except through the case of FR-718, and every such case is
  visible to administrators.
- **SC-703**: A student renews a month by hand in under one minute from the notice.
- **SC-704**: In 100 % of failed charges, the student is notified within two minutes, and a hard decline is never retried.
- **SC-705**: Every release and every compensation amount of the programme equals DEC-81's and DEC-85's rule on a worked
  example of 10,000 EGP at 250 a session (350 of a 500 fee only when the student does not continue; 1,750 in full or 1,837.50 by months at the 21st of 41
  sessions; the rest; the full refund on a dropout).
- **SC-706**: Administrators find every paused package and stop request, oldest first, and decide one in under one minute.
- **SC-707**: No card detail (the token, the card number, the expiry) appears in any log, response or audit entry, in
  100 % of the suite's attempts; a card's last four digits and brand are shown to its student only.

## Assumptions

- The cycle runs on 2026-11-19 in B-M4's implementing session; the programme's batches (B-P1 onwards) run in track 2,
  on `ijazah_integrity_b`, the server beside the design week and the screens after it, all merged by 2026-12-04, or the
  programme moves to v1.1 (DEC-92).
- The automatic charge is a merchant-initiated charge on the saved card through the gateway's saved-card integration,
  not its subscription service (DEC-92); until the gateway's written answers, it runs on the stand-in behind the payment
  port, and the closed test renews by hand.
- The teacher's share held and released later rests on the owner's assumption of 2026-11-15 (ADR 0025 D8).
- A package has one weekly time (FR-BOOK-4), so one session a week.
- A refusal request approved after the assessment keeps the fee (the owner's answer, DEC-93).
- The assessment fee has no default; an ijazah-track package cannot be published until an Administrator sets it
  (the owner did not give the amount).
- A postponed or made-up session belongs to the month of its original session and is paid (G-6).
- A teacher's no-show at the assessment is made up (DEC-84), never refunded (G-7).
- A reopened package returns paused, awaiting a payment by hand, since the card was deleted at the close (G-8).
- Push uses DEC-70's existing payment-result kinds; no new kind is added.
- No ERD row or migration is written in this cycle; the data model is in this folder's `data-model.md` (plan), the
  migration and ERD rows (from 65, rules from 70) come with B-P1.
