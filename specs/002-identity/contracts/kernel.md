# Contract: What changes in the kernel

Phase 0's [`contracts/kernel.md`](../../001-foundations/contracts/kernel.md)
stays the contract; this document lists what this phase adds to it, each
change a guarantee that exists once. The Phase 0 document gains a pointer here
in the document pass.

## Session resolution

The HTTP application takes two resolvers at construction, handed in by
`main.ts` from the identity and admin modules' public entries, and calls one per
request before the context is built:

| Surface       | Resolver                      | Reads                                                                                                   | Yields                                |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| User          | `resolveUserSession(bearer)`  | the access token's HMAC, then one query over `user_sessions`, `users`, `user_roles`, `teacher_profiles` | `UserSession` (data-model §6) or null |
| Administrator | `resolveAdminSession(bearer)` | the token's lookup hash, then `admin_sessions` and `admin_users`                                        | `{ adminId, sessionId, mfaVerified }` or null |

Standing is resolved on every request; nothing is cached across requests
(FR-108). A resolver never throws for a bad token: it yields null, and the
kinds answer `UNAUTHENTICATED`.

Both contexts gain `clientAddress`: the socket's peer address, or, when `TRUSTED_PROXY` (an optional platform key, T001) names the one proxy header to trust, that header's **last** hop — the one the trusted proxy appended, never the first, which the client writes itself (an appended `X-Forwarded-For` opens with whatever the caller sent). The key is set only when exactly one proxy stands in front; when it is set and the header is absent, the socket's peer. **Amended by T147 (B50, 2026-11-19; W8):** the header is read only from the proxy's own address, `TRUSTED_PROXY_ADDRESS` (an IP address, a platform key, required when `TRUSTED_PROXY` is set), compared after reducing an IPv4-mapped form (`::ffff:a.b.c.d`) to its IPv4 address; its last hop is taken only when it is an IP address (`net.isIP`); otherwise, from any other peer or with a last hop that is not an address, the socket's peer, and the request logs once at warn why (`peer_not_proxy`, `hop_not_an_address`), with its correlation id and never the header. The API's port is reachable through the proxy only (the note under T018; `docs/RUNBOOK.md`, «Hosted deploy»). Before launch no proxy is configured (research R-18 left the host open), so it is the socket's; the hosting decision sets the key. It is the subject of the anonymous paths that have no better one (`auth.providerNonce`, `platform.publicConfig`, `catalog.subjects.list`, the four browser routes) and is never logged in full (R-SEC-2: the logger redacts it to its network).

## The caller kinds

