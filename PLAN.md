# Ijazah — Phase Plan

One Spec Kit spec per phase. Companion to SRS v1.4, ARCHITECTURE v3.2, ERD v1.14 and constitution v2.4.5. Amended by ADR 0005 (managed escrow retired), ADR 0007 (direct gateway checkout, 0% commission, zero custody), ADR 0008 (checkout experience and idempotency keys), ADR 0009 (sessions re-resolved on time zone data change), ADR 0010 (the database refuses double booking) and ADR 0012 (sign-in with Google, Apple or email; sign-in before onboarding). The schedule below was revised on 2026-10-08 for a team of one; each phase's objective, deliverables and definition of done are unchanged, and the decisions taken since the phase list was written are added under the phase that carries them out.

| Phase | Spec | Working days | Day numbers | Depends on |
|---|---|---|---|---|
| 0 — Foundations | `specs/001-foundations/` | Closes with the five-day batch plan of 2026-10-06; two days remained on 2026-10-08 | — | — |
| 1 — Identity and teacher onboarding | `specs/002-identity/` | 7 | 1–7 | 0 |
| 2 — Catalog, discovery, booking | `specs/003-booking/` | 8 | 8–15 | 1 |
| 3 — Live sessions | `specs/004-sessions/` | 7 | 16–22 | 2 |
| 4 — Certification, reviews, notifications | `specs/005-certification/` | 5 | 23–27 | 2 |
| 5 — Retired (managed payments, ADR 0005) | — | — | — | — |
| 6 — Hardening and store submission | `specs/007-submission/` | 3 | 28–30 | all |

Day numbers count working days after Phase 0 closes; the calendar is the owner's (five working days a week). The original week table assumed a team of three over seventeen weeks and is superseded.

