# Phase 1 Design: Data Model

**Feature**: `specs/001-foundations/` · **Date**: 2026-08-26

**Source of truth**: [`docs/ERD.md`](../../docs/ERD.md) v1.3 — 33 tables across
12 module domains plus the platform kernel (ADR 0005, ADR 0007, ADR 0008). That document defines every table, column and relationship. This one
does not restate it. What follows is the design work Phase 0 must do *around* the
model: the structural decisions, the mechanisms that hold each integrity rule,
and the mapping from domains to owning modules.

---

## 1. Domain to module ownership

Twelve domains, twelve backend modules, one owner per table. This mapping is the
input to the table-ownership lint rule (research R-11): a module that reaches a
table outside its own row fails the build citing R-API-6.

| Module | Owns | Tables |
|---|---|---|
| `identity` | Accounts, roles, sessions, consent, the teacher profile record | `users`, `user_roles`, `teacher_profiles`, `otp_codes`, `device_push_tokens`, `terms_acceptances` |
| `verification` | Teacher application and identity demands | `verification_documents`, `verification_requests` |
| `catalog` | What is offered and when, the isnad chain, and discovery (search over its own tables) | `subjects`, `teacher_subjects`, `packages`, `availability_slots`, `isnad_entries`, `teacher_signatures` |
| `booking` | Purchase, holds, enrollment confirmation (called by `payments`) | `slot_holds`, `enrollments` |
| `payments` | Gateway orders and their signed events; webhook ingestion; payout recipient onboarding | `payments`, `payment_events` |
| `sessions` | Generation, live lifecycle, attendance evidence, mutual cancellation | `sessions`, `session_participant_events`, `cancellation_requests` |
| `chat` | Threads and retention | `chat_messages` |
| `certification` | Grants and their records | `ijazahs`, `ijazah_bars` |
| `reviews` | Ratings | `reviews` |
| `moderation` | Session disputes and enrollment-level compensation cases, flags, reports | `disputes`, `gender_flags`, `user_reports` |
| `notifications` | Delivery and the centre | `notifications` |
| `admin` | Back office | `admin_users`, `audit_logs`, `settings` |
| `platform` (kernel, not a module) | Client-mutation idempotency | `idempotency_keys` |

Cross-domain reads go through the owning module's public entry. Discovery is a
service inside `catalog`, not a module, because a module owning no table would
have to read another module's tables to do anything (ADR 0005 D2). Session
generation is requested by `booking` and written by `sessions` through its public
entry. `payments` confirms an enrollment through `booking`'s public entry and
records payout readiness on `teacher_profiles` through `identity`'s; it never
writes either table itself (ADR 0007 D4).

---

## 2. Column conventions, and the check that enforces each

Every convention in ERD §0 needs a machine behind it or it is a style guide.

| Convention | Mechanism | Rule |
|---|---|---|
| Primary keys are time-ordered UUIDs | Database default on every table | ERD §0 |
| Money is integer piasters, name ends `_piasters` | Type-aware lint rule on identifiers; schema check on column names | R-MONEY-1, R-MONEY-2 |
| Timestamps carry a timezone, name ends `_at` | Schema check queries the live catalogue for `timestamp without time zone` and for names lacking the suffix | R-TIME-4, R-TIME-5 |
| Local wall-clock ends `_local`, beside a zone column | Schema check asserts the adjacent zone column exists | R-TIME-3, R-TIME-5 |
| Booleans read as assertions | Review | ERD §0 |
| Enums declared once, centrally | Schema check asserts no duplicate enum definition | ERD §0 |
| Nothing that matters is hard-deleted | Revoked privilege — see §4 | R-DB-3 |
| Secrets are `*_hash` or `*_encrypted`, never bare | Schema check asserts no column named `token`, `secret`, `password`, `code` without a suffix | R-DB-7, R-DB-8 |
| Derived values are computed, except the caches R-DB-4 declares | Schema check compares cached columns against the allow-list of four: `teacher_profiles.average_rating`, `teacher_profiles.review_count`, `sessions.scheduled_start_at`, `sessions.scheduled_end_at` (ADR 0009) | R-DB-4 |

