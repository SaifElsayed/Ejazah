# Contract: Kernel changes (Phase 2)

What the kernel and the composition root gain. Raw SQL stays in `apps/api/src/platform/db/` (R-API-6).

## Locks and constraints (`apps/api/src/platform/db/`)

| Export | File | Contract |
|---|---|---|
| `lockRows(tx, table, ids)` | `row-lock.ts` | `SELECT 1 FROM <table> WHERE id = ANY($ids) ORDER BY id FOR UPDATE`; `table` from a closed union of the tables that need it (`users`, `teacher_profiles`, `enrollments`, `availability_slots`); the order prevents deadlock between two callers locking the same set. First used by T126 (Phase 2's first batch), then by T142, T161, R-207 and R-215 |
| `lockKey(tx, scope, id)` | `row-lock.ts` | `pg_advisory_xact_lock(hashtext(scope), hashtext(id))`; `scope` from a closed union (`'teacher-slots'`). Released at commit or rollback (R-206) |
| `withDeferredSessionConstraints(tx)` | `deferred-constraints.ts` | `SET CONSTRAINTS sessions_teacher_no_overlap, sessions_student_no_overlap DEFERRED` for the re-resolution job only (ERD §15 rule 19, R-210) |
| `isUniqueViolation(error, constraint)`, `isExclusionViolation(error, constraint)` | `db-errors.ts` | Name the database's refusal so the confirm job takes the refusal branch on exactly `slot_holds_slot_id_active_key`, `slot_holds_student_user_id_active_key` and the two session exclusions, and rethrows anything else (R-215) |

## The composition root

`AppServices` (`apps/api/src/surfaces/context.ts`) gains `teacherProfile`, `catalog` (packages, slots, discovery
cards), `booking` (slots, enrollments, the teacher's lists, discovery composition), `checkout` (payments). The admin
side gains `payments` in `AdminSurfaceServices`. `main.ts` binds:

- catalog's `CatalogUse` port to booking's `slotInUse` and `packageHasEnrollment` (R-207);
- booking as a subscriber of identity's `AccountConsequences` (R-219), beside verification's;
- the queue producer for `confirm-enrollment` into the webhook's order branch (R-214).

## Jobs (`apps/api/src/jobs/`, registered in `worker.ts`)

| Job | Schedule | Payload | Double-run spec |
|---|---|---|---|
| `confirm-enrollment` | queued by the webhook | `{ paymentId }` | twice = once: one confirmation, one set of sessions, one event row |
| `expire-pending-payments` | every minute | `{}` | twice = once |
| `expire-holds` | every minute | `{}` | twice = once |
| `reresolve-session-instants` (`tzdata-reresolve`) | at worker start and daily | `{}` | twice = once under the same tz version |

## Gates

- The magic-number gate (`scripts/magic-number-gate.ts`) covers the new modules' code; every number is a setting,
  a contract bound (`30 | 45 | 60`, the rating's `1..5`) or a conversion.
- The R-HONEST-1 gate the constitution assigns to Phase 2 (`lint-rules.md` line 167): a CI test that finds every write of
  `enrollments.status = 'confirmed'` or `confirmed_at` and asserts the only one is `booking.confirmEnrollment`, called
  only from `confirm-enrollment` (FR-366, SC-307).
- The adversarial suite's procedure harness (R-202).
- The coverage floor widens to `modules/booking`, `modules/payments`, `modules/sessions` (generation) and
  `modules/moderation` (the case), as Phase 1 widened it to its modules.
