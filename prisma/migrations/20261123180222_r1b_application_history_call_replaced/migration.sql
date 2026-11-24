-- R1b (specs/002-identity/tasks.md T186; SRS DEC-97; the owner's answer of 2026-11-23 on T186's
-- question, «سؤال T186 (أ)», typed in R1b's review session; ERD changelog row 79, §15 rule 67 as
-- amended). The enum value as `prisma migrate diff` writes it, then by hand rule 67's check replaced.
--
-- What it lands: `teacher_application_history_action` gains `call_replaced`, the row that keeps an
-- ever-approved teacher's earlier verification call notes when a new call is recorded on a later
-- application (DEC-97: kept with no end date). The call's notes are bounded at 2,000 characters
-- (`applicationsRecordCallInput`, `packages/contracts/src/admin/applications.ts`), so rule 67's bound
-- is 2,000 on a `call_replaced` row and stays 1,000 on every decision.
--
-- WHY A COMMIT AFTER THE ENUM VALUE (`20261123174326_r1b_release_refund_and_encryption_events`'s
-- precedent): the new check names the value, which PostgreSQL refuses in the transaction that added
-- it (55P04).
--
-- NO EXISTING ROW IS CHANGED: no row is `call_replaced`, and every existing row met the old check,
-- which the new one admits unchanged for every other action.

-- AlterEnum
ALTER TYPE "teacher_application_history_action" ADD VALUE IF NOT EXISTS 'call_replaced';

-- The value above is committed before any statement below runs (see the header).
COMMIT;

-- Hand-written: rule 67 as amended. A note on every row but an approval; never blank; at most 1,000
-- characters on a decision (`adminReason`) and 2,000 on a `call_replaced` row (the call's own bound).
ALTER TABLE "teacher_application_history" DROP CONSTRAINT "teacher_application_history_note_check";
ALTER TABLE "teacher_application_history" ADD CONSTRAINT "teacher_application_history_note_check"
    CHECK (("action" = 'approve' OR "note" IS NOT NULL)
       AND ("note" IS NULL OR (length(btrim("note")) > 0
            AND char_length("note") <= CASE WHEN "action" = 'call_replaced' THEN 2000 ELSE 1000 END)));