---

## 3. The permitted cached values

`teacher_profiles.average_rating` and `teacher_profiles.review_count`, and
`sessions.scheduled_start_at` and `sessions.scheduled_end_at`, which are derived
from the session's stored local date, local start time and zone and recomputed
when the time zone data changes (ADR 0009). Those four columns are the entire
allow-list, and the schema check asserts that no other cached column exists.
Another requires a recorded architectural decision *before* the column exists
(R-DB-4).

Removed from the model in ERD v1.1 and now computed on read:

| Was | Now computed as |
|---|---|
| `users.is_minor` | From `date_of_birth` at read time |
| `users.ijazah_barred` | `exists(ijazah_bars where user_id = ? and lifted_at is null)` |
| `enrollments.teacher_no_show_count` | `count(sessions where status = 'teacher_no_show')` |

Each was a cache that could drift from its source. `is_minor` is the sharpest
example: a stored boolean is wrong on the user's eighteenth birthday and stays
wrong until something rewrites it, and what it gates is admin visibility of a
minor.

---

## 4. Deletion: three different regimes

The model does not have one deletion policy; it has two, and conflating them is
how a guarantee gets lost.

| Regime | Tables | Mechanism |
|---|---|---|
| **Soft deletion** | `users`, `sessions`, `enrollments`, `ijazahs` | `DELETE` revoked from the application role; `deleted_at` carries removal; ordinary reads exclude marked rows |
| **Append-only, no removal path** | `audit_logs` | `DELETE` revoked; **no** `deleted_at` column exists to set |

`audit_logs` could have carried `deleted_at` and deliberately does not — every
other soft-deletable table holds something a person might legitimately need
removed, while an audit log holds the record of what administrators did, read
only by someone checking whether they acted properly.

### Consequences the model states rather than discovers

**Reads exclude marked rows by default.** Not a convention — the repository layer
applies it, and a read that deliberately includes deleted rows names itself. This
matters beyond tidiness: R-GENDER-3 requires counts and facets computed after
filtering, and a count that silently includes deleted rows is the same class of
defect.

**Uniqueness becomes partial.** Two constraints would otherwise let a deleted
row occupy a value forever (ERD §15.11):

| Constraint | Behaviour | Why |
|---|---|---|
| `users.phone` unique `WHERE deleted_at IS NULL` | Deleted account releases the number | Otherwise a person can never sign up again with their own phone |
| `users.email` unique `WHERE deleted_at IS NULL` | Same | Same |

Partial indexes are not expressible in the schema language, so both are raw SQL
in migrations and asserted by the schema check (research R-6).

`reviews.enrollment_id` is deliberately **not** on this list (ADR 0006 D3).
`reviews` carries no `deleted_at`, so a partial predicate on it cannot exist,
and a soft-deleted enrollment is absent from ordinary reads so nothing can
review it. The plain unique constraint of ERD §15.3 is the whole rule.

---

## 5. Privilege model

Two roles (research R-5, FR-025):

| Role | Holds | Runs migrations | Revocations |
|---|---|---|---|
| **owner** | The schema | Yes — the only role that may | Applies them |
| **application** | Nothing | Never | Subject to them |

Applied by the owner in migration SQL:

```
REVOKE DELETE ON users, sessions, enrollments, ijazahs, audit_logs FROM application;
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT ... TO application;
```

The default-privileges statement is the one most easily forgotten and the most
consequential: without it, the next migration that creates a table grants the
application role everything, and the closed door reopens one migration later.

---

## 6. Integrity rules and where each lives

ERD §15, with the mechanism for each. Every one is in the database, none in
application code (FR-030, R-DB-5).

