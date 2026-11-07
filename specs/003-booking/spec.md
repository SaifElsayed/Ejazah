# Feature Specification: Phase 2 — Catalog, discovery, booking

**Feature Branch**: `003-booking`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Phase 2 of PLAN.md: Catalog, discovery, booking (specs/003-booking), T163"

## Overview

**Objective, from PLAN.md**: let a student find a teacher and buy a package with
correctly scheduled sessions.

Phase 1 left an approved teacher as a row whose columns say "approved" and
"payout verified", and a student who can sign in and land on an empty home.
Phase 2 joins them. The teacher writes a public profile, packages on a track
and weekly availability; the student finds only the teachers the visibility
predicate lets them see, opens a profile, picks a package and a weekly slot,
holds it, and pays on the gateway's hosted page. The gateway's signed event,
and nothing else, confirms the enrollment and generates every session at the
chosen weekly slot as local time in the teacher's zone, right across a Cairo
daylight-saving change. Both people then see the enrollment and its sessions,
the teacher in «طلابي», the student in «اشتراكاتي». The admin sees every
gateway order in a monitor that cannot move money.

This is the first phase in which the gender rule has teacher data to protect on
a student-facing path, and the first in which money is charged. So it is also
where the adversarial gender suite grows to the procedures that return
teachers, where the visibility predicate is first implemented as the single
repository filter R-GENDER-5 requires, and where R-HONEST-1 is proved on a
real confirmation path.

**Who builds it, and how big it is.** As Phase 1, for the owner working alone
with Saif's review session as the reviewer of every batch. The scope is the
thirty-eight SRS requirement ids PLAN.md lists for Phase 2 (FR-PROFILE-1…10,
FR-DISC-1…5, FR-BOOK-1…11, FR-PAYG-1…11, NFR-COMP-1), the requirements ADR 0008,
ADR 0009, ADR 0010, ADR 0018 D1 and ADR 0021 D6 add to them (FR-BOOK-12,
FR-PAYG-17…19, FR-SESS-20's generation side), and the Phase 1 follow-ups PLAN.md
carries into this phase. Eight working days, days 12 to 19, from 2026-11-01.
Whatever cannot fit is stated when it is found and goes to the descope ladder
with its cause (PLAN.md, "Extending a phase", "When a phase slips anyway").

**Carried from Phase 1.** `specs/002-identity/tasks.md` holds follow-ups whose
time is this phase (PLAN.md, Phase 2, the owner's decisions of 2026-10-29):
T123, T126, T129, T133 to T140, T160 and T162 land in Phase 2's first three batches (B20 to B22, the owner's decision of 2026-11-01), and T141 in B31 (the owner's decision of 2026-11-01: T124 needs B22's place), and T123's device check in B26, the first batch with a screen that renders one of its keys (the owner's decision of 2026-11-01);
T142 before discovery reads `teacher_subjects`; T143 before the code that reads
the visibility predicate; T145 before a teacher's photo is shown to a student;
T146 before checkout relies on the phone's calls; T161 before this phase relies
on the application's states; T158 with the teacher's profile screens. They keep
their ids and their text there; this specification requires their outcome
where a requirement here depends on it (FR-301 to FR-306) and does not restate
them.

**Scope boundary.** This phase delivers the teacher's public profile, packages
and availability; discovery (browse, search, filters, the profile); the slot
hold, checkout, the gateway order, the signed-event confirmation, session
generation and the expiry jobs; the student's and the teacher's enrollment
lists; the admin's payments monitor; the growth of the adversarial suite. It
delivers no live session, no join, no attendance, no cancellation request, no
make-up, no dispute, no chat, no report, no review writing, no notification
centre and no push: those are Phases 3 and 4. A control whose action belongs to
a later phase is absent from this phase's screens, never shown disabled
(R-MOBILE-13).

**Provenance.** Every requirement traces to a line in PLAN.md's Phase 2
deliverables, definition of done or "decisions carried out here", to an SRS id
in the lists above, to ADR 0006 to ADR 0010, ADR 0017, ADR 0018 or ADR 0021, to
a table or rule of `docs/ERD.md`, to a board of `docs/design/screens.md`, to a
rule of the constitution, or to a Phase 1 follow-up. What Phase 0 and Phase 1
built (the caller kinds, the guards, the payment port and its stand-in, the
idempotency kernel, `packages/time`, `packages/money`, the exclusion
constraints, the design primitives) is named here as given, never
re-specified.

**Numbering.** Phase 0 numbers from FR-001 and SC-001, Phase 1 from FR-101 and
SC-101. This specification numbers from FR-301 and SC-301, so that a citation
never collides with Phase 1's FR-201 to FR-217.

## Clarifications

### Session 2026-10-31

- Q: OPEN-11 is open and SRS §10's gateway row requires written confirmation before a gateway is selected: is the real adapter built in this phase on the working understanding, or does the phase build on the stand-in? → A: On the stand-in, which behaves as a real gateway: every event it sends is signed and goes through the same webhook and signature check, a wrong signature is refused, and it delivers events twice, out of order and after the hold has expired, for `paid`, `failed`, `expired` and `recipient_verified` (FR-372 to FR-374, SC-302, SC-311). The real adapter is the phase's last batch if the gateway's written answers arrive before it; otherwise the phase closes on the stand-in and the adapter with its sandbox run becomes a numbered task timed before Phase 6 (FR-371, SC-301; PLAN.md, Phase 2, the owner's decision of 2026-10-31).
- Q: FR-PAYG-5, FR-PAYG-18 and FR-PAYG-19 notify the parties, and the Confirming badge is resolved by the payment-confirmed push, but notifications land in Phase 4: are the screens the notice, or does this phase write notification rows? → A: The screens are the notice, as in Phase 1 (FR-VERIFY-6). The Confirming state clears without a push: the app reads the enrollment again on returning from the hosted checkout, on coming back to the foreground, and on a bounded schedule while it is pending, then says clearly what is known (FR-383, FR-384). Every confirmation, failure, expiry and refused confirmation is kept as a durable record that Phase 4's notifications build on without changing this phase's code (FR-385; PLAN.md, Phase 4).
- Q: Is a slot that overlaps another active slot of the same teacher refused when it is saved? → A: Yes. The overlap is counted over the whole week in the teacher's zone, not within one day only (Sunday 23:30 for 60 minutes overlaps Monday 00:00); the database's refusal of overlapping sessions at booking stays as a second line, for two saves at the same moment (FR-317).
- Q: Can a slot's day, start time or length change while an enrollment or an active hold uses it? → A: No. They are frozen while an enrollment or an active hold uses the slot; the teacher disables it and adds a new one; a free slot is edited freely (FR-318).
- Q: When is the first session after a payment is confirmed? → A: The first occurrence of the weekly slot at least 24 hours after the confirmation, the 24 hours a setting. The student sees that date before paying; the final date is computed from the confirmation, and where it differs from the one shown (the confirmation came late), the confirmation screen says the new date plainly (FR-368, FR-386).
- Q: May a package's price be zero? → A: No. A price of zero is refused when the package is saved; the gateway's signed paid event is the only confirmation (FR-311, FR-PAYG-3).
- Q: Does the name search ignore the differences of Arabic spelling? → A: Yes. أ, إ and آ count as ا; ى and ئ as ي; ؤ as و; ة as ه; diacritics and tatweel are removed; Latin letters ignore case; the same on the stored name and on what the student types. The search runs only inside the visibility predicate, T143's standing included, so it never returns a hidden teacher, with a test of its own (FR-333, SC-314).
- Decision (the owner, 2026-10-31, not a question): a package's session length and a slot's length are 30, 45 or 60 minutes, nothing else. The requirement comes from the SRS, not from the board, so FR-PROFILE-2 and FR-PROFILE-4 are amended with it, and the two boards that drew 45/60 now draw the three (`PackageEditor`, `SlotEditor`). Anything the boards show that the SRS does not say is put to the owner before it is written here.
- Q: Seven behaviours of this specification came from the boards, not the SRS; which stay? → A: Six stay, each the owner's decision of 2026-10-31: a package's track and length are frozen after its first enrollment (FR-312, SRS FR-PROFILE-3 amended); the package's subject list offers only approved subjects, which withdraws the draft for a subject under review that FR-PROFILE-11 left open (FR-311, SRS FR-PROFILE-11 amended); the result card's nearest slot and lowest price per session (FR-335); the checkout countdown that continues offline (FR-358); enrollments ordered by next session and the next session on the home (FR-390); the «غير منشورة» marker and the banner to payout setup (FR-315). The profile shows the price per session and the track's remedy line, but not the chain: the riwaya, the tariq and the chain stay in Phase 4 with FR-ISNAD-5 (FR-336).

