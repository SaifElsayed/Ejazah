# Feature Specification: Phase 1 — Identity and teacher onboarding

**Feature Branch**: `002-identity`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Read PLAN.md and create a specification for Phase 1: Identity and teacher onboarding (T177)"

## Overview

**Objective, from PLAN.md**: let a teacher apply and an admin approve them, with
the identity model built right the first time.

Phase 1 ships the first thing a person can do with the product: sign in, become
exactly one account, and — if they are a teacher — apply with their identity
document and one ijazah PDF per subject, be reviewed by an admin who transcribes
each chain, be approved, and set up the payout account the gateway must verify
before a student can ever see them. On the other side of the glass it ships the
admin's own identity (a separate class of principal, with mandatory multi-factor
authentication and a lockout that reveals nothing), the audit record every
administrative action leaves, and the first screens of both applications drawn
from the design the repository already holds (ADR 0020).

Phase 0 built the machines that refuse a rule violation; Phase 1 is the first
phase whose code those machines judge. So this phase is also where several of
Phase 0's open proofs close: the output schema on every procedure (R-HONEST-4,
T169), the absence of any client path to gender (R-GENDER-6), the gate that
keeps a hidden mobile control honest (R-MOBILE-13), and the two adversarial
subjects the gender suite has never been shown to bite (R-GENDER-1, R-GENDER-3).

**Who builds it, and how big it is.** Phase 0's specification was written for a
team of three; this one is written for the owner working alone (PLAN.md,
2026-10-08), with Saif's review session as the reviewer of every batch. The
scope is the forty-four SRS requirement ids PLAN.md lists for Phase 1 and the
seven working days of one person, from 2026-10-17; nothing is added to it here,
and the six clarifications recorded below are the only additions, each
decided by the owner on 2026-10-17 on the recommendation written for it. Whatever cannot fit is stated
when it is found and goes to the descope ladder with its cause (PLAN.md,
"Extending a phase", "When a phase slips anyway"); it is never absorbed
silently. The steps of the definition of done that need a physical device —
the end-to-end teacher application, Arabic right-to-left on iOS and Android —
are the owner's own steps on the owner's devices, and the criteria below say so.

**Scope boundary.** This phase delivers identity, onboarding, account deletion,
the teacher application and its review, the admin shell, the audit label, payout
setup against the stand-in gateway, and the design's primitives, providers and
i18n runtime on both applications. It delivers no discovery, no profile a
student can read, no package, no availability, no booking, no payment order, no
session, no notification centre and no certificate: those are Phases 2 to 4. A
teacher approved in this phase is a row whose columns say "approved" and "payout
verified"; the query that would show them to a student is Phase 2's. The real
email sender and the real gateway are not here either: the email port ships
with its stand-in and meets its provider at launch (ARCHITECTURE §3.2), and the
gateway's hosted recipient onboarding is Phase 2's adapter (OPEN-11).

**Provenance.** Every requirement traces to a line in PLAN.md's Phase 1
deliverables, definition of done or "decisions carried out here", to an SRS
requirement id in Phase 1's list (FR-AUTH-1…15, §2.2, FR-VERIFY-1…11,
FR-PROFILE-11, FR-ISNAD-1/2, FR-ADMIN-1/17/19, FR-PAYG-12…16, FR-LOC-1/2/3), to
ADR 0011 to ADR 0021, to a table or rule in `docs/ERD.md` v1.3 and its addenda,
to a board in `docs/design/screens.md`, or to a rule identifier in the
constitution. What Phase 0 built is named here as given (the caller kinds, the
guards, the ports, the design tokens), never re-specified.

**Numbering.** Phase 0's specification numbers its requirements FR-001 to
FR-077 and its criteria SC-001 to SC-017, and other documents cite them by
those numbers ("FR-042 (spec)"). This specification numbers from FR-101 and
SC-101 so that a citation never needs the phase spelled out.

## Clarifications

### Session 2026-10-17

- Q: How does a gateway recipient event (`recipient_verified`, `recipient_rejected`) reach its teacher — a hash of the recipient reference beside `teacher_profiles.payout_account_ref_encrypted`, or a nullable `teacher_user_id` on `payment_events`? → A: The hash column, looked up without decrypting as `device_push_tokens.token_hash` is; the event table records only what the gateway sent (FR-109).
- Q: Is the drawn notification-permission step part of this phase, with the device push token registered against the stand-in? → A: No. The step and the token join the flow in Phase 4 with push delivery; this phase lands on the home or the application directly (FR-133).
- Q: ADR 0021 D4 (`SUPPORT_EMAIL` and the public configuration query) is placed in Phase 2, yet four screens of this phase show the address: move D4 here, or ship the screens without the line? → A: Move D4 into this phase (FR-145).
- Q: How is FR-VERIFY-6's notice met before the notifications module exists? → A: The status and payout screens are the notice; no `notifications` row and no push is written in this phase; the module's first task writes the rows for the kinds whose events already happen (FR-154).
- Q: Is `/settings/admins` (add, disable, second-factor reset) in this phase or with Phase 4's settings surface? → A: Whole in this phase (FR-174).
- Q: PLAN.md ties the R-GENDER-1/3 proof to "the teacher list", which is Phase 2's discovery; prove it here without a procedure, or wait? → A: Commit the two inverted subjects here; the proof is of the suite's bite (FR-211).

## User Scenarios & Testing _(mandatory)_

The people served by this phase are the product's own: a student signing in
for the first time, a teacher applying and then setting up payout, an admin
reviewing and deciding, and a person deleting their account. There is no
team-shaped story here; the data-model pass, the first screens and the proofs
that close are requirements (FR-101 to FR-111, FR-200 to FR-217), judged by
the machines Phase 0 built and by the reviewer, not demonstrated as journeys.
Each story is independently demonstrable and names the PLAN.md deliverables it
covers.

### User Story 1 - A person signs in once and becomes exactly one account (Priority: P1)

A person opens the app, picks a language, and continues with Google, with Apple
(on iOS) or with an email address and a password. A first sign-in proves the
identity — the provider's token verified on the server, or a six-digit code sent
to the address — and leads, before any other screen, to onboarding: the one
role, the display name, the gender, the date of birth, the time zone and the
Terms. The declared gender is shown back once more, because it cannot be changed
afterwards. On confirmation the account is written in one transaction and a
session is issued; before it, nothing of the person is stored anywhere. A
returning person goes straight to where their account stands.

_Covers PLAN.md: "Sign-up and sign-in with Google, Apple (iOS) or email and
password; … sign-in before onboarding (ADR 0012)", "Refresh tokens; password
reset for email accounts", "Email port with a stand-in adapter", "Rate limiting
on auth and OTP", "One role per account, chosen once at onboarding (ADR 0016)",
"Gender and date of birth capture", "Derived `is_minor` flag surfaced to admin",
"Versioned terms acceptance"._

**Why this priority**: Nothing else in the product has a caller until this
exists, and the two things the constitution guards hardest — that gender comes
from a verified identity and never from a client, and that no personal data of
a person who abandons the flow is kept — are decided by the shape of this flow.

**Independent Test**: On a device holding no account, complete each of the three
sign-in paths to the home; abandon the flow at every step and confirm the
database holds nothing of that person; sign in again and land on the home with
no question asked twice.

**Acceptance Scenarios**:

1. **Given** a Google or Apple token, **When** it is presented, **Then** the server verifies its signature, issuer, audience, expiry and the nonce it issued for that exchange before reading anything from it, and the account is keyed by the token's subject, never by its email (ADR 0012 D2).
2. **Given** a provider token whose email is not marked verified, **When** onboarding runs, **Then** the email is treated as absent, onboarding collects one and verifies it by a code, and every account ends with a verified email (ADR 0012 D2).
3. **Given** an email already belonging to an account that uses another sign-in method, **When** a provider sign-in or an email sign-up presents it, **Then** the person is neither signed in to that account nor merged with it, and is told which method that account uses, in the sheet drawn for each case (FR-AUTH-13, `SignInConflict`).
4. **Given** a first sign-in, **When** the identity is proven, **Then** the app receives a short-lived, single-purpose onboarding token that only the completing step accepts; **When** that step runs, **Then** the account row, its sign-in identity or password hash, its single role and its terms acceptance are written in one transaction and a session is issued only then (FR-AUTH-12).
5. **Given** an onboarding abandoned at any step, or an onboarding token that expires, **When** the database is inspected, **Then** no row of that person exists in any table (ADR 0012 D4, NFR-COMP-2).
6. **Given** the onboarding form, **When** it is shown, **Then** the role is a choice of exactly student or teacher with no way to add the other later, the gender is mandatory and shown back on its own confirmation step, the date of birth never blocks, the time zone defaults to the device's and may be changed from a city list, and «متابعة» is disabled until the Terms box is ticked (FR-AUTH-2/3/4/10/11, ADR 0016 D1, screens.md rules).
7. **Given** a terms acceptance, **When** it is recorded, **Then** it carries the version and the instant, the version comes from the settings store, and the Terms body the person read is served content carrying that version (FR-AUTH-11, ADR 0021 D5).
8. **Given** an email sign-up, **When** the password is chosen, **Then** eight characters is the only length rule, no composition rule exists, a breached-password check runs on the server, and the length is capped (NIST SP 800-63B; screens.md rules).
9. **Given** an email account, **When** a reset is requested, **Then** a code goes to the verified address, the same sentence answers every address whether known or not, and saving the new password signs the person in (FR-AUTH-6, `ForgotPassword`, `ResetPassword`).
10. **Given** a returning person, **When** they sign in, **Then** the router lands by the account's standing: a student on the student home, a teacher with an open application on its status, an approved teacher on the teacher tabs, a suspended or banned account on its restricted screen, a verification-required account on its home with the identity-upload banner (FR-137) (screens.md rules of 2026-10-17).
11. **Given** any authentication or one-time-code path, **When** it is called beyond its declared limit, **Then** further calls are throttled before any password or code is verified, under the per-subject key and the platform-wide budget (NFR-SEC-10, T170).
12. **Given** a date of birth, **When** an admin views the person, **Then** the minor flag is shown, computed on read and stored nowhere (FR-AUTH-4, R-DB-4).

---

### User Story 2 - A teacher applies with credentials only, and is reviewed by a person (Priority: P1)

A teacher who has just chosen the teacher role lands in the application: the
subjects they teach from the admin's list, a sentence on their qualification,
one identity document, and one ijazah PDF per subject. They submit only when
every subject has its PDF, and nothing about money is asked. The application
appears in the admin's queue with its documents behind signed, expiring links.
The admin reviews each credential beside a transcription form — the holder's
name, the riwaya, the tariq where there is one, the chain origin first, each
generation one or more names, of any length — and approves, rejects with a
reason, or asks for another document. The admin records the verification call
held outside the app; only then does Approve become available. The applicant
sees every step on their status screen, re-uploads when asked, and reapplies
after a rejection; a banned applicant cannot.

_Covers PLAN.md: "Teacher application with document upload", "Signed expiring
URLs, encrypted at rest", "Verification queue: approve, reject, request more,
ban", "Credential review before approval: each ijazah PDF reviewed and its chain
transcribed by the admin (FR-ISNAD-1/2, FR-ADMIN-19, FR-PROFILE-11; ADR 0017
D5)", and the definition of done items "A teacher applies end to end on a
physical device", "An admin reviews each credential, approves them, and the
audit log records it", "Approval is blocked until the verification call is
recorded"._

**Why this priority**: Trust in credentials is the product's whole claim (SRS
§3.2). The transcription the admin makes here is the chain every certificate of
Phase 4 prints, and the owner decided that the teacher never types it.

**Independent Test**: On a physical device, apply with two subjects; on the admin
panel, request another document, receive the re-upload, transcribe both chains,
approve one credential and reject the other, attempt Approve before the call is
recorded and be refused, record the call, approve. The device shows each state
as it happens; the audit log holds every decision with its reason.

**Acceptance Scenarios**:

1. **Given** the application form, **When** its schemas are inspected, **Then** no field for a payout, bank, wallet or account detail exists in any of them (FR-VERIFY-11, FR-PAYG-12).
2. **Given** a chosen subject without a PDF, **When** the applicant tries to submit, **Then** the control is disabled and the server refuses an application missing a credential for a chosen subject (`ApplyIjazah`).
3. **Given** an uploaded file, **When** it is accepted, **Then** its type was decided by its content and PDF is the only type admitted for an identity document or a credential, a size limit applies, the identity document's storage reference is encrypted in its column, and the file is reachable only through a signed, expiring link given to the uploader or an admin (NFR-SEC-2/3/9, R-SEC-4, R-DB-8).
4. **Given** a submitted application, **When** the admin opens the queue, **Then** it lists pending, waiting-on-applicant and decided applications, oldest first, searchable by name or email, with the applicant's documents, subjects, qualification, gender, minor flag and the call record (FR-VERIFY-3, FR-ADMIN-2).
5. **Given** a credential, **When** the admin reviews it, **Then** the PDF sits beside the form for the holder's name, the riwaya, the tariq and the chain; approving writes the chain and makes the subject the teacher's; rejecting needs a reason; requesting another document sets the credential waiting until the teacher uploads one, then returns it to the queue (FR-ISNAD-1/2, FR-ADMIN-19, ADR 0017 D1).
6. **Given** a transcribed chain, **When** the teacher views it, **Then** it is read-only; **When** an admin corrects it, **Then** the correction needs a reason and the audit entry holds the chain before and after (FR-ISNAD-4, `AdminCredentialCorrect`).
7. **Given** an application whose verification call is not recorded, or one of whose credentials is still pending or waiting on a document, or none of whose credentials is approved, **When** Approve is attempted, **Then** the server refuses it; the control is disabled for the same reasons (FR-VERIFY-5, ADR 0017 D5).
8. **Given** a decision, **When** it is made, **Then** rejection and ban carry a mandatory note the applicant sees, a request for information carries the choices and the mandatory text, approval's note is optional, and every one writes an audit entry with its reason (FR-VERIFY-4, FR-ADMIN-17, screens.md §24).
9. **Given** a rejected applicant, **When** they reapply, **Then** a new application opens with new documents and the old stays in history; **Given** a banned applicant, **When** they sign in, **Then** they see the banned state and no path to apply (FR-VERIFY-9, `ApplicationRejected`).
10. **Given** an approved teacher, **When** they add a subject with its PDF, **Then** a pending credential waits for review and the subject is theirs only once approved (FR-PROFILE-11, ADR 0017 D2).
11. **Given** an admin, **When** they require an identity document from a user, **Then** the request carries a reason, the account enters the verification-required state, the user sees the upload screen, and the admin accepts the document or asks for another, each audited (FR-VERIFY-10, FR-ADMIN-16).
12. **Given** an approved teacher, **When** an admin suspends them, withdraws their approval, or bans them, **Then** the status changes at once with a mandatory reason, every session of theirs is revoked, and the consequences that need sessions and enrollments (FR-SESS-16) attach through one entry when those records exist (FR-VERIFY-8/9).

---

### User Story 3 - An admin is a different kind of principal, and leaves a record (Priority: P1)

An admin signs in on a separate page with an email and a password, then a
six-digit code from an authenticator app; at a first sign-in they set the app
up and save ten single-use recovery codes. Five wrong attempts lock the account
for fifteen minutes, and the screen never says which it was or how many remain.
Another admin can reset a lost second factor, with a reason. Every action an
admin takes writes an audit entry whose target is named by its kind and
identifier, never by a person's name, so the entry outlives a renamed or deleted
person unchanged; the panel shows the current name beside it.

_Covers PLAN.md: "Admin shell with mandatory MFA", "Audit log written from day
one", ADR 0021 D2 ("a task here"), ADR 0019 D2/D3, and the ERD amendment "the
admin panel's authentication transport (a bearer header, no cookies)"._

