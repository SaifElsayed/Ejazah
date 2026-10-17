# Phase 1 Research: Identity and teacher onboarding

**Feature**: `specs/002-identity/` · **Date**: 2026-10-17

Every unknown in the plan's Technical Context, resolved. Each entry states what
was chosen, why, and what was rejected, and names the specification requirement
it serves. Decisions here are inputs to the design artifacts, not commitments
the specification makes: the specification states outcomes, this states how
they are reached. Numbering continues Phase 0's scheme in the 100 range, as the
specification's requirements do, so a citation never needs the phase spelled
out.

The constraints every entry works under: no third-party credential in the test
suite (SC-114), no paid infrastructure before launch (the owner's rule), no
numeric literal in module code (R-MONEY-12), every secret hashed or encrypted
(R-DB-7/8), and a team of one with seven days.

---

## R-101: Sessions — a signed short-lived access token and a rotated opaque refresh token (FR-101, FR-135)

**Decision**: Two tokens per device. The **access token** is a compact signed
string (`v1.<session id>.<expiry>.<HMAC-SHA256>`, the key derived from
`ENCRYPTION_KEY` by HKDF under `ijazah:access-token:v1`), fifteen minutes by
default, carrying nothing but the session id and its expiry; every request still
resolves the session row and the account's standing from the database (FR-108),
so the token is a pointer, not a claim set. The **refresh token** is 32 random
bytes in base64url, stored only as its SHA-256 lookup hash on `user_sessions`,
with an absolute lifetime of thirty days from issue that rotation never extends.
Each refresh rotates: a new refresh token is issued, the previous hash is kept
on the row for one grace window so a retried refresh is answered once, and a
hash presented after that window — or after a later rotation — revokes the whole
session (reuse detection). Sign-out revokes the device's row; deletion, ban,
suspension, a password reset and an administrator second-factor reset revoke
every row of the principal (FR-135). The two lifetimes and the grace are
settings keys (`session_access_ttl_minutes`, `session_refresh_ttl_days`,
`session_refresh_grace_seconds`), never constants (R-MONEY-12).

**Rationale**: FR-AUTH-7 asks for server-side revocation, which an opaque row
gives and a self-contained token does not; rotation with reuse detection is the
OAuth 2.1 requirement for public clients and the OWASP recommendation, and it
turns a stolen refresh token into a detected one. A per-request database read is
required anyway by FR-108 (standing resolved on every call), so a self-contained
access token would save nothing. The access token exists only so that the hot
path verifies one HMAC before it reads one row, and so a leaked row hash cannot
be presented as a token (the hash is one-way).

**Alternatives rejected**: a single opaque session token looked up per request
(simplest, but every revocation and rotation question collapses onto one value,
and a long-lived opaque token in transit on every call is the larger exposure);
JWT access tokens carrying role and gender (rejected by R-GENDER-4's spirit:
authority would live in a client-held artefact for its lifetime, and a suspended
account would keep calling until expiry); a third-party session library (no
need: `node:crypto` and one table).

**Sources**: [OAuth 2.1 draft — refresh token rotation for public clients](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) · [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) · the Phase 0 hashing module (`hashing.ts`, "a lookup token: SHA-256, unsalted").

---

## R-102: The onboarding token is stateless and signed, single-use by a Redis mark (FR-125)

**Decision**: A proven identity is handed to the device as a signed token
(HMAC-SHA256 under `ijazah:onboarding-token:v1`) whose payload is the provider
and its subject (or the verified email), whether the email is verified, the
prefill name and email the provider offered, a random id (`jti`) and an expiry
of `onboarding_token_ttl_minutes` (fifteen). Only `onboarding.complete` and
`onboarding.requestEmailCode` accept it. Single use is held in Redis: at
completion the completing transaction first claims `onboarding:<jti>` with
`SET NX EX <ttl>`; a second presentation finds the mark and is refused. Nothing
of the person is written anywhere on the server until the account is.

**Rationale**: ADR 0012 D4's third reason — nothing is stored before the account
exists — is met best by storing nothing: the device holds the token, the server
holds a mark that names no one. Redis is the right place for a mark whose loss
costs the person one more sign-in and nothing else (the kernel rule "never Redis
for anything whose loss would diverge from the database" is respected: there is
no database state to diverge from). An expired token is refused by its own
expiry, so the mark needs no sweep.

**Alternatives rejected**: a stored row (a table of half-onboarded people, the
very thing ADR 0012 D4 removed); a token with no single-use mark (a replayed
completion would try to create a second account and fail on the uniques, but the
refusal would then be a late uniqueness error rather than a clean "this token
was used").

---

## R-103: Provider sign-in is a port with a stand-in; tokens are verified with `node:crypto` against the provider's JWK set (FR-120, FR-121)

**Decision**: A seventh port, `sign-in` (`platform/ports/sign-in/`), in the
project's own terms: `verifyIdentityToken({ provider, token, nonce })` returns
the provider identity (provider, subject, email and whether it is verified, a
display name when offered); `exchangeAuthorization({ provider: 'apple', code })`
returns the provider's refresh token, needed later to revoke; `revoke({
provider: 'apple', refreshToken })`. The real adapter fetches and caches each
provider's JWK set (Google's and Apple's published keys), verifies the token's
signature with `node:crypto`'s JWK import, checks issuer, audience (the
configured client ids), expiry and the nonce, and reads Google's
`email_verified` and Apple's `email_verified`/`is_private_email`. The stand-in
accepts a documented fake token shape signed under a key derived from
`ENCRYPTION_KEY`, still checks the nonce, and records every call, so the suite
exercises every branch with no credential. Selection is `SIGN_IN_PROVIDER`
(`fake` now; `live` lands with the adapter task), and the provider keys
(`GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_PRIVATE_KEY`) are optional provider keys the test setup strips.

On the phone, Google is `@react-native-google-signin/google-signin` (Expo's own
recommendation for Google) with a nonce generated by `expo-crypto`, and Apple is
`expo-apple-authentication` with the SHA-256 of the raw nonce in the request, as
Apple requires; the raw nonce goes to the server with the token.

**Rationale**: ARCHITECTURE §3.1 says a port exists only where a real second
implementation exists; here it does from day one (the stand-in the suite needs,
the live adapter the product needs), and the verification touches a network
(the JWK sets), which no test may. Putting it inside the identity module as a
private adapter would still be a second implementation selected by
configuration — which is what a port is — while hiding it from `ports.module.ts`
and R-API-4's lint. `node:crypto` verifies RS256 and ES256 from a JWK directly,
so no JWT library is added. Apple's technote TN3194 says the revoke endpoint
needs a refresh or access token obtained by validating the authorization code,
so the code is exchanged at the first sign-in and the refresh token kept,
encrypted (R-DB-8), for the deletion that ADR 0015 D3 requires.

**Alternatives rejected**: `expo-auth-session` for Google (a generic OAuth flow
where Expo's docs point at the provider's own library instead; nonce handling is
undocumented for it); a JWT library (`jose`) — one more dependency for what two
`node:crypto` calls do; verifying on the device (never: the server is the only
party that may trust a token, R-GENDER-4).

**Sources**: [Expo — Authentication with OAuth or OpenID providers](https://docs.expo.dev/guides/authentication/) · [react-native-google-signin — nonce](https://github.com/react-native-google-signin/docs/pull/82/files) · [Apple TN3194 — Handling account deletions and revoking tokens](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple) · [Apple — Revoke tokens](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens) · [Google — Verify the Google ID token on your server side](https://developers.google.com/identity/sign-in/web/backend-auth).

---

## R-104: One-time codes reuse Phase 0's peppered Argon2id hash; the email is sent inline, after the row commits (FR-120, FR-129, FR-143)

**Decision**: A six-digit code is drawn from `node:crypto`, stored as the
peppered Argon2id hash the Phase 0 hashing module already defines for codes,
with `expires_at` from `otp_code_ttl_minutes` (ten) and `attempt_count` capped
by `otp_max_attempts` (five); a code is consumed on first success and a
destination has at most one live code per purpose (a new request supersedes).
The email carrying it is sent **inline from the service, after the row's
transaction has committed and outside any transaction**, through the email port.
The same holds for the deletion confirmation and the password-reset code. The
administrator invite link, which an administrator handler sends, is queued
instead (R-110), because an administrator handler awaits no outside provider
(`contracts/kernel.md`).

**Rationale**: The code is unrecoverable by design (R-DB-7), so a queued
delivery job, whose payload may carry identifiers only (R-SEC-2, `job.ts`),
could not re-derive it; the send must happen where the plaintext exists, once.
A transactional email is one short network call, not the heavy work R-API-13
queues. Sending after commit means a failed send never leaves a committed code
with no email on its way and no retry: the person taps resend, which writes a new
code.

**Alternatives rejected**: an outbox table with the plaintext code (a stored
plaintext secret, R-DB-7); encrypting the code for a job to decrypt (recoverable
secrets are for values a third party must be shown, not for a code the person
types; it would also double the storage regime for one table).

---

## R-105: Passwords — length only, a bundled list of breached passwords, no network (FR-128)

**Decision**: At least eight characters and at most 128 (the cap keeps the
Argon2id call bounded), no composition rule, and a server-side check against a
bundled list of the most common breached passwords (the top 100,000 of a
published breached-password list, shipped as a sorted file of SHA-1 prefixes
under `apps/api/src/modules/identity/breached-passwords/` and searched by
binary search), refused with one message. The list is updated by replacing the
file; its generation is a script, not a runtime fetch.

**Rationale**: NIST SP 800-63B §5.1.1.2 requires a minimum length, forbids
composition rules, and asks that a chosen password be compared against a list of
compromised values; a bundled list satisfies it with no network call, no
provider, no k-anonymity API to rate-limit, and no third-party credential
(SC-114). The screens.md rule of 2026-10-17 fixed eight characters and the
breached check.

**Alternatives rejected**: the Have I Been Pwned range API (a network call in the
sign-up path, a provider dependency, and a privacy question about sending even a
five-character hash prefix); a complexity rule (forbidden by NIST and by the
owner's rule).

**Sources**: [NIST SP 800-63B, §5.1.1.2 Memorized Secret Verifiers](https://pages.nist.gov/800-63-3/sp800-63b.html#memsecretver).

---

## R-106: Standing is resolved on every request, and the teacher kind declares what it admits (FR-108, FR-130, FR-137, FR-192)

**Decision**: The identity module exposes `resolveUserSession(bearer)` through
its public entry; the HTTP application hands it to the context factory, which
calls it once per request. It verifies the access token's HMAC, loads in one
query the session row, the user (gender, language, account status, deleted_at),
the single role, and for a teacher the profile's verification status and
payout verification instant, and builds the `UserSession` the caller kinds
narrow. The kinds gain two declarations. `teacherProcedure({ admits })` is
required: `'applicant'` (any teacher-role holder whose account is not banned:
the application, status, credentials-after-approval and account paths),
`'approved'` (verification status approved), or `'publishable'` (approved and
payout verified; nothing in this phase declares it, Phase 2's publishing paths
do). Every user kind refuses a `suspended` or `banned` account with
`ACCOUNT_RESTRICTED` unless it declares `admitsRestricted: true` (the account
read, sign-out, deletion and the restricted screen's data); a
`verification_required` account is admitted by every kind of this phase, and
Phase 2's booking kind refuses it. Admin sessions are resolved the same way by
the admin module (`resolveAdminSession`), including whether the second factor
was verified on that session.

**Rationale**: PLAN.md's ERD item asks where status, role, approval and payout
are resolved; the answer "on every request, from the database" is the only one
under which a suspension takes effect on the next call (edge case "A suspended
person is still signed in") and under which `teacherProcedure` stops having two
meanings (the closure review's finding). A required `admits` makes the
declaration unforgettable, as `rateLimit` is on the public kind (T170).

**Alternatives rejected**: caching standing in the access token (stale for up to
fifteen minutes; see R-101); separate kinds per standing (three more exported
builders where one declaration reads better and the type still refuses an
omission).

---

## R-107: Administrator sign-in — TOTP from `node:crypto`, hashed single-use recovery codes, lockout as a column pair behind the throttle (FR-170 to FR-173)

**Decision**: The second factor is RFC 6238 TOTP (SHA-1, six digits, thirty
seconds, one step of drift either way), computed with `node:crypto` (HMAC) and
no library; the secret is generated at invite, encrypted with the column cipher
(`mfa_secret_encrypted`, already NOT NULL) and shown once as an `otpauth://` QR
and a manual key on the setup page; `mfa_enrolled_at` is null until the first
code is confirmed, and an unenrolled administrator reaches nothing but setup.
Ten recovery codes of ten Crockford base32 symbols are drawn from the
identifiers module, shown once, stored peppered-and-hashed in
`admin_recovery_codes` (the OTP regime: low entropy, so peppered), each marked
`used_at` on use; regeneration replaces the set. Lockout is two columns on
`admin_users` — `failed_sign_in_count` and `locked_until_at` — against the
settings `admin_lockout_attempts` (5) and `admin_lockout_minutes` (15); the
password is verified even when the account is unknown or locked (against a fixed
decoy hash) so the three refusals take the same time and answer the same
`ADMIN_SIGN_IN_FAILED`; the authentication throttle and budget (T170) run first.
An MFA reset by another administrator (reason mandatory, audited) clears
`mfa_enrolled_at`, rotates the secret, deletes the recovery codes and revokes
every admin session of the target. The admin session is one opaque token,
stored hashed on `admin_sessions`, carried in the `Authorization: Bearer`
header, held by the panel in `sessionStorage`, with `mfa_verified_at` null
until the code is verified (the "ticket" of the sign-in flow is simply a session
the admin kind refuses), an idle limit `admin_session_idle_minutes` (60) and an
absolute limit `admin_session_max_hours` (12).

