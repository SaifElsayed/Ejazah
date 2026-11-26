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
pnpm dev                  # api (request + worker processes) and admin; the phone app runs on its own (below, note under T076)
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

**Run the phone app on a physical device.** The app carries native modules
(Google and Apple sign-in, secure storage), so it runs as a development build
installed on the device, never in Expo Go. Its settings go in
`apps/mobile/.env` (ignored, like the root one), which Expo reads when it
bundles:

```bash
EXPO_PUBLIC_API_URL=http://<this machine's LAN address>:3000   # the API's origin; without it the app stops at launch
EXPO_PUBLIC_DEV_SIGN_IN=true                                   # the fake provider, below
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=                              # the Web OAuth client's ID: Google sign-in, below
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=                              # the iOS OAuth client's ID; unused until iOS ships
```

With `pnpm dev` running and the device on the same network:

```bash
pnpm --filter @ijazah/mobile exec expo run:android --device   # Android over USB: builds, installs, starts Metro
pnpm --filter @ijazah/mobile exec expo run:ios --device       # iOS: on macOS with Xcode only
pnpm --filter @ijazah/mobile dev                              # later, when only JavaScript changed: Metro alone
```

`app.json` names the Android package and the iOS bundle identifier
(`com.ijazah.app`) and the EAS project (B18, T090). Without a cable or Android
Studio, EAS Build's free plan makes the same development build from `eas.json`'s
`development` profile, an internal APK with the development client:
`npx eas-cli build -p android --profile development`.

**A new native module means a new development build.** Metro reloads
JavaScript only; a package with native code reaches the phone only in a build
made after it was installed, so an older build fails when the code first
calls it. `expo-web-browser` (the hosted checkout, Phase 2 T001) is one: after
it, the development build is rebuilt on EAS with the `development` profile
(the command above) and the new APK installed on the device. It needs no
`plugins` entry in `app.json`: its config plugin does nothing unless asked
for an option this app does not use.

**The build with the video packages (Phase 3, T017).** LiveKit's packages are native, so the
phone needs EAS build `725d593f-1f7d-4bd0-ad0e-fbc80737f685` (`development` profile, the build
T019's device check passed on, with the service that keeps the room alive while sharing) or a later
one. A build before the video packages fails when the room first calls the SDK; one before the
service loses the room while the screen is shared. Install it over the old one
with `adb install -r`, which keeps the app's data. A signature mismatch is reported, never answered
with an uninstall, which would erase that data.

**The fake provider.** One switch on each side. The API's
`SIGN_IN_PROVIDER=fake` (the `.env.example` value) selects the stand-in that
accepts an unsigned token (`platform/ports/sign-in/fake.adapter.ts`);
`env.schema.ts` refuses it outside development and test. The phone's
`EXPO_PUBLIC_DEV_SIGN_IN=true` adds «دخول تجريبي للتطوير» to the welcome screen
(`features/shared/auth/dev-sign-in.ts`), which signs in as one fixed person,
`dev-phone@ijazah.test`; a release build never shows it (`__DEV__` is false).

**Google sign-in for real (002:T148).** On Android the phone asks Credential
Manager for Google's ID token through the local module `modules/google-id`,
with the server's nonce in it, and the API's `SIGN_IN_PROVIDER=live` verifies
the token against Google's published keys. Apple waits for iOS. The owner's
steps, once:

1. In Google Cloud, set up the project's OAuth consent screen.
2. Create a **Web** OAuth client. Its ID is the API's `GOOGLE_CLIENT_IDS` (root
   `.env`) and the phone's `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
   (`apps/mobile/.env`).
3. Create an **Android** OAuth client for `com.ijazah.app` with the SHA-1 of
   every key that signs the app: the local debug keystore
   (`keytool -list -v -keystore ~/.android/debug.keystore`) and the EAS key (`npx eas-cli credentials`, Android,
   `development`). The phone sends this client's ID nowhere; Google matches it
   by the package and the SHA-1.
4. Put the values in the two `.env` files yourself; they are never printed or
   committed.
5. Make a new development build (the module is native; see «A new native
   module means a new development build» above) and install it.
6. Start the API with `SIGN_IN_PROVIDER=live` to try it.

The store key's SHA-1 is added to the Android client later, with the
production profile (`eas.json` has only `development` today).

**Where the mails land.** With `NODE_ENV=development` and
`EMAIL_PROVIDER=fake`, the email stand-in sends nothing and writes each mail,
one-time codes and invite links included, as a text file under
`<STORAGE_LOCAL_ROOT>/mail/` (`platform/ports/email/index.ts`). The path is
relative to the API's working directory: under `pnpm dev`, with the default
`.storage`, that is `apps/api/.storage/mail/`. A test run writes no mail.
The live sender is `EMAIL_PROVIDER=resend` (Resend, 002:T177), which a hosted
server runs as «Hosted deploy», «E-mail», says.

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
Before running it, check that `DATABASE_URL_OWNER` in `.env` points at your
local database: `--force` asks nothing, and every row there is deleted.

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
   migration (R-DB-1). Stage 3 of the pipeline holds this rule
   (`pnpm check:migrations`, T071): it compares the migrations with the base
   branch. It refuses a merged migration that was edited, deleted or renamed,
   and a new one whose name sorts before the base's last, naming R-DB-1.

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

## Add a module