| # | Rule | Construct |
|---|---|---|
| 1 | `users`: phone or email present | Check constraint |
| 2 | `enrollments`: student ≠ teacher | Check constraint |
| 3 | One review per enrollment | Plain unique constraint, never partial (§4, ERD §15.3, ADR 0006 D3) |
| 4 | Provider event replay safety | Unique on `provider_event_id` |
| 5 | *Retired (ADR 0005)* | — |
| 6 | *Retired (ADR 0005)* | — |
| 7 | One chain name per position | Composite unique |
| 8 | `chat_messages`: body or attachment | Check constraint |
| 9 | `reviews.rating` between 1 and 5 | Check constraint |
| 10 | No hard delete on five tables | Revoked privilege (§5) |
| 11 | Partial uniques over soft-deleted rows | Partial unique indexes (§4) |
| 12 | *Retired (ADR 0005)* | — |
| 13 | Gateway event replay safety | Unique, NOT NULL on `payment_events.provider_event_id` (ADR 0007) |
| 14 | One record per gateway order | Unique on `payments.gateway_order_id` and `gateway_transaction_id` |
| 15 | `confirmed_at` has one write path | Service layer plus the CI test of R-HONEST-1; not expressible in the database without a trigger (research R-5) |
| 16 | Client-retried mutations are idempotent | Unique on `idempotency_keys (scope, key)`; first outcome stored and replayed (ADR 0008) |

Rules 5, 6 and 12 belonged to the managed-payment tables removed by ADR 0005 D1;
their numbers are kept so old citations resolve.

---

## 7. Secret storage: three jobs, three mechanisms

Conflating these is the most common way R-DB-7 and R-DB-8 both end up violated by
a design that looks careful (research R-9).

| Value | Storage | Why not the others |
|---|---|---|
| Password, OTP code | Memory-hard KDF hash | Never needed in plaintext; slow by design |
| Ijazah verification token | Fast unsalted hash, unique | Must be matched against a presented value, so a salted KDF cannot be looked up. High-entropy random, so brute-force hardening is unnecessary |
| Device push token | Encrypted, plus a hash for uniqueness | Must be *presented to a provider*, so it cannot be hashed at all |
| MFA secret, identity document reference, gateway payout recipient reference | Encrypted `bytea` | Must be recoverable; encryption happens above the database so the key never enters a query |

**Phase 4 must know**: with only its hash stored, a lost certificate's
verification token cannot be recovered — only reissued.

---

## 8. Time in the model

Two distinct concepts, never conflated (R-TIME-3):

| Concept | Storage | Example |
|---|---|---|
| Wall-clock in a zone | Local time column beside a zone column | `availability_slots.start_time_local` with `timezone` |
| Absolute instant | Timezone-carrying timestamp | `sessions.scheduled_start_at` |

An enrollment freezes the slot's zone at purchase (`snapshot_slot_timezone`), so
a teacher who later moves zones does not silently reschedule sessions already
bought. Resolution from the first to the second happens only inside
`packages/time`, per occurrence, never by adding intervals (R-TIME-2).

---

## 9. State machines

Phase 0 creates the enum values; the transitions belong to the phases that
implement them. Two are load-bearing enough to record now:

**Session** — `scheduled` is the only entry state. `under_threshold` and
`provider_outage` are terminal *only* by admin action: no automatic transition
out of them exists, and funds stay frozen while they hold (R-SESS-6). Building
the enum without that constraint in mind is how an auto-resolution path gets
added later by someone who reads the enum as a list of equals.

**Enrollment** — `pending_payment` gates session generation. It is released only
by the `confirm-enrollment` job acting on a persisted, signature-verified `paid`
event (FR-PAYG-5); `confirmed_at` has no other write path (R-HONEST-1). Order
expiry or failure moves it to `cancelled` with a `cancellation_reason`.

---

## 10. Seed dataset

Must be identical on every machine, and safe to run twice (FR-038). Requires
deterministic identifiers and no dependence on the machine's clock or timezone —
which is the constraint that makes it non-trivial, given time-ordered UUIDs
encode a timestamp. Seed content is confined to what has no user-facing
behaviour: subjects in both languages, the settings keys with their defaults, and
one administrator account. No teachers, students or enrollments — those belong to
the phases that give them meaning.
