# ADR 0010 — The database refuses double booking, and a slot hold outlives the gateway order

**Status:** accepted · **Date:** 2026-10-05 · **Amends:** SRS FR-BOOK-5, FR-BOOK-9, FR-PAYG-6, FR-PAYG-18, FR-DISPUTE-5, §3.14 and OPEN-11 (adds FR-BOOK-12 and FR-PAYG-19), ERD `slot_holds`, `sessions`, §14 and §15, [Architecture §8.1](../ARCHITECTURE.md), the hold timing in [ADR 0007](0007-direct-gateway-checkout.md) D4, constitution R-DB-4 (v2.3.1), Phase 0 spec FR-033 and SC-014, data-model, quickstart, and tasks T057, T066 and T070 (adds T141 and T142)

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

Both were found while planning the follow-up agreed after PR #30.

## What the rest of the industry does

| Source | What it says |
| --- | --- |
| PostgreSQL, _Transaction Isolation_ | Read Committed is the default level, and at that level a serialization anomaly is listed as possible. At Serializable, applications "must be prepared to retry transactions due to serialization failures". |
| PostgreSQL, _Range Types_, §Constraints on Ranges | An exclusion constraint `EXCLUDE USING GIST (room WITH =, during WITH &&)` rejects overlapping ranges for the same room. Combining a plain column with a range needs the `btree_gist` extension. |
| PostgreSQL, _btree_gist_ | Provides GiST operator classes for scalar types, `uuid` and all `enum` types among them. The module is "trusted", so a non-superuser with `CREATE` on the database can install it. |
| Franck Pachot, _PostgreSQL EXCLUDE constraints for better concurrency than serializable_ (2025) | On a seat-booking test, an exclusion constraint at Read Committed lets non-conflicting inserts proceed in parallel without waiting or aborting. Serializable also blocks or aborts transactions that read the same range without truly conflicting. |
| Stripe, _Manage limited inventory_ | A Checkout Session can be given `expires_at`, which must be between 30 minutes and 24 hours ahead. On expiry its status becomes `expired` and Stripe sends `checkout.session.expired`, on which the merchant returns the reserved items to inventory. |
| Paymob, _Create Intention_ | Lists an `expiration` body parameter, a number, with no description of its unit or of what happens after it. Whether an expired intention can still be paid, and whether an event is sent, is not documented. |
| Prisma ORM, _Transactions_ | In Prisma 8 "there are no `isolationLevel`, `timeout`, or `maxWait` options"; every transaction runs at the database default, Read Committed on PostgreSQL. The project is on Prisma 7.10. |
| prisma/orm#30531 (open) | Neither the ORM client nor the typed SQL builder can add a row-locking clause (`FOR UPDATE` and the others) to a select; the workaround is raw SQL. |

So the inventory pattern is the one Stripe documents: the reservation is
returned when the payment provider says the order expired. The two sources on
PostgreSQL agree that the database, not a read-then-write in code, is what holds
"no overlap" under concurrency.

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
   whenever the gateway honours the expiry the platform set.
3. **A's hold lapses while A is still paying, B takes the slot, then A's payment
   succeeds.** Under D4 this needs a payment confirmed more than the grace after
   A's order expired. That can happen only if the gateway accepts payment after
   its own expiry, or could not be given an expiry that short (Stripe's minimum
   is 30 minutes). The paid event is recorded as always (FR-PAYG-4, FR-PAYG-7).
   `confirm-enrollment` finds A's hold released and the slot taken, so it
   generates no session, leaves A's enrollment cancelled, and opens a
   compensation case for A (D5). B's booking is untouched. Had the slot and both
   parties' times still been free, A's enrollment would have been confirmed as
   usual.
4. **The same student double-submits, or uses two tabs on the same slot.**
   Already held: a repeated mutation with the same idempotency key returns the
   first outcome and repeats no effect (ADR 0008 D2). A second request with a
   different key is refused by both partial unique indexes on `slot_holds`
   (D1, D6).
5. **The same student, two tabs, two teachers, overlapping times.** Before this
   ADR, nothing stopped both holds, both payments and two overlapping sets of
   sessions; the reservation check sees confirmed sessions, not other holds.
   Now the second hold is refused, because a student is in at most one checkout
   at a time (D6). If the second checkout starts just after the first one
   converts, the service check at reservation sees the first enrollment's
   sessions and refuses. If it starts in the gap before those sessions commit,
   the second payment can succeed and its generation is refused by the
   student's exclusion constraint (D1), which leads to D5.
