<!--
SYNC IMPACT REPORT
==================
Version change: (unratified template) -> 1.1.0

Rationale for version: `.specify/memory/constitution.md` held only unfilled
placeholder tokens, so this is the initial ratification. The version is set to
1.1.0 rather than 1.0.0 so that the constitution's MAJOR.MINOR tracks the
source document it materializes -- "Ijazah - The Rules" v1.1. Rule-ID citations
in lint output, CI failures and PR review must be traceable to one document
version; keeping the numbers aligned makes that mechanical. PATCH is reserved
for constitution-local clarifications that The Rules did not change.

Modified principles: none (no prior ratified principles existed).

Added sections:
  - Core Principles I-X (Money, Time, Gender Enforcement, Mobile Frontend,
    Backend Structure, Database, Security, Sessions and Attendance,
    Product Honesty, Process) -- 99 numbered rules, each carrying its
    enforcement mechanism.
  - Enforcement Mechanisms (mechanism tiers, one-prohibition-one-rule
    discipline, the enforcement map).
  - Development Workflow and Quality Gates (the twelve-item PR checklist,
    the five rules above all others, the spec-first workflow).
  - Governance (supremacy, amendment procedure, versioning policy,
    compliance review, amendment history).

Removed sections: none.

Follow-up TODOs: none. All placeholder tokens resolved.

Note for maintainers: `docs/constitution.md` predated this document and stated
a shorter, overlapping rule set. It has since been removed, so that one document
owns each prohibition. README.md points here instead.
-->

# Ijazah Constitution

Version 2.4.0. Companion to SRS v1.4, ARCHITECTURE v3.2, ERD v1.3. Amended by [ADR 0005](../../docs/adr/0005-phase-0-document-amendments.md), [ADR 0007](../../docs/adr/0007-direct-gateway-checkout.md), [ADR 0009](../../docs/adr/0009-reresolve-sessions-on-tzdata-change.md) and [ADR 0010](../../docs/adr/0010-database-refuses-double-booking.md).

Every prohibition in the project lives here, each with an ID and an enforcement
mechanism. This document is the source for the lint configuration, the CI gates,
the database constraints and the PR checklist. When a check fails it cites a
rule ID from this document, the same way code cites SRS requirement IDs.

The governing idea: **a rule enforced by memory will be broken; a rule enforced
by a machine cannot be.** Every rule below is tagged with the strongest
mechanism available for it, and rules whose only mechanism is `REVIEW` appear
verbatim on the PR checklist.

## Core Principles

### I. Money (R-MONEY)

The platform never holds money; it routes it (ADR 0007). The student pays the
gateway, the gateway settles the net directly to the teacher, and the platform
takes 0% and keeps a record of what the gateway did. There is no wallet, ledger,
balance or escrow. Money values are integer piasters typed so a plain number
cannot reach them, and a payment is confirmed only by the gateway's signed
webhook. Rules 3, 4, 7, 10 and 11 were written for a managed ledger that no
longer exists; their ids are retained as superseded so old citations resolve.
Rules 8 and 9 are reinstated for gateway events.

| ID | Rule | Enforced |
|---|---|---|
| R-MONEY-1 | **Never** represent money as float or decimal. Integer piasters only. | `TYPE` - the `Piasters` branded type in `packages/money`; `LINT` bans `number` in money positions |
| R-MONEY-2 | **Never** name a money variable without the `_piasters` suffix (`price` is forbidden; `price_piasters` is required). | `LINT` custom rule |
| R-MONEY-3 | *Superseded (ADR 0005).* Was: never store a balance. There is no balance to store. | — |
| R-MONEY-4 | *Superseded (ADR 0005).* Was: never UPDATE or DELETE a ledger row. There is no ledger. Hard-deletion of every other record that matters is R-DB-3. | — |
| R-MONEY-5 | **Never** do money arithmetic outside `packages/money`. No `+`, `-`, `*` on piaster values in feature code. | `LINT` - arithmetic on `Piasters` type banned outside the package |
| R-MONEY-6 | **Never** introduce a wallet, balance, escrow, ledger or platform-held-funds concept anywhere. Money-carrying records (gateway order, gross, fee, net) live only in `payments`; every other module speaks to the `PaymentPort` or to `payments`' public entry and never reads a money amount. *(Redefined by ADR 0007.)* | `LINT` boundary rule `boundaries/no-money-vocabulary` outside `modules/payments` and `platform/ports/payment` |
| R-MONEY-7 | *Superseded (ADR 0005).* Was: never disburse during the dispute window. Nothing is disbursed. | — |
| R-MONEY-8 | **Never** act on a gateway event without a provider event id that is unique and NOT NULL. A replayed event is acknowledged and ignored. *(Reinstated by ADR 0007. Jobs generally: R-API-14.)* | `DB` - `payment_events.provider_event_id` unique, NOT NULL |
| R-MONEY-9 | **Never** process a gateway webhook without verifying its signature first, on the raw body, before any handler runs. *(Reinstated by ADR 0007. Video-provider webhooks: R-SEC-12.)* | `RT` guard - unsigned or invalid requests rejected before any handler; `CI` test |
| R-MONEY-10 | *Superseded (ADR 0005).* Was: row lock on the Enrollment for money moves. | — |
| R-MONEY-11 | *Superseded (ADR 0005).* Was: per-session shares sum to net. There are no shares. | — |
| R-MONEY-12 | **Never** **read** a threshold, window, offset or limit from a constant. Every operational number is read from `settings`. *(Writing settings: R-PROC-11.)* | `CI` - magic-number grep gate over `apps/api/src/modules/`; `REVIEW` |

