-- T141 — no two sessions overlap in time for one teacher, nor for one student (ERD section 15.19,
-- FR-BOOK-5, ADR 0010 D1). Raw SQL: the schema language has no exclusion constraint (research R-6).
--
-- A cancelled or soft-deleted session frees its time; every other status occupies it. The range
-- includes its start and excludes its end, so back-to-back sessions are allowed. Both constraints
-- are DEFERRABLE INITIALLY IMMEDIATE: every ordinary write is checked as it happens, and only the
-- re-resolution job of ADR 0009 runs `SET CONSTRAINTS ... DEFERRED`, so a uniform time zone shift
-- of back-to-back sessions commits and only a true overlap is refused.

-- `uuid WITH =` in a GiST index needs the btree operator classes.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_no_overlap" EXCLUDE USING gist (
    "teacher_user_id" WITH =,
    tstzrange("scheduled_start_at", "scheduled_end_at") WITH &&
) WHERE ("deleted_at" IS NULL AND "status" NOT IN ('cancelled_by_agreement', 'cancelled_by_admin'))
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_no_overlap" EXCLUDE USING gist (
    "student_user_id" WITH =,
    tstzrange("scheduled_start_at", "scheduled_end_at") WITH &&
) WHERE ("deleted_at" IS NULL AND "status" NOT IN ('cancelled_by_agreement', 'cancelled_by_admin'))
  DEFERRABLE INITIALLY IMMEDIATE;
