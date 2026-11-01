# verification

## Owns

`verification_documents, verification_requests`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Serve a document from a durable public path (R-SEC-3). Trust a declared upload type over its content (R-SEC-4). Store a document's key in clear (R-DB-8). Write the application, a state of identity's `teacher_profiles`, or a credential, catalog's `teacher_credentials`, except through that module's `index.ts` (R-121, R-API-6). Take the application's lock before the account's.

## Locks

A transaction that moves an application or an identity request locks the rows it decides on before it reads them, through identity's entry: `lockAccount` locks the `users` row, `lockApplication` the `teacher_profiles` row. Where one transaction takes both, the account's comes first, the order the standing's ban takes them (T164, the owner's decision of 2026-11-01), so two such transactions never wait on each other.

- `applications.approve` locks the account, then the application, before it grants the approved credentials' subjects: the grant's `teacher_subjects` row references the teacher's `users` row (T164).
- `applications.recordCall`, `applications.reject` and `applications.requestInfo` lock the application (T126). `applications.ban` is identity's `StandingService.ban`, which locks the account, then the application.
- `teacher.application.resubmit` locks the application before it reads the credentials (T161), so a request for a credential's document meanwhile commits first.
- `users.requireIdentity`, `documents.accept` and `documents.requestAnother` lock the account (T126, T164).
- `submit` and `reapply` take no lock: every write is conditional on the state it moves from, so a call that lost a race is `CONFLICT` and leaves nothing.

## Documents

`POST /uploads/documents` (`uploads.controller.ts`, T024) stores a PDF through the storage port, its type decided by its content, and writes the row with the key encrypted and bound to it; it refuses a further upload once the uploader holds `document_unreferenced_max_per_user` documents nothing points at (T093). A document is reached only by a signed, expiring link minted on demand for its uploader or an administrator (`verification.service.ts`, NFR-SEC-3). `unreferenced-documents.ts` is the `purge-unreferenced-documents` sweep's store, over the pointers identity and catalog hand in. A deleted person's documents are marked erased in the deletion's transaction and their files removed after it (`document-erasure.ts`, B16; ERD §15 rule 34).

## Shape

The rules live in the services: `application.service.ts` (the teacher's application: `submit`, `resubmit`, `reapply`, T056), `credentials.service.ts` (the teacher's credentials after approval, T057), `application-review.service.ts` (the administrator's review, T068), `verification-request.service.ts` (an identity request, the administrator's demand and the person's answer, T068) and `verification.service.ts` (a document's signed link, T024). The queries live in `verification.repository.ts` (`verification_documents`) and `verification-requests.repository.ts` (`verification_requests`); `stores.ts` composes them with identity's and catalog's entries. A router is thin: validate, call one service method, return: `application.router.ts` and `credentials.router.ts` (under `teacher`), `identity-verification.router.ts` (under `account`), and `applications.router.ts` and `documents.router.ts` (the `applications`, `documents` and `users` namespaces of the administrator surface, mounted by `admin.router.ts`, their services composed by the admin module). `index.ts` is the only import path.

## Requirement ids

- FR-150, FR-151, FR-152, FR-155 (the application, its documents, its standing, a new one after a rejection): `application.service.ts`, `uploads.controller.ts`.
- FR-153 (the credentials after approval): `credentials.service.ts`.
- FR-160 to FR-162 (the queue, the call, the decisions): `application-review.service.ts`.
- FR-166 (an identity request): `verification-request.service.ts`.
- FR-141 (a deleted person's documents erased): `document-erasure.ts`.
