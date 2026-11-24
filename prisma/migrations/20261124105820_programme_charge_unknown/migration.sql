-- B-P3 (specs/006-programme/tasks.md T014; SRS DEC-113; the owner's answers of 2026-11-24 on B-P3's
-- conflict check, Q-1 (a), «موافق على الكل (أ) مع تحسين س٢», and on lane b's stop 1, Q-b2 (a),
-- «Approve all»; ERD changelog row 80, §15 rule 80 as amended). The enum value as `prisma migrate
-- diff` writes it, then by hand rule 80's check replaced.
--
-- What it lands: `programme_request_kind` gains `charge_unknown`, at its end: the sweep's
-- Administrator item for an automatic charge the gateway has not answered after
-- `programme_charge_inquiry_tries` asks. One open item per enrollment and kind is the existing
-- partial unique index (`programme_requests_one_open_key`). An administrator who extends it («keep
-- asking») writes `extended` on it, so rule 80's check admits `extended` on that kind too.
--
-- WHY A COMMIT AFTER THE ENUM VALUE (`20261123180222_r1b_application_history_call_replaced`'s
-- precedent): the new check names the value, which PostgreSQL refuses in the transaction that added
-- it (55P04).
--
-- NO EXISTING ROW IS CHANGED: no row is `charge_unknown`, and every existing row met the old check,
-- which the new one admits unchanged for every other kind.

-- AlterEnum
ALTER TYPE "programme_request_kind" ADD VALUE IF NOT EXISTS 'charge_unknown';

-- The value above is committed before any statement below runs (see the header).
COMMIT;

-- Hand-written: rule 80 as amended. `extended` only on the sweep's three items.
ALTER TABLE "programme_requests" DROP CONSTRAINT "programme_requests_extended_check";
ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_extended_check"
    CHECK ("status" <> 'extended' OR "kind" IN ('no_offer', 'pay_blocked', 'charge_unknown'));