### II. Time (R-TIME)

Wall-clock time and instants are different things and are never conflated.
Slots are local time plus a named zone; sessions are UTC instants; recurrence is
resolved per occurrence. A DST bug ships silently and detonates months later, on
a date nobody was testing.

| ID | Rule | Enforced |
|---|---|---|
| R-TIME-1 | **Never** construct or resolve a session datetime outside `packages/time`. *(Display formatting is R-MOBILE-9.)* | `LINT` - `Date` arithmetic and datetime libraries banned outside the package |
| R-TIME-2 | **Never** generate recurrence by adding `7 x 24h`. Each occurrence is resolved independently: that week's local date plus the slot's local time, in the teacher's zone. | `CI` - unit tests against real Cairo DST transition dates must pass |
| R-TIME-3 | **Never** store an availability slot's time as UTC. Slots are local wall-clock plus IANA zone; only *sessions* hold UTC instants. | `CI` - the schema gate refuses an `_local` column that is not a date or a time, or has no `timezone` beside it; `REVIEW` |
| R-TIME-4 | **Never** use a timestamp column without timezone. `timestamptz` always. | `CI` - schema check script |
| R-TIME-5 | **Never** name a timestamp without `_at` (UTC) or `_local` (with an adjacent `timezone` column). | `CI` schema check |
| R-TIME-6 | **Never** trust a client-supplied timestamp for anything that matters - attendance, ordering, expiry. Server clock only. | `LINT` - `time/no-client-timestamp` refuses a server-event timestamp or an absolute instant in an input schema of `packages/contracts`; `REVIEW` |
| R-TIME-7 | **Never** leave DST gap (nonexistent time) and ambiguity (repeated time) unhandled - shift forward, take first, and test both. | `CI` - the two edge-case tests are mandatory in `packages/time` |

### III. Gender Enforcement (R-GENDER)

No opposite-gender teacher data crosses the wire, in any form, on any path -
including errors, partial payloads, counts and facets. This failure is not a bug
ticket; it is a screenshot. Absence must be indistinguishable from nonexistence,
because a 403 leaks exactly the fact a 404 protects.

| ID | Rule | Enforced |
|---|---|---|
| R-GENDER-1 | **Never** return an opposite-gender teacher's data in any API response, including errors and partial payloads. *(Aggregates: R-GENDER-3.)* | `CI` - adversarial suite, blocking on every commit |
| R-GENDER-2 | **Never** answer a forbidden profile request with 403. Always 404 - indistinguishable from nonexistent. | `CI` adversarial suite |
| R-GENDER-3 | **Never** compute a count, total, or facet before the gender filter is applied. | `CI` adversarial suite (count-comparison attack) |
| R-GENDER-4 | **Never** read gender, role, or user ID from client input for an authorization decision. Server-held session only. | `LINT` - `gender/no-authority-in-input` refuses these fields in an input schema of `packages/contracts`; `REVIEW` |
| R-GENDER-5 | **Never** create a repository method that returns teachers without taking the requester's gender. There must be no unfiltered method to call from a student-facing path. | `LINT` - repository method signature rule; `REVIEW` |
| R-GENDER-6 | **Never** expose a self-service gender change. Admin review only. | `TYPE` - no such procedure exists on either router; `CI` test asserts absence |
| R-GENDER-7 | **Never** issue a video token for a cross-gender pairing, and never mint a token not bound to one session and one participant. | `RT` guard at token issuance, plus `CI` adversarial suite (token replay) |

### IV. Mobile Frontend (R-MOBILE)

The student and teacher trees never touch, shared holds only what is genuinely
identical, and every visual value comes from a token. The app is Arabic-first:
direction is logical, never left or right, and no user-facing sentence is built
by concatenation, because concatenation breaks both RTL and Arabic grammar.

