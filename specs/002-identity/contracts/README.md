# Phase 1 Contracts

**Feature**: `specs/002-identity/` · **Date**: 2026-10-17

The first product procedures, the two new ports, the public pages and the
changes to the kernel's contract. Every procedure here is additive-only from
the moment it is merged (R-API-9); every one is declared through a caller kind
with its input and output schema (T169) and, where public, its rate limit
(T170); every output is the fields its schema names and nothing the handler
happened to return (R-HONEST-4).

| Document                               | Contract                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [app-surface.md](./app-surface.md)     | The user surface: sign-in, onboarding, sessions, account, deletion, the teacher application, credentials, payout, the public configuration                                                             |
| [admin-surface.md](./admin-surface.md) | The administrator surface: sign-in with the second factor, applications, credentials, documents, teachers, admins, the audit log                                                                       |
| [ports.md](./ports.md)                 | The sign-in port and the email port, and the payment port's recipient operations as this phase calls them                                                                                              |
| [public-pages.md](./public-pages.md)   | The routes the API serves to a browser: the Terms, the deletion flow, the uploads route, the design assets                                                                                             |
| [kernel.md](./kernel.md)               | What changes in the kernel's contract: session resolution, the teacher kind's `admits`, the restricted-account rule, the admin public kind, the idempotency actor, the leak test, the R-MOBILE-13 gate |

## Conventions

- **Names.** Procedures are `namespace.verb` in camelCase; namespaces mirror
  the owning module (`auth`, `onboarding`, `account`, `teacher.application`,
  `teacher.credentials`, `teacher.payout`, `catalog.subjects`, `platform` on the
  user surface; `auth`, `applications`, `credentials`, `documents`, `teachers`,
  `users`, `admins`, `audit`, `home` on the administrator surface).
- **Errors.** One shape (`contracts/kernel.md` of Phase 0). The codes this phase
  adds, each a stable string: `UNAUTHENTICATED`, `FORBIDDEN`,
  `ACCOUNT_RESTRICTED` (with `status` in details), `EMAIL_IN_USE_BY_OTHER_METHOD`
  (with `method` in details: `google`, `apple` or `email`), `SIGN_IN_FAILED`
  (one message for a wrong email or password), `CODE_INVALID` (wrong, expired or
  spent; one message), `ONBOARDING_TOKEN_INVALID`, `PASSWORD_WEAK` (too short,
  too long, or breached; one message), `ADMIN_SIGN_IN_FAILED` (wrong
  credentials or locked; one message, one timing), `MFA_REQUIRED`,
  `MFA_SETUP_REQUIRED`, `APPROVAL_BLOCKED` (with the blocking reasons in details:
  `call_not_recorded`, `credential_undecided`, `no_approved_credential`),
  `APPLICATION_INCOMPLETE`, `DOCUMENT_NOT_OWNED`, `CONFLICT`.
- **Dates.** Instants cross the wire as ISO-8601 strings in UTC; a date of birth
  as a calendar date `YYYY-MM-DD`; nothing client-supplied is a timestamp
  (R-TIME-6).
- **Identifiers.** UUIDs as strings; a document id is the one `POST
/uploads/documents` returned and the caller owns.
- **Rate limits.** Every public procedure names its settings key; the keys of
  this phase are the four of Phase 0 plus `rate_limit_public_page` and
  `rate_limit_upload`.
- **What is not here.** No discovery, profile, package, availability, booking,
  payment order, session, notification or certificate procedure; no procedure
  that returns another user's teacher data to a user (the first is Phase 2's).
