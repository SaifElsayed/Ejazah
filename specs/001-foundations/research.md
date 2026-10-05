# Phase 0 Research: Foundations

**Feature**: `specs/001-foundations/` · **Date**: 2026-08-26

Every unknown in the plan's Technical Context, resolved. Each entry states what
was chosen, why, and what was rejected. Decisions here are inputs to the design
artifacts, not commitments the spec makes — the spec states outcomes, this states
how they are reached.

Two decisions at the end (R-18, R-19) are recommendations that need your
confirmation rather than settled findings; they are marked accordingly.

---

## R-1: Repository and workspace tooling

**Decision**: pnpm workspaces, no task-graph orchestrator.

**Rationale**: Three applications and four packages is a small graph. pnpm's
workspace protocol plus its strict, non-hoisted `node_modules` gives the property
that actually matters here: a package cannot import a dependency it did not
declare, which is a boundary guarantee in the same spirit as the lint rules and
costs nothing to obtain. Turborepo or Nx would add a caching layer and a
configuration surface before there is a build slow enough to need it.

**Alternatives rejected**: Turborepo and Nx — premature at this size; both can be
added later without restructuring, since they consume the workspace rather than
replace it. npm and yarn workspaces — hoisted layouts let undeclared imports
resolve, which quietly weakens FR-004.

---

## R-2: Language and runtime

**Decision**: TypeScript 5.x in `strict` mode with `noUncheckedIndexedAccess`,
on Node 24 LTS. Pinned by `engines` and a version file so every machine and the
pipeline agree.

**Rationale**: The constitution leans on the compiler for nine rules (R-MONEY-1,
R-TIME-6, R-GENDER-4, R-GENDER-6, R-API-7, R-API-11, R-SEC-8, R-SESS-1,
R-HONEST-4/5). Anything less than strict mode weakens tier `TYPE` across the
board. `noUncheckedIndexedAccess` matters specifically for the money splitting
work in FR-015, where array indexing carries the rounding remainder.

**Alternatives rejected**: Non-strict TypeScript — would make branded types
leaky. An older LTS — no benefit, and shorter support runway than the project.

---

## R-3: Money as a type a plain number cannot satisfy (FR-012, FR-013)

**Decision**: A branded type using a `unique symbol` declared but never exported:

- The brand makes `number` unassignable to the money type, and a money consumer
  unable to stand in for a number consumer; the reverse widening is closed by the
  R-MONEY-1 lint rule (FR-072, T131).
- Construction goes through the package's own constructors, so every value that
  exists was deliberately made.
- Arithmetic is banned outside the package by a **type-aware** custom lint rule
  that inspects binary expressions and flags any operand whose resolved type
  carries the brand.

**Rationale**: A plain alias (`type Piasters = number`) provides no protection at
all — it compiles away, and both directions of assignment succeed. R-MONEY-1
requires the two to be non-interchangeable, which only a nominal-typing technique
delivers in TypeScript. Detecting arithmetic requires resolved type information,
so this rule cannot be written against the syntax tree alone.

**Consequence**: The lint configuration needs type-aware linting
(`parserOptions.project`) for the rules in R-10 that depend on types. That is
slower than syntax-only linting and shapes how the pipeline is staged (R-13).

**Alternatives rejected**: A wrapper class — boxing every amount costs
allocation and breaks JSON serialisation across the wire, where the ERD
specifies integer columns. An opaque type via a private constructor — same
ergonomics, no additional safety over the brand.

---

## R-4: Date and time engine inside `packages/time` (FR-017, FR-018, FR-019)

**Decision**: `@js-temporal/polyfill`, used only inside `packages/time`, whose
public surface exposes the project's own types and never a Temporal object.

**Rationale**: R-TIME-7 requires a nonexistent local time to shift forward and an
ambiguous local time to take the first occurrence. Temporal expresses exactly
this as a first-class parameter: converting a plain date-time to an instant in a
zone takes a `disambiguation` option, whose `compatible` mode shifts forward
across a spring-forward gap and takes the earlier instant across a fall-back
overlap. The rule the constitution states is the library's documented default
behaviour, rather than something to be assembled from primitives and hoped for.
Temporal also separates "wall-clock time in a zone" from "instant" as distinct
types, which is the same distinction R-TIME-3 draws between an availability slot
and a session — so the model and the library agree instead of the code having to
maintain the discipline by convention.

