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

## Migration workflow

A migration is **generated, extended by hand, reviewed, merged, then never
touched** (research R-6, R-DB-1). The schema is one file per module under
`prisma/schema/` (`base.prisma` holds the datasource, the generator and every
enum), and the migrations are folders under `prisma/migrations/`, applied in
name order. They run as the owner role: `prisma.config.ts` connects with
`DATABASE_URL_OWNER`, never the application role.

1. **Start from a clean database.** It must hold exactly the migrations on your
   branch, all applied (`pnpm db:migrate`), and nothing else; rebuild it if it
   diverged (above).
2. **Change the schema.** Edit the module's file in `prisma/schema/`. A new
   table must first exist in the ERD and in `packages/config/module-tables.json`
   (ERD §0).
3. **Generate the SQL** into a new folder, named with the UTC time and what the
   migration does, as the existing ones are:

   ```bash
   pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --script \
     --output prisma/migrations/<YYYYMMDDHHMMSS>_<what_it_does>/migration.sql
   ```

   This compares the database `DATABASE_URL_OWNER` names with the schema and
   writes no database. `--from-migrations` would need a shadow database, which
   `prisma.config.ts` does not configure. The initial migration was generated
   the same way, from empty; its header names the command.

4. **Extend it by hand** with what the schema language cannot express, each
   statement under a `-- Hand-written` comment naming the rule it serves, as in
   `20261007000000_init`. The existing migrations show every kind: the `citext`
   extension and the check constraints of data-model.md §6
   (`20261007000000_init`); the two roles, their grants, `REVOKE DELETE` on the
   five tables and the default privileges
   (`20261007000100_roles_and_privileges`); partial unique indexes
   (`20261007000200_partial_unique_indexes`); the partial index on scheduled
   sessions (`20261007000300_scheduled_sessions_index`); the `btree_gist`
   extension and the two exclusion constraints on `sessions`
   (`20261007000400_booking_overlap`); and `REVOKE UPDATE, DELETE, TRUNCATE` on
   the append-only tables (`20261007000500_append_only_tables`). A migration
   that is only hand-written SQL, like the last five, is a folder you create and
   write yourself. A new table receives SELECT, INSERT, UPDATE and DELETE for
   the application role from the default privileges, so its migration revokes
   DELETE when the table carries `deleted_at`, and UPDATE, DELETE and TRUNCATE
   when it is append-only. Migrations carry no password (see the production
   roles below).
5. **Apply and check it:**

   ```bash
   pnpm db:migrate
   pnpm db:schema:check     # the ERD conventions, read from the live catalogue
   pnpm db:generate         # the client follows the schema
   pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --script
   ```

   The last command must print `-- This is an empty migration.`: the schema and
   the migrations now describe the same database. Run `pnpm test:db-integrity`
   when the migration touches a constraint or a privilege.

6. **Review.** The reviewer reads every statement, generated and hand-written,
   against the ERD.
7. **Merge, then never touch it.** A mistake found later is fixed by a new
   migration (R-DB-1). The pipeline's migration checksum check is T071, still
   open; until it lands, review holds this rule.

**Why editing a generated migration is not editing a generated file.** R-PROC-9
forbids editing a generated file: the Prisma client, tRPC types, a lockfile by
hand. Those are rebuilt from a source of truth, so a hand edit is lost on the
next rebuild or leaves the copy disagreeing with its source. A migration is
generated once, as a draft. From the moment its folder exists, it is the source
of truth for the database: nothing regenerates it, and step 4 writes into that
source. Once merged, R-DB-1 makes it immutable. So the two rules never apply to
the same file at the same time: R-PROC-9 governs the generated client, which
`pnpm db:generate` rebuilds and nobody edits or commits, and R-DB-1 governs the
migration.

## Common operations

**Add a module** — create the folder under `apps/api/src/modules/`, add the six
files, write the README Owns and Never sections first, then register the module
in `app.module.ts`.

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
