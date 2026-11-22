-- T174 of specs/002-identity/tasks.md (R1a; SRS DEC-97, FR-AUTH-14, NFR-COMP-2, ADR 0015 D3 as amended;
-- the note under T174, the owner's decisions of 2026-11-22 on R1a's conflict check, Q-2 (a); ERD §2,
-- §4, changelog rows 62 and 63, §15 rules 67 to 69). The enums, the two tables, their indexes and
-- foreign keys as `prisma migrate diff` would write them, with the relations' `onUpdate: Restrict`,
-- then by hand what the schema language cannot say: the checks and the revoked privileges.
--
-- What it lands: `teacher_application_history` (identity), one row per decision on a teacher's
-- application (approve, reject, a request for information, a ban) and per revocation of approval,
-- with its note, the administrator and the instant; `teacher_credential_history` (catalog), one row
-- per decision on a credential (approve, reject, a request for a document) and per correction, with
-- its note or reason and, for an approval and a correction, the name and the chain before and after.
-- The audit log keeps the entries without the text (DEC-97); the text is here.
--
-- WHY DELETE STAYS GRANTED (Q-2 (a)). Every other append-only table has UPDATE, DELETE and TRUNCATE
-- revoked (rule 21, rule 43, rule 65). These two are written once and never edited, but the deletion
-- of a teacher never approved removes them (FR-AUTH-14, DEC-97: an applicant never approved keeps
-- nothing). So UPDATE and TRUNCATE are revoked and DELETE stays, used by the erasure alone: a spec
-- finds no other code path deleting from them, and each erasure function refuses the history of a
-- teacher once approved. A legal redaction of a note, if ever needed, is a documented migration.
--
-- WHY THE APPLICATION'S ROW NAMES THE PROFILE, NOT THE USER. Every path that writes it already holds
-- the profile FOR UPDATE (`row-lock.ts`); a foreign key to `users` would take a key-share lock on the
-- account after the profile on a rejection, against the order.
--
-- Nothing that exists is refused: both tables are new and empty.

-- CreateEnum
CREATE TYPE "teacher_application_history_action" AS ENUM ('approve', 'reject', 'request_info', 'ban', 'revoke');

-- CreateEnum
CREATE TYPE "teacher_credential_history_action" AS ENUM ('approve', 'reject', 'request_document', 'correct');

-- CreateTable
CREATE TABLE "teacher_application_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teacher_profile_id" UUID NOT NULL,
    "action" "teacher_application_history_action" NOT NULL,
    "note" TEXT,
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_application_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_credential_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "credential_id" UUID NOT NULL,
    "action" "teacher_credential_history_action" NOT NULL,
    "note" TEXT,
    "before" JSONB,
    "after" JSONB,
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_credential_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teacher_application_history_teacher_profile_id_created_at_idx" ON "teacher_application_history"("teacher_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "teacher_application_history_admin_id_idx" ON "teacher_application_history"("admin_id");

-- CreateIndex
CREATE INDEX "teacher_credential_history_credential_id_created_at_idx" ON "teacher_credential_history"("credential_id", "created_at");

-- CreateIndex
CREATE INDEX "teacher_credential_history_admin_id_idx" ON "teacher_credential_history"("admin_id");

-- AddForeignKey
ALTER TABLE "teacher_application_history" ADD CONSTRAINT "teacher_application_history_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "teacher_profiles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "teacher_application_history" ADD CONSTRAINT "teacher_application_history_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "teacher_credential_history" ADD CONSTRAINT "teacher_credential_history_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "teacher_credentials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "teacher_credential_history" ADD CONSTRAINT "teacher_credential_history_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Hand-written: rule 67. A note on every decision but an approval, where it is optional; a note is
-- never blank and at most 1,000 characters (`adminReason`, `packages/contracts/src/admin/admins.ts`).
ALTER TABLE "teacher_application_history" ADD CONSTRAINT "teacher_application_history_note_check"
    CHECK (("action" = 'approve' OR "note" IS NOT NULL)
       AND ("note" IS NULL OR (length(btrim("note")) > 0 AND char_length("note") <= 1000)));

-- Hand-written: rule 68. The same note rule; the transcription before only on a correction, after on
-- an approval and a correction.
ALTER TABLE "teacher_credential_history" ADD CONSTRAINT "teacher_credential_history_note_check"
    CHECK (("action" = 'approve' OR "note" IS NOT NULL)
       AND ("note" IS NULL OR (length(btrim("note")) > 0 AND char_length("note") <= 1000)));

ALTER TABLE "teacher_credential_history" ADD CONSTRAINT "teacher_credential_history_transcription_check"
    CHECK ((("before" IS NOT NULL) = ("action" = 'correct'))
       AND (("after" IS NOT NULL) = ("action" IN ('approve', 'correct'))));

-- Rule 69 (Q-2 (a)): written once, never edited; DELETE stays for the erasure alone (see the header).
REVOKE UPDATE, TRUNCATE ON "teacher_application_history", "teacher_credential_history" FROM ijazah_app;
