# ADR 0015 — A user can delete their account; reporting replaces a user-to-user block

**Status:** accepted · **Date:** 2026-10-14 · **Decided by:** the owner, 2026-10-14 · **Amends:** SRS FR-AUTH (adds FR-AUTH-14 and FR-AUTH-15), §4.1, NFR-COMP-3, §8, adds DEC-55 and RISK-12; ERD `users`, `enrollments.cancellation_reason`

**Amended 2026-11-12 (the owner's decisions of 2026-11-12, on PR #137's follow-up 3; SRS FR-AUTH-14, FR-ADMIN-21, FR-ADMIN-22, NFR-COMP-2 and DEC-67; T076 to T081 in `specs/004-sessions/tasks.md`).** Two changes. **D3's «Teacher data» is split.** A teacher who was ever approved (`teacher_profiles.approved_at` set), whatever their standing since, keeps after the deletion their identity documents (national ID or passport), their credential documents and their payout recipient reference (its encrypted value, its keyed hash and its configured and verified instants). **The purpose is fraud prevention:** a teacher who wronged or defrauded someone must not escape it by deleting the account, and their identity and the account they were paid to are what a complaint, the gateway or the authorities would need. Nothing kept is used for anything else. It is kept out of every ordinary reader, with no end date, until an administrator erases it, at once or at a date the administrator sets, changes or clears, each with a mandatory reason and an audit entry; an administrator may read a kept document through a signed link, each press with a reason and audited; the erasure is final. The keyed payout hash binds live accounts only. Everything else of the teacher is erased as before, the bio and the qualification summary included; a teacher never approved keeps nothing. The deletion screen is the same for every account; the privacy policy says it in one general line, which counsel reviews before launch (OPEN-05). **D4 is replaced for a person's own deletion:** an account that has an ongoing enrollment (awaiting payment, confirmed, or closed by its own ban or revocation and still restorable, SRS FR-CANCEL-8; not its innocent counterparty) cannot be deleted, in the app or on the web; the person is told they can delete it once those enrollments end, or contact support. An administrator deletes an account only at its owner's request through support, never on their own initiative, with a reason and an audit entry; D4's effects apply to that deletion alone. *Not chosen:* a deletion requested now and run when the last enrollment ends. *Apple:* a refusal is likely to fail App Review (guideline 5.1.1(v)); the first release is Android only (DEC-62), so this is a follow-up for the first App Store submission. *Was:* every teacher's bio, verification documents and payout reference erased; a deletion immediate in every case, its current enrollments ended by D4.

**Amended 2026-11-05 (Phase 3's design, `specs/004-sessions/research.md` R-327; the owner's decision).** D3's «stored files» and «records of open cases» together: a deleted account's stored files (its photo and its verification documents) are not removed while the account is a party to an enrollment with an open dispute, compensation case or complaint of a teacher's absence. Everything else D3 does at once still happens at once (the personal fields erased, the documents marked erased and unreadable); only the files and their keys wait, until the last of those matters closes, and the `erase-deleted-files` job removes them on its first run after that, as the chat waits for its own purge. SRS FR-AUTH-14 says so. How long a held file may wait is the retention policy's (NFR-COMP-2, OPEN-05), with counsel. *Amended again 2026-11-06 (the owner's decision; research R-327, «The administrator's read»):* a held file is evidence only if someone can read it, so while it is held an administrator may read it inside an open dispute, compensation case or complaint of that enrollment, and only there, as the dispute's chat is read: a list with no link, then one signed link per press valid `document_link_ttl_seconds`, each press audited. Every other path still answers an erased document as none. A link minted just before the matter closes may live that long after the close, accepted. Once the last matter closes the files are removed as above.

## Context

The App Store and Google Play both require an app that lets people create an
account to let them delete it:

- **App Store.** Guideline 5.1.1(v) requires deletion to start from inside the
  app. An account made with Sign in with Apple must also have its Apple tokens
  revoked.
- **Google Play.** Deletion must be possible in the app and also from a web
  link, without reinstalling the app.

The SRS had no deletion requirement.

NFR-COMP-3 asked for "a block capability". The owner does not want a
user-to-user block: reporting is enough. App Store guideline 1.2 asks for "the
ability to block abusive users from the service", and the platform already does
that by suspending or banning a reported user.

## Decision

### D1 — Deletion starts in the app

The path is Account, then Delete account. The screen says three things before
anything happens:

- what is deleted;
- what is kept, and why;
- what happens to the user's current enrollments (D4).

The user then confirms in three steps:

1. Types the confirmation word.
2. Signs in again: Google or Apple re-authentication, or the password for an
   email account.
3. Confirms once more.

Deletion is immediate and final. There is no recovery period. Signing up again
with the same email creates a new account.