| Kind                         | Change                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicProcedure`            | Unchanged                                                                                                                                                                                                                                                                                                                    |
| `studentProcedure`           | Requires role `student`; refuses `suspended` and `banned` with `ACCOUNT_RESTRICTED` unless the procedure declares `admitsRestricted: true`                                                                                                                                                                                   |
| `userProcedure` (new)        | Any authenticated person of either role, for what both roles share (the account, sign-out, deletion, identity verification); the restricted-account rule as the student kind; accepts a `rateLimit` declaration like the student and teacher kinds (`account.delete` declares one)                                           |
| `teacherProcedure`           | Requires a declaration `admits: 'applicant' \| 'approved' \| 'publishable'` (a procedure without one does not compile); refuses the standing below it with `FORBIDDEN`; the restricted-account rule as the student kind                                                                                                      |
| `adminProcedure`             | Requires `mfaVerified`; otherwise `MFA_REQUIRED` (or `MFA_SETUP_REQUIRED` when the administrator is unenrolled). Unchanged otherwise: one transaction, the audit record                                                                                                                                                      |
| `adminPublicProcedure` (new) | On the administrator tRPC instance, anonymous, with a required `rateLimit` declaration like the user surface's public kind; the admin context gains the rate limiter for it. Exists for sign-in, the second factor and the password-set link only; a test asserts the admin surface's public procedures are exactly `auth.*` |

The administrator context also carries the admin module's services through a port the surfaces
declare (`AdminSurfaceServices`, in the contract's types), which the admin module implements and
`main.ts` binds, as the audit writer is: the context may not import `modules/admin` (T067).
Another module's service on that surface is composed into the admin module's services, which may
import any module's entry: the catalog module's credential review is `credentials` (T069); the
verification module's review and identity requests are `applications` and `documents`, and identity's
standing `teachers` (T068), the review banning through that one standing, so one consequences
registry serves every action that ends an account (FR-142).

A `verification_required` account is admitted by every kind of this phase; Phase 2's booking kind refuses it (FR-137). Only `suspended` and `banned` are the restricted standings.

The `UserSession` the context carries gains `accountStatus`, `role` (one, not
a set) and `teacher?` (data-model §6); `UserCaller` follows. The existing
`activeRoles` set becomes the single `role`: no procedure has read it, so the
contract snapshot is unaffected.

## Idempotency

The key is `(scope, actor_id, key)`; the kernel refuses to key an anonymous mutation (`actor_id` is the server-resolved principal). Keying is a call the handler makes, not a kind option, so what refuses a token-bearing output is a pipeline case: `packages/contracts/src/idempotent-procedures.ts` lists the keyed procedures, `tests/pipeline/output-leak.spec.ts` asserts over the snapshot that none of them has `accessToken`, `refreshToken`, `sessionToken` or `onboardingToken` in its output (R-DB-7), and the idempotency service takes its scope from that list and nothing else. `onboarding.complete` is therefore not keyed, and its single use is the token's `jti` mark.

**No personal data in a stored outcome (T175, R1a).** A key's `response` holds ids, statuses, amounts and times, or null; never a name, a message body, an address or a note. A procedure whose answer carries personal data stores less and answers a replay from the rows: `run`'s third argument, `replay(tx, stored)`, reads the answer again on the replay's own transaction after the request's hash is checked, or the caller reads it in a transaction of its own (`account.certificateName.set` stores null and reads `users.certificate_name`; `checkout.hold` stores all but the teacher's name and reads it again through the visibility predicate, `NOT_FOUND` once the teacher is not visible; `chat.send` stores `{ messageId }` and reads the message, a purged one answering `purged`). **A deletion removes the person's keys:** `removeOfActor(tx, actorId, keep?)` (`platform/idempotency/idempotency.repository.ts`) deletes every key whose `actor_id` is the person on the deletion's transaction, after `eraseAccount`; the person's own `account.delete` keeps its running key (`keep`), whose `complete` follows the effect (deleting it would fail that update and roll the deletion back); it holds a null outcome until `expire-idempotency-keys`. The request hash stays (a hash, not the data). No other actor's key is touched; the delete filters on `actor_id` alone, a rare call with no index of its own (R-DB-9).

## The audit writer

`AuditEntry` loses nothing and gains nothing a handler sets: the writer
renders `targetLabel` itself from `targetType` and `targetId` through the
admin module's renderer (research R-108), refuses an empty or over-long label
by throwing before the insert, and the kind rolls the action back. A handler
cannot pass a label.

## Guards applied by default — additions

| Guard                      | Applies to                                                                                   | Rule           |
| -------------------------- | -------------------------------------------------------------------------------------------- | -------------- |
| Restricted-account refusal | Every user kind, unless `admitsRestricted`                                                   | FR-137         |
| Teacher standing           | `teacherProcedure` by its `admits`                                                           | FR-108, FR-192 |
| Second-factor requirement  | `adminProcedure`                                                                             | FR-170         |
| Public-page helper         | Every browser route: CSP, headers, no cookie, escaping, `rate_limit_public_page`             | FR-144         |
| Upload kinds               | `/uploads/documents`: content-decided type per kind, `upload_max_bytes`, `rate_limit_upload` | FR-151         |

## Two new pipeline gates

| Gate                                  | Where                                                                        | Refuses                                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Output leak test (R-HONEST-4)         | `tests/pipeline/output-leak.spec.ts`, stage 2, over `contract-snapshot.json` | Any user-surface output whose field names include `dateOfBirth` (outside `account.me`'s own-caller field), `storageKey*`, `*Hash`, `providerSubject`, `recipientRef*`, `passwordHash`, `mfaSecret*`; the list lives in one file with the reason for each name |
| Authorization-test gate (R-MOBILE-13) | `scripts/authz-test-gate.ts`, stage 3                                        | A non-public user-surface procedure in the snapshot with no module spec that names its path and asserts the kind's refusal (research R-115)                                                                                                                   |

Both are proven by a fixture that fails them, as every gate is
(`tests/pipeline/`).

## HKDF labels added to `encryption.ts`

`ijazah:access-token:v1`, `ijazah:onboarding-token:v1`,
`ijazah:admin-invite:v1`, and since T097 `ijazah:banned-identifier:v1`, the key of the
keyed hashes a banned person's deletion keeps (`banned_identifiers`). A rotation of
`ENCRYPTION_KEY` cannot carry those hashes over (RUNBOOK.md, the rotation steps).
