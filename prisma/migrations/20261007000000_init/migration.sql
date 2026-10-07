-- T064 — the initial migration (research R-6).
--
-- Generated from prisma/schema with `prisma migrate diff --from-empty --to-schema prisma/schema
-- --script`, then extended by hand in two places, each marked "Hand-written": the `citext`
-- extension the `users.email` column needs (note under T055), created before the tables, and the
-- check constraints of data-model.md section 6 that the schema language cannot express, at the end.
-- Immutable once merged (R-DB-1). Roles and privileges are T065; partial indexes T066 and T067;
-- the overlap exclusions T141.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Hand-written (note under T055): `users.email` is citext, so two spellings of one address are one.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('ar', 'en');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('active', 'suspended', 'verification_required', 'banned');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('student', 'teacher');

-- CreateEnum
CREATE TYPE "role_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "teacher_verification_status" AS ENUM ('pending', 'approved', 'rejected', 'suspended', 'banned');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('signup', 'login', 'password_reset');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "verification_document_type" AS ENUM ('national_id', 'passport', 'credential', 'other');

-- CreateEnum
CREATE TYPE "verification_request_status" AS ENUM ('open', 'satisfied', 'expired');

-- CreateEnum
CREATE TYPE "isnad_verification_status" AS ENUM ('unverified', 'verified');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('pending_payment', 'confirmed', 'completed', 'terminated_no_show', 'cancelled');

-- CreateEnum
CREATE TYPE "cancellation_reason" AS ENUM ('payment_expired', 'payment_failed', 'admin', 'gender_correction', 'teacher_suspended', 'slot_unavailable', 'checkout_abandoned');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('scheduled', 'done', 'student_no_show', 'teacher_no_show', 'both_no_show', 'under_threshold', 'provider_outage', 'cancelled_by_agreement', 'cancelled_by_admin', 'disputed');

-- CreateEnum
CREATE TYPE "participant_event_type" AS ENUM ('joined', 'left');

