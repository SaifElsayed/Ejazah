# Implementation Plan: Phase 1 — Identity and teacher onboarding

**Branch**: `002-identity` (the cycle runs on `Ejazah_app/001-foundations/T177`; the implementation batches are `Ejazah_app/002-identity/<task ids>`) | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-identity/spec.md`, clarified 2026-10-17

## Summary

Let a person sign in and become exactly one account, let a teacher apply with
their identity document and one ijazah PDF per subject, let an admin — a
separate principal with a mandatory second factor — review each credential,
transcribe its chain, approve the teacher and leave an audit record whose target
is never a name, and let the approved teacher set up the payout account the
gateway must verify before anyone can see them. Build the first screens of both
applications from the design in the repository, and close the proofs Phase 0
left to this phase. One person, seven working days from 2026-10-17, reviewed
by Saif's review session.

The technical approach, from [research.md](./research.md), rests on five
decisions that shape everything else:

1. **Standing is resolved on every request, and the kinds declare it.** One
   query per authenticated call yields the account's status, its one role and
   the teacher's approval and payout standing; `teacherProcedure({ admits })`
   and the restricted-account rule make what a procedure admits a declaration
   the compiler checks, so `teacherProcedure` has one meaning and a suspension
   takes effect on the next call (R-106).
2. **Nothing of a person is stored before the account exists.** The proven
   identity rides in a signed onboarding token the device holds; its single use
   is a Redis mark that names no one; the completing step writes four rows in
   one transaction and issues a session only then (R-102).
3. **Sessions are rows.** A short signed access token points at a
   `user_sessions` row whose refresh token is a hash, rotated with reuse
   detection; revocation is an update, and every destructive event revokes by
   user (R-101). Administrators get their own table and a bearer with no cookie
   (R-107).
4. **Provider verification is a port.** Google and Apple tokens are verified
   through `platform/ports/sign-in/` with a stand-in the suite runs against,
   with `node:crypto` and no JWT library; the email port is its twin (R-103,
   R-110).
5. **Every proof is a machine.** The audit writer renders the label itself; the
   leak test reads the snapshot; the authorization-test gate reads it too; the
   soft-deletion relation rule lints the repositories; the adversarial suite is
   shown to bite (R-108, R-115, R-116, R-119).

Scope is the forty-four SRS ids and the six clarified additions; nothing
else. Discovery, profiles, packages, booking, sessions, notifications and
certificates are later phases, and this phase leaves each of them exactly one
seam.

## Technical Context

**Language/Version**: TypeScript 5.x `strict` with `noUncheckedIndexedAccess` on Node 24 (Argon2id from `node:crypto`, T069), as Phase 0 pinned them.

**Primary Dependencies**: Everything Phase 0 chose (pnpm workspaces, tRPC over Nest, Prisma 7 multi-file schema, BullMQ, Vitest, `eslint-plugin-ijazah`, Zod 4). New in this phase: on the phone, Expo with Expo Router, NativeWind over the generated theme, `lucide-react-native`, `expo-secure-store`, `expo-document-picker`, `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `expo-crypto`, `intl-messageformat` with `@formatjs/intl-pluralrules` as a guarded polyfill; on the admin panel, React, `react-router`, TanStack Query, shadcn/ui on the generated CSS variables, the same `intl-messageformat`. On the API, one new runtime dependency, `otplib` for TOTP (R-SEC-7: proven libraries for auth and crypto code); token signing, JWK verification and the escaping template are `node:crypto` and the kernel. Versions are pinned exactly by the first task that installs each, recorded in its note.

**Storage**: PostgreSQL 18 as Phase 0 left it, thirty-nine tables after this phase's six forward migrations ([data-model.md](./data-model.md)); Redis for the rate limiter, the queue and the onboarding token's single-use mark, nothing whose loss diverges from the database; the storage port for documents and photos, local in development.

