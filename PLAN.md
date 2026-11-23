# Ijazah — Phase Plan

One Spec Kit spec per phase. Companion to SRS v1.4, ARCHITECTURE v3.2, ERD v1.15 and constitution v2.6.2. Amended by ADR 0005 (managed escrow retired), ADR 0007 (direct gateway checkout, 0% commission, zero custody), ADR 0008 (checkout experience and idempotency keys), ADR 0009 (sessions re-resolved on time zone data change), ADR 0010 (the database refuses double booking), ADR 0012 (sign-in with Google, Apple or email; sign-in before onboarding) and ADR 0024 (the assessment and the ijazah programme paid by instalments, built before the server). The dated road to the store (the owner's decisions of 2026-11-09) sets the calendar from Phase 3's last batches to the store: see «The road to the store». The schedule below was revised on 2026-10-08 for a team of one; each phase's objective, deliverables and definition of done are unchanged, and the decisions taken since the phase list was written are added under the phase that carries them out.

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

**The commitment.** Thirty working days after Phase 0 closes, the whole MVP — Phases 1, 2, 3, 4 and 6 — is complete and submitted. Time after day 30 is for improvement and is not planned here. *(Amended 2026-11-10, the owner's decisions of 2026-11-09 and of 2026-11-10 on B37's conflict check, Q1: «The road to the store» below replaces this commitment's dates and Phase 6's day numbers in the table above. The first release is Android only; the closed test starts by 2026-12-06 and the app is on Google Play by 2027-01-01; the programme of ADR 0024 is built before the server, inside that road.)*

**How a phase is sized.** Each phase's days above were set from its share of SRS requirement ids (44 for Phase 1, 38 for Phase 2, 39 for Phase 3, 29 for Phase 4; FR-ADMIN-4 was added to Phase 3 on 2026-11-05, on Phase 3's analysis, and its days did not change) and from its weight: Phase 1 carries the first mobile surface (design tokens, RTL, the three feature trees, the admin shell); Phase 2 carries the real gateway, the webhooks, the two-axis booking guards and Cairo DST; Phase 3 carries the session state machine and the video adapter; Phase 4 carries the certificate itself; Phase 6 is proving and packaging, and most of its hands-on steps are the owner's (store accounts, hosting, two physical devices, the restore drill).

