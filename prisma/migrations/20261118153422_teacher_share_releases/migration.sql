-- T105 of specs/003-booking/tasks.md (B-M2; ADR 0025 D2, SRS DEC-81, DEC-89, FR-PAYG-7 as amended;
-- the notes under T105, the owner's decisions of 2026-11-18 on B-M2's conflict check, Q-4 (a);
-- ERD §7, changelog row 57, §15 rules 62 to 64). The enum, the table, the column, their indexes and
-- foreign keys as `prisma migrate diff` would write them, then by hand what the schema language
-- cannot say: the checks.
--
-- What it lands: `share_release_milestone`, why a release of the teacher's share fell due;
-- `teacher_share_releases`, one row per enrollment and milestone, written by the
-- `release-teacher-shares` sweep when the release falls due and marked once by an administrator who
-- executed it in the gateway's dashboard (a record, never a balance: R-MONEY-6 as amended by ADR
-- 0025); `payments.half_release_rate_percent`, the percent of the teacher's share released at half
-- the sessions, kept on an `ijazah_track` order when it is created.
--
-- The table is new and empty, so its checks refuse nothing that exists. The column is added NULL on
-- every existing row, which rule 64 admits.

-- CreateEnum
CREATE TYPE "share_release_milestone" AS ENUM ('recitation_end', 'ijazah_half', 'ijazah_end', 'teacher_dropout', 'student_complaint_close');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "half_release_rate_percent" SMALLINT;

-- CreateTable
CREATE TABLE "teacher_share_releases" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "milestone" "share_release_milestone" NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marked_at" TIMESTAMPTZ(6),
    "marked_by_admin_id" UUID,

    CONSTRAINT "teacher_share_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teacher_share_releases_teacher_user_id_idx" ON "teacher_share_releases"("teacher_user_id");

-- CreateIndex
CREATE INDEX "teacher_share_releases_marked_by_admin_id_idx" ON "teacher_share_releases"("marked_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_share_releases_enrollment_id_milestone_key" ON "teacher_share_releases"("enrollment_id", "milestone");

-- AddForeignKey
ALTER TABLE "teacher_share_releases" ADD CONSTRAINT "teacher_share_releases_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_share_releases" ADD CONSTRAINT "teacher_share_releases_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_share_releases" ADD CONSTRAINT "teacher_share_releases_marked_by_admin_id_fkey" FOREIGN KEY ("marked_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: rule 62's second half. A release carries money: above zero.
ALTER TABLE "teacher_share_releases" ADD CONSTRAINT "teacher_share_releases_amount_check"
    CHECK ("amount_piasters" > 0);

-- Hand-written: rule 63. The mark's instant and its administrator, both or neither.
ALTER TABLE "teacher_share_releases" ADD CONSTRAINT "teacher_share_releases_marked_check"
    CHECK (("marked_at" IS NULL) = ("marked_by_admin_id" IS NULL));

-- Hand-written: rule 64. The half's percent, when kept, a whole percent from 0 to 100.
ALTER TABLE "payments" ADD CONSTRAINT "payments_half_release_rate_check"
    CHECK ("half_release_rate_percent" IS NULL OR "half_release_rate_percent" BETWEEN 0 AND 100);
