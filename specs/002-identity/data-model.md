# Phase 1 Design: Data Model

**Feature**: `specs/002-identity/` · **Date**: 2026-10-17

**Source of truth**: [`docs/ERD.md`](../../docs/ERD.md) v1.3 with its addenda.
This document is the ERD pass the specification requires before any identity
code is written (FR-101 to FR-111, R-PROC-2): every table, column, index,
constraint and enum member this phase adds, the migration each lands in, the
owning module of each new table, and the integrity rules the database holds.
The ERD itself is amended in the same batch (its §2, §3, §4, §12, §14, §15 and
a "v1.3 → v1.4" changelog), together with the SRS §6.2 entity list and
ARCHITECTURE §4's module table; this document says what changes, the ERD then
says it as the model.

Everything below lands by forward migrations after `20261014000000`, immutable
once merged (R-DB-1), each applied clean from an empty database (SC-113). The
count rises from thirty-three tables to thirty-nine, and to forty with
`user_session_retired_tokens` (T094).

---

## 1. New tables, and who owns them

| Table                         | Owner    | Why it exists                                                                                            |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `user_sessions`               | identity | A device's session: its refresh token as a hash, rotation, revocation (FR-101, R-101)                    |
| `user_session_retired_tokens` | identity | Every hash a session's rotations retired, so reuse is caught across every rotation (R-101, T094)         |
| `auth_identities`             | identity | A Google or Apple account keyed by the provider's subject (FR-102, ADR 0012 D2)                          |
| `admin_sessions`              | admin    | An administrator's session, a different principal in a different table (FR-101, R-SEC-8)                 |
| `admin_recovery_codes`        | admin    | Ten single-use codes per administrator, hashed (FR-105, ADR 0019 D3)                                     |
| `teacher_credentials`         | catalog  | One ijazah PDF per subject with its transcription; the chain hangs under it (FR-104, ADR 0017 D5)        |
| `session_remedies`            | sessions | What a session not consumed is owed (FR-105, ADR 0018); the columns land now, the behaviour is Phase 3's |

`packages/config/module-tables.json` gains each under its owner; the
table-ownership rule (R-API-6) then refuses any other module's read. The
`verification` module keeps its two tables: it owns the documents and the verification requests. The application's state and decisions are columns of `teacher_profiles` (§3), identity's table, written by the `verification` module's application services through `identity`'s public entry (`setApplication`, `setAccountStatus`), with the approved subjects granted through `catalog`'s (`grantSubjects`); `identity` imports no other module (research R-121) (R-API-6).

### `user_sessions`

| Column                      | Type                                                                                                                            | Notes                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| id                          | uuid                                                                                                                            | PK                                                                                                    |
| user_id                     | FK → users                                                                                                                      | indexed                                                                                               |
| refresh_token_hash          | text, unique                                                                                                                    | SHA-256 lookup hash of the current refresh token (R-DB-7)                                             |
| previous_refresh_token_hash | text, nullable                                                                                                                  | The hash rotation retired, kept for the grace window; a presentation after it revokes the row (R-101) |
| device_label                | text, nullable                                                                                                                  | What the device reported of itself («iPhone», «Pixel 8»); shown nowhere in this phase                 |
| issued_at                   | timestamptz                                                                                                                     |                                                                                                       |
| refreshed_at                | timestamptz, nullable                                                                                                           | The last rotation                                                                                     |
| expires_at                  | timestamptz                                                                                                                     | Absolute: issue plus `session_refresh_ttl_days`; never extended                                       |
| revoked_at                  | timestamptz, nullable                                                                                                           |                                                                                                       |
| revoked_reason              | enum sign_out · reuse_detected · password_reset · account_deleted · account_suspended · account_banned · admin_action, nullable |                                                                                                       |
| created_at / updated_at     | timestamptz                                                                                                                     |                                                                                                       |

