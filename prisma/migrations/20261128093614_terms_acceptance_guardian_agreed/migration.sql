-- R3 T189 of specs/002-identity/tasks.md (SRS FR-AUTH-4 as amended by DEC-109; the owner's answer
-- of 2026-11-28 on R3's conflict check, «علامة ولي الأمر أ»; ERD changelog row 81). The column as
-- `prisma migrate diff` writes it; nothing by hand.
--
-- What it lands: `terms_acceptances.guardian_agreed_at`, the instant a minor ticked «وليّ أمري موافق
-- على تسجيلي» at sign-up, written by `onboarding.complete` in the same row as the Terms' acceptance
-- and equal to its `accepted_at`. NULL for an adult. The onboarding refuses a minor without the
-- tick, so the rule lives in the service, which knows the date of birth and the person's zone; the
-- database holds no check.
--
-- NO EXISTING ROW IS CHANGED. The column is added NULL on every row, with no default.

-- AlterTable
ALTER TABLE "terms_acceptances" ADD COLUMN     "guardian_agreed_at" TIMESTAMPTZ(6);
