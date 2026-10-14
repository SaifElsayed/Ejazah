-- T172 — `audit_logs.target_id` becomes text (ERD section 12, ADR 0011 D5). The column is a
-- polymorphic reference to what an administrator's action touched; settings are keyed by text
-- (`settings.key`) and every settings change is audited (FR-ADMIN-17), so a uuid column could not
-- record one. The table holds no row in any environment yet, so the change moves no data. A uuid
-- still fits: a text column accepts the same identifiers every other target carries.
ALTER TABLE "audit_logs" ALTER COLUMN "target_id" TYPE TEXT;
