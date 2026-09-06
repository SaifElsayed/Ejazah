# Contract: Platform Kernel

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

---

## Request context

Assembled server-side before any procedure runs. Every field is derived from the
server-held session; none is read from client input (R-GENDER-4).

| Field | Source |
|---|---|
| Caller identity | Session |
| Role | Session |
| Gender | Session |
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

**The administrator kind writes its own audit record** before the handler
returns (R-API-12, FR-049). There is no administrative route that bypasses
auditing, because auditing is not something the handler does — it is something
the caller kind does around the handler.

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
| Rate limiting | Authentication, one-time-code and search paths, available to any endpoint | R-SEC-6 |
| Content sniffing | Every upload; the declared type is discarded, not compared | R-SEC-4 |
| Webhook signature verification | Every inbound gateway or provider event, on the raw body, before any handler; unsigned or invalid requests are rejected and no row is written | R-MONEY-9, R-SEC-12 |
| Cryptographic identifier generation | Certificate numbers, verification tokens | R-DB-6 |
| Column encryption and hashing | Per the data model's three-regime split | R-DB-7, R-DB-8 |

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
