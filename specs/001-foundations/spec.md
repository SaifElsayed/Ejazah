# Feature Specification: Phase 0 — Foundations

**Feature Branch**: `001-foundations`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "Read PLAN.md and create a specification for the Phase 0: Foundations"

## Overview

**Objective, from PLAN.md**: build the repository, data model and platform kernel
every later phase depends on.

Phase 0 ships no user-facing capability. What it ships is the structure the six
phases after it are built inside, and the machinery that refuses to let them
break the rules in `.specify/memory/constitution.md`. The constitution states 99
prohibitions and assigns roughly 88% of them to a machine — a compiler, a linter,
a pipeline gate, a database privilege — precisely because a rule enforced by
memory will eventually be broken. Phase 0 is where those machines are built.

PLAN.md gives the reason the phase stands alone: *"because every later phase
depends on it, and because boundary lint that arrives in Week 6 is boundary lint
already violated."* The argument generalises. A constraint introduced after the
code it governs arrives to find violations already in place.

**Scope boundary.** This phase delivers enforcement, structure, the complete but
empty data model, and closed answers to two technical unknowns. It delivers no
authentication, no onboarding, no discovery, no booking, no live session, no
certification and no payment flow — those are Phases 1 through 5. It delivers no
adapter against a real third-party provider either, apart from storage; every
other port ships with its interface and a stand-in, and meets its provider in the
phase that first calls it. A guard built here is proven by a deliberate
violation, not by a product journey, because the journeys it protects do not
exist yet.

**Provenance.** Every requirement traces to a line in PLAN.md's Phase 0
deliverables or definition of done, to a rule identifier in the constitution, or
to a table or rule in `docs/ERD.md` v1.0. Nothing is derived from source code
presently in the repository; this specification describes what must become true,
not what any file currently does.

## Clarifications

### Session 2026-08-26

- Q: Should Phase 0 build working adapters against the real third-party providers for payment, video, push and SMS, or only the port interfaces plus fake implementations? → A: Ports and fakes only, plus the two storage implementations PLAN.md names. Each real provider adapter lands in the phase that first calls it.
- Q: How many database roles should Phase 0 create, and which one runs migrations? → A: Two. An owner that holds the schema and runs migrations, and an application role carrying the revocations that never runs a migration.
- Q: What should the 80% test coverage floor apply to in Phase 0, when the phase produces no feature modules? → A: The shared packages where logic lives (money, time) plus the kernel's guard and error paths. The floor extends to each domain module as that module is created.
- Q: Is the data model complete at 35 tables, or is a table genuinely missing? → A: Superseded by ADR 0005 D1 and ADR 0007: the five managed-payment tables were removed and two gateway-record tables added; the model is complete at 32.
- Q: Should `audit_logs` keep a soft-deletion column, or be strictly append-only? → A: Strictly append-only. DELETE revoked, no deletion column, no removal path at all.

## User Scenarios & Testing *(mandatory)*

The people served by this phase are the ones who build and operate the product:
an engineer joining the team, a reviewer approving a change, an operator handling
an incident, and an auditor asking whether a financial record could have been
altered. Each story is independently demonstrable and names the PLAN.md
deliverables it covers.

### User Story 1 - A violation is refused before a human has to notice it (Priority: P1)

An engineer writes something the project forbids — a crossed boundary, a mistyped
money value, a hand-built date, a hardcoded string, a raw colour, a committed
secret. The attempt fails in the editor, at the commit, or in the pipeline, and
the failure names the rule that was broken. No reviewer had to catch it, and no
reviewer could have chosen to let it through.

*Covers PLAN.md: "Security baseline before first feature commit", "Boundary lint
for modules and mobile wall".*

**Why this priority**: This is the phase's whole argument. Every rule the machine
does not hold falls back to human memory, and the constitution exists because
memory fails. It is also the deliverable with the shortest useful life if
delayed — a boundary rule written after the boundaries have been crossed is
archaeology, not enforcement.

**Independent Test**: For each rule the constitution assigns to a build-time,
compile-time or pipeline mechanism, write a deliberate violation on a throwaway
branch. Each must be refused, and the refusal must identify the rule.

**Acceptance Scenarios**:

1. **Given** a file in the student feature tree, **When** it imports from the teacher feature tree, **Then** the build fails naming R-MOBILE-1; and the reverse direction fails identically.
2. **Given** a file in the shared feature tree, **When** it imports from either role tree, **Then** the build fails naming R-MOBILE-2.
3. **Given** a feature file, **When** it contains a raw colour value or a raw spacing number, **Then** the build fails naming R-MOBILE-4.
4. **Given** a feature file, **When** it uses a physical direction utility instead of a logical one, **Then** the build fails naming R-MOBILE-5.
5. **Given** a user-facing string written as a literal, **When** the build runs, **Then** it fails naming R-MOBILE-7; and **Given** a translation key present in one language file but absent from the other, **When** the pipeline runs, **Then** the parity check fails.
6. **Given** a value representing money, **When** it is used in arithmetic outside the money package or interchanged with a plain number, **Then** the code does not compile or the build fails naming R-MONEY-1 or R-MONEY-5.
7. **Given** a money-carrying identifier whose name does not end in the piaster suffix, **When** the build runs, **Then** it fails naming R-MONEY-2.
8. **Given** any file outside the time package, **When** it constructs or resolves a domain datetime directly, **Then** the build fails naming R-TIME-1.
9. **Given** a service file that imports the database client, **When** the build runs, **Then** it fails naming R-API-2; and **Given** a module imported by a path deeper than its public entry, **Then** the build fails naming R-API-3.
10. **Given** a repository method returning teachers whose signature omits the requester's gender, **When** the build runs, **Then** it fails naming R-GENDER-5.
11. **Given** a type or lint escape hatch with no justification comment and ticket reference, **When** the build runs, **Then** it fails naming R-API-10 or R-PROC-7; and **Given** a comment that switches that lint check itself off, **When** the pipeline runs, **Then** the unjustified suppression is still refused.
12. **Given** a value resembling a secret, **When** it is committed, **Then** the local check refuses it; and **When** it reaches the pipeline by any path including the specs directory, **Then** the pipeline fails naming R-SEC-1.
13. **Given** code that disables transport security verification or switches on a lenient HTTP parser, **When** the build runs, **Then** it fails naming R-SEC-11.
14. **Given** a test marked skipped or exclusive, or a bare comment marker carrying no ticket, **When** the pipeline runs, **Then** it fails naming R-PROC-10 or R-PROC-8.

