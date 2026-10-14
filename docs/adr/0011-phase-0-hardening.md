# ADR 0011 — Phase 0 hardening after the closure review

**Status:** accepted · **Date:** 2026-10-14 · **Closes:** T168 to T173 (`specs/001-foundations/tasks.md`, Phase 11) · **Amends:** ERD §12 (`audit_logs.target_id`), `specs/001-foundations/contracts/kernel.md` ("Caller kinds", "Guards applied by default"), `.env.example` (five keys)

## Context

On 2026-10-13 `develop` d7b837f, the end of Phase 0, was read by three
reviews together: the security review, the code review and the project
reviewer. None found a Critical. Between them they found six things that are
cheap to change before Phase 1 writes its first procedure and expensive after,
because each would otherwise be copied into every procedure, job or process
that follows:

- SEC-1 — `NODE_ENV` defaulted to `development`, so a configuration copied onto
  a server without it accepted every stand-in adapter, and a gateway stand-in
  confirms whatever it is told.
- SEC-3 — a caller kind took an input schema only, so a procedure's output was
  whatever its handler returned: nothing stripped a field the client should not
  see, and the contract snapshot recorded such a procedure as publishing no
  output.
- SEC-2 and SEC-8 — a rate limit was applied by hand, so an anonymous endpoint
  could forget it; nothing capped a path platform-wide; and a subject's plain
  hash could be brute-forced back to a phone number from a Redis dump.
- SEC-4 — the queue retried nothing, kept a failed delivery for ever, and ran
  the worker at a concurrency no configuration named.
- SC-5, SEC-6 and C-10 — the database pool carried no statement or
  idle-in-transaction timeout; the column cipher bound a value to its column but
  not to its row, so two rows' values swapped still decrypted; and
  `audit_logs.target_id` was a uuid, which cannot record a settings change,
  though every settings change is audited.
- SEC-10 and the logger and worker items of the code review — the request
  process stopped unclean, the worker stopped once per signal rather than once,
  and the logger redacted the `code` of a serialized error, which is a
  classification (`ECONNREFUSED`), not a one-time code.

The owner's decision (2026-10-14): one batch, one branch cut from `develop`,
tests before code, one pull request, Saif's review, and Phase 0 extended by one
working day for it (PLAN.md). The ERD items the same review raised open the
Phase 1 Spec Kit cycle and are not part of this batch (PLAN.md, Phase 1).

## Decisions

### D1 — `NODE_ENV` is required, and a stand-in runs only under development or test (T168)

`NODE_ENV` has no default. A configuration without it is refused at startup
naming the key (FR-039). `fake` for `PAYMENT_GATEWAY`, `VIDEO_PROVIDER`,
`PUSH_PROVIDER` and `SMS_PROVIDER` is accepted only when `NODE_ENV` is
`development` or `test`, and refused in every other mode on the key's own
path. The test is "not one of the two", never "is production", so a mode added
later is refused until it is named as one of the two.

Why: a default that selects the one mode where a stand-in is legal turns a
missing key into a server that takes bookings nobody paid for (R-HONEST-1).

### D2 — Every caller kind takes `{ input, output }` and applies the output schema (T169)

`publicProcedure`, `studentProcedure`, `teacherProcedure` and `adminProcedure`
take `{ input, output }`, each a zod schema, and apply `.output(output)` beside
`.input(input)`. A procedure cannot be declared without an output parser; what a
handler returns is parsed before it leaves, so a field the schema does not name
is stripped (R-HONEST-4) and the snapshot records the fields the schema names
(R-API-9). An output that fails its schema is the internal error, unexpected;
an input that fails its schema stays the validation failure with its paths. The
contract snapshot refuses a procedure whose definition has no output parser.

Why: an output inferred from the handler exists only for the compiler. The
owner decided on 2026-10-10 that Phase 1 requires `.output(schema)` on every
procedure; making the kind take it is what makes that decision unforgettable.

### D3 — A rate limit is declared on the kind, with a platform-wide budget and an HMAC subject key (T170)

`rateLimit: { key, subjectOf, budget? }` is required on `publicProcedure` and
accepted by the student and teacher kinds. The kind applies it after input
validation from the limiter the request context carries, handed in by the HTTP
application from `main.ts`, and stamps the key in the procedure's meta. A
`budget` is a second settings key counted under the one constant subject `*`,
checked first, so a path has a platform-wide cap beside its per-subject one;
the seed plants `rate_limit_one_time_code_budget` (300 per hour) and
`rate_limit_authentication_budget` (1000 per 15 minutes), owner-adjustable in
the admin panel. The counter key is HMAC-SHA256 of the subject under a key
derived from `ENCRYPTION_KEY` by HKDF under `ijazah:rate-limit-subject:v1`.

Why: a guard applied by hand is a guard forgotten (R-SEC-6); a per-subject
limit alone lets a flood spread over many numbers through; and the space of
phone numbers is small enough to enumerate against a plain hash.

### D4 — The queue retries with exponential backoff, bounds its failed set, and the worker's concurrency is configured (T171)

One exported constant, `defaultJobOptions`, carries `attempts: 3`, exponential
`backoff` from one second, `removeOnComplete: true` and `removeOnFail: { count:
1000 }`; the queue adds every job with it and every sweep is registered with it.
The worker runs `QUEUE_CONCURRENCY` deliveries at once, a positive integer
defaulting to 4. The numbers live in the kernel (`queue.ts`, `env.schema.ts`),
outside the magic-number gate's root: they are the queue's own operation, not a
product setting.

Why: every job is idempotent (R-API-14), so a retry is safe and a delivery lost
to a transient failure is a delivery lost for nothing; an unbounded failed set
lets one broken job fill Redis.

### D5 — The database holds its timeouts, its row-bound ciphertext and a text audit target (T172)

