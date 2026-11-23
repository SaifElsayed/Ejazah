-- T009 of specs/006-programme/tasks.md (B-P2; FR-713, R-510; the conflict check's Q-4 (a), the
-- owner's «موافق على الكل (أ)» of 2026-11-23; specs/006-programme/data-model.md «Changed: payments»;
-- ERD changelog row 74, §15 rule 82). The column as `prisma migrate diff` writes it, then by hand the
-- check the schema language cannot say.
--
-- What it lands: `payments.card_consent_at`, the instant the student ticked «save my card» on a
-- programme order paid by hand (`programme.pay`, later `programme.renew`), kept as its own evidence
-- of the consent before any token exists (FR-713); T013 copies it into
-- `programme_cards.consented_at` when the gateway's `card_saved` arrives.
--
-- NO EXISTING ROW IS CHANGED. The column is added NULL on every row, which the check admits.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "card_consent_at" TIMESTAMPTZ(6);

-- Hand-written: rule 82. A consent only on a programme's order paid by hand: a `rest_in_full` or an
-- `instalment` that is not an automatic charge (an automatic charge uses the card already saved).
ALTER TABLE "payments" ADD CONSTRAINT "payments_card_consent_at_check"
    CHECK ("card_consent_at" IS NULL
        OR ("kind" IN ('rest_in_full', 'instalment') AND NOT "automatic"));
