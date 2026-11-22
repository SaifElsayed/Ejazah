-- T001 of specs/006-programme/tasks.md (B-P1; ADR 0024, SRS FR-701 to FR-732, DEC-92 to DEC-101,
-- DEC-110; specs/006-programme/data-model.md, research R-501, R-502, R-503, R-507, R-510, R-513; the
-- note under T001, the owner's Q-2 (a) of 2026-11-22; ERD changelog rows 65 to 73, §15 rules 70 to
-- 81). The enum values, the columns, the tables, their indexes and foreign keys as `prisma migrate
-- diff` writes them, then by hand what the schema language cannot say: the checks and the partial
-- unique on an open programme item.
--
-- What it lands: `payments.kind` (`order_kind`, every existing order a `package` one),
-- `instalment_month`, `attempt`, `automatic`, `decline_kind` and the confirm step's per-order marker
-- `confirmed_at`, `gateway_order_id` NULL-able only on an automatic order the gateway has not
-- answered or that was refused before it (rule 72), its unique index kept, and the index on
-- (`enrollment_id`, `kind`, `instalment_month`), not unique (a second paid order for a month is
-- recorded, FR-718); `packages.is_programme` and the three prices, the three old columns NULL-able
-- under the shape check (rule 73); `sessions.programme_month`; the tables `programmes`,
-- `programme_requests` (booking) and `programme_cards` (payments).
--
-- WHY A COMMIT AFTER THE ENUM VALUES (`20261108120000_sessions_pass`'s precedent). PostgreSQL refuses
-- a value added by `ALTER TYPE ... ADD VALUE` in the transaction that added it (55P04). Nothing below
-- names one of the new values, but the precedent keeps the script safe to extend and to run again:
-- the values are committed first, each `IF NOT EXISTS`, so the script runs again unchanged if its
-- second part is ever refused.
--
-- NO EXISTING ROW IS CHANGED (P2 (a)). The new columns are added with their defaults or NULL, which
-- every check admits: an existing order is a `package`, not automatic, with no month and its gateway
-- id; an existing package is not a programme one, its three old columns set (they were NOT NULL) and
-- its three prices NULL; an existing session has no month. The three tables are new and empty. The old
-- ijazah-track packages are deactivated by turning `programme_enabled` on (T002), not here.

-- AlterEnum
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'offer_declined';
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'offer_lapsed';
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'assessment_refused';
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'programme_stopped';

-- AlterEnum
ALTER TYPE "share_release_milestone" ADD VALUE IF NOT EXISTS 'assessment';
ALTER TYPE "share_release_milestone" ADD VALUE IF NOT EXISTS 'programme_stopped';

-- AlterEnum
ALTER TYPE "enrollment_event_kind" ADD VALUE IF NOT EXISTS 'programme_offered';
ALTER TYPE "enrollment_event_kind" ADD VALUE IF NOT EXISTS 'programme_paused';
ALTER TYPE "enrollment_event_kind" ADD VALUE IF NOT EXISTS 'programme_resumed';
ALTER TYPE "enrollment_event_kind" ADD VALUE IF NOT EXISTS 'programme_reopened';

-- AlterEnum
ALTER TYPE "payment_event_type" ADD VALUE IF NOT EXISTS 'card_saved';

-- The values above are committed before any statement below runs (see the header).
COMMIT;

-- CreateEnum
CREATE TYPE "order_kind" AS ENUM ('package', 'assessment', 'rest_in_full', 'instalment');

-- CreateEnum
CREATE TYPE "decline_kind" AS ENUM ('soft', 'hard');

-- CreateEnum
CREATE TYPE "programme_state" AS ENUM ('awaiting_offer', 'offered', 'active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "programme_plan" AS ENUM ('in_full', 'monthly');

-- CreateEnum
CREATE TYPE "programme_request_kind" AS ENUM ('stop', 'refusal', 'no_offer', 'pay_blocked');

-- CreateEnum
CREATE TYPE "programme_request_status" AS ENUM ('open', 'approved', 'declined', 'withdrawn', 'extended');

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "is_programme" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "price_30_piasters" BIGINT,
ADD COLUMN     "price_45_piasters" BIGINT,
ADD COLUMN     "price_60_piasters" BIGINT,
ALTER COLUMN "session_count" DROP NOT NULL,
ALTER COLUMN "session_duration_minutes" DROP NOT NULL,
ALTER COLUMN "price_piasters" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "attempt" SMALLINT,
ADD COLUMN     "automatic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "decline_kind" "decline_kind",
ADD COLUMN     "instalment_month" SMALLINT,
ADD COLUMN     "kind" "order_kind" NOT NULL DEFAULT 'package',
ALTER COLUMN "gateway_order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "programme_month" SMALLINT;

-- CreateTable
CREATE TABLE "programmes" (
    "enrollment_id" UUID NOT NULL,
    "state" "programme_state" NOT NULL,
    "offer_due_at" TIMESTAMPTZ(6),
    "pay_by_at" TIMESTAMPTZ(6),
    "level" TEXT,
    "readiness" TEXT,
    "expected_length" TEXT,
    "offered_at" TIMESTAMPTZ(6),
    "month_count" SMALLINT,
    "payment_plan" "programme_plan",
    "months_paid" SMALLINT NOT NULL DEFAULT 0,
    "next_due_at" TIMESTAMPTZ(6),
    "first_failure_at" TIMESTAMPTZ(6),
    "retries_done" SMALLINT NOT NULL DEFAULT 0,
    "paused_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateTable
CREATE TABLE "programme_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "kind" "programme_request_kind" NOT NULL,
    "reason" TEXT,
    "status" "programme_request_status" NOT NULL,
    "decided_by_admin_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "programme_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_cards" (
    "enrollment_id" UUID NOT NULL,
    "token_encrypted" BYTEA NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "consented_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "programme_cards_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateIndex
CREATE INDEX "payments_enrollment_id_kind_instalment_month_idx" ON "payments"("enrollment_id", "kind", "instalment_month");

-- CreateIndex
CREATE INDEX "programmes_state_next_due_at_idx" ON "programmes"("state", "next_due_at");

-- CreateIndex
CREATE INDEX "programme_requests_status_created_at_idx" ON "programme_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "programme_requests_enrollment_id_idx" ON "programme_requests"("enrollment_id");

-- CreateIndex
CREATE INDEX "programme_requests_teacher_user_id_idx" ON "programme_requests"("teacher_user_id");

-- CreateIndex
CREATE INDEX "programme_requests_decided_by_admin_id_idx" ON "programme_requests"("decided_by_admin_id");

-- AddForeignKey
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_decided_by_admin_id_fkey" FOREIGN KEY ("decided_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_cards" ADD CONSTRAINT "programme_cards_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: rule 70. The instalment's month, set (1 and up) exactly on an `instalment` order.
ALTER TABLE "payments" ADD CONSTRAINT "payments_instalment_month_check"
    CHECK (("kind" = 'instalment') = ("instalment_month" IS NOT NULL)
        AND ("instalment_month" IS NULL OR "instalment_month" >= 1));

-- Hand-written: rule 71. An automatic charge's attempt, 0 to 4 (R-508: at most four retries).
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_check"
    CHECK ("attempt" IS NULL OR "attempt" BETWEEN 0 AND 4);

-- Hand-written: rule 72 (N-3, PR #153 r3 Major 1). No gateway id only on an automatic order `created`
-- until the gateway answers, `expired` with no answer, or `failed` with a `hard` decline refused before
-- the gateway (`no_payee`). IS NOT DISTINCT FROM: a NULL `decline_kind` must refuse, not pass.
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway_order_id_check"
    CHECK ("gateway_order_id" IS NOT NULL
        OR ("automatic"
            AND ("status" IN ('created', 'expired')
                OR ("status" = 'failed' AND "decline_kind" IS NOT DISTINCT FROM 'hard'))));

-- Hand-written: rule 73 (R-503). A package that is not a programme one (a recitation package, or an
-- ijazah-track one created while `programme_enabled` is off) keeps its three old columns and no
-- price; a programme package is an ijazah-track one, its three prices set and the old three NULL.
ALTER TABLE "packages" ADD CONSTRAINT "packages_programme_shape_check"
    CHECK ((NOT "is_programme"
            AND "session_count" IS NOT NULL
            AND "session_duration_minutes" IS NOT NULL
            AND "price_piasters" IS NOT NULL
            AND "price_30_piasters" IS NULL
            AND "price_45_piasters" IS NULL
            AND "price_60_piasters" IS NULL)
        OR ("is_programme"
            AND "track" = 'ijazah_track'
            AND "session_count" IS NULL
            AND "session_duration_minutes" IS NULL
            AND "price_piasters" IS NULL
            AND "price_30_piasters" IS NOT NULL
            AND "price_45_piasters" IS NOT NULL
            AND "price_60_piasters" IS NOT NULL));

-- Hand-written: rule 74. The three prices, when set, above zero (rule 36's `price_piasters > 0`).
ALTER TABLE "packages" ADD CONSTRAINT "packages_programme_prices_positive_check"
    CHECK (("price_30_piasters" IS NULL OR "price_30_piasters" > 0)
        AND ("price_45_piasters" IS NULL OR "price_45_piasters" > 0)
        AND ("price_60_piasters" IS NULL OR "price_60_piasters" > 0));

-- Hand-written: rule 75 (R-507). A session's programme month, when set, 1 and up.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_programme_month_check"
    CHECK ("programme_month" IS NULL OR "programme_month" >= 1);

-- Hand-written: rule 76. A programme offered, active or paused has its offer's time.
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_offered_at_check"
    CHECK ("state" NOT IN ('offered', 'active', 'paused') OR "offered_at" IS NOT NULL);

-- Hand-written: rule 77. `paused_at` set exactly while `paused`; `closed_at` exactly once `closed`.
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_paused_at_check"
    CHECK (("paused_at" IS NOT NULL) = ("state" = 'paused'));

ALTER TABLE "programmes" ADD CONSTRAINT "programmes_closed_at_check"
    CHECK (("closed_at" IS NOT NULL) = ("state" = 'closed'));

-- Hand-written: rule 78. The paid months never above the month count (none before the offer sets
-- it; the count, when set, 1 and up); the retries 0 to 4 (R-508); the offer's three texts 1 to 500
-- characters, not blank (rule 65's bounds).
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_months_paid_check"
    CHECK (("month_count" IS NULL OR "month_count" >= 1)
        AND "months_paid" >= 0
        AND "months_paid" <= COALESCE("month_count", 0));

ALTER TABLE "programmes" ADD CONSTRAINT "programmes_retries_done_check"
    CHECK ("retries_done" BETWEEN 0 AND 4);

ALTER TABLE "programmes" ADD CONSTRAINT "programmes_offer_words_check"
    CHECK (("level" IS NULL OR (length(btrim("level")) > 0 AND char_length("level") <= 500))
        AND ("readiness" IS NULL OR (length(btrim("readiness")) > 0 AND char_length("readiness") <= 500))
        AND ("expected_length" IS NULL
            OR (length(btrim("expected_length")) > 0 AND char_length("expected_length") <= 500)));

-- Hand-written: rule 79 (R-513). One open item per enrollment and kind.
CREATE UNIQUE INDEX "programme_requests_one_open_key" ON "programme_requests"("enrollment_id", "kind")
    WHERE "status" = 'open';

-- Hand-written: rule 80. A reason, when given, not blank and at most 500 characters, and given on
-- every `stop` and `refusal`; `extended` only on a `no_offer` or `pay_blocked` item.
ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_reason_check"
    CHECK (("reason" IS NULL OR (length(btrim("reason")) > 0 AND char_length("reason") <= 500))
        AND ("kind" NOT IN ('stop', 'refusal') OR "reason" IS NOT NULL));

ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_extended_check"
    CHECK ("status" <> 'extended' OR "kind" IN ('no_offer', 'pay_blocked'));

-- Hand-written: rule 81. The deciding administrator and the instant set together, on every approval
-- and decline.
ALTER TABLE "programme_requests" ADD CONSTRAINT "programme_requests_decided_check"
    CHECK ((("decided_by_admin_id" IS NULL) = ("decided_at" IS NULL))
        AND ("status" NOT IN ('approved', 'declined') OR "decided_at" IS NOT NULL));
