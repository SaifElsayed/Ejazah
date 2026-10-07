-- T147 — the three append-only tables cannot be rewritten by the application role (ERD section
-- 15.21, data-model.md section 5). Each row records something that happened: an administrator's
-- action, a gateway's signed event, a provider's attendance evidence. It is written once, never
-- updated and never removed. Runs after T065, which created the role and its row privileges;
-- T065 already revoked DELETE on `audit_logs`, and TRUNCATE was never granted. Both are restated
-- here so this migration states the whole rule for all three tables.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs", "payment_events", "session_participant_events" FROM ijazah_app;
