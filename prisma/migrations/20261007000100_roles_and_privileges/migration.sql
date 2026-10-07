-- T065 — the two roles and what the application role may do (research R-5, FR-025, FR-026).
--
-- Runs as the OWNER, which holds the schema. The application role is the one the running system
-- connects as, and a revocation is real only because it is not the owner (research R-5).
--
-- No secret lives here: a migration is immutable and runs in production (R-DB-1). The application
-- role is created with LOGIN and no password. Its password is set outside the migrations: in
-- development by docker/initdb when the database volume is first created, in production by the
-- operator (docs/RUNBOOK.md). PostgreSQL has no CREATE ROLE IF NOT EXISTS, so each role is created
-- behind an existence check; the owner already exists, since it is running this migration.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijazah_owner') THEN
        CREATE ROLE ijazah_owner LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijazah_app') THEN
        CREATE ROLE ijazah_app LOGIN;
    END IF;
END
$$;

-- The application role reads and writes rows. It is granted no TRUNCATE, REFERENCES or TRIGGER,
-- and never owns an object, so it cannot grant itself back what is revoked (note under T050).
GRANT USAGE ON SCHEMA public TO ijazah_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ijazah_app;

-- The migration tool's own ledger is the owner's alone.
REVOKE ALL ON "_prisma_migrations" FROM ijazah_app;

-- A person, a lesson, a purchase, a certificate and an administrator's action cannot be destroyed
-- by the application (ERD section 15.10). The first four are soft-deleted through `deleted_at`;
-- `audit_logs` has no removal path at all.
REVOKE DELETE ON "users", "sessions", "enrollments", "ijazahs", "audit_logs" FROM ijazah_app;

-- A table a later migration creates gets the same row privileges and no more, so no migration has
-- to remember a GRANT, and none reopens what this one closed by granting ALL. A later revocation
-- (T147) is written in its own migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ijazah_app;