**Rationale**: ADR 0019 D3 fixes the numbers and the indistinguishable answer;
a column pair keeps the lockout in the database the admin module owns, with no
Redis state that a restart would clear; the decoy verify is the standard answer
to timing enumeration. TOTP is fifteen lines over HMAC; a library would add a
dependency for a function the suite can test against RFC 6238's vectors. The
bearer header with no cookie is the review's decision (no CSRF surface), and
`sessionStorage` ends the session with the tab, which is the right default for
a back office.

**Alternatives rejected**: WebAuthn (no second device requirement in the SRS,
and the owner's panel is one browser); SMS codes (the SMS port is unused by
decision, ADR 0012); cookies with SameSite (a cookie is a CSRF surface the
review chose to not have).

**Sources**: [RFC 6238 — TOTP](https://www.rfc-editor.org/rfc/rfc6238) · [RFC 4226 — HOTP](https://www.rfc-editor.org/rfc/rfc4226) · [OWASP Authentication Cheat Sheet — account lockout and timing](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

---

## R-108: The audit label is rendered by a server-side Arabic renderer in the admin module (FR-180, FR-181)

**Decision**: `modules/admin/labels/` holds the Arabic templates that were
`admin.audit.targets.*`, `admin.credentials.a11y.documentPage` and
`admin.dialogs.mfaReset.title`, and two functions: `targetLabel(type, id)`,
pure, returning the kind word and the identifier («حساب · {id}», «طلب انضمام ·
{id}», «إجازة · {number}», «إعداد · {key}»), refusing an empty result or one
over 200 characters; and `resolveTargetName(tx, type, id)`, which joins the
target's current display name at read time and applies the fused form («لـ» +
«ال…» → «لل…»). The audit writer takes `targetLabel` from the entry's type and
id itself — a handler cannot pass a label — so the invariant "never a name,
never typed text" holds by construction. The admin audit query returns the
stored label and the resolved name side by side; a deleted person resolves to
the role word.

