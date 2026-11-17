# catalog

## Owns

`subjects, teacher_subjects, packages, availability_slots, isnad_entries, teacher_signatures, teacher_credentials`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Store an availability slot as an absolute instant; it is wall-clock plus IANA zone (R-TIME-3). Return teachers without the requester's gender in the repository signature (R-GENDER-5). Let a teacher edit a chain: only an administrator transcribes and corrects it (FR-163, FR-164). Move a credential before the locks below.

## Locks

The credential review locks the teacher's rows before the credential moves, through identity's entry: `lockAccount` locks the `users` row, `lockApplication` the `teacher_profiles` row. Where one transaction takes both, the account's comes first, the order the standing's ban takes them (T164, the owner's decision of 2026-11-01).

- `credentials.approve` locks the account, then the application, before the credential moves and the subject is granted (T142, T164): a revocation meanwhile commits first or waits, and the grant's `teacher_subjects` row references the teacher's `users` row.
- `credentials.requestDocument` locks the application before the credential moves (T161), so the applicant's resubmission meanwhile commits first or waits and then reads the credential waiting.
- `teacher.packages.create` locks the account, then the application, before it reads the teacher's subjects (T018): its row references the teacher's `users` row, and a revocation meanwhile, which moves the application's row before it removes the subjects, commits first or waits.
- `teacher.packages.update` locks the account before it reads the package and asks booking whether it has an enrollment (T018): `checkout.pay` locks the same account before it reads the package and inserts its first enrollment (T036; the hold, T033, inserts none), so an edit of the track or the length and a first enrollment never cross.
- `teacher.slots.create` locks the account, then `lockKey('teacher-slots', teacherId)`, before it reads the zone and the active slots (T019): its row references the teacher's `users` row, and two saves of one teacher meet on the key.
- `teacher.slots.update` locks the account, then the key, then the slot's row, before it asks booking whether the slot is in use and reads the others (T019). The key is never taken after a slot's row, and `checkout.hold` takes the same key before it inserts a hold (R-207), so a save and a hold never cross.
- `POST /uploads/signature` locks the account before it reads and writes the teacher's signature row (T003 of specs/005-certification): the row references the teacher's `users` row, two uploads of one teacher meet on that lock, and the old file is erased only after the commit.
- `credentials.reject` and `credentials.correct` take no lock: every write is conditional on the state it moves from, and §15 rule 23's partial unique refuses a second approved credential for a teacher's subject.

## Discovery (Phase 2)

Discovery is not a module. Its catalog half is `discovery.service.ts` with `discovery.repository.ts` and `discovery-cursor.ts` (T025, T027): the cards, the subject tabs, the riwaya values and the teacher profile. The visibility predicate (same gender, verification approved, not soft-deleted, payout verified; SRS §3.7.1, ADR 0006, ADR 0007) reads only `users` and `teacher_profiles`, so it is identity's repository filter, which also orders and pages the visible teachers. This module filters its own tables by the ids identity returns and builds the cards; the discovery router is booking's (ARCHITECTURE §4, amended 2026-11-01).

## Shape

The rules live in the services: `credential-review.service.ts` (the administrator's credential review, T069, T155), `subjects.service.ts` (the public subjects list, T038), `packages.service.ts` (the teacher's packages, T018) and `slots.service.ts` (the teacher's weekly slots, T019). The queries live in `credential-review.repository.ts` (the review over `teacher_credentials` and `isnad_entries`), `credentials.repository.ts` (the credential rows as verification's application and credentials read and write them through this module's entry, the subjects an approval grants and a revocation removes, the admin home's credentials card), `subjects.repository.ts`, `packages.repository.ts` and `slots.repository.ts`. A router is thin: validate, call one service method, return: `subjects.router.ts` (under `catalog.subjects`), `credentials-admin.router.ts` (the administrator surface's `credentials` namespace, mounted by `admin.router.ts`, its service composed by the admin module), `packages.router.ts` (under `teacher.packages`) and `slots.router.ts` (under `teacher.slots`). What only booking can answer, whether a slot or a package is in use, comes through the `CatalogUse` port (`catalog-use.port.ts`, T020) that `main.ts` binds. `teacher_signatures` is written by `teacher-signature.service.ts` over `teacher-signature.repository.ts` (T003 of specs/005-certification, R-411): `POST /uploads/signature` (`signature-upload.controller.ts`) and `teacher.signature.get` (`teacher-signature.router.ts`). `index.ts` is the only import path.

## Public entry

Catalog imports identity alone (ARCHITECTURE §4, the module graph). What `index.ts` gives the others, each read or write on the caller's transaction:

- Booking (Phase 2): `offeredSlotsOf` (the active slots of the lengths of each teacher's active packages, for discovery's nearest slot and the booking sheet, T026, T032); `readSlot` (a slot by its id, active or not, read under the slot's lock by Pay and the confirm job, T036, T039); `lockTeacherSlots` and `teacherSlotsOf` (the slots' key and every slot of a teacher, for the release of an ended account's holds, after the account's lock and before the holds', T041); `bookablePackageOf`, `packageOwnerOf`, `teacherPackageOf` and `subjectSummariesOf` (the booking sheet's package, the checkout's summary, an enrollment's snapshot subject, T032, T036, T037); the `CatalogUse` type, which booking's `createCatalogUse` implements (R-207).
- The `confirm-enrollment` job: `readSlot`.
- Verification (Phase 1): the credential rows (`addCredential`, `listCredentials`, `replaceCredentialDocument`, `closeUndecidedCredentials`, `credentialsOfTeachers`, `grantSubjects`) and `activeSubjectsAmong`.
- The admin module: `createCredentialReviewService`, `readCredentialQueue`, `revokeSubjects`.
- `main.ts` (T003 of specs/005-certification): `createTeacherSignatureService`, `createSignatureUploadRoute` and `SIGNATURE_UPLOAD_PATH`; the app surface: `teacherSignatureRouter`.
- The composition root and the surfaces: `createCatalogServices` (over the `CatalogUse` that `main.ts` binds), `createDiscoveryCatalog` (handed to booking's `discovery` services, T026), `createSubjectsService`, `createDocumentReferences`, and the routers `packagesRouter`, `slotsRouter`, `subjectsRouter` and `credentialsAdminRouter`. The stores (`credentialReviewStore`, `packagesStore`, `discoveryStore`) are exported for the probes under `tests/db-integrity/`.

## Requirement ids

- FR-153 (a subject becomes an approved teacher's on its credential's approval): `credential-review.service.ts`, `credentials.repository.ts`.
- FR-163, FR-164 (the credential review and the chain's correction): `credential-review.service.ts`.
- FR-182 (the subjects list, both names): `subjects.service.ts`, `subjects.router.ts`.
- FR-331 to FR-336, FR-338 (discovery's cards, tabs, filters and the teacher profile): `discovery.service.ts`, `discovery.repository.ts`, `discovery-cursor.ts`.
- FR-311, FR-312, FR-314, FR-315 (the teacher's packages): `packages.service.ts`, `packages.repository.ts`, `packages.router.ts`.
- FR-313, FR-317, FR-318 (the teacher's weekly slots: no overlap on the week, a slot in use keeps its day, start and length): `slots.service.ts`, `slots.repository.ts`, `slots.router.ts`.
- FR-337 (a per-session price only from `packages/money`): `discovery.service.ts`, `packages.service.ts`.
- FR-350, FR-358 (the package, slots and subjects booking's sheet and checkout read through this entry): `packages.repository.ts`, `slots.repository.ts`, `subjects.repository.ts`.
