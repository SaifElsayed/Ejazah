# ADR 0021 — What the design asks of the data and the configuration: English subject names, audit target labels, the undrawn notification kinds, and the support address

**Status:** accepted (D1–D4 accepted by the owner on 2026-10-17, with the conditions written into D2, D4 and D5; D5 and D6 record decisions of 2026-10-15 and 2026-10-17 that the design already applies) · **Date:** 2026-10-17 · **Decided by:** the owner, 2026-10-17 · **Amends:** ERD §4 note on `subjects`, §11 `notifications.type`, §12 `audit_logs`; SRS FR-NOTIF-1 (lists the events by name), FR-LOC-1 (note), §3.11 FR-ADMIN-17 (note), §3.4 FR-DISC-1/2 (name search, filters), FR-BOOK-7 (the teacher's list search); ARCHITECTURE §4 (configuration, the platform row), §5 (the public pages), §7.2 (the audit writer); `.env.example` (with the Phase 2 task, see Consequences) · **Builds on:** [ADR 0020](0020-design-files-in-the-repository.md) D5/D6 (the inventory and the copy catalogue), ADR 0014 D2 (user content stays as typed on English pages), ADR 0017 and ADR 0018 (which add events to FR-NOTIF-1 without naming the enum members)

## Context

The screen inventory of 2026-10-17 (`docs/design/screens.md`, `docs/design/open-items.md`) found
four things the boards assume that neither the SRS, the ERD nor the configuration states. None is a
screen or a sentence; each is a column, an enum member or a setting, so none belongs in the copy
review or the decision sheet.

1. The English admin boards show subject names in English («Quran memorization», «Tajweed»). The
   catalogue never keys a subject name (BRIEF-PROD: subjects are `subjects.name_ar`), and the ERD
   already requires `subjects.name_en`, but nothing says that the English name is what an English
   page shows, nor that the admin's subject list must carry both.
2. The audit log renders its target as a label («طلب انضمام الشيخ ياسر حمدي», «تقييم سعيد منصور
   للشيخ أحمد المصري»). The catalogue holds these as templates (`admin.audit.targets.*`), but Arabic
   fuses the preposition with the name («للشيخ»), which an ICU template cannot produce, and a label
   rendered at read time changes when the target is renamed or deleted, which an audit entry must
   not.
3. FR-NOTIF-1 lists sixteen push events and ADR 0017 and ADR 0018 add more; the boards draw eight
   student kinds and six teacher kinds. The rest have no drawing and no copy, and the ERD enum does
   not have the members ADR 0017–0019 imply.
4. Four boards show a support e-mail address (PayoutRejected, TeacherRestricted, AccountRestricted,
   DeleteAccountWebDone). The catalogue passes it as a placeholder (`{email}`, `{supportEmail}`);
   nothing defines where the value comes from.
5. Two public web pages (certificate verification, account deletion) are drawn, and ADR 0020 left open
   where they are served.
6. Discovery searches by teacher name as well as subject, filters by rating (الكل / 5…1 فأعلى), by
   riwaya within a subject and by track, and the teacher's «طلابي» list has a search field. All of it
   was drawn and approved by the owner on 2026-10-15; FR-DISC-1/2 still say "by subject" and nothing
   gives the teacher a search.

## Decision

### D1 — The English name of a subject is data, shown on English pages

- `subjects.name_en` (already in the ERD and the Prisma schema, mandatory) is the name every
  English page shows wherever an Arabic page shows `name_ar`: the admin's English boards, the
  English phone app (`MainEn` and every English screen), the English certificate verification page.
- The admin's subject list (the future subjects page, FR-ADMIN-2) requires both names on creation;
  a subject with an empty English name cannot be saved.
- No i18n key ever holds a subject name. The two catalogue strings that embed subject names as
  examples (`student.discovery.search.hintText` «مثل: التجويد، القراءات»,
  `student.discovery.filter.riwaya` «الرواية · داخل {subject}») take their names from the subject
  list at render time: the hint lists the first two active subjects in the user's language, and the
  filter title interpolates the selected subject.
- The riwaya and tariq of a credential (ADR 0017) are transcribed once in Arabic and are shown as
  typed on English pages (ADR 0014 D2), like every other user or admin-typed value.

### D2 — The audit entry stores a non-personal target label at write time

- `audit_logs` gains `target_label text NOT NULL`: the target's kind word followed by its stable
  identifier or public number, never a person's name («طلب انضمام · {application id}», «إجازة ·
  7K3M-Q9TD-2XWB-8HRN», «بلاغ محادثة · {report id}», «حساب · {user id}»). The audit writer
  renders it in Arabic once, at write time, from `target_type` and `target_id`; nothing a user or
  an admin typed is inside it.
