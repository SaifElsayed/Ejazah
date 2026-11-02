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
- `teacher.packages.update` locks the account before it reads the package and asks booking whether it has an enrollment (T018): the hold locks the same account before it inserts the package's first enrollment (T033), so an edit of the track or the length and a first enrollment never cross.
- `credentials.reject` and `credentials.correct` take no lock: every write is conditional on the state it moves from, and §15 rule 23's partial unique refuses a second approved credential for a teacher's subject.

## Discovery (Phase 2)

Discovery is not a module and not built yet. The visibility predicate (same gender, verification approved, not soft-deleted, payout verified; SRS §3.7.1, ADR 0006, ADR 0007) reads only `users` and `teacher_profiles`, so it is identity's repository filter, which also orders and pages the visible teachers. This module filters its own tables by the ids identity returns and builds the cards; the discovery router is booking's (ARCHITECTURE §4, amended 2026-11-01).

## Shape

The rules live in the services: `credential-review.service.ts` (the administrator's credential review, T069, T155), `subjects.service.ts` (the public subjects list, T038) and `packages.service.ts` (the teacher's packages, T018). The queries live in `credential-review.repository.ts` (the review over `teacher_credentials` and `isnad_entries`), `credentials.repository.ts` (the credential rows as verification's application and credentials read and write them through this module's entry, the subjects an approval grants and a revocation removes, the admin home's credentials card), `subjects.repository.ts` and `packages.repository.ts`. A router is thin: validate, call one service method, return: `subjects.router.ts` (under `catalog.subjects`), `credentials-admin.router.ts` (the administrator surface's `credentials` namespace, mounted by `admin.router.ts`, its service composed by the admin module) and `packages.router.ts` (under `teacher.packages`). What only booking can answer, whether a slot or a package is in use, comes through the `CatalogUse` port (`catalog-use.port.ts`, T020) that `main.ts` binds. `availability_slots` and `teacher_signatures` have no code yet. `index.ts` is the only import path.

## Requirement ids

- FR-153 (a subject becomes an approved teacher's on its credential's approval): `credential-review.service.ts`, `credentials.repository.ts`.
- FR-163, FR-164 (the credential review and the chain's correction): `credential-review.service.ts`.
- FR-182 (the subjects list, both names): `subjects.service.ts`, `subjects.router.ts`.
- FR-311, FR-312, FR-314, FR-315 (the teacher's packages): `packages.service.ts`, `packages.repository.ts`, `packages.router.ts`.