**Rationale**: ADR 0021 D2 as written; the writer owning the render is what
keeps a handler from ever putting a name in it. The three catalogue keys leave
`apps/admin/src/i18n/` in the same task, with the parity check following.

---

## R-109: Uploads are one HTTP route behind the kernel's sniffing middleware; documents are referenced by id (FR-151)

**Decision**: `POST /uploads/documents` (multipart, authenticated by the user
bearer, under the kernel's upload middleware that decides the type by content
and the size by `upload_max_bytes`) stores the file through the storage port
under a key the server mints, writes a `verification_documents` row with the
key encrypted, and returns `{ documentId }`. Every procedure that needs a file
takes a document id the caller must own (or, for an admin, any). PDF is the only
type admitted on this route for identity documents and credentials; the
student's profile photo uses the same route with image types admitted on its
own path. Signed links are minted on demand by the verification module for the
uploader or an admin, never stored.

**Rationale**: tRPC carries JSON; the kernel already has the multipart path and
the sniffing guard (T097). Referencing a document by id keeps the tRPC input
schemas free of binary data and lets the sniffing happen once, at the one place
bytes enter.

---

## R-110: The email port is `deliver(to, mail)`; the identity module renders; one queued job for the invite (FR-215)

**Decision**: `EmailPort.deliver({ to, subject, text, html? })`, with a stand-in
that records every mail and can be told to fail, selected by `EMAIL_PROVIDER`
(`fake`; the live member arrives at launch with the chosen sender) and
`EMAIL_FROM`. Templates live in the identity module (`mail/`), in both
languages, keyed by the person's locale, with the code or link interpolated by
an escaping renderer. The administrator invite is the one queued delivery
(`deliver-admin-invite { adminId }`): the job mints the password-set link as a
signed stateless token (`ijazah:admin-invite:v1`, 48 hours, single use by
`password_set_at`) at send time, so its payload is an identifier only.