---

### User Story 2 - The database refuses what the rules forbid (Priority: P1)

An operator, a careless migration or a compromised path attempts something the
constitution prohibits: deleting an audit record, hard-deleting a user or an
ijazah, replaying a provider attendance event. The database refuses, because the
privilege was never granted and the constraint was never optional. No application
code was consulted.

*Covers PLAN.md: "Full Prisma schema, multi-file", "Database-level integrity
rules and role-level delete revocation", and the definition of done item "DELETE
revoked at Postgres role level". The model is `docs/ERD.md` v1.3 (33 tables); the
integrity rules are its section 15, extended per FR-030 below.*

**Why this priority**: These are the failures with no repair. A deleted ijazah
destroys a permanent religious record; a deleted audit record makes an
investigation impossible. Protection that lives in application code can
be bypassed by the next code path someone writes, so it has to sit underneath the
application instead.

**Independent Test**: Connect as the application's own database role and attempt
each forbidden statement directly, with no application code in the path. Every
attempt must be rejected by the database itself.

**Acceptance Scenarios**:

1. *Retired (ADR 0005 D1).* Was the ledger update/delete probe. Number kept so citations resolve.
2. **Given** a row in the ijazah, session, enrollment or user tables, **When** the application role attempts to delete it, **Then** the database refuses, and removal is instead recorded by setting that table's deletion timestamp, leaving the row in place (R-DB-3).
3. **Given** an audit record, **When** deletion is attempted by any means, **Then** it fails: the table has no deletion column and delete is revoked, so there is no path by which an administrative action can be removed from the record (R-DB-3, R-API-12).
4. **Given** a row whose deletion timestamp is set, **When** it is read through any ordinary query, aggregate or count, **Then** it is excluded by default, and **When** a uniqueness constraint governs a value that a deleted row still holds, **Then** the constraint's declared behaviour toward deleted rows is explicit rather than accidental.
5. *Retired (ADR 0005 D1).* Was the ledger soft-deletion probe.
6. **Given** a provider attendance event or a gateway payment event, **When** it is inserted with a provider event identifier already present, **Then** uniqueness refuses it, so a replayed webhook cannot double-insert (R-SESS-1, R-MONEY-8, ERD §15.4, §15.13).
7. **Given** the schema, **When** it is inspected, **Then** every timestamp column carries a timezone and ends in the absolute-instant suffix, every local wall-clock column ends in the local suffix and sits beside a zone column, and every money column ends in the piaster suffix (R-TIME-4, R-TIME-5, R-MONEY-2).
8. **Given** a record violating one of the declared cross-field invariants — a contact with neither phone nor email, a self-enrollment, a second review on one enrollment, a repeated provider event, a chain with two names at one position, a message with neither body nor attachment, a rating outside one to five — **When** it is inserted, **Then** a constraint refuses it (R-DB-5, ERD §15).
9. **Given** a secret that must be verified, **When** it is stored, **Then** it is hashed; and **Given** one that must be recovered or presented — a multi-factor secret, a national identity document reference, a provider push token — **When** it is stored, **Then** it is encrypted (R-DB-7, R-DB-8).
10. **Given** the schema, **When** it is searched for any wallet, ledger, balance or escrow column, **Then** none exists; the only money columns are package prices, their enrollment snapshot, and the gross, fee and net the gateway reported on a payment record (R-MONEY-6, FR-PAYG-7).
11. **Given** the schema, **When** administrator identity is compared with user identity, **Then** they share no table (R-SEC-8).
12. **Given** the schema, **When** it is searched for stored derived values, **Then** only the six cached columns R-DB-4 declares exist, `teacher_profiles.average_rating`, `teacher_profiles.review_count`, `sessions.scheduled_start_at`, `sessions.scheduled_end_at`, `sessions.teacher_user_id`, `sessions.student_user_id`, each recorded in the model documentation (R-DB-4, ADR 0009, ADR 0010).
13. **Given** a merged migration, **When** its content is altered rather than superseded, **Then** the pipeline fails checksum verification (R-DB-1).
14. **Given** an empty database, **When** the full migration history is applied, **Then** it completes in one run with no manual step and produces the complete model.

---

### User Story 3 - An engineer reaches an identical running system in one sitting (Priority: P1)

An engineer clones the repository, follows the written setup, and reaches a
running system holding data identical to every teammate's. They ask no one for a
credential, a database dump or a missing step.

*Covers PLAN.md: "Monorepo", "Docker Compose local environment", "Seed data
identical on every machine", and the definition of done item "Migrations run
clean from empty database".*

**Why this priority**: Nothing else in the phase can be demonstrated until the
system runs, and divergence between machines becomes expensive the moment two
people debug different data while believing they share it.

**Independent Test**: On a machine that has never seen the project, follow only
the written steps and reach a running seeded system. Compare a checksum of the
seeded dataset against a teammate's.

**Acceptance Scenarios**:

1. **Given** a clean machine with only the documented prerequisites, **When** the written setup steps are followed in order, **Then** all three applications and their supporting services start, and no step requires a secret absent from the example environment file.
2. **Given** two engineers who have each seeded locally, **When** the datasets are compared, **Then** they are identical, including generated identifiers.
3. **Given** a seed that has already run, **When** it runs a second time, **Then** the result equals a single run.
4. **Given** two engineers seeding on different dates, in different machine timezones, **When** the datasets are compared, **Then** they are still identical, so the seed depends on neither the machine clock nor its zone.
5. **Given** a local database that has diverged from the migration history, **When** the recorded recovery procedure is followed, **Then** it is rebuilt from migrations rather than patched by hand (R-DB-2).

---

### User Story 4 - A proven change reaches staging with nobody deploying it (Priority: P2)

A reviewer approves a change. The pipeline has already proven it typechecks,
lints, tests and builds. On merge it becomes live on a staging environment
reachable from outside the team's network, with no manual step and no one holding
a deployment key.

*Covers PLAN.md: "CI pipeline and automatic staging deploy", and the definition
of done items "CI green on typecheck, lint, test, build", "Secret scanning and
branch protection enforced", "Staging deploys automatically from `main`".*