**The exception: a banned account (FR-155, T097, the owner's decision of
2026-10-26).** A banned person may delete their account, but the ban outlives
it: signing up again with the same email, or with the same Google or Apple
account, is refused with `ACCOUNT_RESTRICTED` and no detail, and no token is
issued. Without this, deleting and signing up again would lift a ban that is
permanent and not lifted from the panel (FR-162). *(a student's or a teacher's ban can be lifted within the Ban restore window, DEC-66; an applicant's ban, FR-162, stays permanent)* The refusal comes only after
the person proved the address or the account (the right code, a provider
token, an onboarding token), never at the code request, which answers every
address alike, so nobody learns of another person's ban. Nothing says an
account was deleted before. The identifiers are kept as D3 states.

### D2 — Deletion can also be requested on the web

A public page explains the in-app path. It also takes a request without the app:

1. The person enters the account's email.
2. The platform sends a one-time code to that email, through the email channel
   ADR 0012 already uses.
3. The person enters the code, and the request runs D3 and D4 exactly as the
   in-app path does.

### D3 — What is deleted and what is kept

**At once:**

- **Sign-in.** Every session and refresh token is revoked (FR-AUTH-7).
  - A Sign in with Apple account has its Apple token revoked.
  - Device push tokens are removed.
- **The account row.** The `users` row is soft-deleted (`deleted_at`, ERD
  §15.10).
  - Its personal fields are erased: display name (shown as the role word,
    «طالب محذوف» or «معلم محذوف»), email, phone, password hash, date of birth,
    photo and certificate name (ADR 0019 D1). The names a certificate prints are
    snapshotted onto `ijazahs` at issue, so it keeps verifying without them.
  - Its `auth_identities` rows are deleted outright: a provider subject is
    personal data with no history value, and its unique
    `(provider, provider_subject)` must not block the person's new account (D1).
  - The partial unique indexes free the email for a new sign-up.
  - **Except for a banned account (FR-155, T097).** Its email and each
    linked `(provider, provider_subject)` are kept in `banned_identifiers`,
    written in the same transaction before they are erased, so the ban
    outlives the account (D1). Only a keyed hash is kept: HMAC-SHA256 under a
    subkey of ENCRYPTION_KEY derived by HKDF under its own label, with the
    row's `created_at`. No address, subject, name or link to the deleted row
    is stored, so the table identifies no one to a reader without the key, and
    a guessed address can be tested only by the platform. Why hashes and not
    the values: matching needs equality only, and data minimisation (Egypt
    PDPL) forbids keeping more. Why keyed: a plain hash of an address can be
    reversed by hashing a list of addresses. The cost: a rotation of
    ENCRYPTION_KEY leaves every row unmatched, since an HMAC cannot be
    recomputed without the address it was made from (docs/RUNBOOK.md, the
    rotation's warning).
  - **Retention.** The kept identifiers have no end date. OPEN-05
    (NFR-COMP-2) must settle how long a ban outlives an account before
    launch, with counsel, and the privacy policy must say it.
- **Teacher data.** A teacher's bio, verification documents and payout
  recipient reference are erased. *(Amended 2026-11-12: a teacher once
  approved keeps the identity and credential documents and the payout
  reference, for fraud prevention; see the amendment at the top.)*

**Within 30 days:** the stored files and backups age out.

**Kept, without the erased personal fields:**

- **Payment records.** Gateway records (`payments`, `payment_events`) are
  accounting evidence.
- **Audit log.** It is append-only by design.
- **Sessions and enrollments.** They are history the other party keeps.
- **Review star ratings.** The written comment is removed, as moderation does
  (FR-REVIEW-5).
- **Ijazahs granted or received.** A certificate already in someone's hands
  must keep verifying. On the holder's request, an Admin may revoke it with that
  reason (FR-IJAZAH-8).
- **Records of open cases.** Chat messages and records that an open dispute,
  report or compensation case needs stay until that case is resolved
  (FR-SESS-13). Other chats are purged.

How long each kept record is kept is set by the retention policy (NFR-COMP-2,
OPEN-05), with counsel.

### D4 — Current enrollments

*(Amended 2026-11-12: an account with an ongoing enrollment cannot delete
itself; what follows applies only to an administrator's deletion at the
owner's request; see the amendment at the top. A teacher's deletion cancels
the enrollments with `account_deleted` and a compensation case each, as the
code does; it is no longer «a suspension's» effect, since a suspension now
pauses the enrollments, SRS FR-SESS-16 as amended.)*

**A student deletes their account:**

- Their remaining scheduled sessions take `cancelled_by_admin`, which frees both
  parties' time.
- Each confirmed enrollment becomes Cancelled with the reason `account_deleted`.
- The teacher is notified.
- No compensation case opens, because the student chose this. The deletion
  screen says so before the student confirms.

**A teacher deletes their account:** the effect is that of a teacher suspension
(FR-SESS-16):

- Remaining sessions are cancelled.
- Each student is notified.
- A compensation case opens for each affected enrollment (FR-DISPUTE-5).

**Open cases:** an open dispute, report or compensation case does not block
deletion. It continues with the records D3 keeps.

### D5 — No user-to-user block

There is no block between users. Reporting (FR-SESS-15) routes abuse to the
Administration, which can suspend or ban the account (FR-ADMIN-5, FR-DISPUTE-3).
That suspension or ban is the platform's block of an abusive user from the
service.

## Consequences

- **SRS.**
  - FR-AUTH-14 (in-app deletion) and FR-AUTH-15 (web request) are added.
  - §4.1 lists account deletion.
  - NFR-COMP-3 is rewritten.
  - §8 gains a row.
  - DEC-55 and RISK-12 are added.
- **ERD.**
  - `users` notes the erasure.
  - `enrollments.cancellation_reason` gains `account_deleted`, with a forward
    migration in the Phase 1 ERD pass.
- **Design.**
  - The Delete account screens and a public deletion-request page are added.
  - The report sheet loses its block option.
- **Risk.** An App Review reviewer could still expect a user-level block
  (RISK-12). The answer, ready for review notes, is report plus admin
  suspension or ban.