**Testing**: Vitest; the 80% floor widens to `modules/identity`, `modules/verification`, `modules/catalog` (the credentials) and `modules/admin`; integrity probes for rules 22 to 30 as the application role; the adversarial suite with its two inverted subjects; `tests/pipeline/` cases for the two new gates; a fixture per new lint rule under `tests/violations/`; RFC 6238 vectors for TOTP; the provider stand-in and the email stand-in for every sign-in and code path; the owner's device walk-throughs for SC-101 and SC-105.

**Target Platform**: iOS and Android for the user application through Expo's development client on the owner's two physical devices; evergreen browsers for the admin panel; Linux containers for the API; no staging (Phase 6).

**Project Type**: The three applications of Phase 0; this phase fills the mobile and admin applications for the first time and adds the first modules' services, routers and the public web routes to the API.

**Performance Goals**: None beyond Phase 0's. The one timing property this phase holds is negative: the admin sign-in's refusals are indistinguishable in time (SC-109).

**Constraints**: No third-party credential in the suite (SC-114); no paid infrastructure; no numeric literal in module code (R-MONEY-12); every secret hashed or encrypted (R-DB-7/8); every procedure with an output schema and, where public, a rate limit (T169, T170); Arabic as the source locale and logical direction only; seven working days for one person, with overflow stated and sent to the descope ladder (SC-115).

**Scale/Scope**: 44 SRS requirement ids; 80 specification requirements (FR-101 to FR-217); 6 migrations, 6 new tables, 22 seeded settings rows; 2 new ports; 68 procedures across the two surfaces (31 on the user surface, 37 on the administrator surface); 4 browser routes and the uploads route; 3 scheduled jobs; 1 new lint rule and 2 new pipeline gates; about 60 drawn screens and states across the phone's auth, onboarding, account, application, payout and credentials flows and the admin's sign-in, applications, credentials, admins, home and audit pages. No user-load target: the launch cohort is recruited after Phase 6.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

This is the first phase whose code the Phase 0 machines judge, so each gate
asks two questions: does this phase's own work comply, and does it deliver the
mechanism the constitution assigns to Phase 1 (constitution 2.4.0's CI row,
split by phase)?

| Rule family | This phase's own compliance                                                                                                                                                                                                                   | Mechanism delivered here                                                                                                      | Gate     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| R-MONEY     | No money is held or computed; the recipient reference is a reference (FR-190); every number is a settings key, a contract bound or a conversion (FR-212, data-model §4)                                                                       | None assigned; the magic-number gate judges the first module code (SC-106)                                                    | **PASS** |
| R-TIME      | Instants only in the model; the time zone is captured as an IANA name and validated by `@ijazah/time`; no client timestamp in any input (contracts/app-surface.md)                                                                            | None assigned                                                                                                                 | **PASS** |
| R-GENDER    | Gender is written once at onboarding from the person's own declaration and never read from a client afterwards; no procedure of this phase returns another user's teacher data                                                                | R-GENDER-6's CI test (FR-139); R-GENDER-1/3's inverted subjects (FR-211, R-119)                                               | **PASS** |
| R-MOBILE    | Every screen from its board, every string from the catalogue, every colour a token, every margin logical (FR-200 to FR-206)                                                                                                                   | R-MOBILE-13's gate (FR-210, R-115); the primitives, providers and i18n runtime ADR 0020 D7 leaves here                        | **PASS** |
| R-API       | Thin routers, services with the rules, repositories with the queries; every procedure through a kind with both schemas; additive snapshot; the two new ports in domain terms                                                                  | The teacher kind's `admits`, the admin public kind, the per-actor idempotency key (contracts/kernel.md)                       | **PASS** |
| R-DB        | Six forward migrations, immutable; every new secret hashed or encrypted (data-model §7); ten new integrity rules in the schema (data-model §5); the one new lookup hash justified as `token_hash` was                                         | The soft-deletion relation rule (FR-214, R-116)                                                                               | **PASS** |
| R-SEC       | Separate admin identity in table, token and middleware; rate limits declared; lockout behind the throttle with indistinguishable answers; signed expiring links only; CSP and no cookie on every browser route; nonce-checked provider tokens | None assigned; R-SEC-8's proof extends to the two session tables (a probe asserts no FK between `admin_sessions` and `users`) | **PASS** |
| R-SESS      | No session runs                                                                                                                                                                                                                               | None                                                                                                                          | **PASS** |
| R-HONEST    | Every output is its schema's fields; the first date of birth, document key and recipient reference exist and are kept off the user surface by the leak test                                                                                   | R-HONEST-4's leak test (FR-138)                                                                                               | **PASS** |
| R-PROC      | Spec, clarification and plan precede code; every batch one branch, one PR, one review; T130's register re-counted; the document pass recorded (R-PROC-2)                                                                                      | The coverage floor widened (FR-213)                                                                                           | **PASS** |