**Why this priority**: Several later phases have definitions of done requiring an
outside network or a reviewer's own device, so automatic staging is what makes
them testable at all. It ranks below the P1 stories because a correct pipeline
that deploys by hand is still a correct pipeline.

**Independent Test**: Merge a trivial visible change and watch it reach staging
unaided. Separately, attempt each forbidden merge path and confirm refusal.

**Acceptance Scenarios**:

1. **Given** an open change, **When** typecheck, lint, test or build fails, **Then** merge is blocked (R-PROC-4).
2. **Given** a change with no approving review, **When** merge is attempted, **Then** it is blocked; and **Given** an engineer with write access, **When** they push directly to the default branch, **Then** the push is refused (R-PROC-4).
3. **Given** a merge to the default branch, **When** the pipeline completes, **Then** the change is live on staging with no human action.
4. **Given** an open critical dependency alert, **When** merge is attempted, **Then** it is blocked (R-SEC-12).
5. **Given** a hand-edited generated file, **When** the pipeline runs, **Then** it fails naming R-PROC-9.
6. **Given** a branch that does not correspond to a spec directory, **When** the pipeline runs, **Then** it fails naming R-PROC-1.
7. **Given** a removal or rename of a published procedure, field or enum value, **When** the pipeline compares against the recorded contract snapshot, **Then** it fails naming R-API-9.
8. **Given** coverage below the declared floor in a covered area — in this phase the money and time packages and the kernel's guard and error paths — **When** the pipeline runs, **Then** it fails naming R-PROC-5.
9. **Given** a change opened for review, **When** the reviewer reads the template, **Then** it carries the twelve review-only checklist items and no others.

---

### User Story 5 - Every request inherits safe behaviour from the kernel (Priority: P2)

A request arrives. Configuration was validated before the process accepted
traffic. The request is logged without leaking anything sensitive. A failure
anywhere in the stack reaches the client as one predictable shape. Repeated work
is recognised rather than repeated, abusive volume is throttled, and an
administrative action cannot complete without leaving an audit record — none of
which the author of a future feature has to remember to write.

*Covers PLAN.md: "Platform kernel: config, logging, errors, guards,
idempotency", "tRPC context, four procedure types, two separate routers",
"Sentry, health and readiness endpoints".*

**Why this priority**: Every later phase inherits this behaviour. Building it once
here stops twelve modules from each inventing a weaker version, and it is the
difference between a security property and a security habit.

**Independent Test**: Start the system with an invalid configuration and confirm
it refuses to start. Then drive a request that fails deep in the stack and
inspect exactly what the client receives and what the log recorded.

**Acceptance Scenarios**:

1. **Given** a required configuration value missing or malformed, **When** the process starts, **Then** it exits naming the offending value, before accepting any traffic.
2. **Given** a failure at any depth, **When** the response is returned, **Then** it carries one consistent shape of code, message and optional details, containing no stack trace, query text or internal path (R-API-8, R-SEC-9).
3. **Given** a logged request, **When** the record is inspected, **Then** it carries a correlating request identifier and contains no request body, token, one-time code, session identifier, document link or provider credential (R-SEC-2).
4. **Given** an operation carrying an idempotency key, **When** it is submitted twice, **Then** the second submission returns the first outcome without repeating the effect (R-API-14).
5. **Given** an authentication, one-time-code, search or payment-initiation endpoint, **When** it is called beyond its configured limit, **Then** further calls are throttled (R-SEC-6).
6. **Given** an upload whose declared type disagrees with its actual content, **When** it is accepted, **Then** the content decides and the declaration is ignored (R-SEC-4).
7. **Given** an identifier intended to be publicly visible — a certificate number, a verification token — **When** it is generated, **Then** it is unguessable and drawn from a cryptographic source, and no code path may use a non-cryptographic one (R-DB-6).
8. **Given** the two request surfaces, **When** the user surface's generated client types are inspected, **Then** no administrative capability appears in them, and a test asserts the two capability sets are disjoint (R-API-11).
9. **Given** four distinct caller kinds — unauthenticated, student, teacher and administrator — **When** an endpoint declares which it serves, **Then** the caller's identity, role and gender come from the server-held session and never from client input (R-GENDER-4).
10. **Given** an administrative action, **When** it completes, **Then** the shared administrative path has already written the audit record, leaving no administrative route that bypasses auditing (R-API-12).
11. **Given** an operational number such as a fee, commission, threshold or window, **When** it is read, **Then** it comes from stored settings rather than a constant, and no code path can write a settings value (R-MONEY-12, R-PROC-11).
12. **Given** the running system, **When** it is asked whether it is alive and separately whether its dependencies are reachable, **Then** the two answers are distinguishable; and **When** an unhandled error occurs, **Then** it is reported to the error-tracking destination.
13. **Given** a browser-facing response, **When** its headers are inspected, **Then** the security headers are present; and **Given** a cross-origin request, **When** its origin is not on the configured allowlist, **Then** it is refused, and no configuration can express a wildcard origin (NFR-SEC-11).

---

### User Story 6 - Nothing in the domain knows a vendor's name (Priority: P2)

Payment, video, push, storage and messaging are reached only through the
project's own definitions, each with a working stand-in behind it. The complete
test suite runs on a machine holding no third-party credential, and swapping a
provider is a configuration change.

*Covers PLAN.md: "Port interfaces with fake adapters", "Storage adapters: local
and S3", and the definition of done item "Every port has a working fake adapter".*

**Why this priority**: It decides whether later phases can be tested at all, and
it is the structural protection behind the rule that no vendor concept enters the
domain. Its failure is expensive rather than unrecoverable, which places it below
the P1 stories.

**Independent Test**: Clear every third-party credential from the environment and
run the complete suite. It must pass.

**Acceptance Scenarios**:

1. **Given** an environment holding no third-party credential, **When** the full test suite runs, **Then** every test passes against stand-in implementations.
2. **Given** a port definition, **When** it is read, **Then** its operations are named in the project's own terms and no vendor concept appears in the interface (R-API-5).
3. **Given** any module or background job, **When** it imports a concrete provider implementation instead of the port, **Then** the build fails naming R-API-4.
4. **Given** the storage port, **When** it is searched for an operation returning a publicly reachable path, **Then** none exists; every stored document, certificate, attachment, signature and photo is reached only by a signed, expiring link (R-SEC-3).
5. **Given** a local and a remote storage implementation, **When** the deployment switches between them, **Then** the change is made in configuration and requires no code change.
6. **Given** the payment port or the storage port, **When** the deployment switches between the stand-in and a real implementation, or between two real ones, **Then** it is one configuration value, not a second path through any calling module.
7. **Given** notification delivery, **When** it is reached from anywhere other than the queued notification job, **Then** the build fails naming R-API-15.

