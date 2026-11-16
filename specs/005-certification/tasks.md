---
description: 'Task list for Phase 4 — Certification, reports and notifications (lightened)'
---

# Tasks: Phase 4 — Certification, reports and notifications (lightened)

**Input**: Design documents from `/specs/005-certification/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The owner's lighter gates of 2026-11-15 (PLAN.md, «How a phase is run», as amended on
2026-11-16) set the rigour:
- **Full TDD** (each spec red first on its own, negatives red under a named mutant, every mutant restored and
  `cmp`-checked) for gender, security and time: T004, T006, T007, T009, T010, T011, T013, T014, T015, T016, T018.
- **Lighter specs** (a render or behaviour spec per screen, in Arabic and English) for T019 to T024.
- Every job has its double-run spec (R-API-14). Every new user procedure is in the adversarial harness both ways, or
  exempt with its reason (T025).
- DB specs run on `ijazah_integrity` only.

**Organization**: The foundations, then the stories of spec.md in priority order, then the screens and the proofs,
in the batches B45 to B49 (B44 is `004:T068`'s logo build). Then «v1.1, the first update»: tasks listed and untimed
(SRS DEC-70).

**Open owner questions** (`ejazah-tools\b43\t057-plan-questions.md`):
- P1 (the renderer) blocks T008;
- P2 (push) blocks T005's real adapter and T020's push permission (both build on the stand-in until then);
- P3 and P4 (DEC-72) block T006's freeze and T007's erasure.

The recommended options are written in place.

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

- [ ] T001 The migration and the seed (data-model.md):
  - a forward migration (timestamp of the real time of writing) adding:
    - `ijazah_requests`, with `ijazah_request_status`, its checks and the partial unique on open requests;
    - on `ijazahs`: `request_id` (unique FK), `issued_by_admin_id`, `student_name_printed`, `teacher_name_printed`,
      `completion_date`, `rendered_at`;
    - `session_reminders`;
    - the partial uniques on open `user_reports` and open `gender_flags`, and `user_reports`' two checks;
    - `compensation_case_reason` members `gender_correction` and `gender_fraud`, at the enum's end.
  - Before it runs, a SELECT shows `ijazahs`, `user_reports` and `gender_flags` hold no row (the NOT NULLs need none).
  - `prisma/schema/{certification,notifications,moderation,base}.prisma`.
  - `prisma/seed.ts`: a new block at the settings list's end with the six rate limits of data-model.md.
  - `tests/seed/seed.spec.ts` (rule d).
  - `docs/ERD.md`: a dated block at its end, and the notifications note re-pointed to v1.1 (R-406).
  - The SRS's §3.14 rows for the four limits beyond DEC-71's two, in the next free track 1 DEC (DEC-73 if P3 takes
    DEC-72), placed after DEC-71's rows.
  - A migration spec red under a mutant migration.
- [ ] T002 [P] The settings registry (R-410): `apps/api/src/platform/settings/registry.ts`, every §3.14 key with its
  zod schema, bounds, unit, group and SRS row. A CI spec asserts registry keys = seed keys, both ways, and every
  default is inside its bounds. The admin module's settings repository gains its one writer (`update(key, value)`,
  R-PROC-11 as amended here).
- [ ] T003 [P] [US1] The teacher's signature (FR-601, FR-IJAZAH-12; R-411):
  - upload kind `signature` (PNG or JPEG) in `platform/guards/upload.middleware.ts`;
  - `POST /uploads/signature` (teacher, `approved`) on `surfaces/upload-route.ts`;
  - catalog's `teacher-signature.repository.ts` and `.service.ts` (one current row, replaced on upload, the old file
    erased after commit);
  - `teacher.signature.get` (a signed link);
  - specs: a renamed image refused (R-SEC-4), an applicant refused, the replace path.
- [ ] T004 [P] [US1] The certificate name (FR-602; ADR 0019 D1):
  - `account.certificateName.set` (student, once; `already_set` after), in identity;
  - `users.setCertificateName` (admin, a reason, audited with no name in the entry);
  - setting it moves an `awaiting_student_name` request to `pending` through certification's entry, or the
    certification module reads it at the moment (the order fixed by T006's design, one transaction);
  - specs, including an admin change never rewriting an issued certificate.
- [ ] T005 [US6] Notifications' writer and delivery (FR-619, FR-620, FR-621, FR-623; R-405, R-406):
  - `modules/notifications/` `NotificationWriter.record(tx, …)` (the seven v1.0 kinds only; any other kind refused by
    type);
  - the job `jobs/deliver-notification.ts` (`pushed_at`, retries, stale tokens removed, double-run spec);
  - `account.pushToken.register` and `.remove` (identity, upsert by hash);
  - `platform/ports/push/expo.adapter.ts` with `PUSH_PROVIDER` gaining `expo` (P2 (a); built against Expo's documented
    request shape, tried on the stand-in until the owner's P2 acts);
  - the lint rule's allowed file becomes `deliver-notification.ts`;
  - i18n keys for the seven kinds' titles and bodies (phone `ar.json`/`en.json`, group `notifications`).

## Phase 2: US1 and US2 — the ijazah request, its issue and its rendering (B46)

- [ ] T006 [US1] The request (FR-603, FR-608, FR-627, FR-628; R-403, R-404; P3 (a), P4 (a)):
  - `modules/certification/` `ijazah-request.service.ts` and `.repository.ts`;
  - `teacher.ijazahRequests.preview`, `.send` (idempotent), `.get`;
  - every refusal of FR-603, each red first and logged with ids and its reason;
  - the freeze at send: the chain from catalog's entry (generations, origin first, the teacher appended), the holder
    name, a copy of the signature under `ijazah-requests/<id>/`;
  - catalog's chain correction (FR-ISNAD-4) re-freezes the chain of that credential's open requests on the same
    transaction (P4 (a));
  - the request stays open through any later change of the teacher's standing;
  - a student's deletion closes it and erases its copy;
  - the enrollment reads gain `ijazahRequest`;
  - live event `ijazahRequest`;
  - a lock row in `specs/004-sessions/contracts/kernel.md`'s successor for this phase (the enrollment, then the
    request);
  - adversarial registrations.
- [ ] T007 [US1] The administrators' review (FR-604, FR-605; R-402):
  - `ijazahRequests.list`, `.get` (with the teacher's current standing and its reason, FR-628), `.approve` (one
    transaction: the `ijazahs` row with number and token from `platform/guards/identifiers.ts`, the token hashed, the
    frozen chain and names, the student's printed name read now; the request `approved`; `render-certificate`
    enqueued after commit), `.reject` (a reason; the copy erased);
  - audited;
  - `rate_limit_ijazah_decision`;
  - idempotent under a replay.
  - With P3 (a): identity's deletion erases the live `teacher_signatures` row and file (closing the gap at
    `identity/identity.repository.ts:428-462`; a request's own copy untouched), with its spec.
- [ ] T008 [US2] The certificate's rendering (FR-606; R-401; P1 (a)):
  - `modules/certification/template/` (the v2 Typst template of ADR 0004 D2, Amiri 1.003 vendored, the case as a JSON
    data file, never `eval`);
  - `jobs/render-certificate.ts` (the CLI from `TYPST_BIN`; the PDF to storage; `rendered_at`; double-run spec);
  - a template spec over chains of 1, 25, 60 (one page) and 61 (two pages) generations, a multi-name generation, both
    languages, a name holding Typst markup printed as text;
  - CI installs the pinned binary in a step (`.github/workflows/ci.yml`, on the owner's word).
- [ ] T009 [P] [US1] The parties' certificates (FR-607; R-412):
  - `certificates.list` and `.link` (the two parties only, else NOT_FOUND; `not_ready` until rendered; a revoked one
    still served, flagged);
  - the student's public credentials list only the unrevoked (FR-IJAZAH-4);
  - adversarial registrations.
- [ ] T010 [P] [US3] Revocation and the bar (FR-609, FR-610; R-412): `ijazahs.list`, `.get`, `.revoke`, `.bar`,
  `.liftBar`, audited, idempotent, `rate_limit_ijazah_decision`. A revoked ijazah never deleted (the init migration's
  revoked DELETE) and never shown valid (R-HONEST-6, a spec on each surface).

## Phase 3: US4 and US5 — reports and gender (B47)

- [ ] T011 [US4] Reports (FR-611, FR-612, FR-613; R-408):
  - `modules/moderation/` `user-report.service.ts` and `.repository.ts`;
  - `reports.create` (user; contexts session, chat, profile; NOT_FOUND for a profile not visible, R-GENDER-2; `self`,
    `open_exists`; `rate_limit_user_report`);
  - `reports.list`, `.get`, `.resolve` (admin, audited);
  - adversarial registrations.
- [ ] T012 [P] [US4] Chat retention honours an open report (FR-492, FR-SESS-13): moderation's
  `enrollmentsWithOpenMatterAmong` (`modules/moderation/open-matters.repository.ts`) also answers an enrollment with an
  open `user_reports` row on one of its sessions or its chat; `purge-chat`'s spec gains the case, its double-run kept.
- [ ] T013 [US5] Gender flags and their queue (FR-614, FR-615, FR-618; R-409):
  - `genderFlags.raise` (user: a user the caller is paired with or can see, else NOT_FOUND; `open_exists`;
    `rate_limit_gender_flag`);
  - admin `genderFlags.raise` (from a report or alone), `.list`, `.get` (the enrollments a correction would end),
    `.dismiss`;
  - a CI test asserting no procedure on either router changes one's own gender (R-GENDER-6);
  - adversarial registrations.
- [ ] T014 [US5] The correction (FR-616, FR-GENDER-7; R-409):
  - `genderFlags.correct`: identity changes `users.gender` (the admin path only);
  - booking cancels each enrollment that now pairs two genders with `gender_correction`, its remaining sessions
    `cancelled_by_admin` (through `EnrollmentSide`);
  - moderation opens one `gender_correction` case per enrollment;
  - the restore refuses them (DEC-69);
  - locks: the user, then the enrollments in id order, a `kernel.md` row;
  - the live `account` and `enrollment` events;
  - one transaction, idempotent, audited;
  - a db-integrity race probe against `sessions.restore`.
- [ ] T015 [US5] The fraud ban (FR-617, FR-GENDER-6; R-409):
  - `genderFlags.fraudBan`: `StandingService`'s ban (teacher or student), its existing closings;
  - the counterparties' cases under `gender_fraud`;
  - the flag `fraud_ban`;
  - the ban's lift (`students.liftBan`, `teachers.liftBan`) checks each pairing when the ban came from a flag
    (DEC-69), red first;
  - audited, idempotent.

## Phase 4: US6 — push producers and reminders (B48)

- [ ] T016 [US6] The cancellation and payment producers (FR-619; DEC-70, DEC-71):
  - sessions' cancellation request service records `cancellation_requested` to the other party, and the answer
    service `cancellation_request_accepted` or `_declined` to the requester, on their transactions;
  - payments' order-events record `payment_confirmed`, `payment_failed`, `payment_expired` to the student from
    Phase 2's durable records, one per order outcome;
  - specs: no notification for an expired request, none twice for one order.
- [ ] T017 [P] [US6] Reminders (FR-619, FR-622, FR-BOOK-8; R-407):
  - `jobs/send-reminder.ts`, a sweep each minute over `reminder_offsets_minutes`;
  - `session_reminders` keeps it once per (session, user, offset);
  - sessions no longer scheduled skipped;
  - a recomputed start honoured (a spec moving a session's instants, the hook comment at
    `jobs/reresolve-session-instants.ts:181-182` reworded);
  - double-run spec.
- [ ] T018 [US6] Time (R-TIME): the reminder's window computed from instants, never wall-clock local times; a spec
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
- [ ] T022 [P] [US1] [US3] The panel's ijazah pages (FR-604, FR-609, FR-610):
  - `apps/admin/src/pages/ijazah-requests/` (queue, detail with the frozen certificate preview and the teacher's
    standing, approve and reject dialogs);
  - `pages/ijazahs/` (list, revoke, bar);
  - nav entries; the existing i18n sections (`ijazahRequests`, `ijazahs`);
  - specs.
- [ ] T023 [P] [US4] [US5] The panel's reports and gender pages (FR-612, FR-615 to FR-617): `pages/reports/` and
  `pages/gender/`, the correction dialog showing the enrollments it ends and that they cannot be restored, the fraud
  dialog; existing i18n; specs.
- [ ] T024 [P] [US7] The panel's settings page (FR-624; R-410): `settings.list` and `.update` (admin, a reason,
  `rate_limit_settings_update`, audited before and after) and `pages/settings/` grouped by the registry, from the
  existing i18n catalogue; specs. A light item: built by whichever track the owner names.

## Phase 6: Proofs and the close (B49)

- [ ] T025 The adversarial suite's reach for Phase 4: `certificates`, `reports` and `genderFlags` join
  `ATTACKED_ROUTERS` (`tests/adversarial/procedure-harness.ts`), so none can be exempt. Every new user procedure is
  registered in both directions. The declared limits of T001's six keys join T052's check.
- [ ] T026 The close: quickstart.md §1 to §5 on the last batch's commit, each output in its own file; the phone steps
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

- **B45:** T001 first (the schema). T002, T003 and T004 in parallel lanes. T005 after T001.
- **B46:** T006 after T003 and T004. T007 after T006. T008 after T007's enqueue; it can be written in parallel on its
  own files. T009 and T010 after T007.
- **B47:** T011, then T012. T013, then T014 and T015 (shared flag service).
- **B48:** T016 and T017 after T005. T018 with T017. T019 to T021 after their procedures.
- **B49:** T022 to T024 after their procedures. T025 after every procedure. T026 last.
- **Two tracks:** this file is track 1's (`tracks-coordination.md` §2). T024 is a light item.

## Batches

| Day | Batch | Tasks | What |
|---|---|---|---|
| Mon 11/17 | B45 | T001, T002, T003, T004, T005 | Migration and seed, settings registry, signature, certificate name, notifications writer and delivery |
| Mon–Tue 11/17–18 | B46 | T006, T007, T008, T009, T010 | The request and its freeze, the review and issue, the rendering, the parties' certificates, revocation and the bar |
| Tue 11/18 | B47 | T011, T012, T013, T014, T015 | Reports, chat retention, gender flags, the correction, the fraud ban |
| Tue–Wed 11/18–19 | B48 | T016, T017, T018, T019, T020, T021 | Push producers, reminders, their time spec, the phone screens |
| Wed 11/19 | B49 | T022, T023, T024, T025, T026 | The panel's pages, the adversarial reach, the close |
| v1.1 | — | T027 to T030 | The first update (DEC-70) |