The foreign key's plain index (ERD §14) serves "revoke every session of the
user"; a partial index on the live rows was described here first and not kept
(R-DB-9: a second index on the column waits for a measured slow query; amended
2026-10-18 after the review of PR #77). Rows are purged by
`purge-expired-sessions`: an expired row at once, a revoked row after
`session_purge_after_days`, kept that long for reuse detection (R-118); no `deleted_at`,
since a session is not a record a person might need removed from view — it is
a credential, and it is destroyed.

### `auth_identities`

| Column                           | Type                | Notes                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                               | uuid                | PK                                                                                                                                                                                                                                                                                        |
| user_id                          | FK → users          | indexed                                                                                                                                                                                                                                                                                   |
| provider                         | enum google · apple |                                                                                                                                                                                                                                                                                           |
| provider_subject                 | text                | The token's `sub`; unique with `provider` (ERD §15, new rule 22)                                                                                                                                                                                                                          |
| provider_refresh_token_encrypted | bytea, nullable     | Apple only: the refresh token obtained by exchanging the authorization code at the first sign-in, kept so deletion can revoke it (ADR 0015 D3, TN3194, R-DB-8), carried from the first sign-in to completion inside the onboarding token as a column-cipher blob (R-102); null for Google |
| created_at                       | timestamptz         |                                                                                                                                                                                                                                                                                           |

Deleted outright on account deletion (ADR 0015 D3): the application role
keeps DELETE on this table, and the uniqueness never blocks the person's new
account. The `provider_refresh_token_encrypted` column joins the
`reencrypt-columns` job's list through the identity repository (T155).

### `admin_sessions`

| Column                   | Type                  | Notes                                                                                      |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------ |
| id                       | uuid                  | PK                                                                                         |
| admin_id                 | FK → admin_users      | indexed                                                                                    |
| token_hash               | text, unique          | SHA-256 lookup hash of the bearer (R-DB-7)                                                 |
| mfa_verified_at          | timestamptz, nullable | Null until the second factor passes on this session; the admin kind refuses a null (R-107) |
| issued_at / last_seen_at | timestamptz           | Idle limit from `admin_session_idle_minutes`                                               |
| expires_at               | timestamptz           | Absolute, `admin_session_max_hours`                                                        |
| revoked_at               | timestamptz, nullable |                                                                                            |
| created_at / updated_at  | timestamptz           |                                                                                            |

### `admin_recovery_codes`

| Column     | Type                  | Notes                                               |
| ---------- | --------------------- | --------------------------------------------------- |
| id         | uuid                  | PK                                                  |
| admin_id   | FK → admin_users      | indexed                                             |
| code_hash  | text                  | Peppered Argon2id, the one-time-code regime (R-107) |
| used_at    | timestamptz, nullable | Single use                                          |
| created_at | timestamptz           |                                                     |

Regeneration deletes the administrator's unused rows and inserts ten; the
application role keeps DELETE here.

### `teacher_credentials`

| Column                     | Type                                                | Notes                                                                                                    |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| id                         | uuid                                                | PK                                                                                                       |
| teacher_user_id            | FK → users                                          | indexed                                                                                                  |
| subject_id                 | FK → subjects                                       | indexed                                                                                                  |
| document_id                | FK → verification_documents                         | The ijazah PDF                                                                                           |
| holder_name                | text, nullable                                      | The teacher's full name as on the PDF, transcribed at approval (ADR 0019 D1)                             |
| riwaya                     | text, nullable                                      | Transcribed at approval, Arabic as typed (ADR 0021 D1)                                                   |
| tariq                      | text, nullable                                      |                                                                                                          |
| status                     | enum pending · needs_document · approved · rejected |                                                                                                          |
| review_reason              | text, nullable                                      | Mandatory on reject and needs_document; the teacher sees it                                              |
| reviewed_by_admin_id       | FK → admin_users, nullable                          |                                                                                                          |
| reviewed_at                | timestamptz, nullable                               |                                                                                                          |
| submitted_with_application | boolean                                             | Whether it came with an application (shown as «عند التقدّم») or was added after approval (FR-PROFILE-11) |
| created_at / updated_at    | timestamptz                                         |                                                                                                          |

Partial unique `(teacher_user_id, subject_id) WHERE status = 'approved'`: one
approved credential per teacher and subject (ERD §15, new rule 23). A rejected
credential stays as history; a new upload for the same subject is a new row.

### `session_remedies` (ADR 0018, columns only)

As ADR 0018 D5 and the ERD's `packages` amendment state: `id`, `session_id`
unique FK, `kind` enum makeup · refund, `status` enum awaiting_choice · proposed
· counter_proposed · booked · refund_case, `proposed_date` date nullable,
`counter_date` date nullable, `decided_at` timestamptz nullable, `case_id`
nullable FK → disputes, `created_at`/`updated_at`. Owned by `sessions`; no
code of this phase writes it.

---

## 2. Columns added to existing tables

| Table                                  | Column                                                                                                                                                                                                                                                                            | Notes                                                                                                                                                                                                                                                        | Source                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `users`                                | `certificate_name text nullable`                                                                                                                                                                                                                                                  | Asked once at the first ijazah request (Phase 4 writes it); erased on deletion                                                                                                                                                                               | ADR 0019 D1, ADR 0015 D3       |
| `users`                                | `display_name` and `date_of_birth` become nullable; the phone-or-email check (ERD §15 rule 1) becomes `deleted_at IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL`; rule 32 keeps the three NOT NULL for a live row                                                         | So the one transaction of FR-141 can erase them; ADR 0012 D4's "NOT NULL" is held for every live row by the check rather than by the column                                                                                                                  | FR-141                         |
| `otp_codes`                            | `purpose` gains `account_deletion`                                                                                                                                                                                                                                                | The web deletion's code (FR-143); additive                                                                                                                                                                                                                   | FR-143                         |
| `teacher_profiles`                     | `photo_key` kept, unused                                                                                                                                                                                                                                                          | The photo of either role is `users.photo_key` from this phase; the column stays and the ERD marks it unused                                                                                                                                                  | FR-141                         |
| `admin_users`                          | `mfa_last_accepted_step bigint nullable`                                                                                                                                                                                                                                          | The last TOTP step accepted, so a code is never accepted twice within its step (RFC 6238 §5.2)                                                                                                                                                               | FR-171                         |
| `users`                                | `photo_key text nullable`                                                                                                                                                                                                                                                         | The student's or teacher's profile photo (decision 46), served by a signed link; erased on deletion                                                                                                                                                          | FR-141, `StudentProfileEditor` |
| `users`                                | `timezone_overridden_at timestamptz nullable`                                                                                                                                                                                                                                     | When the person chose the zone by hand (`account.setTimezone`); while null, the zone the device reports on launch replaces it (`account.reportDeviceTimezone`), so a chosen zone survives a reinstall and another device (owner's decision 2026-10-20, T049) | FR-131, FR-AUTH-10             |
| `teacher_profiles`                     | `approved_shown_at timestamptz nullable`                                                                                                                                                                                                                                          | The once-only `ApplicationApproved` was shown                                                                                                                                                                                                                | FR-152                         |
| `verification_requests`                | `document_id FK → verification_documents nullable`, `document_type enum national_id · passport nullable`                                                                                                                                                                          | The document the user submitted for the request (`VerifyIdentity`)                                                                                                                                                                                           | FR-166                         |
| `teacher_profiles`                     | `payout_account_ref_hash text unique nullable`                                                                                                                                                                                                                                    | SHA-256 lookup hash of the recipient reference beside the encrypted column; routes recipient events                                                                                                                                                          | FR-109, R-114                  |
| `teacher_profiles`                     | `payout_rejected_reason text nullable`                                                                                                                                                                                                                                            | The gateway's last rejection reason, shown on `PayoutRejected`; cleared on verification                                                                                                                                                                      | FR-191                         |
| `admin_users`                          | `password_hash` becomes nullable                                                                                                                                                                                                                                                  | Null from invite until the password-set link is used; sign-in refused while null                                                                                                                                                                             | FR-174, R-110                  |
| `admin_users`                          | `mfa_enrolled_at timestamptz nullable`                                                                                                                                                                                                                                            | Null until the first code is confirmed at setup; the secret exists from invite                                                                                                                                                                               | R-107                          |
| `admin_users`                          | `failed_sign_in_count int default 0`, `locked_until_at timestamptz nullable`                                                                                                                                                                                                      | The lockout pair (settings `admin_lockout_attempts`, `admin_lockout_minutes`)                                                                                                                                                                                | ADR 0019 D3                    |
| `admin_users`                          | `invited_by_admin_id FK nullable`, `invited_at timestamptz nullable`, `password_set_at timestamptz nullable`, `disabled_at timestamptz nullable`, `last_sign_in_at timestamptz nullable`                                                                                          | The admins page's columns; `is_active` stays, held equal to `disabled_at IS NULL` by rule 31                                                                                                                                                                 | FR-174, `AdminAdmins`          |
| `audit_logs`                           | `target_label text NOT NULL`                                                                                                                                                                                                                                                      | Non-personal, ≤ 200 chars, rendered at write time; the table holds no row, so NOT NULL needs no backfill                                                                                                                                                     | ADR 0021 D2                    |
| `idempotency_keys`                     | `actor_id text NOT NULL`; unique becomes `(scope, actor_id, key)`                                                                                                                                                                                                                 | The table is empty in every environment that matters; the migration drops and recreates the unique                                                                                                                                                           | FR-106, R-117                  |
| `packages`                             | `track enum recitation · ijazah_track`                                                                                                                                                                                                                                            | ADR 0018 D1; default `recitation` for the migration, no rows exist                                                                                                                                                                                           | ADR 0018                       |
| `enrollments`                          | `snapshot_track` (same enum)                                                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                              | ADR 0018                       |
| `enrollments.cancellation_reason`      | gains `account_deleted`                                                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                              | ADR 0015 D4                    |
| `sessions`                             | `makeup_for_session_id uuid nullable FK → sessions`                                                                                                                                                                                                                               |                                                                                                                                                                                                                                                              | ADR 0018                       |
| `isnad_entries`                        | re-keyed: `credential_id FK → teacher_credentials` replaces `(teacher_user_id, subject_id)`; `names text[]` replaces `transmitter_name`; `verification_status`, `verified_by_admin_id`, `verified_at` dropped; `created_by_admin_id FK` added; unique `(credential_id, position)` | The table holds no row, so the columns are dropped rather than deprecated; the enum `IsnadVerificationStatus` stays declared (R-API-9 is about the published contract, and no procedure ever published it)                                                   | ADR 0017 D5                    |
| `teacher_profiles.verification_status` | gains `revoked`                                                                                                                                                                                                                                                                   | A withdrawn approval (FR-VERIFY-8, ADR 0016 D2): the teacher returns only through a new application; `suspended` stays the account-level word and is no longer written to this column. Additive (R-API-9)                                                    | FR-165                         |
| `user_roles`                           | unique `(user_id)`                                                                                                                                                                                                                                                                | One row per user; the existing `(user_id, role)` unique stays                                                                                                                                                                                                | ADR 0016 D3                    |
| `otp_codes`                            | index `(destination, purpose)`                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                                              | FR-107                         |

---

## 3. The application is a state of the profile, not a table

A teacher application is `teacher_profiles` with `verification_status` and
three columns added for the drawn timeline and the "waiting on applicant"
state, rather than a new `teacher_applications` table:

| Column                                                                                        | Notes                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application_submitted_at timestamptz nullable`                                               | The current application's submission; reapplying after a rejection sets it again                                                                                          |
| `application_status enum in_review · needs_document · rejected · banned · approved`, nullable | What the applicant sees; `verification_status` stays the product's status (pending/approved/…) and `application_status` the queue's tab. Null before the first submission |
| `application_note text nullable`                                                              | The reviewer's latest note to the applicant (the request for a document, the rejection)                                                                                   |
| `application_decided_at timestamptz nullable`, `application_decided_by_admin_id FK nullable`  |                                                                                                                                                                           |
| `identity_document_id FK → verification_documents nullable`                                   | The identity document of the current application                                                                                                                          |
| `identity_document_type enum national_id · passport nullable`                                 | Drawn segmented control                                                                                                                                                   |

Why not a table: FR-VERIFY-3's "pending applications" are pending teacher
profiles (ERD §2 already says `verification_status pending` is the application,
FR-AUTH-9), and a teacher has at most one open application at a time; history
of a rejected-then-reapplied teacher is the audit log's (every decision is an
entry with before and after), which the drawn «تم البتّ» tab reads from the
profile's decided columns. A credential marks whether it came with the
application (`submitted_with_application`), which is what the queue's detail
and the credentials page's «عند التقدّم» need.

---

## 4. Seeded settings rows (R-MONEY-12)

Every number an identity or admin flow reads, planted by `prisma/seed.ts` with
its default, each named with its unit; `tests/seed/seed.spec.ts`'s row count
follows.

| Key                                       | Default                              | Governs                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_lockout_attempts`                  | 5                                    | FR-172 (SRS §3.14)                                                                                                                                              |
| `admin_lockout_minutes`                   | 15                                   | FR-172 (SRS §3.14)                                                                                                                                              |
| `makeup_choice_window_days`               | 7                                    | ADR 0018 (Phase 3 reads it)                                                                                                                                     |
| `otp_code_ttl_minutes`                    | 10                                   | FR-120, FR-129, FR-143                                                                                                                                          |
| `otp_max_attempts`                        | 5                                    | the same                                                                                                                                                        |
| `otp_purge_after_hours`                   | 24                                   | `purge-otp-codes`                                                                                                                                               |
| `onboarding_token_ttl_minutes`            | 15                                   | FR-125                                                                                                                                                          |
| `session_access_ttl_minutes`              | 15                                   | FR-135                                                                                                                                                          |
| `session_refresh_ttl_days`                | 30                                   | FR-135                                                                                                                                                          |
| `session_refresh_grace_seconds`           | 30                                   | R-101                                                                                                                                                           |
| `session_purge_after_days`                | 30                                   | `purge-expired-sessions`                                                                                                                                        |
| `admin_session_idle_minutes`              | 60                                   | FR-170                                                                                                                                                          |
| `admin_session_max_hours`                 | 12                                   | FR-170                                                                                                                                                          |
| `admin_invite_ttl_hours`                  | 48                                   | FR-174                                                                                                                                                          |
| `push_token_stale_days`                   | 90                                   | `purge-stale-push-tokens`                                                                                                                                       |
| `terms_version`                           | `"2026-10"`                          | FR-127                                                                                                                                                          |
| `upload_max_bytes`                        | 10485760                             | FR-151                                                                                                                                                          |
| `rate_limit_public_page`                  | `{ limit: 60, window_seconds: 60 }`  | FR-144                                                                                                                                                          |
| `rate_limit_upload`                       | `{ limit: 20, window_seconds: 600 }` | FR-151                                                                                                                                                          |
| `admin_recovery_code_count`               | 10                                   | FR-171 (ADR 0019 D3)                                                                                                                                            |
| `admin_home_latest_actions`               | 7                                    | FR-176 (`AdminHome`)                                                                                                                                            |
| `admin_list_page_size`                    | 25                                   | FR-160, FR-176 (every admin table)                                                                                                                              |
| `provider_nonce_ttl_minutes`              | 10                                   | FR-121 (`auth.providerNonce`)                                                                                                                                   |
| `document_link_ttl_seconds`               | 300                                  | FR-151 (every signed document link)                                                                                                                             |
| `rate_limit_token_refresh`                | `{ limit: 30, window_seconds: 60 }`  | FR-135 (`auth.refresh`, by the token's hash)                                                                                                                    |
| `rate_limit_provider_nonce`               | `{ limit: 20, window_seconds: 60 }`  | FR-121 (`auth.providerNonce`, by the client address; the authentication budget caps the path)                                                                   |
| `document_unreferenced_purge_after_hours` | 72                                   | `purge-unreferenced-documents` (T093): an upload no submission points at is deleted after it                                                                    |
| `document_unreferenced_max_per_user`      | 30                                   | `POST /uploads/documents` (T093): the unreferenced documents a person may hold; an application needs eleven at most (ten credentials and the identity document) |

SRS §3.14's table gains the rows a person would change (the admin lockout pair
is already there; the session, code and upload limits join it); the purge
windows and the grace are operational and listed under it as such. Input bounds
(a display name's length, a bio's, a note's) live in `packages/contracts` as
Zod `.max()`; conversions in `@ijazah/time`.

---

## 5. Integrity rules the database holds (ERD §15, new rules)

| #   | Rule                                                                                                                | Mechanism                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 22  | `auth_identities (provider, provider_subject)` unique                                                               | unique index                                                                                         |
| 23  | `teacher_credentials (teacher_user_id, subject_id)` unique where approved                                           | partial unique index                                                                                 |
| 24  | `user_roles (user_id)` unique                                                                                       | unique index (ADR 0016 D3)                                                                           |
| 25  | `user_sessions.refresh_token_hash`, `admin_sessions.token_hash` unique                                              | unique indexes                                                                                       |
| 26  | `idempotency_keys (scope, actor_id, key)` unique; `actor_id` NOT NULL                                               | replaces rule 16's `(scope, key)`                                                                    |
| 27  | `teacher_profiles.payout_account_ref_hash` unique where present                                                     | partial unique                                                                                       |
| 28  | `isnad_entries (credential_id, position)` unique                                                                    | rule 7, as re-keyed                                                                                  |
| 29  | `audit_logs.target_label` NOT NULL and `length ≤ 200`                                                               | NOT NULL plus a check constraint                                                                     |
| 30  | `admin_users`: `locked_until_at IS NULL OR failed_sign_in_count > 0`                                                | check constraint, so a lock never exists without the count that caused it                            |
| 31  | `admin_users`: `is_active = (disabled_at IS NULL)`                                                                  | check constraint, so the flag cannot drift from its source                                           |
| 32  | `users`: `deleted_at IS NOT NULL OR (display_name IS NOT NULL AND date_of_birth IS NOT NULL AND email IS NOT NULL)` | check constraint: a live row keeps its NOT NULL columns, a deleted row may have them erased (FR-141) |
| 33  | `user_session_retired_tokens.token_hash` unique                                                                     | unique index (T094)                                                                                  |

Rules 10 and 21 (no DELETE on the five tables; append-only on the three) are
untouched. `auth_identities`, `user_sessions`, `user_session_retired_tokens`, `admin_sessions`,
`admin_recovery_codes` and `otp_codes` keep DELETE for the application role:
each is a credential or a key, not a record of something that happened.
`teacher_credentials` and `session_remedies` keep it too, by the default
privileges, as every table without `deleted_at` that is not append-only does
(`isnad_entries` is the Phase 0 precedent); nothing deletes their rows in this
phase.

Each new rule is demonstrated by a refused insert in `tests/db-integrity/`
(SC-113).

---

## 6. What the request context reads (FR-108)

One query per authenticated request, through the identity module's public entry
(`resolveUserSession`), joining `user_sessions` (not revoked, not expired) to
`users` (gender, preferred language, account status, deleted_at, certificate
name is not read) to `user_roles` (the one role) to `teacher_profiles` (for a
teacher: verification status, payout verified instant, application status).
The `UserSession` it yields:

```
userId, sessionId, role: 'student' | 'teacher', gender, preferredLanguage,
accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned',
teacher?: { verificationStatus, payoutVerified: boolean, applicationStatus }
```

A deleted user's session cannot exist (deletion revokes every row), so
`deleted_at` is read only as a belt. The caller kinds narrow this: the student
kind requires role student; `teacherProcedure({ admits })` requires role
teacher and the declared standing (R-106); every kind refuses suspended and
banned unless it `admitsRestricted`. Administrators: `resolveAdminSession`
joins `admin_sessions` (not revoked, idle and absolute limits) to `admin_users`
(active, `mfa_enrolled_at`, `password_set_at`), yielding `{ adminId,
mfaVerified }`; the admin kind refuses `mfaVerified: false`.

---

## 7. Secrets, by regime (R-DB-7, R-DB-8)

| Value                                                         | Regime                                                       | Where                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| User refresh token (current and retired), admin session token | SHA-256 lookup hash                                          | `user_sessions`, `user_session_retired_tokens`, `admin_sessions` |
| One-time code, admin recovery code                            | Peppered Argon2id                                            | `otp_codes`, `admin_recovery_codes`                              |
| Password (user, admin)                                        | Argon2id, salted                                             | `users`, `admin_users`                                           |
| Apple refresh token                                           | Column cipher, row-bound                                     | `auth_identities`                                                |
| MFA secret                                                    | Column cipher, row-bound                                     | `admin_users` (unchanged)                                        |
| Recipient reference                                           | Column cipher plus a lookup hash                             | `teacher_profiles`                                               |
| Identity document storage key                                 | Column cipher                                                | `verification_documents` (unchanged)                             |
| Access token, onboarding token, admin invite link             | Not stored: signed, verified by HMAC under their HKDF labels | —                                                                |

The three new HKDF labels (`ijazah:access-token:v1`,
`ijazah:onboarding-token:v1`, `ijazah:admin-invite:v1`) join the list in
`encryption.ts`. The schema check's `secret-column` rule reads the new columns
as it reads the old (`*_hash`, `*_encrypted`).

---

## 8. Migrations, in order

| Migration                                        | Lands                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261018000000_identity_sessions_and_providers` | `user_sessions`, `auth_identities`, `users.certificate_name`, `users.photo_key`, `display_name` and `date_of_birth` nullable with rule 32 and rule 1 rewritten for deleted rows, `account_deletion` on `OtpPurpose`, `user_roles (user_id)` unique, `otp_codes` index |
| `20261018000100_admin_sessions_mfa_lockout`      | `admin_sessions`, `admin_recovery_codes`, the `admin_users` columns and nullable `password_hash`, `mfa_last_accepted_step`, rules 30 and 31                                                                                                                           |
| `20261018000200_teacher_credentials`             | `teacher_credentials`, the `isnad_entries` re-key, the `teacher_profiles` application and payout columns and `approved_shown_at`, the `revoked` member, `verification_requests.document_id` and `document_type`, rules 23 and 27                                      |
| `20261018000300_tracks_remedies_account_deleted` | ADR 0018's columns and `session_remedies`; `account_deleted` on the reason enum                                                                                                                                                                                       |
| `20261018000400_idempotency_actor`               | `idempotency_keys.actor_id` and the new unique (rule 26); batch B4 with T018, the service that writes the column                                                                                                                                                      |
| `20261018000500_audit_target_label`              | `audit_logs.target_label`, rule 29; batch B4 with T021, the writer that renders the label                                                                                                                                                                             |
| `20261020000000_user_session_retired_tokens`     | `user_session_retired_tokens`, rule 33; batch B9a with T094, the rotation that writes it                                                                                                                                                                              |

The first four land in B2; the last two ride with their writers in B4, since the
repositories and three Phase 0 probes write those rows without the new columns
until then (conflict review, 2026-10-18). Each is generated from the schema files and extended by hand where the schema
language cannot say it (the partial uniques, the check constraints, the DELETE
grants on the new credential tables), as the runbook's migration workflow
states; the schema check and the integrity probes run against the migrated
catalogue in CI.

---

## 9. Documents amended in the same batch (FR-110, FR-111)

- `docs/ERD.md`: §2 (`users`, `user_roles`, `teacher_profiles`, the two new identity tables), §3 (the credential's document), §4 (`teacher_credentials`, `isnad_entries` as re-keyed), §12 (`admin_users`, `admin_sessions`, `admin_recovery_codes`, `audit_logs.target_label`, `idempotency_keys`), §14 (the new indexes), §15 (rules 22 to 32), the domain map in §1 and the count (39); a "v1.3 → v1.4" changelog.
- `docs/SRS.md`: §6.2 (the new entities), §3.14 (the settings rows a person changes), §2.5 (the team of one), and the text conflicts the closure review listed.
- `docs/ARCHITECTURE.md`: §3.2 (the sign-in port row; seven ports), §3.4 (the two folders, `ports/sign-in/` and `ports/email/`), §4 (the new tables under their modules; the platform row's `SUPPORT_EMAIL` query), §7.2 (the teacher kind's `admits`, the admin public kind).
- `specs/001-foundations/contracts/kernel.md` and `ports.md`: the kernel changes and the two new ports, by reference to [`contracts/`](./contracts/) here.
- ADR 0001, ADR 0005, ADR 0012 D5's parenthesis, the DEC rows' order, the stray spaces: each as the review listed.
- `packages/config/module-tables.json`: the six new tables under their owners.
