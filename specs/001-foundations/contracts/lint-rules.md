# Contract: Lint Rules to Constitution Rules

Every custom rule is named for the prohibition it enforces, and every message
ends with that identifier. This is how FR-011 is satisfied structurally rather
than by remembering to write good error text: a developer who sees a build fail
can go straight to the rule in `.specify/memory/constitution.md` and read why it
exists.

**Rule identifiers are additive-only**, for the same reason procedure names are
(R-API-9): a renamed rule breaks the trace from an old build log, an old pull
request or an old architectural decision back to the prohibition.

---

## Syntax-only rules

Fast enough to run in the editor and in the pre-commit hook. No type information
needed.

| Rule id | Refuses | Constitution |
|---|---|---|
| `boundaries/no-cross-role-import` | Student tree importing teacher tree, or the reverse | R-MOBILE-1 |
| `boundaries/no-role-import-in-shared` | Shared tree importing either role tree | R-MOBILE-2 |
| `boundaries/no-deep-module-import` | Importing a module below its public entry | R-API-3 |
| `boundaries/no-adapter-import` | Importing a concrete provider implementation outside its port folder | R-API-4 |
| `boundaries/no-upward-admin-import` | Importing upward into the administrative module | R-API-4 |
| `boundaries/no-money-vocabulary` | Wallet, ledger, balance, escrow or platform-held-funds vocabulary anywhere; and gateway order, gross, fee or net amounts referenced outside `modules/payments` and `platform/ports/payment` (redefined by ADR 0007) | R-MONEY-6 |
| `api/no-logic-in-router` | A router file exceeding the complexity ceiling, which is how a business rule shows up there | R-API-1 |
| `api/no-orm-outside-repository` | Database client imported outside a repository file | R-API-2 |
| `money/no-number-in-money-position` | A declared money position typed as plain `number` rather than the branded type | R-MONEY-1 |
| `time/no-datetime-outside-package` | `Date` arithmetic or a datetime library outside `packages/time` | R-TIME-1 |
| `mobile/no-raw-color` | Hex, rgb or raw spacing literal in a feature file | R-MOBILE-4 |
| `mobile/no-physical-direction` | Directional utility instead of a logical one | R-MOBILE-5 |
| `mobile/no-raw-control` | Raw platform control instead of a shared primitive | R-MOBILE-6 |
| `mobile/no-literal-string` | User-facing string literal in a view text position | R-MOBILE-7 |
| `mobile/no-translated-concat` | Sentence assembled from translated fragments | R-MOBILE-8 |
| `mobile/no-manual-format` | Hand-written date, time or number formatting outside the shared layer | R-MOBILE-9 |
| `mobile/no-insecure-storage` | Sensitive storage outside the secure storage layer | R-MOBILE-10 |
| `mobile/no-direct-network` | Direct network call bypassing the shared client | R-MOBILE-11 |
| `sec/no-disabled-tls` | Disabling transport security verification, in any environment | R-SEC-11 |
| `sec/no-body-logging` | Logger call receiving a raw request body | R-SEC-2 |
| `db/no-weak-random` | Non-cryptographic randomness | R-DB-6 |
| `api/no-push-outside-job` | Notification delivery reached outside the queued job | R-API-15 |
| `api/require-escape-hatch-reason` | `any`, `as any` or `@ts-ignore` with no justification comment and ticket | R-API-10 |
| `proc/require-suppression-reason` | An `eslint-disable` carrying no justification and ticket | R-PROC-7 |
| `proc/no-focused-or-skipped-test` | A test marked exclusive or skipped | R-PROC-10 |
| `proc/no-bare-marker` | A comment marker carrying no ticket reference, and a block of commented-out code | R-PROC-8 |

### Two notes on identifier traceability

**R-API-4 carries two prohibitions in one identifier** — never import upward
into `admin`, and never import a concrete adapter outside its port folder. Two
rules therefore cite it. A build log naming R-API-4 is resolved by the message,
which states which half was broken; the identifier alone does not distinguish
them. Splitting the constitution rule is the only way to remove that ambiguity,
and identifiers are additive-only, so it is recorded here rather than fixed.

**`api/require-escape-hatch-reason` and `proc/require-suppression-reason` are
separate rules** even though both refuse an undocumented escape hatch. They
enforce different prohibitions (R-API-10 and R-PROC-7) through different
mechanisms — `no-explicit-any` and `ban-ts-comment` for the first, the
`eslint-disable` description requirement for the second — and a message can end
with only one identifier.

---

## Type-aware rules