-- CreateEnum
CREATE TYPE "cancellation_request_status" AS ENUM ('pending', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "payment_gateway" AS ENUM ('fake');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('created', 'paid', 'failed', 'expired', 'refunded');

-- CreateEnum
CREATE TYPE "payment_event_type" AS ENUM ('paid', 'failed', 'expired', 'refunded', 'recipient_verified', 'recipient_rejected');

-- CreateEnum
CREATE TYPE "ijazah_mode" AS ENUM ('generated', 'uploaded');

-- CreateEnum
CREATE TYPE "dispute_kind" AS ENUM ('session_dispute', 'compensation_case');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "dispute_resolution" AS ENUM ('upheld', 're_marked', 'no_show_recorded', 'compensation_ordered', 'party_suspended', 'party_banned');

-- CreateEnum
CREATE TYPE "gender_flag_status" AS ENUM ('open', 'corrected', 'fraud_ban', 'dismissed');

-- CreateEnum
CREATE TYPE "user_report_context" AS ENUM ('session', 'profile', 'chat');

-- CreateEnum
CREATE TYPE "user_report_status" AS ENUM ('open', 'actioned', 'dismissed');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('teacher_application_status_changed', 'new_booking', 'session_reminder', 'no_show_recorded', 'cancellation_requested', 'cancellation_request_accepted', 'cancellation_request_declined', 'payment_confirmed', 'payment_failed', 'payment_expired', 'payout_account_verified', 'dispute_resolved', 'gender_flag_resolved', 'ijazah_granted', 'ijazah_revoked', 'new_review');

-- CreateEnum
CREATE TYPE "idempotency_key_status" AS ENUM ('in_progress', 'completed');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "mfa_secret_encrypted" BYTEA NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "slot_holds" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slot_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slot_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "student_user_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "snapshot_price_piasters" BIGINT NOT NULL,
    "snapshot_session_count" INTEGER NOT NULL,
    "snapshot_duration_minutes" INTEGER NOT NULL,
    "snapshot_subject_id" UUID NOT NULL,
    "snapshot_slot_timezone" TEXT NOT NULL,
    "status" "enrollment_status" NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancellation_reason" "cancellation_reason",
    "deleted_at" TIMESTAMPTZ(6),
    "purchased_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_subjects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teacher_user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teacher_user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "session_count" INTEGER NOT NULL,
    "session_duration_minutes" INTEGER NOT NULL,
    "price_piasters" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_slots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teacher_user_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_time_local" TIME(0) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "isnad_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teacher_user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "transmitter_name" TEXT NOT NULL,
    "verification_status" "isnad_verification_status" NOT NULL,
    "verified_by_admin_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "isnad_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_signatures" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teacher_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ijazahs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "certificate_number" TEXT NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "mode" "ijazah_mode" NOT NULL,
    "language" "language" NOT NULL,
    "chain_snapshot" JSONB,
    "certificate_storage_key" TEXT NOT NULL,
    "paper_copy_intended" BOOLEAN NOT NULL,
    "verification_token_hash" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "revoked_by_admin_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ijazahs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ijazah_bars" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "barred_by_admin_id" UUID NOT NULL,
    "barred_at" TIMESTAMPTZ(6) NOT NULL,
    "lifted_at" TIMESTAMPTZ(6),
    "lifted_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ijazah_bars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "body" TEXT,
    "attachment_key" TEXT,
    "attachment_filename" TEXT,
    "attachment_mime" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "phone" TEXT,
    "email" CITEXT,
    "password_hash" TEXT,
    "gender" "gender" NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "display_name" TEXT NOT NULL,
    "preferred_language" "language" NOT NULL,
    "timezone" TEXT NOT NULL,
    "account_status" "account_status" NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "status" "role_status" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "bio" TEXT NOT NULL,
    "photo_key" TEXT,
    "qualification_summary" TEXT NOT NULL,
    "verification_status" "teacher_verification_status" NOT NULL,
    "verification_call_completed_at" TIMESTAMPTZ(6),
    "verification_call_notes" TEXT,
    "approved_by_admin_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "payout_account_ref_encrypted" BYTEA,
    "payout_configured_at" TIMESTAMPTZ(6),
    "payout_verified_at" TIMESTAMPTZ(6),
    "average_rating" DECIMAL(3,2),
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "destination" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_encrypted" BYTEA NOT NULL,
    "token_hash" TEXT NOT NULL,
    "platform" "device_platform" NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms_acceptances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "terms_version" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "session_id" UUID,
    "kind" "dispute_kind" NOT NULL,
    "raised_by_user_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL,
    "resolution" "dispute_resolution",
    "resolution_notes" TEXT,
    "resolved_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gender_flags" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "flagged_user_id" UUID NOT NULL,
    "raised_by_user_id" UUID,
    "status" "gender_flag_status" NOT NULL,
    "resolution_notes" TEXT,
    "resolved_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gender_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_reports" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "reported_user_id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "context" "user_report_context" NOT NULL,
    "session_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "user_report_status" NOT NULL,
    "resolved_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "title_key" TEXT NOT NULL,
    "body_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "pushed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "gateway" "payment_gateway" NOT NULL,
    "gateway_order_id" TEXT NOT NULL,
    "gateway_transaction_id" TEXT,
    "gross_piasters" BIGINT NOT NULL,
    "gateway_fee_piasters" BIGINT,
    "net_piasters" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "status" "payment_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID,
    "provider_event_id" TEXT NOT NULL,
    "event_type" "payment_event_type" NOT NULL,
    "signature_verified_at" TIMESTAMPTZ(6) NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "status" "idempotency_key_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "comment_removed_at" TIMESTAMPTZ(6),
    "moderated_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "enrollment_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "scheduled_date_local" DATE NOT NULL,
    "scheduled_start_time_local" TIME(0) NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "session_status" NOT NULL,
    "simultaneous_connected_seconds" INTEGER NOT NULL DEFAULT 0,
    "provider_room_id" TEXT,
    "evaluated_at" TIMESTAMPTZ(6),
    "settled_by_admin_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participant_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" "participant_event_type" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_participant_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "cancellation_request_status" NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cancellation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "document_type" "verification_document_type" NOT NULL,
    "storage_key_encrypted" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "requested_by_admin_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "verification_request_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "settings_updated_by_admin_id_idx" ON "settings"("updated_by_admin_id");

-- CreateIndex
CREATE INDEX "slot_holds_slot_id_idx" ON "slot_holds"("slot_id");

-- CreateIndex
CREATE INDEX "slot_holds_student_user_id_idx" ON "slot_holds"("student_user_id");

-- CreateIndex
CREATE INDEX "slot_holds_enrollment_id_idx" ON "slot_holds"("enrollment_id");

-- CreateIndex
CREATE INDEX "enrollments_student_user_id_idx" ON "enrollments"("student_user_id");

-- CreateIndex
CREATE INDEX "enrollments_teacher_user_id_idx" ON "enrollments"("teacher_user_id");

-- CreateIndex
CREATE INDEX "enrollments_package_id_idx" ON "enrollments"("package_id");

-- CreateIndex
CREATE INDEX "enrollments_slot_id_idx" ON "enrollments"("slot_id");

-- CreateIndex
CREATE INDEX "enrollments_snapshot_subject_id_idx" ON "enrollments"("snapshot_subject_id");

-- CreateIndex
CREATE INDEX "teacher_subjects_subject_id_idx" ON "teacher_subjects"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_subjects_teacher_user_id_subject_id_key" ON "teacher_subjects"("teacher_user_id", "subject_id");

-- CreateIndex
CREATE INDEX "packages_teacher_user_id_idx" ON "packages"("teacher_user_id");

-- CreateIndex
CREATE INDEX "packages_subject_id_idx" ON "packages"("subject_id");

-- CreateIndex
CREATE INDEX "availability_slots_teacher_user_id_idx" ON "availability_slots"("teacher_user_id");

-- CreateIndex
CREATE INDEX "isnad_entries_subject_id_idx" ON "isnad_entries"("subject_id");

-- CreateIndex
CREATE INDEX "isnad_entries_verified_by_admin_id_idx" ON "isnad_entries"("verified_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "isnad_entries_teacher_user_id_subject_id_position_key" ON "isnad_entries"("teacher_user_id", "subject_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_signatures_teacher_user_id_key" ON "teacher_signatures"("teacher_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ijazahs_certificate_number_key" ON "ijazahs"("certificate_number");

-- CreateIndex
CREATE UNIQUE INDEX "ijazahs_verification_token_hash_key" ON "ijazahs"("verification_token_hash");

-- CreateIndex
CREATE INDEX "ijazahs_enrollment_id_idx" ON "ijazahs"("enrollment_id");

-- CreateIndex
CREATE INDEX "ijazahs_student_user_id_idx" ON "ijazahs"("student_user_id");

-- CreateIndex
CREATE INDEX "ijazahs_teacher_user_id_idx" ON "ijazahs"("teacher_user_id");

-- CreateIndex
CREATE INDEX "ijazahs_subject_id_idx" ON "ijazahs"("subject_id");

-- CreateIndex
CREATE INDEX "ijazahs_revoked_by_admin_id_idx" ON "ijazahs"("revoked_by_admin_id");

-- CreateIndex
CREATE INDEX "ijazah_bars_user_id_idx" ON "ijazah_bars"("user_id");

-- CreateIndex
CREATE INDEX "ijazah_bars_barred_by_admin_id_idx" ON "ijazah_bars"("barred_by_admin_id");

-- CreateIndex
CREATE INDEX "ijazah_bars_lifted_by_admin_id_idx" ON "ijazah_bars"("lifted_by_admin_id");

-- CreateIndex
CREATE INDEX "chat_messages_enrollment_id_idx" ON "chat_messages"("enrollment_id");

-- CreateIndex
CREATE INDEX "chat_messages_sender_user_id_idx" ON "chat_messages"("sender_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_user_id_key" ON "teacher_profiles"("user_id");

-- CreateIndex
CREATE INDEX "teacher_profiles_approved_by_admin_id_idx" ON "teacher_profiles"("approved_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_push_tokens_token_hash_key" ON "device_push_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "device_push_tokens_user_id_idx" ON "device_push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "terms_acceptances_user_id_idx" ON "terms_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "disputes_enrollment_id_idx" ON "disputes"("enrollment_id");

-- CreateIndex
CREATE INDEX "disputes_session_id_idx" ON "disputes"("session_id");

-- CreateIndex
CREATE INDEX "disputes_raised_by_user_id_idx" ON "disputes"("raised_by_user_id");

-- CreateIndex
CREATE INDEX "disputes_resolved_by_admin_id_idx" ON "disputes"("resolved_by_admin_id");

-- CreateIndex
CREATE INDEX "gender_flags_flagged_user_id_idx" ON "gender_flags"("flagged_user_id");

-- CreateIndex
CREATE INDEX "gender_flags_raised_by_user_id_idx" ON "gender_flags"("raised_by_user_id");

-- CreateIndex
CREATE INDEX "gender_flags_resolved_by_admin_id_idx" ON "gender_flags"("resolved_by_admin_id");

-- CreateIndex
CREATE INDEX "user_reports_reported_user_id_idx" ON "user_reports"("reported_user_id");

-- CreateIndex
CREATE INDEX "user_reports_reporter_user_id_idx" ON "user_reports"("reporter_user_id");

-- CreateIndex
CREATE INDEX "user_reports_session_id_idx" ON "user_reports"("session_id");

-- CreateIndex
CREATE INDEX "user_reports_resolved_by_admin_id_idx" ON "user_reports"("resolved_by_admin_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_order_id_key" ON "payments"("gateway_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_transaction_id_key" ON "payments"("gateway_transaction_id");

-- CreateIndex
CREATE INDEX "payments_enrollment_id_idx" ON "payments"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_enrollment_id_key" ON "reviews"("enrollment_id");

-- CreateIndex
CREATE INDEX "reviews_student_user_id_idx" ON "reviews"("student_user_id");

-- CreateIndex
CREATE INDEX "reviews_teacher_user_id_idx" ON "reviews"("teacher_user_id");

-- CreateIndex
CREATE INDEX "reviews_moderated_by_admin_id_idx" ON "reviews"("moderated_by_admin_id");

-- CreateIndex
CREATE INDEX "sessions_teacher_user_id_idx" ON "sessions"("teacher_user_id");

-- CreateIndex
CREATE INDEX "sessions_student_user_id_idx" ON "sessions"("student_user_id");

-- CreateIndex
CREATE INDEX "sessions_settled_by_admin_id_idx" ON "sessions"("settled_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_enrollment_id_sequence_number_key" ON "sessions"("enrollment_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "session_participant_events_provider_event_id_key" ON "session_participant_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "session_participant_events_session_id_idx" ON "session_participant_events"("session_id");

-- CreateIndex
CREATE INDEX "session_participant_events_user_id_idx" ON "session_participant_events"("user_id");

-- CreateIndex
CREATE INDEX "cancellation_requests_session_id_idx" ON "cancellation_requests"("session_id");

-- CreateIndex
CREATE INDEX "cancellation_requests_requested_by_user_id_idx" ON "cancellation_requests"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "verification_documents_user_id_idx" ON "verification_documents"("user_id");

-- CreateIndex
CREATE INDEX "verification_requests_user_id_idx" ON "verification_requests"("user_id");

-- CreateIndex
CREATE INDEX "verification_requests_requested_by_admin_id_idx" ON "verification_requests"("requested_by_admin_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "availability_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "availability_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_snapshot_subject_id_fkey" FOREIGN KEY ("snapshot_subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isnad_entries" ADD CONSTRAINT "isnad_entries_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isnad_entries" ADD CONSTRAINT "isnad_entries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isnad_entries" ADD CONSTRAINT "isnad_entries_verified_by_admin_id_fkey" FOREIGN KEY ("verified_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_signatures" ADD CONSTRAINT "teacher_signatures_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_revoked_by_admin_id_fkey" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazah_bars" ADD CONSTRAINT "ijazah_bars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazah_bars" ADD CONSTRAINT "ijazah_bars_barred_by_admin_id_fkey" FOREIGN KEY ("barred_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ijazah_bars" ADD CONSTRAINT "ijazah_bars_lifted_by_admin_id_fkey" FOREIGN KEY ("lifted_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_approved_by_admin_id_fkey" FOREIGN KEY ("approved_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gender_flags" ADD CONSTRAINT "gender_flags_flagged_user_id_fkey" FOREIGN KEY ("flagged_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gender_flags" ADD CONSTRAINT "gender_flags_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gender_flags" ADD CONSTRAINT "gender_flags_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_admin_id_fkey" FOREIGN KEY ("moderated_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_settled_by_admin_id_fkey" FOREIGN KEY ("settled_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant_events" ADD CONSTRAINT "session_participant_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant_events" ADD CONSTRAINT "session_participant_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_requested_by_admin_id_fkey" FOREIGN KEY ("requested_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: the check constraints of data-model.md section 6 (ERD section 15).

-- Rule 1: a user has a phone number or an email address.
ALTER TABLE "users" ADD CONSTRAINT "users_phone_or_email_check"
    CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);

-- Rule 2: no student enrols with themself as the teacher (FR-BOOK-11).
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_not_teacher_check"
    CHECK ("student_user_id" <> "teacher_user_id");

-- Rule 8: a message carries a body or an attachment, unless the retention job purged it, which
-- nulls both and keeps the row for counts (FR-SESS-13, note under T051).
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_or_attachment_check"
    CHECK ("body" IS NOT NULL OR "attachment_key" IS NOT NULL OR "purged_at" IS NOT NULL);

-- Rule 9: a rating is 1 to 5.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range_check"
    CHECK ("rating" BETWEEN 1 AND 5);

-- Rule 20: an order event names its payment, and a payout-recipient event names none
-- (FR-PAYG-4, FR-PAYG-15, note under T059).
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_matches_event_type_check"
    CHECK (("payment_id" IS NULL) = ("event_type" IN ('recipient_verified', 'recipient_rejected')));
