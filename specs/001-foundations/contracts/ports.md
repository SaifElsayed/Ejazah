# Contract: Port Interfaces

Five ports: payment, storage, video, push, sms. Each is named in the project's
own domain terms; none names a vendor (R-API-5). Each ships in Phase 0 as an
interface plus a working stand-in; only storage ships real implementations here. Each ships in Phase 0 as an interface plus a working stand-in. Only
storage ships with real implementations, because Phase 1 uploads documents the
moment it exists (FR-055).

**The naming test**: read the operation aloud. If it describes something the
product does, it belongs. If it describes something a vendor does, it does not —
`createSessionToken` passes, `createMeetingToken` does not, and the difference is
not cosmetic. The second name commits every caller to a vendor's model of what a
meeting is.

---

## StoragePort

The only port with real implementations in this phase.

| Operation | Purpose |
|---|---|
| Put an object under a key, with a declared content type | Store a document, certificate, signature, attachment or photo |
| Get a temporary readable link for a key, with an expiry | Serve it |
| Remove an object by key | Retention and purge jobs |
| Report whether a key exists | Integrity checks |

**Prohibited by construction**: any operation returning a durable, publicly
reachable path. R-SEC-3 is enforced by the *absence* of such an operation — there
is nothing to call, so no caller can accidentally serve a document from a
guessable location. This is the pattern to copy: where a rule forbids something,
prefer removing the capability over documenting the prohibition.

**Implementations**: local filesystem for development; remote object storage for
deployed environments; selected once at startup from configuration.

---

## PaymentPort

Stand-in only in this phase; the real gateway adapter lands in Phase 2 once
OPEN-11 selects a gateway. Direct checkout, 0% commission, zero custody (ADR 0007).

| Operation | Purpose |
|---|---|
| Create a checkout for an enrollment, given a gross amount and currency | Start a gateway order; returns the order reference and the hosted checkout location |
| Verify and parse an inbound event from its raw body and headers | The only way a payment or recipient status becomes known; throws on a bad signature |
| Register a payout recipient for a teacher | Post-approval payout onboarding (FR-PAYG-13) |
| Report a recipient's verification status | Poll fallback for the gate (FR-PAYG-15) |

**Prohibited by construction**: any operation that reads a balance, moves funds
between parties, or issues a refund. The platform holds nothing to balance, move
or refund (FR-PAYG-1, FR-PAYG-10). As with storage, the rule is enforced by the
absence of the operation rather than by documenting the prohibition.

**Constraints carried by the interface**: the parse operation takes the raw body,
so signature verification cannot be skipped by handing it a parsed object
(R-MONEY-9); every parsed event carries the provider's own event id, which the
caller persists under a unique NOT NULL column before acting (R-MONEY-8); the
recipient operations return a reference, never account data, so nothing but an
encrypted reference can reach the database (R-DB-8).

**Stand-in behaviour**: records every call; can be told to fail; can produce a
correctly signed and an incorrectly signed event for any order it created, so the
kernel's signature guard (FR-074) is exercised without a network.

## VideoPort

Stand-in only in this phase.

| Operation | Purpose |
|---|---|
| Create a room for a session | Prepare a lesson |
| Issue a join token bound to one session and one participant | Admit someone |
| Record an inbound participant event | Attendance evidence |
| End a room | Cleanup |

**Constraint carried by the interface**: a token is issued for a session *and* a
participant together — never for a session alone. R-GENDER-7 forbids a token not
bound to both, and an interface that accepts only a session identifier makes the
violation unrepresentable rather than merely discouraged.

---

## PushPort

Stand-in only in this phase.

| Operation | Purpose |
|---|---|
| Deliver a notification to a device target | Reach a user |
| Report a target as stale | Prune dead tokens |

**Constraints**: reachable only from the queued notification job (FR-057,
R-API-15), and the payload carries identifiers for deep-linking only — never
personal content, which is rendered in the application (R-HONEST-5).

---

## SmsPort

Stand-in only in this phase.

| Operation | Purpose |
|---|---|
| Send a message to a destination | One-time codes, critical alerts |

**Constraint**: the code itself never enters a log (R-SEC-2), which the logger's
declared redaction list enforces alongside the lint rule.

---

## Stand-in behaviour

A stand-in is not a stub that returns nothing. Each records what it was asked to
do so a test can assert on it, and each can be told to fail so failure paths are
exercised without a network. The whole suite passing with no credential present
(SC-005) is the test that this was done properly — if a stand-in is too thin,
some code path will only be reachable against a real provider, and that path is
exactly where a Phase 3 bug will live.
