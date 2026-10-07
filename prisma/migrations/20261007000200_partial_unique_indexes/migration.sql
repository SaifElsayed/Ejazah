-- T066 — the four partial unique indexes (research R-6). The schema language cannot say WHERE.

-- A soft-deleted account releases its phone number and email address, so the person can sign up
-- again (data-model.md section 4, ERD section 15.11).
CREATE UNIQUE INDEX "users_phone_key" ON "users" ("phone") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email") WHERE "deleted_at" IS NULL;

-- At most one active hold per slot and per student. A hold is active until `released_at` is set,
-- even past `expires_at` (ERD section 15.17-18, FR-BOOK-9, FR-BOOK-12, ADR 0010 D1 and D6).
CREATE UNIQUE INDEX "slot_holds_slot_id_active_key" ON "slot_holds" ("slot_id") WHERE "released_at" IS NULL;
CREATE UNIQUE INDEX "slot_holds_student_user_id_active_key" ON "slot_holds" ("student_user_id") WHERE "released_at" IS NULL;

-- `reviews.enrollment_id` stays the plain unique constraint of the initial migration: reviews has
-- no `deleted_at`, so a partial predicate could not exist (ADR 0006 D3).