A backend module arrives with two things before any code: its **ownership
statement** (the README's Owns and Never) and its **manifest entry**
(`packages/config/module-tables.json`). The lint rules read the manifest and
reviewers read the README, so a module without them is a module nothing checks.

The twelve modules are the ERD's twelve domains (ERD §1, ARCHITECTURE §4). A new
module, or a table moving between modules, changes those documents first,
through an ADR as ADR 0005 D2 and ADR 0007 D4 did, and only then the code
(R-PROC-2). A capability that would own no table is a service inside the
module whose tables it reads, as discovery is inside `catalog`.

1. **Manifest entry.** Add the module to `packages/config/module-tables.json`,
   keyed by its folder name, listing exactly the tables the ERD gives it. Each
   table belongs to exactly one key: `api/table-ownership` (R-API-6) refuses to
   load when a table has two owners, reports a database delegate whose table is
   in no entry, and refuses a repository that reaches a table its module does
   not own. `tests/seed/migrate-from-empty.spec.ts` also compares the migrated
   database's tables with the manifest, so a table missing from it fails there
   too.
2. **Folder and ownership statement.** Create `apps/api/src/modules/<name>/`
   with a `README.md` written before any code, in the shape the existing ones
   share (for example `apps/api/src/modules/booking/README.md`):
   - **Owns**: the manifest's tables for this module, and the line saying they
     are listed in `packages/config/module-tables.json`.
   - **Never**: what the module must not do, each prohibition with its rule id:
     whose tables it never writes, which module's internals it never reaches,
     which money, gender or time rule binds it.
   - **Shape**: which file holds the rules, which the queries, which the
     procedures, and what `index.ts` exports.
   - **Requirement ids**: the SRS and spec ids it implements, filled as they
     land.
3. **Public entry.** Add `index.ts`. It starts as `export {};` and is the only
   path into the module: `boundaries/no-deep-module-import` (R-API-3) refuses
   any import of a file below it from outside the module. What another module
   needs is exported here, with its own test.
4. **Code, as it is needed.** Rules go in a `*.service.ts`, queries in a
   `*.repository.ts` (the only kind of file that may import the database client,
   `api/no-orm-outside-repository`, R-API-2), procedures in a thin `*.router.ts`
   (`api/no-logic-in-router`, R-API-1), each spec beside its file. Files are
   named after the module, or after the aggregate when a module has several, as
   `modules/admin` does with `settings.service.ts` and `audit.repository.ts`. A
   file arrives with the task that first needs it, not as an empty shell.
5. **Wiring.** There is no registration in `app.module.ts`. A module's router
   joins the record in `apps/api/src/surfaces/app.router.ts` (the user surface)
   or `apps/api/src/surfaces/admin.router.ts` (the administrator surface, admin
   only, R-API-11), and its services are built where they are used, in
   `apps/api/src/main.ts` or `apps/api/src/worker.ts`. Outside the admin module,
   nothing imports `modules/admin` except those two entry points and
   `surfaces/admin.router.ts` (`boundaries/no-upward-admin-import`, R-API-4).
6. **Schema and coverage.** Its tables live in `prisma/schema/<name>.prisma` and
   reach the database through the migration workflow above. It joins the
   per-path coverage floor when it is created (ARCHITECTURE §13); the floors are
   configured by T086, still open.

## Common operations

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
and confirms enrollments from signed webhooks (ADR 0007). Storage is `local`
by default, which writes the documents to disk as plaintext: outside
development and test it is refused at startup, naming `STORAGE_DRIVER` (002:T147),
so a hosted server sets `STORAGE_DRIVER=s3` with the five `S3_*` values.

**Switch the payment mode to live** (003:T109; SRS DEC-87, ADR 0025 D7) —
`PAYMENT_MODE` is required, `test` or `live`. In `test`, the closed test's
mode, only gateway keys without the live marks start, and the phone and the
console show «نسخة تجريبية». At the closed test's end, before launch, set
`PAYMENT_MODE=live` with the gateway's live keys (`sk_live…`, `pk_live…`) and
`PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID` from contracting, check that every
teacher's payout account is verified (in `live` a checkout with no payee is
refused), and restart; no code change. A mismatch refuses to start, naming the
key, never its value. The closed test's data is not carried to launch: the
database starts clean.

**Open a webhook tunnel for a device run** — a cloudflared quick tunnel to a
proxy, never to the API: the API runs with `SIGN_IN_PROVIDER=fake` in
development, so anyone holding the tunnel's address could sign in as anyone.
The proxy passes only `POST /webhooks/payment` and, from Phase 3,
`POST /webhooks/video`, with the raw body and query unchanged, refuses a body
over 64 KB and answers 404 to everything else. Before giving a dashboard the
address, check from outside that `GET /health` answers 404 and that an
unsigned POST to each path is refused by the API itself. Afterwards close the
tunnel, the proxy, the API and the worker, set the gateway's callback back to
its default and delete the video provider's webhook
(`specs/003-booking/quickstart.md`, `specs/004-sessions/quickstart.md`
prerequisites; amended 2026-11-05).

**Branches** — cut every task branch from `develop` and name it
`Ejazah_app/<phase>/<task>`, for example `Ejazah_app/001-foundations/T001`
(a range: `Ejazah_app/001-foundations/T001-T005`). Open the pull request into
`develop`; `develop` merges into `main` by release pull request. Commit
subjects are `Ejazah_app(<phase>): <task id or range> description`, for
example `Ejazah_app(001-foundations): T001 create the pnpm workspace root`.

**Rebuild design tokens** — edit `tokens.json`, run
`pnpm --filter @ijazah/mobile tokens:build`, commit both files.

**Give the seeded administrator a password** — the seed writes it with no
usable password. On a development machine:

```bash
pnpm exec tsx scripts/dev/admin-invite.ts
```