- The label is non-personal by construction, so it is never rewritten: ERD §15 rule 21 (no UPDATE
  on `audit_logs`) stands, and ADR 0015 D3 (deletion keeps the audit record without personal data)
  needs no exception, because the record never held any. An entry outlives a renamed or deleted
  target unchanged.
- The admin pages show the stored label and, beside it, when the target still exists, the target's
  current display name resolved at read time (a join on `target_type`/`target_id`). A deleted
  person resolves to the role word («طالب محذوف», «معلم محذوف»), since ADR 0015 erased the name.
  So the drawn audit rows, names visible, hold for live targets, and nothing personal is ever
  stored in `audit_logs`.
- English pages show the stored Arabic label, and the read-time name beside it, as typed and
  wrapped in `<bdi>` (ADR 0014 D2); the action word (`admin.audit.actions.*`) stays a key and is
  translated.
- The fused forms («للشيخ …») are produced at read time by the server-side renderer that resolves
  the name: `لـ` + a name beginning with «ال» becomes «لل…» («للشيخ أحمد المصري»), otherwise
  `لـ` + name. The same renderer serves the two other fused strings the inventory found
  (`admin.credentials.a11y.documentPage`, `admin.dialogs.mfaReset.title`), which become
  server-rendered labels too.
- `admin.audit.targets.*` leave the admin catalogue; their templates move to the renderer's Arabic
  source (the renderer owns the Arabic). `target_type` and `target_id` stay as they are (ADR 0011
  D5).
- Condition (owner, 2026-10-17): the label is a noun phrase that names the target (its kind word
  and its identifier or number) and nothing else: no action word, no free text, nothing typed by
  the admin; trivially satisfied, since no user-typed text is inside it. It is at most 200
  characters; the audit writer refuses an empty or longer one.

### D3 — Every notification kind FR-NOTIF-1 lists renders in the one drawn shape, and the enum names them all

- The notification centre has one row shape (the `Notice` feature component: icon tile, title, meta
  line, time, unread dot) and one deep link per kind. A kind without a drawing is implemented from
  the shape with its own icon, title and meta, not from a new board.
- The catalogue gets `notifications.items.<kind>.{title,meta}` for every member of
  `notifications.type`, in both languages, once the owner has reviewed the copy (a follow-up of
  `copy-review-2026-10.md`, not this ADR).
- The ERD enum `notifications.type` gains the members the accepted ADRs imply and the design draws,
  in this order after `new_review`: `makeup_proposed`, `makeup_counter_proposed`, `makeup_booked`
  (ADR 0018 D3), `certificate_name_requested` (ADR 0019 D1), `enrollment_terminated` (FR-NOSHOW-4;
  drawn on Notifications), `session_cancelled_by_admin` (FR-CANCEL-6), `session_outcome_confirmed`
  (FR-SESS-19), `ijazah_request_rejected` and `credential_reviewed` (ADR 0017 D1/D3),
  `payout_account_rejected` (FR-PAYG-15, which notifies the Teacher of the gateway's verdict on
  the payout account; `recipient_rejected` is a webhook event, not a notification),
  `account_suspended`, `account_reinstated` (FR-ADMIN-5, ADR 0018 D5).
  `teacher_application_status_changed` covers approval, rejection, ban and «مطلوب ملف آخر» with the
  status in the payload.