**Why this priority**: The admin is the only principal who can approve a
teacher, and the audit log is the only record of why. A back office whose
sign-in can be locked by a stranger, or whose log names people, is one the owner
cannot operate or defend.

**Independent Test**: Sign in as the seeded admin, set up the second factor,
sign out, sign in with a recovery code; lock the account by five wrong passwords
and compare the two refusals byte for byte and in timing; take one action and
read its audit entry; rename the target and read the entry again.

**Acceptance Scenarios**:

1. **Given** the admin sign-in, **When** it is inspected, **Then** it shares no table, token, session store or middleware path with user sign-in, offers no sign-up, no password reset and no provider button, and carries its session in a bearer header with no cookie, so no cross-site request can ride it (FR-ADMIN-1, R-SEC-8, NFR-SEC-6).
2. **Given** an admin without a second factor, **When** they first sign in, **Then** they cannot reach any page until the authenticator is set up and the ten recovery codes are issued; the codes are stored hashed, each used once, and can be regenerated (ADR 0019 D3, `AdminMfaSetup`).
3. **Given** five failed attempts, **When** the sixth arrives within the window, **Then** the account is locked for the configured duration; the locked answer and the wrong-password answer have the same body, the same status and the same timing, and no response ever carries an attempts count (ADR 0019 D3).
4. **Given** the lockout, **When** its place is inspected, **Then** it stands behind the per-subject throttle and budget of the authentication path, so a stranger who knows an admin's email cannot lock them out beyond that budget (ADR 0011 D3, ADR 0019 D3).
5. **Given** an admin whose second factor is lost, **When** another admin resets it with a reason, **Then** the authenticator and the recovery codes are cancelled, open sessions end, the next sign-in sets up again, and the reset is audited (ADR 0019 D3, `AdminMfaResetDialog`).
6. **Given** any administrative action, **When** it completes, **Then** its audit entry carries `target_label`: the target's kind word and its stable identifier or public number, at most 200 characters, never a name and never text anyone typed, rendered once at write time; an empty or longer label is refused and the action is not kept (ADR 0021 D2, FR-ADMIN-17).
7. **Given** an audit entry whose target was renamed or deleted, **When** it is read, **Then** the stored label is unchanged, the current name is resolved beside it at read time, and a deleted person resolves to the role word (ADR 0021 D2, ADR 0015 D3).
8. **Given** the panel, **When** the language is switched, **Then** the chrome follows in Arabic (RTL, default) or English (LTR) without signing out, and user-typed content stays as typed, isolated for direction (FR-LOC-5, ADR 0014 D2).

---

### User Story 4 - An approved teacher sets up payout and stays invisible until the gateway says so (Priority: P2)

After approval the app presents payout setup: the teacher registers a payout
account with the gateway from inside the app, and the platform keeps only the
gateway's recipient reference, encrypted, with the instants it was configured
and verified. Until the gateway reports the account verified, the teacher is
not discoverable, not bookable and cannot publish; the moment it does, those
unlock on their own. A teacher may replace the account at any time and is
hidden again until the new one is verified.

_Covers PLAN.md: "Post-approval payout setup in-app via the payment port;
recipient reference stored encrypted; teacher invisible and unbookable until the
gateway verifies it (ADR 0007 D3)", "Payout setup is the first consumer of the
gateway's `recipient_verified` and `recipient_rejected` events, so this phase
decides … how such an event is routed to its teacher", and the definition of
done item "An approved teacher without a verified payout account appears nowhere
and cannot publish"._

**Why this priority**: It is the fourth conjunct of the visibility predicate
(SRS §3.7.1) and the one Phase 2 cannot invent for itself. It ranks P2 because
in this phase its enforcement point is the standing the server resolves per
request; the query that would show a teacher does not exist until Phase 2.

**Independent Test**: Approve a teacher; see payout setup presented; register
through the stand-in gateway; drive a `recipient_rejected` event and see the
rejected screen with the gateway's reason; drive `recipient_verified` and see
the verified screen; replace the account and see the verification state return.

**Acceptance Scenarios**:

1. **Given** an approved teacher without a payout account, **When** they open the app, **Then** payout setup is presented as the first next step, and no screen of theirs offers to publish anything (FR-PAYG-13, FR-VERIFY-7, `ApplicationApproved`).
2. **Given** a registration through the payment port, **When** it completes, **Then** the stored columns are the recipient reference, encrypted and bound to its row, and the configured instant; no raw account number exists in any column, log or response (FR-PAYG-13, NFR-SEC-2, R-DB-8).
3. **Given** a signed `recipient_verified` or `recipient_rejected` event, **When** it arrives, **Then** the signature is checked on the raw body before any handler, a replay is acknowledged with no effect, the event is routed to its teacher, and the verified instant is set or the rejected reason shown (FR-PAYG-15, R-MONEY-9, R-MONEY-8).
4. **Given** a teacher whose payout is not verified, **When** any publishing path is called, **Then** the caller kind refuses it from the standing the server resolved on that request, and the column the Phase 2 predicate reads says the same (FR-PAYG-14).
5. **Given** a replaced payout account, **When** the change is made, **Then** the verified instant is cleared until the new account is verified and the screen says the teacher is hidden meanwhile (FR-PAYG-16).
6. **Given** the stand-in gateway, **When** the suite runs with no provider credential, **Then** every scenario above passes against it, and the provisional `PayoutDetails` fields are the stand-in's until the gateway is selected (OPEN-11).

---

### User Story 5 - A person deletes their account, in the app or on the web (Priority: P2)

From Account, a person reads what is deleted, what is kept and why, and what
happens to their enrollments; types the confirmation word; signs in again; and
confirms once more. Deletion is immediate and final: every session and refresh
token is revoked, a Sign in with Apple token is revoked, push tokens are
removed, the account is soft-deleted with its personal fields erased, its
provider identity rows deleted, and its email freed for a new account. The same
deletion is reachable without the app, from a public page, by the account's
email and a code sent to it.

_Covers PLAN.md: "Account deletion in the app and on the web, with the retention
rules (FR-AUTH-14/15, ADR 0015)", and ADR 0021 D5's conditions for "this phase's
public pages, the web account deletion (FR-AUTH-14) and the Terms body
(FR-AUTH-11)"._

**Why this priority**: Both stores require it of an app that creates accounts,
and the erasure rules decide what the rest of the model keeps. It ranks P2
because the records it has consequences for — enrollments, sessions, cases —
arrive in later phases, which attach to the one entry this story leaves.

**Independent Test**: Delete an account from the app and another from the web
page; read the row and confirm every personal field is erased and the identity
rows are gone; present the old refresh token and be refused; sign up again with
the same email and succeed; a banned account's deletion is refused that sign-up (T097).

**Acceptance Scenarios**:

1. **Given** the deletion screen, **When** it is shown, **Then** it states what is deleted, what is kept and why, and that upcoming sessions are cancelled without compensation (student) or that the administration contacts the students about compensation (teacher), before anything happens (ADR 0015 D1, `DeleteAccount`, `DeleteAccountTeacher`).
2. **Given** the confirmation, **When** it runs, **Then** it requires the typed word, a fresh provider re-authentication or the password, and a final confirm, in that order (ADR 0015 D1).
3. **Given** a deletion, **When** it completes, **Then** in one transaction the row is soft-deleted; display name, email, phone, password hash, date of birth, photo and certificate name are erased; the provider identity rows are deleted; every session and refresh token is revoked; push tokens are removed; a teacher's bio, documents and payout reference are erased; and the audit log, gateway records and history rows stay without those fields (ADR 0015 D3, FR-AUTH-14).
4. **Given** a deleted account's email, **When** a new sign-up presents it, **Then** it succeeds; and **Given** a deleted Apple account, **When** the deletion ran, **Then** the Apple token was revoked (ADR 0015 D1/D3).
5. **Given** the public deletion page, **When** an email is entered, **Then** the same sentence answers every address, a code goes to the address if it belongs to an account, and the code step runs the same deletion as the app; **Then** the done page says the confirmation was sent to that address (FR-AUTH-15, `DeleteAccountWeb*`).
6. **Given** the public pages (the deletion flow and the Terms body), **When** their responses are inspected, **Then** they are routes of the API under their own paths, send a strict Content-Security-Policy and the full header set and CORS allowlist, set no cookie, are rendered from templates that escape every value, and run under the anonymous rate limits; English is `?lang=en` (ADR 0021 D5).
7. **Given** a record kind a later phase adds (an enrollment, a session, a case), **When** that phase lands, **Then** its deletion consequence attaches through the deletion's single entry and the deletion's own transaction is unchanged (ADR 0015 D4).

