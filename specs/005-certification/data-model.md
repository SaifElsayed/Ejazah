# Data model: Phase 4 (lightened)

One forward migration per batch that needs it. Every timestamp is `timestamptz` and ends `_at`; no money column
(ADR 0007). Owners follow `packages/config/module-tables.json`. The ERD gains a dated block per task at its end
(`tracks-coordination.md` §1); no version line changes.

## New: `ijazah_requests` (certification; ADR 0017 D5, ERD :582, R-403, R-404)
| Column | Type | Rule |
|---|---|---|
| `id` | uuid v7 | |
| `enrollment_id`, `teacher_user_id`, `student_user_id`, `subject_id` | uuid FKs | from the enrollment, never the input |
| `completion_date` | date | not in the future |
| `language` | `language` (ar · en) | default `ar` (FR-LOC-4) |
| `status` | enum `ijazah_request_status`: `awaiting_student_name` · `pending` · `approved` · `rejected` · `closed` | |
| `chain_snapshot` | jsonb | generations (arrays of names), origin first, the teacher appended; frozen at send, re-frozen on a chain correction while open (R-403) |
| `teacher_name_printed` | text NOT NULL | `teacher_credentials.holder_name` at send |
| `signature_storage_key` | text | the request's own copy; NULL once erased (rejected or closed) |
| `reason` | text | mandatory when `rejected` (a check) |
| `decided_by_admin_id`, `decided_at` | | set together on approve or reject (a check) |
| `created_at`, `updated_at` | | |

Indexes: a partial unique on `enrollment_id` WHERE `status IN ('awaiting_student_name','pending')`; one on
(`status`, `created_at`) for the queue.

## Changed: `ijazahs` (certification)
New columns (ERD :582, ADR 0019 D1):
- `request_id` uuid FK unique → `ijazah_requests`;
- `issued_by_admin_id` FK → `admin_users`;
- `student_name_printed` and `teacher_name_printed` text NOT NULL;
- `completion_date` date;
- `rendered_at` timestamptz NULL (R-402).

The table holds no row today, so the NOT NULLs need no backfill (to be verified by a SELECT before the migration,
B26's lesson). `mode` stays and the service refuses `uploaded` (ADR 0013). `verification_token_hash` is minted at
issue (DEC-70).

## Changed: `isnad_entries` and chains
No change. The snapshot is built from the rows at send and re-built on a correction (R-403).

## Unchanged, now written
- **`teacher_signatures` (catalog):** written by the signature upload (R-411), its `storage_key` as the init
  migration holds it (as `users.photo_key` is), served only by signed link (R-SEC-3). Erased at a teacher's deletion
  (R-403).
- **`ijazah_bars` (certification), `gender_flags`, `user_reports` (moderation), `device_push_tokens` (identity):** as
  in the init migration.
- **`notifications`:** as in the init migration. No enum member is added in v1.0 (R-406).

## New: `session_reminders` (notifications; R-407)
| Column | Type | Rule |
|---|---|---|
| `session_id` | uuid FK → `sessions` | |
| `user_id` | uuid FK → `users` | |
| `offset_minutes` | int | from `reminder_offsets_minutes` |
| `notification_id` | uuid FK → `notifications` | |
| `created_at` | timestamptz | |

Primary key (`session_id`, `user_id`, `offset_minutes`).

Partial uniques:
- `user_reports`: (`reporter_user_id`, `reported_user_id`, `context`) WHERE `status = 'open'`;
- `gender_flags`: (`flagged_user_id`) WHERE `status = 'open'`.

Checks: `reporter_user_id <> reported_user_id`; a `user_reports` row with `context = 'session'` has a `session_id`.

## Enum members added (additive, R-API-9)
- `compensation_case_reason`: `gender_correction`, `gender_fraud` (R-409).
- `ijazah_request_status` (new enum, above).

## Settings (seed: a new block at the settings list's end, `tracks-coordination.md` §1)
| Key | Default |
|---|---|
| `rate_limit_user_report` | 5 per 86400 s (DEC-71) |
| `rate_limit_gender_flag` | 3 per 86400 s (DEC-71) |
| `rate_limit_ijazah_request` | 10 per 3600 s (per teacher) |
| `rate_limit_ijazah_decision` | 10 per 60 s (per administrator: approve, reject, revoke, bar) |
| `rate_limit_gender_decision` | 10 per 60 s (per administrator) |
| `rate_limit_settings_update` | 10 per 60 s (per administrator) |

`reminder_offsets_minutes` exists (`prisma/seed.ts:115`). The four rate limits beyond DEC-71's two follow Phase 3's
precedent for administrator limits (10 per 60 s, DEC-66 to DEC-68) and get their §3.14 rows in a track 1 DEC, in the
batch that seeds them.

## State transitions
- **Request.** Sent → `awaiting_student_name` (no certificate name) or `pending`; the name entered → `pending`;
  approved → `approved` (+ an `ijazahs` row); rejected → `rejected`; the student deleted → `closed`.
- **Ijazah.** Issued → rendered (`rendered_at`) → revoked (`revoked_at`), never deleted.
- **Report.** `open` → `actioned` | `dismissed`.
- **Gender flag.** `open` → `dismissed` | `corrected` | `fraud_ban`.
