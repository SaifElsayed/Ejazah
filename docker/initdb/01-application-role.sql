-- Development only. Creates the application role with the password `.env.example` gives it
-- (DATABASE_URL), before any migration runs. The official PostgreSQL image runs this directory
-- once, when the data volume is first created; an existing volume needs `docker compose down -v` once
-- (quickstart section 1). The migration of T065 then finds the role and grants it its privileges.
-- Production never uses this file: the operator sets the password (docs/RUNBOOK.md).
CREATE ROLE ijazah_app LOGIN PASSWORD 'app';
