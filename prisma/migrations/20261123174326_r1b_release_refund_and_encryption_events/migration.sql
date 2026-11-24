-- R1b (specs/003-booking/tasks.md T125, T127; specs/004-sessions/tasks.md T084; SRS DEC-104,
-- DEC-105; the owner's answers of 2026-11-23 on R1b's conflict check, Q-3 (a), Q-4 (a), Q-5 (a);
-- ERD changelog rows 76 to 78, §15 rules 83 and 84). The enum values and the columns as `prisma
-- migrate diff` writes them, then by hand the checks the schema language cannot say.
--
-- What it lands: `share_release_milestone` gains `direct_end` (the release of an administrator's
-- direct end on the student's stop, a student's deletion by an administrator and a gender
-- correction, T125); `teacher_share_releases.refund_taken_off_piasters`, the teacher's share of the
-- refunds an end release took off when it was written (T127); `session_event_kind` gains
-- `encryption_failed` and `session_events.party` names the side whose phone could not encrypt
-- (T084).
--
-- WHY A COMMIT AFTER THE ENUM VALUES (`20261108120000_sessions_pass`'s and
-- `20261122110318_ijazah_programme`'s precedent). PostgreSQL refuses a value added by `ALTER TYPE ...
-- ADD VALUE` in the transaction that added it (55P04), and rules 83 and 84 name the new values' types.
-- The values are committed first, each `IF NOT EXISTS`, so the script runs again unchanged if its
-- second part is ever refused.
--
-- NO EXISTING ROW IS CHANGED. `refund_taken_off_piasters` is added 0 on every row and `party` NULL,
-- which both checks admit: no existing event is `encryption_failed`.

-- AlterEnum
ALTER TYPE "share_release_milestone" ADD VALUE IF NOT EXISTS 'direct_end';

-- AlterEnum
ALTER TYPE "session_event_kind" ADD VALUE IF NOT EXISTS 'encryption_failed';

-- The values above are committed before any statement below runs (see the header).
COMMIT;

-- AlterTable
ALTER TABLE "teacher_share_releases" ADD COLUMN     "refund_taken_off_piasters" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "session_events" ADD COLUMN     "party" "role";

-- Hand-written: rule 83. The refund share is never below zero, and only the three end releases take
-- refunds off (`takenOffAtEnd`, the programme's refund); every other milestone writes 0.
ALTER TABLE "teacher_share_releases" ADD CONSTRAINT "teacher_share_releases_refund_taken_off_check"
    CHECK ("refund_taken_off_piasters" >= 0
        AND ("refund_taken_off_piasters" = 0
            OR "milestone" IN ('recitation_end', 'ijazah_end', 'programme_stopped')));

-- Hand-written: rule 84. The side that could not encrypt, set exactly on an `encryption_failed` row.
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_party_check"
    CHECK (("kind" = 'encryption_failed') = ("party" IS NOT NULL));