The pool is opened with `max`, `statement_timeout` and
`idle_in_transaction_session_timeout` from `DATABASE_POOL_MAX` (10),
`DATABASE_STATEMENT_TIMEOUT_MS` (30000) and
`DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` (60000); pg sends the timeouts as
startup parameters, so the server enforces them. `ColumnCipher.encrypt`,
`decrypt` and `reencrypt` take the row id and bind it in the associated data
after the column, so a value moved between rows fails its tag; every caller
passes it, the seed included. `audit_logs.target_id` becomes `text` by
migration `20261014000000_audit_target_id_text`, immutable once merged
(R-DB-1); the table held no row.

Why: a query or an idle transaction with no limit holds the database for ever;
a value bound to its column alone lets one row's secret be read as another's;
and a uuid column cannot record the audit of a settings change (FR-ADMIN-17).

### D6 — The two processes stop once and cleanly, and a serialized error keeps its code (T173)

`platform/lifecycle/shutdown.ts` exports `onShutdown(sequence)`, which registers
SIGTERM and SIGINT, runs the sequence exactly once however many signals arrive
(later signals await the same promise), exits 0 when it resolves and 1 when it
rejects, after logging the rejection. `main.ts` enables Nest's shutdown hooks
and stops listening, then closes the database; `worker.ts` runs its existing
sequence through it. The logger keeps the `code` of a serialized Error (the
object pino writes for an Error: `type`, `message`, `stack`) as a classification
code, while every other bare `code` stays redacted.

Why: a second signal must not run a close sequence twice over a half-closed
client; a failure that exits 0 hides itself from the supervisor; and
`ECONNREFUSED` is what an operator needs, not a one-time code.

## Consequences

- `.env.example` gains `QUEUE_CONCURRENCY`, `DATABASE_POOL_MAX`,
  `DATABASE_STATEMENT_TIMEOUT_MS` and `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS`
  and says `NODE_ENV` is required; every environment file copied from it must
  carry `NODE_ENV`.
- `contracts/kernel.md` "Caller kinds" shows the `{ input, output }` signature
  and what the output schema guarantees; "Guards applied by default" says a rate
  limit is declared on the kind, with a budget and an HMAC subject key.
- ERD §12: `audit_logs.target_id` is `text`; a changelog block records it.
- Every spec that declares a fixture procedure follows the new signature and,
  for a public procedure, declares a rate limit; every spec that opens the
  database passes the three limits; every caller of the cipher passes a row id.
- Phase 1 writes its first procedure against kinds that already force an output
  schema and a declared rate limit, a queue that already retries, and a cipher
  that already binds rows: nothing in this batch has to be retrofitted later.
- Phase 0 ends one working day later than PLAN.md stated before 2026-10-14; the
  thirty working days of Phases 1 to 6 start the day after this batch merges.

## Deferred by the owner, on purpose

Everything else the closure review raised stays deferred; this list is the
record, so none is rediscovered as new:

- `pnpm audit` highs in development tooling: dependencies of the build and
  lint chain only, nothing shipped; taken up when the chain is next upgraded.
- Stand-in state held per process (the payment and video stand-ins remember
  what they were told in memory): Phase 2 plans the real gateway and settles it.
- A lint rule for `include` and `select` reads under soft deletion (the
  extension filters top-level reads only, note in `prisma.repository.ts`):
  Phase 1, with the first repository that reads a relation.
- Plaintext database and Redis URLs in a production environment: Phase 6, with
  the hosting decision and its secret store (research R-18).
- CI stage fan-out (one stage per suite rather than one stage for the suite):
  not before the suite's duration asks for it.
- The status of Dependabot alerts is unverified from the repository alone: an
  owner check on GitHub, outside the code.
- The ERD items sent to the Phase 1 Spec Kit cycle (PLAN.md, Phase 1): a table
  of hashed sessions and refresh tokens for users and a separate one for
  administrators; where account and role status, teacher approval and payout
  verification are resolved per request; the idempotency key's actor
  (`idempotency_keys` unique on `(scope, actor_id, key)`); an index on
  `otp_codes (destination, purpose)` and purge sweeps for `otp_codes` and stale
  `device_push_tokens`; and the admin panel's authentication transport (a
  bearer header, no cookies).

## References

- The closure review of `develop` d7b837f, 2026-10-13: the security review, the
  code review and the project reviewer, read together (findings SEC-1 to
  SEC-10, SC-5, C-10).
- PLAN.md, "Extension (stated 2026-10-14)" and Phase 1, "Decisions since this
  plan was written".
- OWASP ASVS 4.0.3, 2.2.1 (per-account anti-automation) — https://owasp.org/www-project-application-security-verification-standard/
- PostgreSQL documentation, `statement_timeout` and
  `idle_in_transaction_session_timeout` — https://www.postgresql.org/docs/current/runtime-config-client.html
- node-postgres, client configuration (`statement_timeout`,
  `idle_in_transaction_session_timeout`, `max`) — https://node-postgres.com/apis/client
- BullMQ, retrying failing jobs and `removeOnFail` — https://docs.bullmq.io/guide/retrying-failing-jobs
- tRPC v11, output validators — https://trpc.io/docs/server/validators
- NIST SP 800-38D (GCM, associated data) — https://csrc.nist.gov/publications/detail/sp/800-38d/final
- RFC 5869 (HKDF) — https://www.rfc-editor.org/rfc/rfc5869

## Documents changed

`docs/ERD.md`, `specs/001-foundations/contracts/kernel.md`,
`specs/001-foundations/tasks.md` (Phase 11 and the T074 note), `.env.example`,
`apps/api/src/jobs/README.md`, and `PLAN.md` (the extension, recorded by the
batch's opening commit).
