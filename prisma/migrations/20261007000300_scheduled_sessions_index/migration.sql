-- T067 — the partial index on scheduled sessions, the one ERD section 14 declares, and no other
-- (FR-035). It serves the evaluate-session sweep, which reads only sessions still scheduled.
CREATE INDEX "sessions_scheduled_end_at_scheduled_idx" ON "sessions" ("scheduled_end_at") WHERE "status" = 'scheduled';
