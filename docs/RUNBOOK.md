# Runbook

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # postgres + redis
pnpm db:migrate
pnpm db:seed
pnpm dev               # api (request + worker processes) and admin; mobile joins when the first task importing Expo declares it (note under T076)
```

The database has two roles (research R-5). Migrations run as the owner
(`DATABASE_URL_OWNER`); everything else connects as the application role
(`DATABASE_URL`). On a new volume, `docker/initdb` creates the application role
with its development password. A volume created before that script existed
needs `docker compose down -v` once.

## Common operations

**Add a module** — create the folder under `apps/api/src/modules/`, add the six
files, write the README Owns and Never sections first, then register the module
in `app.module.ts`.

**Add a migration** — edit the right file in `prisma/schema/`, run
`pnpm db:migrate`, read the generated SQL before committing. Never edit a
migration that has been merged.

**Provision the database roles in production** — migrations carry no
password. Before the first `pnpm db:migrate`, create the application role
(`CREATE ROLE ijazah_app LOGIN PASSWORD '…'`) with a password from the secret
store, or let the T065 migration create it without one and set it afterwards
with `ALTER ROLE ijazah_app PASSWORD '…'`. The owner role runs the migrations;
if the migration is to create the application role, the owner needs
`CREATEROLE`. The owner must also own the database, so that it owns schema
`public` through `pg_database_owner` and holds CREATE on the database: the
migrations grant usage on `public` and create the trusted extensions `citext`
and `btree_gist`, and both fail otherwise. In development the owner is the
container's superuser, so neither requirement shows there. Never give the application role ownership of anything or
membership in the owner role.

**Switch a port's adapter** — set the driver value in `.env` (for example
`STORAGE_DRIVER=s3`) and restart. No code change; every adapter is chosen in
`platform/ports/ports.module.ts`, including the payment gateway adapter
(`PAYMENT_GATEWAY`). The platform never holds money; it creates gateway orders
and confirms enrollments from signed webhooks (ADR 0007).

**Branches** — cut every task branch from `develop` and name it
`Ejazah_app/<phase>/<task>`, for example `Ejazah_app/001-foundations/T001`
(a range: `Ejazah_app/001-foundations/T001-T005`). Open the pull request into
`develop`; `develop` merges into `main` by release pull request. Commit
subjects are `Ejazah_app(<phase>): <task id or range> description`, for
example `Ejazah_app(001-foundations): T001 create the pnpm workspace root`.

**Rebuild design tokens** — edit `tokens.json`, run
`pnpm --filter @ijazah/mobile tokens:build`, commit both files.

## Incidents

**Holds stuck, slots unavailable** — check the `expire-holds` queue. The job is
idempotent, so re-run it. Verify `SlotHold.expiresAt` is in the past for the
stuck rows.

**Gateway says paid but the enrollment is still pending** — the webhook was
missed or the `confirm-enrollment` job failed. Replay the webhook from the
gateway dashboard; `payment_events.provider_event_id` is unique, so a replay
cannot double-insert, and the job is idempotent. Never set `confirmed_at` by
hand — there is exactly one write path (R-HONEST-1).

**Attendance missing for a finished session** — the video provider webhook was
missed. Replay it; `provider_event_id` is unique, so a duplicate replay cannot
double-insert, and the evaluate-session job re-runs safely.

**Room does not open** — check `DAILY_API_KEY` and the session status. A
completed session never re-issues a token.

**Certificate render failed** — re-enqueue `render-certificate` for the grant.
The grant is the source of truth; the PDF is derived and disposable.