---

### User Story 7 - Two named risks are closed with written evidence (Priority: P3)

Two technical unknowns that could invalidate later plans are tested on real
hardware and closed with a recorded outcome: whether the video baseline holds on
the devices and networks the audience actually uses, and whether an Arabic
right-to-left certificate renders correctly with a long chain of transmission.

*Covers PLAN.md: "Spike: video baseline on real devices", "Spike: Arabic RTL PDF
with 25-entry chain", and the definition of done item "Both spikes closed with a
written outcome".*

**Why this priority**: Each can invalidate a later phase's plan, so they belong
early. They rank P3 because they produce a decision rather than a running
capability, and the rest of the phase does not wait on them.

**Independent Test**: Read the two written outcomes. Each must state what was
tested, on what hardware and network, what was observed, and what was decided.

**Acceptance Scenarios**:

1. **Given** the video spike, **When** a session is held between real devices over a mobile network, **Then** the observed behaviour and a keep-or-change recommendation are recorded in writing.
2. **Given** the certificate spike, **When** a document is rendered in Arabic carrying a chain of twenty-five entries, **Then** the output is inspected for correct right-to-left layout, correct letter shaping and correct pagination, and the outcome is recorded in writing.
3. **Given** either spike concluding against the assumed approach, **When** the outcome is recorded, **Then** it is captured as an architectural decision record rather than only as a note.

---

### Edge Cases

- **A local database drifts from the migration history.** The recorded procedure rebuilds it from migrations; there is no supported patch-in-place path (R-DB-2).
- **A merged migration is edited instead of superseded.** Checksum verification fails the pipeline, and the correction is a new migration (R-DB-1).
- **A secret is committed, then "handled" by deleting the commit.** The recorded procedure requires rotation first and investigation second. Removing the commit alone does not close the incident (R-SEC-10).
- **A local wall-clock time is asked for that does not exist,** because the clock jumped forward, **or that occurs twice,** because it fell back. The first shifts forward, the second takes the first occurrence, and each carries a mandatory test (R-TIME-7).
- **The data model and the constitution disagree.** The constitution governs and the model is amended, with the amendment recorded. Six such disagreements are already known and are listed under Assumptions; each is resolved within this phase rather than deferred.
- **A soft-deleted row still holds a unique value.** A deleted user's phone number, a deleted enrollment's single review: the model states for each such constraint whether the deleted row keeps occupying the value or releases it. Leaving this to whatever the database happens to do is how a person becomes unable to sign up again with their own number.
- **A rule's assigned mechanism turns out to be unbuildable as designed.** It does not silently drop to human review. The gap is recorded, and either the mechanism is replaced or the constitution is amended.
- **The pipeline appears to need a third-party credential to pass.** It must not. The suite runs against stand-ins, so a missing or rotated credential degrades no gate.
- **A gender enforcement gate is wired before any teacher data exists to protect.** The gate and its harness run from this phase; case coverage grows in Phase 2 when there is data to attack. An empty suite that runs is not the same as a suite that does not exist.
- **A module needs data owned by another module.** It goes through the owning module's public entry. No path reaches another module's tables (R-API-6).
- **Two modules need the same rule.** It lives in one place. A rule existing in two places is a defect even when both copies agree.

## Requirements *(mandatory)*

Each requirement traces to a PLAN.md Phase 0 line, a constitution rule
identifier, or a section of `docs/ERD.md` v1.0.

### Functional Requirements

**Repository structure**

- **FR-001**: The repository MUST be organised as three applications — a mobile experience for students and teachers, a web back office for administrators, and one backend serving both — together with shared packages covering the common contract surface, money, time and shared configuration. Each MUST typecheck, lint, test and build independently.
- **FR-002**: Each backend module MUST carry a written statement naming what it owns and what it must never do, alongside its rules, its queries, its request surface, its tests and its single public entry. The module set MUST match the domain grouping in ERD section 1, so that each group of tables has exactly one owning module.
- **FR-003**: Business rules MUST live in exactly one place per rule. A rule expressed in two locations is a defect regardless of whether the copies currently agree.

**Boundary and rule enforcement**

- **FR-004**: The system MUST refuse at build time any import crossing a declared boundary: between the two role trees, into shared from either role tree, into a module by a path deeper than its public entry, into a concrete provider implementation from outside its own port folder, and upward into the administrative module (R-MOBILE-1, R-MOBILE-2, R-API-3, R-API-4).
- **FR-005**: The system MUST refuse at build time a database client import outside a repository file, and MUST restrict each module's database access to the tables its domain owns per ERD section 1, reached from its repository files only, with runtime raw SQL confined to the platform kernel (R-API-2, R-API-6).
- **FR-006**: The system MUST refuse at build time: a raw colour or spacing value in a feature file; a physical direction utility; a hardcoded user-facing string; a sentence assembled by concatenating translated fragments; a hand-written date, time or number format outside the shared formatting layer; a direct network call bypassing the shared client; and sensitive storage outside the secure storage layer (R-MOBILE-4 through R-MOBILE-11).
- **FR-007**: The system MUST refuse at build time a component composed from raw platform controls rather than from the shared primitives (R-MOBILE-6).
- **FR-008**: The system MUST refuse at build time an escape hatch — a suppressed type error or a disabled lint rule — carrying no justification comment and ticket reference (R-API-10, R-PROC-7). The pipeline MUST apply the lint half of this check a second time with inline configuration ignored, so that no comment can switch the check off, and MUST refuse a lint suppression that no longer suppresses anything.
- **FR-009**: The system MUST refuse at build time any disabling of transport security verification or of strict HTTP parsing, in every environment including local development (R-SEC-11).
- **FR-010**: The system MUST refuse at build time a logging call receiving a raw request body or another prohibited value (R-SEC-2).
- **FR-071**: The system MUST refuse at build time a request procedure carrying a business rule rather than validating its input, calling one service method and returning (R-API-1).
- **FR-011**: Every build-time refusal MUST name the rule identifier it enforces, so a failure is traceable to the constitution without a reviewer's interpretation.

