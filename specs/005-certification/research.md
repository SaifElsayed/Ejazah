# Research: Phase 4 — Certification, reports and notifications (lightened)

Decisions for `plan.md`, numbered from R-401 (Phase 3's run to R-326). Each gives the decision, the rationale, the
alternatives, and the code it stands on (read on `d1cefb45`). The owner answered P1–P4
(`ejazah-tools\b43\t057-plan-questions.md`) and D1 on 2026-11-16, recorded in SRS DEC-72.

## R-401 — The certificate is rendered by the Typst CLI in the worker (P1 (a), the owner's answer)
- **Decision.**
  - A job `render-certificate` (payload: the ijazah's id) runs the Typst CLI, pinned at 0.15.1, as a child process.
  - It renders a template in `apps/api/src/modules/certification/template/` (the v2 layout of ADR 0004 D2) with Amiri
    1.003 vendored beside it.
  - The case goes in as a JSON data file; the template never calls `eval` on it.
  - The PDF goes to storage under `certificates/<ijazahId>.pdf`, the key in `ijazahs.certificate_storage_key` as text
    (it holds no secret: the file is served only by signed link, R-SEC-3).
  - The binary's path comes from configuration (`TYPST_BIN`); a missing binary fails the job, never the request.
  - The child process runs under a timeout: a small helper `apps/api/src/platform/typst/run-typst.ts` spawns the CLI
    and names `CERTIFICATE_RENDER_TIMEOUT_MS` once, with its reason beside it (a protection number that keeps a stuck
    render from holding a worker slot; R-MONEY-12's exception for constants named once in `apps/api/src/platform/**`).
    A render past it is killed and the job fails into its retries.
  - CI and the production image download the pinned 0.15.1 release and check its SHA-256 against a value kept in the
    repository before using it.
- **Rationale.** ADR 0004 D1 chose Typst and measured this exact version, from 25 to 60 generations, Arabic shaping
  included. R-API-13 forbids rendering in a request. ADR 0004's Consequences require pinning, vendored fonts and no
  `eval`.
- **Alternatives.** A Node binding (version drift from what was measured, a native npm package); Chromium (rejected by
  ADR 0004).
- **Install.** The binary is installed locally, in CI and in the production image only on the owner's word typed in
  the implementing session.
- **Code.** No renderer exists (no package, no `.typ` file). The job pattern is in `apps/api/src/jobs/README.md`, and
  its line 8 plans `render-certificate`.

## R-402 — Issue is three steps: the record in the request, the PDF in the job, the administrator's sign-off
- **Decision.** `ijazahRequests.approve` writes, in one transaction:
  - the `ijazahs` row (number, token hash, frozen chain, printed names, dates, `request_id`, `issued_by_admin_id`,
    `certificate_storage_key` reserved as `certificates/<id>.pdf`);
  - the request's status `approved`.

  It then enqueues `render-certificate` after commit (`addOrRetry`, `jobId` = the ijazah id and its
  `render_generation`). The job sets `ijazahs.rendered_at`. The job is idempotent: if `rendered_at` is set for the
  current generation, a rerun writes nothing (R-API-14).
- **The sign-off (the owner's addition to P1, DEC-72).**
  - The administrator opens the rendered PDF (`ijazahs.get`, a signed link) and signs it off with `ijazahs.signOff`
    (sets `signed_off_at` and `signed_off_by_admin_id`; refused before `rendered_at`, after a revocation or a sign-off).
  - Or they call `ijazahs.rerender` (a reason): `render_generation` + 1, `rendered_at` cleared, the job enqueued again.
  - A correction of the chain or of the certificate name before the sign-off re-freezes the record and re-renders it
    the same way (R-403).
  - The parties see «issued, being prepared» until `signed_off_at` is set; the live event `ijazahRequest` is published
    at the sign-off.
  - A certificate the administrator should not issue after all is revoked (R-412): it is kept and never shown.
- **Rationale.** The approval must never depend on the renderer's availability; the number is fixed at approval
  (FR-605); the owner wants a person to see each certificate before the parties do.
- **Alternatives.** Render inside the approval (forbidden, R-API-13); render a draft before approval and issue at the
  sign-off (a second copy of every frozen field on the request).

## R-403 — What the request freezes, and when (C3; P4 (a); DEC-72)
- **At the request:**
  - the chain (generations of names from `isnad_entries`, origin first, the teacher appended, FR-ISNAD-7);
  - the teacher's printed name (`teacher_credentials.holder_name`, ADR 0019 D1);
  - a copy of the teacher's signature image under the request's own storage key
    (`ijazah-requests/<id>/signature.<ext>`).
- **At approval:** the student's printed name (`users.certificate_name`, which may arrive after the request, ADR 0019
  D1) and the issue date.
- **A chain correction** (FR-ISNAD-4) while a request on that credential is open re-freezes the request's chain and
  holder name (P4 (a)); one on an approved ijazah not yet signed off re-freezes the ijazah's snapshot and re-renders it
  (DEC-72). So the issued chain is the chain at the sign-off.
- **A certificate-name correction** (`users.setCertificateName`) before the sign-off re-freezes the ijazah's
  `student_name_printed` and re-renders it.
- **On rejection or closing**, the request's signature copy is erased.
- **At a teacher's deletion** nothing of this is touched: a teacher with an undecided request cannot be deleted (R-414),
  and the live signature is kept (DEC-72, R-411).
- **How the correction reaches the request.** Catalog's correction service takes a port `OpenRequestsRefreeze` handed in by `main.ts` and bound to certification (certification imports catalog; `docs/ARCHITECTURE.md:195`'s pattern); it re-freezes the chain and the holder name of the open requests, and the snapshot of the approved ijazahs not yet signed off. Identity's certificate-name service reaches the ijazah through its port `AwaitingNameRelease` (R-411), which gains the re-freeze.
- **Rationale.** The owner's C3 («حق الطالب هيروح؟»), P4 and the sign-off of DEC-72.
- **Alternatives.** Referencing the live signature (replaced by a later upload); never re-freezing (a correction made
  during review would never reach the certificate).

## R-404 — The request's states
- **States:** `awaiting_student_name` → `pending` → `approved` | `rejected`; `closed` when the student's account is
  deleted.
- **Checks when sending:**
  - the teacher is active (`StandingService` reads; an applicant cannot send);
  - the enrollment is the teacher's, ijazah-track, and confirmed or completed;
  - the student is not barred (`ijazah_bars` with no `lifted_at`);
  - an approved credential exists for the enrollment's subject;
  - the signature exists;
  - no other open request (`awaiting_student_name` or `pending`) exists for the enrollment: a partial unique index;
  - the enrollment has no unrevoked ijazah (`already_issued`), read under the enrollment's lock; a revocation allows a
    new request (FR-IJAZAH-9).
- **After sending:** a request stays open through any change of the teacher's standing (FR-628).
- **Rationale.** ADR 0017 D3 and D5, ERD :582 («at most one pending request per enrollment»), widened to both open
  states.
- **Code.** `enrollments` and the track come from booking's `EnrollmentSide`, credentials from catalog's entry, bars
  from certification's own table.

## R-405 — Push through Expo's push service (P2 (a), the owner's answer)
- **Decision.**
  - The adapter `platform/ports/push/expo.adapter.ts` behind the existing `PushPort` (`push.port.ts`; the payload
    holds UUIDs only, R-HONEST-5) posts to Expo's push endpoint with `fetch`, no server SDK.
  - `PUSH_PROVIDER` gains `expo`.
  - The phone registers its token through `account.pushToken.register` and removes it at sign-out
    (`account.pushToken.remove`).
  - The permission is asked the first time a push could matter: after the first booking is confirmed, or on the
    enrollment screen.
  - The call to Expo runs under a timeout, the named constant `PUSH_REQUEST_TIMEOUT_MS` in the adapter; a timeout fails
    the delivery into its retries.
  - If Expo's access token is turned on for the project, `EXPO_ACCESS_TOKEN` is an optional variable in
    `env.schema.ts` and `.env.example`.
- **Rationale.** The port and stand-in already exist (`push/fake.adapter.ts`, `push/index.ts`'s comment «The real
  provider's member … the Phase 4 adapter task»), and `findStaleTargets` maps to Expo's receipts.
- **Owner acts (P2).** `expo-notifications` added, a Firebase project with FCM v1 credentials in EAS, a new dev build.
- **Alternatives.** FCM directly (a server SDK and credentials, iOS separate later).

## R-406 — Notifications: one writer, one delivery job, seven kinds
- **Decision.**
  - `notifications` module: `NotificationWriter.record(tx, { userId, type, payload })` writes a row on the caller's
    transaction.
  - An after-commit enqueue of `deliver-notification` (payload: the notification id) sends to each device token and
    sets `pushed_at`.
  - Retries come from BullMQ's attempts. A row already pushed is skipped (idempotent).
  - Stale tokens found by the provider are removed.
- **Kinds in v1.0** (DEC-70, DEC-71): `session_reminder`, `cancellation_requested`, `cancellation_request_accepted`,
  `cancellation_request_declined`, `payment_confirmed`, `payment_failed`, `payment_expired`. All seven are already in
  `notification_type` (`base.prisma:487-503`), so **no enum migration in v1.0**. ADR 0021's 12 and Phase 3's 15 names
  move to v1.1 with the centre; the ERD's notes (:681-700, changelog rows 22 and 30) are re-pointed.
- **Titles and bodies** are i18n keys rendered in the user's language at send time (FR-NOTIF-3); nothing personal in
  the payload.
- **Producers** (the module entry, on the producer's transaction):
  - sessions' cancellation request and answer services (T021's paths);
  - payments' order-events (confirmed, failed, expired) from Phase 2's durable records (PLAN.md);
  - the reminder job (R-407).
- **Rationale.** FR-NOTIF-4 and R-API-15. The lint rule `no-push-outside-job` already allows the port only in jobs.

## R-407 — Reminders: a sweep, not delayed jobs
- **Decision.** A sweep `send-reminder` runs every minute. For each offset in `reminder_offsets_minutes` it selects the
  `scheduled` sessions with `scheduled_start_at - offset <= now < scheduled_start_at` and no reminder row for
  (session, offset, user). It records one notification each; the primary key (session, user, offset) makes a rerun
  write nothing. No last run is kept, so a worker that was down catches up on its next run, for every session that has
  not started yet. A session booked inside an offset's window gets that offset's reminder on the next run (a make-up
  booked three hours ahead gets the 24-hour one); this is the intended catch-up.
  - **The read.** No new index (R-DB-9). The sweep reads through ERD §14's existing partial index
    `sessions (scheduled_end_at) WHERE status = 'scheduled'`, bounded by `now < scheduled_end_at <= now + maxOffset +
    maxLength` (maxOffset the largest of `reminder_offsets_minutes`, maxLength the largest of `SESSION_LENGTHS_MINUTES`,
    `packages/contracts/src/packages.ts:17`), then filters on the start instant. An index on `scheduled_start_at` is
    added only after a measured slow query.
  - Recomputed instants (`reresolve-session-instants`, the hook at `jobs/reresolve-session-instants.ts:181-182`) need
    no rescheduling: the sweep reads the committed instants.
  - A session no longer scheduled is skipped.
- **Rationale.** No per-session delayed job to cancel or move; the double-run rule holds by the unique key; the hook
  only needs a comment pointing here.
- **Alternatives.** Delayed BullMQ jobs per session and offset (must be moved on every recompute and cancelled on every
  cancellation).
- **Data.** A small table `session_reminders (session_id, user_id, offset_minutes, notification_id, sent_at)`, unique
  on the first three.

## R-408 — Reports
- **Decision.**
  - `reports.create` (user kind, `rate_limit_user_report`, 5 per 86400 s) writes an `open` row, with:
    - a context of session (the caller a party, through `Pairings.partyOfSession`, which also answers the session's
      enrollment), chat (the caller a party of the enrollment, through `Pairings.partyOfEnrollment`) or profile
      (visible to the caller by the visibility predicate, else NOT_FOUND, R-GENDER-2); a session or chat that is not
      the caller's answers NOT_FOUND;
    - every session and chat report stores its enrollment in `user_reports.enrollment_id`, set by the server (for a
      session report, from the session);
    - one open report per reporter, reported user and context (a partial unique);
    - no report on oneself.
  - Admin queue: `reports.list`, `reports.get`, `reports.resolve` (actioned or dismissed, with a note; audited).
  - The chat purge also holds an enrollment with an open report on one of its sessions or on its chat (FR-492,
    FR-SESS-13): moderation's `enrollmentsWithOpenMatterAmong` gains open `user_reports`, through
    `user_reports.enrollment_id`, moderation's own table.
- **`Pairings` (R-API-3/4, R-API-6).** Booking and sessions import moderation, so moderation reads their rows only
  through a port it declares, bound by `main.ts` as identity's `OngoingEnrollments` is bound to booking:
  - `partyOfSession(tx, sessionId, userId)` → `{ enrollmentId, counterpartUserId } | null` (sessions' entry);
  - `partyOfEnrollment(tx, enrollmentId, userId)` → `{ counterpartUserId } | null` (booking's entry);
  - `paired(tx, userId, otherUserId)` → whether an enrollment, whatever its status, joins the two (booking's entry).
- **Code.** No code reads `user_reports` yet; `chat/purge.service.ts:10-12` reads disputes only.

## R-409 — Gender flags, the correction and the fraud ban
- **Raising a flag:**
  - `genderFlags.raise` (user kind, `rate_limit_gender_flag`, 3 per 86400 s), on a user the caller is paired with
    (`Pairings.paired`) or can see (the visibility predicate), else NOT_FOUND; one open flag per flagged user;
  - `genderFlags.raise` (admin) from a report or on the administrator's own initiative (`raised_by_user_id` null).
  - The flag stores its `reason` and, when raised from a report, its `report_id`.
- **The queue:** `genderFlags.list`, `.get`, `.dismiss`, `.correct`, `.fraudBan`. Each takes a mandatory reason, is
  audited and keyed by an idempotency key.
- **Correct (FR-GENDER-7):**
  - identity changes `users.gender`;
  - for each enrollment of the user that now pairs two genders, booking cancels it with `gender_correction` (the
    reason exists, `base.prisma:229`, and is never restorable, `restore-window.ts:27`), its remaining sessions
    `cancelled_by_admin`;
  - one compensation case per enrollment, under a new reason `gender_correction`, added to the code list
    `COMPENSATION_REASONS` (`moderation/compensation-case.service.ts:47-89`; the reason is a `String` column, so no
    migration), with an ERD changelog line.
- **Fraud (FR-GENDER-6):**
  - identity sets `users.gender` to the established gender through the same administrators' path as the correction,
    but without the correction's closings, on the fraud's own transaction and before the ban;
  - `StandingService` bans the account (`ban` / `banStudent`, `standing.service.ts:368-473`);
  - the closings it already does cancel the enrollments, and the counterparties' cases keep the ban's own reasons
    (`student_banned`, `teacher_ended`). So `kindsOf` (`sessions/restore-window.ts:95-101`), `END_REASONS`
    (`sessions/case-queue.service.ts:85-91`) and `KIND_OF` (`sessions/ban-lift.service.ts:165`) stay unchanged, and the
    lift and the restore find these closings as they find any ban's. The fraud is recorded on the flag (`fraud_ban`)
    and in the audit entry. No `gender_fraud` reason is added.
  - The lift's pairing check (`ban-lift.service.ts:242-259`) compares `users.gender`, which is now corrected, so it
    refuses each pairing the corrected genders forbid.
- **The restore's pairing check (DEC-69, Phase 4's declarations).** `sessions.restore`'s step 3
  (`sessions/restore.service.ts:528-537`) also compares the two parties' declared genders and refuses a mismatch
  `gender_mismatch`, as the lift does, whatever closed the enrollment (T014, red first, with an adversarial case). The
  restore never puts a mixed pairing back, even after a later correction of either party.
- **Where the decisions run (R-API-3/4).** Booking and sessions import moderation, so moderation never imports them.
  `genderFlags.get`'s list of the enrollments a correction would end, `genderFlags.correct` and `.fraudBan` are
  composed in the admin module (`modules/admin/gender-decisions.service.ts`), which no module imports. It calls
  identity's, booking's, sessions' and moderation's entries. Moderation keeps the flag and report rows and imports
  identity only, for the visibility predicate of `reports.create` and `genderFlags.raise`; its party and pairing checks
  go through `Pairings` (R-408).
- **Locks:** the user first, then the enrollments in id order, as the ban path takes them
  (`specs/004-sessions/contracts/kernel.md`, a row added).
- **No self-service path** exists or is added (R-GENDER-6).

## R-410 — The settings page and its registry
- **Decision.** A registry `platform/settings/registry.ts` lists every §3.14 key with its zod schema, bounds, unit,
  group and the SRS row it governs; a CI spec asserts it matches the seed's keys one to one.
  - Admin procedures: `settings.list` and `settings.update` (`rate_limit_settings_update`, 10 per 60 s; a reason;
    audited with before and after).
  - `settings.update` writes through a new `settings.repository` writer, a lift of R-PROC-11's «this file reads it
    and never writes it», so the admin module's repository gains the one writer.
  - The panel's catalogue (`apps/admin/src/i18n/*.json`, `settings`, :2155-2255) already holds the labels.
- **Rationale.** FR-ADMIN-9. No registry with bounds exists: each key's schema lives at its read site.
- **Who builds it.** A «light item»: either track, on the owner's word by name (`tracks-coordination.md` §2).

## R-411 — The signature and the certificate name
- **Signature.**
  - A new upload kind `signature` (`upload.middleware.ts:154`: PNG or JPEG, sniffed, `upload_max_bytes`).
  - Route `POST /uploads/signature` (teacher, `admits: 'approved'`), on the `upload-route.ts` helper.
  - Catalog writes `teacher_signatures` (owner: catalog, `module-tables.json`), its key stored as `users.photo_key` is
    and served only by signed link (R-SEC-3).
  - `teacher.signature.get` answers a signed link.
  - **Kept at deletion** (the owner's «خليها متتمسحش», DEC-72). `eraseAccount`
    (`identity/identity.repository.ts:428-462`) already leaves `teacher_signatures` alone, which now matches the rule
    for a teacher once approved. The kept-data reading and erasure (`verification/kept-data.service.ts`, FR-ADMIN-21)
    gain the signature: a link with a reason, and its file removed at the erasure date or an erasure now. A teacher
    never approved keeps nothing, so their signature is erased at deletion.
- **Certificate name.** `account.certificateName.set` (student, once: refused when already set);
  `users.setCertificateName` (admin, with a reason, audited, ADR 0019 D1). Either releases the student's requests
  waiting for the name through identity's port `AwaitingNameRelease`, bound to certification by `main.ts` (identity
  imports no module, `docs/ARCHITECTURE.md:183`).

## R-412 — Revocation, the bar, and what the parties see
- **Admin procedures:**
  - `ijazahs.revoke` (a reason; sets `revoked_at`, `revoked_reason`, `revoked_by_admin_id`; never deletes);
  - `ijazahs.bar` and `ijazahs.liftBar` (`ijazah_bars`).
- **The parties:** both read their ijazahs through `certificates.list` and `certificates.link`; one not yet signed off
  is listed as being prepared and `certificates.link` answers `not_ready`; a revoked one is listed `revoked: true` and
  `certificates.link` answers `revoked`, with no link (D1 (a), the owner's answer, DEC-72; R-HONEST-6). The student's
  public credentials (FR-IJAZAH-4) list only the signed-off and unrevoked.
- **The administrator** reads the PDF through `ijazahs.get` before and after the sign-off, revoked or not, each opening
  audited.
- **Live events:** the request's status is pushed to the open screens by a new live event
  `{ type: 'ijazahRequest', enrollmentId }` (additive to `packages/contracts/src/live.ts`).

## R-414 — An undecided request blocks a teacher's deletion; an administrator's deletion of a teacher waits
- **Decision (DEC-72).**
  - Identity's own deletion (`identity/deletion.service.ts`, T080's refusal) asks a second port on its transaction,
    `OpenIjazahRequests` (`count(tx, teacherUserId)`: requests `awaiting_student_name` or `pending`, and `approved`
    ones whose ijazah is not signed off), bound by `main.ts` to certification as `OngoingEnrollments` is bound to
    booking. A count above zero refuses `CONFLICT` with the cause `pending_ijazah_requests`, writing nothing, with one
    info line of ids.
  - `users.delete` (T081) asks, for a teacher only: the count of enrollments `pending_payment` or `confirmed`
    (paused included), through a second method `live(tx, userId)` of the existing `OngoingEnrollments` port (bound to
    booking in `main.ts`), and the same request count. Either refuses with its cause (`active_enrollments`,
    `pending_ijazah_requests`), writing nothing. The administrator ends each confirmed enrollment with the direct end
    (`004:T082`), lets one awaiting payment lapse, and decides each request. A student's `users.delete` is unchanged.
  - `users.delete` of a teacher also asks the count of open compensation cases on the teacher's enrollments, through a
    port identity declares, `OpenCases` (`count(tx, teacherUserId)`), bound by `main.ts` to moderation's entry
    (identity imports no module, `docs/ARCHITECTURE.md:183`), refusing `open_cases` (the owner's answer on held enrollments: «بيتمنع المسح لحد متتحل قضية الطالب»). This
    covers the enrollments closed by the teacher's own ban or revocation while their slot is held, and those the
    direct end has just ended. Each case then goes one of two ways:
    - closed with the amount compensated (`compensation_ordered`): the restore is refused from then on
      (`sessions/restore.service.ts:37`, `case_closed`), the enrollment is final, and the deletion may go on;
    - compensated with sessions: the administrator lifts the ban or the revocation, the restore brings the enrollment
      back and closes its case (`restore.service.ts:21`), and the teacher and the student carry on, so the ongoing
      enrollment refuses the deletion again.
- **Rationale.** The owner's P3 answers. Every tool the administrator needs already exists (the direct end, the
  request queue, the case's closing, the ban's lift), so «hard but possible» needs no new mechanism.
- **Code.** `deletion.service.ts:51-75` (the two paths and the port pattern); `004:T080`, `004:T081`, `004:T082`;
  `moderation/compensation-case.repository.ts:59` (the resolutions).

## R-413 — Proofs
- Every new user procedure is registered in the adversarial harness (both directions) or exempt with its reason, and
  `certificates`, `reports` and `genderFlags` join `ATTACKED_ROUTERS` (T052's rule, extended).
- Each job has its double-run spec.
- The certificate template has a spec over chains of 1, 25, 60 and 61 generations and a hostile name.
- The magic-number gate, the money boundary and SC-413's invariant (B43's T053) cover the new modules unchanged.
