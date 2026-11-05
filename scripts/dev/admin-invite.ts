// B12b (T066's note, owner's decision 2026-10-21): gives the seeded administrator a password through
// the invite job's own path, on a development machine only.
//
//   pnpm exec tsx scripts/dev/admin-invite.ts
//
// The seed writes the administrator with an unusable password and no invitation (prisma/seed.ts).
// This marks the invitation now (`invited_at`), where no password was ever set and the account is
// active, and queues `deliver-admin-invite` with the id alone, as `admins.add` does; the running
// worker prepares the link and hands the mail to the email port, whose stand-in writes it under
// `<STORAGE_LOCAL_ROOT>/mail/`. The link opens the panel's password page, then the second factor's
// setup. Run it again after the link's lifetime (`admin_invite_ttl_hours`) for a fresh one.
//
// T097 (B32, the owner's decision of 2026-11-04): with `--email <x> --name <y>` it invites a NEW
// administrator instead, for a development machine where nobody knows an existing administrator's
// password:
//
//   pnpm exec tsx scripts/dev/admin-invite.ts --email <x> --name <y>
//
// The values pass `admins.add`'s own input contract. The row is written with SQL, as the seeded
// administrator's invite above is, because R-API-4 lets only the three composition files import the
// admin module, so neither `AdminsService.add` nor its repository can be reached from here. The row
// is the one `AdminsService.add` writes, so A CHANGE TO EITHER IS MADE TO BOTH: the address trimmed
// and lower-cased, a fresh second-factor secret encrypted to the row's id under
// `admin_users.mfa_secret_encrypted`, no password, active, invited now, and `invited_by_admin_id`
// NULL: no administrator invited it. `tests/dev/admin-invite.spec.ts` fails when `admin_users` gains
// a column. An address another administrator holds is refused by the table's unique constraint and
// nothing is queued. It writes NO AUDIT ENTRY: `admins.add`'s entry names the administrator who
// acted, and here none did; like the seeded administrator's invite above, it is a development tool,
// refused everywhere else, not an administrator's action.
//
// IT NEVER SENDS A REAL MAIL. It refuses unless `NODE_ENV` is `development` and the email provider
// is the stand-in, and refuses without `ADMIN_PANEL_ORIGIN`, which the link needs (the worker would
// fail the delivery). Like the seed, it writes through the application role's connection.
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { config as readDotenv } from 'dotenv';
import pg from 'pg';

import { DELIVER_ADMIN_INVITE } from '../../apps/api/src/jobs/deliver-admin-invite';
import { connectionFor, openQueue } from '../../apps/api/src/jobs/queue';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { generateTotpSecret } from '../../apps/api/src/platform/crypto/totp';
import { adminsAddInput } from '../../packages/contracts/src/admin/admins';
import { ADMINISTRATOR, type Queryable } from '../../prisma/seed';

/** The column the second-factor secret is encrypted under, bound to the row's id (R-DB-8). */
const MFA_SECRET_COLUMN = 'admin_users.mfa_secret_encrypted';

/** Postgres' unique_violation: the address is another administrator's. */
const UNIQUE_VIOLATION = '23505';

/** The email provider that writes mail to a folder and sends nothing (contracts/ports.md). */
const STAND_IN_EMAIL = 'fake';

/** Why the script will not run here, or null when it may. */
export function refusalOf(env: Readonly<Record<string, string | undefined>>): string | null {
  if (env['NODE_ENV'] !== 'development') {
    return 'runs only where NODE_ENV is development';
  }
  if ((env['EMAIL_PROVIDER'] ?? STAND_IN_EMAIL) !== STAND_IN_EMAIL) {
    return `runs only with the stand-in email provider (EMAIL_PROVIDER=${STAND_IN_EMAIL}), so no real mail is sent`;
  }
  if (env['ADMIN_PANEL_ORIGIN'] === undefined || env['ADMIN_PANEL_ORIGIN'] === '') {
    return 'ADMIN_PANEL_ORIGIN is not set, so the link has nowhere to point (.env.example)';
  }
  return null;
}

/** The one method of the queue the invite needs. */
export interface InviteQueue {
  add(name: string, data: { readonly adminId: string }): Promise<unknown>;
}

