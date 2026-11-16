# Admin surface: Phase 4 additions (admin router)

`adminProcedure`: throttled before the transaction, audited on it (R-API-12), live events flushed after commit.
Mutations carry an `idempotencyKey`, and their scopes are listed in `idempotent-procedures.ts`. Schemas live in
`packages/contracts/src/admin/{ijazahs,reports,gender-flags,settings}.ts`. The audit target is a kind word and an id,
never a name (FR-ADMIN-17).

| Procedure | Input | Output | Limit | Audit action |
|---|---|---|---|---|
| `ijazahRequests.list` | `{ status?, cursor? }` | page of `{ requestId, teacher, student, subject, status, sentAt, teacherStanding }` | default | `ijazah_requests.listed` |
| `ijazahRequests.get` | `{ requestId }` | the request, its frozen chain and names, `teacherStanding: { status, reason? }`, a link to the frozen signature | default | `ijazah_request.viewed` |
| `ijazahRequests.approve` | `{ requestId, idempotencyKey }` | `{ ijazahId, certificateNumber }` | `rate_limit_ijazah_decision` | `ijazah.issued` |
| `ijazahRequests.reject` | `{ requestId, reason, idempotencyKey }` | void | `rate_limit_ijazah_decision` | `ijazah_request.rejected` |
| `ijazahs.list` / `ijazahs.get` | filters / `{ ijazahId }` | the record, `revoked`, `rendered` | default | `ijazahs.listed` / `ijazah.viewed` |
| `ijazahs.signOff` | `{ ijazahId, idempotencyKey }` | void | `rate_limit_ijazah_decision` | `ijazah.signed_off`; refused `not_rendered`, `revoked`, `already_signed_off` (DEC-72) |
| `ijazahs.rerender` | `{ ijazahId, reason, idempotencyKey }` | void | `rate_limit_ijazah_decision` | `ijazah.rerendered`; refused once signed off or revoked |
| `ijazahs.revoke` | `{ ijazahId, reason, idempotencyKey }` | void | `rate_limit_ijazah_decision` | `ijazah.revoked` |
| `ijazahs.bar` / `ijazahs.liftBar` | `{ userId, reason, idempotencyKey }` | void | `rate_limit_ijazah_decision` | `ijazah_bar.set` / `ijazah_bar.lifted` |
| `users.setCertificateName` | `{ userId, name, reason, idempotencyKey }` | void | `rate_limit_ijazah_decision` | `user.certificate_name_set` (no name in the entry) |
| `reports.list` / `reports.get` | `{ status?, cursor? }` / `{ reportId }` | queue and detail, links to the session or enrollment | default | `reports.listed` / `report.viewed` |
| `reports.resolve` | `{ reportId, outcome: 'actioned' \| 'dismissed', note, idempotencyKey }` | void | default | `report.resolved` |
| `genderFlags.list` / `genderFlags.get` | queue / `{ flagId }` | the flag; on `get`, the enrollments a correction would end (a preview count and ids) | default | `gender_flags.listed` / `gender_flag.viewed` |
| `genderFlags.raise` | `{ userId, reason, reportId?, idempotencyKey }` | `{ flagId }` | `rate_limit_gender_decision` | `gender_flag.raised` |
| `genderFlags.dismiss` | `{ flagId, reason, idempotencyKey }` | void | `rate_limit_gender_decision` | `gender_flag.dismissed` |
| `genderFlags.correct` | `{ flagId, reason, idempotencyKey }` | `{ endedEnrollments: number }` | `rate_limit_gender_decision` | `gender.corrected` ⚠️ irreversible ends |
| `genderFlags.fraudBan` | `{ flagId, reason, idempotencyKey }` | void | `rate_limit_gender_decision` | `gender.fraud_banned` ⚠️ |
| `settings.list` | void | every registry key: value, default, bounds, unit, group, SRS row | default | `settings.listed` |
| `settings.update` | `{ key, value, reason, idempotencyKey }` | `{ key, value }` | `rate_limit_settings_update` | `setting.changed` (before and after) |

`ijazahRequests.approve` writes the ijazah and enqueues `render-certificate` after commit (R-402).
`genderFlags.correct` and `.fraudBan` are composed in the admin module (R-409), run on one transaction with the lock
order of R-409, and record one row in `specs/004-sessions/contracts/kernel.md`.