**Alternatives rejected**: Luxon — mature and IANA-correct, but gap and
ambiguity handling is expressed through validity flags and a
`Settings.throwOnInvalid` global rather than a per-call option, so the rule would
be enforced by discipline instead of by the call signature. `date-fns-tz` —
thinner zone modelling, and no single type that carries a zone with a
wall-clock time. Native `Date` with `Intl` — the arithmetic R-TIME-2 forbids is
exactly what you end up writing.

**Note on the polyfill**: Temporal is not yet available unflagged on the runtime,
so the polyfill is a real dependency rather than a shim over a native
implementation. It is confined to one package behind the project's own types, so
replacing it with the native implementation later is an internal change.

---

## R-5: Two database roles, and where the revocations live (FR-025, FR-026)

**Decision**:

- Two roles: an **owner** that holds the schema and runs migrations, and an
  **application** role the running system connects as.
- Two connection strings in configuration: a migration URL used only by the
  migration command and by the pipeline, and the runtime URL used by everything
  else. The runtime URL never has owner credentials.
- `REVOKE` statements live in hand-authored SQL inside migrations, generated
  with the migration tool's create-only mode so the SQL can be extended before
  it is applied.
- `ALTER DEFAULT PRIVILEGES` is set for the owner so that tables created by
  future migrations do not silently grant the application role more than
  intended. Without this, the next migration re-opens what this one closed.

**Rationale**: A role cannot meaningfully revoke a privilege from itself — it
owns the object and can grant it back. The revocation is only real if the role
being constrained is not the role that holds the schema. This is also what makes
SC-004 an honest test: the ten attempts are made as the role the application
actually uses in production.

**Alternatives rejected**: A single role with triggers raising exceptions on
UPDATE and DELETE — triggers are objects the owning role can drop, so the
guarantee degrades from "physically impossible" to "impossible until someone
runs one statement". The constitution puts non-deletion (R-DB-3) in tier `DB`
specifically to escape that class of argument. Row-level security — solves a
different problem (which rows), not this one (which verbs).

---

## R-6: Schema constructs the ORM does not express

**Decision**: Four constructs are written as raw SQL inside migrations, and each
is additionally asserted by the schema-check script so that a future migration
cannot quietly drop one:

| Construct | Why raw SQL | Serves |
|---|---|---|
| `REVOKE` / `GRANT` / default privileges | Not a schema-modelling concept | FR-025, FR-026 |
| Partial unique indexes (`WHERE deleted_at IS NULL`) | Partial indexes are not expressible in the schema language | ERD §15.11 |
| Partial index on scheduled sessions | Same | ERD §14 |
| Check constraints | Expressible only as raw SQL in this toolchain | FR-030, ERD §15 |

**Rationale**: All four are load-bearing for a constitution rule, so "the ORM
cannot express it" is not a reason to move the guarantee up into application
code. Writing them in migrations keeps them in the immutable, checksum-verified
history (FR-037).

**Consequence for the workflow**: migrations are generated, then extended by
hand, then reviewed, then merged — and never touched afterwards. This is not in
tension with R-PROC-9's ban on editing generated files: that rule protects
artefacts regenerated from a source of truth, whereas a migration becomes the
source of truth the moment it is created. The runbook must state this
distinction explicitly, because it is the one place the two rules look like they
disagree.

---

## R-7: Timestamp columns (FR-024)

**Decision**: Every timestamp column is declared with an explicit
`timestamptz(6)` native type. The schema-check script queries the live catalogue
for any column of type `timestamp without time zone` and fails the pipeline on a
non-empty result, rather than inspecting the schema source.

**Rationale**: The default mapping in most ORM toolchains is timezone-naive, so
R-TIME-4 is violated by omission rather than by intent — exactly the failure
mode a machine check exists for. Checking the live catalogue rather than the
source also catches anything introduced by raw SQL in a migration, which a
source-level check would miss.

