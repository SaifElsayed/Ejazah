# ADR 0015 — A user can delete their account; reporting replaces a user-to-user block

**Status:** accepted · **Date:** 2026-10-14 · **Decided by:** the owner, 2026-10-14 · **Amends:** SRS FR-AUTH (adds FR-AUTH-14 and FR-AUTH-15), §4.1, NFR-COMP-3, §8, adds DEC-55 and RISK-12; ERD `users`, `enrollments.cancellation_reason`

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
  - Its personal fields are erased: display name (shown as «مستخدم محذوف»),
    email, phone, password hash, date of birth and photo.
  - The partial unique indexes free the email for a new sign-up.
- **Teacher data.** A teacher's bio, verification documents and payout
  recipient reference are erased.

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