6. **A replayed webhook or a double run of `confirm-enrollment`.** Already held:
   the provider event id is unique and NOT NULL (ERD §15.13), and the job is a
   no-op for a confirmed enrollment (R-API-14). The exclusion constraints add a
   backstop: even a faulty second generation could not write overlapping
   sessions.

## Decisions

### D1 — The database guards against double booking

`slot_holds` gets a partial unique index on `(slot_id) WHERE released_at IS
NULL`: at most one active hold per slot.

`sessions` gets two exclusion constraints over
`tstzrange(scheduled_start_at, scheduled_end_at)` with `&&`, one paired with
`teacher_user_id WITH =` and one with `student_user_id WITH =`, using the
`btree_gist` extension. Both are partial:
`WHERE deleted_at IS NULL AND status NOT IN ('cancelled_by_agreement',
'cancelled_by_admin')`. Every other status occupies its time, including `done`,
the three no-show statuses, `under_threshold`, `provider_outage` and `disputed`.
A `tstzrange` built this way includes its start and excludes its end, so two
back-to-back sessions do not overlap.

Illustrative SQL (the migrations of T066 and T141 are authoritative):

```sql
CREATE UNIQUE INDEX ON slot_holds (slot_id) WHERE released_at IS NULL;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE sessions ADD EXCLUDE USING gist (
  teacher_user_id WITH =,
  tstzrange(scheduled_start_at, scheduled_end_at) WITH &&
) WHERE (deleted_at IS NULL AND status NOT IN ('cancelled_by_agreement', 'cancelled_by_admin'));
-- and the same with student_user_id
```

None of these can be written in the schema language, so they are raw SQL in a
migration, as the partial unique indexes on `users` already are (research R-6).

### D2 — `sessions.teacher_user_id` and `sessions.student_user_id`

A constraint cannot span tables, and `sessions` carries only `enrollment_id`.
`sessions` gains both columns, foreign keys to `users`, copied from the
enrollment when sessions are generated and never changed afterwards. They are
derived values, so R-DB-4 allows them only as declared caches. This ADR declares
them (constitution 2.3.1, PATCH, as 2.1.2 did for ADR 0009).

### D3 — An expired hold is released before a new hold is placed

An index predicate cannot use the current time, so an expired hold still blocks
its slot until `released_at` is set. In the same transaction that creates a
hold, the service first releases the expired holds on that slot and the
student's own active hold, if any (D6), then inserts. The expiry job remains the sweep for
everything else. Two requests releasing the same expired hold do not conflict:
the second `UPDATE` waits for the first and then matches no row, and the unique
index decides which insert wins.

### D4 — The hold outlives the gateway order

The gateway order expires at the checkout TTL (the existing setting, default 10
minutes). The slot hold expires at that TTL plus a new Admin-configurable grace
(default 5 minutes). Both are measured from when the hold is placed. Every order
created on the hold, a Retry included, is asked to expire no later than the
hold's expiry minus the grace, where the gateway lets the platform set an
expiry. Before the hold expires it is released only by a failed or cancelled
event from the gateway. An order-expired event does not release it early;
the grace is there for a gateway that accepts a payment after its own expiry.
When the hold expires with no paid event, `expire-pending-payments` releases it
and cancels the enrollment (`cancellation_reason = payment_expired`).

This rewrites FR-PAYG-6's "expires with the hold". FR-BOOK-9 states the grace,
and FR-PAYG-18 offers Retry on the same hold while the hold is alive.

### D5 — A paid event after the hold was released

The event is recorded and `confirm-enrollment` runs as for any paid event. If
the slot is still free and neither the teacher nor the student has an
overlapping session, the enrollment is confirmed as FR-PAYG-5 says, without
re-acquiring a hold: in one transaction the step checks that no other student
holds the slot, confirms the enrollment and generates the sessions, which the
exclusion constraints guard (D1). Not taking a new hold keeps D6 out of the
way when the student has meanwhile started another checkout. The enrollment moves
from `cancelled` to `confirmed` through the same single write path (R-HONEST-1).
Its `cancellation_reason` returns to NULL, since that column records why a
cancelled enrollment was cancelled.