**Note on the one gender input.** `onboarding.complete` carries `gender`: the
person's own declaration, made once, before any account exists, from which the
server-held value every later request reads is written. T159's lint rule
(`gender/no-authority-in-input`) refuses `gender` in any input schema; this
procedure is the single allow-listed exception, and R-GENDER-6's test asserts
the allow-list has exactly that one entry (contracts/app-surface.md). No other
input on either surface names gender; the admin's correction is Phase 4's.

**Review-only tier.** The twelve `REVIEW` rules stay on the pull request
template. Live in this phase: R-SEC-7 (proven libraries only for auth, session and crypto code: Argon2id, HMAC and JWK verification from `node:crypto`, TOTP from `otplib`; the token layouts and the rotation rule are protocol glue the specs prove, recorded in Complexity Tracking), R-API-5 (the two new ports' names), R-DB-9 (the
new indexes are PK, unique, FK or the two partials the model declares; the
`(user_id) WHERE revoked_at IS NULL` index serves the revoke-all path and is
the one addition to justify), R-PROC-3 (a rule invented at the keyboard: the
approval conditions of FR-161 are the specification's, not the implementer's),
R-MOBILE-3, R-MOBILE-12 and R-MOBILE-14 (the first screens).

**Gate result: PASS.** No unjustified violation. Two structural costs are
recorded in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-identity/
├── plan.md              # This file
├── spec.md              # Feature specification, clarified 2026-10-17
├── research.md          # Phase 0 output — 20 decisions (R-101 to R-120)
├── data-model.md        # Phase 1 output — the ERD pass: 6 tables, the columns, 10 rules, 6 migrations, 22 settings rows
├── quickstart.md        # Phase 1 output — validation guide, device steps marked as the owner's
├── contracts/           # Phase 1 output
│   ├── README.md
│   ├── app-surface.md   # 31 user-surface procedures
│   ├── admin-surface.md # 37 administrator-surface procedures
│   ├── ports.md         # The sign-in port, the email port, the payment port's recipient operations
│   ├── public-pages.md  # /terms, /delete-account, /uploads/documents, the design assets
│   └── kernel.md        # Session resolution, the kinds' declarations, the two new gates
├── checklists/
│   └── requirements.md  # Spec quality checklist, all items passing
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Only what this phase adds or first fills; Phase 0's layout stands.

