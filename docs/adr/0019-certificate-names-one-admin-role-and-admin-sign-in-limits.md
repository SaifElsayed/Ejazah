# ADR 0019 — Full names on certificates, one admin role, and admin sign-in limits

**Status:** accepted · **Date:** 2026-10-15 · **Decided by:** the owner, 2026-10-15 · **Amends:** SRS FR-IJAZAH-15, FR-ADMIN-1, NFR-SEC-6, §3.14, §13 (adds DEC-59); ERD `users`, `teacher_credentials`, `ijazahs`, `admin_users`

**Amended 2026-11-26 (R2's conflict check, the owner's answers; SRS DEC-108 and FR-ADMIN-1; `specs/002-identity/tasks.md` T178, `specs/003-booking/tasks.md` T098 item 3).** D3 gains «Administrator recovery»: the server owner's script, for when no Administrator can sign in.

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
  later only by an admin on the student's request, audit-logged (FR-IJAZAH-15, FR-ADMIN-17).
- The certificate stores the printed names at issue (`ijazahs.student_name_printed`,
  `ijazahs.teacher_name_printed`, in the same ERD pass as `request_id`), so a deletion that erases
  `users.certificate_name` (ADR 0015 D3) leaves the certificate verifying unchanged; a later
  correction of the account's name never rewrites an issued certificate.
- The request then goes on to the admin (FR-IJAZAH-15).
- The name is `users.certificate_name`.

**The teacher's name.** The admin transcribes it from the teacher's ijazah PDF when approving the credential
(`teacher_credentials.holder_name`, ADR 0017).

> **Note, 2026-11-17 (SRS DEC-72; T001 of `specs/005-certification/tasks.md`, B45; ERD changelog row 47).** An issued
> certificate keeps the names it printed **from its sign-off**. Phase 4 issues in three steps: the record at the
> approval, the PDF by the render job, then an administrator's sign-off. Before the sign-off, a change of the student's
> certificate name or a correction of the teacher's credential re-freezes the printed names and the chain, and the
> certificate is re-rendered. From the sign-off nothing rewrites them, and «never rewrites an issued certificate» above
> holds from that instant.

### D2 — One admin role in the MVP

NFR-SEC-6's "role-scoped" means this: admin accounts are a separate class from app accounts (FR-ADMIN-1), with one
admin role.

Sub-roles (vetting, moderation, read-only) are deferred (§13). `admin_users` gets no role column now.

### D3 — Admin sign-in limits

- **Lockout.** After 5 failed attempts the account is locked for 15 minutes. Both numbers are settings (§3.14). The
  screen never shows how many attempts remain.
- **Recovery codes.** At MFA setup the admin receives 10 single-use recovery codes. They are stored hashed
  (`admin_recovery_codes`) and can be regenerated.
- **MFA reset.** Another admin resets a lost MFA, with a reason, and the reset is audited. With one admin role
  (D2), any admin may reset any other's MFA; the owner accepts this for the MVP.
- **Administrator recovery** *(amended 2026-11-26, DEC-108)*. When no administrator can sign in, the server's owner
  runs `scripts/ops/first-admin.ts --recover --email <x> --reason <r>` on the server: that administrator's password,
  its date, the second factor, the recovery codes, the lock and every session are cleared and a new invitation is sent.
  The same script without `--recover` creates the first administrator, refused while one can sign in. Each run writes
  one audit entry under the seeded administrator, which stands for the platform. No self-service password reset.
- **Lockout is the second line, not the first.** ADR 0011 D3's per-subject throttle and budget is the primary control,
  so a stranger who knows an admin's email cannot lock them out at will beyond that budget; the locked and the
  wrong-password answers are the same message with the same timing, so neither reveals the state.

## Consequences

- **SRS.**
  - FR-IJAZAH-15, FR-ADMIN-1 and NFR-SEC-6 change.
  - §3.14 gains the two lockout settings.
  - §13 gains admin sub-roles.
  - DEC-59 is added.
- **ERD.** Forward migrations in the Phase 1 pass:
  - `users.certificate_name`;
  - `teacher_credentials.holder_name`;
  - `ijazahs.student_name_printed` and `ijazahs.teacher_name_printed`, in the Phase 4 pass with `request_id` (D1);
  - `admin_recovery_codes` (`admin_id`, `code_hash`, `used_at`);
  - two settings rows.
- **Design, student:** a sheet asking for the certificate name.
- **Design, teacher:** «بانتظار اسم الطالب» on the request.
- **Design, admin:**
  - the holder-name field in the credential form;
  - the admin sign-in error without an attempts count;
  - recovery-code entry at MFA.
