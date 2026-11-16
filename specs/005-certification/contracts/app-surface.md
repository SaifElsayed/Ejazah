# App surface: Phase 4 additions (user router)

Additive only (R-API-9). Every output has its `.output(schema)` (the Phase 1 rule), and every procedure declares its
caller kind. Schemas live in `packages/contracts/src/{certificates,reports,gender-flags,push}.ts`. An `idempotencyKey`
is required where noted, with the scope listed in `idempotent-procedures.ts`.

| Procedure | Kind | Input | Output | Limit | Notes |
|---|---|---|---|---|---|
| `teacher.signature.get` | teacher (`approved`) | void | `{ link: string \| null, uploadedAt }` | default | a signed link (`document_link_ttl_seconds`) |
| `POST /uploads/signature` | teacher (`approved`) | multipart, one PNG or JPEG | `{ uploadedAt }` | `rate_limit_upload` | kind `signature`, sniffed (R-SEC-4) |
| `teacher.ijazahRequests.preview` | teacher (`approved`) | `{ enrollmentId, completionDate, language }` | `{ chain, teacherName, studentName \| null, dates }` | default | the filled certificate before sending (FR-IJAZAH-15) |
| `teacher.ijazahRequests.send` | teacher (`approved`) | `{ enrollmentId, completionDate, language, idempotencyKey }` | `{ requestId, status }` | `rate_limit_ijazah_request` | refusals: `not_active`, `not_ijazah_track`, `no_credential`, `no_signature`, `student_barred`, `request_open` (FR-603); NOT_FOUND for an enrollment not the caller's |
| `teacher.ijazahRequests.get` | teacher | `{ enrollmentId }` | `{ request \| null }` | default | status, reason when rejected, `ijazahId` when issued |
| `account.certificateName.set` | student | `{ name, idempotencyKey }` | `{ name }` | default | once; `already_set` after; moves the waiting request to `pending` |
| `certificates.list` | participant | void | `{ items: [{ ijazahId, subject, teacherName, issuedAt, revoked, ready }] }` | default | the caller's as student or as granting teacher |
| `certificates.link` | participant | `{ ijazahId }` | `{ link }` | default | the two parties only, else NOT_FOUND; `not_ready` until rendered; revoked still served |
| `reports.create` | user | `{ reportedUserId, context: 'session' \| 'chat' \| 'profile', sessionId?, reason, idempotencyKey }` | `{ received: true }` | `rate_limit_user_report` | a profile not visible answers NOT_FOUND (R-GENDER-2); refusals `self`, `open_exists` |
| `genderFlags.raise` | user | `{ flaggedUserId, reason, idempotencyKey }` | `{ received: true }` | `rate_limit_gender_flag` | only a user the caller is paired with or can see; `open_exists` |
| `account.pushToken.register` | user | `{ token, platform }` | void | default | upsert by the token's hash; `last_seen_at` |
| `account.pushToken.remove` | user | `{ token }` | void | default | |

**Enrollment reads gain** (additive, on the existing outputs of `enrollments.get` and `teacher.students.get`):
`ijazahRequest: { status, reason?, ijazahId? } | null`, so the screen shows the state (FR-608).

**Live event** (`packages/contracts/src/live.ts`, additive): `{ type: 'ijazahRequest', enrollmentId }` to both
parties on send, approve, reject and render.

**Adversarial suite:** `teacher.ijazahRequests.*`, `certificates.*`, `reports.create` and `genderFlags.raise` are
registered in both directions (R-413).
