---
description: 'Task list for Phase 4 — Certification, reports and notifications (lightened)'
---

# Tasks: Phase 4 — Certification, reports and notifications (lightened)

**Input**: Design documents from `/specs/005-certification/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The owner's lighter gates of 2026-11-15 (PLAN.md, «How a phase is run», as amended on
2026-11-16) set the rigour:
- **Full TDD** (each spec red first on its own, negatives red under a named mutant, every mutant restored and
  `cmp`-checked) for gender, security and time: T004, T006, T007, T009, T010, T011, T013, T014, T015, T016, T018,
  T031, T032.
- **Lighter specs** (a render or behaviour spec per screen, in Arabic and English) for T019 to T024.
- Every job has its double-run spec (R-API-14). Every new user procedure is in the adversarial harness both ways, or
  exempt with its reason (T025).
- DB specs run on `ijazah_integrity` only.

**Organization**: The foundations, then the stories of spec.md in priority order, then the screens and the proofs,
in the batches B45 to B49 (B44 is `004:T068`'s logo build). Then «v1.1, the first update»: tasks listed and untimed
(SRS DEC-70).

**The owner's answers** (2026-11-16; `ejazah-tools\b43\t057-plan-questions.md`, P1–P4, and D1; SRS DEC-72): D1 (a),
P1 (a) with the administrator's sign-off, P2 (a), P3 the owner's own (no deletion while a request is undecided, the
signature kept), P4 (a). Installing the Typst binary (T008) and `expo-notifications` (T005, T020) each still waits for
the owner's word typed in the implementing session; until then T005 and T020 build on the stand-in.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete work).
- **[Story]**: US1–US7 of spec.md.
- A task of another file is written `004:T057`; a bare id is this file's. Every task names its file paths.

## Path Conventions

`apps/api/src/` (`modules/<module>/`, `platform/`, `surfaces/`, `jobs/`, `main.ts`, `worker.ts`), `apps/mobile/src/`,
`apps/admin/src/`, `packages/contracts/src/`, `prisma/`, `tests/`. Batches are cut from `develop` after T057's PR
merges, as `Ejazah_app/005-certification/<ids>` (`tracks-coordination.md` §1). The integration owns `main.ts`,
`worker.ts`, `surfaces/context.ts`, `admin.router.ts`, `app.router.ts`, the contract snapshot and the module READMEs.

---

## Phase 1: Foundations (B45)

- [x] T001 The migration and the seed (data-model.md; FR-626):
  - a forward migration (timestamp of the real time of writing) adding:
    - `ijazah_requests`, with `ijazah_request_status`, its checks and the partial unique on open requests;
    - on `ijazahs`: `request_id` (unique FK), `issued_by_admin_id`, `student_name_printed`, `teacher_name_printed`,
      `completion_date`, `rendered_at`, `render_generation`, `signed_off_at`, `signed_off_by_admin_id` (DEC-72);
    - `session_reminders`;
    - the partial uniques on open `user_reports` and open `gender_flags`, and `user_reports`' two checks;
    - `user_reports.enrollment_id` (required for a session or chat report by a check), `gender_flags.reason` and
      `gender_flags.report_id` (data-model.md); no new index (R-407 reads through ERD §14's
      `sessions (scheduled_end_at)` index).
  - Before it runs, a SELECT shows `ijazahs`, `user_reports` and `gender_flags` hold no row (the NOT NULLs need none).
  - `prisma/schema/{certification,notifications,moderation,base}.prisma`.
  - `prisma/seed.ts`: a new block at the settings list's end with the six rate limits of data-model.md.
  - `tests/seed/seed.spec.ts` (rule d).
  - `docs/ERD.md`: a dated block at its end, and the notifications note re-pointed to v1.1 (R-406). The block also
    amends `ijazahs.chain_snapshot`'s «Immutable» to «immutable from the sign-off» (DEC-72), and ADR 0019 D1 gains a
    dated note: an issued certificate keeps the names it printed from its sign-off.
  - The SRS's §3.14 rows for the four limits beyond DEC-71's two, in the next free track 1 DEC (DEC-73), placed after
    DEC-71's rows.
  - A migration spec red under a mutant migration.
  > **Note under T001 (B45, the owner's decisions of 2026-11-17 on B45's conflict check («الباقي تمام»; Q3: «خلي موضوع حد الاعدادات ده فالمهمات اللي هتتعمل بعد 27»; relayed by the review session), Q1 (a), Q7 (a), Q8 (a); the check: `C:\Users\amrkn\Documents\ejazah-tools\b45\conflict-check.md`).** **The integration, first.** Prisma needs both sides of every new foreign key, so the back-relation lines go in `identity.prisma` (`User`: the request's student and teacher, the reminder's user), `booking.prisma` (`Enrollment`: the requests, the reports), `catalog.prisma` (`Subject`), `admin.prisma` (`AdminUser`: the request's decider, the ijazah's issuer and signer) and `sessions.prisma` (`Session`: the reminders). `packages/config/module-tables.json` gains `ijazah_requests` (certification) and `session_reminders` (notifications), 44 → 46, with `tests/lint-plugin/table-ownership.spec.ts:126-129` and `tests/seed/migrate-from-empty.spec.ts:7`. Rule d, B33 T001's precedent (`2d10645c`). The SELECT and the migration run on `ijazah_integrity` only. `ijazah` is migrated at the 11/19–20 integration with both tracks' migrations in timestamp order, after the same SELECT there (Q8 (a)). Track 2's PR merges before B45's, because CI's `check:migrations` refuses a folder that does not sort after develop's last (Q7 (a)). `tests/seed/seed.spec.ts:326`'s count is the sum of both tracks' rows, written by whichever lands second.
  > **Done (B45, the integration; commits `82eb5558` and the integration's next).** (Migration) `prisma/migrations/20261117055600_certification_foundations/migration.sql`: `prisma migrate diff`'s output against `ijazah_integrity` and, by hand, ERD §15 rules 53 to 57 (`ijazah_requests_one_open_per_enrollment_key`, `ijazah_requests_reason_check`, `ijazah_requests_decided_check`, `ijazahs_signed_off_check`, `user_reports_not_self_check`, `user_reports_context_check`, `user_reports_one_open_key`, `gender_flags_one_open_per_user_key`). «No new index» is read as R-407's: the sweep reads `sessions` through §14's index (research.md:139). The new foreign keys get their plain indexes (FR-035, ERD §14, `58816c82`), and `ijazah_requests (status, created_at)` is data-model.md's queue index. (Database) The SELECT gave 0, 0, 0 (`ejazah-tools45unsintegration-select-empty.txt`); `migrate deploy` ran on `ijazah_integrity` only (06), and `migrate diff` is empty after it (07); `ijazah` is untouched (Q8 (a)). (Spec) `tests/db-integrity/certification-foundations.spec.ts`, 19 cases: all red before the migration (05). Under the mutant M-T001, the migration's generated part alone (the owner's «موافق», 2026-11-17), the eight rule cases are red and the rest green (22); after its revert, the committed hand part re-run unchanged, it is green (24, with the restored catalogue). (Seed) Six rate limits after `:201` (DEC-71, DEC-73); `tests/seed/seed.spec.ts` red on the old seed (10), green (11). (Documents) ERD §8, §10, §11, §14, §15 rules 53-57, changelog rows 47-51 (numbered after track 2's rule 52 and row 46, Q7 (a)); SRS §3.14's four rows and DEC-73; ADR 0019 D1's note. (Rule d) The back-relations in five schema files (Q1 (a)), `module-tables.json` and the 44 → 46 specs, and `tests/db-integrity/soft-delete.spec.ts`' probe ijazah (its two printed names).
- [x] T002 [P] The settings registry (R-410; FR-626: every number a setting with its bounds): `apps/api/src/platform/settings/registry.ts`, every §3.14 key with its
  zod schema, bounds, unit, group and SRS row. A CI spec asserts registry keys = seed keys, both ways, and every
  default is inside its bounds. The admin module's settings repository gains its one writer (`update(key, value)`,
  the panel's writer R-PROC-11 allows).
  > **Note under T002 (B45, the owner's decisions of 2026-11-17 on B45's conflict check («الباقي تمام»; Q3: «خلي موضوع حد الاعدادات ده فالمهمات اللي هتتعمل بعد 27»; relayed by the review session), Q2 (a), Q3 (a); the check: `C:\Users\amrkn\Documents\ejazah-tools\b45\conflict-check.md`).** **Lane B.** The registry holds exactly the seed's keys, both ways, as the spec asserts. Each entry names its §3.14 row, or «§3.14, operational settings» for a key of the paragraph after the table. A §3.14 row with no seed key yet (Currency; the programme's two, track 2's; track 2's share release) joins with its seed row in the batch that seeds it. A key track 2 seeds (`teacher_share_percent`) is added by whichever track lands second (`ejazah-tools\track2\b-m1\implementer-brief.md:11-12`). Bounds (Q3 (a)): the minimum is each key's read-site schema (`platform/settings/keys.ts`, the module's own schemas); a maximum only where a document or the unit names one (a percent ≤ 100); no other number is invented, and the PR body has the table.
  > **Moved (the owner, 2026-11-17, on B45's Q3: «خلي موضوع حد الاعدادات ده فالمهمات اللي هتتعمل بعد 27»; recorded in B45's tasks commit): the full bounds table, after 11/27.** For every registry key, a minimum and a maximum proposed by the implementer, with each value's reason, signed by the owner before it is written into `platform/settings/registry.ts`. The registry spec's «every default inside its bounds» then covers the maxima too. Until then T002's bounds are Q3 (a)'s above, and the panel's settings page (T024) refuses only what they refuse. It is listed in `specs/004-sessions/tasks.md`'s «After 11/26» batches row.
  > **Done (B45, lane B).** `apps/api/src/platform/settings/registry.ts`: `SETTINGS_REGISTRY`, one entry per key `prisma/seed.ts` plants (87 on `82eb5558`), each with its zod schema, its bounds (`SettingBounds`: a number, each offset of a list, or a rate limit's `limit` and `window_seconds`), its unit, its group (`booking`, `sessions`, `notifications`, `general` from the panel's catalogue, and `accounts`, `admin`, `rateLimits`) and its §3.14 row, or «§3.14, operational settings». The kernel's and the contracts' schemas are imported, never restated: `rateLimitSetting` (every `rate_limit_*` key), `uploadMaxBytes`, `documentLinkTtl`, `liveMaxConnections`, `termsVersion` and `checkoutPolling`'s four fields. A module's read site cannot be imported by the kernel (`docs/ARCHITECTURE.md:206`), so its rule is stated once in the registry (`positiveWhole`, `wholeNonNegative`, `attendancePercent`) and the spec compares it with each module schema a public entry exports. `reminder_offsets_minutes` has no read site yet: `reminderOffsets`, whole minutes ahead of the session (FR-BOOK-8). Maxima (Q3 (a)): `attendance_threshold_pct` 100 (the unit), `rate_limit_signed_in_default`'s limit 200 (SRS NFR-SEC-12), `document_link_ttl_seconds` `MAX_LINK_SECONDS` (`platform/ports/storage/storage.port.ts:9`). `settingRefusal(key, value)` (`unknown`, `invalid`, `out_of_bounds`) is what T024 refuses with; `registryMismatch` names the keys on one side only. `modules/admin/settings.repository.ts`: `update(key, value)`, the one writer, refused with `SettingError` (the key, never the value) for a key the registry does not name or no row holds; the repository takes a transaction's client, so T024 commits the change with its audit entry. Specs: `tests/seed/settings-registry.spec.ts` (no database: it runs the real `seed()` on a recording stand-in; the keys both ways, the fixtures each way, every default inside its bounds, each minimum the schema's, the refusals, the §3.14 rows read from `docs/SRS.md`, the shared schemas) and `apps/api/src/modules/admin/settings.repository.spec.ts` (the table on `ijazah_integrity`, rolled back: the value written, an unregistered or unknown key refused, nothing else touched; and a registered key no row holds, refused). Track 2's `teacher_share_percent` and `price_average_min_teachers` join when develop holds them (Q2 (a)).
- [x] T003 [P] [US1] The teacher's signature (FR-601, FR-IJAZAH-12; R-411):
  - upload kind `signature` (PNG or JPEG) in `platform/guards/upload.middleware.ts`;
  - `POST /uploads/signature` (teacher, `approved`) on `surfaces/upload-route.ts`;
  - catalog's `teacher-signature.repository.ts` and `.service.ts` (one current row, replaced on upload, the old file
    erased after commit);
  - `teacher.signature.get` (a signed link);
  - specs: a renamed image refused (R-SEC-4), an applicant refused, the replace path.
  > **Note under T003 (B45, the owner's decisions of 2026-11-17 on B45's conflict check («الباقي تمام»; Q3: «خلي موضوع حد الاعدادات ده فالمهمات اللي هتتعمل بعد 27»; relayed by the review session), Q1 (a); the check: `C:\Users\amrkn\Documents\ejazah-tools\b45\conflict-check.md`).** **Lane C.** The files the line does not name, rule d by precedent: `modules/catalog/signature-upload.controller.ts` (as `identity/photo-upload.controller.ts:45` and `chat/chat-upload.controller.ts:66`), `modules/catalog/teacher-signature.router.ts` for `teacher.signature.get`, `packages/contracts/src/teacher-signature.ts` (as `teacher-credentials.ts`), and `catalog/index.ts`'s exports. The integration mounts `teacher.signature` (`surfaces/app.router.ts`) and registers the route (`main.ts`, the uploads block).
  > **Done (B45 lane C), the line and its B45 note (Q1 (a)).** (Kind) `signature` admits `image/jpeg` and `image/png` by content (`platform/guards/upload.middleware.ts:156`, `:163`); a PDF or text is `VALIDATION_FAILED` whatever its name (`upload.spec.ts`, «the signature kind»). (Route) `POST /uploads/signature` (`modules/catalog/signature-upload.controller.ts:26`) on the upload helper with `admits: 'approved'` (`:58`): the helper gains an optional `admits` read in the teacher kind's order before the body (`surfaces/upload-route.ts:122`, `:224`, `:232`), so a student and an applicant are `FORBIDDEN` and a suspended or banned teacher `ACCOUNT_RESTRICTED`; each refusal once the caller is known logs `{ userId, errorCode }` (`:60`). The answer is `{ uploadedAt }` (`packages/contracts/src/teacher-signature.ts`). (Replace) `teacher-signature.service.ts`: the file stored under a minted key outside the transaction (`:80`); in one transaction the teacher's `users` row locked first (`:84`), the current row read and written by the unique with the database's clock (`teacher-signature.repository.ts`); a refused transaction, its commit included, removes the new file; the old file erased after the commit, never before (`:97`, `:102`), a failed erasure logged by ids and the new row kept. (Link) `teacher.signature.get` (`teacher-signature.router.ts:14`, `admits: 'approved'`) answers `{ link, uploadedAt }`, a signed link under `document_link_ttl_seconds`, or the null pair (`teacher-signature.service.ts:112`). (Entry) `catalog/index.ts`: `CatalogServices.signature` (`:125`), `createCatalogServices` returns it omitted (`:167`), and the block from `:307` exports the store, `createTeacherSignatureService`, the route and the router (lane D's precedent for a factory `main.ts` composes). Rule d: `catalog/slots.router.spec.ts` and `tests/adversarial/teacher-slots-published.spec.ts` gain the unused `signature` service. The adversarial completeness check needs nothing: a teacher-kind procedure outside `sessions`, `chat` and `live` is not student-facing (`tests/adversarial/procedure-harness.ts:280`, `:308-317`). Owed by the integration: the route in `main.ts`'s uploads block, `signature` in `main.ts`'s `catalog` services, `teacher.signature` in `surfaces/app.router.ts`, the export in `packages/contracts/src/index.ts`, the snapshot, the catalog README.
- [x] T004 [P] [US1] The certificate name (FR-602; ADR 0019 D1):
  - `account.certificateName.set` (student, once; `already_set` after), in identity;
  - `users.setCertificateName` (admin, a reason, audited with no name in the entry);
  - setting it (by the student or an administrator) moves the student's `awaiting_student_name` requests to `pending` on the same transaction. Identity imports no module (`docs/ARCHITECTURE.md:183`) and certification imports identity, so identity's certificate-name service takes a port `AwaitingNameRelease` (`release(tx, studentUserId)`), handed in by `main.ts` and bound to certification's entry, as the dependencies against the arrows are (`docs/ARCHITECTURE.md:197`); until T006 lands the port is bound to a no-op;
  - specs, including an admin change never rewriting an issued certificate.
  > **Note under T004 (B45, the owner's decisions of 2026-11-17 on B45's conflict check («الباقي تمام»; Q3: «خلي موضوع حد الاعدادات ده فالمهمات اللي هتتعمل بعد 27»; relayed by the review session), Q4 (a); the check: `C:\Users\amrkn\Documents\ejazah-tools\b45\conflict-check.md`).** **Lane D.** The administrators' `users` namespace is verification's `usersRouter` (`modules/verification/documents.router.ts:74`), so `users.setCertificateName` is a procedure there, its contract in `packages/contracts/src/admin/users.ts`. It calls identity's certificate-name service through `ctx.services.users` as `users.delete` does (`:122-138`, wired in `main.ts`). The «never rewrites an issued certificate» spec reads `ijazahs.student_name_printed`, so the lane is cut after T001.
  > **Done (B45, lane D, 2026-11-17).** `account.certificateName.set` (`modules/identity/account.router.ts`, the student kind, keyed `run`) and `users.setCertificateName` (`modules/verification/documents.router.ts:149`, `rate_limit_ijazah_decision`, keyed `runOn`, audited `user.certificate_name_set` with the reason and no name) over identity's new `certificate-name.service.ts` and `certificate-name.repository.ts`: the account's lock first, the account read under it (a live student's, else `NOT_FOUND` logged `not_student`), `already_set` for the student once a name is held (logged with ids and its reason), the write, then the port `AwaitingNameRelease.release(tx, studentUserId)` on the same transaction, both paths. The port and the factory `createCertificateNameService` are in identity's end block; the integration binds the port in `main.ts` to a no-op until T006; `users` composes it through `createAdminServices`' `certificateNames` (`modules/admin/index.ts:224`, `:457`), as T081's `userDeletion`. Both scopes join `idempotent-procedures.ts`. Specs, red first: `certificate-name.service.spec.ts`, `account.router.spec.ts`, `documents.router.spec.ts`, `tests/db-integrity/certificate-name.spec.ts` (an administrator's change leaves a signed-off ijazah's `student_name_printed` as printed); named mutants `already_set` removed, the port dropped on each path, the name in the audit entry, the write rewriting `ijazahs`, each restored and `cmp`-checked. Rule d: `identity/__fixtures__/surface.ts`, `tests/adversarial/procedure-harness.ts` (exempt, the caller's own account), `tests/adversarial/discovery-world.ts`; on the owner's answers Q-D1 to Q-D3, `certificate-name.repository.ts`, `idempotent-procedures.ts`, `modules/admin/index.ts`.
  > **Follow-up (B45, lane D, 2026-11-17; the owner's answer Q-D5): the student's certificate name outlives an erasure in the idempotency key.** `apps/api/src/modules/identity/certificate-name.service.ts:94` (`setOwn`, keyed `run` at `:76`) stores its outcome `{ name }` in `idempotency_keys.response`, so a deletion that erases `users.certificate_name` (ADR 0015 D3) leaves the name there until `idempotency_key_ttl_hours`. A possible fix: store a null outcome and answer a replay from the account's row. Not fixed in B45. **The owner's Q13 (a), 2026-11-17 («أ في الاتنين»):** the full review's wave 1 privacy/PDPL lane (11/20–21) checks every procedure whose stored response holds a name and fixes them together.
- [ ] T005 [US6] Notifications' writer and delivery (FR-619, FR-620, FR-621, FR-623; R-405, R-406):
  - `modules/notifications/` `NotificationWriter.record(tx, …)` (the seven v1.0 kinds only; any other kind refused by
    type);
  - the job `jobs/deliver-notification.ts` (`pushed_at`, retries, stale tokens removed, double-run spec);
  - `account.pushToken.register` and `.remove` (identity, upsert by hash);
  - `platform/ports/push/expo.adapter.ts` with `PUSH_PROVIDER` gaining `expo` (P2 (a); built against Expo's documented
    request shape, tried on the stand-in until the owner's P2 acts), its call under `PUSH_REQUEST_TIMEOUT_MS` (a named
    constant), and `EXPO_ACCESS_TOKEN` optional in `env.schema.ts` and `.env.example` if the project turns it on;
  - the lint rule's allowed file becomes `deliver-notification.ts`;
  - i18n keys for the seven kinds' titles and bodies (phone `ar.json`/`en.json`, group `notifications`), reaching the API's generated copy through `pnpm web-copy:build` (`scripts/build-web-copy.ts`) so the server renders them in the user's language at send time, `pnpm check:generated` green.
  > **Note under T005 (B45, the owner's decisions of 2026-11-17 on B45's conflict check («الباقي تمام»; Q3: «خلي موضوع حد الاعدادات ده فالمهمات اللي هتتعمل بعد 27»; relayed by the review session), Q5 (a), Q6 (a); the check: `C:\Users\amrkn\Documents\ejazah-tools\b45\conflict-check.md`).** **Lanes E1 and E2.** E1 (after T001): the writer, the job, the `expo` member (`env.schema.ts:204`) and adapter. `PushPort.deliver` gains a separate `message: { title, body }`, the kind's fixed text in the user's `preferred_language` from the generated copy, with no placeholder (a spec asserts none of the seven has an ICU argument); `assertPushPayload` (ids only) is unchanged (`push.port.ts`, `fake.adapter.ts` and its spec, rule d; R-HONEST-5's dated note in the constitution). E2 (after T004 merges): `account.pushToken.register` and `.remove`, `contracts/src/account.ts`, `notifications.push` in both phone catalogues (placed between `markAllRead` and `teacher`), `scripts/build-web-copy.ts`'s `WEB_COPY_KEYS` and its generated `platform/web/i18n/{ar,en}.ts`. Already true on `d5f6a136`, recorded in the Done line with no edit: the lint rule's allowed file is `deliver-notification` (`no-push-outside-job.js:16-18, 71`), and `EXPO_ACCESS_TOKEN` is optional (`env.schema.ts:228`, `.env.example:86`).
  > **Follow-up under T005 (B45 lane E1, 2026-11-17; the owner's Q12 (a): «أ تمام», «وضح السابقة دي في المتابعة عشان لما تتعمل»): a notification whose after-commit enqueue is lost is never sent.** `NotificationWriter.record` (`apps/api/src/modules/notifications/notification-writer.ts:102`, the enqueue queued at `:129`) queues `deliver-notification` on the transaction's after-commit list; a crash between the commit and the enqueue leaves the row with `pushed_at` NULL and no job. Built in B48 with T017's `send-reminder` sweep: each run re-enqueues the unpushed rows (`pushed_at IS NULL`) older than a few minutes under job id = the notification's id, up to a maximum age after which a row is no longer sent (no reminder for a finished session); both numbers are settings. Precedent: payments' recovery of a lost enqueue, `apps/api/src/jobs/expire-pending-payments.ts:18`, `apps/api/src/modules/payments/order-events.service.ts:28-29`, `docs/ARCHITECTURE.md:421-422` (PR #109's review, amended 2026-11-01). Not built in B45.
  > **Follow-up under T005 (B45 lane E1, 2026-11-17; accepted by the review session for v1.0's single worker): Expo's receipts are held in the worker's memory.** `apps/api/src/platform/ports/push/expo.adapter.ts` keeps each ticket for its receipt in the process, at most `MAX_HELD_TICKETS` (`:51`), the oldest dropped. A restart, the bound or a second worker process loses held receipts; those tokens are left to `purge-stale-push-tokens`. Tied to the Not scheduled multi-process condition (`specs/004-sessions/tasks.md:720` (1); research R-324, `specs/004-sessions/research.md:1358-1361`): before a second worker or API process, the held tickets move to a shared store (Redis) or a table. Not built in B45.

## Phase 2: US1 and US2 — the ijazah request, its issue and its rendering (B46)

- [ ] T006 [US1] The request (FR-603, FR-608, FR-627, FR-628; R-403, R-404; P4 (a), DEC-72):
  - `modules/certification/` `ijazah-request.service.ts` and `.repository.ts`;
  - `teacher.ijazahRequests.preview`, `.send` (idempotent, `rate_limit_ijazah_request`), `.get`;
  - every refusal of FR-603, `already_issued` included (one ijazah per enrollment until a revocation, read under the
    enrollment's lock), each red first and logged with ids and its reason;
  - the freeze at send: the chain from catalog's entry (generations, origin first, the teacher appended), the holder
    name, a copy of the signature under `ijazah-requests/<id>/`;
  - an administrator's correction of an approved credential (`credentials.correct`, `modules/catalog/credentials-admin.router.ts:93`, writing at `credential-review.repository.ts:170-180`) re-freezes the chain and the holder name of that credential's open requests on the same transaction (P4 (a)), and the snapshot of its approved ijazahs not yet signed off, each re-rendered (DEC-72, T032). Certification imports catalog, so catalog never imports certification: catalog's correction service takes a port `OpenRequestsRefreeze` (`refreeze(tx, credentialId)`), handed in by `main.ts` and bound to certification's entry, as the dependencies against the arrows are (`docs/ARCHITECTURE.md:197`);
  - the request stays open through any later change of the teacher's standing (a deletion cannot happen meanwhile, T031);
  - a student's deletion closes it and erases its copy;
  - the enrollment reads gain `ijazahRequest`;
  - live event `ijazahRequest`;
  - a lock row in `specs/004-sessions/contracts/kernel.md` (the enrollment, then the request);
  - adversarial registrations.
- [ ] T007 [US1] The administrators' review (FR-604, FR-605; R-402):
  - `ijazahRequests.list`, `.get` (with the teacher's current standing and its reason, FR-628), `.approve` (one
    transaction: the `ijazahs` row with number and token from `platform/guards/identifiers.ts`, the token hashed, the
    frozen chain and names, the student's printed name read now; the request `approved`; `render-certificate`
    enqueued after commit), `.reject` (a reason; the copy erased);
  - audited;
  - `rate_limit_ijazah_decision`;
  - idempotent under a replay.
- [ ] T008 [US2] The certificate's rendering (FR-606; R-401; P1 (a)):
  - `modules/certification/template/` (the v2 Typst template of ADR 0004 D2, Amiri 1.003 vendored, the case as a JSON
    data file, never `eval`);
  - `jobs/render-certificate.ts` (the CLI from `TYPST_BIN`; the PDF to storage; `rendered_at` for the payload's
    `render_generation`, an older generation writing nothing; double-run spec);
  - a template spec over chains of 1, 25, 60 (one page) and 61 (two pages) generations, a multi-name generation, both
    languages, a name holding Typst markup printed as text;
  - the render runs through `apps/api/src/platform/typst/run-typst.ts`, which names `CERTIFICATE_RENDER_TIMEOUT_MS`
    once with its reason (R-MONEY-12's exception) and kills a render past it, with a spec;
  - CI installs the pinned binary in a step that checks its SHA-256 (`.github/workflows/ci.yml`, on the owner's word);
    the production image does the same.
- [ ] T009 [P] [US1] The parties' certificates (FR-607, FR-609; R-412; D1 (a)):
  - `certificates.list` and `.link` (the two parties only, else NOT_FOUND; `not_ready` until signed off; `revoked`
    after a revocation, with no link, R-HONEST-6);
  - the student's public credentials list only the signed-off and unrevoked (FR-IJAZAH-4);
  - adversarial registrations.
- [ ] T010 [P] [US3] Revocation and the bar (FR-609, FR-610; R-412): `ijazahs.list`, `.get`, `.revoke`, `.bar`,
  `.liftBar`, audited, idempotent, `rate_limit_ijazah_decision`. A revoked ijazah never deleted (the init migration's
  revoked DELETE) and never shown valid (R-HONEST-6, a spec on each surface). `ijazahs.get` gives the administrator a
  signed link to the PDF, each opening audited.
- [ ] T032 [US1] The certificate's sign-off (FR-629; R-402, R-403; the owner's addition to P1, DEC-72):
  - `ijazahs.signOff` (`signed_off_at`, `signed_off_by_admin_id`; refused `not_rendered`, `revoked`,
    `already_signed_off`) and `ijazahs.rerender` (a reason; `render_generation` + 1, `rendered_at` cleared, the job
    enqueued after commit; refused once signed off or revoked), audited, idempotent, `rate_limit_ijazah_decision`;
  - before the sign-off, T006's chain re-freeze and T004's certificate-name change re-freeze the ijazah's snapshot or
    printed student name and re-render it, on their transactions (through `OpenRequestsRefreeze` and
    `AwaitingNameRelease`);
  - the live event `ijazahRequest` at the sign-off;
  - specs: the parties' `not_ready` until the sign-off (red first), a re-render's older job writing nothing, a
    correction after the sign-off changing nothing (SC-604).

## Phase 3: US4 and US5 — reports and gender (B47)

- [ ] T011 [US4] Reports (FR-611, FR-612, FR-613; R-408):
  - `modules/moderation/` `user-report.service.ts` and `.repository.ts`;
  - `reports.create` (user; contexts session, chat (with its `enrollmentId`), profile; NOT_FOUND for a profile not
    visible, R-GENDER-2, and for a session or chat that is not the caller's; for a session or chat report,
    `reportedUserId` must equal the port's `counterpartUserId`, else NOT_FOUND; `self`, `open_exists`;
    `rate_limit_user_report`); every session and chat report stores `enrollment_id`, set by the server;
  - the `Pairings` port (R-408): declared in `modules/moderation/`, bound in `main.ts` to sessions' entry
    (`partyOfSession`) and booking's (`partyOfEnrollment`, `paired`); moderation imports neither;
  - `reports.list`, `.get`, `.resolve` (admin, audited);
  - adversarial registrations.
  - an adversarial case: a party of a session reports, from that session, a non-party user of the other gender, and
    gets NOT_FOUND (#143 r3, Saif's Minor 1).
- [ ] T012 [P] [US4] Chat retention honours an open report (FR-492, FR-SESS-13): moderation's
  `enrollmentsWithOpenMatterAmong` (`modules/moderation/open-matters.repository.ts`) also answers an enrollment with an
  open `user_reports` row on one of its sessions or its chat, read through `user_reports.enrollment_id` (moderation's
  own table); `purge-chat`'s spec gains the case, its double-run kept.
- [ ] T013 [US5] Gender flags and their queue (FR-613, FR-614, FR-615, FR-618; R-409):
  - `genderFlags.raise` (user: a user the caller is paired with (`Pairings.paired`, a soft-deleted enrollment not counted) or can see, else NOT_FOUND;
    `open_exists`;
    `rate_limit_gender_flag`; the reason stored);
  - admin `genderFlags.raise` (from a report, its `report_id` stored, or alone), `.list`, `.get`, `.dismiss`, each
    administrator mutation under `rate_limit_gender_decision`; `.get`'s list of the enrollments a correction would
    end is composed in `modules/admin/gender-decisions.service.ts` from booking's entry (R-409), so `.get` is served by the admin module's router, beside `.correct` and `.fraudBan` (moderation cannot import booking);
  - a CI test asserting no procedure on either router changes one's own gender (R-GENDER-6);
  - adversarial registrations.
- [ ] T014 [US5] The correction (FR-616, FR-617, FR-GENDER-7; R-409):
  - `genderFlags.correct`, composed in `modules/admin/gender-decisions.service.ts` (R-409; moderation imports neither
    booking nor sessions): identity changes `users.gender` (the admin path only);
  - booking cancels each enrollment that now pairs two genders with `gender_correction`, its remaining sessions
    `cancelled_by_admin` (through `EnrollmentSide`);
  - moderation opens one `gender_correction` case per enrollment, the reason added to `COMPENSATION_REASONS` with an
    ERD changelog line, and to the contract enum `compensationCaseReason`
    (`packages/contracts/src/admin/sessions.ts`) at its end (R-API-9);
  - the restore refuses them (DEC-69);
  - `sessions.restore` gains a step-3 cause: a pairing whose two declared genders differ is refused `gender_mismatch`,
    whatever closed it (`sessions/restore.service.ts:528-537`), red first, with an adversarial case;
    `gender_mismatch` joins the contract enum `restoreRefusalCause` (`packages/contracts/src/admin/sessions.ts`) at its
    end (R-API-9), the contract snapshot regenerated;
  - locks: the user, then the enrollments in id order, a `specs/004-sessions/contracts/kernel.md` row;
  - the live `account` and `enrollment` events;
  - one transaction, idempotent, audited, `rate_limit_gender_decision`;
  - a db-integrity race probe against `sessions.restore`.
  > **Follow-up (T057 r1, Saif, 2026-11-16): a correction of an enrollment awaiting payment.** «One compensation case
  > per enrollment» would open a case where nothing was paid, and FR-DISPUTE-5's late-paid list does not name
  > `gender_correction`, so a payment landing after the cancellation follows no named path. To settle when T014 is
  > built: which statuses T014 ends; a `pending_payment` hold released with no case, and a late paid event taking the
  > existing `party_restricted` case.
- [ ] T015 [US5] The fraud ban (FR-617, FR-GENDER-6; R-409):
  - `genderFlags.fraudBan`, composed in `modules/admin/gender-decisions.service.ts`: identity sets `users.gender` to the
    established gender (the correction's administrators' path, without its closings), then `StandingService`'s ban
    (teacher or student) with its existing closings, on one transaction;
  - the counterparties' cases keep the ban's own reasons (`student_banned`, `teacher_ended`), so `kindsOf`
    (`sessions/restore-window.ts`), `END_REASONS` (`sessions/case-queue.service.ts`) and `KIND_OF`
    (`sessions/ban-lift.service.ts`) stay unchanged; the fraud is recorded on the flag (`fraud_ban`) and in the audit;
  - the ban's lift (`students.liftBan`, `teachers.liftBan`) refuses each pairing the corrected genders forbid (DEC-69),
    red first: before the correction step the check passes vacuously, which is the mutant;
  - audited, idempotent, `rate_limit_gender_decision`.
- [ ] T031 [US1] A teacher's deletion waits for their requests and enrollments, and keeps the signature (FR-630,
  FR-631; R-411, R-414; DEC-72):
  - identity's own deletion (`modules/identity/deletion.service.ts`, app and web) asks a port `OpenIjazahRequests`
    (`count(tx, teacherUserId)`), handed in by `main.ts` and bound to certification's entry as `OngoingEnrollments` is
    bound to booking; a count above zero refuses `CONFLICT` `pending_ijazah_requests`, writing nothing, one info line
    of ids;
  - `users.delete` of a teacher asks the count of enrollments `pending_payment` or `confirmed` (paused included)
    through a new method `live(tx, userId)` of identity's `OngoingEnrollments` port (bound to booking), the same request
    count, and the count of open compensation cases on the teacher's enrollments through a new identity port
    `OpenCases` (`count(tx, teacherUserId)`), bound by `main.ts` to moderation's entry (identity imports no module),
    refusing `active_enrollments`, `pending_ijazah_requests` or `open_cases`; a student's unchanged; `004:T081`'s
    ending of a teacher's enrollments is then reached only by held ones whose case is already closed;
  - the kept signature: `modules/verification/kept-data.service.ts` lists it, opens it by a signed link with a reason,
    and removes its file at the erasure (date or now); a teacher never approved has it erased at deletion; the head
    comment of `kept-data.service.ts` corrected with it (`004:T077`'s follow-up);
  - the phone's deletion refusal text for the new cause (`ar.json`, `en.json`, `002:T123`'s marks);
  - specs red first: each refusal on each path, a student's administrator deletion unchanged, the signature kept and
    then erased.
  - Its Done line says it carried `004:T077`'s follow-up (the head comment).
  - v1.0 note, the privacy policy: `004:T078`'s line (Phase 6, counsel, OPEN-05) names the kept signature beside the
    identity, credential and payout documents (DEC-72 (5); NFR-COMP-2 as amended).
  > **Follow-up (T057 r1, Saif, 2026-11-16): a teacher stays bookable while an administrator works towards a
  > deletion.** While the administrator ends a teacher's enrollments and resolves their cases before a deletion (R-414),
  > nothing stops new bookings of that teacher. To settle when T031 is built: how the teacher stops being bookable
  > meanwhile (for example a suspension first, which pauses and hides).

## Phase 4: US6 — push producers and reminders (B48)

- [ ] T016 [US6] The cancellation and payment producers (FR-619; DEC-70, DEC-71):
  - sessions' cancellation request service records `cancellation_requested` to the other party, and the answer
    service `cancellation_request_accepted` or `_declined` to the requester, on their transactions;
  - payments' order-events record `payment_confirmed`, `payment_failed`, `payment_expired` to the student from
    Phase 2's durable records, one per order outcome; on the confirmation's transaction the writer never refuses (no
    limit, the kind fixed by its type), so a paid confirmation never rolls back because of a notification;
  - specs: no notification for an expired request, none twice for one order.
- [ ] T017 [P] [US6] Reminders (FR-619, FR-622, FR-BOOK-8; R-407):
  - `jobs/send-reminder.ts`, a sweep each minute over `reminder_offsets_minutes`;
  - `session_reminders` keeps it once per (session, user, offset);
  - sessions no longer scheduled skipped;
  - a recomputed start honoured (a spec moving a session's instants, the hook comment at
    `jobs/reresolve-session-instants.ts:181-182` reworded);
  - double-run spec.
  > **Pointer (the owner's Q12 (a), 2026-11-17, on B45 lane E1's gap; written by the integration):** the sweep also re-enqueues the notifications whose after-commit enqueue was lost (`pushed_at IS NULL`, older than a few minutes, up to a maximum age; both numbers are settings; job id = the notification's id). See the follow-up under T005, which names payments' precedent. Built here, in B48, not in B45.
- [ ] T018 [US6] Time (FR-622; R-TIME): the reminder's window computed from instants, never wall-clock local times; a spec
  across Cairo's DST change for each offset.

## Phase 5: Screens (B48, B49)

- [ ] T019 [P] [US1] The teacher's phone (FR-601, FR-603, FR-608):
  - the signature screen;
  - on `TeacherEnrollment.tsx` (`features/teacher/students/screens/`) the request sheet (the preview, completion
    date, language) and the request's status (pending, awaiting the student's name, issued with the certificate,
    rejected with the reason), refreshed by the live event;
  - i18n in both languages (`002:T123`'s marks);
  - specs.
- [ ] T020 [P] [US1] [US6] The student's phone (FR-602, FR-607, FR-608, FR-623):
  - the certificate-name sheet;
  - the certificates list and viewer (a revoked one marked);
  - the request's status on `EnrollmentDetail.tsx`;
  - the push permission asked after the first confirmed booking or on the enrollment screen, and the token registered
    (P2 (a); built behind the stand-in until the package exists);
  - specs.
- [ ] T021 [P] [US4] [US5] The report and flag sheets (FR-611, FR-614): from a session, the chat and a profile, both
  roles; the reason field; «received» only; specs.
- [ ] T022 [P] [US1] [US3] The panel's ijazah pages (FR-604, FR-609, FR-610, FR-629):
  - `apps/admin/src/pages/ijazah-requests/` (queue, detail with the frozen certificate preview and the teacher's
    standing, approve and reject dialogs);
  - `pages/ijazahs/` (list with «waiting for sign-off» first, the rendered PDF, sign-off and re-render, revoke, bar);
  - nav entries; the existing i18n sections (`ijazahRequests`, `ijazahs`);
  - specs.
- [ ] T023 [P] [US4] [US5] The panel's reports and gender pages (FR-612, FR-615 to FR-617): `pages/reports/` and
  `pages/gender/`, the correction dialog showing the enrollments it ends and that they cannot be restored, the fraud
  dialog; existing i18n; specs.
- [ ] T024 [P] [US7] The panel's settings page (FR-624; R-410): `settings.list` and `.update` (admin, a reason,
  `rate_limit_settings_update`, audited before and after) and `pages/settings/` grouped by the registry, from the
  existing i18n catalogue; specs. A light item: built by whichever track the owner names.

## Phase 6: Proofs and the close (B49)

- [ ] T025 The adversarial suite's reach for Phase 4 (FR-625): `certificates`, `reports` and `genderFlags` join
  `ATTACKED_ROUTERS` (`tests/adversarial/procedure-harness.ts`), so none can be exempt. Every new user procedure is
  registered in both directions. The declared limits of T001's six keys join T052's check.
- [ ] T026 The close (FR-619, FR-625; SC-601, SC-606): `docs/ARCHITECTURE.md` §4 gains plan.md's Phase 4 graph and its five ports with their bindings; quickstart.md §1 to §5 on the last batch's commit, each output in its own file; SC-606 measured on the stand-in (from cause to the provider, 100 attempts) and SC-601 timed by hand on the phone run; the phone steps
  joined to the next phone run; `PLAN.md`'s Phase 4 section given its close date.

---

## v1.1, the first update (SRS DEC-70; untimed)

- [ ] T027 Ratings and reviews (FR-REVIEW-1…5, FR-ADMIN-11).
- [ ] T028 The public verification page and the certificate's QR code (FR-IJAZAH-10; FR-IJAZAH-8's endpoint): the
  page by token (ADR 0021 D5), and the QR added to new certificates and re-rendered onto v1.0's (the token minted at
  their issue, R-402).
- [ ] T029 The notification centre (FR-NOTIF-2), with the enum migration of ADR 0021's 12 and Phase 3's 15 names.
- [ ] T030 Every other push kind of FR-NOTIF-1, among them `ijazah_granted` and the request's rejection (the owner's
  answer C1 of 2026-11-16), the teacher application's status, the credential's review and the payout account's;
  `makeup_offered_again` read as a session's second or later `remedy_offered` row (T057; the owner's decision of
  2026-11-06, A2).

---

## Dependencies and Execution Order

- **B45:** T001 first (the schema). T002, T003 and T004 in parallel lanes. T005 after T001 and T004 (both write
  `identity/account.router.ts` and `packages/contracts/src/account.ts`).
- **B46:** T006 after T003 and T004. T007 after T006. T008 after T007's enqueue; it can be written in parallel on its
  own files. T009 and T010 after T007. T032 after T007, T008 and T010 (T010 and T032 write the same `ijazahs.*` router
  and contracts).
- **B47:** T011, then T012. T013 after T011 (the `Pairings` port and booking's and sessions' new entries), then T014, then T015 (the shared flag service and the admin module's gender
  decisions). T031 after T006 (its request count).
- **B48:** T016 and T017 after T005. T018 with T017. T019 to T021 after their procedures.
- **B49:** T022 to T024 after their procedures. T025 after every procedure. T026 last.
- **Two tracks:** this file is track 1's (`tracks-coordination.md` §2). T024 is a light item.

## Batches

| Day | Batch | Tasks | What |
|---|---|---|---|
| Mon 11/17 | B45 | T001, T002, T003, T004, T005 | Migration and seed, settings registry, signature, certificate name, notifications writer and delivery |
| Mon–Tue 11/17–18 | B46 | T006, T007, T008, T009, T010, T032 | The request and its freeze, the review and issue, the rendering, the parties' certificates, revocation and the bar, the sign-off |
| Tue 11/18 | B47 | T011, T012, T013, T014, T015, T031 | Reports, chat retention, gender flags, the correction, the fraud ban, a teacher's deletion refusals and the kept signature |
| Tue–Wed 11/18–19 | B48 | T016, T017, T018, T019, T020, T021 | Push producers, reminders, their time spec, the phone screens |
| Wed 11/19 | B49 | T022, T023, T024, T025, T026 | The panel's pages, the adversarial reach, the close |
| v1.1 | — | T027 to T030 | The first update (DEC-70) |
