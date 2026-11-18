-- B47 (specs/005-certification/tasks.md, the note under T011; the owner's Q-R3 (a) of 2026-11-18;
-- data-model.md; ERD changelog row 53, §15 rule 59): `reports.resolve` takes a note (FR-612,
-- contracts/admin-surface.md), stored in `user_reports.resolution_notes`; and a report's status,
-- resolution instant and administrator agree, in `ijazah_requests_decided_check`'s form: an open
-- report has neither, an `actioned` or `dismissed` one both. `user_reports` held no row on
-- `ijazah_integrity` when this was written (a count before it), so the check is validated at once.

-- AlterTable
ALTER TABLE "user_reports" ADD COLUMN     "resolution_notes" TEXT;

-- Rule 59: open ⇔ no resolution instant ⇔ no resolving administrator.
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_resolved_check"
    CHECK ((("status" = 'open') = ("resolved_at" IS NULL))
        AND (("resolved_at" IS NULL) = ("resolved_by_admin_id" IS NULL)));
