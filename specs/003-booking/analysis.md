# Analysis: Phase 2 — spec, plan and tasks

**Date**: 2026-11-01 · `/speckit-analyze` over [spec.md](./spec.md), [plan.md](./plan.md) (with research, data model and
contracts) and [tasks.md](./tasks.md) at commit 908723d, against `.specify/memory/constitution.md`. Read-only: no
artefact was changed by this run; the remediations below wait for the owner's word.

**Remediation (2026-11-01).** The owner approved the nine as written, with one addition to C2: a third paging spec, a
page whose last row is a teacher with no review followed by a page that repeats and skips no one. Applied to spec.md
(I1), research.md (R-201, R-203, R-204), data-model.md (§2.2, §6), plan.md (the R-DB row, the review-only tier,
re-check 6) and tasks.md (T004, T009, T010, T011, T025, T028, T038, T056, B25's order).

## Findings

| ID | Category | Severity | Location | Summary | Recommendation |
|----|----------|----------|----------|---------|----------------|
| C1 | Constitution (R-DB-9) | CRITICAL | data-model.md §2.2 and §6; research.md R-203; plan.md, Constitution Check row R-DB and the review-only tier; tasks.md T004 | The index `users (display_name_folded text_pattern_ops)` is justified "by FR-333 itself". R-DB-9: an index beyond ERD §14 needs a measured slow query first; none exists, and R-201 itself defers scaling to a measured query. | Drop the index from T004, data-model §2.2/§6, R-203 and the plan's rows. T057 measures SC-310 on the phone; a slow search found there becomes a follow-up with the measured query, and only then the index. |
| C2 | Constitution (R-API-6, R-API-2) | CRITICAL | research.md R-204 (as amended 2026-11-01); plan.md re-check 6; tasks.md T025 | The total order and its keyset are placed in catalog's `discovery.service.ts`, but the rating, review count and name live in `teacher_profiles` and `users`, identity's tables, which catalog may not read; and `COALESCE(...)` in an ORDER BY needs raw SQL, which only `apps/api/src/platform/db/` may hold. | identity's `visibleTeachers` returns the ordered page: catalog passes the candidate ids its own tables allow (subject, track, riwaya, an active package), with the name prefix, the minimum rating, the cursor and the page size; identity orders and pages them through Prisma. Use `NULLS LAST` (`orderBy: { averageRating: { sort: 'desc', nulls: 'last' } }`, already used in `verification/verification-requests.repository.ts` line 42) instead of `COALESCE`, with the keyset's NULL branch written out. The owner allowed either; results are identical, since a rating is 1 to 5. Both specs stay. T010 and T025 change wording; no task moves. |
| U1 | Underspecification | MEDIUM | tasks.md T011 | "A spec fails when a student procedure of the router is not registered" would pull Phase 1's student procedures (account, onboarding, documents), which return no teacher, into the gender harness. | The check covers the procedures that return teacher data or act on a teacher's slot (FR-410): the `discovery`, `booking`, `checkout` and `enrollments` routers, plus any later procedure whose output names a teacher; the rest are listed as exempt with the reason. |
| I1 | Inconsistency | MEDIUM | spec.md, Edge Cases (the account-deletion line) | It says "the plan checks what Phase 1's deletion already does with holds" and "as ADR 0015 D4 cancels a confirmed one", as if this phase cancelled confirmed enrollments; the plan settled both: R-219 (holds and pending enrollments, T041) and T059 (the confirmed part, Phase 3's first batch). | Rewrite the line to state R-219's behaviour and point the confirmed part to T059. |
| G1 | Coverage | MEDIUM | spec.md SC-309; tasks.md T056, T057 | SC-309 (success screen within the timeout in 95% of sandbox purchases) has no task: it can be measured only on the gateway's sandbox. | T056 measures it in the sandbox run; if the phase closes on the stand-in, SC-309 moves with FR-371's numbered task, said in T056's note. |
| G2 | Coverage | LOW | spec.md US1 scenario 8, FR-315; tasks.md T028 | No task proves that a replaced payout account hides the teacher until it is verified again. Phase 1's replacement clears `payout_verified_at` (`identity/payout.repository.ts` line 63), so the predicate covers it, but nothing asserts it. | One adversarial case in T028: a teacher whose payout was replaced is absent, then present after `recipientVerified`. |
| G3 | Coverage | LOW | spec.md FR-360; tasks.md T038 | T038 does not repeat FR-360's "a hash of the body, never the body"; Phase 1 writes `payment_events.payload_hash` for recipient events. | T038's spec asserts an order event stores `payload_hash` and no body. |
| L1 | Constitution wording (R-MONEY-2) | LOW | tasks.md T009 | `perSession(total, …)` and `formatPounds(amount, …)` name money parameters without `_piasters`; R-212 names them `total_piasters` and `amount_piasters`. | Use R-212's names in T009. |
| L2 | Ordering | LOW | tasks.md B25 | T018 and T019 call T020's port, listed after them in the same batch. | Within B25, T020 is written first; the lanes for T018 and T019 start on it. No batch change. |

## Coverage

| Requirement | Tasks | Notes |
|---|---|---|
| FR-301 to FR-306 | Carried table; 002 tasks in B20–B23, B26; T057 | FR-306: no Phase 2 code suspends or bans (002:T144 stays open) |
| FR-310 to FR-318 | T016–T023 | FR-316 by the contracts' two names and the screens |
| FR-330 to FR-338 | T010, T011, T024–T030 | C2 changes where FR-334/335's order runs |
| FR-350 to FR-358 | T031–T033, T036, T044, T045 | |
| FR-360 to FR-374 | T004, T012, T013, T034, T035, T038–T040, T042, T048, T056 | |
| FR-380 to FR-386 | T002, T015, T032, T036, T046, T050 | |
| FR-390 to FR-395 | T026, T049–T051 | |
| FR-400 to FR-402 | T052, T053 | |
| FR-410 to FR-414 | T011, T028, T043, T054, every contract task; FR-414 by 002:T123's spec over every key | |
| SC-301 to SC-314 | T008, T011, T013, T028, T033, T039, T042, T043, T047, T050, T054, T056, T057 | SC-309: G1 |

Unmapped tasks: none. T058 and T059 are follow-ups outside the phase by the owner's decisions of 2026-11-01.

## Metrics

- Requirements: 69 functional (FR-301 to FR-414) and 14 success criteria
- Tasks: 59 in this file, 21 carried from `specs/002-identity/tasks.md`
- Coverage: 82 of 83 with a task; SC-309 only through T056 (G1)
- Ambiguities: 1 (U1) · Duplications: 0 · Critical: 2 (C1, C2)

## Effect on the batches

None. Every remediation changes the wording of a task already placed (T004, T009, T010, T011, T025, T028, T038,
T056) or a line of the spec, research, data model or plan; no task is added, removed or moved, and B20 to B22 are
untouched.