It refuses unless `NODE_ENV` is `development`, `EMAIL_PROVIDER` is `fake` and
`ADMIN_PANEL_ORIGIN` is set, so it never sends a real mail. It only queues the
invite: the worker (`pnpm dev` starts it) writes the mail where the mails land
(Local setup). The link opens the panel's `/set-password`, then the second
factor's setup; save the recovery codes it shows once. Run it again for a fresh
link after `admin_invite_ttl_hours`; once a password is set it queues nothing.
When nobody knows an existing administrator's password, invite a new one the
same way (T097): `pnpm exec tsx scripts/dev/admin-invite.ts --email <x> --name <y>`
writes the row `admins.add` writes, with SQL, invited by nobody and with no audit
entry, refuses an address another administrator holds, and queues the invite.
A hosted server uses neither: its owner runs `scripts/ops/first-admin.ts`
(«The first administrator» and «When no administrator can sign in», under
«Hosted deploy»).
The panel calls the API at `VITE_API_URL` (in `apps/admin/.env`), and the API
answers it only when `ADMIN_ALLOWED_ORIGINS` lists `http://localhost:5173`.

**Reset an administrator's second factor** — another administrator does it,
never the one locked out (refused as `FORBIDDEN`): Settings → Admins, the
administrator, "Reset two-step verification", with a reason. It clears the
enrolment, rotates the secret, deletes the recovery codes and ends every open
session (`admins.resetMfa`, FR-173); the action is audited as
`admin.reset_mfa`, and the next sign-in repeats the setup. With a single
administrator nobody can do it, so add a second ("Add admin" on the same page,
its invite mail in the same folder) before you need one.

## Capacity

**Password and one-time-code checks are expensive on purpose.** One Argon2id
verification (`platform/crypto/hashing.ts`, T069) costs about 51 ms, so one
process verifies about 33 a second under load. It scales by adding processes,
not threads. The rate limits `rate_limit_authentication` and
`rate_limit_one_time_code` (T103) must therefore stand in front of every
identity procedure that verifies: sign-in, the one-time-code check and password
reset. A verifying procedure without its limit lets one client take a whole
process.

**Reverse proxy and the live channel** (added 2026-11-05, the owner's decision;
`specs/004-sessions/research.md` R-324; PLAN.md, Phase 6, carries the same
notes for choosing the host). `GET /trpc/live.events` is a Server-Sent Events
stream that stays open while the app is in the foreground. The API sends a
ping comment every 25 s; the phone restarts a stream it hears nothing on for
60 s. A proxy in front of the API must therefore not buffer it, not compress
it, and not time it out between two reads in less than the ping.

- nginx (`proxy_http_version` defaults to 1.0 before nginx 1.29.7, so set it):

  ```nginx
  location /trpc/ {
      proxy_pass http://api:3000;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_buffering off;          # tRPC also sends X-Accel-Buffering: no
      proxy_cache off;
      proxy_read_timeout 120s;      # between two reads; must exceed the 25 s ping (default 60 s)
      proxy_send_timeout 120s;
      gzip off;                     # never compress text/event-stream
  }
  events { worker_connections 8192; }   # Debian and Ubuntu ship 768; each stream holds two
  worker_rlimit_nofile 16384;
  ```

- Caddy: `reverse_proxy api:3000` flushes `text/event-stream` at once and has
  no read timeout by default; do not apply `encode` to `text/event-stream`.
- Cloudflare in front, if ever: its 100 s idle limit is met by the 25 s ping.
- Serve the phone over HTTP/2 at the proxy, so the stream and the calls share
  one connection.
- Docker: `ulimits: nofile: 65536` on the proxy and the API services. Node
  needs no timeout change.
- A deploy's SIGTERM ends every live stream before the server closes (the
  owner's hard condition, `onShutdown` in `apps/api/src/main.ts`), so the
  deploy never waits on one; phones come back within 1 to 15 s.
- One API process only, until Redis pub/sub between processes lands (Not
  scheduled in `specs/004-sessions/tasks.md`): a second API process would miss
  the other's events. Scaling the API by adding processes waits for it.
- Memory: 10 to 30 KB per stream at the proxy is still an assumption. **Measured in
  Node** (T063 of `specs/004-sessions/tasks.md`, 2026-11-08, Node 24 on Windows,
  the process's working set, 500 streams of one account, no event sent): 200,528 KiB
  before, 273,252 KiB with the streams open, 214,904 KiB after they closed: about
  145 KiB per stream, above the 100 KB assumed until then.

## Hosted deploy

What 002:T147 asks of every hosted server (staging and production, from the
deploy days of 12/1 to 12/5). The configuration refuses a server that misses
the first two at startup, naming the key.

**Storage** — `STORAGE_DRIVER=s3` with the five `S3_*` values. `local` writes
the files to disk as plaintext and is refused outside development and test.
A `Retry-After` from S3 can stretch the client's one retry past the hourly
purge's 5 s transaction, which then rolls back (the owner's Q-A3 (a)): the
next run deletes the row, and an S3 DELETE of an object already gone is
harmless.

**The proxy and the client's address** — one proxy (Caddy, below) stands in
front of the API, and the API's port is reachable through the proxy only (the
note under T018): bind the API to the private network or to `127.0.0.1`, and
let no firewall rule open its port to the internet. Then set both keys:

- `TRUSTED_PROXY=X-Forwarded-For`, the header Caddy's `reverse_proxy` sends
  with the client's address as its last hop;
- `TRUSTED_PROXY_ADDRESS`, the proxy's own IP address as the API's socket
  sees it: `127.0.0.1` when Caddy runs on the same machine, the proxy
  container's address on a Docker network (give it a fixed one in the compose
  file). The API refuses `TRUSTED_PROXY` without it.

The header is then read only from that address, and its last hop only when it
is an IP address; any other peer, or a last hop that is not an address, counts
as the socket's own address, and the request logs once at warn, «The trusted
proxy's header was set aside for the socket's peer», with `reason`
`peer_not_proxy` or `hop_not_an_address`. Many such lines after a deploy mean
`TRUSTED_PROXY_ADDRESS` is not the proxy's address as the API sees it (check
the address the proxy connects from), or the port is open to others.