- The kinds and who receives them (student S, teacher T), with the drawn ones marked:

  | Kind                                                      | To   | Drawn                                         |
  | --------------------------------------------------------- | ---- | --------------------------------------------- |
  | teacher_application_status_changed                        | T    | —                                             |
  | new_booking                                               | T    | TeacherNotifications                          |
  | session_reminder                                          | S, T | both                                          |
  | no_show_recorded                                          | S, T | Notifications (teacher no-show, S); — (T)     |
  | cancellation_requested                                    | S, T | both                                          |
  | cancellation_request_accepted / declined                  | S, T | —                                             |
  | payment_confirmed                                         | S    | Notifications (two bodies)                    |
  | payment_failed / payment_expired                          | S    | —                                             |
  | payout_account_verified / payout_account_rejected         | T    | —                                             |
  | dispute_resolved                                          | S, T | both                                          |
  | gender_flag_resolved                                      | S, T | —                                             |
  | ijazah_granted                                            | S, T | both                                          |
  | ijazah_revoked                                            | S, T | —                                             |
  | new_review                                                | T    | TeacherNotifications                          |
  | makeup_proposed / makeup_counter_proposed / makeup_booked | S, T | — (the sheets are drawn, the notices are not) |
  | certificate_name_requested                                | S    | Notifications                                 |
  | enrollment_terminated                                     | S, T | Notifications (S)                             |
  | session_cancelled_by_admin                                | S, T | —                                             |
  | session_outcome_confirmed                                 | S, T | —                                             |
  | ijazah_request_rejected / credential_reviewed             | T    | —                                             |
  | account_suspended / account_reinstated                    | S, T | —                                             |

### D4 — The support address is configuration, served to the apps

- `SUPPORT_EMAIL` is a required platform setting in `env.schema.ts` (a valid address, no default;
  `.env.example` lists it), not an admin setting of §3.14 (no admin changes it from the panel) and
  not a string in either catalogue.
- The API exposes it through one unauthenticated, cacheable query (`platform.publicConfig`, with
  `.output(schema)` as every procedure) returning `{ supportEmail }`; the phone app and the public
  web pages read it at start-up and fall back to the last value they cached. The admin panel has no
  support link.
- The catalogue keeps its placeholders (`{email}` in `teacher.payout.rejected.supportNote`,
  `{supportEmail}` in `web.deleteAccount.done.confirmation`) and the `mailto:` of «تواصل مع الدعم»
  on the two restricted screens is built from the same value. A support address change is a
  configuration change, not a release.
- Condition (owner, 2026-10-17): the query is a `publicProcedure`, so it declares its rate limit as
  every anonymous endpoint must (T170); the apps cache the value and never block start-up on it.
  The address is never editable from the admin panel: an admin account that is taken over must not
  be able to point users at another mailbox.

### D5 — The public web pages are served by the API (decided 2026-10-17)

- The certificate verification page (`/verify/:code`, with `?lang=en` for English) and the account
  deletion page (`/delete-account`, its code step and its done step) are server-rendered pages of the
  API on its own origin, drawn with the design's stylesheet. No separate deploy, no public routes in
  the admin SPA, no paid hosting before launch; the signed PDF URLs and the deletion code come from
  the same service.
- An unknown or malformed code answers HTTP 404 with the VerifyCertificateNotFound page; a revoked
  ijazah answers 200 with the VerifyCertificateRevoked page (FR-IJAZAH-8: validity, revocation status
  and the public reason).
- Conditions (owner, 2026-10-17): the pages live under their own paths of the API, never mixed
  with the procedure routes; they send a strict `Content-Security-Policy` and the full header set
  and CORS allowlist of NFR-SEC-11 / DEC-51 (SRS §NFR-SEC-11), and set no cookie; they are
  rendered from templates that escape every value by default (a name, a code, a reason are
  untrusted data); and they run under the same rate limits as the anonymous procedures. The Terms
  body (decision sheet row 17) is served the same way, with the version FR-AUTH-11 records in
  `terms_acceptances`. Moving the pages to a static site later is a relocation of templates, not a
  redesign.

