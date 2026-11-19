-- T112 of specs/003-booking/tasks.md (B-M3; SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-6, DEC-86, DEC-90;
-- the note under T112, the owner's decisions of 2026-11-19 on B-M3's conflict check, Q-2 (a); ERD §5,
-- changelog row 59, §15 rules 65 and 66, rule 19 as amended). The enum values, the table, the column,
-- their indexes and foreign keys as `prisma migrate diff` would write them, then by hand what the
-- schema language cannot say: the checks and the two overlap exclusions re-created.
--
-- What it lands: `session_status` gains `postponed`, a session its party postponed, never evaluated
-- and freeing both parties' time; `session_event_kind` gains `postponed`, the event written for each
-- session a postponement moves; `session_postponements`, one row per request (the enrollment, the
-- party who asked, the reason, when), never edited; `sessions.postponement_id`, the request that
-- moved the session, set exactly on a `postponed` session (rule 66); and both overlap exclusions of
-- rule 19 re-created under the same names with `postponed` freed beside the two cancelled statuses.
--
-- WHY A COMMIT AFTER THE ENUM VALUES (`20261108120000_sessions_pass`'s precedent). PostgreSQL refuses
-- a value added by `ALTER TYPE ... ADD VALUE` in the transaction that added it (55P04), and rule 66
-- and the exclusions name `postponed`. The values are committed first, each `IF NOT EXISTS`, so the
-- script can run again unchanged if its second part is ever refused.
--
-- Nothing that exists is refused: the table is new and empty, the column is NULL on every row and no
-- session can be `postponed` before this, so rule 66 holds on every row; the exclusions now count a
-- subset of the rows they counted (one more status freed), so no pair they admitted before is
-- refused. Re-creating them rebuilds their two GiST indexes under a lock on `sessions` for the
-- migration's length.

-- AlterEnum
ALTER TYPE "session_status" ADD VALUE IF NOT EXISTS 'postponed';

-- AlterEnum
ALTER TYPE "session_event_kind" ADD VALUE IF NOT EXISTS 'postponed';

-- The values above are committed before any statement below uses them (see the header).
COMMIT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "postponement_id" UUID;

-- CreateTable
CREATE TABLE "session_postponements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_postponements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_postponement_id_idx" ON "sessions"("postponement_id");

-- CreateIndex
CREATE INDEX "session_postponements_enrollment_id_idx" ON "session_postponements"("enrollment_id");

-- CreateIndex
CREATE INDEX "session_postponements_requested_by_user_id_idx" ON "session_postponements"("requested_by_user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_postponement_id_fkey" FOREIGN KEY ("postponement_id") REFERENCES "session_postponements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_postponements" ADD CONSTRAINT "session_postponements_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_postponements" ADD CONSTRAINT "session_postponements_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: rule 65. The party's reason, not blank and at most 500 characters (FR-POSTPONE-1;
-- `PARTICIPANT_REASON_MAX_LENGTH`, as a cancellation request's, rule 45).
ALTER TABLE "session_postponements" ADD CONSTRAINT "session_postponements_reason_check"
    CHECK (length(btrim("reason")) > 0 AND char_length("reason") <= 500);

-- Rule 65: the row records something that happened, and the interval (FR-POSTPONE-4) is counted from
-- it, so the application role may not rewrite or remove it (`session_events`' pattern, rule 43).
REVOKE UPDATE, DELETE, TRUNCATE ON "session_postponements" FROM ijazah_app;

-- Hand-written: rule 66. A session is `postponed` exactly when a postponement moved it.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_postponement_check"
    CHECK (("status" = 'postponed') = ("postponement_id" IS NOT NULL));

-- Hand-written: rule 19 as amended. Both overlap exclusions (`20261007000400_booking_overlap`)
-- re-created under their names, `postponed` freeing its time as the two cancelled statuses do
-- (FR-POSTPONE-1, DEC-90; Q-2 (a)); otherwise unchanged.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_teacher_no_overlap";

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_no_overlap" EXCLUDE USING gist (
    "teacher_user_id" WITH =,
    tstzrange("scheduled_start_at", "scheduled_end_at") WITH &&
) WHERE ("deleted_at" IS NULL AND "status" NOT IN ('cancelled_by_agreement', 'cancelled_by_admin', 'postponed'))
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "sessions" DROP CONSTRAINT "sessions_student_no_overlap";

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_no_overlap" EXCLUDE USING gist (
    "student_user_id" WITH =,
    tstzrange("scheduled_start_at", "scheduled_end_at") WITH &&
) WHERE ("deleted_at" IS NULL AND "status" NOT IN ('cancelled_by_agreement', 'cancelled_by_admin', 'postponed'))
  DEFERRABLE INITIALLY IMMEDIATE;