Require resolved type information, so they run in the pipeline rather than on
every keystroke (research R-10, R-13). These four are the reason type-aware
linting is worth its cost — none can be written against syntax alone, and each
guards something the constitution treats as unrecoverable.

| Rule id | Refuses | Why syntax is insufficient | Constitution |
|---|---|---|---|
| `money/no-arithmetic-outside-package` | Any arithmetic operand carrying the money brand, outside its package | `a + b` looks identical whatever the operands are | R-MONEY-5 |
| `money/require-piaster-suffix` | An identifier whose resolved type is money but whose name lacks the suffix | The name alone cannot tell you the type | R-MONEY-2 |
| `gender/require-requester-gender` | A repository method returning teachers whose signature does not require the requester's gender: a parameter, or a property of an options parameter, that is neither optional nor nullable and whose type is `RequesterGender` — the gender value branded in `packages/contracts` and minted only by the request context. A plain gender value, an optional one and a nullable one are refused alike | A filtered and an unfiltered method are syntactically identical, and a requester's gender and any other gender value are the same string | R-GENDER-5 |
| `api/table-ownership` | Inside `apps/api`: database access to a table from any file other than a repository file of the module that owns it; any member of the database client whose name starts with `$`, other than `$transaction`, outside `apps/api/src/platform/db/`; and the string-taking raw forms `$queryRawUnsafe` and `$executeRawUnsafe` everywhere, the kernel included | Requires resolving the query target against the ownership manifest, and a raw query names its table where no rule can read it | R-API-6 |

Two notes on the last two rows, decided 2026-10-05 after the two reviews of
PR #27.

**Callers that are not a student.** `gender/require-requester-gender` accepts
`RequesterGender` and nothing else, so a teacher-returning repository method for
an administrator or a background job cannot be written yet. That is deliberate:
the rule fails closed. The first task that needs such a method adds, in this row
and in its own task line, a separate type minted only in that caller's own
context, so that a student-facing path can never obtain it. No such type is
designed here, because no task needs one yet (R-PROC-3).

**Database client members are refused by default.** `api/table-ownership` lists
what a module may use (`$transaction`), not what it may not, so a raw-query
entry point the client gains later is refused on the day it appears. No kernel
helper is specified here: no document asks for a runtime raw query (the row lock
of R-MONEY-10 is superseded), and the first task that needs one writes it under
`apps/api/src/platform/db/` with a table name that is a literal checked against
the manifest.

---

## Rules held elsewhere

Not every prohibition is a lint rule, and pretending otherwise produces rules
that appear to enforce something they cannot.

| Held by | Rules |
|---|---|
| The compiler | R-MONEY-1, R-TIME-6, R-GENDER-4, R-GENDER-6, R-API-7, R-API-11, R-SEC-8, R-SESS-1, R-HONEST-4/5 |
| The database | R-MONEY-8, R-TIME-3, R-DB-3/5/8, R-SEC-8, R-SESS-1, R-PROC-11 |
| Runtime guards | R-MONEY-9, R-GENDER-7, R-API-8/12, R-DB-6, R-SEC-3/4/5/6/9, R-SESS-3/5/6 |
| Superseded by ADR 0005 (ids retained, nothing to enforce) | R-MONEY-3/4/7/10/11 |
| Pipeline gates | R-MONEY-9/12, R-TIME-2/4/5/7, R-GENDER-1/2/3/6/7, R-MOBILE-7/13, R-API-9/11/13/14, R-DB-1/7, R-SEC-1/4/5/6/12, R-SESS-2/4/5, R-HONEST-1/2/3/4/6, R-PROC-1/4/5/9 |
| Human review alone | R-MOBILE-3, R-MOBILE-12, R-MOBILE-14, R-API-5, R-DB-2, R-DB-4, R-DB-9, R-SEC-7, R-SEC-10, R-PROC-2, R-PROC-3, R-PROC-6 |

The twelve in the last row are the pull request template, and they are the only
rules a machine holds nothing of. They are not the only rules a reviewer reads
for: R-MONEY-12, R-TIME-3, R-TIME-6, R-GENDER-4, R-GENDER-5, R-MOBILE-8,
R-MOBILE-13, R-API-1, R-API-13, R-DB-7, R-SEC-1, R-SEC-2, R-PROC-10, R-PROC-11,
R-HONEST-1 and R-HONEST-5 each carry review as a second mechanism behind a
machine check. (R-MONEY-12 also carries review.)

A rule appearing in more than one row is held by more than one mechanism, which
is the constitution's intent — `R-DB-6` is both a lint rule banning weak
randomness and a runtime utility that generates identifiers properly, and
`R-MONEY-1` is both the branded type and a lint ban on plain `number` in a money
position.
