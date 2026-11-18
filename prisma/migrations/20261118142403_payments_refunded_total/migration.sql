-- T102 of specs/003-booking/tasks.md (B-M2; ADR 0025 D3, SRS DEC-82, FR-PAYG-7 as amended; the
-- owner's decisions of 2026-11-18 on B-M2's conflict check, Q-2 (a) with its safety net; ERD
-- changelog row 56, §15 rule 61). The columns and the enum member as `prisma migrate diff` would
-- write them, then by hand what the schema language cannot say: the check.
--
-- What it lands: `payments.refunded_piasters`, the order's refunded total, the sum of every refund
-- the gateway's signed child events reported, from 0 to the gross; the order becomes `refunded` when
-- it reaches the gross. `payments.refund_reported_at`, when the gateway first flagged a refund on
-- the original payment, which reports no amount. `payment_event_type` gains `refund_reported`, that
-- flag's own event, at its end. Members are permanent (R-API-9).
--
-- Every existing row takes the default 0, which the check admits (the gross is never negative), so
-- nothing it would refuse exists before it runs. Then an order already `refunded` (a whole refund
-- recorded before this, T073's) takes its gross as its total, so «`refunded` ⇔ the total is the
-- gross» holds on old rows too; the update touches only rows that exist when it runs, and
-- `gross_piasters` is NOT NULL, so it needs no guard. No statement here uses the new member, so it
-- needs no COMMIT of its own.

-- AlterEnum
ALTER TYPE "payment_event_type" ADD VALUE 'refund_reported';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refund_reported_at" TIMESTAMPTZ(6),
ADD COLUMN     "refunded_piasters" BIGINT NOT NULL DEFAULT 0;

-- Hand-written: an order refunded before the total existed refunded its whole gross.
UPDATE "payments" SET "refunded_piasters" = "gross_piasters" WHERE "status" = 'refunded';

-- Hand-written: rule 61. The refunded total from 0 to the order's gross.
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_check"
    CHECK ("refunded_piasters" >= 0 AND "refunded_piasters" <= "gross_piasters");
