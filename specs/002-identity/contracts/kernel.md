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
| Administrator | `resolveAdminSession(bearer)` | the token's lookup hash, then `admin_sessions` and `admin_users`                                        | `{ adminId, mfaVerified }` or null    |

Standing is resolved on every request; nothing is cached across requests
(FR-108). A resolver never throws for a bad token: it yields null, and the
kinds answer `UNAUTHENTICATED`.

Both contexts gain `clientAddress`: the socket's peer address, or, when `TRUSTED_PROXY` (an optional platform key, T001) names the one proxy header to trust, that header's first hop. Before launch no proxy is configured (research R-18 left the host open), so it is the socket's; the hosting decision sets the key. It is the subject of the anonymous paths that have no better one (`auth.providerNonce`, `platform.publicConfig`, `catalog.subjects.list`, the four browser routes) and is never logged in full (R-SEC-2: the logger redacts it to its network).

## The caller kinds

| Kind                         | Change                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicProcedure`            | Unchanged                                                                                                                                                                                                                                                                                                                    |
| `studentProcedure`           | Requires role `student`; refuses `suspended` and `banned` with `ACCOUNT_RESTRICTED` unless the procedure declares `admitsRestricted: true`                                                                                                                                                                                   |
| `userProcedure` (new)        | Any authenticated person of either role, for what both roles share (the account, sign-out, deletion, identity verification); the restricted-account rule as the student kind; accepts a `rateLimit` declaration like the student and teacher kinds (`account.delete` declares one)                                           |
| `teacherProcedure`           | Requires a declaration `admits: 'applicant' \| 'approved' \| 'publishable'` (a procedure without one does not compile); refuses the standing below it with `FORBIDDEN`; the restricted-account rule as the student kind                                                                                                      |
| `adminProcedure`             | Requires `mfaVerified`; otherwise `MFA_REQUIRED` (or `MFA_SETUP_REQUIRED` when the administrator is unenrolled). Unchanged otherwise: one transaction, the audit record                                                                                                                                                      |
| `adminPublicProcedure` (new) | On the administrator tRPC instance, anonymous, with a required `rateLimit` declaration like the user surface's public kind; the admin context gains the rate limiter for it. Exists for sign-in, the second factor and the password-set link only; a test asserts the admin surface's public procedures are exactly `auth.*` |

A `verification_required` account is admitted by every kind of this phase; Phase 2's booking kind refuses it (FR-137). Only `suspended` and `banned` are the restricted standings.

The `UserSession` the context carries gains `accountStatus`, `role` (one, not
a set) and `teacher?` (data-model §6); `UserCaller` follows. The existing
`activeRoles` set becomes the single `role`: no procedure has read it, so the
contract snapshot is unaffected.

## Idempotency

The key is `(scope, actor_id, key)`; the kernel refuses to key an anonymous mutation (`actor_id` is the server-resolved principal). Keying is a call the handler makes, not a kind option, so what refuses a token-bearing output is a pipeline case: `packages/contracts/src/idempotent-procedures.ts` lists the keyed procedures, `tests/pipeline/output-leak.spec.ts` asserts over the snapshot that none of them has `accessToken`, `refreshToken`, `sessionToken` or `onboardingToken` in its output (R-DB-7), and the idempotency service takes its scope from that list and nothing else. `onboarding.complete` is therefore not keyed, and its single use is the token's `jti` mark.

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
`ijazah:admin-invite:v1`.
