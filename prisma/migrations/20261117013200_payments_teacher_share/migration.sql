-- T104 of specs/003-booking/tasks.md (B-M1; ADR 0025 D1, SRS DEC-80, FR-PAYG-1 and FR-PAYG-7 as
-- amended; ERD changelog row 46, §15 rule 52). The columns as `prisma migrate diff` would write them,
-- then by hand what the schema language cannot say: the three checks.
--
-- What it lands: `payments.teacher_share_rate_percent` (the teacher's share rate read when the order
-- was created, whole percent) and `payments.teacher_share_piasters` (the share it gave, sent to the
-- gateway as the split), both kept on the order so a later change of the setting reaches new orders
-- only.
--
-- Both are NULL on every existing row: an order created before the commission has neither, which
-- the checks admit, so nothing they would refuse exists before they run.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "teacher_share_piasters" BIGINT,
ADD COLUMN     "teacher_share_rate_percent" SMALLINT;

-- Hand-written: rule 52. The rate a whole percent from 0 to 100.
ALTER TABLE "payments" ADD CONSTRAINT "payments_teacher_share_rate_check"
    CHECK ("teacher_share_rate_percent" IS NULL
        OR "teacher_share_rate_percent" BETWEEN 0 AND 100);

-- The share from 0 to the order's gross.
ALTER TABLE "payments" ADD CONSTRAINT "payments_teacher_share_piasters_check"
    CHECK ("teacher_share_piasters" IS NULL
        OR ("teacher_share_piasters" >= 0 AND "teacher_share_piasters" <= "gross_piasters"));

-- Both or neither.
ALTER TABLE "payments" ADD CONSTRAINT "payments_teacher_share_both_check"
    CHECK (("teacher_share_rate_percent" IS NULL) = ("teacher_share_piasters" IS NULL));