/**
 * Marks the seeded administrator invited now and queues the invite; false, and nothing queued, when
 * the administrator already set a password or is disabled.
 */
export async function inviteSeededAdministrator(
  db: Queryable,
  queue: InviteQueue,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE admin_users
        SET invited_at = now(), updated_at = now()
      WHERE id = $1 AND password_set_at IS NULL AND is_active`,
    [ADMINISTRATOR.id],
  );
  if (rowCount !== 1) return false;
  await queue.add(DELIVER_ADMIN_INVITE, { adminId: ADMINISTRATOR.id });
  return true;
}

/** A new administrator as `admins.add` takes one. */
export interface NewAdministrator {
  readonly email: string;
  readonly displayName: string;
}

/** `--email` and `--name` read through `admins.add`'s input contract; null when neither is given. */
export function newAdministratorOf(args: readonly string[]): NewAdministrator | null {
  const { values } = parseArgs({
    args: [...args],
    options: { email: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  });
  if (values.email === undefined && values.name === undefined) return null;
  return adminsAddInput.parse({ email: values.email, displayName: values.name });
}

/**
 * Writes a new administrator invited by nobody, the row `admins.add` writes, and queues the invite;
 * null, and nothing written or queued, when another administrator holds the address.
 */
export async function inviteNewAdministrator(
  db: Queryable,
  cipher: Pick<ColumnCipher, 'encrypt'>,
  queue: InviteQueue,
  { email, displayName }: NewAdministrator,
): Promise<{ readonly adminId: string } | null> {
  const adminId = randomUUID();
  try {
    await db.query(
      `INSERT INTO admin_users
         (id, email, password_hash, mfa_secret_encrypted, display_name, is_active,
          invited_by_admin_id, invited_at, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, $4, true, NULL, now(), now(), now())`,
      [
        adminId,
        email.trim().toLowerCase(),
        cipher.encrypt(generateTotpSecret(), MFA_SECRET_COLUMN, adminId),
        displayName,
      ],
    );
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
  await queue.add(DELIVER_ADMIN_INVITE, { adminId });
  return { adminId };
}

async function inviteNew(
  env: Readonly<Record<string, string | undefined>>,
  admin: NewAdministrator,
): Promise<number> {
  const db = new pg.Client({
    connectionString: env['DATABASE_URL'],
    connectionTimeoutMillis: 5_000,
  });
  const queue = openQueue(connectionFor(env['REDIS_URL'] ?? ''));
  try {
    await db.connect();
    const invited = await inviteNewAdministrator(
      db,
      new ColumnCipher(env['ENCRYPTION_KEY'] ?? ''),
      queue,
      admin,
    );
    if (invited === null) {
      process.stderr.write(
        'admin-invite: another administrator already holds this address; nothing was written or queued\n',
      );
      return 1;
    }
    process.stdout.write(
      `admin-invite: administrator ${invited.adminId} written and the invite queued; with the worker running, the mail is under <STORAGE_LOCAL_ROOT>/mail/\n`,
    );
    return 0;
  } finally {
    await db.end().catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  const env = { ...fromDotenv, ...process.env };
  const refusal = refusalOf(env);
  if (refusal !== null) {
    process.stderr.write(`admin-invite: ${refusal}\n`);
    return 1;
  }
  const admin = newAdministratorOf(process.argv.slice(2));
  if (admin !== null) return inviteNew(env, admin);
  const db = new pg.Client({
    connectionString: env['DATABASE_URL'],
    connectionTimeoutMillis: 5_000,
  });
  const queue = openQueue(connectionFor(env['REDIS_URL'] ?? ''));
  try {
    await db.connect();
    if (!(await inviteSeededAdministrator(db, queue))) {
      process.stderr.write(
        `admin-invite: ${ADMINISTRATOR.email} already has a password, or is disabled; nothing was queued\n`,
      );
      return 1;
    }
  } finally {
    await db.end().catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
  process.stdout.write(
    `admin-invite: queued for ${ADMINISTRATOR.email}; with the worker running, the mail is under <STORAGE_LOCAL_ROOT>/mail/\n`,
  );
  return 0;
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'admin-invite.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