**Money**

- **FR-012**: The money package MUST expose money as a distinct type that cannot be interchanged with a plain number in either direction, so a plain number cannot be passed where money is expected and money cannot be passed where a plain number is expected (R-MONEY-1).
- **FR-013**: The system MUST refuse at build time any arithmetic on a money value outside the money package (R-MONEY-5).
- **FR-014**: The system MUST refuse at build time a money-carrying identifier whose name does not end in the piaster suffix (R-MONEY-2).
- **FR-015**: *Retired (ADR 0005 D1).* Was share splitting; there are no shares.
- **FR-072**: The system MUST refuse at build time a declared money position typed as a plain number rather than the money type, so the guarantee of FR-012 cannot be sidestepped by annotating the position as a number (R-MONEY-1).
- **FR-073**: Every inbound gateway event MUST be recorded with a provider event identifier that is both unique and non-nullable before it is acted on, so a replayed webhook is acknowledged and has no effect (R-MONEY-8, ADR 0007).
- **FR-074**: The kernel MUST provide a webhook signature guard that verifies a gateway or provider signature on the raw request body before any handler runs, rejecting unsigned or invalid requests; the payment port's stand-in MUST be able to produce both valid and invalid signatures so the guard is testable without a network (R-MONEY-9, R-SEC-12).
- **FR-075**: The teacher profile MUST carry payout readiness as an encrypted gateway recipient reference plus configuration and verification timestamps, with no raw account number stored, so the Phase 2 bookability gate has a column to test (R-DB-8, FR-PAYG-13/14).
- **FR-076**: The kernel MUST set browser security headers (Content Security Policy, Strict-Transport-Security, X-Content-Type-Options, frame-ancestors) once, through a proven middleware, on every browser-facing surface, and MUST answer cross-origin requests only for an explicit allowlist of origins read from configuration, refusing a wildcard. The allowlist is the configuration value `ADMIN_ALLOWED_ORIGINS`, validated at startup. The host that serves the Admin panel's HTML sends the same headers; where that host is not the API, the staging decision (research R-18) records it (NFR-SEC-11, OWASP ASVS 5.0 V3).
- **FR-077**: The kernel MUST refuse a request body larger than a limit read from configuration, on every request surface, before reading it whole, answering with the one error shape (FR-041) and a stable code rather than as an unexpected failure, so one request cannot make the process read and hold an unbounded body (OWASP API4, unrestricted resource consumption). File uploads keep their own limit (NFR-SEC-9). Added by the review of PR #43.
- **FR-016**: Wallet, ledger, balance, escrow and platform-held-funds concepts MUST be refused at build time anywhere in the applications; money-carrying records MUST be confined to the payments module, reached by every other module only through the payment port or that module's public entry (R-MONEY-6).

**Time**

- **FR-017**: The time package MUST be the only place a domain datetime is constructed or resolved, and the system MUST refuse direct date arithmetic and third-party datetime libraries everywhere else (R-TIME-1).
- **FR-018**: The time package MUST resolve each recurring occurrence independently, from that occurrence's own local date and the slot's local time in the relevant zone, and MUST NOT advance by fixed multiples of twenty-four hours. This MUST be proven against real Cairo daylight-saving transition dates (R-TIME-2).
- **FR-019**: The time package MUST handle a nonexistent local time by shifting forward and an ambiguous local time by taking the first occurrence, each carrying a mandatory test (R-TIME-7).
- **FR-020**: Availability MUST be stored as local wall-clock time with a named zone. A scheduled session's schedule MUST likewise be its requested local date, local start time and zone, and its absolute start and end instants MUST be derived from them at generation and recomputed when the time zone data changes (ADR 0009). Local values and instants MUST be distinguishable in the model and never conflated (R-TIME-3, ERD sections 4 and 5).
- **FR-021**: The system MUST accept no client-supplied timestamp for any decision that matters, by admitting no such field in any write schema (R-TIME-6).

**Data model**

- **FR-022**: The schema MUST implement the complete model defined in `docs/ERD.md` — every table in its section 1 domain map — defined as one file per domain, and MUST apply to an empty database in a single clean run. No table outside the model may be added; a feature needing one is out of spec and stops for an amendment. The model is taken as complete at its current thirty-three tables for the purpose of building this phase, and MUST be re-checked against the SRS once the SRS is populated; any table found missing then is added by amendment rather than treated as a defect in this phase.
- **FR-023**: The schema MUST observe the binding conventions of ERD section 0: time-ordered UUID primary keys, integer piaster money columns carrying the piaster suffix, timezone-carrying timestamps carrying the instant suffix, local wall-clock columns carrying the local suffix beside a zone column, assertion-style boolean names, enumerations declared once, and terminal states expressed as status values rather than deletions.
- **FR-024**: Every timestamp column MUST carry a timezone, and a schema check MUST fail the pipeline on any column violating the naming and timezone conventions (R-TIME-4, R-TIME-5).
- **FR-025**: The database MUST have exactly two roles: an owner that holds the schema and is the only role permitted to run migrations, and an application role that the running system connects as and that never runs a migration. Every privilege revocation in this specification applies to the application role and is applied by the owner, so the code being constrained cannot lift its own constraint. The revocations are those of FR-026.
- **FR-026**: The application's database role MUST have delete revoked on the audit log, ijazah, session, enrollment and user tables (R-DB-3). The user, session, enrollment and ijazah tables MUST each carry a deletion timestamp column so removal is expressed as a soft deletion rather than being impossible; ordinary reads, aggregates and counts MUST exclude soft-deleted rows by default; and every uniqueness constraint over a value a soft-deleted row still holds MUST state explicitly whether that row continues to occupy the value. One table MUST have no removal path at all: the audit log, which MUST be strictly append-only, because its only purpose is to record what administrators did and its only reader is someone checking whether they acted properly.
- **FR-027**: The schema MUST contain no wallet, ledger, balance or escrow column. The only money columns are package prices, their enrollment snapshot, and the gross, fee and net amounts recorded from the gateway on a payment record, never computed by the platform (R-MONEY-5, R-MONEY-6, ERD section 7).
- **FR-028**: *Retired (ADR 0005 D1).* Its substance for gateway events is FR-073.
- **FR-029**: *Retired (ADR 0005 D1).* Was ledger compensating entries.
- **FR-030**: Every integrity rule in ERD section 15 MUST be implemented in the schema rather than in application code, and the set MUST be extended to cover every invariant the constitution assigns to the database (R-DB-5).
- **FR-031**: Secrets that must be verified MUST be stored hashed; secrets that must be recovered or presented to a third party MUST be stored encrypted. Neither category may be stored in plain text (R-DB-7, R-DB-8).
- **FR-032**: Administrator identity MUST share no table, token or middleware path with user identity (R-SEC-8, ERD section 12).
- **FR-033**: The model MUST store no derived value beyond the caches the constitution declares in R-DB-4: `teacher_profiles.average_rating`, `teacher_profiles.review_count`, `sessions.scheduled_start_at` and `sessions.scheduled_end_at` (ADR 0009), `sessions.teacher_user_id` and `sessions.student_user_id` (ADR 0010). Every other derived quantity MUST be computed on read, and any additional cache MUST be justified by a recorded architectural decision before it exists (R-DB-4).
- **FR-034**: Every operational number — a fee, a commission, a threshold, a window — MUST be read from the settings store at the moment it is needed and MUST NOT exist as a constant anywhere in code. The store MUST be writable only through the administrative surface, with the change audit-logged. Scheduling a change for a future moment is not required: a change applies from when it is made, and terms already agreed are protected by the snapshot an enrollment takes at purchase (R-MONEY-12, R-PROC-11).
- **FR-035**: Indexes MUST be limited to primary keys, uniques, foreign keys and the composites declared in ERD section 14. Any addition MUST be justified by a measured slow query (R-DB-9).
- **FR-036**: Attendance MUST be modelled as provider-reported events keyed uniquely by the provider's own event identifier, with no client-writable attendance field anywhere in the model (R-SESS-1, ERD section 5).
- **FR-037**: Migrations MUST be verified by checksum, so editing a merged migration fails the pipeline and correction happens by a new migration (R-DB-1).
- **FR-038**: A seed MUST produce an identical dataset on every machine regardless of the machine's clock or timezone, and MUST be safe to run twice.