**Rationale**: A port in domain terms (R-API-5), small enough to be honest, with
the rendering where the words belong. The invite is queued because the kernel
contract forbids an administrator handler from awaiting a provider; its link can
be minted in the job because it needs no unrecoverable secret, unlike a code
(R-104).

**Alternatives rejected**: a template-aware port (vendor template ids would leak
into the interface); a generic outbox job for every mail (see R-104).

---

## R-111: The public pages are an escaping tagged template in the kernel, with the design's stylesheet served by the API (FR-144)

**Decision**: `platform/web/` holds `html` (a tagged template that escapes every
interpolation; a value is marked safe only by `raw()` on a string the server
built), a page layout (`lang`, `dir`, the stylesheet link, no inline script),
and a route helper that applies the anonymous rate limit and the strict
`Content-Security-Policy` (`default-src 'none'; style-src 'self'; img-src
'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`) over the
security-headers middleware already in place; no `Set-Cookie` can be emitted
from these routes (the helper strips it). The design's stylesheet is served as
static assets under `/public/design/` from a copy the token build writes into
`apps/api/src/web/assets/` (`tokens.css` by `scripts/build-tokens.ts`,
`components.css` copied by the same script), both under `check:generated`. The
routes: `GET /terms` (the Terms body with its version, from a served Markdown
file under `apps/api/src/web/terms/` per language), `GET /delete-account`,
`POST /delete-account` (the email step; one sentence for every address), `POST
/delete-account/confirm` (email and code in the form body, never the URL;
renders the done page on success). English by `?lang=en` on every route.