Otherwise no session is generated, the enrollment stays cancelled, a
compensation case (`disputes.kind = compensation_case`) is opened automatically
in the Admin moderation queue through `moderation`'s public entry, and the
student is notified. The platform moves no money; reimbursement is decided by
an Admin and executed outside the code path (ADR 0007, FR-PAYG-10,
FR-DISPUTE-5/6). FR-PAYG-19 states this, and FR-DISPUTE-5 lists it as a trigger.
The same branch applies when session generation is refused by an exclusion
constraint (D1).

### D6 — One active hold per student

`slot_holds` gets a second partial unique index, on `(student_user_id) WHERE
released_at IS NULL`. A student is in at most one checkout at a time. This is a
new business rule, approved by the owner, and stated as FR-BOOK-12. A new
checkout by the same student first releases that student's own active hold in
the same transaction: the student has chosen another slot, the "Choose another
slot" action of the checkout screens. A payment that still completes on the
released hold follows D5.

## What the database does not hold

- **A new hold against the student's confirmed sessions with another teacher.**
  The hold is on `slot_holds`; the sessions are on `sessions`. Comparing two
  tables is a service check at reservation, as FR-BOOK-5 already requires. Under
  D1 the worst outcome of a race there is a paid enrollment whose generation is
  refused by the constraint, which takes the D5 branch. Session generation runs
  in one transaction, so a refused constraint generates nothing, not part of a
  package. For the enrollment to take the D5 branch rather than sit confirmed
  with no sessions, its confirmation commits in that same transaction.
- **The re-resolution job of ADR 0009.** After a time zone rule change, a
  recomputed session can in principle overlap another one and be refused by a
  constraint. That is routed to the Admin queue; it needs a real rule change
  landing on two adjacent sessions, so it is rare.

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

## Consequences

- SRS: FR-BOOK-5, FR-BOOK-9, FR-PAYG-6, FR-PAYG-18 and FR-DISPUTE-5 are
  rewritten; FR-BOOK-12 and FR-PAYG-19 are new; §3.14 gains the hold grace;
  OPEN-11 gains a sixth point on what a gateway order's expiry means. D4 works
  whatever the answer.
- ERD: `sessions` gains two columns, §14 lists the two partial unique indexes
  and the two exclusion constraints, §15 gains rules 17 to 19. The table count
  stays 33.
- Constitution 2.3.1: R-DB-4 names the two new caches.
- Phase 0 builds the guarantee only. T057 models the two columns, T066 adds the
  two `slot_holds` indexes, T141 adds `btree_gist` and the exclusion
  constraints, T142 proves all of them as the application role, and T070's
  schema check allows the two new caches.
- The behaviour belongs to the booking and payments implementation tasks of
  later phases: the lazy release of D3, the hold and order timing of D4, the
  late-payment branch of D5, and turning a constraint refusal into a message for
  the student or into the D5 branch (R-API-8). No task is added for it in
  001-foundations.
- A student who leaves the gateway page without the gateway reporting a failure
  can start another checkout at once: the new hold releases the old one (D6).
  Retry on the same hold stays available while it is alive (FR-PAYG-18). If the
  abandoned order is still paid, D5 applies.
- One point is left for the phase that builds D5, which must raise it rather
  than decide it at the keyboard (R-PROC-3): `notifications.type` has no member
  for the notice the student receives under D5.

## References

- PostgreSQL documentation, "Transaction Isolation" — https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL documentation, "Range Types", Constraints on Ranges — https://www.postgresql.org/docs/current/rangetypes.html
- PostgreSQL documentation, "btree_gist" — https://www.postgresql.org/docs/current/btree-gist.html
- Franck Pachot, "PostgreSQL EXCLUDE constraints for better concurrency than serializable", 2025 — https://dev.to/franckpachot/postgresql-exclude-constraints-for-better-concurrency-than-serializable-pob
- Stripe, "Manage limited inventory" — https://docs.stripe.com/payments/checkout/managing-limited-inventory
- Paymob, "Create Intention" — https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention
- Prisma ORM, "Transactions" — https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- prisma/orm#30531, row-locking clauses in the ORM client and SQL builder — https://github.com/prisma/orm/issues/30531

## Documents changed

`docs/SRS.md`, `docs/ERD.md`, `docs/ARCHITECTURE.md`,
`.specify/memory/constitution.md`,
`specs/001-foundations/{spec,data-model,quickstart,tasks}.md`.
