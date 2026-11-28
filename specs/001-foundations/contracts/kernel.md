# Contract: Platform Kernel

> **Phase 1 amends this contract.** The caller kinds (`userProcedure`, `teacherProcedure({ admits })`, `adminPublicProcedure`), session resolution, the client address, the idempotency actor, the audit label and the public web pages are in [`specs/002-identity/contracts/kernel.md`](../../002-identity/contracts/kernel.md); what is written here stands where that document does not say otherwise.

What every request inherits without a feature author writing it. Each item below
is a guarantee that exists once, in one place, because a guarantee implemented
per-module is a guarantee that varies per-module.

---

## Error shape

Exactly one shape leaves the system, whatever failed and however deep:

| Field | Presence | Content |
|---|---|---|
| `code` | Always | A stable machine string. Never a database or vendor code |
| `message` | Always | Safe for display. Never a stack trace, query text or internal path |
| `details` | Optional | Structured field-level validation only |

A global filter maps everything — domain errors, validation failures, database
errors, provider errors, unhandled exceptions. R-API-8 and R-SEC-9 are satisfied
by there being no second path to a response, not by each handler remembering to
sanitise.

**The gender-enforcement interaction**: a forbidden profile answers 404, never
403 (R-GENDER-2). This lives in the mapping rather than in each caller, because
"forbidden" and "absent" must be indistinguishable from outside — and a single
handler that returns 403 by hand undoes the property for the whole surface.