**E-mail** — the live sender is Resend (002:T177, SRS DEC-108), from the
sending domain `send.ijazahapp.com`, verified in Resend on 2026-11-26. Set
`EMAIL_PROVIDER=resend`, `EMAIL_FROM=no-reply@send.ijazahapp.com`,
`EMAIL_FROM_NAME=إجازة` and `SUPPORT_EMAIL=support@ijazahapp.com`, where
replies go; and `EMAIL_PROVIDER_KEY`, which the owner makes in Resend's
dashboard and sets on the server, never written anywhere by value. The API
refuses `resend` without the key, and a hosted server refuses the stand-in.
Resend's free tier sends 100 mails a day (3,000 a month); past it, a one-time
code is not delivered, the API logs one warn line, and no mail goes until the
quota resets at midnight UTC, so a launch needs the paid tier.

**The panel's host** — `deploy/Caddyfile` is the panel's site block (research
R-18): Caddy serves the panel's build as static files with the browser
security headers and a closed Content Security Policy (SRS NFR-SEC-11). The
file names its four values as environment placeholders, so the final domain
needs no change to it. The steps of 12/1, on the host:

1. Build the panel with the API's origin: `VITE_API_URL=https://<api host>
   pnpm --filter @ijazah/admin build` (the build lands in `apps/admin/build`;
   without the value the panel refuses to start).
2. Set the four values in the Caddy service's environment: `ADMIN_SITE` (the
   panel's host, e.g. `admin.<domain>`), `ADMIN_BUILD_ROOT` (the build's path
   on the host), `API_ORIGIN` and `STORAGE_ORIGIN` (each `https://` and a
   host, no path).
3. `caddy validate --config deploy/Caddyfile` with those values set: it must
   answer «Valid configuration». Then reload Caddy.
4. `curl -sI https://<admin host>/` and check each header the file sends:
   `content-security-policy` exactly as in the file with the two origins
   filled in, `x-content-type-options: nosniff`, `referrer-policy:
   no-referrer`, `strict-transport-security: max-age=31536000`,
   `x-frame-options: DENY`, and no `server` header. `curl -sI
   https://<admin host>/applications` answers the same page (the router's
   paths).
5. Open the panel in a browser, sign in, open a document and a dialog, and
   read the browser console for Content Security Policy violations: none may
   appear except Radix's dialog scroll-lock style, which the policy refuses on
   purpose (`style-src 'self'`, the owner's Q-A4 (a); the comment in
   `deploy/Caddyfile`), and, when a document opens, pdf.js's WebAssembly
   refusals: the policy has no `'wasm-unsafe-eval'` (`deploy/Caddyfile:38`),
   and pdf.js catches each one and draws the page with its JavaScript
   decoders (R2 T181). Any other one names a source the file must allow or
   code that must change.

The API's own site block (its `reverse_proxy` and the live channel's notes
under «Capacity») joins this file when the API's host is set up; it is not
part of T147.

**The documents bucket's CORS rule** (R2 T181) — the panel's document viewer
fetches a document's signed link from the browser (`apps/admin/src/lib/pdf.ts`,
`withCredentials: false`), so the documents bucket (`S3_BUCKET`) allows `GET`
from the panel's origin only, `ADMIN_PANEL_ORIGIN` exactly (scheme and host, no
path):

```json
[
  {
    "AllowedOrigins": ["https://<admin host>"],
    "AllowedMethods": ["GET"]
  }
]
```

On Cloudflare R2 it is set in the dashboard (the bucket, Settings, CORS
Policy), or with `npx wrangler r2 bucket cors set <bucket> --file cors.json`,
whose file wraps the same rule in Wrangler's own shape:
`{"rules":[{"allowed":{"origins":["https://<admin host>"],"methods":["GET"]}}]}`.
No other origin and no other method: the phone never reads the bucket from a
browser, and nothing writes to it but the API. The backup bucket (below) has
no CORS rule at all.

**The API's bind address** (R2 T181, Q-7 (a)) — `API_BIND_ADDRESS` is the one
address the API listens on; unset, it listens on every interface, as the phone
on a development network needs. By the server's shape:

- **The API on the host directly:** `API_BIND_ADDRESS=127.0.0.1`, and Caddy on
  the same host proxies to it.
- **The API in a container:** leave `API_BIND_ADDRESS` unset (inside a
  container `127.0.0.1` is the container's own loopback, which neither a
  published port nor Caddy can reach). Then either publish no port at all and
  run Caddy on the same Docker network, `TRUSTED_PROXY_ADDRESS` set to the
  Caddy container's fixed address on it; or publish the port as
  `127.0.0.1:<PORT>:<PORT>` only. Never `<PORT>:<PORT>`: Docker's own
  publishing writes its firewall rules ahead of ufw's, so a port Docker
  publishes on every interface is open to the internet whatever ufw says.

**The proxy check after a deploy** (R2 T181) — the API's site block proxies to
the API's own address (`reverse_proxy 127.0.0.1:<PORT>` on the host, the API
container's name and port on a Docker network). After the deploy, make one
call to a tRPC procedure through the proxy (sign in to the panel, or open the
phone app; `/health` does not read the header), then read the API's log since
the restart: no line «The trusted
proxy's header was set aside for the socket's peer» with `reason`
`peer_not_proxy` may appear. One means `TRUSTED_PROXY_ADDRESS` is not the
address the API's socket sees (see «The proxy and the client's address»): fix
it before opening the server to anyone, since every rate limit keyed on the
client's address would otherwise count the proxy.

**Cloudflare** (R2 T181, Q-9 (a)) — when the domain's DNS is on Cloudflare:

- SSL/TLS mode **Full (strict)**, never **Flexible**: Flexible sends Cloudflare's
  request to the server over plain HTTP, which Caddy answers with a redirect to
  HTTPS, so every page loops, and the hop to the server is unencrypted.
- Resend's records (the sending domain's SPF, DKIM and return-path records)
  are **DNS only** (the grey cloud), as Resend's dashboard gives them.