**One Spec Kit cycle per phase.** Every phase gets its own `specs/<nnn>-<name>/` written with the same cycle as Phase 0, in this order: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`. The cycle reads this file, the SRS, ARCHITECTURE, the ERD, the ADRs and the constitution, so this file is kept current before each cycle runs. The cycle for Phase 1 runs at the opening of Phase 1 and is counted inside its seven days. For every later phase the cycle runs on the last day of the phase before it and is counted inside that earlier phase's days, so implementation starts on the phase's first day.

**How a phase is run.** The working method of Phase 0's final week continues unchanged: the tasks of a phase are grouped into batches of at most six tasks, in dependency order, tests written before implementation; a batch is one branch cut from `develop`, one pull request, one review; two batches in flight never write the same file or mark adjacent lines of `tasks.md`; only Critical and Major findings block a merge, the rest are recorded as follow-ups, at most two review rounds, strict on security. A batch may exceed six tasks only when there is a real need, and a new task goes where it belongs, never into a batch because it has room. *(Amended 2026-11-16, the owner's plan of 2026-11-15: from 11/16 to 11/19 two tracks run at once, each with its own implementer and review pair and its own batches: track 1 Phase 4, on `ijazah_integrity`; track 2 the money, on a second test database `ijazah_integrity_b` (the owner's approval, «اه موافق»; created by the owner's word typed in that track's session, its environment script a variant of the first's). The two never write the same file; their migrations merge in timestamp order and are proved together on one database. The gates are lighter for these days: full TDD (red first, named mutants) for money, security, gender and time, lighter specs for ordinary screens; the full coverage run and the whole-repository lint run on CI only, locally the typecheck, the contract gate and the changed modules' specs; one review round per batch, its Minor findings recorded as follow-ups; conflict checks short, owner questions only. So the tracks never collide, numbers are reserved: SRS DEC-70 for this record, DEC-71 to DEC-79 and ADRs 0030 to 0039 for track 1, DEC-80 to DEC-89 and ADRs 0025 to 0029 for track 2; every branch of both tracks is cut from this record's commit; no version line of the SRS, the ERD or the constitution changes until the 11/19–20 integration; the owner merges one pull request at a time (the full rules: `ejazah-tools\tracks-coordination.md`, outside the repository).)*

**Extending a phase.** A phase may take one or two days more than its number above only when the plan or tasks cycle, or implementation, uncovers a real need — the video spike's outcome enlarging Phase 3, for example — and only if the extension is stated at that moment with its cause. No phase carries a reserve from the start; the thirty days are the plan, not an estimate.

**When a phase slips anyway.** The descope ladder at the end of this file is applied in its order, cut by cut, before any later phase gives up days. Nothing under "Never cut" is touched.

**Order between Phases 3 and 4.** Both depend only on Phase 2. The plan runs 3 before 4. If the video baseline spike (Phase 0, T123) is still open or concludes against the assumed approach when Phase 2 closes, Phase 4 runs first and Phase 3 is specified once the spike has an outcome.

---

## The road to the store («الطريق للمتجر»; the owner's decisions of 2026-11-09, recorded 2026-11-10)

**The target.** The app is on Google Play by **2027-01-01**, Android only (SRS DEC-62), through a personal Google Play account, so a closed test of at least 12 testers opted in for 14 days in a row comes before production. The closed test starts by **Sunday 2026-12-06** at the latest. The dates are the implementer's estimate, given to the owner on 2026-11-09 with no slack: they assume work on Fridays and Saturdays and the design running beside the backend. The owner asked for this date, so progress is reported against it.

**The code, in order.**

| Date | Work |
|---|---|
| 11/10 | B37's tasks commit records this road, the programme's rules (ADR 0024, SRS §3.5.1) and Android first |
| to 11/16 | The rest of Phase 3, B37 to B43 (`specs/004-sessions/tasks.md`, «Batches»); Phase 4's Spec Kit cycle (T057) on 11/16 |
| 11/16–11/19 | Two tracks at once («How a phase is run», as amended on 2026-11-16). Track 1: Phase 4, lightened (below). Track 2: the assessment and the ijazah programme by instalments (ADR 0024), and `specs/003-booking/tasks.md` T104 (the commission: the teacher's 70% net), T101, T102 and T105 (a monthly payout with its deductions, on the owner's assumption of 2026-11-15, recorded under T105 by track 2's first tasks commit). The light items, all required, to whichever track frees first: the administrator's settings page (SRS §3.14), `specs/002-identity/tasks.md` T148 (the live sign-in) and T147 (nothing development-only on a hosted server) |
| 11/20 | One phone run on both Android phones, the owner driving from a written checklist (`specs/004-sessions/tasks.md` T056's device run and the trials noted under it; system font and display size at default, large and largest); then T056's close |
| 11/20–11/21 | The full-codebase review, in two waves (moved here from Phase 6) |
| 11/21–11/25 | The design week: the screens, the room made like a call (the share for the teacher only), the certificate's look, large system fonts; the ADR that open point 6 below asks for first *(Amended 2026-11-21, the owner's decision, SRS DEC-100: the design week comes after the programme; its dates are set by the session that plans the batches: 11/30–12/4, «The calendar to the closed test» below.)* |
| 11/26–12/5 | On the Pro plan: the server up, the email sender, the privacy policy and the terms hosted, the Play listing and its declarations, a new EAS build with the logo carrying `specs/004-sessions/tasks.md` T068, `expo doctor`, and T054 and T055 of that file *(Amended 2026-11-21: the Max plan runs to 12/25; these items are placed by «The calendar to the closed test» below.)* |
| **12/6 Sun** | **The closed test starts: the latest date** |
| 12/6–12/20 | The 14 days, beside the rest of Phase 6: the fixes the closed test finds, the adversarial and performance passes, the restore drill, the week on the panel, the store screenshots |
| 12/21 | Apply for production access |
| about 12/28 | Google's answer (usually seven days or less, by its own page) |
| **2027-01-01** | **On the store** |

Nothing of the programme or of T104 may slide past 11/19 into the design week or Phase 6, which add no feature (R-PROC-6). *(Amended 2026-11-19, the owner's decision on B-M4's conflict check, Q-1, «تمام اقتراحك»: the programme's Spec Kit cycle runs on 11/19. Its server code, B-P batches by `specs/006-programme/tasks.md`, runs beside the design week (11/21–11/25), which does not touch it. Its screens are built after the design week, on the new design. Everything is merged by 12/4; what is not merged and green by then moves to v1.1, and the ijazah package is sold as today (one order, 25% at half) until it lands. The programme's server code gets its own money lane at the full review's depth once merged; it is not in the 11/20 full review.)* *(Amended 2026-11-21, the owner's decisions, SRS DEC-100 and DEC-92 as amended: the programme ships in the first release, built before the design week and the store's preparation, its screens on today's design; the fallback to v1.1 is removed; R-PROC-6's bar on the programme after 11/19 is lifted by the owner's decision, as it is for `specs/005-certification/tasks.md` T034.)*

**The calendar to the closed test (the owner's decisions of 2026-11-21, in the session that plans the batches).** It replaces the rows from 11/21 to 12/5 above. Two tracks, as since 11/16. All of it is before 12/6: the proposal to move eleven before-launch tasks into the test's 14 days was refused («لا، كله قبل 12/6»). The Max plan runs to 12/25 («هتفضل لحد 25 شهر 12»), in place of the Pro plan from 11/26. There is no spare day: a batch that takes a day more moves 12/6, and the store's date, by a day, and is reported when it happens.

| Days | Track 2 (the money, `ijazah_integrity_b`) | Track 1 (`ijazah_integrity`) | Beside them |
|---|---|---|---|
| 11/21–11/22 | B-P1 | The tasks commit of PR #154's and #153's follow-ups; R1a starts | |
| 11/23–11/24 | B-P2 | R1a ends 11/23; R1b starts 11/24, cut after B-P2 merges (both write `share-release.rules.ts`) | The owner: the gateway's contract request |
| 11/25–11/26 | B-P3 | R1b ends 11/25, with the room's end-to-end encryption (`specs/004-sessions/tasks.md` T084) and its run on both phones, and `specs/002-identity/tasks.md` T186; R2 starts, cut after R1b merges (both write the server's configuration files) | Counsel's answer, 11/26 |
| 11/27–11/29 | B-P4, on today's design: the programme is merged | R2 ends 11/27; R3, the code, 11/28–11/29 | |
| 11/30–12/1 | The programme's own money review, and its fixes | The before-launch tasks, batch 1 | The design week, days 1 and 2; the owner: the logo, the testers |
| 12/2–12/3 | `specs/003-booking/tasks.md` T128, once the contract is signed | The before-launch tasks, batch 2 | The design week, days 3 and 4; the store's listing and declarations, the privacy policy and the terms hosted, with the Terms' text (T151, T117) |
| 12/4 | free | free | The design week, day 5: its last code |
| 12/5 | R3's build (`specs/002-identity/tasks.md` T182) with the logo and the design; the phone run; the upload | | |
| **12/6 Sun** | **The closed test starts** | | |

- The batches: `specs/006-programme/tasks.md`, «Batches»; `specs/002-identity/tasks.md`, «The full-codebase review's batches».
- The before-launch tasks outside the review's batches, thirteen by their timing words, each confirmed in its batch's conflict check (PR #155's review, round 1, N5). Batch 1: `specs/002-identity/tasks.md` T148, T149, T150, T152, T153, T154. Batch 2: `specs/003-booking/tasks.md` T081, T083, T086, T092, T094, and `specs/004-sessions/tasks.md` T085 (added 2026-11-22, the owner; six tasks). The Terms' text, `specs/002-identity/tasks.md` T151 with `specs/003-booking/tasks.md` T117 (the same files), with the store's preparation on 12/2–12/3. No batch passes six tasks.
- B-P1 is cut after this calendar's pull request (#155) merges. R1a and B-P1 run on the same days and share the migration order, the ERD's numbering, the seed's counts and the settings registry: the two tracks' rule holds (`specs/006-programme/tasks.md`, «Batches»).
- Not placed: the closes `specs/004-sessions/tasks.md` T054, T055, T056 and `specs/005-certification/tasks.md` T026, T033; `specs/001-foundations/tasks.md` T130; `specs/002-identity/tasks.md` T123; `specs/003-booking/tasks.md` T059, and T118 (Phase 6's load pass).
- Placed 2026-11-22 (the owner), the three items of `specs/004-sessions/tasks.md`, «Not scheduled», with before-launch words: (8) by T084 in R1b, whether the data may leave Egypt staying with counsel; (12) in `specs/002-identity/tasks.md` T182, R3; (13) as T085 in batch 2.
- Added 2026-11-22 (the owner, «تدخل»; SRS DEC-102): `specs/004-sessions/tasks.md` T084, a session's media encrypted end to end, in R1b (four tasks in its two days, and the owner's two phones on 11/25). No date moves; the design week's work on the room (11/30–12/4) builds on it. R2 is cut after R1b merges, since both write the server's configuration files, and its deploy sets the new media secret.
- What it rests on: the design week is five days, talk and code together, beside two batches; the gateway's contract is signed by 12/2, so T128 merges by 12/3; R2 has, before 11/25, the owner's domain, e-mail provider (`specs/002-identity/tasks.md` T177) and object-storage account (T179).

**The owner's own steps.**

| By | Step |
|---|---|
| 11/10 | Send the gateway's questions (the owner's paper of 2026-11-09: ten questions, four confirmations) to the account manager |
| 11/12 | Decide whose name, and open the Google Play account |
| 11/16 | Decide the commission — decided: the teacher receives 70% net (T104) |
| Decided 2026-11-16 | The sheikh's view on returning after a close (SRS OPEN-12): no return; a new subscription and a new assessment (SRS DEC-83) |
| 11/24 | Submit the gateway's contract request |
| 11/24 | For R2 (added 2026-11-21): the domain, the e-mail provider (`specs/002-identity/tasks.md` T177) and the object-storage account (T179) |
| 11/25 | Both Android phones for the run of the room's encryption (`specs/004-sessions/tasks.md` T084); the new media secret made for the hosted server, its second copy in the password manager (added 2026-11-22) |
| 11/26 | The lawyer's answer on the server's region (PDPL), and the video's routing (`specs/004-sessions/tasks.md`, Not scheduled, item 8) |
| Done 2026-11-15 | The server bought, 4 GB (Phase 6's estimates below) |
| 11/30 | The logo as a 1024×1024 PNG |
| 12/1 | 15 to 20 testers with a Gmail account and an Android phone |
| Start of December (before 12/6) | The gateway's contract signed; its live keys ready by 12/25 *(Amended 2026-11-21, the owner, «التعاقد هيكون فاول شهر 12 تقريبا اللي هو قبل ميعاد الاختبار»: the contract is signed at the start of December, before the closed test, and `specs/003-booking/tasks.md` T128 is merged before the test starts. If the contract slips past 12/6 the closed test waits for it: each day of slip moves the store's date by a day.)* |

**What binds the order.**

- Play Console's app content asks, for each foreground service type, a declaration with its use, the user's impact and a video of the user starting it: `mediaProjection` and `microphone` (the follow-up under `specs/004-sessions/tasks.md` T019, 2026-11-09), prepared before the closed test.
- The closed test needs a hosted API: the configuration refuses every stand-in outside development and test, and refuses the gateway outside them until T101 lands.
- *(Amended 2026-11-21, the owner's decisions on the full-codebase review; SRS DEC-100.)* The closed test starts only after the gateway's contract, since the test account offers no payout onboarding and no teacher is bookable without it (`specs/003-booking/tasks.md` T128). The ijazah programme ships in the first release; the design week and the store's preparation come after it, not beside it («اسبوع التصميم وتجهيز المتجر بعد برنامج الاجازة»). The review's batches (R1a and R1b the code, R2 the hosted server, R3 the store build: `specs/002-identity/tasks.md`, «The full-codebase review's batches») are placed with the programme's batches by the session that plans them, which tells the owner at once if the dates above no longer hold.
- Testers pay with the gateway's test keys in a non-production mode; real money only after the contract and the lawyer's answer.
- A new build during the test: the store's text counts testers, but sources disagree on whether a build restarts the 14 days, so the test starts on a stable build.

**Open points, not decided** (the owner's decision of 2026-11-10: written as open points, never as rules).

1. **Returning after a close** of the programme (SRS OPEN-12; ADR 0024 D4): **decided 2026-11-16** — there is no return; a Student who wants to continue starts as a new Student, with a new subscription and a new assessment (SRS DEC-83).
2. **The 66 old open tasks**: their triage into security, money and launch is proposed and not confirmed.
3. **The gateway's answers**: everything the gateway said about the split, holding a share and subscriptions is verbal so far; the SRS requires it in writing (OPEN-11). T105 is built on the owner's assumption of 2026-11-15 («افترض ان الاسئلة دي نقدر»): the teacher's share held at the gateway and released at milestones (a recitation package's end; on the ijazah track 25% at half the sessions and the rest at the programme's end; SRS DEC-81); the written answers are asked at contracting, and if any is no, the fallback is custody, with the lawyer and the accountant. The ADR is [ADR 0025](docs/adr/0025-commission-teacher-share-held-to-milestones-and-payment-mode.md) (D8: a «no» supersedes D2 to D4), and the notes under T104 and T105 record it (track 2's tasks commit, 2026-11-17).
4. **The room's quality**: after B36's trial the owner heard the sound and saw the picture late, with few frames (the follow-up under `specs/004-sessions/tasks.md` T019, 2026-11-09). Proposed as its own task, not approved: the room made with no options (dynacast and adaptive stream off), the screen captured at full size, and SRS NFR-PERF-3's audio-only fallback named nowhere in `specs/004-sessions`; measured on real 4G without adb first.
5. **The owner's requests for the room**, not decided in detail: a mute button (SRS FR-SESS-4 gives every participant audio, so the SRS decides first); the video like a phone call, one large picture and one small movable one, a tap swapping them; the camera, the share, leaving and mute as icons side by side.
6. **The design days against ADR 0020**: ADR 0020 says the design in the repository is implemented and none redesigns (`docs/adr/0020-design-files-in-the-repository.md:102`), and the design week (11/21–11/25; re-dated 11/30–12/4 on 2026-11-21) redesigns screens. The ADR that allows it is written after the review of the design directions and before any code (the owner's decision of 2026-11-10 on B37's conflict check, Q4).

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

**Phase 2 closed on 2026-11-05** (B32, T057 in `specs/003-booking/tasks.md`), on its fifth working day of eight (day 16). Proved on the payment port's stand-in and, for the gateway, on Paymob's test account (T056); on one device, the owner's Android phone. Left open by the owner's decisions: `002:T123`'s last key (no rated teacher before Phase 4) and Paymob's documented decline in test mode (OPEN-11). T057's note lists what the device could not reach; those parts stay with the specs.

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
- **The real gateway adapter waits for the gateway's written answers** (the owner's decision of 2026-10-31). Cause: SRS §10's "Payment gateway" row requires the gateway's capabilities confirmed in writing before it is selected, and OPEN-11's answers have not arrived. The phase is built and proved on the payment port's stand-in, which behaves as a real gateway at the boundary: signed events through the same webhook and signature check, a wrong signature refused, events delivered twice, out of order and after the hold has expired, for `paid`, `failed`, `expired` and `recipient_verified` (`specs/003-booking/spec.md`, FR-371 to FR-374). If the answers arrive before the phase's last batch, that batch builds the adapter and the owner runs the purchase on the gateway's sandbox; if not, the phase closes on the stand-in, and the adapter with its sandbox run becomes a numbered task in `specs/003-booking/tasks.md`, timed before Phase 6. *Replaced on 2026-11-03 (the owner's decision): the adapter was built in the phase's last batch and tried on Paymob's test account, OPEN-11's written answers being needed only for production and contracting (`specs/003-booking/tasks.md`, T056).*
- **The screens are the notice of a payment's outcome** (the owner's decision of 2026-10-31, as Phase 1 decided for FR-VERIFY-6): no notification row and no push is written in this phase; the Confirming state clears by the app reading the enrollment again on return from the hosted checkout, on returning to the foreground and on a bounded schedule (FR-383, FR-384); every confirmation, failure, expiry and refused confirmation is kept as a durable record for Phase 4 (FR-385).
- **One first-wave follow-up stays open into Phase 4** (the owner's decision of 2026-11-04): `002:T123` (an Arabic template made only of values reads right to left on Android) has its code and specs done and its device check passed on every key drawn so far, but `card.ratingCount` is drawn only for a teacher with a rating, which no teacher has before Phase 4's reviews (corrected on 2026-11-05: reviews are Phase 4's); Phase 2's close (`specs/003-booking/tasks.md`, T057) records it open instead of checking it.

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

**SRS:** FR-SESS-1…19, FR-NOSHOW-1…6, FR-CANCEL-1…8 (FR-CANCEL-8, an administrator's restore of an enrollment, added on 2026-11-05, the owner's decision of no automatic termination), FR-MAKEUP-1…6, FR-DISPUTE-1…7 (FR-DISPUTE-7, a ruling's revision, added on Phase 3's third analysis, 2026-11-05), FR-ADMIN-4 (the user directory, which no phase owned; the owner's decision of 2026-11-05 on Phase 3's analysis), FR-ADMIN-5 (the student's part), FR-ADMIN-6, FR-ADMIN-7, FR-ADMIN-14 (the admin pages and the student's standing these requirements need; the owner's decision of 2026-11-05)

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
- Evaluation job at scheduled end plus the configured evaluation delay (a setting, default two minutes; R-SESS-2 as amended on 2026-11-05, the owner's decision)
- Full session state machine
- Simultaneous time accumulated across reconnections
- All four no-show outcomes
- Cancellation by mutual agreement
- Admin review queues for under-threshold and outage

**Decisions since this plan was written, carried out here**

- Compensation is an administrative matter outside the code path (FR-DISPUTE-5/6, OPEN-10 resolved): every enrollment-level termination that leaves paid sessions undelivered opens a compensation case, and the admin's binding resolution records what Platform Administration did outside the platform. No refund, wallet or balance exists in code.
- The session screens show every time twice, in the session's own zone and in the viewer's (ADR 0009 D5).
- Live updates while the app is open (the owner's decision of 2026-11-05; `specs/004-sessions/research.md` R-324): one Server-Sent Events channel per signed-in device through tRPC subscriptions, no WebSocket server, carrying chat and the signals that make the open screens read again; nothing while the app is closed until Phase 4's notifications. One API process until a Redis bus between processes lands (Not scheduled in `specs/004-sessions/tasks.md`).
- FR-AUTH-14's confirmed part lands in this phase's first batch (the owner's decision of 2026-11-01; T059 in `specs/003-booking/tasks.md`): a student's deletion cancels their remaining sessions `cancelled_by_admin` and their confirmed enrollments `account_deleted`, with no compensation case; a teacher's deletion has FR-SESS-16's effect, compensation cases included. Phase 2 writes the confirmed enrollments and sessions and handles holds and pending enrollments (R-219); cancelling a session is this phase's. Any suspension or ban this phase writes goes through `StandingService` (`specs/002-identity/tasks.md` T144, open until this phase's plan names it).
- The size of this phase depends on the Phase 0 video baseline spike (T123); if the spike concludes against the assumed approach, this phase is re-planned before its Spec Kit cycle, and Phase 4 may run first (see the schedule section).

**Definition of done**

- A session runs on two physical devices over mobile data
- Attendance evaluates correctly across a mid-session disconnect
- A session evaluates even when the final webhook never arrives
- All four no-show outcomes are reachable
- No count of a teacher's absences ends an enrollment: an enrollment ends for a teacher's absence only by an administrator's decision on the student's complaint, which may be restored within the restore window, and the repeated-absence mark is shown to administrators only, computed when read *(added 2026-11-05, the owner's decision; [ADR 0023](docs/adr/0023-no-automatic-termination-complaint-and-restore.md))*
- The sessions module never references a price, a payment record or any payment concept

---

## Phase 4: Certification, reviews, notifications

**Spec objective:** grant, verify the certificate that is the product.

**SRS:** FR-ISNAD-1…7, FR-IJAZAH-1…12 (13 and 14 deferred with the uploaded mode, ADR 0013), FR-REVIEW-1…5, FR-NOTIF-1…4, FR-SESS-15, FR-GENDER-3…7, FR-ADMIN-8 (gender disputes, with user reports; the owner's decision of 2026-11-05), §3.14

*(Amended 2026-11-16, DEC-70: the phase is lightened for v1.0. Built now: the certificate (the teacher's request, the administrator's issue, the Arabic PDF with the chain), user reports and the gender rules (FR-SESS-15, FR-GENDER-3…7, FR-ADMIN-8), push for three kinds only, each push recorded, and §3.14's settings surface. In the first update (v1.1, below): FR-REVIEW-1…5, the public verification page and its QR code, the notification centre and every other push kind. The definition of done's lines «The public page verifies a certificate by token» and «One review per enrollment is enforced by constraint» move with them.)*

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
- The payment notifications are built on Phase 2's records (the owner's decision of 2026-10-31): Phase 2 writes no notification and no push, and keeps every enrollment confirmed, order failed, hold expired with its enrollment cancelled, and paid event refused as a durable record (`specs/003-booking/spec.md`, FR-385). This phase's payment-confirmed, payment-failed and slot-unavailable notifications (FR-NOTIF-1, FR-PAYG-5, FR-PAYG-18, FR-PAYG-19) read those records, with no change to Phase 2's code. *(Amended 2026-11-18, B48's Q-N1 (a), the owner's «موافق على الكل (أ)»: Phase 4's payment pushes are recorded on the transaction that writes each record, through booking's one writer `recordEnrollmentEvents`; `specs/005-certification/tasks.md`, the note under T016.)*
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
- Eight use cases walked on Android for the first release, both languages; on iOS before the first App Store submission *(amended 2026-11-10, SRS DEC-62)*
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
- Phase 1's SC-101 run on iOS (the note under T090 in `specs/002-identity/tasks.md`): deferred by the owner on 2026-10-27, since a build for an iPhone needs a paid Apple Developer account; it is run before the first App Store submission, when that account exists *(re-tied 2026-11-10: the first store submission is Google Play's, SRS DEC-62)*.
- Phase 1's SC-105 run on iOS (the note under T091 in `specs/002-identity/tasks.md`): every screen of the phase in Arabic and in English on an iPhone against its board, before the first App Store submission *(re-tied 2026-11-10, SRS DEC-62)*; B19b walked them on Android only, by the owner's decision of 2026-10-28.
- `expo doctor` clean before the first store submission (the note under T101): the SDK 58 packages it reports behind their expected patch versions brought up, as a task of its own (the owner, 2026-10-27).
- The live channel behind the hosted proxy (the owner's decision of 2026-11-05; `specs/004-sessions/research.md` R-324; the configuration itself in `docs/RUNBOOK.md`, «Reverse proxy and the live channel»). `GET /trpc/live.events` is a Server-Sent Events stream, pinged every 25 s:
  - nginx: `proxy_http_version 1.1`, `proxy_buffering off`, `gzip off`, `proxy_read_timeout 120s` (longer than the 25 s ping), and `worker_connections` raised (8192; each stream holds two);
  - Caddy: `reverse_proxy` flushes the stream at once and has no read timeout by default; no `encode` on `text/event-stream`;
  - Cloudflare in front, if ever: its 100 s idle limit is met by the 25 s ping;
  - Docker: `ulimits: nofile: 65536` on the proxy and the API;
  - RAM for choosing the VPS, **estimates**, not measurements (LiveKit Cloud, not self-hosted; Postgres with about 512 MB of shared buffers; the API and the worker as two Node processes): about 1.7 GB at rest, about 1.72, 1.77 and 1.83 GB with 100, 500 and 1000 apps open. 2 GB is too tight (no room for Postgres's page cache or a build); 4 GB is comfortable. Phase 3's live-channel server task (T063) measured the API's RSS with 500 streams (2026-11-08, in the RUNBOOK): about 145 KB per stream, in place of the 100 KB these estimates assumed, so about 45 MB more than they say at 1000 apps open (about 142 MB in all for the streams at 1000 apps), and 4 GB stays comfortable;
  - one API process until the Redis bus between processes lands (Not scheduled), so the API is not scaled by adding processes before it.
- A restart policy for the API and the worker in the hosted Docker setup (`restart: unless-stopped` or the host's equivalent), so a process that ends is brought back (T108: B19a closed the paths found that ended it; the owner, 2026-10-28).
- LiveKit Cloud's project setting «Automatically create rooms» checked to be off in the production project before the first real session (the owner's decision of 2026-11-07; T009's notes in `specs/004-sessions/tasks.md`; `docs/RUNBOOK.md`, «Room does not open»): with it on, a token minted before `endRoom` re-creates the room after the platform ended it, with no participant limit.
- The full-codebase review that the Phase 0 schedule planned as a separate week is not inside the thirty days: it runs after day 30, in the improvement time, once the MVP is complete. Within the thirty days every batch still gets its own review. *(Amended 2026-11-16, the owner's plan of 2026-11-15: it runs on 11/20–21, in two waves of read-only reviewers, before the design week.)*

**Why separate this**

Because no new features are added here, and every team that breaks that rule resubmits in month five.

**Definition of done**

- Reviewers can open and use the app from their own network
- A backup has been restored, not merely taken
- Submitted to Google Play, through its closed test, for the first release; the App Store at its own first submission *(amended 2026-11-10, SRS DEC-62; «The road to the store»)*

---

## After the MVP

Features decided for after the MVP. None is built before every phase has closed, except what «The road to the store» moves before the server *(amended 2026-11-10, the owner's decisions of 2026-11-09 and of 2026-11-10 on B37's conflict check, Q1)*.

- **An assessment first, then a program paid in stages** — **moved before the server** (the owner's decision of 2026-11-09): its rules are SRS §3.5.1 (FR-BOOK-13 to FR-BOOK-19) and ADR 0024, its cycle runs on 11/23 and its build 11/24–11/30 («The road to the store»); returning after a close: closed 2026-11-16 by DEC-83. The first wording here (the owner's decision of 2026-11-03: the first payment for the assessment only; the rest in full or by instalments charged every period the platform sets) is superseded: the assessment's fee is part of the package's price, the instalments are monthly and on the ijazah track only. What its build changes, from this section's first wording and still true: an enrollment confirmed in stages; several paid orders on one enrollment, each with its kind, FR-375 amended to tell them apart (SRS FR-PAYG-19 as amended); the number and length of sessions set after the assessment. Phase 3 already reads the number and length of sessions from the enrollment's snapshot and assumes no one-time generation (`specs/004-sessions/spec.md` FR-424). *(Amended 2026-11-16: built 11/16–11/19 in track 2, its own short Spec Kit cycle first, `specs/006-programme/` (R-PROC-1); `specs/003-booking/tasks.md` T104, T101 and T102 start at once under 003's spec, where they are.)*

---

## The first update (v1.1)

Decided before launch and built after it (SRS DEC-70; the owner's decisions of 2026-11-15 and 2026-11-16). Each line has its task where its phase lives; each goes through the formal change (SRS, then tasks, then code) before it is built.

- Ratings and reviews (FR-REVIEW-1…5) — Phase 4's tasks, `specs/005-certification/tasks.md`, «v1.1»
- The public certificate verification page and its QR code (FR-IJAZAH-10; FR-IJAZAH-8's endpoint) — the same
- The notification centre (FR-NOTIF-2) — the same
- Every other push kind of FR-NOTIF-1 — the same
- Make-up-only times and a sooner Teacher-No-Show remedy (changes FR-MAKEUP-3 and ADR 0018) — `specs/004-sessions/tasks.md`, «Batches», v1.1
- An on-device document scanner for a teacher's uploads — `specs/002-identity/tasks.md` T171
- `specs/004-sessions/tasks.md` T054 and T055, during the closed test (they add no feature; the Max plan runs to 12/25, amended 2026-11-21)
- A push telling the Student that payment has opened once the Teacher's payout account is verified (SRS DEC-101; PR #153's review, round 4, follow-up 1) — `specs/006-programme/tasks.md`, the note under T016

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