**Rationale**: ADR 0021 D5's conditions, each made structural: escaping by
default is the template's only mode; the headers are set by the helper, not per
page; the cookie is stripped, not avoided by discipline. A template engine
would add a dependency and a second syntax for four pages.

**Alternatives rejected**: a template engine (EJS, Handlebars); public routes in
the admin SPA (decided against, ADR 0021 D5); a static site (paid hosting and
a deploy before launch).

---

## R-112: The phone app — Expo Router, NativeWind, `intl-messageformat`, secure storage (FR-200 to FR-206)

**Decision**: Expo with Expo Router (the file tree is the navigation tree, as
Phase 0 laid out), NativeWind over the generated `tailwind.theme.json`,
`lucide-react-native` for the icon registry, `expo-secure-store` as the one
sensitive store (R-MOBILE-10), the tRPC client in `lib/client.ts` as the one
network path (R-MOBILE-11), `@react-native-google-signin/google-signin` and
`expo-apple-authentication` (R-103), `expo-document-picker` for the PDF uploads.
The i18n runtime is `intl-messageformat` over the two catalogues with
`Intl.PluralRules`, polyfilled by `@formatjs/intl-pluralrules` where the JS
engine lacks the Arabic categories (checked at start-up, loaded only then);
direction follows the language through `I18nManager` with the reload Expo
needs, which is a reload and not a sign-out (FR-LOC-3). The versions are pinned
exactly at the first mobile task and recorded in its note, as Phase 0 pinned
its tools.