- The gateway's webhook reaches the API through Cloudflare's proxy like any
  request; its HMAC signature guards it, checked on the raw body. Nothing of
  Cloudflare's may answer it in the API's place: no challenge page or bot rule
  on the webhook's path.
- The live channel's ping stays under 60 s (it is 25 s,
  `LIVE_PING_INTERVAL_MS`), inside Cloudflare's 100 s idle timeout, so a quiet
  stream is not cut (see «Reverse proxy and the live channel» under
  «Capacity»).

**The first administrator** — after «migrate, then seed», with the worker
running and the live e-mail sender set, the server's owner runs, on the
server:

```bash
pnpm exec tsx scripts/ops/first-admin.ts --email <x> --name <y>
```

It is refused while any active administrator who can sign in exists (a
password set; a temporary lock still counts; the seeded `admin@ijazah.invalid`
never does), without the seeded administrator (run `pnpm db:seed` first), and
without `ADMIN_PANEL_ORIGIN`, which the invitation's link is built from. It
writes the administrator as "Add admin" does, invited by nobody, records one
audit entry, `admin.bootstrap`, under the seeded administrator, which stands
for the platform, and queues the invitation; it prints the administrator's id,
never the address. The worker sends the mail. Its link opens the panel's
`/set-password` for `admin_invite_ttl_hours` (48 h): set the password, then the
second factor (scan the code into an authenticator app), and keep the recovery
codes it shows once in the password manager. Then add a second administrator
from the panel (Settings → Admins, "Add admin"), so that each can reset the
other's second factor («Reset an administrator's second factor»). If it
answers `invitation_not_queued`, the administrator is written and audited
but the queue did not answer: once Redis does, run `--recover` (below) for
that address.

**When no administrator can sign in** — when the last administrator who could
sign in has lost the password, the second factor, or both, the server's
owner runs, on the server, with the worker running:

```bash
pnpm exec tsx scripts/ops/first-admin.ts --recover --email <x> --reason <r>
```

In one transaction it clears that administrator's password and its date, the
second factor's enrolment (with a new secret), the recovery codes, the lock
and its count, and ends every open session; then it queues a new invitation,
and the next sign-in repeats the whole setup from its link. There is no way
back: the old password, second factor and codes are gone. It refuses an
unknown or a disabled administrator. The audit log records one entry,
`admin.recover`, under the seeded administrator, with the reason as typed
(the panel shows «استعادة مشرف من الخادم»): name the cause, never a password
or a code. A lost second factor alone, while another administrator can sign
in, is reset from the panel instead; a lost password has no panel path
(`specs/003-booking/tasks.md` T098, item 1).

## Backups and restore

R2 T179 (SRS DEC-100, DEC-108; ADR 0015). The database is dumped nightly,
encrypted, sent to a bucket of its own and kept 14 days; the documents keep a
second copy that ages out after an erasure. Everything below the script is the
server owner's outside step, taken once the buckets exist.

**What runs nightly** — two commands of `scripts/ops/backup.ts`, as root on the
server, from the repository's checkout, with `deploy/backup.env` loaded (copy
`deploy/backup.env.example` to `/etc/ijazah/backup.env`, owner root, mode 0600,
and fill it there):

- `dump`: `pg_dump --format=custom` as the owner role, piped into
  `gpg --symmetric --cipher-algo AES256` with the passphrase file, into a
  temporary file only root reads (removed in every case), uploaded to the
  backup bucket as `db/<UTC instant>.dump.gpg`; then every `db/` dump older
  than 14 days is deleted, the newest never.
- `copy-documents`: every object of the documents bucket that has no copy under
  `docs/` in the backup bucket is copied there; a copy whose document is gone
  (erased) moves to `docs-gone/` that night, and a `docs-gone/` copy older than
  14 days is deleted.

Each prints one line to the journal, counts and the backup bucket's object
keys, or `failed (<reason>)` / `refused (<reason>)` and exit code 1; never a
URL, a key or the passphrase, and not the programs' own messages (run the
failing program by hand to see one). A systemd timer runs them, `dump` first:

