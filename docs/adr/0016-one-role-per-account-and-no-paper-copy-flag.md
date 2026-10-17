# ADR 0016 — An account is a student or a teacher, never both; the paper-copy flag is deferred

**Status:** accepted · **Date:** 2026-10-15 · **Decided by:** the owner, 2026-10-15 · **Amends:** SRS §2.2, FR-AUTH-2, FR-ADMIN-4, FR-ADMIN-5, FR-IJAZAH-5, §4.1, §6.2 UserRole, UC-7, §13, DEC-30 (adds DEC-56); ERD `user_roles`, `ijazahs.paper_copy_intended`; screens.md

## Context

SRS §2.2 lets one account hold both roles at once. That brings three things:

- a role switcher;
- gender rules that apply per role;
- per-role suspension.

It also lets a student account later add the teacher role. The owner wants the
MVP simpler: one role per account, chosen once.

FR-IJAZAH-5 let a teacher flag that they mean to issue a paper ijazah outside
the app. It is informational only, and the owner does not want it in the MVP.

## Decision

### D1 — One role per account, chosen once

At the first sign-in the user chooses Student or Teacher, never both
(FR-AUTH-12). The choice cannot be changed later, and no role can be added to
the account.

- **A teacher who wants to study.** They need a separate account under another
  email.
- **No role switcher.** The app shows the one role's navigation.

### D2 — Suspension is per account

Suspending or reinstating acts on the account (`users.account_status`).
Withdrawing a teacher's approval acts on `teacher_profiles.verification_status`
(FR-VERIFY-8). There is no per-role suspension.

### D3 — `user_roles` stays, with one row per user

The table is kept so that dual roles can return without a schema rewrite.

- **One row per user.** A unique index on `user_id` holds the rule in the
  database. It lands with a forward migration in the Phase 1 ERD pass.
- **`status` column.** It stays `active`.

### D4 — No paper-copy flag

Granting asks only for the certificate language. FR-IJAZAH-5 is deferred, and
`ijazahs.paper_copy_intended` stays false.

## Consequences

- **SRS.**
  - §2.2 is rewritten.
  - FR-AUTH-2, FR-ADMIN-4 and FR-ADMIN-5 are rewritten; FR-IJAZAH-5 is deferred.
  - §4.1, §6.2 UserRole and UC-7 are edited.
  - Dual-role accounts and the paper-copy flag join §13.
  - DEC-30 is amended and DEC-56 is added.
- **ERD.** `user_roles` gains the unique index on `user_id`;
  `paper_copy_intended` is noted as unused.
- **Design.**
  - The role step offers two choices.
  - The student account loses «إضافة دور المعلم».
  - The teacher account loses its role switch.
  - The applicant's «continue as a student» is removed.
  - Admin suspension is per account.
  - Granting loses the paper-copy check.