---

### Edge Cases

- **A provider sends the name only once.** Apple sends the person's name on the first authorization only; the display-name step is prefilled when a name is offered and typed otherwise, and nothing is lost if the token expires before completion, because the person signs in again (ADR 0012 D4).
- **The onboarding token outlives its purpose.** It is accepted by the completing step and the email-code request alone, the completing step once, within its lifetime; presented anywhere else, or twice, it is refused, and a refusal reveals nothing about whether an account exists.
- **The same email, three ways.** An email sign-up for an address held by a Google account, a Google sign-in for an address held by an email account, an Apple sign-in for an address held by Google: each is the conflict sheet with the body and primary button for that case, never a merge (FR-AUTH-13; decision 3).
- **A reset request for a provider address.** The same sentence answers it; the page never says which addresses have no password (decision 4).
- **A code is wrong, expired or tried too often.** The cells show the generic error; attempts count against the code's own limit and against the one-time-code throttle; a consumed code is dead.
- **A minor applies to teach.** Nothing blocks; the flag is on the applicant's detail for the admin to weigh (FR-AUTH-4, DEC-04).
- **The applicant's device time zone is unknown.** The picker falls back to a city the person chooses; IP geolocation is a last resort, never authoritative (FR-AUTH-10 note).
- **A credential is asked for a document twice.** Each request sets it waiting again with the new note; the teacher sees the latest note and uploads; the queue shows it once.
- **Approval with a mixed outcome.** One credential approved, one rejected: Approve is available, the approved subject is the teacher's, the rejected one is unavailable with its reason, and the teacher can add it again with another PDF (ADR 0017 D2).
- **A teacher deletes their account mid-application.** The deletion runs as for any account; the application, its documents and its credentials are erased with the teacher data (ADR 0015 D3); the queue no longer lists it.
- **A suspended person is still signed in.** Standing is resolved on every request, so the next call answers the restricted state and the screen follows; sessions are revoked as well so the token does not outlive the suspension.
- **An admin is locked while the throttle is also hit.** The throttle answers first, then the lockout; both answer the same sentence (ADR 0019 D3).
- **The last admin loses their second factor.** No other admin can reset it; recovery codes are the way back, which is why they are issued at setup and may be regenerated. The seed plants one admin; operating with two is the owner's choice.
- **A recipient event names a reference nobody holds.** It is recorded as every signed event is, routed to no teacher, and reported for an operator; it changes no row.
- **A gateway rejects, then verifies on retry.** The rejected reason is replaced by the verified instant; the rejected screen is history.
- **The Terms change.** The accepted version is what the record proves; forcing re-acceptance at the next sign-in is not required here, because no version changes before launch (Assumptions).
- **The support address is absent.** The screens that show it read it from configuration and fall back to the last cached value; a missing value never blocks start-up (ADR 0021 D4, and the clarification below on where it lands).

## Requirements _(mandatory)_

Each requirement traces to a PLAN.md Phase 1 line, an SRS requirement id in the
phase's list, an ADR decision, a table or rule in `docs/ERD.md`, a board in
`docs/design/screens.md`, or a constitution rule identifier.

### Functional Requirements

**The data-model pass (before any identity code; R-PROC-2)**