**Platform kernel**

- **FR-039**: Configuration MUST be validated at startup against a declared schema, and the process MUST refuse to accept traffic when validation fails, naming the offending value.
- **FR-040**: All logging MUST pass through a shared logger carrying a request correlation identifier, excluding every value the constitution prohibits from logs (R-SEC-2).
- **FR-041**: Every error reaching a client MUST be mapped to one shape of code, message and optional details, exposing no stack trace, query text or internal path (R-API-8, R-SEC-9).
- **FR-042**: The system MUST provide a shared idempotency mechanism recognising a repeated operation and returning the original outcome without repeating the effect (R-API-14). The idempotency record lives in the `idempotency_keys` table owned by the platform kernel (ERD section 12, ADR 0008), keyed by scope and client key, with the first outcome stored for replay.
- **FR-043**: The system MUST provide rate limiting available to any endpoint and applied by default to authentication, one-time-code, search and payment-initiation paths (R-SEC-6, NFR-SEC-10).
- **FR-044**: The system MUST determine an upload's type by inspecting its content and MUST ignore the client's declaration (R-SEC-4).
- **FR-045**: The system MUST generate publicly visible identifiers — certificate numbers and verification tokens — from a cryptographic source, and MUST refuse non-cryptographic random use at build time (R-DB-6).
- **FR-046**: The request context MUST carry the caller's identity, role, gender, locale and a correlation identifier, all resolved server-side, with no authorization input read from the client (R-GENDER-4).
- **FR-047**: The system MUST provide four distinct caller kinds — unauthenticated, student, teacher and administrator — as the declared way an endpoint states who may call it.
- **FR-048**: The system MUST expose two separately mounted request surfaces such that no administrative capability appears in the user surface's generated types, verified by a test asserting the capability sets are disjoint (R-API-11).
- **FR-049**: The administrative caller kind MUST write its own audit record, leaving no administrative route bypassing auditing (R-API-12).
- **FR-050**: Every input on either surface MUST be validated by a declared schema, enforced by the type system rather than by convention (R-API-7).
- **FR-051**: The system MUST expose separate liveness and readiness signals, distinguishing a running process from reachable dependencies, and MUST report unhandled errors to an error-tracking destination.
- **FR-052**: Heavy work MUST be queued rather than performed inside a request, and every queued job MUST be idempotent, proven by a double-run assertion in its own tests (R-API-13, R-API-14).

**Ports and provider independence**

- **FR-053**: The system MUST define ports for payment, video, push, storage and messaging, each named in the project's own domain terms with no vendor concept in the interface (R-API-5). The payment port MUST expose no balance, transfer or refund operation, because the platform holds nothing to balance, transfer or refund (ADR 0007).
- **FR-054**: Every port MUST have a working stand-in implementation, and the complete test suite MUST pass with no third-party credential present. Adapters against the real payment, video, push and messaging providers are OUT of scope for this phase: each one is built in the phase that first calls it, so that the port is shaped by a real caller rather than by a guess. A port with only a stand-in behind it satisfies this phase's definition of done.
- **FR-055**: Storage is the single exception to FR-054, because Phase 1 uploads documents the moment it exists. Storage MUST offer both a local and a remote implementation selected by configuration, and MUST expose no operation returning a publicly reachable path. Every stored file MUST be reached by a signed, expiring link (R-SEC-3).
- **FR-056**: Provider selection MUST happen once at startup from configuration, requiring no code change to switch, and no calling module may branch on which provider is active (R-API-4).
- **FR-057**: Notification delivery MUST be reachable only from the queued notification job, enforced at build time (R-API-15).

**Pipeline and process**