**Rationale**: Each is the choice ARCHITECTURE §6 and ADR 0020 already name or
imply; `intl-messageformat` is the reference ICU MessageFormat implementation
and the catalogues are written in that syntax (ADR 0020 D6); the plural polyfill
is a guarded import because Hermes's CLDR coverage for Arabic's six categories
is not something to assume on every device.

**Sources**: [FormatJS — intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/) · [MDN — Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules).

---

## R-113: The admin panel — React with shadcn/ui on the generated CSS variables, a bearer in `sessionStorage` (FR-170, FR-175, FR-176)

**Decision**: Vite + React, `react-router` for the paths screens.md names,
TanStack Query over the tRPC client for the admin surface, shadcn/ui components
themed by `apps/admin/src/design/tokens.css` at compact density (ADR 0014 D1),
the same `intl-messageformat` runtime over the admin catalogue, `dir` and
`lang` on the root from the chosen language, and user content wrapped in
`<bdi>`. The session token lives in `sessionStorage` and is sent as a bearer by
the tRPC client's header function; a 401 clears it and routes to sign-in. No
cookie anywhere.

**Rationale**: ADR 0014 as written; the transport is R-107's.

---

## R-114: The recipient reference gets a lookup hash; recipient events are routed by it (FR-109, FR-191)

**Decision**: `teacher_profiles.payout_account_ref_hash text unique nullable`,
the SHA-256 lookup hash of the gateway's recipient reference, written beside
the encrypted reference on registration and replacement. The payments module's
webhook handler records the signed event (replay-safe on `provider_event_id`),
then asks the identity module's public entry to apply the verdict by hash:
`markPayoutVerified(recipientRefHash)` or `markPayoutRejected(recipientRefHash,
reason)`. An unknown hash is recorded and reported, and changes no row.

**Rationale**: The owner's clarification; the pattern is
`device_push_tokens.token_hash` (research R-9 of Phase 0), which the schema
check already admits as a lookup hash beside an encrypted column.

---

## R-115: The R-MOBILE-13 gate is an authorization-test completeness check over the contract snapshot (FR-210)

**Decision**: `scripts/authz-test-gate.ts`, a stage-3 step named for
R-MOBILE-13. From the contract snapshot it takes every user-surface procedure
whose kind is not public, and for each requires a spec file under
`apps/api/src/modules/**` that names the procedure's path and asserts the
kind's refusal (`UNAUTHENTICATED`, `FORBIDDEN` or `ACCOUNT_RESTRICTED`) — the
test that a caller the UI would hide the action from is refused by the server.
A procedure with no such spec fails the gate naming R-MOBILE-13 and the path.
`scripts/suite-gate.paths.ts` gains the coupling: a change under
`apps/mobile/src/features/**` that adds a reference to a procedure path must
carry a change under the spec that covers it, judged by the same script, so the
server test "exists in the same pull request" (constitution 2.4.0).

