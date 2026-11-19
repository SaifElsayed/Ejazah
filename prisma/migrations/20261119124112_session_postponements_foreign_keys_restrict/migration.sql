-- 003:T112 (B-M3; PR #151's review, round 1, Major 1; ERD §15 rule 65, rule 43's pattern, changelog
-- row 59). `prisma migrate diff` as it writes the relations' `onUpdate: Restrict, onDelete: Restrict`.
--
-- What it lands: the two foreign keys of the append-only `session_postponements`
-- (`20261119095115_session_postponements`), `enrollment_id` and `requested_by_user_id`, go from
-- `ON UPDATE CASCADE` to `ON UPDATE RESTRICT`, as 002:T135 (`20261101050220_append_only_foreign_keys_restrict`)
-- did for the tables before it. The cascade ran as the table's owner, so an UPDATE of the referenced
-- key, which the application role holds on `users` and `enrollments`, rewrote a postponement row past
-- the UPDATE that migration revoked, and the interval (FR-POSTPONE-4) is counted from that row. Now
-- the key update is refused while a row references it. `ON DELETE RESTRICT` is unchanged.
--
-- Nothing that exists is refused: the keys are re-added over rows that already satisfy them.

-- DropForeignKey
ALTER TABLE "session_postponements" DROP CONSTRAINT "session_postponements_enrollment_id_fkey";

-- DropForeignKey
ALTER TABLE "session_postponements" DROP CONSTRAINT "session_postponements_requested_by_user_id_fkey";

-- AddForeignKey
ALTER TABLE "session_postponements" ADD CONSTRAINT "session_postponements_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "session_postponements" ADD CONSTRAINT "session_postponements_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