---

## R-8: Encrypting the columns that must be recoverable (FR-031)

**Decision**: Application-layer authenticated encryption (AES-256-GCM) in the
platform kernel, storing ciphertext, IV and auth tag in a single `bytea` column.
The key comes from configuration and is validated at startup like any other
required value.

**Rationale**: The in-database alternative requires the key to appear as a
literal or parameter in the SQL statement. That places the key inside statement
logs, `pg_stat_statements`, and any query the database itself records — which
collides directly with R-SEC-2's ban on logging credentials, in a place the
application's own logger cannot redact. Keeping encryption above the database
means the key never enters a query.

**Consequence**: an encrypted column cannot be searched or uniquely constrained,
because a fresh IV per write makes the ciphertext non-deterministic. Where a
lookup is needed, a separate hash column carries it — see R-9.

**Alternatives rejected**: `pgcrypto` — the key-in-query problem above. Full
disk or volume encryption alone — protects against a stolen disk, not against a
leaked query result or a compromised connection, which is the threat R-DB-8
addresses. Deterministic encryption to preserve uniqueness — leaks equality,
and for a small value space is close to reversible.

---

## R-9: Hashed columns, and lookup without decryption (FR-031)

**Decision**:

| Value | Storage | Lookup |
|---|---|---|
| OTP code, password | Hash with a memory-hard KDF (Argon2id) | Verify by comparison |
| Ijazah verification token | SHA-256 hash, unique | The QR carries the plaintext; the server hashes the presented value and looks up by hash |
| Device push token | AES-GCM ciphertext, plus SHA-256 hash for uniqueness | Deduplicate by hash, decrypt only when sending |

**Rationale**: Two different jobs are being confused if one mechanism is used for
both. A password is never needed again in plaintext, so a slow, salted KDF is
correct. A verification token must be matched against a value someone presents,
so a fast unsalted hash is correct — it is a high-entropy random value, so the
brute-force resistance a KDF provides is unnecessary. A push token must be
*presented to a third party*, so it cannot be hashed at all and belongs under
R-DB-8 instead.

**Consequence worth flagging to Phase 4**: with only the hash stored, a lost
certificate's verification token cannot be recovered from the database. It can
only be reissued. That is a product behaviour, not a bug, and the certification
phase needs to know it.

---

## R-10: Custom lint rules, and which need type information (FR-004 to FR-011)

**Decision**: One internal ESLint plugin published within the workspace, in which
**every rule is named after the constitution rule it enforces**, and every
message ends with that identifier. This is how FR-011 is satisfied mechanically
rather than by remembering to write good messages.

Rules split by what they need:

**Syntax-only** (fast, run on every file): cross-tree imports, deep module
imports, adapter imports, database-client imports outside repositories, raw
colour and spacing literals, directional utility classes, raw platform controls,
literal strings in view text positions, direct network calls, insecure storage
imports, disabled TLS verification or strict HTTP parsing, non-cryptographic randomness, logger calls
receiving a request body, escape hatches without a justification and ticket,
`.only` and `.skip`, bare comment markers.

**Type-aware** (needs the program, slower): arithmetic on the money type
(R-MONEY-5), money-carrying identifiers missing the suffix (R-MONEY-2),
repository methods returning teachers without a requester gender parameter
(R-GENDER-5), per-module table allow-listing (R-API-6).

**Rationale**: Type-aware linting costs a full type-check per lint run. Splitting
them means the editor and the pre-commit hook stay fast on the syntax rules while
the pipeline runs both, so the guard that catches most mistakes is the one
developers feel immediately.

**Alternatives rejected**: Expressing everything through `no-restricted-imports`
and `no-restricted-syntax` patterns in configuration — works for perhaps half the
rules, produces messages that cannot cite a rule identifier cleanly, and becomes
an unreadable wall of regular expressions. A separate published package —
unnecessary; the workspace already isolates it.

---

## R-11: Module and table ownership (FR-002, FR-005)