**Day 1 (stated 2026-10-17, owner's decision).** Phase 0 closed when its hardening batch merged on 2026-10-14. The days from then to 2026-10-17 went to the decisions Phase 1 reads before its cycle can run, ADR 0012 to ADR 0021 and the design brought into the repository (T174 to T176), and are not counted in the thirty. Day 1, the first of Phase 1's seven, is 2026-10-17, and the Phase 1 cycle (T177) runs inside those seven days.

## Schedule and working method (revised 2026-10-08)

**The commitment.** Thirty working days after Phase 0 closes, the whole MVP — Phases 1, 2, 3, 4 and 6 — is complete and submitted. Time after day 30 is for improvement and is not planned here.

**How a phase is sized.** Each phase's days above were set from its share of SRS requirement ids (44 for Phase 1, 38 for Phase 2, 39 for Phase 3, 29 for Phase 4) and from its weight: Phase 1 carries the first mobile surface (design tokens, RTL, the three feature trees, the admin shell); Phase 2 carries the real gateway, the webhooks, the two-axis booking guards and Cairo DST; Phase 3 carries the session state machine and the video adapter; Phase 4 carries the certificate itself; Phase 6 is proving and packaging, and most of its hands-on steps are the owner's (store accounts, hosting, two physical devices, the restore drill).

**One Spec Kit cycle per phase.** Every phase gets its own `specs/<nnn>-<name>/` written with the same cycle as Phase 0, in this order: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`. The cycle reads this file, the SRS, ARCHITECTURE, the ERD, the ADRs and the constitution, so this file is kept current before each cycle runs. The cycle for Phase 1 runs at the opening of Phase 1 and is counted inside its seven days. For every later phase the cycle runs on the last day of the phase before it and is counted inside that earlier phase's days, so implementation starts on the phase's first day.

**How a phase is run.** The working method of Phase 0's final week continues unchanged: the tasks of a phase are grouped into batches of at most six tasks, in dependency order, tests written before implementation; a batch is one branch cut from `develop`, one pull request, one review; two batches in flight never write the same file or mark adjacent lines of `tasks.md`; only Critical and Major findings block a merge, the rest are recorded as follow-ups, at most two review rounds, strict on security. A batch may exceed six tasks only when there is a real need, and a new task goes where it belongs, never into a batch because it has room.

**Extending a phase.** A phase may take one or two days more than its number above only when the plan or tasks cycle, or implementation, uncovers a real need — the video spike's outcome enlarging Phase 3, for example — and only if the extension is stated at that moment with its cause. No phase carries a reserve from the start; the thirty days are the plan, not an estimate.

**When a phase slips anyway.** The descope ladder at the end of this file is applied in its order, cut by cut, before any later phase gives up days. Nothing under "Never cut" is touched.

**Order between Phases 3 and 4.** Both depend only on Phase 2. The plan runs 3 before 4. If the video baseline spike (Phase 0, T123) is still open or concludes against the assumed approach when Phase 2 closes, Phase 4 runs first and Phase 3 is specified once the spike has an outcome.

---

## Phase 0: Foundations

**Spec objective:** build the repository, data model and platform kernel every later phase depends on.

**SRS:** NFR-SEC-7/8, §6 · **Architecture:** §3, §4, §5, §12, §14, §15

**What this phase delivers**

- Monorepo: three apps (mobile, admin, api with its worker process), four packages
- Security baseline before first feature commit
- Boundary lint for modules and mobile wall
- Docker Compose local environment
- CI pipeline and automatic staging deploy (the staging deploy is deferred to Phase 6 by the owner, 2026-10-13; T092)
- Full Prisma schema, 33 tables, multi-file
- Database-level integrity rules and role-level delete revocation
- Seed data identical on every machine
- Platform kernel: config, logging, errors, guards, idempotency
- tRPC context, four procedure types, two separate routers
- Five port interfaces (storage, video, push, sms, payment) with fake adapters
- Storage adapters: local and S3
- Sentry, health and readiness endpoints
- Spike: video baseline on real devices
- Spike: Arabic RTL PDF with 25-entry chain

**Why separate this**

Because every later phase depends on it, and because boundary lint that arrives in Week 6 is boundary lint already violated.

**Definition of done**

- CI green on typecheck, lint, test, build
- Secret scanning and branch protection enforced
- Staging deploys automatically from `main` (deferred to Phase 6 by the owner, 2026-10-13: no paid environment during development; T092)
- Migrations run clean from empty database
- DELETE revoked at Postgres role level on `users`, `sessions`, `enrollments`, `ijazahs`, `audit_logs`
- Every port has a working fake adapter
- Both spikes closed with a written outcome
- All three deployable applications build green: mobile client, admin dashboard, API backend (serving both, with its worker process)

**Extension (stated 2026-10-12).** Phase 0 takes one working day more than its five-day batch plan, for one more batch: T159 to T163 and T165 in `specs/001-foundations/tasks.md`. The cause is a real need: T130's register (`specs/001-foundations/checklists/rule-proofs.md`) found that rules claiming a machine mechanism have no failing case, so SC-003's count is not zero. The thirty working days of Phases 1 to 6 start the day after that batch merges, so their start moves with it.

**Extension (stated 2026-10-14).** Phase 0 takes one more working day, for the hardening batch T168 to T173 in `specs/001-foundations/tasks.md` (its Phase 11). The cause is a real need: the closure review of `develop` d7b837f on 2026-10-13 (the security review, the code review and the project reviewer, read together) found nothing Critical and six things that are cheap before Phase 1 writes its first procedure and expensive after: the stand-ins run under a copied configuration because `NODE_ENV` defaults to development; no caller kind forces an output schema; a rate limit is applied by hand and has no platform-wide budget; the queue never retries; the database has no statement timeout and the cipher does not bind a value to its row; the API stops unclean. The thirty working days of Phases 1 to 6 start the day after that batch merges, one day later than the statement above (moved again to 2026-10-17 by the owner; see "Day 1" at the top of this file); the ERD amendments the same review raised open the Phase 1 cycle (below) and are not part of this batch.

---

## Phase 1: Identity and teacher onboarding

**Spec objective:** let a teacher apply and an admin approve them, with the identity model built right the first time.

**Phase 1 closed on 2026-10-29** (B19d, T092), on its eleventh working day of seven: an overflow of four days. Cause: the first runs on a real device (T090, T091) found defects that stop a person, fixed in B18 and B19a to B19c (T099 to T116, T121, T122), and T092's own run found two more, fixed in B19d (T155, T156). Nothing went to the descope ladder; the follow-ups found on the way are recorded in `specs/002-identity/tasks.md`, each with its timing. SC-101's and SC-105's runs on iOS moved to Phase 6 (the owner's decisions of 2026-10-27 and 2026-10-28), and the phase was proved on one device, the owner's Android phone.

**SRS:** FR-AUTH-1…15, §2.2, FR-VERIFY-1…11, FR-PROFILE-11, FR-ISNAD-1/2, FR-ADMIN-1/17/19, FR-PAYG-12…16, FR-LOC-1/2/3

**What this phase delivers**

- Sign-up and sign-in with Google, Apple (iOS) or email and password; an email account verifies its address by a one-time code; sign-in before onboarding (ADR 0012)
- Refresh tokens; password reset for email accounts
- Account deletion in the app and on the web, with the retention rules (FR-AUTH-14/15, ADR 0015)
- Email port with a stand-in adapter (ADR 0012); the SMS port stays unused
- Rate limiting on auth and OTP
- One role per account, chosen once at onboarding (ADR 0016)
- Gender and date of birth capture
- Derived `is_minor` flag surfaced to admin
- Versioned terms acceptance
- Design tokens as single source
- Arabic and English with logical RTL
- Student, teacher and shared feature trees
- Teacher application with document upload
- Signed expiring URLs, encrypted at rest
- Admin shell with mandatory MFA
- Audit log written from day one
- Verification queue: approve, reject, request more, ban
- Credential review before approval: each ijazah PDF reviewed and its chain transcribed by the admin (FR-ISNAD-1/2, FR-ADMIN-19, FR-PROFILE-11; ADR 0017 D5)
- Post-approval payout setup in-app via the payment port; recipient reference stored encrypted; teacher invisible and unbookable until the gateway verifies it (ADR 0007 D3)

**Decisions since this plan was written, carried out here**

- ADR 0012 to ADR 0019 (2026-10-14 and 2026-10-15) are read with this cycle: sign-in and the account row written at onboarding completion (ADR 0012), one role per account (ADR 0016), account deletion and no user-to-user block (ADR 0015), the teacher's credentials table and their review before approval (ADR 0017 D5), full names and admin sign-in limits (ADR 0019); ADR 0018's columns join this phase's ERD pass, its make-up sessions and refund case are Phase 2 and Phase 3 work.
- Payout setup is the first consumer of the gateway's `recipient_verified` and `recipient_rejected` events, so this phase decides, as an ERD change before that work, how such an event is routed to its teacher: a hash column beside `teacher_profiles.payout_account_ref_encrypted`, or a nullable `teacher_user_id` on `payment_events` (note under T117 in `specs/001-foundations/tasks.md`). The stand-in's `PayoutDetails` fields are provisional until the gateway is selected (OPEN-11).
- No identity caller verifies a password or a one-time code before the Phase 0 rate limits (T103) are in place, and identity validation caps password length (NIST 800-63B); both recorded from the review of PR #46.
- Every setting an identity flow reads (OTP expiry, attempt limits, terms version) comes through the kernel's `SettingsReader` from the `settings` table seeded in Phase 0, never a constant.
- Every number in module code has a stated place, because the R-MONEY-12 gate (T157) refuses every numeric literal other than 0 and 1 under `apps/api/src/modules/`: an operational limit (a page size, an attempt count, a window) is a `settings` key; an input bound (a Zod `.max()` on a free-text field) lives in `packages/contracts`; a time or money conversion (`toFixed(2)`, `padStart(4, '0')`, minutes to milliseconds) lives in `@ijazah/time` or `@ijazah/money`. The spec and plan say so before the first procedure task (PR #60 review n1). The output parser on every procedure is already required by the caller kinds (T169).
- ADR 0020 (2026-10-17): the design is in the repository and implemented, never redesigned. This phase writes what D7 leaves for it, each as a task implementing a contract or a catalogue already fixed: the primitives' React Native code, the theme and direction providers, the `Icon` component, the i18n runtime and its message-format library, and the admin panel's component layer. A screen task starts from `docs/design/components.md` and `docs/design/screens.md`; a token change is a change to `packages/tokens/tokens.json` and `pnpm tokens:build`.
- ADR 0021 (2026-10-17), the parts this phase carries out:
  - D2 is a task here: `audit_logs.target_label` by a forward migration before the first admin action is written; the audit writer renders the label from the target's kind and id, never a name, and refuses an empty one; the admin audit query resolves the current name at read time. The server renderer it needs takes over `admin.audit.targets.*`, `admin.credentials.a11y.documentPage` and `admin.dialogs.mfaReset.title` from the admin catalogue, which keeps them until then.
  - D5's conditions hold for this phase's public pages, the web account deletion (FR-AUTH-14) and the Terms body (FR-AUTH-11): routes of the API under their own paths, a strict `Content-Security-Policy`, no cookie, escaping templates, the anonymous rate limits.
  - D1 applies to the subject a teacher applies for: `subjects.name_en` is required on creation.
  - Open for this cycle's clarify step: ADR 0021 puts D4 (`SUPPORT_EMAIL` and `platform.publicConfig`) in Phase 2, but two screens of this phase show the support address (`teacher.payout.rejected.supportNote` and `web.deleteAccount.done.confirmation`). Either D4 moves into this phase or those screens ship without the line until Phase 2.
- The review follow-ups of PR #70 to #72 that ride along with this cycle's document pass: the wording of ADR 0012 D5's parenthesis, the order of the DEC rows, and the stray spaces the reviews listed.
- T130 (SC-003) is carried open into this cycle. The rules still open in its register are taken up here as named tasks:
  - R-GENDER-1 and R-GENDER-3 become a condition of the first task whose procedure returns teacher data to a user, the teacher list. A committed leaky subject must fail the adversarial suite before that task merges.
  - R-MOBILE-13 stays a `CI` rule. Its gate, "the server test exists in the same pull request", is designed in this cycle on the path-coupling script of T163.
  - T130 closes when the register's count is zero.
- The closure review of Phase 0 (2026-10-13; owner's decision 2026-10-14) opens this cycle with ERD amendments before any identity code is written (R-PROC-2):
  - a table of hashed sessions and refresh tokens for users and a separate one for administrators (FR-AUTH-7 requires server-side revocation; the ERD has none; R-SEC-8, R-DB-7);
  - where `users.account_status`, `user_roles.status`, teacher approval and payout verification are resolved on each request, since the request context carries none of them today and ARCHITECTURE §7.2, `contracts/kernel.md` and `procedures.ts` give `teacherProcedure` two meanings (FR-VERIFY-8, FR-VERIFY-10, FR-GENDER-6);
  - `idempotency_keys` unique on `(scope, actor_id, key)` rather than `(scope, key)`;
  - an index on `otp_codes (destination, purpose)` and purge sweeps for `otp_codes` and stale `device_push_tokens` (NFR-COMP-2);
  - the admin panel's authentication transport (a bearer header, no cookies, so no CSRF surface);
  - `auth_identities` for Google and Apple sign-in, keyed by the provider's subject, unique on `(provider, provider_subject)` (ADR 0012 D2).
  The text conflicts the review listed (ADR 0001 on the payment port, `/ready` and Redis, NFR-SEC-7's push protection, SRS §6.2 and §3.14 against the ERD, ADR 0005's superseded decisions, the rule count) ride along with the cycle's document pass. Everything else the review deferred stays deferred; ADR 0011 keeps the list.

**Definition of done**

- A teacher applies end to end on a physical device
- An admin reviews each credential, approves them, and the audit log records it
- Arabic RTL renders correctly on iOS and Android
- Gender is changeable only by an admin
- Approval is blocked until the verification call is recorded
- An approved teacher without a verified payout account appears nowhere and cannot publish
- No raw colour or spacing value exists outside `design/`

---

## Phase 2: Catalog, discovery, booking

**Spec objective:** let a student find a teacher and buy a package with correctly scheduled sessions.

**SRS:** FR-PROFILE-1…10, FR-DISC-1…5, FR-BOOK-1…11, FR-PAYG-1…11, NFR-COMP-1

**What this phase delivers**

- Subjects in both languages
- Teacher profiles and packages, each package on a track (ADR 0018 D1)
- `packages/time` complete and DST-safe
- Availability slots as local time plus zone
- Search and browse
- Gender filtering enforced at the repository layer
- Slot holds with TTL and expiry job
- Double-booking prevention on both axes
- Enrollment with full term snapshots
- Session generation as UTC instants
- Enrollment cancellation
- Adversarial gender suite blocking in CI
- Gateway checkout behind the payment port: order creation, hosted checkout, signed-webhook ingestion, `confirm-enrollment` and `expire-pending-payments` jobs (ADR 0007)
- Real gateway adapter (OPEN-11; waits for the gateway's written answers, the owner's decision of 2026-10-31 below)
- Admin payments monitor, read-only

**Decisions since this plan was written, carried out here**

- Checkout experience is driven by server state (ADR 0008 D1, FR-PAYG-17/18): Checkout → hosted checkout → Processing, subscribed to the enrollment's status → success only when the server reports Confirmed; after the configurable confirmation timeout the student is released with a Confirming badge, resolved by the payment-confirmed push.
- Client-retried mutations are made safe through the `idempotency_keys` table and kernel built in Phase 0 (ADR 0008 D2, FR-042); webhook replay safety stays on the provider event id of `payment_events`.
- The database refuses double booking on both axes (ADR 0010 D1–D3, FR-BOOK-5): a hold is written first and then checked, through the exclusion constraints modelled in Phase 0 (T141).
- A slot hold outlives the gateway order by an admin-configurable grace, and a failed order keeps it (ADR 0010 D4, FR-BOOK-9, FR-PAYG-6).
- Every paid event is recorded and `confirm-enrollment` runs for it; where the guards refuse the confirmation, a compensation case opens on the enrollment (`disputes.kind = compensation_case`) and nothing is confirmed (ADR 0010 D5, FR-PAYG-19, FR-DISPUTE-5).
- A student is in at most one checkout at a time, and a new checkout ends the old hold (ADR 0010 D6, FR-BOOK-12).
- Any release of a hold without conversion cancels its enrollment in the same transaction, with the reason the table in ADR 0010 D7 gives (`payment_expired`, `payment_failed`, `checkout_abandoned`, `slot_unavailable`).
- Session generation writes a session's local date, local start and IANA zone as the fact and its UTC instants as a declared cache, and the worker's `tzdata-reresolve` job recomputes the cache for scheduled sessions when the runtime's time zone data changes (ADR 0009 D1–D3, FR-SESS-20). Wherever a session's time is shown, it appears in the teacher's zone and in the viewer's (ADR 0009 D5).
- The real gateway adapter adds its member to `PaymentGateway`; production already refuses the `fake` stand-in through configuration (Phase 0, T146).
- The gender-enforcement suite was wired as a blocking gate in Phase 0; its case coverage grows here, where teacher data exists to attack.
- ADR 0021 (2026-10-17), the parts this phase carries out: D6, Discovery's search by teacher name and its filters by track, minimum rating and riwaya, and the searchable «طلابي» list (FR-DISC-1/2, FR-BOOK-7), with every result still passing the gender predicate (FR-DISC-3, R-GENDER-3); D4, `SUPPORT_EMAIL` in `env.schema.ts` and `.env.example` together and the rate-limited `platform.publicConfig` query, unless Phase 1's clarify step moved it there (it did: Phase 1's FR-145, landed in Phase 1).
- **Phase 2's days (2026-10-31).** Phase 1 closed on 2026-10-29, day 11. Phase 2's eight days are days 12 to 19, from Sunday 2026-11-01. Its Spec Kit cycle (T163 in `specs/002-identity/tasks.md`) ran on Saturday 2026-10-31, a weekend day, and is not counted.
- **Phase 1's follow-ups that land here** (`specs/002-identity/tasks.md`, the owner's decisions of 2026-10-29): Phase 2's first batch holds T123, T126, T129, T133 to T141, T160 and T162; being fourteen tasks, they are split over the first three batches (B20 to B22, T123, T126 and T129 in B20) before any new code of this phase (the owner's decision of 2026-11-01; `specs/003-booking/tasks.md`, "Carried from Phase 1"), without T141, which lands in B31, since T124 needs B22's place (the owner's decision of 2026-11-01), and with T123's device check in B26, the first batch with a screen that renders one of its keys (the owner's decision of 2026-11-01). T142 lands before discovery reads `teacher_subjects`; T143 before the code that reads the visibility predicate; T145 before a teacher's photo is shown to students; T146 before checkout relies on the phone's calls; T161 before this phase relies on the application's states; T158 with the teacher's profile screens. Any code of this phase that suspends or bans an account goes through `StandingService` (T144).
- **The visibility predicate reads the account's standing** (T143, the owner's decision of 2026-10-29): discovery leaves out a teacher whose account is suspended or banned, so a `verification_required` teacher stays visible as FR-VERIFY-10 allows; booking and token issuance require an active account. SRS §3.7.1, ADR 0006 and ADR 0007 say so.
- **The real gateway adapter waits for the gateway's written answers** (the owner's decision of 2026-10-31). Cause: SRS §10's "Payment gateway" row requires the gateway's capabilities confirmed in writing before it is selected, and OPEN-11's answers have not arrived. The phase is built and proved on the payment port's stand-in, which behaves as a real gateway at the boundary: signed events through the same webhook and signature check, a wrong signature refused, events delivered twice, out of order and after the hold has expired, for `paid`, `failed`, `expired` and `recipient_verified` (`specs/003-booking/spec.md`, FR-371 to FR-374). If the answers arrive before the phase's last batch, that batch builds the adapter and the owner runs the purchase on the gateway's sandbox; if not, the phase closes on the stand-in, and the adapter with its sandbox run becomes a numbered task in `specs/003-booking/tasks.md`, timed before Phase 6.
- **The screens are the notice of a payment's outcome** (the owner's decision of 2026-10-31, as Phase 1 decided for FR-VERIFY-6): no notification row and no push is written in this phase; the Confirming state clears by the app reading the enrollment again on return from the hosted checkout, on returning to the foreground and on a bounded schedule (FR-383, FR-384); every confirmation, failure, expiry and refused confirmation is kept as a durable record for Phase 4 (FR-385).
- **One first-wave follow-up stays open into Phase 3** (the owner's decision of 2026-11-04): `002:T123` (an Arabic template made only of values reads right to left on Android) has its code and specs done and its device check passed on every key drawn so far, but `card.ratingCount` is drawn only for a teacher with a rating, which no teacher has before Phase 3's reviews; Phase 2's close (`specs/003-booking/tasks.md`, T057) records it open instead of checking it.

**Definition of done**

- A student finds a teacher, holds a slot, pays on the gateway sandbox, and the signed webhook confirms the enrollment and generates sessions with no human step
- Sessions schedule correctly across a Cairo DST boundary
- Adversarial gender tests pass in CI
- A forbidden profile returns 404, never 403
- No code outside `packages/money` does piaster arithmetic; no wallet, ledger, escrow or balance exists anywhere; money amounts appear only in `payments`
- `confirmed_at` has exactly one write path and no proof-upload or manual-paid endpoint exists

---

## Phase 3: Live sessions

**Spec objective:** run a session end to end and settle its outcome from evidence, not from the client.

**SRS:** FR-SESS-1…19, FR-NOSHOW-1…6, FR-CANCEL-1…7, FR-MAKEUP-1…6, FR-DISPUTE-1…4

**What this phase delivers**

- Make-up sessions: a session not consumed is made up or refunded by an admin-decided case that carries no amount (ADR 0018 D2 to D4)
- Video adapter behind the port
- Server-side token minting and join window
- Session room: audio, camera, screen share
- Pre-session confirmation screen
- In-session chat with document attachments
- Image rejection by server-side content sniffing
- Chat retention and purge job
- Attendance webhooks into participant events
- Idempotent webhook handling
- Evaluation job at scheduled end plus two minutes
- Full session state machine
- Simultaneous time accumulated across reconnections
- All four no-show outcomes
- Cancellation by mutual agreement
- Admin review queues for under-threshold and outage

**Decisions since this plan was written, carried out here**

- Compensation is an administrative matter outside the code path (FR-DISPUTE-5/6, OPEN-10 resolved): every enrollment-level termination that leaves paid sessions undelivered opens a compensation case, and the admin's binding resolution records what Platform Administration did outside the platform. No refund, wallet or balance exists in code.
- The session screens show every time twice, in the session's own zone and in the viewer's (ADR 0009 D5).
- FR-AUTH-14's confirmed part lands in this phase's first batch (the owner's decision of 2026-11-01; T059 in `specs/003-booking/tasks.md`): a student's deletion cancels their remaining sessions `cancelled_by_admin` and their confirmed enrollments `account_deleted`, with no compensation case; a teacher's deletion has FR-SESS-16's effect, compensation cases included. Phase 2 writes the confirmed enrollments and sessions and handles holds and pending enrollments (R-219); cancelling a session is this phase's. Any suspension or ban this phase writes goes through `StandingService` (`specs/002-identity/tasks.md` T144, open until this phase's plan names it).
- The size of this phase depends on the Phase 0 video baseline spike (T123); if the spike concludes against the assumed approach, this phase is re-planned before its Spec Kit cycle, and Phase 4 may run first (see the schedule section).

**Definition of done**

- A session runs on two physical devices over mobile data
- Attendance evaluates correctly across a mid-session disconnect
- A session evaluates even when the final webhook never arrives
- All four no-show outcomes are reachable
- The sessions module never references a price, a payment record or any payment concept

---

## Phase 4: Certification, reviews, notifications

**Spec objective:** grant, verify the certificate that is the product.

**SRS:** FR-ISNAD-1…7, FR-IJAZAH-1…12 (13 and 14 deferred with the uploaded mode, ADR 0013), FR-REVIEW-1…5, FR-NOTIF-1…4, FR-SESS-15, §3.14

**What this phase delivers**

- The chain snapshot at issue; the chain itself is transcribed and reviewed with the credential in Phase 1 (ADR 0017)
- Teacher signature upload
- Ijazah granting, platform-generated only (the uploaded mode is deferred, ADR 0013)
- Immutable chain snapshot at grant
- Non-guessable certificate numbers and QR
- Public certificate verification page
- Admin bar to revoke the ability of a teacher to grant Ijazah with reasons
- Reviews on terminal enrollments
- Review moderation preserving the star
- Push notifications and notification centre
- Delivery job with retry
- User reports; there is no user-to-user block (ADR 0015 D5)
- Admin settings surface

**Decisions since this plan was written, carried out here**

- A student's ijazah is issued on the teacher's request after the admin's check, and the certificate carries full names (ADR 0017, ADR 0019).
- Every ijazah is platform-generated (ADR 0013). The uploaded mode, with its content sniffing and its verification-page wording (FR-IJAZAH-13/14), is deferred; `ijazahs.mode` stays and the grant service refuses `uploaded`.
- The certificate number is sixteen Crockford base32 symbols stored without separators and displayed as 4-4-4-4; the verification token is 32 random bytes in base64url — both minted by the Phase 0 identifiers module (T105).
- The Arabic RTL PDF spike (Phase 0, T124) decides the rendering approach for the 25-entry chain before this phase's Spec Kit cycle.
- The payment notifications are built on Phase 2's records (the owner's decision of 2026-10-31): Phase 2 writes no notification and no push, and keeps every enrollment confirmed, order failed, hold expired with its enrollment cancelled, and paid event refused as a durable record (`specs/003-booking/spec.md`, FR-385). This phase's payment-confirmed, payment-failed and slot-unavailable notifications (FR-NOTIF-1, FR-PAYG-5, FR-PAYG-18, FR-PAYG-19) read those records, with no change to Phase 2's code.
- Reminder jobs keyed to a session's start are rescheduled when the session's instants are recomputed (ADR 0009 D3, `reminder_offsets_minutes`, the key T074 seeds).
- ADR 0021 D3 (2026-10-17): every kind FR-NOTIF-1 lists renders in the one drawn notification shape, and the twelve members appended to `notifications.type` arrive by a forward migration. The ADR names a "Phase 2 notifications pass", but the notification centre is this phase's deliverable, so the migration lands here unless Phase 2 needs a kind first. The verification page follows D5's conditions (routes of the API, strict CSP, no cookie, escaping templates, anonymous rate limits; 404 for an unknown code, 200 with the revoked state).

**Definition of done**

- A teacher requests and the admin issues a platform-generated certificate (ADR 0013, ADR 0017)
- A 25-entry chain renders correctly in Arabic
- The public page verifies a certificate by token
- A teacher can never edit a chain entry
- One review per enrollment is enforced by constraint
- Every non-retired SRS v1.3 requirement ID maps to shipped code

---

## Phase 5: Retired — managed payments

Retired by ADR 0005 D1 and not reinstated by ADR 0007: payment is a direct
gateway checkout with zero custody, built in Phase 2 behind the payment port. Reintroducing managed payments would be a new spec,
a new ADR and a MAJOR constitution amendment, not a reactivation of this phase.

---

## Phase 6: Hardening and store submission

**Spec objective:** prove the system works from outside your network, and get it into review.

**SRS:** §5, §9, NFR-PERF

**What this phase delivers**

- Hosted infrastructure live from Week 14
- Full adversarial suite green
- Manual penetration pass on gender rules
- Eight use cases walked on both platforms, both languages
- Performance verified on real 3G and 4G
- Backup restore drill
- Staging dataset operated as admins for a week
- Privacy policy and terms publicly hosted
- Screenshots at every device size, both languages
- Store descriptions in Arabic and English
- Age rating and data-safety declarations
- Demo account seeded for reviewers

**Decisions since this plan was written, carried out here**

- Most hands-on steps of this phase are the owner's, not the implementer's: store accounts and submissions, the hosted environment, operating the staging dataset, the walk-through on two physical devices and the restore drill. The implementer's three days cover the adversarial suite, the manual pass on the gender rules, the performance verification, the store copy in both languages and the reviewer account.
- The always-on staging environment and its deploy on merge (Phase 0's T092, FR-066, SC-008: live within fifteen minutes of a merge to `main`), deferred here by the owner on 2026-10-13. Staging holds synthetic data only. The production host is planned on a Hostinger VPS, its region decided once counsel answers on Egypt's Personal Data Protection Law (research R-19).
- Phase 1's SC-101 run on iOS (the note under T090 in `specs/002-identity/tasks.md`): deferred by the owner on 2026-10-27, since a build for an iPhone needs a paid Apple Developer account; it is run before the first store submission, when that account exists.
- Phase 1's SC-105 run on iOS (the note under T091 in `specs/002-identity/tasks.md`): every screen of the phase in Arabic and in English on an iPhone against its board, before the first store submission; B19b walked them on Android only, by the owner's decision of 2026-10-28.
- `expo doctor` clean before the first store submission (the note under T101): the SDK 58 packages it reports behind their expected patch versions brought up, as a task of its own (the owner, 2026-10-27).
- A restart policy for the API and the worker in the hosted Docker setup (`restart: unless-stopped` or the host's equivalent), so a process that ends is brought back (T108: B19a closed the paths found that ended it; the owner, 2026-10-28).
- The full-codebase review that the Phase 0 schedule planned as a separate week is not inside the thirty days: it runs after day 30, in the improvement time, once the MVP is complete. Within the thirty days every batch still gets its own review.

**Why separate this**

Because no new features are added here, and every team that breaks that rule resubmits in month five.

**Definition of done**

- Reviewers can open and use the app from their own network
- A backup has been restored, not merely taken
- Submitted to both stores

---

## After the MVP

Features decided for after the MVP. None is built before every phase has closed.

- **An assessment first, then a program paid in stages** (the owner's decision of 2026-11-03). A package whose first session is an assessment:
  - the first payment is for the assessment session only;
  - after it, the teacher sets the level, the program's length, the number of sessions and their length (30, 45 or 60 minutes), and the student receives an offer with one total price, the session's price derived from it;
  - the second payment is the rest, in full or in instalments through Paymob's subscription service (a charge every period the platform sets), the split to the teacher applying there too (OPEN-11's answers of 2026-11-03);
  - the student continues with the same teacher to the khatma, and the teacher grants the ijazah and issues the sanad.

  What it changes when it is built: (1) an enrollment is confirmed in stages, the assessment after the first payment and the rest after the second; (2) several paid orders on one enrollment become normal, so an order has a kind (assessment, rest, instalment) and FR-375 is amended to tell them apart; (3) the number of sessions and the price are set after the assessment, not by the package; (4) new rules: the time allowed between the assessment and the second payment, and what happens when the student does not pay or stops partway through the instalments.

  Note for Phase 3's Spec Kit cycle (D19): the session code reads the number and the length of sessions from the enrollment's snapshot, never from the package, and nowhere hard to change later assumes that all of an enrollment's sessions are generated at once.

---

## Descope ladder

Cut in this order if a gate slips. The phase each cut belongs to is in brackets, so a slipping phase knows which of its own deliverables go first.

- Reviews and ratings (Phase 4)
- In-session file sharing, keeping text chat (Phase 3)
- Public certificate verification page (Phase 4)
- Notification breadth (Phase 4)
- Admin settings UI (Phase 4)
- One store first (Phase 6)

**Never cut:** gender enforcement, product honesty about payment (R-HONEST-1), timezone handling, the security baseline.