```text
apps/
├── mobile/src/
│   ├── app/
│   │   ├── _layout.tsx                 # providers: theme, direction, i18n, tRPC, the session guard
│   │   ├── (auth)/                     # welcome, email-sign-in, email-sign-up, otp, forgot-password, reset-password, role, profile
│   │   ├── (student)/(tabs)/           # index (empty state), account; the other tabs as drawn empty states
│   │   ├── (student)/account/          # profile, delete
│   │   ├── (teacher)/application/      # subjects, documents, ijazahs, status, more-info
│   │   ├── (teacher)/payout/           # start, setup, verified, rejected
│   │   ├── (teacher)/credentials/      # index, [id], add
│   │   ├── (teacher)/(tabs)/           # account; the other tabs as drawn empty or locked states
│   │   ├── (teacher)/account/          # delete
│   │   ├── time-zone.tsx · terms.tsx · restricted.tsx
│   │   └── verify-identity.tsx         # a shared route outside the role groups: either role under a verification request
│   ├── design/
│   │   ├── primitives/                 # the React Native code of the contracts (ADR 0020 D7)
│   │   └── theme.tsx                   # light/dark and direction providers, filled
│   ├── features/
│   │   ├── shared/auth · shared/onboarding · shared/account
│   │   ├── student/account
│   │   └── teacher/application · teacher/payout · teacher/credentials · teacher/account
│   ├── i18n/index.ts                   # the runtime over ar.json and en.json
│   └── lib/                            # client (bearer, refresh, sign-out on 401), storage (secure), direction, formatters
│
├── admin/src/
│   ├── App.tsx · main.tsx              # router, query client, i18n, the session guard
│   ├── design/components/              # the primitives on shadcn/ui, the console pieces
│   ├── pages/sign-in · mfa · home · applications · credentials · settings/admins · audit · set-password
│   ├── i18n/index.ts
│   └── lib/                            # client (bearer from sessionStorage), formatters
│
└── api/src/
    ├── modules/
    │   ├── identity/                   # sign-in, onboarding, sessions, reset, account, deletion, the teacher application's state and decisions, payout standing; the deletion web routes; the photo route; mail templates; breached-passwords list
    │   ├── verification/               # documents, verification requests (FR-166), the uploads route
    │   ├── catalog/                    # subjects (list), credentials and the chain
    │   ├── payments/                   # the recipient operations and their webhook routing (first consumer)
    │   └── admin/                      # admin sign-in, MFA, lockout, admins, audit queries, the label renderer, home
    ├── platform/
    │   ├── ports/sign-in/ · ports/email/
    │   ├── web/                        # the escaping template, the page layout, the route helper, assets/
    │   └── guards/                     # upload kinds; the restricted-account rule lives in surfaces/
    ├── surfaces/                       # the kinds' declarations, session resolution wiring, adminPublicProcedure
    └── jobs/                           # purge-otp-codes, purge-stale-push-tokens, purge-expired-sessions, deliver-admin-invite

packages/
├── contracts/src/                      # the schemas of both surfaces, PayoutDetails (provisional), the gender allow-list
└── config/eslint-plugin-ijazah/rules/  # db/no-unfiltered-relation-read

prisma/
├── schema/                             # identity, admin, catalog, verification, payments, platform, booking, sessions: the columns of data-model.md
└── migrations/                         # the six of data-model §8

scripts/                                # authz-test-gate.ts; suite-gate.paths.ts gains the mobile coupling; build-tokens.ts writes the API's assets
tests/
├── adversarial/gender.spec.ts          # the two inverted subjects
├── db-integrity/                       # rules 22 to 30
├── pipeline/                           # output-leak.spec.ts, authz-test-gate.spec.ts
└── violations/                         # the relation-read fixture
```

**Structure Decision**: Phase 0's three applications and twelve modules, filled
where this phase's stories land. Two things are new in shape. First, the API
gains `platform/web/`, a kernel folder for what a browser reads directly — the
escaping template and the route helper — because ADR 0021 D5 made the public
pages routes of the API and their safety properties (escaping, CSP, no cookie)
belong once in the kernel, not once per page. Second, the mobile `(auth)` group
holds both sign-in and onboarding under `shared/`, because both roles walk them
identically and the wall between the role trees must not have to be crossed to
reach the account that does not yet exist. Everything else lands under the
module or feature folder ARCHITECTURE §4 and §6.1 already assign it.

## Complexity Tracking

> Two structural costs a simpler design would avoid, recorded because both are
> deliberate and both serve a rule.

