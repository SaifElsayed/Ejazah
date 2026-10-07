# Quickstart: Validating Phase 0

**Feature**: `specs/001-foundations/` · **Date**: 2026-08-26

How to prove Phase 0 actually works. This phase ships no product journey, so
"working" means something specific: **the guards refuse what they are supposed to
refuse.** Every check below is a deliberate violation that must fail, or a
property that must hold. A green suite proves nothing here unless you have also
watched the red ones go red.

Each section maps to success criteria in [spec.md](./spec.md).

---

## Prerequisites

- The runtime and package manager versions pinned in the repository
- A container runtime, for the local database and cache
- No third-party credentials. Deliberately — see [§5](#5-no-credentials-required)

---

## 1. Reach a running system (SC-001, SC-002)

```bash
pnpm install
cp .env.example .env
openssl rand -base64 32   # paste the output into ENCRYPTION_KEY in .env; it is required in every environment
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

**Expected**: every application starts. No step asks for a secret beyond the one locally generated encryption key.

**A database volume created before T065** lacks the application role, which `docker/initdb` creates only when a volume is new. Recreate it once, then migrate again:

```bash
docker compose down -v
pnpm infra:up
pnpm db:migrate
```

**The check that matters** — the seed is identical everywhere:

```bash
pnpm db:seed:checksum
```

Compare with a teammate. Then have them run it on a machine in a different
timezone, on a different day, and compare again. Identical or the requirement is
not met — time-ordered identifiers make this genuinely easy to get wrong.

**Then prove it is safe to run twice:**

```bash
pnpm db:seed && pnpm db:seed:checksum
```

Unchanged from the first run.

---

## 2. Migrations run clean from empty (SC-006)

```bash
pnpm db:reset
```

**Expected**: the full history applies in one run, no manual step, producing
every table in the model and none outside it.

```bash
pnpm db:schema:check
```

**Expected**: passes. This asserts what the schema conventions promise — every
timestamp carries a timezone and the right suffix, every local wall-clock column
sits beside a zone column, every money column carries the piaster suffix, no
secret column is bare, and the only cached derived values are the six columns
R-DB-4 declares. Run it after
any migration; it is the check most likely to catch an accidental convention
breach.

---

## 3. The database refuses what the rules forbid (SC-004, SC-007)

The important one. These run **as the application role**, not the owner —
otherwise you are testing a role nobody uses.

```bash
pnpm test:db-integrity
```

Each of these must be rejected by the database itself:

| Attempt | Expected |
|---|---|
| `DELETE` a user, session, enrollment or ijazah row | Refused — privilege revoked |
| `DELETE` an audit row | Refused — and no `deleted_at` exists to set instead |
| Insert an enrollment where student equals teacher | Refused — check constraint |
| Insert a user with neither phone nor email | Refused — check constraint |
| Insert a second review for one enrollment | Refused — unique violation (plain, never partial) |
| Insert a rating of 0 or 6 | Refused — check constraint |
| Insert a chat message with neither body nor attachment | Refused — check constraint |
| Replay a provider event identifier (attendance or gateway) | Refused — unique violation |
| Insert a gateway event with no provider event identifier | Refused — not-null violation |
| Insert a second payment with the same gateway order identifier | Refused — unique violation |

**Then the soft-deletion behaviour:**

| Attempt | Expected |
|---|---|
| Soft-delete a user, then read them through an ordinary query | Absent |
| Soft-delete a user, then count users | Not counted |
| Soft-delete a user, then register their phone number again | **Succeeds** — the partial index released it |
| Soft-delete an enrollment, then try to review it | Refused by the service — the enrollment is absent from reads; its one review, if any, stays (ADR 0006) |

That third row is the one people get wrong. If it fails, someone made the unique
index total instead of partial, and a person who deletes their account can never
sign up again with their own number.

---

## 4. The wall refuses a violation (SC-003)

```bash
pnpm test:violations
```

This suite is inverted: each case introduces a deliberate violation and asserts
the build refuses it **and names the constitution rule**. Every rule listed in
[contracts/lint-rules.md](./contracts/lint-rules.md) has a case.

To watch one by hand — import across the role wall:

```bash
echo "import { x } from '../../teacher/packages';" \
  >> apps/mobile/src/features/student/discovery/index.ts
pnpm lint
```

**Expected**: fails, message ending `R-MOBILE-1`. Revert.

Then the one that needs type information:

```bash
# add, inside a feature file:  const total = price_piasters + fee_piasters;
pnpm lint:types
```

**Expected**: fails, message ending `R-MONEY-5`. If it passes, the money type is
an alias rather than a brand and the whole money tier is decorative.

**Coverage of the guards themselves**: the suite must have a case per rule. A
rule with no failing case is a rule nobody has proven works — SC-003 sets that
count at zero.

---

## 5. No credentials required (SC-005)

```bash
env -u PAYMENT_GATEWAY_API_KEY -u PAYMENT_GATEWAY_WEBHOOK_SECRET \
    -u DAILY_API_KEY -u SMS_PROVIDER_KEY \
    -u EXPO_ACCESS_TOKEN -u S3_ACCESS_KEY_ID \
    pnpm test
```

**Expected**: everything passes against stand-ins.

If something fails, a code path is reachable only against a real provider — and
that path is precisely where a Phase 3 bug will live, undetected until it is in
front of a user.

---

## 6. Time behaves across a real DST boundary (SC-013)

```bash
pnpm --filter @ijazah/time test
```

Mandatory cases, against real Cairo transition dates:

| Case | Expected |
|---|---|
| Weekly recurrence spanning a spring-forward transition | Every occurrence at the intended local time, both sides. No drift |
| Weekly recurrence spanning a fall-back transition | Same |
| A local time that does not exist | Shifts forward |
| A local time that occurs twice | Takes the first |

The recurrence cases are the ones that catch the real defect. A build-by-adding
implementation passes every same-week test and silently fails once a year.

---

## 7. Money is a type, not a number (FR-012, FR-072)

```bash
pnpm --filter @ijazah/money test
```

**Expected**: a plain number is not assignable to `Piasters`, and a money consumer cannot
stand in for a number consumer, proven by type-level tests; the reverse widening is closed
by the R-MONEY-1 lint rule (FR-072, T131).
There is no share splitting to test: the platform never holds money; gateway-reported amounts are recorded, never computed (ADR 0007).

---

## 8. Pipeline gates hold (SC-009, SC-010)

Each must fail:

| Attempt | Expected |
|---|---|
| Push directly to the default branch | Refused |
| Merge without an approving review | Blocked |
| Merge with a failing pipeline | Blocked |
| Merge with an open critical dependency alert | Blocked |
| Open a branch not matching a spec directory | Pipeline fails, `R-PROC-1` |
| Hand-edit a generated file | Pipeline fails, `R-PROC-9` |
| Remove a procedure, field or enum member | Contract snapshot diff fails, `R-API-9` |
| Add one | Passes without comment |
| Drop coverage below the floor in a covered path | Pipeline fails, `R-PROC-5` |

**Secret scanning, both independently** (SC-010):

```bash
# plant a test secret, then:
git commit          # expected: refused locally
git commit --no-verify && git push   # expected: pipeline fails
```

Both must reject it, including when planted under `specs/`. Neither may be
implemented as a call to the other — they are separate nets on purpose.

---

## 9. Automatic staging (SC-008)

Merge a trivial visible change to the default branch.

**Expected**: live on staging within fifteen minutes, no human action after
approval, reachable from outside the team's network — check from a phone on
mobile data, not from the office.

---

## 10. Kernel defaults (SC-012 and the kernel contract)

| Check | Expected |
|---|---|
| Start with a required config value missing | Exits naming the value, before accepting traffic |
| Trigger a failure deep in the stack | One error shape out. No stack trace, query text or internal path |
| Inspect the log for that request | Correlation identifier present; no body, token, code, session id, document link or credential |
| Submit an idempotent operation twice | Second returns the first outcome, effect not repeated; one `idempotency_keys` row exists |
| Call an auth or search endpoint past its limit | Throttled |
| Upload a file whose extension lies about its content | Content decides; the declaration is ignored |
| Deliver a gateway webhook with a missing or invalid signature | Rejected before any handler runs; no event row is written |
| Inspect the user surface's generated types | Zero administrative capabilities |
| Perform an administrative action | Audit record written by the caller kind, not by the handler |

---

## Definition of done

PLAN.md's Phase 0 list, and where each is proven:

| Item | Section |
|---|---|
| CI green on typecheck, lint, test, build | §8 |
| Secret scanning and branch protection enforced | §8 |
| Staging deploys automatically from the default branch | §9 |
| Migrations run clean from empty database | §2 |
| Delete revoked at role level on the five protected tables | §3 |
| Every port has a working stand-in | §5 |
| Both spikes closed with a written outcome | Read the two documents |

**Then the question this phase actually answers**: pick any rule in
`.specify/memory/constitution.md` with a machine tier. Try to break it. If you
can, the phase is not done — regardless of what the suite says.