- **FR-101**: The model MUST gain a table of user sessions and a separate table of administrator sessions, each holding its refresh token only as a hash, with the instants it was issued, expires and was revoked, and the device it belongs to, so that server-side revocation (FR-AUTH-7) is a row and administrator identity shares no table with user identity (R-SEC-8, R-DB-7).
- **FR-102**: The model MUST gain `auth_identities` (`user_id`, `provider` google · apple, `provider_subject`, `created_at`), unique on `(provider, provider_subject)`, by a forward migration (ADR 0012 D2); its rows are deleted outright on account deletion (ADR 0015 D3).
- **FR-103**: `user_roles` MUST be unique on `user_id` (ADR 0016 D3), and `users` MUST keep its NOT NULL guarantee for every live row — by the check of rule 32 (data-model §5), since FR-141 erases two of the columns on deletion — because a row is written only when onboarding completes (ADR 0012 D4; reworded 2026-10-17 on PR #74's review, round 2, finding 3).
- **FR-104**: The model MUST gain `teacher_credentials` and re-key `isnad_entries` under it exactly as ADR 0017 D5 and the ERD's §4 amendment state, with `holder_name` (ADR 0019 D1), one approved credential per `(teacher_user_id, subject_id)`, and `(credential_id, position)` unique (ERD §15 rule 7).
- **FR-105**: The model MUST gain `users.certificate_name`, `admin_recovery_codes` (`admin_id`, `code_hash`, `used_at`) and the two seeded lockout settings (ADR 0019); `audit_logs.target_label text NOT NULL` before the first administrative action is written (ADR 0021 D2); `enrollments.cancellation_reason` = `account_deleted` (ADR 0015); and ADR 0018's Phase 1 columns and table: `packages.track`, `enrollments.snapshot_track`, `sessions.makeup_for_session_id`, `session_remedies`, and the make-up choice window setting.
- **FR-106**: `idempotency_keys` MUST be unique on `(scope, actor_id, key)` rather than `(scope, key)`, so two actors reusing a key never collide and a repeat by one actor returns its own first outcome (ADR 0011, deferred list; FR-042).
- **FR-107**: `otp_codes` MUST carry an index on `(destination, purpose)`, and three idempotent purge sweeps MUST exist, for consumed or expired codes, for stale push tokens and for expired or long-revoked sessions (FR-135), each with a double-run assertion (R-API-14, NFR-COMP-2).
- **FR-108**: The request context MUST resolve, on every authenticated call, the account's status, its single role, and for a teacher the profile's approval and payout verification, from the server's own records; and the caller kind that admits a teacher applicant (for the application, status and account paths) MUST be declared distinctly from the kind that admits an approved teacher, so `teacherProcedure` has one meaning (FR-VERIFY-8/10, FR-GENDER-6, ARCHITECTURE §7.2, `contracts/kernel.md`).
- **FR-109**: The model MUST say how a gateway recipient event reaches its teacher: a hash of the gateway's recipient reference stored beside `teacher_profiles.payout_account_ref_encrypted`, looked up without decrypting as `device_push_tokens.token_hash` is, so the event table records only what the gateway sent and nothing the platform added (clarified 2026-10-17; note under T117).
- **FR-110**: Every table the pass adds MUST land in exactly one owning module of the table-ownership manifest, and the ERD's count, its §1 domain map, the SRS §6.2 entity list and ARCHITECTURE §4 MUST say the same (R-API-6, FR-022).
- **FR-111**: The document conflicts the closure review listed and the follow-ups of PR #70 to #72 MUST be corrected in the same pass and each correction recorded: ADR 0001 on the payment port, `/ready` and Redis, NFR-SEC-7's push protection, SRS §6.2 and §3.14 against the ERD, ADR 0005's superseded decisions, the rule count; ADR 0012 D5's parenthesis, the order of the DEC rows, the stray spaces; and SRS §2.5, which still says the MVP is built by "2 full-time, 1 part-time" while PLAN.md has recorded a team of one since 2026-10-08 (R-PROC-2, ADR 0011).

**Sign-in and onboarding**

- **FR-120**: The system MUST offer sign-up and sign-in with Google, with Apple on iOS, and with an email address and a password; an email account MUST prove its address by a six-digit code before onboarding; a Google or Apple account MUST be keyed by the provider's subject and never by its email (FR-AUTH-1, ADR 0012 D1/D2).
- **FR-121**: The server MUST verify every provider token's signature, issuer, audience and expiry, and MUST require the token's nonce to match the one it issued for that exchange, before reading anything from it; it MUST read the provider's email only when the token marks it verified, treating an unverified email as absent (ADR 0012 D2).
- **FR-122**: A sign-in whose provider offers no verified email MUST collect an email during onboarding and verify it by a code before the account is written, so every account has a verified email and `users.email` is never empty (ADR 0012 D2, FR-AUTH-12).
- **FR-123**: A provider sign-in or an email sign-up whose email already belongs to another account MUST neither sign in to it nor merge with it, and MUST tell the person which method that account uses, with the body and primary action drawn for that case; no path links a second method to an account (FR-AUTH-13, ADR 0012 D3; decision 3).
- **FR-124**: Sign-in MUST come before onboarding, in the drawn order: welcome and language, sign-in, role, then display name, gender, date of birth, time zone and Terms on one step, then the gender confirmation; a returning person MUST land by their standing without any step repeated (FR-AUTH-12, ADR 0012 D4; screens.md rules).
- **FR-125**: A proven identity MUST be held in a short-lived, single-purpose onboarding token carrying the provider and subject, or the verified email, with the name and email the provider offered for prefilling; only the completing step and the email-code request of FR-122 MUST accept it, the completing step once; the answers MUST be held on the device; and the completing step MUST write the account, its identity or password hash, its single role and its terms acceptance in one transaction and issue a session only then, so an abandoned flow leaves no row (FR-AUTH-12, ADR 0012 D4, NFR-COMP-2).
- **FR-126**: Onboarding MUST require exactly one role of student or teacher, chosen once with no later change or addition; a mandatory gender shown back on its own confirmation step; a date of birth that never blocks; the device time zone, changeable from a city list of IANA zones and later from Account; and acceptance of the Terms, with «متابعة» disabled until the box is ticked (FR-AUTH-2/3/4/10/11, ADR 0016 D1, FR-GENDER-1/5; decision 6).
- **FR-127**: A terms acceptance MUST record the version and the instant; the current version MUST be a settings key; and the Terms body MUST be served content carrying that version, read in the app's modal and on the web under the conditions of ADR 0021 D5 (FR-AUTH-11; decision 17).
- **FR-128**: A password MUST be at least eight characters with no composition rule, MUST be checked against known breached passwords on the server, and MUST have a length cap, so a pathological input cannot stall the hash (NIST SP 800-63B; PR #46 review; screens.md rules).
- **FR-129**: Password reset MUST exist only for email accounts, by a code to the verified address; the request MUST answer every address with the same sentence; and saving the new password MUST sign the person in and revoke every other session of the account (FR-AUTH-6; decision 4).
- **FR-130**: The student role MUST be usable immediately after onboarding; the teacher role MUST be pending, land on the application, and reach only the application, status, credentials-list and account paths until approved (FR-AUTH-8/9, FR-108).
- **FR-131**: The language MUST be switchable at any time without sign-out, stored on the account, and the device time zone MUST be re-read on every launch, with the manual override kept (FR-AUTH-5/10, FR-LOC-3).
- **FR-132**: The minor flag MUST be computed from the date of birth on read, never stored, and surfaced wherever an admin views a person (FR-AUTH-4, R-DB-4).
- **FR-133**: The notification-permission step drawn after the gender confirmation is NOT part of this phase: the student path lands on the home directly and the teacher path on the application; the step and the device push token join the flow in Phase 4 with push delivery, as one route inserted (clarified 2026-10-17; `NotificationPermission`).

**Sessions, revocation and standing**

- **FR-135**: Sessions MUST persist across app restarts by a refresh token with server-side revocation; sign-out MUST revoke the device's session; deletion, ban, suspension, a password reset and an admin second-factor reset MUST revoke every existing session of the principal (a reset's own new session excepted); and a refused token MUST not say whether it was revoked, expired or never issued (FR-AUTH-7).
- **FR-136**: Identity, role, gender and locale MUST come from the server-held session on every call; no write schema on either surface MUST carry them (R-GENDER-4, given by Phase 0's T159).
- **FR-137**: A suspended or banned account MUST be answered the restricted state by every procedure that does not declare it admits that standing, and the app MUST show the drawn restricted screen for the account's role; a verification-required account is admitted by every procedure of this phase (an applicant under a request must still reach the application) and refused by Phase 2's booking paths, the app showing the identity-upload banner from the account read (FR-VERIFY-8/10, ADR 0016 D2, `AccountRestricted`, `TeacherRestricted`, `VerifyIdentity`; reworded 2026-10-17 on PR #74's review, finding 9).
- **FR-138**: Every procedure MUST declare its output schema (given, T169), and a test over the contract snapshot MUST assert that no user-facing output names another person's date of birth, a document storage key, a password or second-factor hash, a provider subject or a recipient reference, so the first leak is caught by the machine and not by a reviewer (R-HONEST-4, R-API-9).
- **FR-139**: A CI test MUST assert that no user-facing procedure's input carries `gender`; declared gender MUST therefore be changeable through no user-facing path, and the admin's correction lands with the gender queue of Phase 4 (R-GENDER-6, FR-GENDER-5; Assumptions).

**Account deletion and the public pages**

- **FR-140**: A person MUST be able to delete their account from Account; the screen MUST state what is deleted, what is kept and why, and what happens to their enrollments, and confirmation MUST require the typed word, a fresh re-authentication, and a final confirm (FR-AUTH-14, ADR 0015 D1).
- **FR-141**: Deletion MUST be immediate and final, in one transaction: the row soft-deleted; display name, email, phone, password hash, date of birth, photo and certificate name erased; the provider identity rows deleted; every session revoked; push tokens removed; a Sign in with Apple token revoked; a teacher's bio, documents and payout reference erased; the email freed by the partial uniques; and the audit log, gateway records and history rows kept without those fields (ADR 0015 D3, FR-AUTH-14). The stored files (the photo, the documents) are removed and their keys cleared after the commit, and the Apple token is revoked after it, outside the transaction (the B16 check, decisions 1 and 3, note under T080).
- **FR-142**: The consequences of a deletion for enrollments, sessions and cases (ADR 0015 D4, FR-SESS-16) MUST attach through one entry of the deletion, so that Phase 2 and Phase 3 add theirs without changing the deletion's own transaction; the same entry MUST serve a teacher's suspension, revocation and ban (FR-VERIFY-8).
- **FR-143**: A public web page MUST let a person request deletion without the app: the account's email, a code sent to it, then the same deletion; the email step MUST answer every address with the same sentence; the done page MUST say the confirmation was sent to the address, and the system MUST send that confirmation through the email port (FR-AUTH-15, ADR 0015 D2, `DeleteAccountWeb*`).
- **FR-144**: The public pages of this phase — the deletion flow and the Terms body — MUST be routes of the API under their own paths, never mixed with the procedure routes, sending a strict Content-Security-Policy and the full header set and CORS allowlist of NFR-SEC-11, setting no cookie, rendered from templates that escape every value, under the anonymous rate limits, with English by `?lang=en` (ADR 0021 D5).
- **FR-145**: The support address shown on `PayoutRejected`, `TeacherRestricted`, `AccountRestricted` and `DeleteAccountWebDone` MUST come from ADR 0021 D4, carried out in this phase rather than Phase 2 (clarified 2026-10-17): `SUPPORT_EMAIL` a required key of the environment schema with no default, a valid address, added to `.env.example` in the same change and never an admin setting; served by one unauthenticated, rate-limited, cacheable query with an output schema returning the address; the apps cache the last value and never block start-up on it; the `mailto:` of «تواصل مع الدعم» is built from the same value.

**The teacher application**

- **FR-150**: The application MUST collect the subjects from the admin's list, a qualification sentence, one identity document (national ID or passport) and one ijazah PDF per chosen subject, and MUST be submittable only when every chosen subject has its PDF; no schema of the application MUST carry any payout, bank, wallet or account field (FR-VERIFY-1/2/11, FR-PAYG-12, ADR 0017 D1).
- **FR-151**: Every uploaded document MUST have its type decided by its content with PDF the only type admitted for an identity document or a credential, MUST observe the configured size limit, MUST be stored through the storage port with the identity document's reference encrypted in its column, and MUST be reachable only by a signed, expiring link issued to the uploader or an admin (NFR-SEC-2/3/9, R-SEC-3/4, R-DB-8).
- **FR-152**: The applicant MUST see the application's standing on one screen in each drawn state: in review with its timeline; waiting on a document with the reviewer's note, the re-upload and resubmission that returns it to the queue; rejected with the note and the way to reapply; approved, shown once on the first launch after approval and then the tabs (FR-VERIFY-6, `ApplicationStatus`, `ApplicationMoreInfo`, `ApplicationRejected`, `ApplicationApproved`); a banned account sees the restricted screen of FR-137, never this one.
- **FR-153**: An approved teacher MUST be able to add a subject by choosing it and uploading its PDF; the credential MUST wait for review and the subject MUST become the teacher's only on approval; the credentials screen MUST show each credential with its status, the transcribed chain read-only, and the needs-document state with its re-upload (FR-PROFILE-11, FR-ISNAD-1/5, ADR 0017 D2, `TeacherCredentials`, `AddSubject`, `CredentialNeedsDocument`).
- **FR-154**: Notice of a decision to the applicant (FR-VERIFY-6) is, in this phase, the status screen and the payout screens, which carry the state on the next open; no `notifications` row and no push is written here (clarified 2026-10-17). The enum members already exist (`teacher_application_status_changed`, `credential_reviewed`, `payout_account_verified`, `payout_account_rejected`), and the first task of the phase that builds the notifications module (Phase 4, PLAN.md) writes the rows and the delivery for the kinds whose events already happen.
- **FR-155**: A rejected applicant MUST be able to reapply with a new application and new documents, the earlier one kept in history; a banned account MUST reach neither the application nor sign-in beyond the banned state, and a new application under the same email MUST be refused (FR-VERIFY-9).

**Credential review and the admin's decisions**

- **FR-160**: The admin MUST have a verification queue listing applications as in review, waiting on the applicant and decided, oldest first, searchable by name or email, each opening to the applicant's documents in a view-only viewer, their subjects and qualification, their gender and minor flag, and the verification call record (FR-VERIFY-3, FR-ADMIN-2, `AdminApplications`, `AdminDocumentViewer`).
- **FR-161**: The admin MUST record the verification call — completed date, outcome and notes — and Approve MUST be refused by the server, and disabled on the screen, until the call is recorded, every credential of the application is decided, and at least one is approved (FR-VERIFY-5, ADR 0017 D5).
- **FR-162**: The admin MUST be able to approve, reject, request more information from, or ban an applicant; rejection and ban MUST carry a reason choice and a mandatory note the applicant sees, a request MUST carry the choice of what is needed and the mandatory text and MUST set the application waiting until the upload returns it to the queue, approval's note MUST be optional, and a ban MUST be permanent and not lifted from the panel (FR-VERIFY-4/9, FR-ADMIN-3, screens.md §24; decision 28). A rejection MUST close the application's undecided credentials, each still pending or waiting on a document becoming rejected with the rejection's note as its reason (T122).
- **FR-163**: Each credential MUST be reviewed with the PDF beside a form for the holder's name, the riwaya, the tariq where there is one, and the chain origin first as generations each holding one or more names with no maximum length; approval MUST write the transcription as the teacher's verified chain for that subject; rejection MUST carry a reason; a request for another document MUST set the credential waiting until the teacher uploads (FR-ISNAD-1/2/3, FR-ADMIN-19, ADR 0017 D1, `AdminCredentials`).
- **FR-164**: Only an admin MUST be able to correct a transcribed chain, with a mandatory reason, the audit entry holding the chain before and after; the teacher MUST never edit it (FR-ISNAD-4, `AdminCredentialCorrect`).
- **FR-165**: An admin MUST be able to suspend, revoke the approval of, or ban an approved teacher with a mandatory reason, and to reinstate a suspended one, who MUST return to the verification-required state while an identity request of theirs is open and to active otherwise (T113); the change MUST take effect on the next request through FR-108, revoke every session, and attach its session and enrollment consequences through FR-142 (FR-VERIFY-8/9, ADR 0016 D2, screens.md §24).
- **FR-166**: An admin MUST be able to require an identity document from any user with a reason, which MUST place the account in the verification-required state; the user MUST be able to upload the document on the drawn screen; the admin MUST be able to accept it or ask for another, each audited, and MUST never modify or replace a document (FR-VERIFY-10, FR-ADMIN-16, DEC-13b, `VerifyIdentity`). In this phase the action is reached from an applicant's or a teacher's detail; the user directory (FR-ADMIN-4) is a later phase.

**Administrator identity**

- **FR-170**: Admin authentication MUST be separate from user sign-in in table, token, session store and middleware, restricted to accounts an admin created, with mandatory multi-factor authentication by a time-based code, and carried in a bearer header with no cookie (FR-ADMIN-1, NFR-SEC-6, R-SEC-8; the ERD amendment on transport).
- **FR-171**: A first sign-in MUST complete second-factor setup before any page is reachable: the secret shown as a QR and a manual key valid for that sign-in only, a code confirmed, and ten single-use recovery codes issued, stored hashed, downloadable once, and regenerable later (ADR 0019 D3, `AdminMfaSetup`, `AdminMfaRecovery`).
- **FR-172**: After the configured number of failed attempts the account MUST lock for the configured duration, both read from settings; the locked and wrong-credential answers MUST be the same message with the same status and timing; no response MUST carry an attempts count; and the lockout MUST stand behind the authentication throttle and budget, never in front of it (ADR 0019 D3, ADR 0011 D3, FR-ADMIN-1).
- **FR-173**: Another admin MUST be able to reset a lost second factor with a mandatory reason: the secret and the recovery codes cancelled, open sessions ended, setup repeated at the next sign-in, the reset audited (ADR 0019 D3).
- **FR-174**: The admins page `/settings/admins` MUST be built whole in this phase (clarified 2026-10-17): adding an admin (name and work email; a password-set link sent through the email port, then second-factor setup at the first sign-in, no page reachable before it), disabling one with a mandatory reason (no sign-in, open sessions ended, the name kept on every audited action), and the second-factor reset of FR-173; each action audited (ADR 0019 D2/D3, `AdminAdmins`, `AdminAddAdminDialog`, `AdminMfaResetDialog`).
- **FR-175**: The admin panel MUST be available in Arabic (default, RTL) and English (LTR), switchable without signing out, with user-typed content shown as typed and isolated for direction (FR-LOC-5, ADR 0014 D2).
- **FR-176**: The admin shell MUST render the drawn navigation and home for the queues this phase builds — applications, credentials, the latest actions — and the audit log page; a navigation entry whose page is a later phase MUST not be rendered until that phase lands (`AdminNav`, `AdminHome`, `AdminAudit`).

**Audit, subjects and settings**

- **FR-180**: Every administrative action MUST write an audit entry whose `target_label` is the target's kind word and its stable identifier or public number, at most 200 characters, never a person's name and never text anyone typed, rendered in Arabic once at write time from the target's type and id; the writer MUST refuse an empty or longer label and keep nothing of the action; the label MUST never be rewritten (ADR 0021 D2, FR-ADMIN-17, ERD §15 rule 21).
- **FR-181**: The admin pages MUST show the stored label and, beside it, the target's current display name resolved at read time, the role word for a deleted person; the fused Arabic forms and the three catalogue keys ADR 0021 D2 names MUST move to that server-side renderer, which owns their Arabic (ADR 0021 D2).
- **FR-182**: A subject MUST carry both names, `name_ar` and `name_en`, each mandatory wherever a subject is created, and every English page MUST show `name_en` where an Arabic page shows `name_ar`; no catalogue key MUST hold a subject name, and the two hint strings that embed one MUST take it from the subject list at render time (ADR 0021 D1, FR-LOC-1).
- **FR-183**: Every setting an identity or admin flow reads — the code lifetime, the attempt limits, the terms version, the lockout count and duration, the upload size limit — MUST come through the kernel's settings reader from the seeded `settings` rows, never a constant; the surface that edits them is Phase 4's (R-MONEY-12, R-PROC-11, FR-034).

**Payout setup and the visibility conjunct**

- **FR-190**: Immediately after approval the app MUST present payout setup, and the teacher MUST register a payout account with the gateway through the payment port from inside the app; the platform MUST store only the gateway's recipient reference, encrypted and bound to its row, with the configured instant, and never a raw account number (FR-PAYG-13, NFR-SEC-2, R-DB-8, ARCHITECTURE §8.2).
- **FR-191**: Verification MUST be learned from the gateway by its signed `recipient_verified` or `recipient_rejected` event, checked on the raw body before any handler, replay-safe by the provider's event id, routed to the teacher by FR-109, and recorded as the verified instant or shown as the rejected reason (FR-PAYG-15, R-MONEY-8/9, `PayoutVerified`, `PayoutRejected`).
- **FR-192**: Until the payout account is verified the teacher MUST not appear in discovery, be bookable or publish; in this phase the caller kind for every publishing path MUST refuse the unverified teacher from the standing FR-108 resolves, and the column the Phase 2 predicate reads MUST say the same (FR-PAYG-14, SRS §3.7.1).
- **FR-193**: A teacher MUST be able to replace the payout account at any time; the verified instant MUST clear until the new account is verified, the screen MUST say the teacher is hidden meanwhile, and already-confirmed enrollments MUST be unaffected (FR-PAYG-16, `PayoutSetup`).
- **FR-194**: The payment port's stand-in MUST serve every scenario of this story with no provider credential, and the `PayoutDetails` fields MUST stay provisional until the gateway is selected (OPEN-11; note under T117).

**The first screens (ADR 0020 D7)**

- **FR-200**: The phone's primitives MUST be built as the React Native code of the typed contracts in `apps/mobile/src/design/primitives/`, each matching its block of `components.md` and its visual specification; with the theme and direction providers, the `Icon` component over the registry, and the i18n runtime with its message-format library; the admin panel's component layer MUST implement the same contracts on its behaviour base themed by the same tokens (ADR 0020 D4/D7, ADR 0014 D1).
- **FR-201**: Every screen of this phase MUST be built from its board in `screens.md` with its copy from the catalogue: the sign-in screens and the conflict sheet; the onboarding screens, the time-zone picker, the Terms modal and the gender confirmation; the student account tab, profile editor, sign-out sheet, deletion screens, restricted screen and identity-upload screen; the teacher application screens and states; the payout screens; the credentials screens, add-subject and subject picker; the teacher account tab, deletion screens and restricted screen; the admin sign-in, second-factor and setup pages; the applications queue, the decision dialogs and the document viewer; the credentials page and the correction state; the home, navigation and audit page; and, subject to FR-174, the admins page and its dialogs (ADR 0020 D5).
- **FR-202**: A tab root whose feature is a later phase MUST render that feature's drawn empty or locked state with no data path, so the drawn tab bars exist from this phase (`StudentHomeEmpty`, `TeacherHomeEmpty`, `PackagesLocked`); the teacher's public profile editor (FR-PROFILE-1) is Phase 2's, and `ApplicationApproved`'s link to it lands then.
- **FR-203**: Layout MUST be logical, never directional; Arabic MUST render right-to-left and English left-to-right on iOS and Android, with numerals, dates and times through the shared formatters; plurals MUST use the five ICU forms and zero where drawn (FR-LOC-1/2, R-MOBILE-5/9, ADR 0020 D6).
- **FR-204**: The two phone catalogues and the two admin catalogues MUST each have identical key sets, checked in the pipeline, and no user-facing string MUST be a literal (R-MOBILE-7).
- **FR-205**: The states the design does not draw MUST use the generic patterns screens.md's states tables assign — skeleton, empty state, danger banner with retry — and every tab root and list MUST follow the offline pattern (screens.md, "States to implement that are not drawn").
- **FR-206**: No raw colour or spacing value MUST exist outside `design/`; a design change MUST be a change to `packages/tokens/tokens.json` or `docs/design/source/` and a rebuild, never a style override (R-MOBILE-4, ADR 0020 D1/D7).

**Rules, proofs and the change the machines judge**

- **FR-210**: A pipeline gate MUST refuse a change under the mobile feature trees that hides or disables an action when the same change carries no server test under the paths that hold the rule, naming R-MOBILE-13, designed on the path-coupling script of T163 with its path lists in one file (R-MOBILE-13; constitution 2.4.0).
- **FR-211**: The adversarial gender suite MUST gain two committed subjects it is seen to fail — one that drops the gender conjunct and one that applies the asymmetric v1.1 rule — asserted in both directions in the way the lint harness inverts a rule, in this phase and without waiting for a procedure that returns teacher data, closing R-GENDER-1 and R-GENDER-3 in the register (clarified 2026-10-17); Phase 2's teacher list is bound to the same cases.
- **FR-212**: Module code of this phase MUST contain no numeric literal other than 0 and 1: limits and windows as settings keys, input bounds in the contracts package, conversions in the time and money packages (R-MONEY-12, T157; PR #60 review n1).
- **FR-213**: The coverage floor MUST widen to the identity, verification, credential-holding and admin modules this phase creates, and never narrow (R-PROC-5, R-PROC-10).
- **FR-214**: A lint rule MUST refuse a relation read (`include`, `select`) that bypasses the soft-deletion filter, landing with the first repository of this phase that reads a relation (ADR 0011, deferred list; R-DB-3).
- **FR-215**: The email port MUST be defined in the project's own terms — sending a one-time code, a deletion confirmation, a password-set link — with a stand-in that records what it was asked to send, selected by configuration; the provider adapter and the authenticated sending domain are chosen at launch (ADR 0012, ARCHITECTURE §3.2/§3.4, R-API-5).
- **FR-216**: Every procedure of this phase MUST be declared through a caller kind with its output schema and, where public, its rate limit; every job MUST carry a double-run assertion; every write MUST go through the call's transaction; and the contract snapshot MUST grow additively (T169, T170, R-API-14, R-API-9).
- **FR-217**: T130's register MUST be re-counted at the end of the phase, with R-GENDER-6, R-MOBILE-13, R-HONEST-4, R-GENDER-1 and R-GENDER-3 proven and each row citing its test; Phase 1's own count MUST be zero, and the rows that remain MUST name only Phases 2 to 4 (SC-003; T130).

### Key Entities _(include if feature involves data)_

The authoritative model is `docs/ERD.md` v1.3 with its addenda and the pass of
FR-101 to FR-111. Listed below are the entities whose shape this phase decides
or first fills.

- **User**: the root identity, one row per person with exactly one role, written only when onboarding completes; carries gender, date of birth, display name, certificate name, language, time zone and account status; never hard-deleted, and erased of its personal fields on deletion.
- **Auth identity**: a Google or Apple account keyed by the provider's subject, one per provider per person; deleted outright with the account.
- **Onboarding token**: a short-lived, single-purpose proof of a verified identity held by the device between sign-in and the completing step; accepted by that step alone, once; never an account.
- **User session**: a device's refresh token, stored as a hash with its issue, expiry and revocation instants; the unit of sign-out and revocation.
- **One-time code**: a hashed six-digit code sent to an email for sign-up, password reset or web deletion, with a purpose, a lifetime, an attempt count and a single use; purged when spent.
- **Terms acceptance**: the version a person accepted and when; the Terms body served with that version.
- **Teacher profile**: the teacher side of a user: qualification, verification status, the call record, the approving admin, and payout readiness as an encrypted recipient reference with configured and verified instants.
- **Verification document**: an uploaded identity document or credential PDF, its reference encrypted, reachable only through a signed expiring link; viewed by an admin, never modified.
- **Teacher credential**: one ijazah PDF per subject with the holder's name, riwaya, tariq, status, review reason and reviewer; one approved per teacher and subject; the chain lives under it.
- **Isnad entry**: one generation of a credential's chain, origin first, holding one or more names, written by an admin; exists only on an approved credential.
- **Verification request**: an admin's demand for an identity document from any user, with its reason and resolution; open means the account is verification-required.
- **Subject**: an admin-managed subject with two mandatory names, shown by the page's language; never a translation key.
- **Administrator**: a separate principal with a password, an encrypted second-factor secret, hashed single-use recovery codes and its own sessions; one role in the MVP.
- **Audit record**: an append-only record of an administrative action: actor, action, target type and id, a non-personal target label at write time, reason, before and after; never rewritten.
- **Settings entry**: an operational number read at the moment of use — code lifetime, attempt limits, lockout count and duration, terms version, upload limit, the make-up window; edited from the Phase 4 surface, audited.
- **Payout recipient reference**: the gateway's reference for a teacher's payout account, encrypted and row-bound, with the way a recipient event finds it decided by FR-109.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-101**: The owner, on their own physical iOS device and Android device, applies as a teacher end to end — sign-in, onboarding, two subjects, an identity document and two PDFs — in under ten minutes from a fresh install, with no step needing a person other than the applicant; the owner records the run as the definition-of-done evidence.
- **SC-102**: Attempts to approve an application whose verification call is not recorded, or one of whose credentials is undecided, succeed zero times out of ten, from the panel and by a direct call alike.
- **SC-103**: An onboarding abandoned at every step, and one whose token expired, leaves zero rows of the person in every table, asserted by a test over the whole schema.
- **SC-104**: Every procedure in the contract snapshot carries an output schema, and the leak test over every user-facing output finds zero forbidden fields.
- **SC-105**: The owner reviews every screen of this phase against its board on their own iOS and Android devices, in Arabic and in English, and records the result; the key-parity checks of both applications report zero difference in the pipeline.
- **SC-106**: The lint set finds zero raw colour or spacing values outside `design/`, and the magic-number gate finds zero numeric literals other than 0 and 1 under the modules.
- **SC-107**: The CI test over the user surface finds zero procedures whose input carries `gender`.
- **SC-108**: One hundred percent of administrative actions taken in the phase's tests have an audit entry with a non-empty, non-personal label, and a renamed or deleted target changes zero stored labels.
- **SC-109**: The locked and wrong-credential answers of the admin sign-in are byte-identical in body and status, their timing difference is within the test's tolerance, and zero responses carry an attempts count.
- **SC-110**: A teacher approved without a verified payout account is refused by every publishing path, and the verified instant is null until the stand-in's signed event sets it; a replayed event changes nothing a second time.
- **SC-111**: A deleted account's personal fields are erased and its identity rows gone in the same transaction; its refresh token is refused; and a new sign-up with the same email succeeds immediately, except for an account banned when it was deleted, whose identifiers are kept as keyed hashes and refused (T097, FR-155).
- **SC-112**: T130's register shows Phase 1's own count at zero, with R-GENDER-6, R-MOBILE-13, R-HONEST-4, R-GENDER-1 and R-GENDER-3 proven.
- **SC-113**: The full migration history applied to an empty database succeeds on the first attempt and yields every table the pass adds, each with exactly one owner in the manifest and each new integrity rule demonstrated by a refused insert.
- **SC-114**: The complete test suite passes on a machine holding no Google, Apple, email or gateway credential.
- **SC-115**: The phase's tasks are grouped into batches of at most six, in dependency order, each batch one branch, one pull request and one review by Saif's review session, and the phase closes within its seven working days from 2026-10-17 for one person; an overflow is stated at the moment its cause appears and goes to the descope ladder, never absorbed silently (PLAN.md).

## Assumptions

**Scope**

- Phase 1 delivers no discovery, profile, package, availability, booking, payment order, session, notification centre or certificate. Where a requirement of this phase has a consequence for one of those (a deletion's enrollments, a suspension's sessions, a verified payout's visibility), this phase leaves the seam — one entry, one column — and the owning phase attaches to it.
- The email port ships with its stand-in; the provider adapter and the authenticated sending domain are chosen at launch (ARCHITECTURE §3.2). The gateway's hosted recipient onboarding and its real adapter are Phase 2's (OPEN-11); this phase registers recipients through the stand-in and routes its signed events.
- The settings this phase reads are seeded rows; the surface that edits them (FR-ADMIN-9) is Phase 4's. The subjects this phase offers are the seeded ones; the admin's subject page, when built, obeys ADR 0021 D1.
- Nothing in this specification is derived from source code presently in the repository beyond naming what Phase 0 built as given.

**Who does what**

- The owner implements, alone, on the working method of Phase 0's final week; Saif's review session reviews each batch; only Critical and Major findings block a merge, at most two rounds, strict on security (PLAN.md, "How a phase is run").
- The steps that need a physical device are the owner's own: SC-101 (the end-to-end application) and SC-105 (every screen in both languages on iOS and Android). Everything else in the definition of done is demonstrated by a test, a gate or the reviewer reading the diff.
- SRS §2.5 still describes a team of "2 full-time, 1 part-time"; PLAN.md records the team of one since 2026-10-08. The discrepancy is corrected in this cycle's document pass (FR-111), not relied on in silence.

**Readings of PLAN.md carried into this specification**

- "Gender is changeable only by an admin" (definition of done) is held in this phase by construction: no user-facing path changes it (FR-139, proven by R-GENDER-6's test), and no admin path exists yet either; the admin's correction with its enrollment consequences (FR-GENDER-4/7) is the gender queue of Phase 4 (FR-ADMIN-8). The invariant is true throughout.
- "An approved teacher without a verified payout account appears nowhere and cannot publish" is held here by the standing the server resolves (FR-192); the predicate that would show a teacher is Phase 2's and reads the column this phase writes. The adversarial case for it lands with that predicate.
- "The teacher list" named for R-GENDER-1 and R-GENDER-3 is Phase 2's discovery; what this phase proves is the suite's bite (FR-211, clarified 2026-10-17).
- `ApplicationApproved` links to the public profile editor; that editor is FR-PROFILE-1, Phase 2's. In this phase the approved screen's first step, payout setup, and its credentials and account paths exist; the profile link lands with Phase 2.
- The notification-permission step and the device push token are Phase 4's (FR-133, clarified 2026-10-17); the drawn flow is unchanged, only the phase in which one route is inserted.

**Given rather than chosen here**

- The caller kinds with their output schema and declared rate limit, the audit-writing administrator kind, the call's transaction, the guards, the ports and their stand-ins, the storage port's signed links, the column cipher, the settings reader, the queue, the contract snapshot, the lint set and the design tokens are Phase 0's and are used as they are.
- The onboarding token's form (a stateless signed token or a stored hashed row), the second factor's algorithm parameters, the breached-password source, the session lifetimes and the exact shape of the recipient-routing column are the plan's to decide within these requirements.

**Dependencies and open items outside this phase**

- OPEN-11 (gateway selection) is needed before the real recipient onboarding, not before this phase's stand-in; OPEN-05 (document retention) and research R-19 (Egypt's data-protection law) are with counsel and bound the retention sweep's parameters, not its existence; OPEN-08 (the legal entity) gates store accounts, not this phase.
- The Terms text is counsel's; this phase serves it with a version and records acceptance. No version changes before launch, so forcing re-acceptance on a change is not required here and is taken up when the Terms first change.
- Sign in with Apple is exercised on a physical iOS device under the owner's developer account; the test suite verifies provider tokens against fixture keys and never a provider.

**Risk**

- The seven days hold the cycle itself, for one person. If the plan or tasks step finds that the forty-four ids do not fit — the second-factor setup, the public pages, the admins page are the likely causes — the overflow is stated then with its cause and goes to the descope ladder (PLAN.md, "When a phase slips anyway"); no extension is taken by default, and nothing of this phase is cut without being named there first.