**The build floor** *(R3, `specs/002-identity/tasks.md` T184; SRS DEC-99)*: the
phone sends its build number (Play's version code) in the `x-app-build` header
on every user-surface call and upload; a call without it is admitted (the panel
never sends it, and its surface never reads it); a value that is not 1 to 10
digits answers 400 `VALIDATION_FAILED`; a number below `min_app_build` (§3.14,
seed 0 = no floor; the floor held 60 s in the process) answers 426
`UPDATE_REQUIRED` in this shape, before any other check.

---

## Request context

Assembled server-side before any procedure runs. Every field is derived from the
server-held session; none is read from client input (R-GENDER-4).

| Field | Source |
|---|---|
| Caller identity | Session |
| Role | Session |
| Gender | Session; typed `RequesterGender` (declared in the kernel, `apps/api/src/platform/guards/requester-gender.ts`), and the request context is the only place in production code that may mint it |
| Locale | Session, defaulting to Arabic |
| Correlation identifier | Generated per request |

**Absent by design**: any client-supplied timestamp (R-TIME-6), and any
client-supplied identity, role or gender. These are not validated and rejected —
the write schemas have no such fields, so they cannot be expressed.

---

## Caller kinds

Four, and the way an endpoint declares who may call it:

| Kind | Admits |
|---|---|
| Public | Anyone, authenticated or not |
| Student | A caller holding the student role |
| Teacher | A caller holding the teacher role |
| Administrator | An authenticated administrator |

**Every kind takes its two schemas** (T169, owner's decision 2026-10-10):
`publicProcedure({ input, output })`, `studentProcedure({ input, output })`,
`teacherProcedure({ input, output })` and `adminProcedure({ input, output })`,
each a zod schema, and applies `.output(output)` beside `.input(input)`. A
procedure cannot be declared without an output schema, so what a handler
returns is parsed before it leaves: a field the schema does not name is
stripped (R-HONEST-4), the contract snapshot records the fields the schema
names and never an output inferred from the handler (R-API-9), and a result
that fails its schema is answered as the internal error, unexpected, while an
input that fails its schema stays the validation failure with its paths. A
procedure that takes nothing says so with `z.void()`.

**The administrator kind writes its own audit record** after the handler
returns and before the call commits (R-API-12, FR-049). There is no
administrative route that bypasses auditing, because auditing is not something
the handler does — it is something the caller kind does around the handler. It
opens one transaction per call, hands it to the handler as `ctx.tx`, and writes
the records the handler described on `ctx.audit` in that same transaction, so
the action's writes and its audit records commit or roll back together.

**Every write goes through the call's transaction.** A write made through the
process's database client instead of `ctx.tx` is outside the transaction: it
survives a call that is refused and rolled back, so part of an action is kept
with no audit record. So every
write method of a module repository takes the transaction it writes in
(`tx: Transaction`, from `apps/api/src/platform/db/`) rather than writing through
the client the repository was built over, and an administrator handler reaches
a module only through a function that takes `ctx.tx`.

**An administrator handler awaits no outside provider.** It makes no SMS, video
or push call through a port inside the call. The transaction has a time limit
(Prisma's interactive transactions default to 5 seconds), and a provider that is
slow would roll back the action and its audit record with it. Heavy work and
notifications are already kept out of a request handler and queued (R-API-13,
R-API-15).

**Administrator identity is separate throughout** (R-SEC-8): different table,
different token, different middleware. It is not a role on a user; it is a
different kind of principal.

---

## Two surfaces

| Surface | Serves | Mounted |
|---|---|---|
| User | Mobile application | Separately |
| Administrator | Admin web application | Separately |

A test asserts the two capability sets are disjoint (FR-048). The point is the
*generated types*: an administrative capability that appears in the user
surface's type surface has leaked into the mobile bundle's vocabulary even if no
screen calls it, and R-API-11 exists to prevent exactly that.

---

## Idempotency

A shared mechanism keyed in the same database as the effect it protects — the
`idempotency_keys` table owned by the kernel, unique on `(scope, key)` — so one
transaction covers both (research R-14, ADR 0008). A repeated operation returns the
original outcome without repeating the effect.

Every queued job must satisfy a double-run assertion in its own tests (R-API-14,
FR-052), and every inbound provider event is keyed by the provider's own event
identifier so a replay cannot double-insert (R-SESS-1, FR-036).

---

## Logging

Structured records, each carrying the correlation identifier. Two mechanisms
cover each other:

| Mechanism | Catches |
|---|---|
| Lint rule | A logger call receiving a raw request body |
| Redaction list declared in the logger | A sensitive value nested inside an object legitimately passed |

The second exists because the first structurally cannot see it. A lint rule reads
syntax; it cannot know that the third field of an object three levels down holds
a token. Neither mechanism is sufficient alone, which is why R-SEC-2 gets both.

---

## Guards applied by default

| Guard | Applies to | Rule |
|---|---|---|
| Rate limiting | Declared on the caller kind, never applied by hand (T170): `rateLimit: { key, subjectOf, budget? }`, required on the public kind and accepted by the student and teacher kinds; the kind applies it from the limiter the request context carries, after input validation, and stamps the key in the procedure's meta. The four default keys are the authentication, one-time-code, search and payment-initiation paths; a `budget` is a second key counted under the one subject `*` for every caller, checked first, so a path has a platform-wide cap beside its per-subject one (seeded for one-time code and authentication). Subjects are hashed with HMAC-SHA256 under a key derived from `ENCRYPTION_KEY` | R-SEC-6, NFR-SEC-10 |
| Content sniffing | Every upload; the declared type is discarded, not compared | R-SEC-4 |
| Request body limit | Both request surfaces, from configuration; an oversized body answers 413 in the one error shape. Uploads keep their own limit | FR-077, NFR-SEC-9 |
| Malformed input | Both request surfaces: an input that cannot be read answers 400 `VALIDATION_FAILED`, logged once at info with nothing of the body, never reported (T108) | FR-041, R-API-8, R-SEC-2 |
| Webhook signature verification | Every inbound gateway or provider event, on the raw body, before any handler; unsigned or invalid requests are rejected and no row is written | R-MONEY-9, R-SEC-12 |
| Cryptographic identifier generation | Certificate numbers, verification tokens | R-DB-6 |
| Column encryption and hashing | Per the data model's three-regime split. Every process builds its column cipher with `createColumnCipher(config)`, which holds `ENCRYPTION_KEY_PREVIOUS` beside `ENCRYPTION_KEY` while a rotation runs, so no process reads under the current key alone (T155) | R-DB-7, R-DB-8 |

---

## Configuration

Validated at startup against a declared schema. On failure the process **exits
naming the offending value**, before accepting traffic. A system that starts with
a missing encryption key and fails on the first write has converted a startup
error into a data error.

---

## Health signals

Two, and they answer different questions:

| Signal | Answers | Fails when |
|---|---|---|
| Liveness | Is the process running? | The process is wedged and should be restarted |
| Readiness | Can it serve? | A dependency is unreachable — it should be taken out of rotation, not restarted |

Collapsing them into one endpoint produces the failure where a deploy loops
forever restarting a healthy process whose database is briefly unavailable.