**Decision**: A single manifest maps each module to the tables its domain owns,
generated from the twelve-domain grouping in the data model (twelve modules plus the platform kernel, ADR 0007 D4 and ADR 0008). The type-aware lint
rule reads the manifest and flags any database access from a module to a table it
does not own. Each module's written statement of what it owns and never does is
checked for existence by the pipeline.

**Rationale**: R-API-6 is otherwise unenforceable — "don't touch another module's
tables" is invisible to a syntax check. Deriving the manifest from the data model
rather than maintaining it separately means a new table lands in exactly one
module or fails the check.

---

## R-12: Contract snapshot for the additive-only rule (FR-063)

**Decision**: A generated snapshot recording every procedure path, its surface,
and every enum member. The pipeline diffs the current snapshot against the
committed one and fails on **removals and renames only**; additions pass without
comment.

**Rationale**: R-API-9 exists because clients in the field are older than the
server. A test that merely asserts a fixed shape would fail on every legitimate
addition and train people to regenerate it without reading the diff — which is
how a removal slips through. Failing only on removal makes the alarm rare enough
to be believed.

---

## R-13: Test runner, coverage scoping, and pipeline staging (FR-062)

**Decision**: Vitest across the workspace, with coverage thresholds declared
**per path** rather than globally: the money and time packages and the kernel's
guard and error paths carry the 80% floor; other paths carry none yet.

Pipeline stages, ordered by how fast they fail:

1. Typecheck and syntax-only lint, in parallel.
2. Unit and property tests, with the scoped coverage floor.
3. Type-aware lint, schema check, contract snapshot diff.
4. Database integrity probes against a real database instance.
5. Build.

**Rationale**: The clarified answer scopes the floor to where logic lives, and
R-PROC-10 forbids ever lowering a floor — so a global 80% set now would be
permanent, and would be met by testing wiring code rather than rules. Per-path
thresholds let the covered surface widen as modules arrive, which is a widening,
not a lowering. The stage ordering puts the cheapest signal first so a boundary
violation is reported in under a minute rather than after a database spins up.

**Alternatives rejected**: A global floor with exclusions — an exclusion list is
a lowering mechanism wearing a different hat, and R-PROC-10 would be argued about
every time it grew. Jest — heavier configuration in an ESM TypeScript workspace,
with no offsetting benefit here.

---

## R-14: Attendance, idempotency and the queue

**Decision**: Redis-backed queue with a shared idempotency mechanism keyed in
Postgres, not in Redis — the `idempotency_keys` table owned by the platform
kernel (ERD §12, ADR 0008 D2), unique on `(scope, key)`, storing the first
outcome for replay and swept after a configured retention.

**Rationale**: R-API-14 requires that a job run twice equals one run. If the
idempotency record lives in Redis while the effect lives in Postgres, the two can
diverge on eviction or failover — the record disappears and the effect repeats.
Keeping the key in the same database as the effect means one transaction covers
both. Redis stays for queueing and rate limiting, where loss is recoverable.

---

## R-15: Secret scanning, in two places (FR-059)

**Decision**: Gitleaks as a pre-commit hook via a fast native hook manager, the
same scanner in the pipeline across the full history including `specs/`, and the
hosting platform's own push protection as a third net.

**Rationale**: R-SEC-1 names all three. They fail differently and that is the
point: the hook can be bypassed with a flag, the pipeline catches what the hook
missed but only after the secret is already in a remote branch, and push
protection refuses the push itself. The spec's SC-010 requires the local and
pipeline checks to reject a planted secret *independently*, so neither may be
implemented as a call to the other.

---

## R-16: Upload content sniffing (FR-044)

**Decision**: Magic-byte inspection of the leading bytes of the stream, before
the file is written anywhere, with the declared type and extension discarded
entirely rather than compared.

**Rationale**: R-SEC-4 says the declared type is not to be trusted. Comparing
sniffed against declared and rejecting on mismatch sounds stricter but is
weaker — it invites a code path where the declared value is used when the two
agree. Discarding it means there is no path where a client's claim decides
anything. This also supplies the mechanism R-SEC-5 needs for chat in Phase 3.

