# Runbook

## Local setup

You need Node 24.7 or later within 24 (`engines` in `package.json`; pnpm only
warns on an older Node, so check `node --version`), pnpm 9, a container runtime
and `openssl`. No third-party credential is needed. From a fresh clone:

```bash
pnpm install
pnpm db:generate          # the database client is generated from prisma/schema, never committed
cp .env.example .env
openssl rand -base64 32   # paste the output into ENCRYPTION_KEY in .env
pnpm infra:up             # postgres and redis (docker-compose.yml), on 127.0.0.1:5432 and :6379
pnpm db:migrate           # every migration in prisma/migrations, as the owner role
pnpm db:seed              # subjects, settings and one administrator, the same on every machine
pnpm dev                  # api (request + worker processes) and admin; mobile joins when the first task importing Expo declares it (note under T076)
```

`ENCRYPTION_KEY` is required in every environment, development included, and
each machine generates its own. Every other value in `.env.example` works
locally as it is. Rerun `pnpm db:generate` after any change under
`prisma/schema/`.

The database has two roles (research R-5). Migrations run as the owner
(`DATABASE_URL_OWNER`); everything else connects as the application role
(`DATABASE_URL`). On a new volume, `docker/initdb` creates the application role
with its development password. A volume created before that script existed
needs `docker compose down -v` once.

**Check that your data matches everyone else's.** The seed plants fixed rows
with fixed identifiers and fixed timestamps, so every machine holds the same
data:

```bash
pnpm db:seed:checksum
```

It prints one SHA-256 over every row of every table except the migration
history. It leaves out only the administrator's password hash and MFA secret,
which are random on each machine. Compare the value with a teammate: it must be
identical, whatever the date, the machine's time zone or its `ENCRYPTION_KEY`.
Running `pnpm db:seed` again changes nothing, so the checksum stays the same.

## Reset the local database

**A diverged database is rebuilt from the migrations, never patched (R-DB-2).**
A database has diverged when it holds anything the migrations in
`prisma/migrations/` did not create: a column, index or grant added by hand, a
`prisma db push`, a migration from another branch, or rows you added while
testing. Do not repair it with a hand-written `ALTER`, and never edit a merged
migration to match it (R-DB-1). Rebuild it:

```bash
docker compose down -v    # removes the containers and the postgres-data volume: every row is gone
pnpm infra:up             # a new volume, so docker/initdb creates the application role again
pnpm db:migrate
pnpm db:seed
pnpm db:seed:checksum     # must match a teammate's again
```

`pnpm db:reset` (`prisma migrate reset --force`, run as the owner) rebuilds in
place without recreating the volume: it empties the database and applies every
migration again. It does not run the seed, so run `pnpm db:seed` after it.

How to tell that a database has diverged: `pnpm db:seed:checksum` differs from
a teammate's on a database that holds only the seed. `prisma migrate status` is
not the test: it reads only the migration history, so it still reports
"Database schema is up to date!" after a column is added by hand.

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

## Capacity

**Password and one-time-code checks are expensive on purpose.** One Argon2id
verification (`platform/crypto/hashing.ts`, T069) costs about 51 ms, so one
process verifies about 33 a second under load. It scales by adding processes,
not threads. The rate limits `rate_limit_authentication` and
`rate_limit_one_time_code` (T103) must therefore stand in front of every
identity procedure that verifies: sign-in, the one-time-code check and password
reset. A verifying procedure without its limit lets one client take a whole
process.

## Incidents

**Redis is down** — Redis holds only the queue and the rate-limit counts, so
nothing that matters is lost (ARCHITECTURE §2). Neither process exits; each
retries for as long as Redis is away, with a delay that grows by 50 ms per
attempt up to 2 s. What you see:

- The API's `/ready` still answers ready, because it checks only the database.
  A call behind a rate limit (none yet; each identity, catalog and payments task
  applies its own) is refused as the internal error (500 `INTERNAL`, logged and
  reported) within about two seconds, because the limiter's client gives up a
  count after one reconnection attempt (`maxRetriesPerRequest: 1` in
  `platform/guards/rate-limit.guard.ts`). It fails closed: nothing passes
  unlimited. Calls without a limit are unaffected. From the first limited call
  on, the API logs the warning `Rate-limit counter unreachable` on every
  reconnection attempt.
- The worker runs no job. Started while Redis is down, it does not log
  `Worker started` until Redis answers, and meanwhile prints an unstructured
  `AggregateError [ECONNREFUSED]` stack about once a second. Already running, it
  logs `The queue worker failed` at error level, and reports it, about twice a
  second, beside the same unstructured stacks. The error's `code` field reads
  `[redacted]`, because the logger redacts every key named `code`; the message
  names the address (`connect ECONNREFUSED 127.0.0.1:6379`).

What to do: bring Redis back (locally `pnpm infra:up`). Both processes
reconnect on their own and the errors stop; no line announces it. Do not
restart them for that. One exception: if Redis came back empty (a new
container, or its data lost), restart the worker, because it registers its
scheduled sweeps only when it starts. Rate-limit counts start again from zero.

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
