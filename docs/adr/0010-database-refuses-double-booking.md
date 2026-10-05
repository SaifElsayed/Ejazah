# ADR 0010 — The database refuses double booking, and a slot hold outlives the gateway order

**Status:** accepted · **Date:** 2026-10-05 · **Amends:** SRS FR-BOOK-5, FR-BOOK-9, FR-PAYG-6, FR-PAYG-18, FR-DISPUTE-5, FR-REVIEW-1, FR-SESS-16, FR-GENDER-6, FR-GENDER-7, FR-NOSHOW-4, §3.14, §6.2, UC-2 and OPEN-11 (adds FR-BOOK-12 and FR-PAYG-19), ERD `slot_holds`, `enrollments`, `sessions`, §13.2, §14 and §15, [Architecture](../ARCHITECTURE.md) header, §3.4, §3.5 and §8.1, [ADR 0007](0007-direct-gateway-checkout.md) D4 (the hold timing and the payment port's operations), constitution R-DB-4 (v2.3.1), Phase 0 spec FR-033 and SC-014, data-model, quickstart, research R-6, the port contract, the screen inventory, the cache lists of the three agent definitions, and tasks T057, T066, T070 and T117 (adds T141 and T142)

## Context

Double booking is prevented only in service code today. The service reads "is
the slot free", then writes the hold. Two concurrent requests can both read
"free" and both write. PostgreSQL runs at Read Committed by default, and at that
level a serialization anomaly is possible: two transactions that each check a
condition and then insert can both commit, though no order of running them one
after the other would allow it (write skew). A booking is the standard case; the
PostgreSQL manual's own exclusion-constraint example is a room reservation.

ERD §15 lists sixteen rules the database itself holds. Neither FR-BOOK-5 (no
overlapping sessions for a teacher, or for a student) nor FR-BOOK-9 (a held slot
is unavailable to other students) is among them. `slot_holds` has only a plain
partial index, which speeds up the check and enforces nothing.

A second gap sits in the checkout timing. FR-PAYG-6 makes the gateway order
expire at the same moment as the slot hold. A payment started in the last
seconds of the hold can take minutes to finish, because 3-D Secure sends the
student to their bank. The gateway can then report it paid after the hold was
released and another student has taken the slot. No document says what happens
then.

Both were found while planning the follow-up agreed after PR #30. The review of
PR #32 found five more gaps around the same design, all closed below: the
re-resolution job of ADR 0009 against the exclusion constraints (D1), a late
payment racing a new hold (D3, D5), a failed event that released the hold Retry
needs (D4), a student's earlier order staying payable after a new checkout
(D6), and enrollment states no document defined (D7).

## What the rest of the industry does

| Source | What it says |
| --- | --- |
| PostgreSQL, _Transaction Isolation_ | Read Committed is the default level, and at that level a serialization anomaly is listed as possible. At Serializable, applications "must be prepared to retry transactions due to serialization failures". |
| PostgreSQL, _Range Types_, §Constraints on Ranges | An exclusion constraint `EXCLUDE USING GIST (room WITH =, during WITH &&)` rejects overlapping ranges for the same room. Combining a plain column with a range needs the `btree_gist` extension. |
| PostgreSQL, _btree_gist_ | Provides GiST operator classes for scalar types, `uuid` and all `enum` types among them. The module is "trusted", so a non-superuser with `CREATE` on the database can install it. |
| PostgreSQL, _SET CONSTRAINTS_ | A constraint declared `DEFERRABLE` can be switched to `DEFERRED` inside one transaction, and is then checked at commit instead of as each statement runs. Exclusion constraints can be declared deferrable. |
| Franck Pachot, _PostgreSQL EXCLUDE constraints for better concurrency than serializable_ (2025) | On a seat-booking test, an exclusion constraint at Read Committed lets non-conflicting inserts proceed in parallel without waiting or aborting. Serializable also blocks or aborts transactions that read the same range without truly conflicting. |
| Stripe, _Manage limited inventory_ | A Checkout Session can be given `expires_at`, which must be between 30 minutes and 24 hours ahead. On expiry its status becomes `expired` and Stripe sends `checkout.session.expired`, on which the merchant returns the reserved items to inventory. |
| Stripe, _Expire a Checkout Session_ (API reference) | A Checkout Session in status `open` can be expired by the merchant. After it expires, the customer can no longer complete it. |
| Paymob, _Create Intention_ | Lists an `expiration` body parameter, a number, with no description of its unit or of what happens after it. Whether an expired intention can still be paid, and whether an event is sent, is not documented. The review of PR #32 found no documented operation that cancels an unpaid intention. |
| Prisma ORM, _Transactions_ | In Prisma 8 "there are no `isolationLevel`, `timeout`, or `maxWait` options"; every transaction runs at the database default, Read Committed on PostgreSQL. The project is on Prisma 7.10. |
| prisma/orm#30531 (open) | Neither the ORM client nor the typed SQL builder can add a row-locking clause (`FOR UPDATE` and the others) to a select; the workaround is raw SQL. |

So the inventory pattern is the one Stripe documents: the reservation is
returned when the payment provider says the order expired, and the merchant can
expire an unpaid order itself. The two sources on PostgreSQL agree that the
database, not a read-then-write in code, is what holds "no overlap" under
concurrency.

## Scenarios

Each scenario is walked under the decisions below.

1. **Two students press pay on the same slot at the same moment.** Each request
   opens a transaction, releases any expired hold on the slot (D3), and inserts
   its hold. The partial unique index on `slot_holds (slot_id)` (D1) makes the
   second insert wait for the first. When the first commits, the second fails
   with a unique violation. Exactly one hold exists and one gateway order is
   created. The other student is told the slot was just taken and is offered
   another (UC-2).
2. **Student A is on the gateway page; student B opens the same slot.** A's hold
   is active, so the service shows B the slot as unavailable (FR-BOOK-9). If B's
   request slipped past that check, the same index refuses B's hold. A's hold
   lasts the checkout TTL plus the grace (D4), so it outlives A's gateway order
   whenever the gateway honours the expiry the platform set. If A's payment
   fails, A's hold stays: A may Retry on it, and B still sees the slot
   unavailable until the hold ends (D4).
3. **A's hold lapses while A is still paying, B takes the slot, then A's payment
   succeeds.** Under D4 this needs a payment confirmed more than the grace after
   A's order expired. That can happen only if the gateway accepts payment after
   its own expiry, or could not be given an expiry that short (Stripe's minimum
   is 30 minutes). The paid event is recorded as always (FR-PAYG-4, FR-PAYG-7).
   `confirm-enrollment`'s conditional conversion of A's hold matches no row,
   because the hold is released, so the same transaction takes the late branch
   (D5): it inserts a new hold for A's enrollment on the slot; the per-slot
   index refuses it while B holds the slot, and once B is confirmed the
   teacher's exclusion constraint refuses A's sessions instead. Nothing of that
   transaction is kept. In a new one, A's enrollment is cancelled with
   `slot_unavailable` and a compensation case is opened for A (D5). B's booking
   is untouched whichever of the two commits first, because B's hold placement
   inserts before it checks sessions (D3): it either waits on A's new hold and
   then, once A's transaction commits, sees A's sessions in the check that
   follows the insert, or comes after that commit and sees them in the same
   check. Had the slot and both parties' times still been free, A's enrollment
   would have been confirmed as usual.
4. **The same student double-submits, or uses two tabs on the same slot.**
   Already held: a repeated mutation with the same idempotency key returns the
   first outcome and repeats no effect (ADR 0008 D2). A second request with a
   different key is a new checkout by the same student, so D6 ends the first
   checkout before the second hold is placed: at once if no order on the first
   hold is still payable (`created`), otherwise only after the gateway confirms
   it cancelled that order. If the gateway reports that order paid or its
   payment still in progress, nothing is written, the second checkout is
   refused, and the student is told the earlier payment went through or is
   still being processed and is taken to that enrollment's Processing screen.
   If the gateway cannot cancel an order, the second checkout is refused and
   the student is offered to continue the first payment, with the time left on
   it. An order whose creation was still in flight when the second checkout
   released the first hold is never handed to the student, because an order is
   recorded, and its checkout returned, only while its hold is still active
   (D6). So the two checkouts never each have an order the student can pay; the
   one path to a second charge left is a payment completed after its hold
   expired (scenario 5).
5. **The same student, two tabs, two teachers, overlapping times.** Before this
   ADR, nothing stopped both holds, both payments and two overlapping sets of
   sessions; the reservation check sees confirmed sessions, not other holds.
   Now the second checkout goes through D6 exactly as in scenario 4, so the
   first order is cancelled, found paid or still in progress, or left to
   finish before a second order can exist. If the second checkout starts after
   the first has converted, the check after the hold's insert sees the first
   enrollment's sessions and abandons the hold (D3). One path to a second charge remains: an
   order paid after its hold expired (D4) while the student is already in the
   second checkout. That late payment cannot take a hold, because the
   per-student index refuses it, so its enrollment takes D5's refusal branch
   and a compensation case is opened; the second checkout is not disturbed.
6. **A replayed webhook or a double run of `confirm-enrollment`.** Already held:
   the provider event id is unique and NOT NULL (ERD §15.13), and the job is a
   no-op for a confirmed enrollment (R-API-14). The refusal branch is a no-op
   when a compensation case for the enrollment already exists (D5), so a rerun
   opens no second case. The exclusion constraints add a backstop: even a
   faulty second generation could not write overlapping sessions.

## Decisions

### D1 — The database guards against double booking

`slot_holds` gets a partial unique index on `(slot_id) WHERE released_at IS
NULL`: at most one active hold per slot.

`sessions` gets two exclusion constraints over
`tstzrange(scheduled_start_at, scheduled_end_at)` with `&&`, one paired with
`teacher_user_id WITH =` and one with `student_user_id WITH =`, using the
`btree_gist` extension. Both are partial:
`WHERE (deleted_at IS NULL AND status NOT IN ('cancelled_by_agreement',
'cancelled_by_admin'))`. Every other status occupies its time, including `done`,
the three no-show statuses, `under_threshold`, `provider_outage` and `disputed`.
A `tstzrange` built this way includes its start and excludes its end, so two
back-to-back sessions do not overlap.

Both constraints are `DEFERRABLE INITIALLY IMMEDIATE`. Every ordinary
transaction has them checked as it writes. Only a transaction that runs
`SET CONSTRAINTS … DEFERRED` has them checked at commit instead, and only the
re-resolution job of ADR 0009 does so (see "What the database does not hold").

Illustrative SQL (the migrations of T066 and T141 are authoritative):

```sql
CREATE UNIQUE INDEX ON slot_holds (slot_id) WHERE released_at IS NULL;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE sessions ADD CONSTRAINT sessions_teacher_no_overlap EXCLUDE USING gist (
  teacher_user_id WITH =,
  tstzrange(scheduled_start_at, scheduled_end_at) WITH &&
) WHERE (deleted_at IS NULL AND status NOT IN ('cancelled_by_agreement', 'cancelled_by_admin'))
  DEFERRABLE INITIALLY IMMEDIATE;
-- and the same with student_user_id, as sessions_student_no_overlap
```

None of these can be written in the schema language, so they are raw SQL in a
migration, as the partial unique indexes on `users` already are (research R-6).

### D2 — The columns the guards read

A constraint cannot span tables, and `sessions` carries only `enrollment_id`.
`sessions` gains `teacher_user_id` and `student_user_id`, foreign keys to
`users`, copied from the enrollment when sessions are generated and never
changed afterwards. They are derived values, so R-DB-4 allows them only as
declared caches. This ADR declares them (constitution 2.3.1, PATCH, as 2.1.2
did for ADR 0009).

`slot_holds` gains `enrollment_id`, a nullable foreign key to `enrollments`. The
hold is placed when the student enters checkout, before any enrollment exists;
the enrollment is created when the student presses Pay (FR-PAYG-2), and the same
transaction sets the hold's `enrollment_id`. Conversion, release, the late
branch of D5 and the new checkout of D6 find the hold through it, so a late
payment for one enrollment can never convert a hold placed for another, even
when the same student holds the same slot again. It is a link, not a derived
value, so R-DB-4 does not apply.

### D3 — A hold is written first, then checked

An index predicate cannot use the current time, so an expired hold still blocks
its slot, and the student's next checkout, until `released_at` is set. In one
transaction, the service that places a hold:

1. releases the expired holds on that slot and the student's own expired hold,
   if any, cancelling their enrollments as D7 says;
2. ends the student's own unexpired hold, if there is one and D6 lets it end in
   this transaction;
3. inserts the new hold, through the two partial unique indexes;
4. checks the student's and the teacher's existing sessions against the slot,
   and abandons the hold, rolling the transaction back, on an overlap.

The order of 3 and 4 is what makes the check sound. A check made before the
insert can pass while another transaction is still writing sessions for the
same slot, as D5's late branch does. Inserted first, the hold either waits on
that transaction's hold and then, once it commits, sees its sessions in the
check that follows the insert, or comes after its commit and sees them in the
same check. The expiry jobs remain the sweep for everything else (D7). Two
requests releasing the same expired hold do not conflict: the second `UPDATE`
waits for the first and then matches no row, and the unique index decides which
insert wins.

### D4 — The hold outlives the gateway order, and a failure keeps it

The gateway order expires at the checkout TTL (the existing setting, default 10
minutes). The slot hold expires at that TTL plus a new Admin-configurable grace
(default 5 minutes). Both are measured from when the hold is placed. Every order
created on the hold, a Retry included, is asked to expire no later than the
hold's expiry minus the grace, where the gateway lets the platform set an
expiry. The payment port's create operation takes that moment as its
`latestExpiry` argument, since a Retry's deadline belongs to its hold
(Architecture §3.4).

A failed event marks that order failed and leaves the hold in place, so the
student may Retry on it (FR-PAYG-18) or choose another slot (D6). A cancellation
reported by the gateway is treated as a failure: the adapter reports it as a
`failed` event, and `payment_events.event_type` gains no member. An
order-expired event does not release the hold early either; the grace is there
for a gateway that accepts a payment after its own expiry.

A hold is released only by its conversion (D5), by its expiry, by the student's
own new checkout (D6), or by D5's refusal branch. When it is released without
conversion, its enrollment is cancelled in the same transaction (D7).

This rewrites FR-PAYG-6, under which the order used to lapse together with the
hold. FR-BOOK-9 states the grace, and FR-PAYG-18 offers Retry on the same hold
for as long as an order can still be created on it, that is until the hold's
expiry minus the grace.

### D5 — Confirmation writes through the guards; a refusal opens a compensation case

Every paid event is recorded and `confirm-enrollment` runs for it, whether or
not the enrollment's hold is still active. The job is a no-op for a confirmed
enrollment, and for an enrollment that already has a compensation case
(`disputes.kind = compensation_case`), so a replayed event or a second run opens
no second case.

The step decides between its two branches by writing, not by reading. In one
transaction it converts the enrollment's hold with a conditional update
(`released_at IS NULL`), and it confirms the enrollment only from
`pending_payment` or `cancelled`, also as a conditional update. An expiry job
that releases the hold at the same moment uses the same conditional form (D7),
so the two meet on the hold's row and exactly one of them changes it.

- **Hold active** (the conversion matches a row). The same transaction
  confirms the enrollment and generates its sessions (FR-PAYG-5).
- **Hold released** (a late payment; the conversion matches no row). The same
  transaction takes the late branch. It first releases the expired holds on the
  slot and the student's own expired hold, as D3 does, cancelling their
  enrollments as D7 says. It then inserts a new active hold for the enrollment
  on its slot, through the two partial unique indexes, confirms the enrollment,
  generates its sessions and converts that hold. The enrollment moves from
  `cancelled` to `confirmed` through the same single write path (R-HONEST-1),
  and its `cancellation_reason` returns to NULL, since that column records why a
  cancelled enrollment was cancelled.

If the database refuses that transaction, nothing of it is kept, and the
**refusal branch** runs in a new transaction. A refusal comes from the per-slot
index (another student holds the slot), from the per-student index (the student
meanwhile holds another slot; that other checkout is not disturbed), or from an
exclusion constraint (a session would overlap another of the same teacher or
student, D1). The refusal branch releases the enrollment's hold if it is still
active, sets the enrollment to `cancelled` with `cancellation_reason =
slot_unavailable`, opens a compensation case in the Admin moderation queue
through `moderation`'s public entry, and notifies the student. The platform
moves no money; reimbursement is decided by an Admin and executed outside the
code path (ADR 0007, FR-PAYG-10, FR-DISPUTE-5/6). FR-PAYG-19 states this, and
FR-DISPUTE-5 lists it as a trigger.

Confirmation, generation and conversion share one transaction, so a refused
generation leaves neither part of a package nor a confirmed enrollment without
sessions.

### D6 — One active hold per student, and a new checkout ends the old one

`slot_holds` gets a second partial unique index, on `(student_user_id) WHERE
released_at IS NULL`. A student is in at most one checkout at a time. This is a
new business rule, approved by the owner, and stated as FR-BOOK-12.

When a student whose hold has not expired starts a new checkout (the "Choose
another slot" action of the checkout screens, or a second tab), the old hold is
ended first. The transaction that places the new hold begins by releasing the
old hold, through a conditional update of its row (`released_at IS NULL`), and
only then reads the hold's orders, so it sees every order recorded before the
release:

1. **No order on it is still payable (`created`).** No order was created on it,
   or every order on it failed. The release stands, and the hold's enrollment,
   if any, is cancelled with `checkout_abandoned` in the same transaction, which
   goes on to place the new hold (D3).
2. **An order on it is still payable (`created`).** That transaction is rolled
   back, so the old hold stays active, and the platform asks the gateway,
   through the payment port, to cancel that order, given its gateway order id.
   The operation cancels an unpaid order and moves no money, so it stays within
   ADR 0007 and outside the port's prohibited balance, transfer and refund
   operations. It is called outside any transaction, so no transaction stays
   open across a call to the gateway. The gateway answers one of four ways:
   - `cancelled`: that order is recorded as failed, as a gateway cancellation
     is (D4), and case 1 follows. Cancelling an order that is already
     cancelled or expired also answers `cancelled`, so when two tabs both
     cancel the same order, both proceed, and the per-student index lets
     exactly one new hold commit.
   - `paid` or `in_progress` (a payment under way, such as 3-D Secure or an
     asynchronous method): nothing is written (R-HONEST-1). The new checkout
     is refused, and the student is told the earlier payment went through or
     is still being processed and is taken to that enrollment's Processing
     screen. The enrollment is confirmed only when the signed paid event is
     processed (D5).
   - `unsupported`: case 3.
3. **The gateway offers no cancellation.** The new checkout is refused with a
   clear message, an action to continue the previous payment, and the time left
   on it.

Pay and Retry create an order on a hold at the gateway, outside any
transaction. The order is recorded, and its hosted checkout handed to the
client, only in a transaction that finds the hold still active through a
conditional update of the hold row; otherwise the checkout is withheld and the
order cancelled where the gateway allows. An order is therefore either recorded
before a new checkout releases the hold, and case 1 or 2 sees it, or never
reaches the student.

An expired hold of the student's is no longer a checkout: D3 releases it
without asking the gateway, and a payment that still completes on it follows
D5. OPEN-11 gains the criterion that the gateway can cancel an unpaid order;
Stripe documents it for a Checkout Session, and case 3 is the fallback for a
gateway that does not.

### D7 — An enrollment follows its hold

Any release of a hold without conversion cancels the hold's enrollment, if it
has one, in the same transaction, whatever released it. The reason recorded is:

| Released by | `cancellation_reason` |
| --- | --- |
| Its expiry, through an expiry job or D3 | `payment_failed` if the enrollment's last order failed, else `payment_expired` |
| The student's new checkout (D6) | `checkout_abandoned` |
| D5's refusal branch | `slot_unavailable` |

`enrollments.cancellation_reason` gains the two members `slot_unavailable` (paid
but could not be honoured) and `checkout_abandoned` (released by the student's
own new checkout). Both are additive (R-API-9).

The two expiry jobs split the sweep by what a hold carries:

- `expire-pending-payments` (owned by `payments`) is keyed on the enrollment:
  every `pending_payment` enrollment whose hold's `expires_at` has passed,
  whether or not the hold was already released. Through `booking`'s public
  entry, in one transaction, it releases the hold with a conditional update
  (`released_at IS NULL`) and cancels the enrollment with the expiry reason
  above, only from `pending_payment`. Keyed this way, it also catches an
  enrollment whose hold was released without the enrollment following it.
  Racing `confirm-enrollment` (D5), whichever writes the hold's row first
  decides, and the other's conditional update matches no row.
- `expire-holds` (owned by `booking`) releases the expired active holds that
  carry no enrollment: the student entered checkout and never pressed Pay. Its
  conditional update also requires `enrollment_id IS NULL`, so a hold linked by
  a concurrent Pay is left to `expire-pending-payments`.

Both are idempotent (R-API-14): a second run finds nothing left to release or
cancel.

## What the database does not hold

- **A new hold against the student's confirmed sessions with another teacher.**
  The hold is on `slot_holds`; the sessions are on `sessions`. Comparing two
  tables is a service check at reservation, as FR-BOOK-5 already requires; D3
  makes it sound by inserting the hold before checking. Under D1 the worst
  outcome of a race there is a paid enrollment whose generation is refused by
  the constraint, which takes D5's refusal branch.
- **The re-resolution job of ADR 0009.** After a time zone rule change, the job
  recomputes the instants of every scheduled session. A uniform shift moves
  back-to-back sessions together, but checked as each row is written, one of
  them collides for a moment with the next one not yet moved. So the job
  recomputes every affected session inside one transaction and runs `SET
  CONSTRAINTS … DEFERRED` first (D1): a uniform shift commits, and only a true
  overlap is refused, at commit. One transaction for the whole run, not one for
  each teacher, because the student constraint links teachers: a student with
  teacher A at 09–10 and teacher B at 10–11, both moved +1h, would have A's
  sessions refused while B's are still unmoved. A refusal at commit names key
  values and ranges rather than session ids, and only the first conflict, so
  the job does not rely on it. Before committing, it queries the moved sessions
  for an overlap with another session of the same teacher or the same student
  that the constraints count (`start < other.end AND end > other.start`, which
  needs no raw SQL), restores those sessions to their previous instants,
  reports them to the error-tracking destination (Phase 0 spec FR-051) for an
  operator to resolve, and commits the rest. A commit still refused by a
  concurrent write reruns the run. Reminders are rescheduled from the new
  instants only after the commit, still in the same run (ADR 0009 D3), so a
  rolled-back run leaves the queue as it was. `SET CONSTRAINTS` is raw SQL, so
  under R-API-6 it lives behind a kernel helper in `apps/api/src/platform/db/`.
  No new queue is added.
- **A daylight-saving gap at generation.** A slot whose local start falls inside
  a spring-forward gap is moved forward by `packages/time` (ADR 0009), and the
  moved session can overlap the teacher's next slot: a 01:00 London slot shifted
  to 02:00–03:00 collides with the teacher's 02:00 slot. The exclusion
  constraint refuses the generation, so the whole package takes D5's refusal
  branch. It needs a gap on a date of the package and two adjacent slots, so it
  is rare.

## Alternatives rejected

- **Serializable isolation.** It aborts transactions that do not truly conflict
  and every caller must retry them (PostgreSQL manual; Pachot). Prisma 8 also
  removes the `isolationLevel` option, so it would need raw SQL as the first
  statement of each transaction, and the project would be building on an option
  its ORM is dropping.
- **`SELECT … FOR UPDATE`.** The ORM cannot express it (prisma/orm#30531), so it
  needs raw SQL, which R-API-6 confines to the platform kernel. It also cannot
  lock a row that does not exist yet: there is no row for "this student at
  Friday 09:00" when the student holds nothing, so the cross-teacher overlap of
  scenario 5 is not covered.
- **A Redis lock.** Architecture §2 and ADR 0005 D4 keep holds in Postgres, so
  that a cache flush can never release a slot a student is paying for. A lock
  in Redis would also be a second source of truth beside `slot_holds`.
- **Releasing the hold on a failed event.** Retry on the same hold
  (FR-PAYG-18) could then never run: the event that offers it would already
  have released the hold and cancelled the enrollment.
- **Releasing the old hold on a new checkout without touching its order.** The
  first order stays payable, so a student with two tabs could be charged twice,
  with only a compensation case to put it right (review of PR #32).

## Consequences

- SRS: FR-BOOK-5, FR-BOOK-9, FR-PAYG-6, FR-PAYG-18 and FR-DISPUTE-5 are
  rewritten; FR-BOOK-12 and FR-PAYG-19 are new; FR-REVIEW-1 notes that a
  cancelled enrollment may still be confirmed; FR-NOSHOW-4, FR-SESS-16 and
  FR-GENDER-6/7 name `cancelled_by_admin` for the sessions they cancel; §3.14
  gains the hold grace; §6.2 and UC-2 follow; OPEN-11 gains a sixth point on
  what a gateway order's expiry means and a seventh on cancelling an unpaid
  order. D4 works whatever the answer to the sixth; D6 case 3 covers a "no" to
  the seventh.
- ERD: `slot_holds` gains `enrollment_id`, `sessions` gains two columns,
  `enrollments.cancellation_reason` gains two members, §14 lists the two partial
  unique indexes and the two exclusion constraints, §15 gains rules 17 to 19.
  The table count stays 33.
- Constitution 2.3.1: R-DB-4 names the two new caches.
- The payment port gains one operation, cancelling an unpaid checkout given its
  gateway order id (Architecture §3.4, the port contract, T117). It moves no
  money. Creating a checkout also takes the latest moment the order may be paid
  (D4).
- Phase 0 builds the guarantee only. T057 models the three columns and the two
  enum members, T066 adds the two `slot_holds` indexes, T141 adds `btree_gist`
  and the deferrable exclusion constraints, T142 proves all of them as the
  application role, and T070's schema check allows the two new caches.
- The behaviour belongs to the booking and payments implementation tasks of
  later phases: the write-then-check placement of D3, the hold and order timing
  of D4, the confirmation and refusal branch of D5, the cancellation flow of D6,
  the enrollment states and expiry sweeps of D7, the deferred constraints, the
  overlap check before commit and the kernel helper of the re-resolution job,
  and turning a constraint refusal into a message for the student or into the
  refusal branch (R-API-8). No task is added for it in
  001-foundations.
- One point is left for the phase that builds D5, which must raise it rather
  than decide it at the keyboard (R-PROC-3): `notifications.type` has no member
  for the notice the student receives under D5's refusal branch.

## References

- PostgreSQL documentation, "Transaction Isolation" — https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL documentation, "Range Types", Constraints on Ranges — https://www.postgresql.org/docs/current/rangetypes.html
- PostgreSQL documentation, "btree_gist" — https://www.postgresql.org/docs/current/btree-gist.html
- PostgreSQL documentation, "SET CONSTRAINTS" — https://www.postgresql.org/docs/current/sql-set-constraints.html
- Franck Pachot, "PostgreSQL EXCLUDE constraints for better concurrency than serializable", 2025 — https://dev.to/franckpachot/postgresql-exclude-constraints-for-better-concurrency-than-serializable-pob
- Stripe, "Manage limited inventory" — https://docs.stripe.com/payments/checkout/managing-limited-inventory
- Stripe API reference, "Expire a Checkout Session" — https://docs.stripe.com/api/checkout/sessions/expire
- Paymob, "Create Intention" — https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention
- Prisma ORM, "Transactions" — https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- prisma/orm#30531, row-locking clauses in the ORM client and SQL builder — https://github.com/prisma/orm/issues/30531

## Documents changed

`docs/SRS.md`, `docs/ERD.md`, `docs/ARCHITECTURE.md`,
`docs/adr/0007-direct-gateway-checkout.md`, `docs/design/screens.md`,
`.specify/memory/constitution.md`,
`specs/001-foundations/{spec,data-model,quickstart,research,tasks}.md`,
`specs/001-foundations/contracts/ports.md`, and the cache lists of
`.claude/agents/{ijazah-feature-planner,ijazah-simplify-reviewer,senior-ijazah-implementer}.md`.