**Rationale**: "Hiding an action in the UI is not authorization" cannot be read
from a diff of a screen; what can be checked is that every action a screen can
reach has a server test proving the server refuses the wrong caller. The
snapshot already lists every procedure with its kind (T098, T169), so the gate
reads a file the pipeline already produces.

**Alternatives rejected**: a heuristic over mobile diffs (`disabled=`,
`hidden`) — unsound in both directions; review only (the constitution kept the
`CI` tier on purpose, T165).

---

## R-116: The soft-deletion relation rule is a lint rule over repository files (FR-214)

**Decision**: `db/no-unfiltered-relation-read` in `eslint-plugin-ijazah`: in a
`*.repository.ts` file, an `include` or `select` naming a relation whose target
model carries `deletedAt` (`users`, `sessions`, `enrollments`, `ijazahs`, read
from the Prisma schema at lint time) must carry `where: { deletedAt: null }` on
that relation, or the rule reports naming R-DB-3 and the relation. A fixture
under `tests/violations/` proves it, as every lint rule is proven.

**Rationale**: ADR 0011 deferred it to "Phase 1, with the first repository that
reads a relation"; this phase's credential queries join `users` through
`teacher_profiles`, so the first such read is here.

---

## R-117: Idempotency keys gain the actor (FR-106)

**Decision**: `idempotency_keys (scope, actor_id, key)` unique, `actor_id text
NOT NULL` (the server-resolved user or administrator id; the kernel refuses to
key an anonymous mutation). The service's request hash keeps the actor as well,
so a reuse by another actor is refused with CONFLICT as today and never answered
from a stranger's row. The retention and the sweep are unchanged.

**Rationale**: The closure review's finding; two clients choosing the same
client-side key in one scope must not collide.

---

## R-118: The two purge sweeps and the session sweep (FR-107, FR-135)

**Decision**: Three scheduled jobs on the Phase 0 queue, each with the double-run
assertion: `purge-otp-codes` (consumed, or expired longer ago than
`otp_purge_after_hours`), `purge-stale-push-tokens` (`last_seen_at` older than
`push_token_stale_days`), `purge-expired-sessions` (user and admin session rows
past `expires_at` or revoked longer ago than `session_purge_after_days`; a
revoked row is kept for that window so reuse detection has something to find).
Each window is a settings key.

---

## R-119: The adversarial suite's inverted subjects (FR-211)

**Decision**: `tests/adversarial/gender.spec.ts` gains two subjects that must
fail: `noGenderConjunct` (the predicate without `teacher.gender ===
requester.gender`) and `asymmetricV11` (the v1.1 rule: a female requester sees
both genders, a male requester only males). A describe block runs the whole case
table against each and asserts, in each direction, that at least one case
disagrees with the hand-written expectation — the harness's `expectToBite` —
without marking the suite red: the suite is red only if a leaky subject
_passes_. The register's rows for R-GENDER-1 and R-GENDER-3 cite that block.

---

## R-120: Team-of-one working method, applied to this phase's batches (SC-115)

**Decision**: The tasks step groups the phase into batches of at most six, in
this order of dependency: the ERD pass and the document pass; the kernel changes
(session resolution, the teacher kind's `admits`, the admin public kind, the
leak test, the idempotency actor); the ports (sign-in, email) and the uploads
route; identity (sign-in, onboarding, sessions, reset, deletion); the admin
module (sign-in, MFA, lockout, admins page, audit label); verification and
credentials (the application, the queue, the review); payout; the mobile
foundation (primitives, providers, i18n, trees) and then the screens by story;
the admin panel foundation and pages; the gates and proofs; the register
re-count and the quickstart run. Each batch is one branch, one pull request,
one review by Saif's review session; the owner's device steps (SC-101, SC-105)
close the phase.