- **FR-058**: The pipeline MUST gate every merge on typecheck, lint, test and build, and the default branch MUST refuse direct pushes and unreviewed merges (R-PROC-4).
- **FR-059**: Secret scanning MUST run both locally before a commit and in the pipeline across the whole repository including the specs directory (R-SEC-1).
- **FR-060**: The pipeline MUST block a merge while a critical dependency alert is open (R-SEC-12).
- **FR-061**: The pipeline MUST fail when a branch does not correspond to a spec directory (R-PROC-1).
- **FR-062**: The pipeline MUST fail on a hand-edited generated file, a skipped or exclusive test, a bare comment marker carrying no ticket reference, and coverage below the declared floor (R-PROC-9, R-PROC-10, R-PROC-8, R-PROC-5). In this phase the floor of 80% applies to the shared money and time packages and to the kernel's guard and error paths — the code whose failure is silent and expensive. It extends to each domain module as that module is created, and because R-PROC-10 forbids lowering a floor, the scope is widened over time and never narrowed.
- **FR-063**: The pipeline MUST fail on removal or rename of a published procedure, field or enum value, comparing against a recorded contract snapshot (R-API-9).
- **FR-064**: The pipeline MUST run the gender-enforcement suite as a blocking gate from this phase onward, even while its case coverage is still small (R-GENDER-1, R-GENDER-2, R-GENDER-3). Every case in the suite MUST be asserted in both directions — a male requester against female teachers and a female requester against male teachers — against the single visibility predicate of SRS §3.7.1 (ADR 0006).
- **FR-065**: The review template MUST carry the twelve review-only checklist items verbatim and no other rule, so a reviewer's obligation stays short enough to be read rather than skimmed.
- **FR-066**: A merge to the default branch MUST deploy automatically to a staging environment reachable from outside the team's network.
- **FR-067**: Recorded operational procedures MUST exist for the recoveries this phase makes possible: rebuilding a diverged local database, and responding to a leaked credential by rotating first and investigating second (R-DB-2, R-SEC-10).
- **FR-068**: Every amendment this phase makes to the data model or to a governing document MUST be recorded, so a later reader can see what changed and why (R-PROC-2).

**Risk closure**

- **FR-069**: The video baseline MUST be exercised between physical devices over a mobile network and closed with a written outcome and a recorded decision.
- **FR-070**: An Arabic right-to-left certificate carrying a twenty-five entry chain MUST be rendered and inspected for layout, letter shaping and pagination, and closed with a written outcome and a recorded decision.

### Key Entities *(include if feature involves data)*

Phase 0 creates the shape of the data without the behaviour that fills it. The
authoritative model is `docs/ERD.md` v1.3, grouped into twelve domains plus
the platform kernel (ADR 0007 D4, ADR 0008). Listed
below are the entities whose structure is load-bearing for a constitutional rule.

- **User**: the root identity, one row per person regardless of how many roles they hold, carrying gender, date of birth, locale, home zone and account status. Role and gender are server-held and never read from client input for an authorization decision. Never hard-deleted.
- **Administrator, and administrator identity**: back-office access, entirely separate from users — different table, different authentication, no crossover — with a mandatory encrypted multi-factor secret.
- **Audit record**: an append-only record of an administrative action, its actor, its target and its before-and-after state. Written by the administrative path itself, never edited, never deleted.
- **Settings entry**: an operational number — a fee, a commission, a threshold, a window — held as a key with its current value and the administrator who last changed it. The only legitimate source of such numbers: code reads them from here and never carries them as constants, and no application path writes them.
- **Ledger entry**: *Retired (ADR 0005 D1, ADR 0007).* The platform holds no funds and computes no balance; `payments` and `payment_events` record what the gateway reported (FR-016, FR-027, R-MONEY-6). Entry kept so old citations resolve.
- **Availability slot**: a teacher's recurring weekly offer, stored as a local wall-clock time and duration beside the teacher's named zone. Never stored as an absolute instant.
- **Enrollment**: one student's purchase of one package, snapshotting price, session count, duration, subject and the slot's zone at purchase, so that a later change to a parent cannot rewrite what was bought.
- **Session**: one scheduled occurrence. Its schedule is the requested local date, local start time and zone, frozen at generation. Its absolute start and end instants are derived from them and recomputed when the time zone data changes (ADR 0009). It carries its own status machine and its accumulated connected time.
- **Session participant event**: the provider-reported join and leave record from which attendance is derived, uniquely keyed by the provider's own event identifier so a replayed webhook cannot double-count. Never written by a client.
- **Ijazah**: a granted certificate carrying an unguessable certificate number and verification token, an immutable chain snapshot, and a revocation record. Never hard-deleted; a revoked one is never shown as valid.
- **Stored file reference**: a pointer to a document, certificate, signature, attachment or photo, reachable only through a signed, expiring link, and encrypted where it identifies a person.
- **Migration**: an applied schema change, immutable once merged and verified by checksum.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new engineer on a machine that has never seen the project, following only the written setup, reaches a running seeded system in under thirty minutes without asking a teammate a question.
- **SC-002**: Two independently seeded datasets are identical, every time, including when seeded on different dates in different machine timezones.
- **SC-003**: Every constitution rule whose assigned mechanism is a compiler, a linter, a pipeline gate or a database privilege has a recorded, reproducible failing case proving the mechanism actually rejects a violation. The number of rules claiming a machine mechanism without such proof is zero.
- **SC-004**: Attempts to delete an audit, ijazah, session, enrollment or user row, made as the application's own database role, succeed zero times out of ten. For the ijazah, session, enrollment and user tables the removal succeeds instead as a soft deletion, and the soft-deleted row is then absent from every ordinary read. For audit records there is no alternative removal path at all, by design.
- **SC-005**: The complete test suite passes on a machine holding no third-party credential.
- **SC-006**: The full migration history applied to a completely empty database succeeds on the first attempt with no manual step, and yields every table in the model with no table outside it.
- **SC-007**: Every integrity rule the model declares is demonstrated by an insert the database rejects.
- **SC-008**: A merged change is live on staging within fifteen minutes of merge, with no human action after approval.
- **SC-009**: Attempts to push directly to the default branch, to merge without an approving review, or to merge with a failing pipeline fail in every attempt.
- **SC-010**: A planted test secret is independently rejected by the local check and by the pipeline check, including when placed in the specs directory.
- **SC-011**: The review checklist contains exactly the twelve review-only items, so a reviewer's obligation fits on one screen.
- **SC-012**: The user surface's generated types contain zero administrative capabilities.
- **SC-013**: Recurrence resolved across a real Cairo daylight-saving transition produces occurrences at the intended local time on both sides of the transition, with zero drift, and nonexistent and ambiguous local times each resolve deterministically.
- **SC-014**: The stored derived values in the schema are exactly the six columns R-DB-4 declares, `teacher_profiles.average_rating`, `teacher_profiles.review_count`, `sessions.scheduled_start_at`, `sessions.scheduled_end_at`, `sessions.teacher_user_id` and `sessions.student_user_id` (ADR 0010), each recorded in the model documentation.
- **SC-015**: Both risk spikes are closed with a written outcome naming what was tested, on what hardware and network, and what was decided.
- **SC-016**: Every disagreement between the data model and the constitution is closed by an amendment to one of them, with the amendment recorded. The number left open at phase end is zero.
- **SC-017**: No item in this phase's definition of done depends on a person remembering a rule. Every one is demonstrated by a machine refusing something.