### D6 — Discovery search and filters, and the teacher's student search, as drawn (decided 2026-10-15)

- FR-DISC-1 gains: search by teacher name (prefix match on the display name, the match highlighted)
  as well as by subject; filters by track (ADR 0018 D1), by minimum rating (الكل, then 5…1 stars and
  up, FR-REVIEW-3) and, when the selected subject has riwayas on the approved credentials, by riwaya.
  The filter dropdown closes on apply or on the trigger; the applied chips are removable one by one.
- FR-DISC-3 is unchanged: every result shares the student's gender, enforced at the query layer; a
  name search never returns an incompatible teacher.
- FR-BOOK-7 gains, on the teacher's side: the «طلابي» list is searchable by the student's name, in
  the active and ended tabs.
- The subject-section tabs show counts (the number of visible teachers per subject, computed
  after the visibility predicate, R-GENDER-3).

## Consequences (applied 2026-10-17)

- **ERD.**
  - §4 `subjects`: a note on `name_en` (D1: the English display name; required on creation).
  - §11 `notifications.type`: the twelve members of D3, appended in the stated order; a forward
    migration in the Phase 2 notifications pass.
  - §12 `audit_logs`: `target_label text NOT NULL` (D2), non-personal: the kind word and the
    identifier or number, never a name, so §15 rule 21 is untouched; a forward migration before
    the first admin action is written (the table holds no row). The changelog gains a "v1.3
    addendum (ADR 0021)" block.
- **SRS.**
  - FR-LOC-1: a note that subject names are data with two mandatory names, never translations in
    the app.
  - FR-ADMIN-17: the entry records the target's non-personal label (kind word and identifier) at
    the time of the action.
  - FR-NOTIF-1: the events listed by the enum member names of D3, so the requirement and the ERD
    say the same list (ADR 0017 and ADR 0018 added events in prose).
  - §3.14: nothing; the support address is not an admin setting.
  - FR-DISC-1/2 and FR-BOOK-7: the text of D6.
- **ARCHITECTURE.** §4 (the platform row and a configuration paragraph; the document has no
  configuration list in §3): `SUPPORT_EMAIL`; the `platform.publicConfig` query under the
  platform kernel; §7.2: the audit writer renders `targetLabel` from the target's type and id, never
  from a name, and refuses an empty one; the admin audit query resolves the target's current name
  at read time (D2). §5: the public pages
  are routes of the API (D5), rendered from templates that load the design stylesheet.
  `.env.example` gains the key with the Phase 2 task that adds it to `env.schema.ts`:
  `apps/api/src/platform/config/config.spec.ts` keeps the example's keys equal to the schema's, so
  the example cannot lead the schema.
- **Catalogues.** `admin.audit.targets.*` (five keys), `admin.credentials.a11y.documentPage` and
  `admin.dialogs.mfaReset.title` move from `apps/admin/src/i18n/` to the server renderer (D2); the
  keys stay in the admin catalogue until the Phase 1 task that builds the server renderer moves
  their Arabic there, so nothing is deleted now. `notifications.items.*` grow by the undrawn kinds
  after the copy review (D3).
- **Design.** `screens.md` rows for Notifications and TeacherNotifications cite D3; the admin audit
  rows cite D2; the public pages are `web /verify/:code` (three states drawn) and `web /delete-account`
  (D5); the Discovery and TeacherStudents boards already draw D6. The three proposal boards were
  removed from the canvas on 2026-10-17 (their fragments are kept under `docs/design/source/proposals/`).
- **Work.** D2 is a Phase 1 task (the audit writer exists); D1 is a note on the subjects page task;
  D3 and D4 are Phase 2 tasks with the notifications module and the public pages.

## Open

- Whether the renderer of D2 also serves the phone (where «للشيخ» appears in review and
  notification lines) or the phone keeps its ICU templates with a separate name form. Not decided
  here; the phone's strings are in the copy review.
- The copy of the undrawn kinds (D3): written and reviewed after the owner accepts the list.
