# ADR 0019 — Full names on certificates, one admin role, and admin sign-in limits

**Status:** accepted · **Date:** 2026-10-15 · **Decided by:** the owner, 2026-10-15 · **Amends:** SRS FR-IJAZAH-15, FR-ADMIN-1, NFR-SEC-6, §3.14, §13 (adds DEC-59); ERD `users`, `teacher_credentials`, `admin_users`

## Context

The final design audit found three gaps.

- **Names.** The certificate prints full names ("يوسف بن أحمد بن سعيد الشريف"), but the data model stores only a display
  name.
- **Admin roles.** NFR-SEC-6 asks for "role-scoped" admin accounts but defines no roles, and `admin_users` has no role
  column.
- **Admin sign-in.** The lockout rule and MFA recovery have no numbers and no storage.

## Decision

### D1 — Full names for certificates

**The student's name.**

- When a teacher sends the first ijazah request for a student whose account has no certificate name, the request waits.
  The student is asked for the name as it should be printed. It is shown as it will appear, entered once, and editable
  later only through support.
- The request then goes on to the admin (FR-IJAZAH-15).
- The name is `users.certificate_name`.

**The teacher's name.** The admin transcribes it from the teacher's ijazah PDF when approving the credential
(`teacher_credentials.holder_name`, ADR 0017).

### D2 — One admin role in the MVP

NFR-SEC-6's "role-scoped" means this: admin accounts are a separate class from app accounts (FR-ADMIN-1), with one
admin role.

Sub-roles (vetting, moderation, read-only) are deferred (§13). `admin_users` gets no role column now.

### D3 — Admin sign-in limits

- **Lockout.** After 5 failed attempts the account is locked for 15 minutes. Both numbers are settings (§3.14). The
  screen never shows how many attempts remain.
- **Recovery codes.** At MFA setup the admin receives 10 single-use recovery codes. They are stored hashed
  (`admin_recovery_codes`) and can be regenerated.
- **MFA reset.** Another admin resets a lost MFA, with a reason, and the reset is audited.

## Consequences

- **SRS.**
  - FR-IJAZAH-15, FR-ADMIN-1 and NFR-SEC-6 change.
  - §3.14 gains the two lockout settings.
  - §13 gains admin sub-roles.
  - DEC-59 is added.
- **ERD.** Forward migrations in the Phase 1 pass:
  - `users.certificate_name`;
  - `teacher_credentials.holder_name`;
  - `admin_recovery_codes` (`admin_id`, `code_hash`, `used_at`);
  - two settings rows.
- **Design, student:** a sheet asking for the certificate name.
- **Design, teacher:** «بانتظار اسم الطالب» on the request.
- **Design, admin:**
  - the holder-name field in the credential form;
  - the admin sign-in error without an attempts count;
  - recovery-code entry at MFA.