| Violation                                                                                                                                                  | Why Needed                                                                                                                                                                                                                                                                                                                                                                                                                                  | Simpler Alternative Rejected Because                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A seventh port, `sign-in`, rather than a verifier inside the identity module                                                                               | The verification touches a network (the providers' key sets) and the suite may touch none (SC-114); so there are two implementations from day one, which is exactly ARCHITECTURE §3.1's test for a port. As a port it is selected in `ports.module.ts`, refused outside development and test like every stand-in (T168), and guarded by R-API-4's lint against a concrete import.                                                           | A module-private adapter pair selected by configuration: the same two implementations, hidden from the port registry and from the lint rule, with the stand-in's refusal outside development left to discipline. |
| Two token kinds per user session (a signed access token and a rotated opaque refresh token) rather than one opaque token                                   | FR-AUTH-7 needs server-side revocation and OAuth 2.1 needs rotation with reuse detection for a public client; a single long-lived opaque token in transit on every call is the larger exposure, and a self-contained claim token would carry authority for its lifetime against R-GENDER-4's spirit. The access token is a pointer verified by one HMAC; standing is still read per request (R-106).                                        | One opaque token looked up per request: simplest, but rotation, reuse detection and revocation all collapse onto the one value a device presents on every call.                                                  |
| Hand-assembled token layouts (the signed access token, the onboarding token, the invite link) and the refresh-rotation rule, rather than a session library | R-SEC-7 forbids custom crypto, not custom protocol: every primitive is `node:crypto`'s (HMAC-SHA256 under HKDF subkeys, `randomBytes`, Argon2id) or `otplib`'s; what is written is a four-field token layout and the rotation table logic, each proven by its spec against the stated vectors and cases. A session library brings a cookie model the admin transport rejected and a claims-in-the-token model R-GENDER-4's reading rejects. | `jose` or a session middleware: a dependency whose defaults (claims in the token, cookies) are the two things this design refuses, so it would be configured out of its own behaviour.                           |

## Phase Outputs

- **Phase 0 — Research**: [research.md](./research.md). Twenty decisions, R-101 to R-120; none awaits the owner — the six owner decisions were taken at clarification.
- **Phase 1 — Design**: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).
- **Phase 2 — Tasks**: not created by this command. Run `/speckit-tasks`.

## Post-Design Constitution Re-Check

Re-evaluated after the design artefacts were written. No gate changed from
PASS, and the design surfaced four points worth recording:

1. **`onboarding.complete` is the one input that names gender.** T159's rule
   would refuse it; the rule gains a one-entry allow-list and R-GENDER-6's test
   asserts the list's length is one. The declaration is written from the person
   to the server once, before an account exists; after that no input names it.
   The constitution is not bent: R-GENDER-4 forbids _authority_ from a client,
   and a person's own first declaration is the data the authority is later read
   from, as the ERD's `users.gender` column has always said.

2. **`admin_users.password_hash` becomes nullable, and `mfa_secret_encrypted`
   does not.** An invited administrator has no password until the link is used,
   so null is the honest value; the second-factor secret is generated at invite
   and `mfa_enrolled_at` says whether it was confirmed, so the column keeps its
   NOT NULL and the schema check's secret-column rule reads both as before.

3. **The application is a state of the profile, not a table** (data-model §3).
   A fourth candidate table was weighed and rejected: the ERD already defines
   the pending profile as the application (FR-AUTH-9), a teacher has one open
   application at a time, and the history the queue's «تم البتّ» tab shows is
   the audit log's. Six columns on `teacher_profiles` carry the drawn timeline.
   R-DB-4 is untouched: none of them is derived.

4. **The email is sent inline, after commit** (R-104), where the kernel's
   general rule queues heavy work and forbids an administrator handler from
   awaiting a provider. A one-time code cannot be re-derived by a job (R-DB-7),
   so the send happens where the plaintext exists, once, outside any
   transaction; the one administrator-triggered mail, the invite, is queued and
   mints its own link. The rule is kept where it applies and the exception is
   named with its cause.

5. **Two additions the specification did not name, each additive.** `auth_identities.provider_refresh_token_encrypted` (Apple only, encrypted, row-bound) exists because Apple's revoke endpoint needs a token obtained at the first sign-in (research R-103), and FR-141 requires the revoke; and `teacher_profiles.verification_status` gains the member `revoked`, because the ERD's enum had no word for a withdrawn approval distinct from an account suspension (ADR 0016 D2). Both are recorded in data-model.md and the ERD's changelog; neither removes or renames anything (R-API-9).

6. **A fifth user kind, `userProcedure`.** The account, sign-out, deletion and identity-verification procedures serve both roles identically; declaring each twice would be two procedures with one body. The kind admits any authenticated person and narrows nothing by role; the student and teacher kinds stay for everything role-bound (contracts/kernel.md).

**Re-check result: PASS.**