## Assumptions

**Scope**

- Phase 0 delivers no user-facing capability. Every guard is proven by a deliberate violation rather than by a product journey, because the journeys it protects arrive in Phases 1 through 5.
- The money tables are records, not balances (ADR 0007): `payments` holds what the gateway reported per order and `payment_events` holds every signed event. No wallet, ledger, escrow or balance exists. Package prices, their snapshot and the gateway-reported amounts are typed as branded piasters.
- The gender-enforcement suite is wired as a blocking gate here, with case coverage growing in Phase 2 when teacher data exists to attack. The constitution's enforcement map assigns the gate to Phase 0 while PLAN.md assigns the suite's substance to Phase 2; both hold under this reading.
- Nothing in this specification is derived from source code presently in the repository.

**Corrections to PLAN.md carried into this specification**

- PLAN.md once listed "four apps" and "five external applications"; both were corrected by ADR 0005. The product has **three applications**: a React Native app for students and teachers, a web application for administrators, and one backend serving both, whose worker is a second process.
- The table count is **thirty-three** as of ERD v1.3 (ADR 0005 D1 removed the five managed-payment tables; ADR 0007 added `payments` and `payment_events`; ADR 0008 added the kernel's `idempotency_keys`). PLAN.md and the ERD agree.

**Given rather than chosen here**

- PLAN.md fixes the technology shape: a monorepo, a container-based local environment, a multi-file schema, a request layer with a shared context and four caller kinds across two separately mounted surfaces, local and remote storage implementations, and an error-tracking destination. These are treated as given constraints; requirements are stated as outcomes so each remains independently verifiable.
- The background worker runs as part of the backend application rather than as a fourth deployable, following the three-application structure above. It shares the backend's modules and never holds its own copy of a rule.
- Staging hosting and the pipeline provider are left to the plan. This specification requires only the outcome: automatic deployment to an environment reachable from outside the team's network.

**Governing documents, and the conflicts this phase resolves**

The constitution at `.specify/memory/constitution.md` is normative. Where another
document disagrees, the constitution governs and the other document is corrected
within this phase (R-PROC-2). `docs/ERD.md` v1.3 is the authoritative data model
and agrees with the constitution on the load-bearing points — no balance tables,
delete revoked at the role level, slots as local time beside a zone,
administrator identity fully separate, and every invariant the constitution names
in its section 15. The disagreements below were found against ERD v1.0 and are
each resolved by FR-026 through FR-034 and, for money, by ADR 0005:

1. **Stored derived values.** The ERD stores three beyond the two the constitution permits: a minor flag derived from date of birth, a bar flag mirroring the bar record table, and a teacher no-show counter derivable from session statuses. R-DB-4 permits exactly two and requires a recorded decision for any third. Each is either computed on read or granted a recorded exception (FR-033).
2. **Idempotency key nullability.** *Moot (ADR 0005 D1)*: the ledger and withdrawal tables no longer exist.
3. **Deletion.** ERD section 15 revokes update and delete on ledger rows only, treating the rest as a convention in its section 0. R-DB-3 requires delete revoked at the role level on the audit log, ijazah, session, enrollment and user tables too. Because most of those records still need a way to be removed from view, the ijazah, session, enrollment and user tables each gain a deletion timestamp and removal becomes a soft deletion (FR-026). This carries two consequences the model states rather than discovers: ordinary reads, counts and facets exclude soft-deleted rows, and every uniqueness constraint over a value a soft-deleted row still holds — a user's phone number or email — says explicitly whether that row keeps occupying it. (A review's enrollment is not such a case: reviews have no deletion marker and a deleted enrollment cannot be reviewed, so that constraint is a plain unique — ADR 0006.) One table gets no removal path at all: the audit log, because every other table on the list holds something a person might legitimately need removed, while the audit log holds the record of what administrators did, read only by someone checking whether they acted properly, so it is strictly append-only.
4. **Plaintext tokens.** The ERD stores the ijazah verification token and the device push token in plain text. R-DB-7 forbids storing any token in plain text. The verification token is resolved by storing its hash and letting the printed code carry the plaintext; the push token cannot be hashed because it must be presented to the provider, so it falls under R-DB-8 encryption instead (FR-031).
5. **National identity document reference.** The ERD stores the verification document's storage key as text, annotated as encrypted at rest. R-DB-8 requires the column itself to hold an encrypted value, as the ERD already does for multi-factor secrets (FR-031).
6. **Table count.** Closed. ERD v1.1 corrected 36 to 35; ERD v1.2 removed the five managed-payment tables (ADR 0005 D1); ERD v1.3 added `payments` and `payment_events` (ADR 0007) and, by its ADR 0008 addendum, `idempotency_keys`; it defines thirty-three. Every document now states thirty-three.

One earlier apparent conflict is withdrawn. The ERD's settings table holds one
row per key with its current value, and that was read here as failing R-PROC-11's
word "prospectively". It does not. The rule requires only that no operational
number is hardcoded and that changes are made through the administrative surface
and audit-logged; a change applies from the moment it is made, and terms already
agreed are protected by the snapshot columns an enrollment carries rather than by
settings history. FR-034 states the rule as it is meant. The word
"prospectively" in R-PROC-11 invites the stronger reading and would be worth
clarifying the next time the constitution is amended.

Two further notes on the documents:

- `docs/ARCHITECTURE.md` v3.1 and `docs/SRS.md` v1.3 are the full documents, reconciled with the constitution and the ERD by ADR 0005. The earlier note that ARCHITECTURE stored slots as absolute instants was itself stale: §9 has stated local wall-clock plus zone since v3.0, and task T125 was removed on that basis (ADR 0005 D8).

**Risk**

- Either spike may conclude against the currently assumed approach. That changes Phase 3 and Phase 4 planning; it does not change this phase's other deliverables.