| ID | Rule | Enforced |
|---|---|---|
| R-MOBILE-1 | **Never** import from `features/teacher/**` inside `features/student/**`, or the reverse. | `LINT` (`boundaries/no-cross-role-import`, a rule of `eslint-plugin-ijazah`; wall data in `packages/config/eslint.boundaries.js`) - build error |
| R-MOBILE-2 | **Never** import role-specific code inside `features/shared/**`. Shared imports from neither tree. | `LINT` boundaries |
| R-MOBILE-3 | **Never** put a screen in `shared/` that is only "roughly similar" between roles. Shared holds genuinely identical flows and primitives. Duplication beats a wrong abstraction. | `REVIEW` - the one wall rule a machine cannot judge |
| R-MOBILE-4 | **Never** write a raw hex color, rgb value, or numeric spacing in a feature file. Tokens only. | `LINT` - regex ban on `#[0-9a-f]{3,8}`, `rgb(`, and raw spacing outside `design/` |
| R-MOBILE-5 | **Never** use directional utilities: `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`. Logical only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`. *(Icon flipping: R-MOBILE-14.)* | `LINT` - class-name regex ban in `features/**` |
| R-MOBILE-6 | **Never** build a button, input, card, or sheet inside a feature. Compose `design/primitives`. | `LINT` - raw `Pressable`/`TextInput` banned in `features/**` |
| R-MOBILE-7 | **Never** hardcode a user-facing string. Every string goes through an i18n key, in both `ar.json` and `en.json`. | `LINT` - no string literals in JSX text positions; `CI` - key-parity check between the two files |
| R-MOBILE-8 | **Never** concatenate translated fragments to build a sentence. Use interpolation within one key - concatenation breaks RTL and Arabic grammar. | `LINT` heuristic (string `+` with i18n calls); `REVIEW` |
| R-MOBILE-9 | **Never** format a date, time, or number for display by hand. Locale-aware formatters from `lib/` only. *(Domain resolution is R-TIME-1.)* | `LINT` - `toLocaleDateString` and manual formatting banned outside `lib/` |
| R-MOBILE-10 | **Never** store a token, session, or anything sensitive in plain AsyncStorage. SecureStore only. | `LINT` - AsyncStorage import banned outside `lib/storage` |
| R-MOBILE-11 | **Never** call `fetch` or axios directly. All server communication through the tRPC client. | `LINT` - `fetch` banned in `features/**` |
| R-MOBILE-12 | **Never** put business rules in a component. Components render; hooks and the server decide. | `REVIEW` |
| R-MOBILE-13 | **Never** hide a forbidden action only in the UI and call it enforced. The server check must exist first. | `CI` - the corresponding server test must exist in the same PR, a path-coupling gate built with the first mobile feature (Phase 1); `REVIEW` |
| R-MOBILE-14 | **Never** flip a directional icon (chevron, back arrow) manually. `useDirection()` only. | `REVIEW` |

### V. Backend Structure (R-API)

Routers validate and delegate, services decide, repositories fetch. Modules are
reached through their `index.ts` and never through each other's tables. The
contract is additive forever, because clients in the field are always older than
the server.

| ID | Rule | Enforced |
|---|---|---|
| R-API-1 | **Never** put business logic in a tRPC procedure. Validate, call one service method, return. An `if` about business rules in a router file is in the wrong file. | `LINT` complexity ceiling on `*.router.ts`; `REVIEW` |
| R-API-2 | **Never** put a query in a service or a rule in a repository. Services decide; repositories fetch. *(A query through an injected client, which needs no import: R-API-6.)* | `LINT` - Prisma client import banned outside `*.repository.ts` |
| R-API-3 | **Never** import a module except through its `index.ts`. | `LINT` boundaries |
| R-API-4 | **Never** import upward into `admin`, and never import a concrete adapter outside its own port folder. | `LINT` boundaries |
| R-API-5 | **Never** let a vendor concept leak into a port interface. Ports speak your domain (`createSessionToken`), never the vendor's (`createMeetingToken`). | `REVIEW` - checked whenever a port interface changes |
| R-API-6 | **Never** touch another module's tables. The owning module's, or the kernel's, repository is the only access path. Runtime raw SQL is written only in the platform kernel (`apps/api/src/platform/db/`), because a raw query names its table where the allowlist cannot read it, and never in its string-taking `Unsafe` forms. | `LINT` - per-module table allowlist on Prisma calls, repository files only; database client members other than `$transaction` refused outside `platform/db/`, the `Unsafe` forms everywhere in the API; `REVIEW` for a database driver used directly and for `Prisma.raw` |
| R-API-7 | **Never** skip Zod validation on any input, on either router. | `TYPE` - procedures require an input schema |
| R-API-8 | **Never** return a raw database or vendor error to a client. One error shape: `{ code, message, details? }`. *(Leaked internals: R-SEC-9.)* | `RT` - global error filter maps everything |
| R-API-9 | **Never** remove or rename a tRPC procedure, field, or enum value. Additive only; deprecate, then remove after the minimum client version passes it. | `CI` - router snapshot diff fails on removals |
| R-API-10 | **Never** use `any`, `as any`, or `@ts-ignore` without an inline justification comment and a ticket reference. *(Lint escape hatches: R-PROC-7.)* | `LINT` - `no-explicit-any`; `ban-ts-comment` with description requirement |
| R-API-11 | **Never** expose an admin capability on the app router. Admin procedures exist only on `adminRouter`. *(Auth separation: R-SEC-8.)* | `TYPE` - separate routers; `CI` test asserts the procedure sets are disjoint |
| R-API-12 | **Never** perform an admin action without writing an audit entry. | `RT` - `adminProcedure` writes the audit row itself; there is no admin path around it |
| R-API-13 | **Never** run heavy work (PDF render, bulk notification) inside a request handler. Queue it. | `CI` request-duration test on those endpoints; `REVIEW` |
| R-API-14 | **Never** write a non-idempotent job. Every job run twice must equal one run. | `CI` - each job's test suite includes a double-run assertion |
| R-API-15 | **Never** send a notification inline. Queued with retry, always (FR-NOTIF-4). | `LINT` - push adapter import banned outside the notification job |

### VI. Database (R-DB)

Migrations are immutable once merged, terminal states are statuses rather than
deletions, and invariants a check constraint can hold are never left to code
alone. Anything public-facing is crypto-random; anything secret is hashed or
encrypted at rest.

| ID | Rule | Enforced |
|---|---|---|
| R-DB-1 | **Never** edit a migration after it merges. Fix forward with a new migration. | `CI` - migration checksum verification |
| R-DB-2 | **Never** hand-edit a local schema. A diverged database is reset from migrations, not patched. | `REVIEW`, plus the team runbook |
| R-DB-3 | **Never** hard-delete: audit logs, ijazahs, sessions, enrollments, users. Terminal states are statuses; the first four carry `deleted_at`, the audit log has no removal path at all. | `DB` - DELETE revoked on those tables for the app role |
| R-DB-4 | **Never** store a derived value, except the declared caches: `average_rating` and `review_count`; `sessions.scheduled_start_at` / `scheduled_end_at`, derived from the session's local time and zone ([ADR 0009](../../docs/adr/0009-reresolve-sessions-on-tzdata-change.md)); and `sessions.teacher_user_id` / `student_user_id`, copied from the enrollment so the database can refuse overlapping sessions ([ADR 0010](../../docs/adr/0010-database-refuses-double-booking.md)) - and never add another without an ADR. | `CI` - the schema gate refuses a column named for an aggregate outside the declared caches, and a declared cache missing; `REVIEW` - whether any other value is derived; the ERD is the registry |
| R-DB-5 | **Never** enforce a cross-field invariant only in code when a check constraint can hold it (self-enrollment, phone-or-email, rating range, body-or-attachment). | `DB` check constraints per ERD section 15 |
| R-DB-6 | **Never** issue a sequential or guessable identifier for anything public: certificate numbers, verification tokens. Crypto-random. | `RT` - generation utility in `platform/`; `Math.random` banned by `LINT` |
| R-DB-7 | **Never** store an OTP code, token, or password in plain text. Hashed, always. *(Reversible secrets: R-DB-8.)* | `CI` - `*_hash` column naming check; `REVIEW` |
| R-DB-8 | **Never** store a payout identifier, MFA secret, or national-ID reference unencrypted. | `CI` - the schema gate refuses an `_encrypted` column that is not `bytea` and a secret column that is bare; columns per ERD |
| R-DB-9 | **Never** add an index speculatively. Indexes beyond ERD section 14 require a measured slow query first. | `REVIEW` |

### VII. Security (R-SEC)

Secrets never enter the repository or any human channel, sensitive values never
enter a log, stored files are never reachable by a predictable path, and no one
writes their own auth, session or crypto code. Uploads are trusted for nothing
they declare about themselves.

| ID | Rule | Enforced |
|---|---|---|
| R-SEC-1 | **Never** expose a secret, key, or credential - not in the repo, and not in Slack, Jira, a screenshot, or a Spec Kit file. `.env` never enters the repo. | Gitleaks pre-commit; `CI` - Gitleaks over the full history (including `specs/`); `REVIEW` for the human channels |
| R-SEC-2 | **Never** log a request body, OTP, token, session ID, document URL, payout identifier, payment payload, card fragment, or gateway credential. | `LINT` - logger calls with raw `req.body` banned; `REVIEW` |
| R-SEC-3 | **Never** serve a stored file from a predictable path. Signed, expiring URLs only - documents, certificates, chat attachments, photos. | `RT` - the storage port has no public-path method to call |
| R-SEC-4 | **Never** trust a client-declared MIME type or extension. Server-side content sniffing on every upload. | `RT` - upload middleware; `CI` test with a renamed image |
| R-SEC-5 | **Never** accept an image in chat - by extension **or** by content. *(Sniffing mechanism: R-SEC-4.)* | `RT`, plus a `CI` adversarial test |
| R-SEC-6 | **Never** ship an unauthenticated or unrate-limited auth, OTP, or search endpoint. | `RT` - rate limiter in `platform/`; `CI` test asserts limits exist |
| R-SEC-7 | **Never** write custom auth, session, or crypto code. Proven libraries only. | `REVIEW` - any PR touching auth requires both other members |
| R-SEC-8 | **Never** let admin and user authentication share tables, tokens, or middleware. | `TYPE` - separate contexts, which a `surface` discriminant keeps unassignable; `REVIEW` - separate tables, per the ERD |
| R-SEC-9 | **Never** expose a stack trace, query, or internal path in a client-facing error. | `RT` global error filter |
| R-SEC-10 | **Never** delete a leaked key's commit and call it handled. Rotate first, investigate second, per the runbook. | `REVIEW` - a process rule, per the runbook |
| R-SEC-11 | **Never** disable TLS verification or strict HTTP parsing, even locally, even "temporarily." | `LINT` - `rejectUnauthorized: false` and equivalents banned, and `insecureHTTPParser: true` with them |
| R-SEC-12 | **Never** merge with a red Dependabot critical alert. | `CI` gate |

### VIII. Sessions and Attendance (R-SESS)

Attendance comes from provider webhooks, never the client, and a session is
evaluated by a scheduled job rather than as a webhook reaction - so evaluation
happens even when the final webhook never arrives. Every session outcome, no-show
count and dispute downstream depends on this being true.

| ID | Rule | Enforced |
|---|---|---|
| R-SESS-1 | **Never** derive attendance from the client. Provider webhooks into `session_participant_events` only. | `TYPE` - no client-writable attendance field exists; `DB` - `provider_event_id` unique |
| R-SESS-2 | **Never** evaluate a session as a webhook reaction. Scheduled job at `scheduled_end + 2m`, so evaluation happens even when the final webhook never arrives. | `CI` - test: a session with a missing end-webhook still settles |
| R-SESS-3 | **Never** settle a session before its scheduled end has passed. | `RT` guard in the evaluation job |
| R-SESS-4 | **Never** penalize a reconnection. Simultaneous time accumulates across drops. | `CI` - the reconnection test case is mandatory |
| R-SESS-5 | **Never** let a suspended, revoked, or banned teacher join any session. | `RT` guard at token issuance, plus a `CI` test |
| R-SESS-6 | **Never** auto-resolve an `under_threshold` or `provider_outage` session. Admin review only; the outcome stays frozen. | `RT` - no automatic transition exists from those states |

### IX. Product Honesty (R-HONEST)

The product never implies something untrue: that the platform verified a payment
it did not see, that an isnad is verified when it is not, that it attests to a
certificate a teacher uploaded, or that a revoked ijazah is still valid. One
user's private fields never reach another user, and no PII rides in a push
payload.

| ID | Rule | Enforced |
|---|---|---|
| R-HONEST-1 | **Never** show a payment as confirmed unless the gateway's signed webhook confirmed it - never from a client redirect, a return URL, a manual toggle, an admin override or an upload, none of which exist as write paths. Never imply the platform holds, guarantees or refunds funds. | `CI` test asserts `confirmed_at` has one write path and no proof-upload endpoint exists; `REVIEW` |
| R-HONEST-2 | **Never** present an unverified isnad as verified. The `unverified` label renders wherever the chain renders. | `CI` - component test on the chain display |
| R-HONEST-3 | **Never** let an uploaded certificate's verification page imply the platform attests its content. The "uploaded by teacher, not platform-generated" statement is mandatory (FR-IJAZAH-14). | `CI` - verification-page test per mode |
| R-HONEST-4 | **Never** expose one user's `is_minor`, DOB, documents, or gender-dispute history to another user. Admin-only fields stay off both public routers. | `TYPE` - output schemas; `CI` field-leak test |
| R-HONEST-5 | **Never** put PII in a push notification payload. IDs for deep-linking only; content rendered in-app. | `TYPE` - payload schema; `REVIEW` |
| R-HONEST-6 | **Never** show a revoked ijazah as valid anywhere - profile, verification page, or PDF link. | `CI` test on all three surfaces |

### X. Process (R-PROC)

No implementation without a spec, and no business rule invented at the keyboard.
When the SRS does not say, work stops and an OPEN item is raised. Green CI is
earned, never manufactured: coverage floors are not lowered and failing tests are
not skipped.

| ID | Rule | Enforced |
|---|---|---|
| R-PROC-1 | **Never** implement without a Spec Kit spec. No spec folder, no branch. Task branches are named `Ejazah_app/<phase>/<task id or range>` and cut from `develop`. | `CI` - the branch name's phase segment must match a `specs/NNN-*` folder; `develop` and `main` are the only exceptions |
| R-PROC-2 | **Never** leave spec and code disagreeing. The spec changes first, then the code. | `REVIEW` |
| R-PROC-3 | **Never** invent a business rule at the keyboard. If the SRS does not say, stop and raise an OPEN item. | `REVIEW`, plus team norm - the most important process rule in the project |
| R-PROC-4 | **Never** push to `main` or `develop` directly, merge without one approving review, or merge red CI. Feature branches merge into `develop` by pull request; `develop` merges into `main` by release pull request (ADR 0005 D9). | `CI` - branch protection on both branches, mechanical |
| R-PROC-5 | **Never** merge a service change without unit tests, or a gender or time change without its adversarial or DST tests updated. | `CI` - per-path coverage floors (research R-13) plus suite gates |
| R-PROC-6 | **Never** add a feature in Phase 6. Hardening means hardening. | `REVIEW`, plus the phase gate itself |
| R-PROC-7 | **Never** disable a lint rule inline without a justification comment and ticket. *(Type escape hatches: R-API-10.)* | `LINT` - `eslint-disable` requires description; `CI` - the same check run again with inline configuration ignored, so that no comment can switch it off, and an unused directive is an error |
| R-PROC-8 | **Never** commit commented-out code or a bare TODO. TODOs carry a ticket reference or do not exist. | `LINT` - `no-warning-comments` configured |
| R-PROC-9 | **Never** edit a generated file (Prisma client, tRPC types, lockfiles by hand). | `CI` - generated-file diff check |
| R-PROC-10 | **Never** lower the coverage floor, skip a failing test, or mark a test `.skip` to get green. Fix or raise it. | `LINT` - `.only` and `.skip` banned in CI; `REVIEW` |
| R-PROC-11 | **Never** **write** a `settings` value from code. Settings change in the admin panel, prospectively, audit-logged. *(Reading them: R-MONEY-12.)* | `LINT` - only the admin module reaches the `settings` table (`api/table-ownership`, R-API-6); `REVIEW` |

## Enforcement Mechanisms

Every rule above carries the strongest mechanism available for it. The tiers, in
descending order of strength:

| Tag | Meaning |
|---|---|
| `LINT` | ESLint, including boundary and custom rules. Violation is a build error on every save and in CI. |
| `TYPE` | The TypeScript compiler. Violation does not compile. |
| `CI` | A pipeline gate. Violation blocks the merge. |
| `DB` | A Postgres constraint, unique index, or revoked privilege. Violation is physically impossible. |
| `RT` | A runtime guard in `platform/`, in a caller kind of `surfaces/`, or in a job. Violation throws before damage. |
| `REVIEW` | Human judgment at PR review - the weakest tier. A rule lands here only when no machine can hold it. |

**One prohibition, one rule.** Where two rules would overlap, the narrower one
owns the case and the broader one cross-references it inline. A new rule that
restates an existing prohibition is rejected; the existing rule is amended
instead.

### The enforcement map

Who holds which rules. This is also the build list for Phase 0
(`specs/001-foundations/`). A rule appears in every row whose mechanism backs it.

| Mechanism | Built in | Holds |
|---|---|---|
| **The internal rule plugin `eslint-plugin-ijazah`** (`packages/config`), including the six `boundaries/*` wall rules, whose wall data lives in `packages/config/eslint.boundaries.js` | Phase 0, workstream 1 | R-MONEY-1/2/5/6, R-TIME-1/6, R-GENDER-4/5, R-MOBILE-1/2/4/5/6/7/8/9/10/11, R-API-1/2/3/4/6/10/15, R-DB-6, R-SEC-2/11, R-PROC-7/8/10/11 |
| **TypeScript** (branded types, schemas, separate routers) | Throughout | R-MONEY-1, R-GENDER-6, R-API-7/11, R-SEC-8, R-SESS-1, R-HONEST-4/5 |
| **Postgres** (constraints, uniques, revoked privileges) | Phase 0, workstream 2 | R-MONEY-8, R-DB-3/5, R-SESS-1, ERD section 15 |
| **Runtime guards** (`platform/`, the caller kinds, jobs) | Phase 0, workstream 3, then per module | R-MONEY-9, R-GENDER-7, R-API-8/12, R-DB-6, R-SEC-3/4/5/6/9, R-SESS-3/5/6 |
| **CI gates** | Phase 0, workstream 1 | R-MONEY-9/12, R-TIME-2/3/4/5/7, R-GENDER-1/2/3, R-MOBILE-7, R-API-9/11/14, R-DB-1/4/7/8, R-SEC-1/4/6/12, R-PROC-1/4/5/7/9 |
| **CI gates** | With the code they hold: Phase 1, R-GENDER-6, R-MOBILE-13, R-HONEST-4; Phase 2, R-HONEST-1; Phase 3, R-GENDER-7, R-SEC-5, R-SESS-2/4/5; Phase 4, R-API-13, R-HONEST-2/3/6 | The rules named in the previous column |
| **PR checklist** | Phase 0 | The twelve rules below: eleven `REVIEW`-only, and R-DB-4, whose declared caches the schema gate checks while whether any other value is derived stays review's |

Roughly 88% of the active rules are held by machines (five R-MONEY rules are superseded and hold nothing). The checklist below is twelve
items a reviewer can hold in their head, not a hundred they will skim past.

## Development Workflow and Quality Gates

### The PR checklist

These twelve rules are the `REVIEW`-only tier, the rules with no machine behind
them, and R-DB-4, which a machine holds only in part (the schema gate checks the
declared caches; whether any other value is derived is judged here). They go on every pull request verbatim. Everything else would be
theatre, because a machine has already blocked it.

- **R-MOBILE-3** - is this genuinely identical between roles, or only roughly similar?
- **R-MOBILE-12** - does any component decide something instead of rendering?
- **R-MOBILE-14** - is any directional icon flipped by hand?
- **R-API-5** - did a vendor concept enter a port interface?
- **R-DB-2** - was a local schema hand-edited rather than reset?
- **R-DB-4** - does this store a derived value?
- **R-DB-9** - is this index backed by a measured slow query?
- **R-SEC-7** - does this introduce custom auth, session, or crypto code?
- **R-SEC-10** - was a leaked key rotated before investigation?
- **R-PROC-2** - do the spec and the code still agree?
- **R-PROC-3** - was a business rule invented at the keyboard?
- **R-PROC-6** - is this a feature disguised as hardening?

### The five rules above all others

If the team remembers nothing else, these five prevent the five unrecoverable
failures:

1. **R-HONEST-1** - a payment is confirmed only by the gateway's signed webhook. The platform never holds money, so the moment it shows a "paid" state it did not receive from the gateway, it is lying to a user about who protects them.
2. **R-GENDER-1** - no opposite-gender data crosses the wire, ever, in any form. This failure is a screenshot, not a bug ticket.
3. **R-TIME-2** - recurrence is resolved per occurrence, never by adding weeks. This bug ships silently and detonates at the DST boundary.
4. **R-SESS-1** - attendance comes from webhooks, never the client. Every session outcome, no-show count and dispute downstream depends on this being true.
5. **R-PROC-3** - if the spec does not say, stop. Every other rule exists because someone, somewhere, did not.

### Order of work

Spec, then plan, then tasks, then code (R-PROC-1). Every requirement carries a
stable SRS ID and every architectural decision carries an ADR. A branch without a
matching `specs/NNN-*` folder does not build. Task branches are cut from
`develop` and named `Ejazah_app/<phase>/<task id or range>` (for example
`Ejazah_app/001-foundations/T001`); they open pull requests into `develop`, and
`develop` reaches `main` through a release pull request. Both merges require
one approving review and green CI (R-PROC-4); direct pushes to either branch are
blocked mechanically. Commit subjects are
`Ejazah_app(<phase>): <task id or range> description`, for example
`Ejazah_app(001-foundations): T001 create the pnpm workspace root`.

## Governance

This constitution supersedes all other practices, conventions and preferences.
Where this document and any other document, comment or habit disagree, this
document wins, and the other document is corrected.

**Amendment procedure.** A rule is added, changed or removed only by amending
this document. An amendment requires a written rationale, approval from the team,
and - when the amendment weakens or removes an existing prohibition - an ADR
recording what replaces the protection. Amendments are prospective: existing code
is not retroactively in violation, but the first PR that touches an affected file
brings it into compliance. Every amendment must name its enforcement mechanism;
a proposed rule with no mechanism stronger than `REVIEW` must justify why no
machine can hold it, and lands on the PR checklist if accepted.

**Versioning policy.** The constitution version tracks the source document,
"Ijazah - The Rules," in MAJOR.MINOR, so that a rule ID cited by a failing check
resolves unambiguously to one version of one document.

- **MAJOR** - a prohibition is removed or redefined in a backward-incompatible
  way, or a principle is deleted.
- **MINOR** - a new rule or principle is added, or existing guidance is
  materially expanded.
- **PATCH** - clarification, wording, typo, or a non-semantic refinement,
  including constitution-local edits that The Rules did not change.

Rule IDs are additive and permanent. An ID is never renumbered, reused or
repurposed; a retired rule is marked superseded and points at what replaces it.
This mirrors R-API-9 and exists for the same reason: citations in old CI logs,
old PRs and old ADRs must keep resolving.

**Compliance review.** Every PR verifies compliance: the machine tiers run
automatically and block, and the reviewer works the twelve-item checklist above.
An escape hatch - `eslint-disable`, `as any`, `@ts-ignore` - requires an inline
justification and a ticket reference (R-PROC-7, R-API-10); it is a debt record,
not a resolution. Complexity must be justified against the simpler alternative
that was rejected.

**Amendment history.**

| Version | Date | Change |
|---|---|---|
| 1.1.0 | 2026-08-25 | Initial ratification, materializing "Ijazah - The Rules" v1.1: ten principles, 99 rules, the enforcement map and the twelve-item PR checklist. |
| 2.4.0 | 2026-10-12 | MINOR (T165, from T130's register `specs/001-foundations/checklists/rule-proofs.md`, owner's decision 2026-10-12): the enforcement map and the rule cells are made to say what holds each rule. Map rows aligned to their cells: R-SEC-1 leaves the lint row (no lint rule holds it); R-SEC-10 carries the `REVIEW` tag; the `RT` tier names the caller kinds and the jobs beside `platform/`, where R-API-12 and R-SESS-3 are held; the CI row is split by the phase that builds each gate, so the Phase 0 row claims only gates Phase 0 built; R-API-13 no longer names disbursement, retired by ADR 0005 and ADR 0007. Tiers claimed without a mechanism, corrected: R-TIME-3 and R-DB-8 are held by the CI schema gate, not by the database; R-SEC-1 no longer names GitHub push protection, unavailable on this repository (second note under T090); R-PROC-11 is held by table ownership (`LINT`, R-API-6) and review, since the application role may write `settings`; R-SEC-8 keeps `TYPE` (T162's `surface` discriminant) and its separate tables become review's, per the ERD; R-MOBILE-13 keeps `CI`, built with the first mobile feature. A mechanism a cell omitted: R-DB-4 gains `CI`, the schema gate's declared-cache and derived-value checks, and stays on the PR checklist, which keeps twelve items, because whether any other value is derived is still judged by a reviewer. R-TIME-6 and R-GENDER-4 move from `TYPE` to `LINT`: T159's `time/no-client-timestamp` and `gender/no-authority-in-input`. Rationale: SC-003 counts a rule claiming a machine mechanism without a failing case as unproven, so a cell that names a mechanism nothing holds is a false claim the count cannot clear. No prohibition is removed or weakened, so no ADR. Follows 2.3.1. |
| 2.3.1 | 2026-10-05 | ADR 0010. PATCH: R-DB-4 lists `sessions.teacher_user_id` and `student_user_id` among the declared caches, copied from the enrollment at generation and never changed, so the exclusion constraints of ERD §15.19 can refuse overlapping sessions. R-DB-4 already permitted a new cache through an ADR, so no prohibition changed. Follows 2.3.0. |
| 2.3.0 | 2026-10-05 | MINOR (review of PR #29, T040): R-SEC-11 is expanded. It now names strict HTTP parsing beside TLS verification, so switching on a lenient HTTP parser is prohibited by the rule's own words, and the enforcement cell names `insecureHTTPParser: true` beside `rejectUnauthorized: false`. `sec/no-disabled-tls` has refused that option since PR #29, by the owner's recorded decision that a lenient parser is what request smuggling needs; this amendment gives that refusal its text. The enforcement cell of R-PROC-7, and with it the CI rows of the enforcement map and of the lint contract, gain a pipeline half (review of PR #31, T139 and T140): the suppression check is run a second time with inline configuration ignored, because a comment could switch the rule off in the first run, and an unused directive becomes an error. The prohibition of R-PROC-7 is unchanged. No prohibition removed or weakened, so no ADR. Follows 2.2.0. |
| 2.2.0 | 2026-10-05 | MINOR (reviews of PR #27 and PR #30, T047): R-API-6 is expanded. The access path is the repository of the owning module or of the kernel. Runtime raw SQL is confined to the platform kernel (`apps/api/src/platform/db/`) and its string-taking `Unsafe` forms are written nowhere in the API; the enforcement cell names repository files, the refusal of database client members other than `$transaction` outside `platform/db/`, and review for what lint cannot see (a database driver used directly, `Prisma.raw`). R-API-2 gains an inline cross-reference to R-API-6 for a query through an injected client, as "One prohibition, one rule" requires. Rationale: a raw query names its table where the per-module allowlist cannot read it, so it was a way around the rule as written. No prohibition removed or weakened, so no ADR. Follows 2.1.3. |
| 2.1.3 | 2026-09-27 | PATCH (PR #20, T035): the R-MOBILE-1 enforcement cell and the enforcement-map row name the six `boundaries/*` rules of `eslint-plugin-ijazah`, with wall data in `packages/config/eslint.boundaries.js`, instead of `eslint-plugin-boundaries`. No prohibition changed. Follows 2.1.2 (ADR 0009, PR #21). |
| 2.1.2 | 2026-09-27 | ADR 0009. PATCH: R-DB-4 lists `sessions.scheduled_start_at` and `scheduled_end_at` among the declared caches, derived from the session's stored local time and zone and recomputed when time zone data changes. R-DB-4 already permitted a new cache through an ADR, so no prohibition changed. |
| 2.1.1 | 2026-09-06 | PATCH: commit subject and task-branch naming stated in R-PROC-1 and Order of work — `Ejazah_app(<phase>): <task> description` and `Ejazah_app/<phase>/<task>`. No prohibition changed. |
| 2.1.0 | 2026-09-06 | ADR 0007. MINOR: direct gateway checkout with 0% commission and zero custody. R-MONEY-8 and R-MONEY-9 reinstated for gateway events; R-MONEY-6 redefined to confine money-carrying records to `payments`; R-HONEST-1 redefined so a paid state has exactly one write path (the signed webhook); enforcement map updated. R-MONEY-3/4/7/10/11 remain superseded. |
| 2.0.0 | 2026-09-05 | ADR 0005. MAJOR: the platform no longer processes payments. R-MONEY-3/4/7/8/9/10/11 superseded (ids retained); R-MONEY-6 redefined as a codebase-wide ban on money-movement vocabulary; R-MONEY-12 gate widened to every module; R-HONEST-1 generalised beyond "Mode A"; R-DB-3, R-API-14, R-SESS intro and R-SESS-6 lose their ledger cross-references; R-PROC-1/4 define `develop` as the integration branch; R-PROC-5 references per-path coverage floors; enforcement map and "five rules" recomputed. The twelve-item PR checklist is unchanged. |

The v1.0 to v1.1 deduplication that produced this content: payment-logging merged
into R-SEC-2; secret-sharing channels merged into R-SEC-1; ledger deletion owned
by R-MONEY-4 with R-DB-3 cross-referencing; aggregate filtering owned by
R-GENDER-3; settings split into read (R-MONEY-12) and write (R-PROC-11);
datetime split into domain resolution (R-TIME-1) and display formatting
(R-MOBILE-9); content sniffing owned by R-SEC-4 with R-SEC-5 owning the chat
policy; idempotency split into money operations (R-MONEY-8) and jobs generally
(R-API-14); R-SEC and R-MONEY renumbered from 13 rules to 12; the enforcement map
recomputed and the checklist redefined as the `REVIEW`-only tier.

**Version**: 2.4.0 | **Ratified**: 2026-08-25 | **Last Amended**: 2026-10-12