---

## R-17: Observability depth

**Decision**: For this phase — structured JSON logging with a **redaction list
declared in the logger's own configuration**, a request correlation identifier
propagated through the context, error tracking to the destination PLAN.md names,
and separate liveness and readiness endpoints. Metrics and distributed tracing
are deliberately not built.

**Rationale**: The redaction list is the important part: R-SEC-2's lint rule
catches a logger call that receives a request body, but it cannot catch a
sensitive value nested three levels inside an object that was legitimately
passed. Declaring the forbidden paths in the logger closes what the lint rule
structurally cannot see, so the two mechanisms cover each other.

Metrics and tracing are deferred because nothing in Phase 0's definition of done
depends on them, and because instrumenting a system with no traffic produces
dashboards of zeros. This was flagged as Outstanding during clarification and is
recorded here as a conscious deferral rather than an oversight — the kernel is
the cheapest place to add them, so the cost of deferring is a known future edit
to one package rather than to every module.

---

## R-18: Staging environment — **recommendation, needs confirmation**

**Recommendation**: A single always-on staging environment: the backend as a
container, the admin surface as static assets, managed Postgres and managed
Redis, deployed automatically on merge from the default branch. The mobile app
reaches it through over-the-air builds rather than store distribution.

**Rationale**: FR-066 requires only that a merged change becomes live without
human action, on something reachable from outside the team's network. Managed
data services matter more than the compute choice, because SC-006 requires
migrations to run clean from empty and Phase 6 requires a restore drill — both
of which are considerably easier against a managed instance with point-in-time
recovery than against a self-managed one.

**Open**: the specific host, and whether a separate production environment is
provisioned now or in Phase 6. PLAN.md puts hosted infrastructure at Week 14,
which suggests staging only for now.

---

## R-19: Data residency — **recommendation, needs confirmation**

**Recommendation**: Pin all data storage — database, object storage, backups —
to a single named region, and record that region in the architecture
documentation before the first row is written.

**Rationale**: The product serves an Egyptian audience, and the model holds national identity document references,
dates of birth and minor status. No governing document takes a position on where
that data may live. This does not block Phase 0, but it constrains the choice in
R-18, and moving a populated database between jurisdictions later is far more
expensive than choosing correctly now.

**Open**: whether a legal or contractual requirement exists. This was raised as
Outstanding during clarification and is unresolved. Recommend confirming before
the staging environment is provisioned, since that provisioning is the moment the
decision becomes real.

---

## R-20: Gateway events are records, never balances (ADR 0007)

**Decision**: Payment is a direct gateway checkout with zero custody. The
platform's schema holds a `payments` row per gateway order and a
`payment_events` row per signed event, and nothing that sums to a balance.
Confirmation of an enrollment is a job triggered by a persisted `paid` event,
keyed by the provider's own event id — the same replay-safety pattern R-14
established for attendance.

**Rationale**: The two properties that made the ledger design expensive —
immutability of money history and exact share arithmetic — do not arise when
the platform never holds money. What remains is the property attendance already
needed: an inbound provider event must be acted on exactly once, and only after
its signature is verified on the raw body. Reusing that pattern keeps the
webhook guard (R-MONEY-9), the unique event id (R-MONEY-8) and the idempotent
job (R-API-14) as one mechanism with two callers rather than two mechanisms.

**Alternatives rejected**: Confirming from the client's return URL — trivially
forgeable, and the reason R-HONEST-1 gives `confirmed_at` exactly one write
path. Storing net amounts computed by the platform — the gateway reports them;
computing them here is R-MONEY-5 arithmetic with no caller.

---

## Summary of what remains open

| Item | Status | Blocks |
|---|---|---|
| Staging host (R-18) | Recommendation pending confirmation | Task list for FR-066, not the design |
| Data residency (R-19) | Recommendation pending confirmation | Provisioning, not the design |
| Gateway selection (SRS OPEN-11) | Business evaluation pending | The Phase 2 real adapter; not the port, the stand-in or the schema |

Nothing open blocks Phase 1 design or the task breakdown.
