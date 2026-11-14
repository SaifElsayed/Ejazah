-- T082 of specs/004-sessions/tasks.md (B42c; SRS FR-CANCEL-10, DEC-68; spec FR-513; data-model.md
-- §2.14; ERD changelog row 45, §15 rule 51). The column as `prisma migrate diff` writes it, then by
-- hand what the schema language cannot say: the check (Q-R14 (a)).
--
-- What it lands: `enrollments.admin_end_reason`, the reason both parties are shown of an
-- administrator's direct end (`sessions.endEnrollment`), written with the end, cleared by the
-- restore; the internal note stays in the audit entry only.
--
-- The column is NULL on every existing row, which the check admits, so nothing it would refuse
-- exists before it runs.

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "admin_end_reason" TEXT;

-- Hand-written: rule 51. The reason only on an enrollment `cancelled` with the reason `admin`,
-- 1 to 500 characters, so a restore that forgets to clear it is refused.
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_admin_end_reason_check"
    CHECK ("admin_end_reason" IS NULL
        OR (char_length("admin_end_reason") BETWEEN 1 AND 500
            AND "status" = 'cancelled'
            AND "cancellation_reason" = 'admin'));