### Session 2026-11-01

- Decision (the owner, on the plan and the analysis): discovery is ordered by rating with no review last, then review count, name and id, in the order and in the paging; ranking by confidence is a later follow-up (tasks.md T058).
- Decision (the owner, on PR #109's review): an account suspended, banned, revoked or deleted releases its holds and cancels its enrollments awaiting payment (R-219), with FR-PAYG-6 and FR-BOOK-9 amended in the SRS, FR-VERIFY-8 cited; a paid event that still arrives for such an enrollment takes the refusal branch, which opens a compensation case (FR-362). FR-AUTH-14's confirmed part is Phase 3's first batch (tasks.md T059).
- Decision (the owner, on PR #109's review): a second paid order on a confirmed enrollment is recorded and opens a compensation case, the enrollment unchanged (FR-375).
- Decision (the owner, on the plan): the hosted checkout's address is read back only by the order's own student, only while the order is payable and unexpired, and never logged.

## User Scenarios & Testing _(mandatory)_

The people served by this phase are an approved teacher setting up what they
offer, a student finding and buying, and an admin watching orders. Each story
is independently demonstrable and names the PLAN.md deliverables it covers.

### User Story 1 - An approved teacher offers packages at weekly times (Priority: P1)

An approved teacher fills in a public profile — photo, bio, qualification —
and creates packages: a subject among those whose credential an admin has
approved, a track (recitation or ijazah track), a number of sessions, a session
length and a total price. They add weekly availability: a day of the week, a
start time and a length, in their own time zone. Until the gateway has verified
their payout account, all of it is a draft no student sees; on verification it
is published with no further step.

_Covers PLAN.md: "Subjects in both languages", "Teacher profiles and packages,
each package on a track (ADR 0018 D1)", "Availability slots as local time plus
zone"._

**Why this priority**: Discovery has nothing to show until a teacher has a
profile, a package and a slot.

**Independent Test**: As an approved teacher whose payout is verified, write the
profile, create two packages on the two tracks and three weekly slots; see each
as a student of the same gender would. As one whose payout is not verified, do
the same and confirm a student sees nothing, then verify the payout through the
stand-in and confirm everything appears with no action by the teacher.

**Acceptance Scenarios**:

1. **Given** an approved teacher, **When** they edit the profile, **Then** the bio, the qualification summary and the photo are saved, the display name is editable from the teacher's own account tab (T158), and the gender is shown, never editable (FR-PROFILE-1, FR-PROFILE-7, R-GENDER-6).
2. **Given** the package editor, **When** the subject is picked, **Then** only subjects with an approved credential are offered, with an entry to add a subject (FR-PROFILE-11 as amended on 2026-10-31; the owner's decision of 2026-10-31).
3. **Given** a package, **When** it is saved, **Then** it has a subject, a track, a session count of at least one, a session length of 30, 45 or 60 minutes and a price in piasters of more than zero, shown in pounds (FR-PROFILE-2 as amended on 2026-10-31, ADR 0018 D1, R-MONEY-1).
4. **Given** a package with at least one enrollment, **When** the teacher edits it, **Then** its track and session length cannot change, a new price applies only to later purchases, and existing enrollments keep their snapshot (FR-PROFILE-3 as amended on 2026-10-31, DEC-24; the owner's decision of 2026-10-31).
5. **Given** a package or a slot, **When** the teacher deactivates it, **Then** no new purchase can use it, and every enrollment and session already made on it is unchanged (FR-PROFILE-3, FR-PROFILE-9).
6. **Given** a slot, **When** it is created, **Then** it stores the day of the week, the local start time, the length and the teacher's zone at creation; never a UTC instant (FR-PROFILE-4, Architecture §9).
7. **Given** a teacher whose payout account is not verified, **When** they open their packages, **Then** each active package carries «غير منشورة» and a banner leads to payout setup (the owner's decision of 2026-10-31); on verification the packages and slots are visible to students with no step by the teacher (FR-PROFILE-10, FR-PAYG-14, FR-PAYG-15, `PackagesLocked`).
8. **Given** a teacher who replaces the payout account, **When** the change is made, **Then** they leave discovery and cannot be booked until the new account is verified, and their confirmed enrollments are unaffected (FR-PAYG-16).

---

### User Story 2 - A student finds only the teachers they may see (Priority: P1)

A student opens Discovery and sees teachers sectioned by subject, each tab with
the number of teachers the student may see. They search by subject or by the
start of a teacher's name, filter by track, minimum rating and riwaya, and open
a profile with its packages and its reviews summary.
A teacher of the other gender, an unapproved teacher, a teacher whose payout is
not verified, a deleted teacher and a suspended or banned teacher are absent
everywhere — in results, counts and direct access alike.

_Covers PLAN.md: "Search and browse", "Gender filtering enforced at the
repository layer", "Adversarial gender suite blocking in CI"; definition of
done: "A forbidden profile returns 404, never 403", "Adversarial gender tests
pass in CI"._

**Why this priority**: It is the product's hardest rule meeting its first
student-facing data, and a leak is a screenshot, not a bug ticket (R-GENDER-1).

**Independent Test**: Seed teachers of both genders and in every excluded
state; as a male and as a female student, browse, search, filter and open each
teacher by id; every result, count and response matches the predicate, and the
adversarial suite passes in both directions.

**Acceptance Scenarios**:

1. **Given** any student-facing path that returns teachers or their data — browse, search, filters, the subject counts, the profile, its packages, its slots, its reviews summary, the hold — **When** it runs, **Then** it reads teachers only through the one repository filter that takes the requester's gender and applies SRS §3.7.1's predicate, five conjuncts (R-GENDER-5, ADR 0006 D1, T143).
2. **Given** a teacher the predicate excludes, **When** the student requests the profile, its packages or its slots by id, **Then** the answer is the one a nonexistent teacher gets, 404, never 403, with no field of the teacher in it (R-GENDER-1, R-GENDER-2, FR-DISC-3).
3. **Given** the subject tabs, **When** counts are shown, **Then** each is computed after the predicate (R-GENDER-3, FR-DISC-2).
4. **Given** a name search, **When** a prefix of a display name is typed, **Then** the matching teachers the predicate allows are returned with the match highlighted, and a teacher of the other gender is never returned whatever the prefix (FR-DISC-1, ADR 0021 D6).
5. **Given** the filters, **When** the student filters by track, by minimum rating (all, then 5 down to 1 stars and up) or, for a subject with riwayas on approved credentials, by riwaya, **Then** the results narrow accordingly, the dropdown closes on apply or on its trigger, and each applied filter is a chip removable on its own (FR-DISC-1).
6. **Given** a teacher whose account is `verification_required`, **When** a student browses, **Then** the teacher is visible, but a hold on their slot is refused; a suspended or banned teacher is not visible at all (SRS §3.7.1 as amended 2026-10-31, FR-VERIFY-10, T143).
7. **Given** the profile, **When** it is shown, **Then** it carries the display name, the gender, the photo stripped of its metadata (T145), the bio, the subjects with an approved credential, the aggregate rating and review count (none yet: the no-reviews line), and the active packages with their track, the track's remedy line, length, total price and price per session; no riwaya, tariq or chain, which are Phase 4's (FR-DISC-4, FR-PROFILE-6, FR-PROFILE-7, FR-ISNAD-5; the owner's decision of 2026-10-31).
8. **Given** the adversarial suite, **When** it runs in CI on every commit, **Then** it attacks every procedure of this phase that returns teacher data by direct call, forged and guessed ids, a tampered token and client-supplied gender, in both directions, and blocks the merge on any leak (NFR-COMP-1, FR-064 of Phase 0).

---

### User Story 3 - A student holds a slot, pays, and the gateway alone confirms (Priority: P1)

On a profile, the student picks a package, then a weekly slot of the same
length that is free and does not overlap their own sessions, and sees the
first and last session dates. Continuing places a hold on the slot for the
checkout time plus a grace. On the checkout screen they review the teacher,
the package and the price under a countdown, and pay: the enrollment is
created awaiting payment and the gateway's hosted checkout opens. When it
returns, the app waits for the server, not for the gateway's word. The
gateway's signed paid event confirms the enrollment, converts the hold and
generates every session, with no human step. A failed payment can be retried
on the same hold; an expired hold cancels the enrollment; a payment that lands
after its hold was taken by someone else is recorded, cancels nothing it
should not, and opens a compensation case.

_Covers PLAN.md: "Slot holds with TTL and expiry job", "Double-booking
prevention on both axes", "Enrollment with full term snapshots", "Enrollment
cancellation", "Gateway checkout behind the payment port: order creation,
hosted checkout, signed-webhook ingestion, `confirm-enrollment` and
`expire-pending-payments` jobs (ADR 0007)", "Real gateway adapter (OPEN-11)";
definition of done: "A student finds a teacher, holds a slot, pays on the
gateway sandbox, and the signed webhook confirms the enrollment and generates
sessions with no human step", "`confirmed_at` has exactly one write path"._

**Why this priority**: It is the phase's objective, and the only place money
is charged.

**Independent Test**: Against the stand-in gateway with no provider credential,
and then against the gateway's sandbox, run a purchase to the success screen;
replay the paid event and see nothing change; let a hold expire and see its
enrollment cancelled; race two students for one slot and see one hold; deliver
a paid event after the hold was taken and see a compensation case and no
second hold.

**Acceptance Scenarios**:

1. **Given** the booking sheet, **When** slots are offered, **Then** they are the package's teacher's active slots of exactly the package's length, not occupied by an enrollment until its release (FR-BOOK-10), not held, and not overlapping the student's own sessions, shown in the student's zone with the derived first and last session dates (FR-BOOK-2, FR-PROFILE-8, FR-BOOK-5, `BookingSheet`).
2. **Given** «متابعة إلى الدفع», **When** it runs, **Then** in one transaction the expired holds on the slot and the student's own expired hold are released, a hold is written for the checkout time plus the grace, and only then the student's and the teacher's sessions are checked for an overlap; on an overlap or a held slot nothing is kept and the student sees «الموعد حُجز للتو» (FR-BOOK-9, ADR 0010 D1–D3, `SlotTaken`).
3. **Given** a student whose earlier hold has not expired, **When** they start a new checkout, **Then** FR-BOOK-12 runs exactly as written: the old hold ends at once when none of its orders is still payable; otherwise the gateway is asked to cancel the payable order, and on its answer the old hold ends, or the new checkout is refused and the student is taken to the earlier payment (`CheckoutPrevious`) (ADR 0010 D6).
4. **Given** the checkout screen, **When** the student pays, **Then** the enrollment is written awaiting payment with a full snapshot (price, session count, length, subject, track, the slot's zone), linked to the hold, and a gateway order for the snapshot price is created and its hosted checkout handed over only in a transaction that finds the hold still active by a conditional update of the hold (FR-PAYG-2, FR-BOOK-3, FR-BOOK-12, DEC-24).
5. **Given** the hosted checkout returns, **When** the app shows Processing, **Then** it reads the enrollment's status from the server and shows success — receipt, order reference, amount, the generated sessions — only when the server reports it confirmed; after the configured confirmation timeout it releases the student with the Confirming state (FR-PAYG-17, FR-PAYG-18, ADR 0008 D1, R-HONEST-1).
6. **Given** an inbound gateway event, **When** it arrives, **Then** its signature is verified on the raw body before any handler runs, its provider event id is persisted under the unique non-null column, and a replay is acknowledged and changes nothing (FR-PAYG-4, R-MONEY-8, R-MONEY-9).
7. **Given** a persisted paid event, **When** `confirm-enrollment` runs, **Then** in one transaction the enrollment is confirmed with `confirmed_at` set, the hold is converted and every session is generated; running it twice equals running it once (FR-PAYG-5, FR-BOOK-4, R-HONEST-1, ERD §15 rule 15).
8. **Given** a paid event whose hold was already released, **When** `confirm-enrollment` runs, **Then** FR-PAYG-19 runs exactly as written: a new hold, confirmation and generation in one transaction where the database allows it; otherwise nothing of that transaction is kept, the enrollment is cancelled `slot_unavailable`, one compensation case is opened on it and no second, and the student sees `PaymentSlotUnavailable` (ADR 0010 D5, FR-DISPUTE-5).
9. **Given** a failed or cancelled gateway event, **When** it is processed, **Then** that order is marked failed and the hold stays, and the student may Retry — a new order on the same hold, for as long as an order can still be created on it — or choose another slot (FR-PAYG-6, FR-PAYG-18, `PaymentFailed`).
10. **Given** a hold past its expiry, **When** the expiry jobs run, **Then** the hold is released and its enrollment cancelled in the same transaction, `payment_failed` if its last order failed and `payment_expired` otherwise; the student who returns sees `CheckoutExpired` and starts again from the package (FR-PAYG-6, ADR 0010 D7).
11. **Given** any path other than the persisted paid event and `confirm-enrollment`, **When** the code is inspected and tested, **Then** none sets an enrollment confirmed: no proof upload, no transaction-reference field, no teacher toggle, no admin action, no client redirect (FR-PAYG-3, FR-PAYG-8, R-HONEST-1).
12. **Given** the stand-in gateway, **When** the suite runs with no provider credential, **Then** every scenario above passes against it, every event reaching the server through the signed webhook as a real gateway's would (FR-372 to FR-374); **given** the gateway's written answers before the phase's last batch, **When** the owner runs the purchase on the gateway's sandbox, **Then** the same journey completes (FR-PAYG-2, FR-371, OPEN-11).
13. **Given** an event signed with a wrong secret, unsigned, or changed after signing, **When** it reaches the webhook, **Then** it is refused before any handler runs and nothing is written (FR-PAYG-4, R-MONEY-9, FR-372).
14. **Given** the stand-in delivering a paid event twice, two events in the reverse of the order they happened, or a paid event after the hold has expired, **When** they are processed, **Then** the enrollment is confirmed at most once, a late failure or expiry undoes no confirmation, and the late payment follows FR-PAYG-19 (FR-373).

---

### User Story 4 - Sessions keep their local time, and both people see them (Priority: P2)

A confirmed enrollment's sessions fall on the chosen weekday at the chosen
local time in the teacher's zone, week after week, including across Cairo's
daylight-saving changes. The student sees them in «اشتراكاتي» and on the home;
the teacher sees them in «طلابي» and on «اليوم»; each sees every time in the
teacher's zone and in their own.

_Covers PLAN.md: "`packages/time` complete and DST-safe", "Session generation
as UTC instants"; definition of done: "Sessions schedule correctly across a
Cairo DST boundary"._

**Why this priority**: Correct times are the purchase's whole value, but they
can be proved by property tests before the screens exist.

**Independent Test**: Confirm an enrollment whose sessions straddle Cairo's
spring and autumn changes; every session sits at the slot's local time, the
gap and the repeated hour resolve as `packages/time` declares, and both lists
show the same sessions in both zones.

**Acceptance Scenarios**:

1. **Given** a confirmation, **When** sessions are generated, **Then** each stores its local date, its local start time and the IANA zone of the enrollment's snapshot as the fact, and its UTC start and end as a cache computed from them by `packages/time` (ADR 0009 D1–D2, FR-SESS-20).
2. **Given** a local start that falls in a spring-forward gap or an autumn repeat, **When** it is resolved, **Then** it resolves by the rule `packages/time` declares (`shifted_forward`, `first_of_two`), and the stored local fields keep what was asked for (ADR 0009 D1).
3. **Given** sessions generated, **When** the database writes them, **Then** none overlaps another session of the same teacher or of the same student; a refused generation creates no session (FR-BOOK-5, ERD §15 rule 19).
4. **Given** the runtime's time zone data changes, **When** the worker's re-resolution job runs, **Then** the cached instants of scheduled sessions are recomputed under the rules of ERD §15 rule 19 (ADR 0009 D3, ADR 0010).
5. **Given** an enrollment, **When** either person opens it, **Then** they see upcoming sessions, sessions completed and sessions remaining, derived and never stored, with every time shown in the teacher's zone and the viewer's (FR-BOOK-7, ADR 0009 D5, R-DB-4).
6. **Given** «طلابي», **When** the teacher types a student's name, **Then** both the active and the ended tabs narrow by it (FR-BOOK-7, ADR 0021 D6).
7. **Given** an enrollment's final session, **When** its week has passed plus the configured release buffer, **Then** its slot is offered to other students again (FR-BOOK-10).

---

### User Story 5 - An admin sees every order and can move no money (Priority: P2)

The admin opens «المدفوعات» and sees every gateway order: its reference, its
student, its gross, fee and net as the gateway reported them, its status, and
the plain-language history of its signed events. Nothing on the page changes
anything.

_Covers PLAN.md: "Admin payments monitor, read-only"; definition of done: "No
code outside `packages/money` does piaster arithmetic; no wallet, ledger,
escrow or balance exists anywhere; money amounts appear only in `payments`"._

**Why this priority**: The operator needs it from the first real payment, but
no student journey depends on it.

**Independent Test**: After the purchases of Story 3, the monitor lists each
order with the figures the gateway reported, a paid order cancelled
`slot_unavailable` shows its link, and no control on the page writes.

**Acceptance Scenarios**:

1. **Given** the monitor, **When** it lists orders, **Then** each row carries the order reference and date, the student, gross, fee and net as reported (a dash where not paid), and the status, newest first, searchable by order reference or student name and filterable by status, in pages of the configured size (FR-PAYG-11, FR-ADMIN-18, `AdminPayments`).
2. **Given** an order, **When** its detail opens, **Then** it shows the amounts as reported, the gateway's references, the enrollment's package and progress, and the history of its events in plain language (FR-PAYG-7, FR-ADMIN-18).
3. **Given** the monitor's procedures, **When** they are listed, **Then** every one is a read; none creates, changes, refunds or confirms anything (FR-PAYG-11, R-MONEY-6).
4. **Given** the monitor, **When** it is opened, **Then** only an administrator signed in with the second factor reaches it, as every admin page (NFR-SEC-6, FR-ADMIN-1).

---

### Edge Cases

- Two students press «متابعة إلى الدفع» on the same slot at once: the database admits one hold; the other sees `SlotTaken` (ERD §15 rule 17).
- A student holds a slot whose time overlaps a session they confirm meanwhile with another teacher: the hold's own check, or the generation's constraint, refuses; nothing half-written remains (FR-BOOK-5).
- The paid event arrives before the app reaches Processing, or never reaches the app: the server confirms regardless, and the app reads Confirmed on its next read (FR-PAYG-17).
- The paid event arrives twice, or out of order with a failed event for an older order of the same hold: each event is recorded once; the enrollment is confirmed once (FR-PAYG-4, FR-PAYG-5).
- The teacher deactivates the slot or the package while a student holds it: the hold and its checkout complete; the deactivation stops later holds only (FR-PROFILE-3, FR-PROFILE-9).
- The teacher's payout is replaced while a student is in checkout: the hold already placed may complete if paid; a new hold is refused (FR-PAYG-16). The teacher or the student is suspended, banned, revoked or deleted while a student is in checkout: the hold is released and the enrollment awaiting payment cancelled at once (R-219); a paid event that still arrives takes the refusal branch, the enrollment stays cancelled and one compensation case is opened (FR-362; the owner's decision of 2026-11-01). What a suspension does to confirmed enrollments is Phase 3's (FR-SESS-16).
- A teacher's gender is corrected by an admin while a student holds their slot: the predicate is read at each step; the next step for an incompatible student is the 404 a nonexistent teacher gets (FR-GENDER-7's enrollment consequences are Phase 4's, the owner's decision of 2026-11-05).
- A package priced at zero: refused when it is saved, since the gateway's signed paid event is the only confirmation (FR-311, FR-PAYG-3, FR-PAYG-8).
- Two slots saved at the same moment that overlap: the save-time check may pass both; the database refuses the second overlapping session at booking (FR-317, FR-369).
- A confirmation arrives later than the student's checkout, past the first session the student was shown: the first session moves to the next occurrence that meets the lead, and the success screen says so (FR-386).
- A slot whose local start falls in the spring-forward gap every year (a Friday at 00:30 in Cairo): every session but the one in the gap's week keeps its time; that one resolves forward (ADR 0009 D1).
- The student's zone differs from the teacher's: slots and sessions show both zones; the hold and the generation use only the teacher's zone frozen in the snapshot (ADR 0009 D5).
- A student deletes their account with an enrollment awaiting payment: the deletion releases the active hold and cancels that enrollment with `account_deleted` (R-219). Phase 1's deletion touches no hold or enrollment. The confirmed part of FR-AUTH-14 (remaining sessions `cancelled_by_admin`, confirmed enrollments `account_deleted`, a deleted teacher with FR-SESS-16's effect) needs Phase 3's session cancellation and lands in Phase 3's first batch (tasks.md T059; the owner's decision of 2026-11-01).
- The confirmation timeout passes with no answer: the student is released with the Confirming state, and the badge clears when the enrollment is next read as confirmed.

## Requirements _(mandatory)_

Each requirement names its source. Where a requirement restates an SRS line it
adds only what this phase decides about it.

### Functional Requirements

**Carried from Phase 1**

- **FR-301**: Phase 2's first three batches (B20 to B22) MUST land T123, T126, T129, T133 to T140, T160 and T162 of `specs/002-identity/tasks.md` before any other batch of this phase starts (PLAN.md, Phase 2, the owner's decision of 2026-10-29); T141 lands in B31, before T054 (amended 2026-11-01, the owner's decision of 2026-11-01: T124 needs B22's place); T123's device check lands in B26, the first batch with a screen that renders one of its keys (the owner's decision of 2026-11-01).
- **FR-302**: T142 MUST land before any procedure of this phase reads `teacher_subjects`; T161 before any procedure of this phase reads the application's states.
- **FR-303**: The visibility predicate MUST include the account's standing as SRS §3.7.1 states it since 2026-10-31: discovery leaves out a suspended or banned teacher; holds, checkout and any token issuance require the teacher's account to be active (T143).
- **FR-304**: A teacher's photo MUST reach a student only after its metadata is stripped (T145).
- **FR-305**: The phone's calls MUST time out, the refresh among them, before checkout ships (T146).
- **FR-306**: Any code of this phase that suspends or bans an account MUST call `StandingService` (T144); this phase is expected to have none.

**Teacher profile, packages and availability**

- **FR-310**: An approved teacher MUST be able to read and edit their public profile: photo, bio and qualification summary; the display name through the account's profile entry, reachable from the teacher's account tab (FR-PROFILE-1, T158). The bio is at most 1000 characters (the owner's decision of 2026-11-02).
- **FR-311**: A teacher MUST be able to create, edit, deactivate and reactivate packages, each with a subject among the teacher's approved subjects only (no package for a subject under review, the owner's decision of 2026-10-31), a track, a session count of at least one and at most 52 (the owner's decision of 2026-11-02: FR-BOOK-4 generates every session in one transaction when the payment is confirmed, so an unbounded count could bring the worker down), a session length of 30, 45 or 60 minutes and a price in piasters of more than zero (FR-PROFILE-2 as amended on 2026-10-31, FR-PROFILE-3, FR-PROFILE-11, ADR 0018 D1).
- **FR-312**: Once a package has an enrollment, its track and session length MUST NOT change; its price MAY change and applies only to later purchases (FR-PROFILE-3 as amended on 2026-10-31; the owner's decision of 2026-10-31).
- **FR-313**: A teacher MUST be able to create, deactivate and reactivate weekly slots of a day of the week, a local start time and a length of 30, 45 or 60 minutes, stored with the teacher's IANA zone at creation and never as a UTC instant (FR-PROFILE-4, FR-PROFILE-9).
- **FR-317**: A slot that overlaps another active slot of the same teacher MUST be refused when it is saved or reactivated, the overlap counted over the whole week in the teacher's zone (a slot may cross midnight into the next day, and Saturday's end wraps to Sunday); the database's refusal of overlapping sessions at booking (FR-369) stays as the second line for two saves at the same moment (the owner's decision of 2026-10-31).
- **FR-318**: While an enrollment awaiting payment or confirmed, or an active hold, uses a slot, its day, start time and length MUST NOT change; the teacher disables it and adds a new one; a slot no enrollment or hold uses MAY be edited (FR-PROFILE-9; the owner's decision of 2026-10-31).
- **FR-314**: Deactivating a package or a slot MUST stop new holds on it and MUST NOT change any enrollment or session already made on it (FR-PROFILE-3, FR-PROFILE-9).
- **FR-315**: A teacher whose payout account is not verified MUST be able to draft packages and slots, and MUST see them marked «غير منشورة» with a banner to payout setup (the owner's decision of 2026-10-31); they MUST become visible to students on verification with no action by the teacher, and invisible again from a payout replacement until the new account is verified (FR-PROFILE-10, FR-PAYG-14, FR-PAYG-15, FR-PAYG-16).
- **FR-316**: Subjects MUST be shown in Arabic on Arabic screens and in English on English screens from their two stored names; this phase adds no admin page to create subjects, and the seeded list stays the catalogue (ADR 0021 D1, FR-LOC-1).

**Discovery**

- **FR-330**: Every query that returns a teacher, or a teacher's package, slot, credential or rating, on a student-facing path MUST go through one repository filter that takes the requester's gender and applies the five conjuncts of SRS §3.7.1; no unfiltered method MAY be callable from a student-facing path (R-GENDER-5, ADR 0006 D1, FR-DISC-3, FR-DISC-5).
- **FR-331**: A request for an excluded teacher's profile, packages or slots MUST receive the answer a nonexistent teacher receives (404), carrying no field of that teacher (R-GENDER-1, R-GENDER-2).
- **FR-332**: The browse view MUST be sectioned by subject, with a tab for all subjects and one per subject, each showing the number of teachers visible to the requester, counted after the predicate (FR-DISC-2, R-GENDER-3).
- **FR-333**: Search MUST match by subject and by a prefix of the teacher's display name, and MUST run only inside the visibility predicate of FR-330, T143's standing included, so that it never returns a hidden teacher; the name is compared after the same normalisation on the stored name and on the typed text — أ, إ and آ to ا; ى and ئ to ي; ؤ to و; ة to ه; diacritics and tatweel removed; Latin letters without case — and the matched part of the name is marked (FR-DISC-1, FR-DISC-3, T143; the owner's decision of 2026-10-31).
- **FR-334**: Results MUST be filterable by track, by minimum rating (all, then 5 down to 1 stars and up) and, where the selected subject has riwayas on approved credentials, by riwaya; applied filters MUST appear as chips removable one by one (FR-DISC-1, ADR 0021 D6).
- **FR-335**: A result card MUST show the teacher's name, subjects, track badges, a short bio, the rating and review count, the nearest free slot of an active package (the first session the student would get by FR-368's rule), and the lowest price per session of the teacher's active packages, all computed after the predicate (FR-DISC-2, R-GENDER-3; the nearest slot and the lowest price per session, the owner's decision of 2026-10-31). No riwaya is shown on the card in this phase (FR-ISNAD-5 is Phase 4's); the riwaya filter of FR-334 stays.
- **FR-336**: The profile MUST show the display name, gender, photo, bio, qualification, subjects with an approved credential, the aggregate rating and review count, and the active packages with their track, the track's remedy line, the session length, the total price and the price per session; it MUST NOT show a credential's riwaya, tariq or chain, which stay in Phase 4 with FR-ISNAD-5 (FR-DISC-4, FR-PROFILE-6, FR-PROFILE-7, ADR 0018 D2; the price per session, the remedy line and the chain's absence, the owner's decision of 2026-10-31).
- **FR-337**: Any per-session price shown MUST be computed only in `packages/money` (R-MONEY-5).
- **FR-338**: Search MUST be limited by the configured search rate limit per subject (NFR-SEC-10, §3.14).

**Hold, checkout and order**

- **FR-350**: The booking sheet MUST offer only the teacher's active slots of exactly the package's length that are neither occupied by an enrollment before its release (FR-BOOK-10) nor actively held, and that do not overlap the requesting student's own sessions (FR-BOOK-2, FR-PROFILE-8, FR-BOOK-5).
- **FR-351**: Placing a hold MUST, in one transaction, release the expired holds on the slot and the student's own expired hold (cancelling their enrollments as FR-363 says), insert the hold with an expiry of the checkout time plus the hold grace from settings, and then check the student's and the teacher's existing sessions; on any refusal nothing MAY be kept (FR-BOOK-9, ADR 0010 D3, R-MONEY-12).
- **FR-352**: A student MUST hold at most one slot, and a slot MUST be held by at most one student, both enforced by the database; a new checkout over an unexpired hold MUST follow FR-BOOK-12 exactly, including its call to the gateway to cancel a payable order (ERD §15 rules 17–18, ADR 0010 D6).
- **FR-353**: A purchase MUST be refused when the package is inactive, the slot is inactive, of another length, or not one of the package's teacher's slots (answered `NOT_FOUND`, nothing written; SRS FR-BOOK-2, PR #109's review round 2), the teacher fails the predicate or is not active, the student's account is not active, or the buyer is the teacher (FR-BOOK-1, FR-BOOK-11, FR-PROFILE-8, FR-VERIFY-10, T143, ERD §15 rule 2).
- **FR-354**: Pay MUST, in one transaction that finds the hold still active through a conditional update of the hold row, write the enrollment awaiting payment with its full snapshot (price, session count, length, subject, track, the slot's zone), link the hold to it, and record the gateway order for the snapshot price; the hosted checkout MUST be handed to the student only after that commit, and otherwise the order cancelled where the gateway allows (FR-PAYG-2, FR-BOOK-3, FR-BOOK-12, DEC-24).
- **FR-355**: Every gateway order created on a hold, a Retry included, MUST expire no later than the hold's expiry minus the grace, where the gateway allows the expiry to be set (FR-PAYG-6).
- **FR-356**: Retry MUST create a new order on the same hold while an order can still be created on it; choosing another slot MUST follow FR-BOOK-12 (FR-PAYG-18).
- **FR-357**: Placing a hold, paying and retrying MUST be safe to repeat with the same idempotency key, returning the first outcome (FR-042 of Phase 0, R-API-14, ADR 0008 D2), and MUST be limited by the configured payment initiation rate limit (NFR-SEC-10).
- **FR-358**: The checkout screen MUST show the one payment summary (teacher, then the package as subject · sessions · minutes with its track badge, then the price) and a countdown to the order's expiry that continues offline (the owner's decision of 2026-10-31).

**Events, confirmation and generation**

- **FR-360**: The webhook MUST verify each event's signature on the raw body before any handler runs, persist it once under its unique non-null provider event id, store a hash of the body and never the body, and acknowledge a replay with no effect (FR-PAYG-4, R-MONEY-8, R-MONEY-9, ERD `payment_events`).
- **FR-361**: A persisted paid event MUST be processed by `confirm-enrollment`, which MUST, where the hold is active, in one transaction set the enrollment confirmed with `confirmed_at`, convert the hold and generate every session; it MUST be idempotent (FR-PAYG-5, FR-BOOK-4).
- **FR-362**: `confirm-enrollment` MUST follow FR-PAYG-19 for a paid event whose hold was released: re-hold and confirm where the database allows; otherwise release, cancel with `slot_unavailable`, open exactly one compensation case on the enrollment (`disputes.kind = compensation_case`) and keep nothing of the refused transaction (ADR 0010 D5, FR-DISPUTE-5). Where the enrollment was cancelled because a party's account was suspended, banned, revoked or deleted, or where on a late paid event the teacher fails the visibility predicate for booking (FR-303) or the student's account is not active, the paid event MUST take the refusal branch: the enrollment stays cancelled with its reason and one compensation case is opened (SRS FR-PAYG-6 and FR-PAYG-19 as amended, FR-VERIFY-8; the owner's decision of 2026-11-01). A compensation case covers every paid order of its enrollment whose paid event was recorded before the case was opened, while it is open, or before it was closed (`disputes.resolved_at`, for `resolved` and `dismissed`), all three instants the database's; `confirm-enrollment` MUST do nothing for an order any case of its enrollment covers (it joins that case), and the `expire-pending-payments` sweep MUST NOT hand it on; an order no case covers, on an enrollment whose cases were all closed before it was paid, MUST open one new `duplicate_payment` case through the same function and change nothing else (SRS FR-PAYG-19 as amended; the owner's decision of 2026-11-04). *(Note 2026-11-05, the owner's decision; spec FR-493 and research R-326 of `specs/004-sessions/`: «any case of its enrollment covers» is narrowed to Phase 2's three compensation reasons, `slot_unavailable`, `party_restricted` and `duplicate_payment`; a case of a reason Phase 3 adds, an administrator's manual case among them, covers no paid order, so it changes neither the confirmation nor the late branch. Built by T004 of `specs/004-sessions/tasks.md` (moved from T064 by the owner's decision of 2026-11-06 on PR #126's review), T064 testing it with the manual case; the requirement is otherwise unchanged.)*
- **FR-363**: Every release of a hold without conversion MUST cancel its enrollment in the same transaction with the reason ADR 0010 D7 gives: `payment_failed` or `payment_expired` on expiry, `checkout_abandoned` by the student's new checkout, `slot_unavailable` under FR-362 (FR-PAYG-6). A release whose enrollment already has a `paid` order does not cancel it: the enrollment stays awaiting payment for `confirm-enrollment`, which confirms it or takes FR-362's branch (amended 2026-11-03, the owner's decision).
- **FR-364**: `expire-pending-payments` and the hold-expiry sweep MUST release expired holds and mark expired orders, under FR-363, idempotently, every minute, with their windows read from settings (amended 2026-11-03, the owner's decision: the cadence is the code's, as every sweep's) (FR-PAYG-6, R-MONEY-12, R-API-14).
- **FR-365**: A failed or cancelled order event MUST mark that order failed and leave its hold in place (FR-PAYG-6).
- **FR-366**: `confirmed_at` MUST have exactly one write path, `confirm-enrollment` on a persisted paid event; no procedure, admin action, upload or client value MAY confirm an enrollment, and a CI test MUST prove it (FR-PAYG-3, FR-PAYG-8, R-HONEST-1, ERD §15 rule 15).
- **FR-367**: The payment record MUST hold, per order, the gateway's order and transaction references, the gross, the gateway's fee and the net as the gateway reported them, the currency, the status and the times; the platform MUST NOT compute a net or any share (FR-PAYG-7, R-MONEY-5, FR-PAYG-1).
- **FR-368**: Session generation MUST place the enrollment's sessions on consecutive weeks at the slot's weekday and local start time in the snapshot zone, beginning with the first occurrence of the slot that starts at least the configured first-session lead (default 24 hours) after the confirmation instant, numbered from one, with local date, local start and zone stored as the fact and UTC start and end as a cache computed by `packages/time` (FR-BOOK-4, ADR 0009 D1–D2).
- **FR-369**: The database MUST refuse a session that overlaps another of the same teacher or the same student, and a refused generation MUST create no session (FR-BOOK-5, ERD §15 rule 19).
- **FR-370**: The worker's time zone re-resolution job MUST recompute scheduled sessions' cached instants when the runtime's time zone data changes, as ERD §15 rule 19 describes (ADR 0009 D3, FR-SESS-20).
- **FR-371**: The phase MUST be built and proved on the payment port's stand-in. The real adapter — its member of the payment gateway enum, the port's order, cancel and event operations against the gateway's sandbox, selected by configuration, with production still refusing the stand-in — MUST be built in the phase's last batch only if the gateway's written answers to OPEN-11's points have arrived before that batch starts; otherwise the phase closes on the stand-in and the adapter, with SC-301's sandbox run, MUST be recorded as a numbered task timed before Phase 6 (ADR 0007 D4, ADR 0010, R-API-4, SRS §10 "Payment gateway", OPEN-11; the owner's decision of 2026-10-31).
- **FR-372**: The stand-in MUST behave as a real gateway at the boundary: it sends each order's and each recipient's events to the server's webhook over HTTP, signed with a secret of its own configuration, so that they pass the same raw-body signature check and the same persistence a real gateway's would; the server MUST refuse an event with a wrong or missing signature, or a body changed after signing, before any handler runs (FR-PAYG-4, R-MONEY-9).
- **FR-373**: The stand-in MUST be able, on a test's command, to deliver an event twice, to deliver two events in the reverse of the order they happened, and to deliver an order's paid event after its hold has expired or been released; the server MUST then confirm at most once, never undo a confirmation on a late failure or expiry, and handle the late payment by FR-362 (FR-PAYG-4, FR-PAYG-5, FR-PAYG-19).
- **FR-374**: The stand-in MUST produce the event types `paid`, `failed`, `expired` and `recipient_verified` (and `recipient_rejected`, which Phase 1's payout flow already uses), each with a unique provider event id and the order or recipient reference it reports on, and a paid event with the fields it reports (transaction reference, gross, fee, net) (FR-PAYG-7, ERD `payment_events`).
- **FR-375**: A paid event for a second order of an enrollment already confirmed (the student paid twice) MUST be recorded, MUST leave the enrollment's status unchanged, and MUST open one compensation case on that enrollment through the same function as FR-362 (SRS FR-PAYG-19 as amended, FR-DISPUTE-5, FR-PAYG-10; the owner's decision of 2026-11-01).

**Processing and the app's honesty**

- **FR-380**: After the hosted checkout returns, the app MUST read the enrollment's status from the server and MUST render success only when the server reports it confirmed; it MUST never derive success from the gateway's return or any value the client holds (FR-PAYG-17, R-HONEST-1).
- **FR-381**: After the configured confirmation timeout with no confirmation, the app MUST release the student with the Confirming state on the enrollment; no notification row and no push is written in this phase, and the screens are the notice of a confirmation, a failure and a refused confirmation (FR-PAYG-5, FR-PAYG-18, FR-PAYG-19; the owner's decision of 2026-10-31, as Phase 1's FR-154).
- **FR-382**: The checkout screens MUST cover the drawn states: `SlotTaken`, `CheckoutExpired`, `CheckoutPrevious`, `Processing`, `ProcessingDelayed`, `PaymentSuccess`, `PaymentFailed` and `PaymentSlotUnavailable` (screens.md §5).
- **FR-383**: While an enrollment the student is shown is awaiting payment or in the Confirming state, the app MUST read its status again when the student returns from the hosted checkout and whenever the app comes back to the foreground; on Processing it MUST read every 2 seconds until the confirmation timeout (default 15 seconds); after release with the Confirming state, the screen that shows the enrollment MUST read it every 30 seconds for at most 10 minutes from the release, and then stop. The three numbers are settings, read by the app from the public configuration, with these defaults (FR-PAYG-17, FR-PAYG-18, §3.14).
- **FR-384**: When that bounded schedule ends with the enrollment still unconfirmed, the app MUST say plainly that the gateway has not yet reported the payment, that a payment made will be confirmed when the gateway reports it and will appear on this screen, and give the order reference, the support address and an action to check again; it MUST NOT say the payment failed unless the server reports the order failed or the enrollment cancelled (FR-PAYG-17, R-HONEST-1, ADR 0021 D4).
- **FR-386**: The booking sheet and the checkout screen MUST show the first and last session dates the student would get if confirmed at that moment, computed by FR-368's rule; the dates of the confirmed enrollment are computed from the confirmation instant, and where its first session differs from the one the student was shown, the success screen MUST say plainly that the first session moved and give the new date (FR-BOOK-2, FR-PAYG-17; the owner's decision of 2026-10-31).
- **FR-385**: Every outcome a later notification needs MUST be kept as a durable, append-only record naming its enrollment, its kind and its instant: the enrollment confirmed; its order failed; its hold expired and the enrollment cancelled, with each reason of FR-363; a paid event refused under FR-362. The gateway's own events stay in `payment_events`; the plan chooses where the outcomes are kept, and Phase 4's notifications MUST be able to read them with no change to this phase's code (FR-PAYG-5, FR-PAYG-19, FR-NOTIF-1; the owner's decision of 2026-10-31).

**Enrollment lists**

- **FR-390**: The student MUST see their enrollments, active and ended, ordered by next session (the owner's decision of 2026-10-31), each with upcoming, completed and remaining sessions, and an enrollment's detail with its sessions; the home MUST show the next session (FR-BOOK-7; the order and the home's next session, the owner's decision of 2026-10-31).
- **FR-391**: The teacher MUST see «طلابي», active and ended, searchable by the student's name in both tabs, each enrollment's detail with its sessions, and «اليوم» with the day's sessions (FR-BOOK-7, ADR 0021 D6, `TeacherStudents`, `TeacherEnrollment`, `TeacherHome`).
- **FR-392**: Sessions remaining and completed MUST be derived, never stored (R-DB-4).
- **FR-393**: Every session time MUST be shown in the teacher's zone and the viewer's zone (ADR 0009 D5).
- **FR-394**: An enrollment's slot MUST be offered again from the week after its final session plus the configured release buffer (FR-BOOK-10).
- **FR-395**: What a student and a teacher see of each other MUST be limited to what their screens draw; the student's date of birth, minor flag, documents and gender-dispute history MUST never reach the teacher (R-HONEST-4).

**Admin payments monitor**

- **FR-400**: The admin MUST have a read-only list of gateway orders with reference, date, student, gross, fee, net as reported, and status, newest first, searchable by order reference or student name, filterable by status, paged by the configured size, and an order's detail with its amounts, references, enrollment and event history in plain language (FR-PAYG-11, FR-ADMIN-18, `AdminPayments`).
- **FR-401**: No procedure of the monitor MAY write; no admin path of this phase MAY move, hold, refund or confirm money or an enrollment (FR-PAYG-11, FR-PAYG-8, R-MONEY-6).
- **FR-402**: The monitor MUST be reachable only by an administrator signed in with the second factor, as every admin page of Phase 1 (NFR-SEC-6, FR-ADMIN-1).

**Proofs and confinement**

- **FR-410**: The adversarial gender suite MUST gain cases for every student-facing procedure of this phase that returns teacher data or acts on a teacher's slot — browse, search, counts, filters, profile, packages, slots, hold, checkout — by direct call, forged and guessed ids, a tampered token and client-supplied gender, in both directions, plus the T143 standing cases, and MUST stay blocking on every commit (NFR-COMP-1, R-GENDER-1/2/3, T143).
- **FR-411**: No code outside `packages/money` MAY do arithmetic on piasters; no wallet, ledger, escrow, balance or platform-held-funds concept MAY exist; money amounts MUST appear only in `payments` and in the snapshot price of `enrollments` (R-MONEY-5, R-MONEY-6, FR-PAYG-1, FR-PAYG-10).
- **FR-412**: Every operational number of this phase (checkout time, hold grace, confirmation timeout, release buffer, rate limits, page size) MUST be read from settings (R-MONEY-12, §3.14).
- **FR-413**: Every procedure of this phase MUST declare its output schema, and every new procedure and field MUST pass the contract gate (R-HONEST-4, R-API-9).
- **FR-414**: Every Arabic string of this phase that holds values MUST follow T123's rule for right-to-left marks (T123).

### Key Entities _(include if feature involves data)_

All exist in `docs/ERD.md`; this phase writes them for the first time, and the
plan names any column or check it adds (T140).

- **Subject** (`subjects`): a teachable subject with an Arabic and an English name; seeded.
- **Teacher subject** (`teacher_subjects`): a subject granted to a teacher by an approved credential.
- **Package** (`packages`): what a teacher sells — subject, track, session count, session length, price in piasters, active or not.
- **Availability slot** (`availability_slots`): a weekly local time and length in the teacher's zone, active or not.
- **Slot hold** (`slot_holds`): a student's reservation of a slot during checkout, with its expiry and its release.
- **Enrollment** (`enrollments`): one student's purchase of one package at one slot, with the snapshot of its terms, its status, its confirmation instant and its cancellation reason.
- **Session** (`sessions`): one weekly occurrence of an enrollment, with its local date, local start and zone as the fact and its UTC instants as a cache.
- **Payment** (`payments`): one gateway order and what the gateway reported of it.
- **Payment event** (`payment_events`): one signed inbound event, append-only.
- **Compensation case** (`disputes`, kind `compensation_case`): opened by FR-362; decided in Phase 3.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-301**: A student finds a teacher, holds a slot, pays on the gateway's sandbox, and the signed event confirms the enrollment and generates every session with no human step; the owner completes it end to end on the phone (PLAN.md definition of done). If the gateway's written answers have not arrived before the phase's last batch, the sandbox run is FR-371's numbered task, and in this phase the owner completes the same journey on the phone against the stand-in.
- **SC-302**: Against the stand-in gateway with no provider credential, every scenario of User Story 3 passes in CI, every event reaching the server through the signed webhook over HTTP, never through a shortcut into the service.
- **SC-303**: Sessions generated across Cairo's spring and autumn daylight-saving changes in 2027 all sit at the slot's local time, and property tests over every IANA zone the city list offers find no generation that differs from `packages/time`'s declared resolution (PLAN.md definition of done).
- **SC-304**: The adversarial gender suite passes in CI on every commit, covers every student-facing procedure of this phase in both directions, and a forbidden profile answers 404, never 403 (PLAN.md definition of done).
- **SC-305**: A replayed paid event, run 100 times, leaves exactly one confirmed enrollment, one converted hold and one set of sessions.
- **SC-306**: Two hundred concurrent hold attempts on one slot leave exactly one active hold, and two hundred on one student's two slots leave exactly one.
- **SC-307**: `confirmed_at` has exactly one write path, proved by a CI test; no proof-upload, manual-paid or admin-confirm endpoint exists (PLAN.md definition of done).
- **SC-308**: No code outside `packages/money` does piaster arithmetic, and no wallet, ledger, escrow or balance exists, proved by the lint and schema gates (PLAN.md definition of done).
- **SC-309**: A student sees the success screen within the configured confirmation timeout in at least 95% of sandbox purchases, and never before the server reports the enrollment confirmed.
- **SC-310**: Discovery's first page of results appears within two seconds on the owner's phone on a 4G connection, with counts that match the visible teachers exactly.
- **SC-311**: In CI, an event with a wrong signature, a missing signature or a body changed after signing is refused in 100% of attempts with nothing written; a paid event delivered twice, events delivered out of order, and a paid event delivered after its hold expired each leave exactly the outcome FR-373 states.
- **SC-312**: A student released with the Confirming state sees the enrollment confirmed within 30 seconds of the server confirming it while the screen is open, or at once on returning to the app; after 10 minutes unconfirmed the screen shows FR-384's message and stops reading.
- **SC-313**: For every confirmation, failure, expiry and refused confirmation the suite produces, FR-385's record exists naming its enrollment, kind and instant.
- **SC-314**: A test seeds teachers in every excluded state (other gender, unapproved, payout unverified, deleted, suspended, banned) whose names share a prefix with visible teachers, and for every spelling variant FR-333 normalises, the search returns every visible match and no excluded teacher, in both directions.

## Assumptions

- The cycle runs on 2026-10-31, a weekend day, and is not counted; implementation starts on day 12, 2026-11-01 (PLAN.md).
- The seeded subjects are the catalogue in this phase; an admin page to add subjects is not drawn and is not added (ADR 0021 D1 governs its validation when it comes).
- Drafting before payout verification needs no published flag: a package or slot is visible exactly when it is active and its teacher passes the predicate, so verification publishes everything at once (FR-PROFILE-10, FR-PAYG-15).
- No credential's riwaya, tariq or chain is shown to a student in this phase; they are shown with FR-ISNAD-5 in Phase 4 (the owner's decision of 2026-10-31).
- Reviews do not exist before Phase 4: the profile shows the no-reviews line and the rating filter's buckets other than "all" return no teacher until then.
- Session reminders (FR-BOOK-8) are scheduled by Phase 4's notification jobs, which also reschedule them on re-resolution (PLAN.md, Phase 4); this phase generates no reminder.
- The report sheet on a profile, the cancellation, make-up, dispute and review controls on the enrollment screens, and the admin's `/enrollments` page belong to Phases 3 and 4; their entries are absent here, and the monitor's link to a cancelled enrollment appears with that page.
- A teacher's suspension and an admin cancellation cancel sessions in Phase 3 (FR-SESS-16, FR-CANCEL-6), and a gender correction in Phase 4 (FR-GENDER-6/7, the owner's decision of 2026-11-05); this phase only keeps such teachers out of new holds (FR-303).
- The first-session lead is a new setting (default 24 hours) beside the others of §3.14; the plan adds its row.
- The gateway's answers to OPEN-11's points bound the real adapter (order expiry, cancellation, zero-price orders), not the stand-in or the rules above; where the gateway cannot do what FR-BOOK-12 asks, FR-BOOK-12 (c) applies. The stand-in is configured to the behaviour the rules above assume until those answers say otherwise.
- Saif's review session reviews every batch under the review rules in force; the owner runs SC-301 on the Android phone, as Phase 1 was proved on one device (PLAN.md, Phase 1).