```ini
# /etc/systemd/system/ijazah-backup.service
[Unit]
Description=Ijazah nightly backup

[Service]
Type=oneshot
WorkingDirectory=<checkout>
EnvironmentFile=/etc/ijazah/backup.env
ExecStart=<pnpm> exec tsx scripts/ops/backup.ts dump
ExecStart=<pnpm> exec tsx scripts/ops/backup.ts copy-documents

# /etc/systemd/system/ijazah-backup.timer
[Unit]
Description=Ijazah nightly backup

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

Then `systemctl daemon-reload && systemctl enable --now ijazah-backup.timer`;
`systemctl list-timers ijazah-backup.timer` shows the next run and `journalctl
-u ijazah-backup` each night's lines. A failed `dump` fails the unit, so that
night's `copy-documents` waits for the next. The host needs Node 24 and pnpm (the
script runs with `tsx`), `gpg` (Ubuntu's own), and `pg_dump`/`pg_restore` of at
least the database's major version (PostgreSQL's own apt repository); or the
database container's own through `BACKUP_PG_DUMP=docker exec -i -e PGPASSWORD
<postgres container> pg_dump` (and the same for `BACKUP_PG_RESTORE`), as the
drill below did.

**The two buckets and their two tokens:**

- **The documents bucket** (`S3_BUCKET`, the API's own): the API's token reads
  and writes it. The backup reads it with a second token, **Object Read** only,
  scoped to that bucket (`DOCUMENTS_S3_*`), so the backup can never change a
  document.
- **The backup bucket** (e.g. `ijazah-backups`), holding `db/`, `docs/` and
  `docs-gone/`: its own token, **Object Read & Write** on that bucket only
  (`BACKUP_S3_*`), which only `/etc/ijazah/backup.env` holds; the API never
  has it, so a leaked API key cannot delete a backup. Never public, no CORS
  rule, no lifecycle rule (the script deletes by age; Cloudflare R2 has no
  versioning, hence the copy).
- **The region waits for counsel** (research R-19). On Cloudflare R2 a
  jurisdiction bucket (e.g. `eu`) has its own endpoint,
  `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`, unreachable from the
  default one, and a bucket's jurisdiction cannot change after it is created.
  So both buckets are created only after counsel's answer, in the same place as
  the database, and `BACKUP_S3_ENDPOINT` / `DOCUMENTS_S3_ENDPOINT` name that
  endpoint (region `auto`). The script names nothing else: any S3-compatible
  service works.

**What is kept, and for how long** — 14 days (DEC-100): the dumps of the last
14 nights; the newest is never deleted, so a dump failing for days, or a clock
gone wrong, never takes the last good one. A document has its copy under
`docs/` while it exists; erased, its copy moves to `docs-gone/` that night and
is deleted 14 days later, so an erased file leaves every copy within about 15
days, and an erased person's rows leave the dumps within 14 (ADR 0015: within
30 days).

**The two secrets, and their second copies** — without both, nothing restores:

- **The passphrase**: `openssl rand -base64 32 > /etc/ijazah/backup.passphrase`,
  owner root, mode 0400 (`BACKUP_PASSPHRASE_FILE`). Without it no dump
  decrypts.
- **`ENCRYPTION_KEY`**: a restored database's six `*_encrypted` columns (the
  second factors, the payout references, the push tokens, …; «Leaked
  credential») read only under the key they were written with.

The second copy of each is kept in the owner's password manager, under the
deployment's entry beside `VIDEO_MEDIA_KEY_SECRET`'s, never written here or
anywhere else by value. After a rotation of either, the old value stays in that
entry until the last dump made under it is past 14 days.

**Restore** — into a new, named database, never over the running one:

1. On the server, load the environment: `set -a; . /etc/ijazah/backup.env;
   set +a`. The dump to restore is named in the journal's `object=db/…` lines
   (or the bucket's listing in the provider's dashboard).
2. Create an empty database owned by the owner role, e.g. `CREATE DATABASE
   ijazah_restored OWNER ijazah_owner;` as a role allowed to create databases
   (the roles exist as «Provision the database roles in production» made
   them).
3. Run, with that database's URL (its password in the URL or in root's
   `~/.pgpass`):

   ```bash
   pnpm exec tsx scripts/ops/backup.ts restore \
     --target-url postgresql://ijazah_owner@<host>:5432/ijazah_restored \
     --object db/<instant>.dump.gpg
   ```

   It refuses without `--target-url`, a target whose database is the one
   `DATABASE_URL_OWNER` or `DATABASE_URL` names (on any host), and an object
   outside `db/`. It downloads the dump into a temporary file only root reads,
   decrypts it and restores it in one transaction (`pg_restore
   --single-transaction --exit-on-error`), so a failure leaves the target
   empty.
4. Check it: the tables' row counts look like the day's, and the panel's
   sign-in works against it (a second factor decrypts only under the right
   `ENCRYPTION_KEY`).
5. Switch to it in a stopped window: stop the API and the worker, rename
   (`ALTER DATABASE ijazah RENAME TO ijazah_before_restore; ALTER DATABASE
   ijazah_restored RENAME TO ijazah;`) or point `DATABASE_URL` and
   `DATABASE_URL_OWNER` at it, keep the same `ENCRYPTION_KEY`, then «migrate,
   then seed» and start both.
6. A lost document is put back from its copy under `docs/<key>` (or
   `docs-gone/<key>`) with the provider's own tools; the script has no command
   for it.

**The drill** — the restore was run once on the development machine on
2026-11-26 (Q-6 (a)): `ijazah_integrity` (synthetic data) dumped by `dump`
through `gpg` with a throwaway passphrase (44,991,282 bytes, no Postgres
signature left in it), downloaded and restored by `restore` into
`ijazah_restore_drill`, created for the run and dropped by name after it; 54
tables and 809,798 rows compared, every count equal; one encrypted column
(`admin_users.mfa_secret_encrypted` of the seeded administrator) read from the
restored copy with the integrity database's `ENCRYPTION_KEY`. The programs ran
inside the database container; the upload, the prune and the documents' copy
are proved against an in-memory S3 (`tests/ops/backup.spec.ts`). Still the
owner's: the first night against the real buckets once they exist (after
counsel), and PLAN.md's drill on the server in Phase 6 (restore a night's dump
into a new database, check it as in step 4, and write the date here).

## Leaked credential

**Rotate first, investigate second (R-SEC-10, FR-067).** A credential is
leaked once it has been anywhere outside `.env` and the secret store: a commit
pushed to GitHub, a chat, Jira, a screenshot, a log, a Spec Kit file (R-SEC-1).
Deleting the commit or the message does not handle it. Whoever saw the value
may have copied it, and Git history, forks and caches keep it.

1. **Rotate, now.** Issue a new value at its source, install it, restart the API
   and the worker (both read their configuration only at start), then revoke
   the old value. If the new value cannot be installed quickly, revoke the old
   one anyway: an outage costs less than an open credential.
2. **Investigate, after.** How it leaked, where it went, what it could reach,
   and what the provider's own records show was done with it between the leak
   and the revocation.
3. **Clean up last.** Removing the value from Git history rewrites shared
   branches, so it needs the team's agreement. It is housekeeping and never
   replaces step 1.

Deployed values live in the host's secret store, injected at runtime
(ARCHITECTURE §14). The host is research R-18, still open, so no deployed
environment exists yet; until it does, "install" means a developer's `.env`.

**What each credential is and how it is rotated** (the keys of `.env.example`):

- **`DATABASE_URL`**, the application role's password. Set a new value from the
  secret store with `ALTER ROLE ijazah_app PASSWORD '…'`, as the role that set
  it before (see "Provision the database roles in production"), update
  `DATABASE_URL`, then restart the API and the worker so their connections
  reopen with it.
- **`DATABASE_URL_OWNER`**, the owner role's password. The owner can change its
  own with `ALTER ROLE ijazah_owner PASSWORD '…'`, or the database host's console
  can; then update the value wherever migrations run. The development values
  (`owner` and `app`, in `.env.example` and `docker/initdb`) are public on
  purpose and protect only a container on 127.0.0.1; a deployed environment
  never uses them.
- **`ENCRYPTION_KEY`**. Every key derived from it changes with it: the column
  key, the one-time-code pepper, the local storage link signature, the
  webhook secrets of the payment stand-in (when
  `PAYMENT_GATEWAY_WEBHOOK_SECRET` is empty) and the video stand-in, and the
  banned-identifier key (T097).
  In development and test with `VIDEO_MEDIA_KEY_SECRET` empty, the session media keys' stand-in
  changes with it too (004:T084); a hosted server never uses that stand-in.
  The pepper, the link signature and the stand-in secrets protect only
  short-lived values: codes already sent stop verifying, and links and
  stand-in events already signed are refused. The banned-identifier key is
  different: its hashes are stored and cannot be carried over (step 1). The
  six `*_encrypted` columns, every one in `prisma/schema`, are kept by steps 2 to 5 (T155):
  `admin_users.mfa_secret_encrypted`,
  `teacher_profiles.payout_account_ref_encrypted`,
  `device_push_tokens.token_encrypted`,
  `auth_identities.provider_refresh_token_encrypted`,
  `verification_documents.storage_key_encrypted` and
  `payments.checkout_url_encrypted` (Phase 2's T004).
  1. **Decide about the banned identifiers before anything else (T097,
     FR-155).** `banned_identifiers` holds a banned person's email and
     provider accounts, kept after they deleted their account, as HMACs under a
     key derived from ENCRYPTION_KEY. An HMAC cannot be recomputed without the
     address it was made from, and the platform no longer has the address, so
     no step below carries these rows over: after the rotation every row is
     unmatched, and every banned person who deleted their account can sign up
     again with the same email or Google or Apple account. Count the rows
     (`SELECT count(*) FROM banned_identifiers`). If there are none, go on. If
     there are some, the owner decides before step 2: accept that those bans
     lapse (after a leak this may be the lesser harm), or postpone the rotation.
     Record the decision and the count in the incident notes.
  2. Generate a new key (`openssl rand -base64 32`). Set
     `ENCRYPTION_KEY_PREVIOUS` to the current value and `ENCRYPTION_KEY` to the
     new one, for the API and the worker together, and restart both. If they
     refuse to start because the two keys share a key id, generate another new
     key; this happens about once in 256.
  3. Every value is now written under the new key, and both keys read. The
     worker's `reencrypt-columns` sweep runs every ten minutes and writes each
     value still under the old key again under the new one, one column at a
     time.
  4. Wait for the worker to log "Every encrypted value is under ENCRYPTION_KEY;
     ENCRYPTION_KEY_PREVIOUS can be removed" with a `startedAt` later than the
     restart of the last process from step 2, so the run began once no process
     could still write under the old key. If the sweep fails instead, naming
     columns with values under neither key, those values were written under a
     key nobody holds any more: stop and raise it with the team.
  5. Remove `ENCRYPTION_KEY_PREVIOUS` and restart both processes. The old key is
     retired. After a leak, the leaked key still reads values until this step,
     so take it as soon as the log line appears.

  In development, generating a new key and rebuilding the database (see "Reset
  the local database") is still the shorter way.

- **`PAYMENT_GATEWAY_API_KEY`** and **`PAYMENT_GATEWAY_WEBHOOK_SECRET`**. Issued
  in the gateway's dashboard. The gateway is not chosen yet (SRS OPEN-11), so
  its own steps are written here when its adapter lands. Once the webhook
  secret changes, an event signed with the old one is refused with 401; replay
  it from the gateway's dashboard. A replay is safe, because
  `payment_events.provider_event_id` is unique (R-MONEY-8).
- **`LIVEKIT_API_KEY`** and **`LIVEKIT_API_SECRET`**, with `LIVEKIT_URL` (not a
  secret), in `.env.example` since B34's adapter task (T009 of
  `specs/004-sessions/tasks.md`; ADR 0003, Consequences, amended 2026-11-05),
  read only while `VIDEO_PROVIDER=livekit`. Issued in the LiveKit Cloud project's settings:
  create a new key pair, install both values, restart the API and the worker,
  then delete the old pair. LiveKit has no separate webhook secret: the API secret signs the
  tokens and verifies the webhooks (`specs/004-sessions/research.md` R-302).
  Replaying an attendance webhook is safe
  (`session_participant_events.provider_event_id` is unique).
- **`VIDEO_MEDIA_KEY_SECRET`**, the platform's own secret every session's media key is made from
  (HMAC-SHA-256 of the session's id; 004:T084, SRS DEC-102, NFR-SEC-13), never LiveKit's and never
  sent to LiveKit. Required outside development and test: the API refuses to start without it.
  Generate it with `openssl rand -base64 32`, install it, restart the API and the worker. Its second
  copy is kept in the owner's password manager, under the deployment's entry beside
  `ENCRYPTION_KEY`'s (T179), never written here or anywhere else by value. Whoever holds it can
  derive any session's key and read a recorded stream, so a leak is rotated at once; a rotation
  changes every session's key from the next join, so two participants who joined on either side of
  the restart hear and see nothing of each other until both rejoin. Nothing is stored under it, so
  nothing is re-encrypted.
- **`SMS_PROVIDER_KEY`** and **`EXPO_ACCESS_TOKEN`**. Issued by the SMS provider
  (not chosen yet) and in the Expo account's access tokens.
- **`EMAIL_PROVIDER_KEY`**, Resend's API key (002:T177), read only while
  `EMAIL_PROVIDER=resend`. Issued in Resend's dashboard (API Keys): create a
  new key, install it, restart the API and the worker, then revoke the old one.
  Mails sent with the old key are not affected; until the restart, a code mail
  or an invitation sent with a revoked key fails, and the invitation's job
  retries.
- **`S3_ACCESS_KEY_ID`** and **`S3_SECRET_ACCESS_KEY`**. Issued by the storage
  provider. Links already signed with the old pair stop working when it is
  deleted; they are short-lived anyway.
- **`BACKUP_S3_ACCESS_KEY_ID`** / **`BACKUP_S3_SECRET_ACCESS_KEY`** and
  **`DOCUMENTS_S3_ACCESS_KEY_ID`** / **`DOCUMENTS_S3_SECRET_ACCESS_KEY`** (the
  backup script's, `deploy/backup.env.example`, 002:T179; the API never reads
  them). Two tokens of the storage provider: the backup bucket's read-write,
  the documents' read-only. Make a new token, put it in the script's
  environment on the server, run `dump` (or `copy-documents`) once, then
  delete the old token.
- **The backup passphrase** (the file `BACKUP_PASSPHRASE_FILE` names). Whoever
  holds it opens every dump made under it. Make a new one, write it to the file
  and to the owner's password manager (by place, never by value), run `dump`
  once; keep the old one in the password manager until the last dump made under
  it is past the 14 days («Backups and restore»), then remove it.
- **`SENTRY_DSN`**. Not a password, but it lets anyone send events into the
  project. Create a new client key in the Sentry project's settings, install it,
  then disable the old one.
- **`REDIS_URL`**, when it carries a password. Changed at the Redis host (R-18).
- **GitHub tokens.** A personal access token or a `gh` login token is revoked
  in the owner's GitHub settings and replaced. The workflows hold one stored
  secret, `DEPENDABOT_ALERTS_TOKEN` (T090): a fine-grained token of the
  repository owner's account, for this repository only, with the single
  permission "Dependabot alerts: Read-only". To rotate it, generate a new token
  with that same permission and replace the repository secret (Settings,
  Secrets and variables, Actions), then delete the old token. It also has an
  expiry date: when it expires, the `dependency-alerts` job fails until it is
  replaced. From fourteen days before that date, the job warns on every run
  and names the date (T158; `scripts/dependency-alerts.ts` since T160). Every other job uses GitHub's own
  short-lived, read-only token.

**The nets that catch a secret before it leaks** (research R-15):

- `.husky/pre-commit` runs Gitleaks over the staged change before anything else,
  and refuses to commit on a machine without Gitleaks. When it refuses, the value
  has not left your machine: take it out of the change and keep it in `.env`.
  Never commit with `--no-verify` to get past it.
- The `secret-scan` job in `.github/workflows/ci.yml` scans every commit of every
  fetched branch and tag, `specs/` included. When it fails, the value is already
  on GitHub: it is leaked, so rotate first.
- Both run Gitleaks with `--redact`, so their output does not repeat the value.
- GitHub push protection is not available to this repository (owner's
  decision, note under T090). The repository is private and owned by a personal
  account, and repository push protection needs a public repository or an
  organisation with GitHub Secret Protection. The account-level setting covers
  public repositories only. The two Gitleaks nets above are therefore the whole
  protection. Revisit this if the repository moves to an organisation or becomes
  public.

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

**Room does not open** — check `VIDEO_PROVIDER`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (the API refuses to start with
`VIDEO_PROVIDER=livekit` and any of the three missing), and the session status and its join period: a
token is issued only for a scheduled session, from the early-join lead before
its start until its scheduled end, and a settled or cancelled session never
re-issues one (amended 2026-11-05).

LiveKit Cloud's project setting **«Automatically create rooms» must be off** in every project the platform uses, production included (T009's check, 2026-11-07): with it on, a token minted before `endRoom` re-creates the room, with no participant limit, after the platform ended it; with it off, such a token is refused and only `createRoom` opens a room. Check it whenever a project is created or its keys are rotated. The room's `maxParticipants` is not enforced by LiveKit Cloud (the same check): the server's join, which issues a token only to the session's two parties, is what keeps a third person out.

**A video event refused or not attributed** — nothing reaches the database
for either, so look in two places (`specs/004-sessions/research.md` R-323,
GAP-10; added 2026-11-05, the owner's decision). A refused event (no or wrong
signature: 401; a signed body the port cannot read: 400) is one API log line
at warn with its errorCode, `Video webhook refused`, the video webhook's
counterpart of `Payment webhook refused` (which carries `errorCode` too),
counted by the webhook signature alert (ARCHITECTURE §12); its body and header
are never logged. Many of them: check that `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` match the project that sends the webhook, and that the
tunnel's proxy passes the body unchanged. An event that names no session, or
a participant who is not one of its two, is answered 200, written nowhere and
reported to error tracking (the report names the provider's event id and the
session's id, never the identity), with one API log line at warn:

- a `participant_joined` from someone who is not a party:
  `Video webhook: someone who is not a party joined the room; nothing was recorded`,
  with `{ sessionId, eventId }` (the session's id and the provider's event id)
  and no other field; LiveKit Cloud does not enforce `maxParticipants`, so
  this is a third person in the room;
- any other event not recorded (a `participant_left` from someone who is not
  a party, or an event naming no session):
  `Video webhook acknowledged an event it did not record`,
  with `{ reason }`, `not_a_party` or `unknown_session`, and no id.

Compare the room's name with the session's id. Attendance missing because of
either: «Attendance missing for a finished session» above.

**Certificate render failed** — re-enqueue `render-certificate` for the grant.
The grant is the source of truth; the PDF is derived and disposable.
